// Рівні 1–4 за Швами: база «Глубина-1» (бетон, зелена панель, лампи денного світла), підземна парковка (натрієві лампи,
// половина не світить), дитсадок «Золотой ключик» (панель, лінолеум, плафони-кулі, темні спальні) і басейн «Лазурный»
// (кахель, чаші з водою, калюжі). Та сама будова, що й у рівня 0: шматки з Blender із запеченим світлом, двері, плями,
// Шов прибуття за спиною і Шов далі.
import * as THREE from 'three/webgpu';
import type { Assets } from '../assets/loader';
import type { Physics } from '../physics/physics';
import { generateLayout } from './layout';
import { probeAt } from './materials';
import { loadThemeTextures, makeThemeMaterials, type ThemeLook } from './theme-materials';
import { Lamps } from './lamps';
import { Seam } from './seam';
import { decorate } from './decor';
import { buildDecals } from './decals';
import { Doors } from './doors';
import { loadChunks, addLayoutColliders } from './chunks';
import { addFlashlight, freeNear, lightProp, seamPlacement, type Level, type PropSpot } from './level0';
import { Water } from './water';

interface ThemedDef {
  seed: number; preset: 'base' | 'parking' | 'kinder' | 'pool'; dir: string; next: number; doc: string;
  fog: [number, number, number]; fogDensity: number; ambient: number; look: ThemeLook;
}

export type ThemedId = 1 | 2 | 3 | 4;

export const THEMED: Record<ThemedId, ThemedDef> = {
  1: {
    seed: 77, preset: 'base', dir: 'level1', next: 2, doc: 'protocol', fog: [0.16, 0.19, 0.18], fogDensity: 0.035, ambient: 0x1a2220,
    look: { scale: { wall: 2.0, low: 2.0, floor: 2.0, ceil: 2.5 }, paint: { wall: [0.62, 0.62, 0.57], low: [0.36, 0.58, 0.42] }, paintH: 1.5 }
    // панель — світліша «казенна» зелень (17.11: була майже чорна)
  },
  2: {
    seed: 12, preset: 'parking', dir: 'level2', next: 3, doc: 'spravka', fog: [0.2, 0.15, 0.1], fogDensity: 0.04, ambient: 0x1e1810,
    look: { scale: { wall: 2.5, low: 2.0, floor: 3.0, ceil: 2.5 }, paint: { wall: null, low: [0.33, 0.37, 0.42] }, paintH: 1.1 }
  },
  // дитсадок: кремова побілка, блідо-бірюзова олійна панель, лінолеум 70-х; теплий серпанок
  3: {
    seed: 3, preset: 'kinder', dir: 'level3', next: 4, doc: 'opis', fog: [0.17, 0.14, 0.11], fogDensity: 0.045, ambient: 0x1e1a14,
    look: { scale: { wall: 2.0, low: 2.0, floor: 1.6, ceil: 2.5 }, paint: { wall: [0.8, 0.74, 0.6], low: [0.42, 0.6, 0.58] }, paintH: 1.5, gain: { low: 2.3 } }
  },
  // басейн: бірюзова мозаїка, синя кахельна смуга, сіра протиковзка плитка; холодний вологий серпанок
  4: {
    seed: 4, preset: 'pool', dir: 'level4', next: 5, doc: 'lastrec', fog: [0.1, 0.15, 0.16], fogDensity: 0.04, ambient: 0x101a1c,
    look: { scale: { wall: 1.2, low: 1.2, floor: 2.0, ceil: 3.0 }, paint: { wall: [0.5, 0.68, 0.68], low: [0.22, 0.4, 0.5] }, paintH: 1.2 }
  }
};

export async function buildThemedLevel(id: ThemedId, assets: Assets, physics: Physics, onProgress: (p: number) => void, reflections = false): Promise<Level> {
  const def = THEMED[id];
  const layout = generateLayout({ seed: def.seed, preset: def.preset });
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  scene.fog = new THREE.FogExp2(new THREE.Color().setRGB(...def.fog, THREE.SRGBColorSpace), def.fogDensity);

  const [tex, decalsTex, doorC, doorN] = await Promise.all([
    loadThemeTextures(assets, def.dir), assets.texture('assets/tex/level0/decals.ktx2'),
    assets.texture('assets/tex/level0/door_c.ktx2'), assets.texture('assets/tex/level0/door_n.ktx2')
  ]);
  decalsTex.colorSpace = doorC.colorSpace = THREE.SRGBColorSpace;
  decalsTex.wrapS = decalsTex.wrapT = THREE.ClampToEdgeWrapping;
  doorC.wrapS = doorC.wrapT = doorN.wrapS = doorN.wrapT = THREE.RepeatWrapping;
  onProgress(0.2);
  await loadChunks(assets, def.dir, scene, makeThemeMaterials(tex, def.look), (p) => onProgress(0.2 + 0.7 * p));
  addLayoutColliders(physics, layout);
  const H = layout.height;

  const lamps = new Lamps(layout.lights, H, { color: layout.theme.lamp.color });
  scene.add(lamps.mesh, lamps.frame);
  const flashlight = addFlashlight(scene, def.ambient);

  const decor = decorate(layout);
  const seamAt = seamPlacement(layout, layout.exit.x, layout.exit.z, decor);
  const seam = new Seam(seamAt.x, seamAt.z, seamAt.yaw, H);
  scene.add(seam.group);
  // Шов прибуття за спиною (затягується, як і на рівні 0)
  const arrivalAt = seamPlacement(layout, layout.spawn.x, layout.spawn.z, decor);
  const ny = arrivalAt.yaw;
  const [ax, az] = freeNear(layout, arrivalAt.x + Math.sin(ny) * 1.25, arrivalAt.z + Math.cos(ny) * 1.25, 0.4);
  layout.spawn.x = ax; layout.spawn.z = az; layout.spawn.yaw = ny + Math.PI;
  const arrival = new Seam(arrivalAt.x, arrivalAt.z, arrivalAt.yaw, H);
  arrival.life.value = 0;
  scene.add(arrival.group);

  scene.add(buildDecals(layout, decor, decalsTex));
  const doors = new Doors(layout, decor, physics, { door_c: doorC, door_n: doorN });
  scene.add(doors.group);

  const spots = await placeDoc(assets, physics, layout, scene, def.doc);
  let water: Water | undefined;
  if (layout.pools.length || layout.puddles.length) {
    const mold = await assets.texture('assets/tex/level0/mold.ktx2');
    water = new Water(layout, mold, new THREE.Color().setRGB(...def.fog, THREE.SRGBColorSpace), reflections);
    scene.add(water.group);
  }
  onProgress(1);
  return {
    id, next: def.next, scene, layout, lamps, flashlight, seam, arrival, spots, doors, water,
    update(t, dt) { lamps.update(t); seam.update(t); arrival.update(t); doors.update(dt); }
  };
}

/** Документ рівня: ящик (склад попередніх експедицій) із планшетом згори — на сюжетній точці. */
async function placeDoc(assets: Assets, physics: Physics, l: ReturnType<typeof generateLayout>, scene: THREE.Scene, doc: string): Promise<Record<string, PropSpot>> {
  const p = l.points.note1 ?? l.spawn;
  const [x, z] = freeNear(l, p.x, p.z, 0.6);
  const box = (await assets.model('assets/models/box.glb')).scene.clone(true);
  box.position.set(x, 0, z); box.rotation.y = 0.5;
  lightProp(box, probeAt(l.lights, x, z));
  scene.add(box);
  box.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(box);
  const c = bb.getCenter(new THREE.Vector3()), s = bb.getSize(new THREE.Vector3());
  physics.addBox(c.x, c.y, c.z, s.x / 2, s.y / 2, s.z / 2, 0, 1 << 3);
  const clip = (await assets.model('assets/models/clipboard.glb')).scene.clone(true);
  clip.position.set(x, bb.max.y + 0.002, z); clip.rotation.y = 0.9;
  lightProp(clip, probeAt(l.lights, x, z));
  scene.add(clip);
  physics.step();
  return { [doc]: { id: doc, x, y: bb.max.y + 0.02, z } };
}
