// Матеріали рівня 0 на TSL. Освітлення — із запечених карт світла (UV1), фактура — з фото-текстур CC0 (UV0 у метрах),
// фірмові деталі (візерунок шпалер, сітка стелі, вологі плями) — процедурні, щоб не повторювались «обоями».
import * as THREE from 'three/webgpu';
import {
  texture, uv, uniform, vec2, vec3, float, mix, smoothstep, fract, abs, max, dot, fwidth, clamp,
  positionWorld, normalMap, normalWorld, Fn
} from 'three/tsl';
import type { Assets } from '../assets/loader';

export const LMAX = 4.0;
/** Загальна яскравість запеченого світла (згасання/аварійне світло). */
export const bakeLevel = uniform(1.0);

type Tex = THREE.Texture;
export interface Level0Textures {
  carpetC: Tex; carpetN: Tex; carpetR: Tex;
  wallC: Tex; wallN: Tex; wallR: Tex;
  mold: Tex; ceilC: Tex; ceilN: Tex;
}

export async function loadLevel0Textures(a: Assets): Promise<Level0Textures> {
  const p = (n: string) => a.texture(`assets/tex/level0/${n}.ktx2`);
  const [carpetC, carpetN, carpetR, wallC, wallN, wallR, mold, ceilC, ceilN] = (await Promise.all(
    ['carpet_c', 'carpet_n', 'carpet_r', 'wall_c', 'wall_n', 'wall_r', 'mold', 'ceil_c', 'ceil_n'].map(p)
  )) as [Tex, Tex, Tex, Tex, Tex, Tex, Tex, Tex, Tex];
  const all = { carpetC, carpetN, carpetR, wallC, wallN, wallR, mold, ceilC, ceilN } as Level0Textures;
  for (const t of Object.values(all)) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
  }
  for (const t of [carpetC, wallC, mold, ceilC]) t.colorSpace = THREE.SRGBColorSpace;
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

export function makeLevel0Materials(t: Level0Textures) {
  const wallTint = uniform(srgb(0.9, 0.78, 0.38));
  const carpetTint = uniform(srgb(0.66, 0.52, 0.27));
  const ceilTint = uniform(srgb(0.9, 0.86, 0.72));

  const decodeLM = (lm: Tex) => {
    const s = texture(lm, uv(1)).rgb;
    return s.mul(s).mul(LMAX).mul(bakeLevel);
  };

  // --- шпалери: тонкі вертикальні подвійні смуги + ряд дрібних ромбів, рельєф паперу з фото, плісняві підтьоки
  const wallColor = Fn(() => {
    const w = uv(0); // x — уздовж стіни (м), y — висота
    const fw = max(fwidth(w.x), float(1e-4));
    const sx = fract(w.x.div(0.24));
    const line = (c: number) => float(1).sub(smoothstep(0.0, fw.mul(4.5).max(0.006), abs(sx.sub(c)).mul(0.24)));
    const stripes = max(line(0.06), line(0.115));
    // ромби по центру смуги
    const cy = fract(w.y.div(0.16)).sub(0.5);
    const d = abs(sx.sub(0.6)).mul(0.24 / 0.05).add(abs(cy).mul(0.16 / 0.07));
    const diamond = smoothstep(0.62, 0.55, d).mul(smoothstep(0.38, 0.45, d));
    // далеко візерунок зливається — згасає, щоб не мерехтів
    const far = smoothstep(0.02, 0.006, fw);
    const pattern = float(1).sub(stripes.mul(0.22).add(diamond.mul(0.18)).mul(far));
    const paper = texture(t.wallC, w.mul(0.9)).rgb;
    const lum = dot(paper, vec3(0.333));
    let c = wallTint.mul(pattern).mul(lum.mul(0.5).add(0.62));
    // плями: велика маска в світових координатах
    const gp = vec2(positionWorld.x.add(positionWorld.z), positionWorld.y);
    const stain = smoothstep(0.55, 0.85, texture(t.mold, gp.mul(vec2(0.11, 0.18))).r.oneMinus());
    c = mix(c, c.mul(vec3(0.7, 0.6, 0.4)), stain.mul(0.35));
    // бруд біля підлоги й жовтизна під стелею
    const foot = smoothstep(0.55, 0.0, w.y);
    c = c.mul(float(1).sub(foot.mul(0.2)));
    const top = smoothstep(2.15, 2.7, w.y);
    c = mix(c, c.mul(vec3(0.9, 0.82, 0.58)), top.mul(0.5));
    return c;
  });

  // --- ковролін: плитки 0.5 м, вологі темні плями (блищать під ліхтариком)
  const dampMask = Fn(() => smoothstep(0.42, 0.78, texture(t.mold, positionWorld.xz.mul(0.045)).r.oneMinus()));
  const carpetColor = Fn(() => {
    const c = texture(t.carpetC, uv(0)).rgb;
    const lum = dot(c, vec3(0.299, 0.587, 0.114));
    const base = mix(vec3(lum), c, 0.35).mul(carpetTint).mul(lum.mul(0.9).add(0.55));
    return mix(base, base.mul(vec3(0.55, 0.5, 0.42)), dampMask().mul(0.75));
  });

  // --- стеля: плити 0.6 м (зсув 0.3 по Z, щоб лампи лягали в комірки), T-профілі, підтьоки від протікань
  const ceilColor = Fn(() => {
    const p = vec2(positionWorld.x, positionWorld.z.add(0.3));
    const g = abs(fract(p.div(0.6)).sub(0.5)).mul(0.6); // відстань до центру плити
    const edge = max(g.x, g.y);
    const fw = max(fwidth(p.x), float(1e-4));
    const bar = smoothstep(0.288, float(0.288).add(fw.mul(1.5)), edge);
    const surf = texture(t.ceilC, p.mul(1.6)).rgb;
    const slum = dot(surf, vec3(0.333)).mul(0.35).add(0.72);
    let c = ceilTint.mul(slum);
    c = mix(c, vec3(0.5, 0.49, 0.45), bar);
    const leak = texture(t.mold, p.mul(0.07).add(0.31)).r.oneMinus();
    const ring = smoothstep(0.6, 0.7, leak).mul(smoothstep(0.82, 0.7, leak));
    c = mix(c, c.mul(vec3(0.62, 0.48, 0.28)), clamp(ring.mul(0.8).add(smoothstep(0.68, 0.9, leak).mul(0.35)), 0, 1));
    return c;
  });

  return (lm: Tex) => {
    const lmNode = decodeLM(lm);
    const wall = new BakedMaterial();
    wall.colorNode = wallColor();
    wall.normalNode = normalMap(texture(t.wallN, uv(0).mul(0.9)), vec2(0.7));
    wall.roughnessNode = texture(t.wallR, uv(0).mul(0.9)).r.mul(0.25).add(0.7);
    wall.metalness = 0;
    wall.lmNode = lmNode;

    const floor = new BakedMaterial();
    floor.colorNode = carpetColor();
    floor.normalNode = normalMap(texture(t.carpetN, uv(0)), vec2(0.9));
    floor.roughnessNode = mix(texture(t.carpetR, uv(0)).r.mul(0.3).add(0.7), float(0.32), dampMask());
    floor.metalness = 0;
    floor.lmNode = lmNode;

    const ceil = new BakedMaterial();
    ceil.colorNode = ceilColor();
    ceil.normalNode = normalMap(texture(t.ceilN, vec2(positionWorld.x, positionWorld.z.add(0.3)).mul(1.6)), vec2(0.5));
    ceil.roughness = 0.92; ceil.metalness = 0;
    ceil.lmNode = lmNode;

    const base = new BakedMaterial();
    base.color = srgb(0.42, 0.33, 0.2);
    base.roughness = 0.55; base.metalness = 0;
    base.lmNode = lmNode;
    return { wall, floor, ceil, base } as Record<'wall' | 'floor' | 'ceil' | 'base', THREE.MeshStandardNodeMaterial>;
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
