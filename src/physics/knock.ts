// Рухомі речі рівня (Назар 23.11: «повноцінна фізика, прямо топ»): стільці, столи, лавки, лампи, книги, папери,
// відра, каністри, ящики — справжні динамічні тіла Rapier. Гравець штовхає їх капсулою, бере в руки (carry.ts),
// кидає; монстр збиває на бігу; скло б'ється. Удари чути — і їх чує монстр.
// Форма тіла — за самою моделлю: опукла оболонка вершин (стілець перекидається, як стілець, а не як коробка),
// стіл — стільниця на чотирьох ніжках (під нього закочується м'яч). Сітки лишаються в InstancedMesh-ах обстановки:
// тіло переписує матрицю свого інстанса й освітленість, коли річ перенесли в інше місце.
// Поки ніхто не чіпав — тіло спить (нуль витрат, жодного «тремтіння» на старті рівня).
import * as THREE from 'three/webgpu';
import type RAPIER from '@dimforge/rapier3d-compat';
import { G, groups, type Physics } from './physics';

export type KnockKind = 'wood' | 'metal' | 'soft' | 'paper' | 'glass';
export type PropShape = 'hull' | 'box' | 'table';

export interface PropSpec {
  /** Маса, кг. */
  mass: number;
  /** З чого зроблено (який звук удару). */
  kind: KnockKind;
  shape?: PropShape;
  /** Має скло (лампа, плафон): від сильного удару воно б'ється на друзки, а сама річ лишається. */
  fragile?: boolean;
}

/** Що з обстановки рухоме. Великі шафи, ліжка, машини, дошки — нерухомі (прикручені, сотні кілограмів). */
export const KNOCKABLE: Record<string, PropSpec> = {
  chair: { mass: 6, kind: 'wood', shape: 'hull' },
  'painted-wooden-chair-01': { mass: 5, kind: 'wood', shape: 'hull' },
  'wooden-bucket-01': { mass: 3, kind: 'wood', shape: 'hull' },
  box: { mass: 3, kind: 'wood', shape: 'box' },
  jerrycan: { mass: 4, kind: 'metal', shape: 'box' },
  ammo: { mass: 6, kind: 'metal', shape: 'box' },
  'dirty-football': { mass: 0.45, kind: 'soft', shape: 'hull' },
  'rubber-duck-toy': { mass: 0.15, kind: 'soft', shape: 'hull' },
  lifebuoy: { mass: 2, kind: 'soft', shape: 'hull' },
  'desk-lamp': { mass: 1.8, kind: 'metal', shape: 'hull', fragile: true },
  microscope: { mass: 3.5, kind: 'metal', shape: 'hull' },
  notepads: { mass: 0.5, kind: 'paper', shape: 'box' },
  books: { mass: 4, kind: 'paper', shape: 'box' },
  // меблі: важкі, руками не підняти, але штовхаються (металевий стіл — ледве)
  'school-desk': { mass: 16, kind: 'wood', shape: 'table' },
  'painted-wooden-table': { mass: 18, kind: 'wood', shape: 'table' },
  'painted-wooden-bench': { mass: 12, kind: 'wood', shape: 'table' },
  desk: { mass: 38, kind: 'metal', shape: 'table' },
  mdesk: { mass: 30, kind: 'metal', shape: 'table' }
};

/** Що можна взяти в руки: до 12 кг і не більше 1.1 м завдовжки (стілець — так, стіл — ні). */
export const GRAB_MASS = 12;
export const GRAB_SIZE = 1.1;

/** Куди писати положення речі: окремий об'єкт або інстанси (по одному на кожну частину моделі). */
export type KnockView = (world: THREE.Matrix4) => void;

/** Частина речі в InstancedMesh: сітка, номер, локальна матриця частини, атрибут освітленості інстанса. */
export interface InstancePart { im: THREE.InstancedMesh; i: number; local?: THREE.Matrix4; light?: THREE.InstancedBufferAttribute }

/** Інстанси однієї речі: переписати матрицю кожної частини. */
export function instanceView(parts: InstancePart[]): KnockView {
  const tmp = new THREE.Matrix4();
  return (w) => {
    for (const p of parts) {
      p.im.setMatrixAt(p.i, p.local ? tmp.multiplyMatrices(w, p.local) : w);
      p.im.instanceMatrix.needsUpdate = true;
    }
  };
}

/** Освітленість речі (запечене світло в точці) — інстанс-атрибут кожної частини. */
export function instanceLight(parts: InstancePart[]): ((E: number) => void) | undefined {
  const ls = parts.filter((p) => p.light);
  if (!ls.length) return undefined;
  return (E) => { for (const p of ls) { p.light!.setX(p.i, E); p.light!.needsUpdate = true; } };
}

export interface PropItem {
  readonly id: number;
  readonly file: string;
  readonly spec: PropSpec;
  readonly body: RAPIER.RigidBody;
  readonly colliders: RAPIER.Collider[];
  readonly view: KnockView;
  readonly scale: THREE.Vector3;
  /** Інстанс-сітки речі: поки рухається — без відсікання, після — нова сфера відсікання. */
  readonly meshes: THREE.InstancedMesh[];
  readonly light?: (E: number) => void;
  /** Можна взяти в руки. */
  readonly grab: boolean;
  /** Найбільший розмір, м (для відстані тримання). */
  readonly size: number;
  vx: number; vy: number; vz: number;
  cd: number;
  awake: boolean;
  /** Перші миті після появи тіло «сідає» на підлогу — це не удар. */
  quiet: number;
  /** Була стояча (вісь «вгору» вертикальна) — щоб почути, як перекинулась. */
  upright: boolean;
  /** Тримають у руках. */
  held: boolean;
  /** Секунд після кидка: удари гучніші (монстр чує здалеку), лампа на стелі б'ється. */
  thrown: number;
  /** Де востаннє рахувалась освітленість. */
  lx: number; lz: number;
  /** Скло вже розбите. */
  cracked: boolean;
  /** Річ знищено (тіла більше немає). */
  broken: boolean;
}

/** Фільтр зіткнень речі: зі стінами, дверима, іншими речами, гравцем і монстрами. */
export const PROP_FILTER = G.STATIC | G.DOOR | G.PROP | G.PLAYER | G.MONSTER;

/** Точки моделі (у її власних координатах) для опуклої оболонки: не більше ~500, рівномірно. */
function modelPoints(model: THREE.Object3D): Float32Array {
  model.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(model.matrixWorld).invert(), rel = new THREE.Matrix4(), v = new THREE.Vector3();
  const pts: number[] = [];
  let total = 0;
  model.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) total += m.geometry.getAttribute('position').count; });
  const stride = Math.max(1, Math.ceil(total / 500));
  model.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    rel.multiplyMatrices(inv, m.matrixWorld);
    const a = m.geometry.getAttribute('position');
    for (let i = 0; i < a.count; i += stride) { v.fromBufferAttribute(a, i).applyMatrix4(rel); pts.push(v.x, v.y, v.z); }
  });
  return new Float32Array(pts);
}

export class Knockables {
  private items: PropItem[] = [];
  private readonly byCollider = new Map<number, PropItem>();
  private readonly shapes = new Map<string, { box: THREE.Box3; pts: Float32Array }>();
  /** Скільки рухомих речей зараз використовує сітку (поки > 0 — без відсікання). */
  private readonly awakeMesh = new Map<THREE.InstancedMesh, number>();
  private readonly m = new THREE.Matrix4();
  private readonly p = new THREE.Vector3();
  private readonly q = new THREE.Quaternion();
  private readonly up = new THREE.Vector3();
  private nextId = 1;
  /** Удар (сила 0..1) або перекидання — звук і шум для монстрів. thrown — річ кинули (шум сильніший). */
  onImpact: ((x: number, y: number, z: number, strength: number, kind: KnockKind, topple: boolean, thrown: boolean) => void) | null = null;
  /** Скло розбилось (сильний удар): гра пускає уламки й звук. */
  onBreak: ((item: PropItem, x: number, y: number, z: number, vx: number, vy: number, vz: number) => void) | null = null;
  /** Кинута річ летить (центр мас, кожна синхронізація): гра перевіряє стельові лампи. */
  onFlight: ((item: PropItem, x: number, y: number, z: number, speed: number) => void) | null = null;
  /** Запечена освітленість у точці (рівень задає при завантаженні). */
  probe: ((x: number, z: number) => number) | null = null;

  constructor(private readonly physics: Physics) {}

  /** Габарити й точки оболонки моделі (один раз на файл). */
  private shapeOf(file: string, model: THREE.Object3D): { box: THREE.Box3; pts: Float32Array } {
    let s = this.shapes.get(file);
    if (!s) {
      model.updateMatrixWorld(true);
      const inv = new THREE.Matrix4().copy(model.matrixWorld).invert();
      const box = new THREE.Box3().setFromObject(model).applyMatrix4(inv);
      s = { box, pts: modelPoints(model) };
      this.shapes.set(file, s);
    }
    return s;
  }

  /** Форма тіла в координатах моделі (масштаб s) — один або кілька коллайдерів із масами. */
  private descs(spec: PropSpec, box: THREE.Box3, pts: Float32Array, s: THREE.Vector3): { d: RAPIER.ColliderDesc; mass: number }[] {
    const R = this.physics.R;
    const c = box.getCenter(new THREE.Vector3()).multiply(s), h = box.getSize(new THREE.Vector3()).multiply(s).multiplyScalar(0.5);
    const cuboid = (cx: number, cy: number, cz: number, hx: number, hy: number, hz: number, mass: number) =>
      ({ d: R.ColliderDesc.cuboid(Math.max(0.01, hx), Math.max(0.01, hy), Math.max(0.01, hz)).setTranslation(cx, cy, cz), mass });
    if (spec.shape === 'table') {
      // стільниця (верхні 7 %, не тонша за 3 см) і чотири ніжки по кутах
      const top = Math.max(0.015, h.y * 0.07), legH = h.y - top, lx = Math.min(0.03, h.x * 0.1), lz = Math.min(0.03, h.z * 0.1);
      const out = [cuboid(c.x, c.y + h.y - top, c.z, h.x, top, h.z, spec.mass * 0.6)];
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) out.push(cuboid(c.x + sx * (h.x - lx), c.y - h.y + legH, c.z + sz * (h.z - lz), lx, legH, lz, spec.mass * 0.1));
      return out;
    }
    if (spec.shape === 'hull' && pts.length >= 12) {
      const sp = new Float32Array(pts.length);
      for (let i = 0; i < pts.length; i += 3) { sp[i] = pts[i]! * s.x; sp[i + 1] = pts[i + 1]! * s.y; sp[i + 2] = pts[i + 2]! * s.z; }
      const d = R.ColliderDesc.convexHull(sp);
      if (d) return [{ d, mass: spec.mass }];
    }
    // коробка за габаритами (трохи вужча — не чіплятись за стіни)
    return [cuboid(c.x, c.y, c.z, h.x - 0.01, h.y, h.z - 0.01, spec.mass)];
  }

  /**
   * Додати річ: file — модель (з KNOCKABLE), m — світова матриця (позиція, поворот, масштаб), model — сцена моделі
   * (форма тіла), meshes — її інстанс-сітки, light — як переписати освітленість, коли річ перенесли.
   */
  add(file: string, view: KnockView, m: THREE.Matrix4, model: THREE.Object3D, meshes: THREE.InstancedMesh[] = [], light?: (E: number) => void): PropItem | null {
    const spec = KNOCKABLE[file];
    if (!spec) return null;
    const R = this.physics.R, w = this.physics.world;
    const pos = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    m.decompose(pos, q, s);
    const { box, pts } = this.shapeOf(file, model);
    const body = w.createRigidBody(R.RigidBodyDesc.dynamic()
      .setTranslation(pos.x, pos.y, pos.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
      .setLinearDamping(0.3).setAngularDamping(0.6).setCcdEnabled(spec.mass < 8).setSleeping(true).setCanSleep(true));
    const colliders: RAPIER.Collider[] = [];
    for (const { d, mass } of this.descs(spec, box, pts, s)) {
      colliders.push(w.createCollider(d.setMass(mass).setFriction(spec.kind === 'soft' ? 0.9 : 0.6).setRestitution(spec.kind === 'soft' ? 0.45 : spec.kind === 'metal' ? 0.18 : 0.1)
        .setCollisionGroups(groups(G.PROP, PROP_FILTER)), body));
    }
    body.sleep(); // коллайдер будить тіло — присипляємо знову: стоїть, як поставили
    const size = box.getSize(new THREE.Vector3()).multiply(s);
    const item: PropItem = {
      id: this.nextId++, file, spec, body, colliders, view, scale: s, meshes, light,
      grab: spec.mass <= GRAB_MASS && Math.max(size.x, size.y, size.z) <= GRAB_SIZE, size: Math.max(size.x, size.y, size.z),
      vx: 0, vy: 0, vz: 0, cd: 0, awake: false, quiet: 0.6, upright: Math.abs(this.up.set(0, 1, 0).applyQuaternion(q).y) > 0.9,
      held: false, thrown: 0, lx: pos.x, lz: pos.z, cracked: false, broken: false
    };
    this.items.push(item);
    for (const c of colliders) this.byCollider.set(c.handle, item);
    return item;
  }

  get count(): number { return this.items.length; }
  get list(): readonly PropItem[] { return this.items; }
  /** Скільки речей зараз рухається (для тестів і профілю). */
  get moving(): number { return this.items.filter((i) => !i.body.isSleeping()).length; }
  /** Річ за коллайдером (промінь погляду влучив у неї). */
  itemOf(c: RAPIER.Collider | null | undefined): PropItem | null { return c ? this.byCollider.get(c.handle) ?? null : null; }

  private setAwake(it: PropItem, on: boolean): void {
    if (it.awake === on) return;
    it.awake = on;
    for (const im of it.meshes) {
      const n = (this.awakeMesh.get(im) ?? 0) + (on ? 1 : -1);
      if (n > 0) { this.awakeMesh.set(im, n); im.frustumCulled = false; continue; }
      this.awakeMesh.delete(im);
      im.computeBoundingSphere();
      im.frustumCulled = true;
    }
    if (!on) this.relight(it, true);
  }

  /** Перенесли далі ніж на 0.6 м — нова освітленість (річ у темному кутку темна, під лампою — світла). */
  private relight(it: PropItem, force = false): void {
    if (!it.light || !this.probe) return;
    const t = it.body.translation();
    if (!force && (t.x - it.lx) ** 2 + (t.z - it.lz) ** 2 < 0.36) return;
    it.lx = t.x; it.lz = t.z;
    it.light(this.probe(t.x, t.z));
  }

  /** Після кроків фізики: переписати матриці речей, що рухаються; почути удари. dt — скільки часу минуло. */
  sync(dt: number): void {
    for (const it of this.items) {
      if (it.broken) continue;
      const b = it.body;
      if (b.isSleeping()) { this.setAwake(it, false); continue; }
      this.setAwake(it, true);
      const t = b.translation(), r = b.rotation(), v = b.linvel();
      this.p.set(t.x, t.y, t.z); this.q.set(r.x, r.y, r.z, r.w);
      it.view(this.m.compose(this.p, this.q, it.scale));
      this.relight(it);
      // удар: різка зміна швидкості (об підлогу, стіну, іншу річ)
      const dv = Math.hypot(v.x - it.vx, v.y - it.vy, v.z - it.vz), speed = Math.hypot(v.x, v.y, v.z);
      const pvx = it.vx, pvy = it.vy, pvz = it.vz;
      it.vx = v.x; it.vy = v.y; it.vz = v.z;
      it.cd -= dt;
      if (it.thrown > 0) { it.thrown -= dt; if (speed > 1.5) { const c = b.worldCom(); this.onFlight?.(it, c.x, c.y, c.z, speed); } }
      if (it.held) continue; // у руках — не «удари», а рух руки
      if (it.quiet > 0) { it.quiet -= dt; it.upright = Math.abs(this.up.set(0, 1, 0).applyQuaternion(this.q).y) > 0.6; continue; }
      const upright = Math.abs(this.up.set(0, 1, 0).applyQuaternion(this.q).y) > 0.6;
      const topple = it.upright && !upright;
      it.upright = upright;
      // скло: удар зі швидкості ~4.5 м/с (впала зі столу, кинули об стіну) — друзки
      if (it.spec.fragile && !it.cracked && dv > 4.4) { it.cracked = true; this.onBreak?.(it, t.x, t.y, t.z, pvx, pvy, pvz); }
      if ((dv > 0.8 || topple) && it.cd <= 0) {
        it.cd = 0.12;
        this.onImpact?.(t.x, t.y, t.z, Math.min(1, dv / 4 + (topple ? 0.45 : 0)), it.spec.kind, topple, it.thrown > 0);
      }
    }
  }

  /** Розбити річ: сховати сітку, прибрати тіло, повідомити гру (уламки, звук, шум). */
  shatter(it: PropItem, t: { x: number; y: number; z: number }, vx = 0, vy = 0, vz = 0): void {
    if (it.broken) return;
    it.broken = true; it.held = false;
    it.view(this.m.makeScale(0, 0, 0));
    this.setAwake(it, false);
    for (const c of it.colliders) this.byCollider.delete(c.handle);
    this.physics.world.removeRigidBody(it.body);
    this.onBreak?.(it, t.x, t.y, t.z, vx, vy, vz);
  }

  /** Прибрати все (зміна рівня): тіла разом із коллайдерами. */
  clear(): void {
    for (const it of this.items) if (!it.broken) this.physics.world.removeRigidBody(it.body);
    this.items = [];
    this.byCollider.clear();
    this.awakeMesh.clear();
    this.probe = null;
  }
}
