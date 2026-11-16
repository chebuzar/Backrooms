// Матеріали рівня 0 на TSL. Освітлення — із запечених карт світла (UV1), фактура — лише справжні CC0-текстури (UV0 у метрах):
// шпалери-дамаск, акустична стеля, ворсистий килим. Різноманітність — змішування кількох справжніх текстур за великими масками
// у світових координатах (маски — теж справжні текстури), без жодного візерунка, «намальованого» кодом (правило власника).
import * as THREE from 'three/webgpu';
import {
  texture, uv, uniform, vec2, vec3, float, mix, smoothstep, clamp,
  positionWorld, normalMap, normalWorld, Fn
} from 'three/tsl';
import type { Assets } from '../assets/loader';

export const LMAX = 4.0;
/** Загальна яскравість запеченого світла (згасання/аварійне світло). */
export const bakeLevel = uniform(1.0);


type Tex = THREE.Texture;
const TEX = ['wall_c', 'wall_n', 'wall_r', 'wall2_c', 'dmg_c', 'mold', 'ceil_c', 'ceil_n', 'ceil_ar', 'carpet_c', 'carpet_n', 'carpet_r', 'decals'] as const;
export type Level0Textures = Record<(typeof TEX)[number], Tex>;
const SRGB = new Set(['wall_c', 'wall2_c', 'dmg_c', 'mold', 'ceil_c', 'carpet_c', 'decals']);

export async function loadLevel0Textures(a: Assets): Promise<Level0Textures> {
  const list = await Promise.all(TEX.map((n) => a.texture(`assets/tex/level0/${n}.ktx2`)));
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


/** Масштаби в метрах (реальні розміри): одна текстура шпалер — 1.06 м (4 раппорти дамаску), стеля — 6×6 плит по 0.6 м, килим — 1.5 м. */
const WALL_M = 1.06, CEIL_M = 3.6, CARPET_M = 1.5;

export function makeLevel0Materials(t: Level0Textures) {
  const decodeLM = (lm: Tex) => {
    const s = texture(lm, uv(1)).rgb;
    return s.mul(s).mul(LMAX).mul(bakeLevel);
  };
  // великі маски в світових координатах (справжня текстура цвілі як «шум» розподілу): зона шпалер, волога, пошкодження
  const maskAt = (p: THREE.Node<'vec2'>, k: number, off: number) => texture(t.mold, p.mul(k).add(off)).r;

  const wallColor = Fn(() => {
    const w = uv(0).div(WALL_M); // x — уздовж стіни, y — висота (м → текстура)
    const gp = vec2(positionWorld.x.add(positionWorld.z), positionWorld.y);
    const a = texture(t.wall_c, w).rgb;
    const b = texture(t.wall2_c, w).rgb;
    // інший рулон шпалер на цілих ділянках (переклеювали в різні роки)
    const zone = smoothstep(0.46, 0.54, maskAt(gp, 0.035, 0.17));
    let c = mix(a, b, zone);
    // підтьоки й волога: справжня текстура цвілі, темніше й «брудніше» донизу
    const wet = smoothstep(0.5, 0.82, maskAt(gp, 0.11, 0.0).oneMinus());
    c = mix(c, c.mul(vec3(0.62, 0.52, 0.34)), wet.mul(0.45));
    // обдерті ділянки: під шпалерами старий папір/штукатурка (Wallpaper001C)
    const torn = smoothstep(0.83, 0.88, maskAt(gp, 0.21, 0.43));
    c = mix(c, texture(t.dmg_c, uv(0).div(1.2)).rgb, torn.mul(0.9));
    // бруд біля плінтуса, жовтизна під стелею (тютюн, роки люмінесцентного світла)
    c = c.mul(float(1).sub(smoothstep(0.45, 0.0, uv(0).y).mul(0.18)));
    c = mix(c, c.mul(vec3(0.92, 0.84, 0.62)), smoothstep(2.1, 2.7, uv(0).y).mul(0.35));
    return c;
  });

  const dampMask = Fn(() => smoothstep(0.42, 0.78, texture(t.mold, positionWorld.xz.mul(0.045)).r.oneMinus()));
  const carpetColor = Fn(() => {
    const c = texture(t.carpet_c, positionWorld.xz.div(CARPET_M)).rgb;
    // вологі темні плями (під ліхтариком блищать) і протоптані доріжки
    return mix(c, c.mul(vec3(0.5, 0.45, 0.36)), dampMask().mul(0.7));
  });

  const ceilUV = vec2(positionWorld.x, positionWorld.z.add(0.3)).div(CEIL_M); // зсув 0.3 — світильники лягають у комірки
  const ceilColor = Fn(() => {
    let c = texture(t.ceil_c, ceilUV).rgb;
    // підтьоки від протікань на плитах — справжні кільця з текстури цвілі
    const leak = texture(t.mold, ceilUV.mul(0.25).add(0.31)).r.oneMinus();
    const ring = smoothstep(0.6, 0.7, leak).mul(smoothstep(0.82, 0.7, leak));
    c = mix(c, c.mul(vec3(0.62, 0.48, 0.28)), clamp(ring.mul(0.75).add(smoothstep(0.68, 0.9, leak).mul(0.3)), 0, 1));
    return c;
  });

  return (lm: Tex) => {
    const lmNode = decodeLM(lm);
    const wall = new BakedMaterial();
    wall.colorNode = wallColor();
    wall.normalNode = normalMap(texture(t.wall_n, uv(0).div(WALL_M)), vec2(0.8));
    wall.roughnessNode = texture(t.wall_r, uv(0).div(WALL_M)).r;
    wall.metalness = 0;
    wall.lmNode = lmNode;

    const floor = new BakedMaterial();
    floor.colorNode = carpetColor();
    floor.normalNode = normalMap(texture(t.carpet_n, positionWorld.xz.div(CARPET_M)), vec2(1.0));
    floor.roughnessNode = mix(texture(t.carpet_r, positionWorld.xz.div(CARPET_M)).r.mul(0.25).add(0.72), float(0.3), dampMask());
    floor.metalness = 0;
    floor.lmNode = lmNode;

    const ceil = new BakedMaterial();
    ceil.colorNode = ceilColor();
    ceil.normalNode = normalMap(texture(t.ceil_n, ceilUV), vec2(0.6));
    const ar = texture(t.ceil_ar, ceilUV);
    ceil.aoNode = ar.r;
    ceil.roughnessNode = ar.g.mul(0.3).add(0.7);
    ceil.metalness = 0;
    ceil.lmNode = lmNode;

    const base = new BakedMaterial();
    base.color = srgb(0.36, 0.28, 0.17);
    base.roughness = 0.5; base.metalness = 0;
    base.lmNode = lmNode;
    return { wall, floor, ceil, base, wallLow: wall } as Record<'wall' | 'floor' | 'ceil' | 'base' | 'wallLow', THREE.MeshStandardNodeMaterial>;
  };
}


/**
 * Предмет без власної карти світла (меблі, речі): освітленість — «зонд» у його точці (від найближчих ламп),
 * згори трохи світліше, знизу темніше, як у кімнаті зі стельовим світлом.
 */
export function probeLit(src: THREE.Material, E: number): BakedMaterial {
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
  m.lmNode = vec3(E * 0.75).mul(normalWorld.y.mul(0.4).add(0.6)).mul(bakeLevel);
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
