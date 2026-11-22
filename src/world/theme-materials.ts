// Матеріали рівнів 1–2 (база «Глубина-1», парковка): справжні CC0-текстури Poly Haven (tex/level1|2: wall, low, floor, ceil),
// освітлення — з запечених карт світла. Фарбовані поверхні «перефарбовано» в кольори теми (як радянська панель: світлий верх,
// темно-зелена чи сіро-блакитна панель знизу); сирість і бруд — за великими масками справжньої текстури цвілі.
import * as THREE from 'three/webgpu';
import { texture, uv, vec2, vec3, float, mix, smoothstep, positionWorld, normalMap, Fn, dot } from 'three/tsl';
import type { Assets } from '../assets/loader';
import { BakedMaterial, decodeLightmap } from './materials';

type Tex = THREE.Texture;
const PARTS = ['wall', 'low', 'floor', 'ceil'] as const;
export type ThemeTextures = Record<`${(typeof PARTS)[number]}_${'c' | 'n' | 'r'}` | 'mold', Tex>;

export interface ThemeLook {
  /** Реальний розмір одного повтору текстури, м. */
  scale: { wall: number; low: number; floor: number; ceil: number };
  /** Колір фарби (sRGB) для верхньої частини стін і панелі знизу; null — лишити справжній колір текстури. */
  paint: { wall: [number, number, number] | null; low: [number, number, number] | null };
  /** Висота панелі, м. */
  paintH: number;
  /** Підсилення фарби для темних вихідних фактур (типово 1). */
  gain?: { wall?: number; low?: number };
}

export async function loadThemeTextures(a: Assets, dir: string): Promise<ThemeTextures> {
  const names = PARTS.flatMap((p) => (['c', 'n', 'r'] as const).map((k) => `${p}_${k}` as const));
  const list = await Promise.all([...names.map((n) => a.texture(`assets/tex/${dir}/${n}.ktx2`)), a.texture('assets/tex/level0/mold.ktx2')]);
  const out = {} as ThemeTextures;
  [...names, 'mold' as const].forEach((n, i) => {
    const t = list[i] as Tex;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 16;
    if (n.endsWith('_c')) t.colorSpace = THREE.SRGBColorSpace;
    out[n] = t;
  });
  return out;
}

const srgb = (c: [number, number, number]) => { const k = new THREE.Color().setRGB(...c, THREE.SRGBColorSpace); return vec3(k.r, k.g, k.b); };

export function makeThemeMaterials(t: ThemeTextures, look: ThemeLook) {
  const mask = (p: THREE.Node<'vec2'>, k: number, off: number) => texture(t.mold, p.mul(k).add(off)).r;
  const gp = vec2(positionWorld.x.add(positionWorld.z), positionWorld.y);
  // фарба поверх справжньої фактури: яскравість текстури × колір фарби (фактура, тріщини й плями лишаються)
  const repaint = (c: THREE.Node<'vec3'>, paint: [number, number, number] | null, gain = 1) =>
    paint ? srgb(paint).mul(dot(c, vec3(0.299, 0.587, 0.114)).mul(2.0 * gain)) : c;
  const aged = (c: THREE.Node<'vec3'>) => {
    // підтьоки сирості й кіптява під стелею
    const wet = smoothstep(0.5, 0.85, mask(gp, 0.1, 0.0).oneMinus());
    const top = smoothstep(look.paintH + 0.6, 3.2, positionWorld.y).mul(0.3);
    return mix(c, c.mul(vec3(0.55, 0.52, 0.45)), wet.mul(0.5).add(top));
  };
  const wallColor = Fn(() => aged(repaint(texture(t.wall_c, uv(0).div(look.scale.wall)).rgb, look.paint.wall, look.gain?.wall)));
  const lowColor = Fn(() => {
    const c = repaint(texture(t.low_c, uv(0).div(look.scale.low)).rgb, look.paint.low, look.gain?.low);
    // панель знизу затерта й обдерта біля підлоги
    return aged(c.mul(float(1).sub(smoothstep(0.4, 0.0, positionWorld.y).mul(0.25))));
  });
  const floorUV = positionWorld.xz.div(look.scale.floor);
  const floorColor = Fn(() => {
    const c = texture(t.floor_c, floorUV).rgb;
    const damp = smoothstep(0.42, 0.8, mask(positionWorld.xz, 0.05, 0.3).oneMinus());
    return mix(c, c.mul(0.55), damp.mul(0.6));
  });
  const ceilUV = positionWorld.xz.div(look.scale.ceil);

  return (lm: Tex) => {
    const lmNode = decodeLightmap(lm);
    const surf = (color: THREE.Node<'vec3'>, n: Tex, r: Tex, uvn: THREE.Node<'vec2'>, ns: number, rough: [number, number]) => {
      const m = new BakedMaterial();
      m.colorNode = color;
      m.normalNode = normalMap(texture(n, uvn), vec2(ns));
      m.roughnessNode = texture(r, uvn).r.mul(rough[1] - rough[0]).add(rough[0]);
      m.metalness = 0;
      m.lmNode = lmNode;
      return m;
    };
    const kit = (c: [number, number, number], rough: number, metal = 0) => {
      const m = new BakedMaterial();
      m.color = new THREE.Color().setRGB(...c, THREE.SRGBColorSpace); m.roughness = rough; m.metalness = metal; m.lmNode = lmNode;
      return m;
    };
    const wall = surf(wallColor(), t.wall_n, t.wall_r, uv(0).div(look.scale.wall), 0.9, [0.6, 0.95]);
    const wallLow = surf(lowColor(), t.low_n, t.low_r, uv(0).div(look.scale.low), 0.9, [0.35, 0.75]);
    const floor = surf(floorColor(), t.floor_n, t.floor_r, floorUV, 1.0, [0.3, 0.85]);
    const ceil = surf(texture(t.ceil_c, ceilUV).rgb, t.ceil_n, t.ceil_r, ceilUV, 0.8, [0.7, 0.95]);
    return {
      wall, wallLow, floor, ceil, base: kit([0.1, 0.1, 0.1], 0.6),
      tbar: kit([0.6, 0.6, 0.58], 0.45, 0.3), plenum: kit([0.025, 0.022, 0.02], 0.95),
      plastic: kit([0.7, 0.68, 0.6], 0.38), metal: kit([0.4, 0.42, 0.4], 0.5, 0.4), frame: kit([0.3, 0.33, 0.3], 0.55, 0.2)
    } as Record<string, THREE.Material>;
  };
}
