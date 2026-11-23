// Спільне для матеріалів рівнів: запечене світло (UV1, зберігається sqrt(E/LMAX)), «живе згасання» ламп довкола гравця,
// матеріал із запеченою картою (BakedMaterial), освітлення речей без власної карти (probeLit/probeAt), текстури рівня 0.
// Самі матеріали рівня 0 (оздоблення за приміщенням) — nii-materials.ts.
import * as THREE from 'three/webgpu';
import { texture, uv, uniform, uniformArray, Loop, vec3, float, clamp, positionWorld, normalWorld, Fn } from 'three/tsl';
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
const TEX = ['wall_c', 'wall_n', 'wall_r', 'mold', 'decals', 'door_c', 'door_n', 'paint_c', 'paint_n', 'paint_r', 'peel_c', 'peel_m',
  'parquet_c', 'parquet_n', 'parquet_r', 'lino_c', 'lino_n', 'lino_r', 'tile_c', 'tile_n', 'tile_r', 'wcf_c', 'wcf_n', 'wcf_r'] as const;
export type Level0Textures = Record<(typeof TEX)[number], Tex>;
const SRGB = new Set(['wall_c', 'mold', 'decals', 'door_c', 'paint_c', 'peel_c', 'parquet_c', 'lino_c', 'tile_c', 'wcf_c']);
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



/** Освітленість із карти світла (зберігається sqrt(E/LMAX)) з урахуванням живого згасання ламп. */
export function decodeLightmap(lm: Tex): THREE.Node<'vec3'> {
  const s = texture(lm, uv(1)).rgb;
  return s.mul(s).mul(LMAX).mul(bakeLevel).mul(liveDim()) as THREE.Node<'vec3'>;
}

/**
 * Предмет без власної карти світла (меблі, речі): освітленість — «зонд» у його точці (від найближчих ламп),
 * згори трохи світліше, знизу темніше, як у кімнаті зі стельовим світлом.
 */
export function probeLit(src: THREE.Material, E: number | THREE.Node<'float'>, live = true): BakedMaterial {
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
  // live = false — освітленість уже жива (річ рухається з гравцем і E рахується щокадру), не множимо ще раз
  const lit = vec3(e.mul(0.75)).mul(normalWorld.y.mul(0.4).add(0.6)).mul(bakeLevel);
  m.lmNode = live ? lit.mul(liveDim()) : lit;
  return m;
}

/** Модель освітленості рівня, підігнана під його запечене світло (стіни затуляють лампи). */
interface ProbeModel { walls: { x: number; z: number; w: number; d: number }[]; a: number; s: number; b: number; leak: number }
const probeModels = new WeakMap<object, ProbeModel>();

/**
 * Рівень зі стінами між лампами (НИИ): світло лампи за стіною до речі не доходить (лише слабке відбите — leak).
 * Коефіцієнти підігнані під запечену карту підлоги (найменші квадрати по ~1300 точках, похибка ~18 %).
 */
export function setProbeModel(lights: object, m: ProbeModel): void { probeModels.set(lights, m); }

/** Чи перетинає відрізок (px,pz)→(qx,qz) якусь стіну (прямокутники в плані). */
function blocked(walls: ProbeModel['walls'], px: number, pz: number, qx: number, qz: number): boolean {
  const dx = qx - px, dz = qz - pz;
  for (const w of walls) {
    let t0 = 0, t1 = 1;
    const x0 = w.x - w.w / 2, x1 = w.x + w.w / 2, z0 = w.z - w.d / 2, z1 = w.z + w.d / 2;
    if (Math.abs(dx) < 1e-9) { if (px < x0 || px > x1) continue; } else {
      let a = (x0 - px) / dx, b = (x1 - px) / dx; if (a > b) [a, b] = [b, a];
      t0 = Math.max(t0, a); t1 = Math.min(t1, b); if (t0 > t1) continue;
    }
    if (Math.abs(dz) < 1e-9) { if (pz < z0 || pz > z1) continue; } else {
      let a = (z0 - pz) / dz, b = (z1 - pz) / dz; if (a > b) [a, b] = [b, a];
      t0 = Math.max(t0, a); t1 = Math.min(t1, b); if (t0 > t1) continue;
    }
    return true;
  }
  return false;
}

/** Освітленість у точці від ламп, що світять (приблизно та сама, що й запечена). */
export function probeAt(lights: { x: number; z: number; state: string }[], x: number, z: number): number {
  const m = probeModels.get(lights);
  if (m) {
    let e = m.b;
    for (const p of lights) {
      if (p.state === 'off') continue;
      const d2 = (p.x - x) ** 2 + (p.z - z) ** 2;
      if (d2 > 196) continue;
      const k = p.state === 'flicker' ? 0.75 : 1;
      const vis = blocked(m.walls, x, z, p.x, p.z) ? (d2 < 100 ? m.leak : 0) : k;
      if (vis > 0) e += (m.a * vis) / (1 + d2 / m.s);
    }
    return Math.max(0.05, Math.min(4, e));
  }
  let e = 0.22;
  for (const p of lights) {
    if (p.state === 'off') continue;
    const d2 = (p.x - x) ** 2 + (p.z - z) ** 2;
    if (d2 < 49) e += 0.62 / (1 + d2 / 2.6);
  }
  return Math.min(2.2, e);
}
