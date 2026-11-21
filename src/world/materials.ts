// Матеріали рівня 0 «Бесконечный НИИ» на TSL. Освітлення — із запечених карт світла (UV1), фактура — лише справжні CC0-текстури
// (UV0 у метрах). Кожна з 9 зон рівня має своє «оздоблення», як різні відділи інституту: кабінети — шпалери й паркет «ялинкою»;
// зали — охриста олійна панель до 1.45 м із побілкою над нею й паркет; коридори — сіро-блакитна панель і лінолеум; темні
// відділи — зелено-сіра облуплена панель і лінолеум. Стеля — плити «Акмигран». Різноманітність — змішування справжніх текстур
// за великими масками у світових координатах (маски — теж справжні текстури), без візерунків, «намальованих» кодом.
import * as THREE from 'three/webgpu';
import {
  texture, uv, uniform, uniformArray, Loop, vec2, vec3, float, mix, smoothstep, clamp, floor, min, int, dot, step,
  positionWorld, normalMap, normalWorld, Fn, luminance
} from 'three/tsl';
import type { Layout, ZoneStyle } from './layout';
import type { Assets } from '../assets/loader';

export const LMAX = 4.0;
/** Загальна яскравість запеченого світла (згасання/аварійне світло). */
export const bakeLevel = uniform(1.0);

/**
 * «Живе згасання»: до 16 ламп біля гравця, які зараз світять слабше, ніж під час запікання (мерехтять, згасли, їх «вимкнув» монстр).
 * xyz = (x, z, нестача 0..1), w — не використовується. Запечене світло довкола такої лампи темніє — разом із самою лампою.
 */
export const LAMP_SLOTS = 16;
export const lampDeficits = uniformArray(Array.from({ length: LAMP_SLOTS }, () => new THREE.Vector4()), 'vec4');

/** Множник запеченого світла в точці: 1 — як запечено, менше — довкола ламп, яких «бракує». */
const liveDim = Fn(() => {
  const loss = float(0).toVar();
  Loop(LAMP_SLOTS, ({ i }) => {
    const l = lampDeficits.element(i) as unknown as THREE.Node<'vec4'>; // типи @types/three ще не знають swizzle для елемента масиву
    const d2 = positionWorld.x.sub(l.x).pow(2).add(positionWorld.z.sub(l.y).pow(2));
    // частка лампи в освітленості точки: майже повна під нею, згасає на 2–4 м (так світло й запікалось)
    loss.addAssign(l.z.mul(float(1).div(float(1).add(d2.div(3.2)))));
  });
  return clamp(float(1).sub(loss.mul(0.9)), 0.04, 1);
});


type Tex = THREE.Texture;
const TEX = ['wall_c', 'wall_n', 'wall_r', 'dmg_c', 'mold', 'ceil_c', 'ceil_n', 'ceil_ar', 'decals', 'door_c', 'door_n',
  'paint_c', 'paint_n', 'paint_r', 'peel_c', 'peel_m', 'parquet_c', 'parquet_n', 'parquet_r', 'lino_c', 'lino_n', 'lino_r'] as const;
export type Level0Textures = Record<(typeof TEX)[number], Tex>;
const SRGB = new Set(['wall_c', 'dmg_c', 'mold', 'ceil_c', 'decals', 'door_c', 'paint_c', 'peel_c', 'parquet_c', 'lino_c']);
/** Лінолеум — той самий справжній Poly Haven linoleum_brown, що й на базі «Глубина-1». */
const texPath = (n: string) => (n.startsWith('lino_') ? `assets/tex/level1/floor_${n.slice(5)}.ktx2` : `assets/tex/level0/${n}.ktx2`);

export async function loadLevel0Textures(a: Assets): Promise<Level0Textures> {
  const list = await Promise.all(TEX.map((n) => a.texture(texPath(n))));
  const all = {} as Level0Textures;
  TEX.forEach((n, i) => {
    const t = list[i] as Tex;
    t.wrapS = t.wrapT = n === 'decals' ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
    t.anisotropy = 16; // рушій обріже до максимуму пристрою
    if (SRGB.has(n)) t.colorSpace = THREE.SRGBColorSpace;
    all[n] = t;
  });
  return all;
}

/** Стандартний матеріал, що бере непряме світло з запеченої карти. */
export class BakedMaterial extends THREE.MeshStandardNodeMaterial {
  lmNode: THREE.Node<'vec3'> | null = null;
  override setupLightMap(builder: THREE.NodeBuilder): THREE.Node {
    return this.lmNode ? new THREE.IrradianceNode(this.lmNode) : super.setupLightMap(builder);
  }
}

const srgb = (r: number, g: number, b: number) => new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace);


/** Масштаби в метрах (реальні розміри): шпалери — 1.06 м на текстуру, стеля — 6×6 плит по 0.6 м, паркет — 1.6 м, лінолеум — 2 м, фарба — 1.5 м. */
const WALL_M = 1.06, CEIL_M = 3.6, PARQ_M = 1.6, LINO_M = 2.0, PAINT_M = 1.5;
/** Висота олійної панелі, м. */
const PANEL_H = 1.45;
/** Оздоблення зон: 0 — кабінет (шпалери, паркет), 1 — зал (охра, паркет), 2 — коридор (блакитна, лінолеум), 3 — темний відділ. */
const ZONE_CODE: Record<ZoneStyle, number> = { rooms: 0, hall: 1, corridors: 2, dark: 3 };
const col = (r: number, g: number, b: number) => { const c = new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace); return vec3(c.r, c.g, c.b); };

/** Освітленість із карти світла (зберігається sqrt(E/LMAX)) з урахуванням живого згасання ламп. */
export function decodeLightmap(lm: Tex): THREE.Node<'vec3'> {
  const s = texture(lm, uv(1)).rgb;
  return s.mul(s).mul(LMAX).mul(bakeLevel).mul(liveDim()) as THREE.Node<'vec3'>;
}

export function makeLevel0Materials(t: Level0Textures, layout: Layout) {
  const decodeLM = decodeLightmap;
  const maskAt = (p: THREE.Node<'vec2'>, k: number, off: number) => texture(t.mold, p.mul(k).add(off)).r;
  // код зони в точці (3×3 зони рівня, як у планування)
  const zones = uniformArray(layout.zones.map((z) => ZONE_CODE[z]), 'float');
  const zw = Math.floor(layout.cols / 3) * layout.cell, zh = Math.floor(layout.rows / 3) * layout.cell;
  const zoneAt = Fn(() => {
    const zx = min(floor(positionWorld.x.div(zw)), 2), zz = min(floor(positionWorld.z.div(zh)), 2);
    return zones.element(int(clamp(zx, 0, 2).add(clamp(zz, 0, 2).mul(3)))) as unknown as THREE.Node<'float'>;
  });
  const isZ = (z: THREE.Node<'float'>, k: number) => float(1).sub(step(0.5, z.sub(k).abs()));
  const gp = vec2(positionWorld.x.add(positionWorld.z), positionWorld.y);

  // ---- стіни ----
  const wallUV = uv(0).div(WALL_M), paintUV = uv(0).div(PAINT_M);
  const wallColor = Fn(() => {
    const z = zoneAt(), h = positionWorld.y;
    // кабінети: шпалери (справжня текстура, перефарбована в казенну сіро-зелену)
    const wp = texture(t.wall_c, wallUV).rgb;
    const wl = dot(wp, vec3(0.299, 0.587, 0.114));
    let paper = col(0.66, 0.67, 0.56).mul(mix(float(0.5), wl, 0.6).mul(1.6)); // візерунок приглушено: вицвілі казенні шпалери
    const torn = smoothstep(0.83, 0.88, maskAt(gp, 0.21, 0.43));
    paper = mix(paper, texture(t.dmg_c, uv(0).div(1.2)).rgb.mul(vec3(0.86, 0.84, 0.76)), torn.mul(0.9));
    // фарба: панель знизу (олійна) і побілка зверху, між ними — тонка темна смуга, як проводили маляри
    const pc = texture(t.paint_c, paintUV).r.mul(2.0);
    const panel = mix(mix(col(0.56, 0.42, 0.24), col(0.38, 0.47, 0.52), isZ(z, 2)), col(0.31, 0.37, 0.31), isZ(z, 3));
    const top = mix(col(0.80, 0.77, 0.67), col(0.70, 0.70, 0.64), isZ(z, 3));
    const isPanel = float(1).sub(smoothstep(PANEL_H - 0.004, PANEL_H + 0.004, h));
    const line = smoothstep(PANEL_H - 0.006, PANEL_H, h).mul(float(1).sub(smoothstep(PANEL_H + 0.016, PANEL_H + 0.022, h)));
    let painted = mix(top, panel, isPanel).mul(pc);
    painted = mix(painted, painted.mul(0.45), line);
    // облуплена фарба (справжня штукатурка під нею): плямами, більше в темних відділах і знизу
    const peelZone = smoothstep(0.55, 0.8, maskAt(gp, 0.07, 0.61)).mul(mix(float(0.55), float(1.0), isZ(z, 3)));
    const holes = texture(t.peel_m, paintUV.mul(0.8)).r;
    painted = mix(painted, texture(t.peel_c, paintUV.mul(0.8)).rgb, smoothstep(0.45, 0.6, holes.mul(peelZone)).mul(0.95));
    let c = mix(painted, paper, isZ(z, 0));
    // підтьоки й волога: справжня текстура цвілі, темніше й «брудніше» донизу
    const wet = smoothstep(0.5, 0.82, maskAt(gp, 0.11, 0.0).oneMinus());
    c = mix(c, c.mul(vec3(0.6, 0.55, 0.42)), wet.mul(0.42));
    // затерто біля підлоги, кіптява під стелею (роки тютюну й люмінесцентного світла)
    c = c.mul(float(1).sub(smoothstep(0.35, 0.0, h).mul(0.2)));
    c = mix(c, c.mul(vec3(0.86, 0.82, 0.7)), smoothstep(2.0, 2.7, h).mul(0.35));
    return c;
  });
  const wallRough = Fn(() => {
    const z = zoneAt(), h = positionWorld.y;
    const paper = texture(t.wall_r, wallUV).r;
    const isPanel = float(1).sub(smoothstep(PANEL_H - 0.004, PANEL_H + 0.004, h));
    // олійна панель лисніє (0.35–0.5), побілка й папір — матові
    const paint = mix(texture(t.paint_r, paintUV).r.mul(0.15).add(0.82), texture(t.paint_r, paintUV).r.mul(0.2).add(0.34), isPanel);
    return mix(paint, paper, isZ(z, 0));
  });
  const wallNormal = Fn(() => {
    const z = zoneAt();
    return mix(texture(t.paint_n, paintUV).rgb, texture(t.wall_n, wallUV).rgb, isZ(z, 0));
  });

  // ---- підлога: паркет «ялинкою» у кабінетах і залах, лінолеум у коридорах і темних відділах ----
  const dampMask = Fn(() => smoothstep(0.42, 0.78, texture(t.mold, positionWorld.xz.mul(0.045)).r.oneMinus()));
  const pUV = positionWorld.xz.div(PARQ_M), lUV = positionWorld.xz.div(LINO_M);
  const isLino = Fn(() => { const z = zoneAt(); return isZ(z, 2).add(isZ(z, 3)); });
  const floorColor = Fn(() => {
    const pq = texture(t.parquet_c, pUV).rgb, parq = mix(vec3(luminance(pq)), pq, 0.62).mul(vec3(0.66, 0.58, 0.52)), lino = texture(t.lino_c, lUV).rgb.mul(vec3(0.95, 0.9, 0.85));
    const c = mix(parq, lino, isLino());
    // затерті доріжки (світліше, без лаку) і вологі темні плями
    const worn = smoothstep(0.55, 0.85, maskAt(positionWorld.xz, 0.03, 0.27));
    const c2 = mix(c, c.mul(vec3(1.18, 1.12, 1.02)).add(0.02), worn.mul(0.35));
    return mix(c2, c2.mul(vec3(0.52, 0.47, 0.4)), dampMask().mul(0.65));
  });

  // ---- стеля: плити «Акмигран», трохи сіріші (знімаємо жовтизну американського «армстронга») ----
  const ceilUV = vec2(positionWorld.x, positionWorld.z.add(0.3)).div(CEIL_M); // зсув 0.3 — світильники лягають у комірки
  const ceilColor = Fn(() => {
    let c = texture(t.ceil_c, ceilUV).rgb;
    c = mix(vec3(dot(c, vec3(0.299, 0.587, 0.114))), c, 0.25).mul(vec3(0.95, 0.97, 0.95));
    // підтьоки від протікань на плитах — справжні кільця з текстури цвілі
    const leak = texture(t.mold, ceilUV.mul(0.25).add(0.31)).r.oneMinus();
    const ring = smoothstep(0.6, 0.7, leak).mul(smoothstep(0.82, 0.7, leak));
    c = mix(c, c.mul(vec3(0.66, 0.58, 0.44)), clamp(ring.mul(0.6).add(smoothstep(0.68, 0.9, leak).mul(0.22)), 0, 1));
    return c;
  });

  return (lm: Tex) => {
    // світло запікалось від теплих «американських» ламп і жовтих стін — знімаємо жовтий відблиск до холоднішого денного світла ЛБ
    const lmNode = decodeLM(lm).mul(vec3(0.88, 0.97, 1.1)) as THREE.Node<'vec3'>;
    const wall = new BakedMaterial();
    wall.colorNode = wallColor();
    wall.normalNode = normalMap(wallNormal(), vec2(0.8));
    wall.roughnessNode = wallRough();
    wall.metalness = 0;
    wall.lmNode = lmNode;

    const floorM = new BakedMaterial();
    floorM.colorNode = floorColor();
    floorM.normalNode = normalMap(mix(texture(t.parquet_n, pUV).rgb, texture(t.lino_n, lUV).rgb, isLino()), vec2(0.9));
    // лак на паркеті й лінолеум лиснять; волога — ще більше
    floorM.roughnessNode = mix(mix(texture(t.parquet_r, pUV).r.mul(0.3).add(0.42), texture(t.lino_r, lUV).r.mul(0.3).add(0.45), isLino()), float(0.22), dampMask());
    floorM.metalness = 0;
    floorM.lmNode = lmNode;

    const ceil = new BakedMaterial();
    ceil.colorNode = ceilColor();
    ceil.normalNode = normalMap(texture(t.ceil_n, ceilUV), vec2(0.6));
    const ar = texture(t.ceil_ar, ceilUV);
    ceil.aoNode = ar.r;
    ceil.roughnessNode = ar.g.mul(0.3).add(0.7);
    ceil.metalness = 0;
    ceil.lmNode = lmNode;

    const base = new BakedMaterial();
    base.color = srgb(0.24, 0.17, 0.11); // дерев'яний плінтус, темна фарба
    base.roughness = 0.45; base.metalness = 0;
    base.lmNode = lmNode;
    // модульний кіт: дрібні деталі будівлі (фарба, пластик, метал) — однотонні, освітлення з тієї ж карти світла
    const kit = (c: [number, number, number], rough: number, metal = 0) => {
      const m = new BakedMaterial();
      m.color = srgb(...c); m.roughness = rough; m.metalness = metal; m.lmNode = lmNode;
      return m;
    };
    return {
      wall, floor: floorM, ceil, base, wallLow: wall,
      tbar: kit([0.74, 0.74, 0.7], 0.5, 0.2), plenum: kit([0.025, 0.022, 0.02], 0.95),
      plastic: kit([0.74, 0.72, 0.64], 0.42), metal: kit([0.4, 0.43, 0.4], 0.5, 0.35), frame: kit([0.36, 0.25, 0.15], 0.5)
    } as Record<string, THREE.MeshStandardNodeMaterial>;
  };
}


/**
 * Предмет без власної карти світла (меблі, речі): освітленість — «зонд» у його точці (від найближчих ламп),
 * згори трохи світліше, знизу темніше, як у кімнаті зі стельовим світлом.
 */
export function probeLit(src: THREE.Material, E: number | THREE.Node<'float'>): BakedMaterial {
  const s = src as THREE.MeshStandardMaterial;
  const m = new BakedMaterial();
  for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'alphaMap', 'emissiveMap'] as const) {
    const v = s[k];
    if (v) (m as unknown as Record<string, unknown>)[k] = v;
  }
  if (s.color) m.color.copy(s.color);
  if (s.emissive) m.emissive.copy(s.emissive);
  m.roughness = s.roughness ?? 0.8;
  m.metalness = s.metalness ?? 0;
  if (s.normalScale) m.normalScale.copy(s.normalScale);
  m.transparent = s.transparent; m.alphaTest = s.alphaTest; m.side = s.side;
  // E — число (один предмет) або вузол (атрибут екземпляра: кожні двері зі своєю освітленістю в одному виклику малювання)
  const e = typeof E === 'number' ? float(E) : E;
  m.lmNode = vec3(e.mul(0.75)).mul(normalWorld.y.mul(0.4).add(0.6)).mul(bakeLevel).mul(liveDim());
  return m;
}

/** Освітленість у точці від ламп, що світять (приблизно та сама, що й запечена). */
export function probeAt(lights: { x: number; z: number; state: string }[], x: number, z: number): number {
  let e = 0.22;
  for (const p of lights) {
    if (p.state === 'off') continue;
    const d2 = (p.x - x) ** 2 + (p.z - z) ** 2;
    if (d2 < 49) e += 0.62 / (1 + d2 / 2.6);
  }
  return Math.min(2.2, e);
}
