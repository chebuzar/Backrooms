// Рівень 0 «Жёлтые комнаты»: геометрія й запечене світло з Blender (шматки 12×12 м), матеріали TSL,
// лампи, колізії Rapier зі спільного планування, атмосфера (серпанок, ліхтарик, гул ламп).
import * as THREE from 'three/webgpu';
import type { Assets } from '../assets/loader';
import type { Physics } from '../physics/physics';
import { generateLayout, type Layout } from './layout';
import { loadLevel0Textures, makeLevel0Materials, probeLit, probeAt } from './materials';
import { Lamps } from './lamps';
import { Seam } from './seam';
import { decorate } from './decor';
import { buildDecals } from './decals';
import { Doors } from './doors';

export const LEVEL0_SEED = 1987;

interface Manifest { chunk: number; nx: number; nz: number; height: number; chunks: { x: number; z: number; glb: string; lm: string }[] }

export interface PropSpot { id: string; x: number; y: number; z: number }

export interface Level {
  scene: THREE.Scene;
  layout: Layout;
  lamps: Lamps;
  seam: Seam;
  /** Шов, крізь який гравець щойно прийшов (затягується на початку гри). */
  arrival: Seam;
  flashlight: THREE.SpotLight;
  /** Місця сюжетних предметів (центр, на який дивитися). */
  spots: Record<string, PropSpot>;
  doors: Doors;
  update(t: number, dt: number, camera: THREE.Camera): void;
}

export async function buildLevel0(assets: Assets, physics: Physics, onProgress: (p: number) => void): Promise<Level> {
  const layout = generateLayout({ seed: LEVEL0_SEED });
  const base = `${import.meta.env.BASE_URL}assets/levels/level0/`;
  const manifest = (await (await fetch(`${base}manifest.json`)).json()) as Manifest;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  // теплий серпанок: далекі кімнати тонуть у жовтому мареві
  scene.fog = new THREE.FogExp2(new THREE.Color().setRGB(0.42, 0.36, 0.17, THREE.SRGBColorSpace), 0.03);

  const tex = await loadLevel0Textures(assets);
  onProgress(0.2);
  const materialsFor = makeLevel0Materials(tex);
  const lmLoader = new THREE.TextureLoader();
  let done = 0;
  await Promise.all(manifest.chunks.map(async (c) => {
    const lmPromise = c.lm.endsWith('.ktx2') ? assets.texture(`assets/levels/level0/${c.lm}`) : lmLoader.loadAsync(base + c.lm);
    const [gltf, lm] = await Promise.all([assets.model(`assets/levels/level0/${c.glb}`), lmPromise]);
    lm.colorSpace = THREE.NoColorSpace;
    lm.flipY = false;
    if (!c.lm.endsWith('.ktx2')) { lm.generateMipmaps = true; lm.minFilter = THREE.LinearMipmapLinearFilter; }
    const mats = materialsFor(lm);
    gltf.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const name = (mesh.material as THREE.Material).name;
      mesh.material = (mats[name] ?? mats.wall) as THREE.Material;
      mesh.receiveShadow = true;
      mesh.castShadow = true;
    });
    scene.add(gltf.scene);
    onProgress(0.2 + 0.7 * (++done / manifest.chunks.length));
  }));

  // колізії: підлога, стеля, стіни, колони
  const W = layout.cols * layout.cell, D = layout.rows * layout.cell, H = layout.height;
  physics.addBox(W / 2, -0.5, D / 2, W / 2 + 1, 0.5, D / 2 + 1);
  physics.addBox(W / 2, H + 0.5, D / 2, W / 2 + 1, 0.5, D / 2 + 1);
  for (const w of layout.walls) physics.addBox(w.x, H / 2, w.z, w.w / 2, H / 2, w.d / 2);
  physics.step();

  const lamps = new Lamps(layout.lights, H);
  scene.add(lamps.mesh, lamps.frame);

  // ліхтарик: тепла лампа розжарювання, м'яка пляма, тінь
  // ліхтарик: тепла лампа розжарювання; гаряча пляма з дуже м'яким краєм (без «наліпки»), реальне квадратичне згасання
  const flashlight = new THREE.SpotLight(0xffe2b8, 0, 28, 0.42, 0.92, 2);
  flashlight.castShadow = true;
  flashlight.shadow.mapSize.set(1024, 1024);
  flashlight.shadow.bias = -0.0004;
  flashlight.shadow.camera.near = 0.1;
  scene.add(flashlight, flashlight.target);
  // розсіяне світло навколо променя (відбивач ліхтарика) — широкий слабкий конус без тіні
  const spill = new THREE.SpotLight(0xffd9a8, 0, 18, 0.95, 1.0, 2);
  flashlight.add(spill);
  spill.target = flashlight.target;
  // ледь помітне заповнення, щоб чорні кути не були «дірами»
  scene.add(new THREE.AmbientLight(0x2a2412, 0.25));
  // «Шов» — на найближчій до виходу стіні
  const seamAt = seamPlacement(layout, layout.exit.x, layout.exit.z);
  const seam = new Seam(seamAt.x, seamAt.z, seamAt.yaw, H);
  scene.add(seam.group);

  // сліди часу: підтьоки, бруд, плями (атлас справжніх декалей, змішування множенням)
  const decor = decorate(layout);
  scene.add(buildDecals(layout, decor, tex.decals));
  const doors = new Doors(layout, decor, physics, tex);
  scene.add(doors.group);

  // Шов прибуття: сьома експедиція проходить туди ж, куди й шість попередніх. Гравець отямлюється на підлозі
  // спиною до стіни, крізь яку випав, і за кілька секунд розріз за ним затягується — дороги назад немає.
  const arrivalAt = seamPlacement(layout, layout.spawn.x, layout.spawn.z);
  const ny = arrivalAt.yaw, nx = Math.sin(ny), nz = Math.cos(ny);
  const [ax, az] = freeNear(layout, arrivalAt.x + nx * 1.25, arrivalAt.z + nz * 1.25, 0.4);
  layout.spawn.x = ax; layout.spawn.z = az; layout.spawn.yaw = ny + Math.PI;
  const arrival = new Seam(arrivalAt.x, arrivalAt.z, arrivalAt.yaw, H);
  arrival.life.value = 0;
  scene.add(arrival.group);

  const spots = await placeProps(assets, physics, layout, scene);
  onProgress(1);

  return {
    scene, layout, lamps, flashlight, seam, arrival, spots, doors,
    update(t, dt) { lamps.update(t); seam.update(t); arrival.update(t); doors.update(dt); }
  };
}

/** Замінити матеріали моделі на «освітлені зондом» і ввімкнути тіні від ліхтарика. */
function lightProp(o: THREE.Object3D, E: number): void {
  const cache = new Map<THREE.Material, THREE.Material>();
  o.traverse((m) => {
    const mm = m as THREE.Mesh;
    if (!mm.isMesh) return;
    mm.castShadow = true; mm.receiveShadow = true;
    const src = mm.material as THREE.Material;
    let nm = cache.get(src);
    if (!nm) { nm = probeLit(src, E); cache.set(src, nm); }
    mm.material = nm;
  });
}

/** Чи вільне місце від стін (з запасом r). */
function isFree(l: Layout, x: number, z: number, r: number): boolean {
  if (x < r || z < r || x > l.cols * l.cell - r || z > l.rows * l.cell - r) return false;
  return !l.walls.some((w) => Math.abs(x - w.x) < w.w / 2 + r && Math.abs(z - w.z) < w.d / 2 + r);
}

/** Найближче вільне місце по спіралі від точки. */
function freeNear(l: Layout, x: number, z: number, r: number): [number, number] {
  for (let rad = 0; rad < 8; rad += 0.3) {
    for (let a = 0; a < Math.PI * 2; a += 0.4) {
      const px = x + Math.cos(a) * rad, pz = z + Math.sin(a) * rad;
      if (isFree(l, px, pz, r)) return [px, pz];
    }
  }
  return [x, z];
}

/** Точка на найближчій до (ex, ez) стіні й поворот грані, що дивиться на цю точку. */
function seamPlacement(l: Layout, ex: number, ez: number): { x: number; z: number; yaw: number } {
  let best = { d: 1e9, x: ex, z: ez, yaw: 0 };
  for (const w of l.walls) {
    if (w.kind === 'pillar') continue;
    const long = Math.max(w.w, w.d);
    if (long < 1.2) continue;
    // найближча точка на прямокутнику стіни і грань, що дивиться на вихід
    const cx = Math.max(w.x - w.w / 2, Math.min(ex, w.x + w.w / 2)), cz = Math.max(w.z - w.d / 2, Math.min(ez, w.z + w.d / 2));
    const d = Math.hypot(ex - cx, ez - cz);
    if (d >= best.d) continue;
    const alongX = w.w >= w.d;
    const sx = alongX ? Math.max(w.x - w.w / 2 + 0.5, Math.min(ex, w.x + w.w / 2 - 0.5)) : w.x + Math.sign(ex - w.x || 1) * (w.w / 2 + 0.035);
    const sz = alongX ? w.z + Math.sign(ez - w.z || 1) * (w.d / 2 + 0.035) : Math.max(w.z - w.d / 2 + 0.5, Math.min(ez, w.z + w.d / 2 - 0.5));
    const yaw = alongX ? (ez > w.z ? 0 : Math.PI) : (ex > w.x ? Math.PI / 2 : -Math.PI / 2);
    best = { d, x: sx, z: sz, yaw };
  }
  return best;
}

interface PropDef { file: string; x: number; z: number; yaw: number; y?: number; collide?: boolean }

/** Сюжетні предмети: стіл експедиції біля старту, планшет із наказом, речі, записка. */
async function placeProps(assets: Assets, physics: Physics, l: Layout, scene: THREE.Scene): Promise<Record<string, PropSpot>> {
  const sp = l.spawn;
  // стіл — за 1.9 м перед гравцем (вперед = (−sin yaw, −cos yaw)), у вільному місці; повернутий до гравця
  const fx = -Math.sin(sp.yaw), fz = -Math.cos(sp.yaw);
  const [dx, dz] = freeNear(l, sp.x + fx * 1.9, sp.z + fz * 1.9, 0.9);
  const yaw = sp.yaw;
  // зсув у системі стола → світові координати
  const rel = (lx: number, lz: number) => ({ x: dx + lx * Math.cos(yaw) + lz * Math.sin(yaw), z: dz - lx * Math.sin(yaw) + lz * Math.cos(yaw) });
  const defs: PropDef[] = [
    { file: 'desk', x: dx, z: dz, yaw, collide: true },
    { file: 'chair', ...rel(0.15, 0.75), yaw: yaw + Math.PI + 0.35, collide: true },
    { file: 'box', ...rel(1.15, -0.15), yaw: yaw + 0.4, collide: true },
    { file: 'ammo', ...rel(-1.05, 0.2), yaw: yaw - 0.3, collide: true }
  ];
  const note = l.points.note1 ?? sp;
  const [nx, nz] = freeNear(l, note.x, note.z, 0.5);
  const [wx, wz] = freeNear(l, note.x + 0.9, note.z + 0.6, 0.45);
  defs.push({ file: 'wetsign', x: wx, z: wz, yaw: 1.1, collide: true });
  const spots: Record<string, PropSpot> = {};
  let deskTop = 0.76;
  for (const d of defs) {
    const g = await assets.model(`assets/models/${d.file}.glb`);
    const o = g.scene.clone(true);
    o.position.set(d.x, d.y ?? 0, d.z);
    o.rotation.y = d.yaw;
    lightProp(o, probeAt(l.lights, d.x, d.z));
    scene.add(o);
    o.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(o);
    if (d.file === 'desk') deskTop = box.max.y;
    if (d.collide) {
      const c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3());
      physics.addBox(c.x, c.y, c.z, Math.max(0.05, s.x / 2 - 0.02), s.y / 2, Math.max(0.05, s.z / 2 - 0.02), 0, 1 << 3);
    }
  }
  // планшет із наказом і пачка цигарок — на стільниці
  for (const [file, ox, oz, ry] of [['clipboard', -0.15, 0.05, 0.2], ['cigs', 0.42, -0.12, 1.2]] as const) {
    const g = await assets.model(`assets/models/${file}.glb`);
    const o = g.scene.clone(true);
    const q = rel(ox, oz);
    o.position.set(q.x, deskTop + 0.002, q.z);
    o.rotation.y = yaw + ry;
    lightProp(o, probeAt(l.lights, dx, dz));
    scene.add(o);
    if (file === 'clipboard') spots.order7 = { id: 'order7', x: q.x, y: deskTop + 0.02, z: q.z };
  }
  // записка — аркуш на підлозі
  const paper = new THREE.Mesh(new THREE.PlaneGeometry(0.21, 0.297), probeLit(new THREE.MeshStandardMaterial({ color: 0xd9d4bf, roughness: 0.95 }), probeAt(l.lights, nx, nz)));
  paper.rotation.set(-Math.PI / 2, 0, 0.7);
  paper.position.set(nx, 0.004, nz);
  paper.receiveShadow = true;
  scene.add(paper);
  spots.note1 = { id: 'note1', x: nx, y: 0.02, z: nz };
  physics.step();
  return spots;
}
