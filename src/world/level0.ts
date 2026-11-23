// Рівень 0 «Бесконечный НИИ»: геометрія й запечене світло з Blender (шматки 12×12 м), матеріали TSL,
// лампи, колізії Rapier зі спільного планування, атмосфера (серпанок, ліхтарик, гул ламп).
import * as THREE from 'three/webgpu';
import { Fn, length, exp, smoothstep, sin, mix, vec3, float } from 'three/tsl';
import type { Assets } from '../assets/loader';
import type { Physics } from '../physics/physics';
import { KNOCKABLE } from '../physics/knock';
import { generateLayout, type Layout } from './layout';
import { loadLevel0Textures, probeLit, probeAt, setProbeModel } from './materials';
import { makeNiiMaterials } from './nii-materials';
import { Lamps } from './lamps';
import { Seam } from './seam';
import { decorate, type Decor } from './decor';
import { buildDecals } from './decals';
import { Doors } from './doors';
import { loadChunks, addLayoutColliders } from './chunks';
import { buildNiiDetails } from './nii-details';
import type { Water } from './water';

export const LEVEL0_SEED = 1987;

export interface PropSpot { id: string; x: number; y: number; z: number }

export interface Level {
  /** Номер рівня (0 — «Бесконечный НИИ», 1 — «Глубина-1», 2 — Парковка). */
  id: number;
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
  /** Куди веде головний Шов; прихований розлом (лише рівень 0) — на рівень 2. */
  next: number;
  rift?: Seam;
  /** Рупори гучного зв'язку (рівень 0) — звідки звучать «объявления». */
  speakers?: { x: number; y: number; z: number }[];
  /** Що висить на стінах і читається (графік чергувань, Доска почёта). */
  boards?: { id: string; x: number; y: number; z: number; yaw: number }[];
  /** Вода (басейн): чаші й калюжі. */
  water?: Water;
  update(t: number, dt: number, camera: THREE.Camera): void;
}

export async function buildLevel0(assets: Assets, physics: Physics, onProgress: (p: number) => void): Promise<Level> {
  const layout = generateLayout({ seed: LEVEL0_SEED, preset: 'nii' });
  // освітленість речей — з урахуванням стін, підігнана під запечене світло цього планування
  setProbeModel(layout.lights, { walls: layout.walls, a: 1.675, s: 3, b: 0.17, leak: 0.1 });
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  // глибина: далекий кінець коридору тоне в темряві (не в світлому мареві — воно робило кадр пласким)
  scene.fog = new THREE.FogExp2(new THREE.Color().setRGB(0.045, 0.048, 0.045, THREE.SRGBColorSpace), 0.03);

  const tex = await loadLevel0Textures(assets);
  onProgress(0.2);
  await loadChunks(assets, 'level0', scene, makeNiiMaterials(tex, layout), (p) => onProgress(0.2 + 0.7 * p));
  addLayoutColliders(physics, layout);
  const H = layout.height;

  const lamps = new Lamps(layout.lights, H);
  scene.add(lamps.mesh, lamps.frame);

  const flashlight = addFlashlight(scene);
  // «Шов» — на найближчій до виходу стіні
  const decor = decorate(layout);
  const seamAt = seamPlacement(layout, layout.exit.x, layout.exit.z, decor);
  const seam = new Seam(seamAt.x, seamAt.z, seamAt.yaw, H);
  scene.add(seam.group);

  // сліди часу: підтьоки, бруд, плями (атлас справжніх декалей, змішування множенням)
  scene.add(buildDecals(layout, decor, tex.decals));
  // двері НИИ: полотна під лаком «під горіх», потемнілі (колір множиться на справжню текстуру фанери)
  const doors = new Doors(layout, decor, physics, tex, { color: 0x9a6c46, roughness: 0.42 });
  scene.add(doors.group);

  // Шов прибуття: сьома експедиція проходить туди ж, куди й шість попередніх. Гравець отямлюється на підлозі
  // спиною до стіни, крізь яку випав, і за кілька секунд розріз за ним затягується — дороги назад немає.
  const arrivalAt = seamPlacement(layout, layout.spawn.x, layout.spawn.z, decor);
  const ny = arrivalAt.yaw, nx = Math.sin(ny), nz = Math.cos(ny);
  const [ax, az] = freeNear(layout, arrivalAt.x + nx * 1.25, arrivalAt.z + nz * 1.25, 0.4);
  layout.spawn.x = ax; layout.spawn.z = az; layout.spawn.yaw = ny + Math.PI;
  const arrival = new Seam(arrivalAt.x, arrivalAt.z, arrivalAt.yaw, H);
  arrival.life.value = 0;
  scene.add(arrival.group);

  // прихований розлом у найтемнішій глухій зоні: тьмяний, ледь живий — веде одразу на парковку (рівень 2)
  const riftP = layout.points.rift ?? layout.exit;
  const riftAt = seamPlacement(layout, riftP.x, riftP.z, decor);
  const rift = new Seam(riftAt.x, riftAt.z, riftAt.yaw, H);
  rift.life.value = 0.4;
  // лампи довкола розлому мертві: щоб його знайти, треба зайти в темряву з ліхтариком
  lamps.dimAround(riftAt.x, riftAt.z, 5.5, 0);
  scene.add(rift.group);

  // наочна агітація, таблички, рупори — не на Швах
  const details = await buildNiiDetails(layout, decor, [seamAt, arrivalAt, riftAt]);
  scene.add(details.group);

  const spots = await placeProps(assets, physics, layout, scene);
  onProgress(1);

  return {
    id: 0, next: 1, scene, layout, lamps, flashlight, seam, arrival, rift, spots, doors, speakers: details.speakers, boards: details.boards,
    update(t, dt) { lamps.update(t); seam.update(t); arrival.update(t); rift.update(t); doors.update(dt); }
  };
}

/** Ліхтарик гравця (тепла лампа розжарювання, м'яка пляма, тінь) + розсіяне світло відбивача і слабке заповнення. */
export function addFlashlight(scene: THREE.Scene, ambient = 0x2a2412): THREE.SpotLight {
  const flashlight = new THREE.SpotLight(0xffe2b8, 0, 28, 0.46, 0.55, 2);
  flashlight.castShadow = true;
  // профіль променя старого ліхтарика з параболічним відбивачем (а не рівний диск): гаряча пляма в центрі,
  // світле кільце-каустика від відбивача, ледь помітні концентричні нерівності скла й тепліший, тьмяніший ореол.
  // lc — координати в конусі (0..1); r = 0 у центрі, 1 на краю конуса.
  // (colorNode має бути Fn TSL — three викликає його з координатами й бере getCacheKey)
  (flashlight as unknown as { colorNode: unknown }).colorNode = Fn(([lc]: [THREE.Node<'vec3'>]) => {
    const r = length(lc.xy.sub(0.5)).mul(2);
    const hot = exp(r.div(0.2).pow(2).negate()).mul(0.62);
    const ring = exp(r.sub(0.36).div(0.075).pow(2).negate()).mul(0.2);
    const halo = float(1).sub(smoothstep(0.25, 1.0, r)).mul(0.3);
    const ripple = sin(r.mul(71)).mul(0.035).mul(float(1).sub(smoothstep(0.1, 0.75, r))).add(1);
    const k = hot.add(ring).add(halo).mul(ripple);
    // до краю світло тепліше (скло й відбивач «з'їдають» синє)
    return mix(vec3(1.0, 0.86, 0.66), vec3(1.0, 1.0, 1.0), float(1).sub(smoothstep(0.1, 0.7, r))).mul(k).mul(1.45);
  });
  flashlight.shadow.mapSize.set(1024, 1024);
  flashlight.shadow.bias = -0.0004;
  flashlight.shadow.camera.near = 0.1;
  // тінь лише в радіусі 15 м (далі світло ліхтарика ледь помітне в тумані): у тіньовий прохід не потрапляє пів рівня.
  // three ставить far = light.distance (28 м — для спаду світла), тож обмежуємо після нього.
  const upd = flashlight.shadow.updateMatrices.bind(flashlight.shadow);
  flashlight.shadow.updateMatrices = (light) => {
    upd(light);
    const cam = flashlight.shadow.camera as THREE.PerspectiveCamera;
    if (cam.far !== 15) { cam.far = 15; cam.updateProjectionMatrix(); }
  };
  scene.add(flashlight, flashlight.target);
  const spill = new THREE.SpotLight(0xffd9a8, 0, 18, 0.95, 1.0, 2);
  flashlight.add(spill);
  spill.target = flashlight.target;
  // відбите світло: пляма ліхтарика освітлює кімнату довкола себе (дешева підробка GI — точкове світло без тіні
  // трохи перед місцем, куди влучив промінь; гра ставить його щокадру, див. game.ts)
  const bounce = new THREE.PointLight(0xffd6a6, 0, 7, 2);
  bounce.name = 'flash-bounce';
  scene.add(bounce);
  flashlight.userData.bounce = bounce;
  scene.add(new THREE.AmbientLight(ambient, 0.25));
  return flashlight;
}

/** Замінити матеріали моделі на «освітлені зондом» і ввімкнути тіні від ліхтарика. */
export function lightProp(o: THREE.Object3D, E: number): void {
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
export function freeNear(l: Layout, x: number, z: number, r: number): [number, number] {
  for (let rad = 0; rad < 8; rad += 0.3) {
    for (let a = 0; a < Math.PI * 2; a += 0.4) {
      const px = x + Math.cos(a) * rad, pz = z + Math.sin(a) * rad;
      if (isFree(l, px, pz, r)) return [px, pz];
    }
  }
  return [x, z];
}

/** Точка на найближчій до (ex, ez) стіні й поворот грані, що дивиться на цю точку. */
export function seamPlacement(l: Layout, ex: number, ez: number, avoid: Decor[] = []): { x: number; z: number; yaw: number } {
  let best = { d: 1e9, x: ex, z: ez, yaw: 0 };
  // не на дверному прорізі й не впритул до щитка/дверей (кіт вирізає там стіну — Шов висів би в повітрі)
  const blocked = (x: number, z: number) => avoid.some((o) => (o.t === 'door' || o.t === 'panel') && Math.hypot(o.x - x, o.z - z) < o.w / 2 + 0.75);
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
    if (blocked(sx, sz)) continue;
    best = { d, x: sx, z: sz, yaw };
  }
  return best;
}

interface PropDef { file: string; x: number; z: number; yaw: number; y?: number; collide?: boolean; fixed?: boolean }

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
    { file: 'desk', x: dx, z: dz, yaw, collide: true, fixed: true }, // на ньому наказ і «Инструкция» — стоїть, як стояв
    { file: 'chair', ...rel(0.15, 0.75), yaw: yaw + Math.PI + 0.35, collide: true },
    { file: 'box', ...rel(1.15, -0.15), yaw: yaw + 0.4, collide: true },
    { file: 'ammo', ...rel(-1.05, 0.2), yaw: yaw - 0.3, collide: true }
  ];
  const note = l.points.note1 ?? sp;
  const [nx, nz] = freeNear(l, note.x, note.z, 0.5);
  const [wx, wz] = freeNear(l, note.x + 0.9, note.z + 0.6, 0.45);
  // відро прибиральниці біля записки (жовтий пластиковий знак «мокра підлога» — не СРСР 70-х)
  defs.push({ file: 'wooden-bucket-01', x: wx, z: wz, yaw: 1.1, collide: true });
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
    const k = KNOCKABLE[d.file];
    if (d.collide && k && !d.fixed && physics.knock) {
      // стілець, ящик, відро — можна зачепити й перекинути
      physics.knock.add(d.file, (w) => { w.decompose(o.position, o.quaternion, o.scale); }, o.matrixWorld.clone(), g.scene);
    } else if (d.collide) {
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
  // «Инструкция оператору» — тонка брошура поруч із планшетом (підпис оператора в ній уже стоїть)
  {
    const q = rel(-0.62, -0.1);
    const ins = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.004, 0.21), probeLit(new THREE.MeshStandardMaterial({ color: 0xcfc6a6, roughness: 0.9 }), probeAt(l.lights, dx, dz)));
    ins.position.set(q.x, deskTop + 0.003, q.z);
    ins.rotation.y = yaw - 0.25;
    ins.castShadow = true; ins.receiveShadow = true;
    scene.add(ins);
    spots.instr = { id: 'instr', x: q.x, y: deskTop + 0.02, z: q.z };
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
