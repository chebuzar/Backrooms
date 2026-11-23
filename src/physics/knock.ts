// Речі, які можна зачепити й перекинути (стільці, відра, каністри, ящики): справжні динамічні тіла Rapier.
// Гравець штовхає їх капсулою (імпульси контролера), вони падають, б'ються об підлогу й стіни — зі звуком,
// і цей звук чує монстр. Сітки лишаються в InstancedMesh-ах обстановки: тіло переписує матрицю свого інстанса.
// Поки ніхто не чіпав — тіло спить (нуль витрат, жодного «тремтіння» на старті рівня).
import * as THREE from 'three/webgpu';
import type RAPIER from '@dimforge/rapier3d-compat';
import { G, groups, type Physics } from './physics';

export type KnockKind = 'wood' | 'metal' | 'soft';

/** Що з цієї обстановки можна перекинути: маса (кг) і з чого зроблено (який звук). */
export const KNOCKABLE: Record<string, { mass: number; kind: KnockKind }> = {
  chair: { mass: 6, kind: 'wood' },
  'painted-wooden-chair-01': { mass: 5, kind: 'wood' },
  'wooden-bucket-01': { mass: 3, kind: 'wood' },
  box: { mass: 3, kind: 'wood' },
  jerrycan: { mass: 4, kind: 'metal' },
  ammo: { mass: 6, kind: 'metal' },
  'dirty-football': { mass: 0.45, kind: 'soft' },
  'rubber-duck-toy': { mass: 0.15, kind: 'soft' },
  lifebuoy: { mass: 2, kind: 'soft' }
};

/** Куди писати положення речі: окремий об'єкт або інстанси (по одному на кожну частину моделі). */
export type KnockView = (world: THREE.Matrix4) => void;

/** Інстанси однієї речі: сітка, номер, локальна матриця частини (у моделі). */
export function instanceView(parts: { im: THREE.InstancedMesh; i: number; local?: THREE.Matrix4 }[]): KnockView {
  const tmp = new THREE.Matrix4();
  return (w) => {
    for (const p of parts) {
      p.im.setMatrixAt(p.i, p.local ? tmp.multiplyMatrices(w, p.local) : w);
      p.im.instanceMatrix.needsUpdate = true;
    }
  };
}

interface Item {
  body: RAPIER.RigidBody;
  view: KnockView;
  scale: THREE.Vector3;
  kind: KnockKind;
  /** Інстанс-сітки речі: після руху оновлюємо їхню сферу відсікання. */
  meshes: THREE.InstancedMesh[];
  vx: number; vy: number; vz: number;
  cd: number;
  awake: boolean;
  /** Перші миті після появи тіло «сідає» на підлогу — це не удар. */
  quiet: number;
  /** Була стояча (вісь «вгору» вертикальна) — щоб почути, як перекинулась. */
  upright: boolean;
}

export class Knockables {
  private items: Item[] = [];
  private readonly m = new THREE.Matrix4();
  private readonly p = new THREE.Vector3();
  private readonly q = new THREE.Quaternion();
  private readonly up = new THREE.Vector3();
  /** Удар (сила 0..1) або перекидання — звук і шум для монстрів. */
  onImpact: ((x: number, y: number, z: number, strength: number, kind: KnockKind, topple: boolean) => void) | null = null;

  constructor(private readonly physics: Physics) {}

  /**
   * Додати річ: m — її світова матриця (позиція, поворот, масштаб), box — габарити моделі у власних координатах.
   * Тіло ставиться в початок моделі, коробка зіткнення — по габаритах (трохи вужча, щоб не чіплялась за стіни).
   */
  add(view: KnockView, m: THREE.Matrix4, box: THREE.Box3, mass: number, kind: KnockKind, meshes: THREE.InstancedMesh[] = []): void {
    const R = this.physics.R, w = this.physics.world;
    const pos = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    m.decompose(pos, q, s);
    const c = box.getCenter(new THREE.Vector3()).multiply(s), h = box.getSize(new THREE.Vector3()).multiply(s).multiplyScalar(0.5);
    const body = w.createRigidBody(R.RigidBodyDesc.dynamic()
      .setTranslation(pos.x, pos.y, pos.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
      .setLinearDamping(0.35).setAngularDamping(0.8).setCcdEnabled(true).setSleeping(true).setCanSleep(true));
    w.createCollider(R.ColliderDesc.cuboid(Math.max(0.04, h.x - 0.02), Math.max(0.04, h.y), Math.max(0.04, h.z - 0.02))
      .setTranslation(c.x, c.y, c.z).setMass(mass).setFriction(0.75).setRestitution(0.12)
      .setCollisionGroups(groups(G.PROP, G.STATIC | G.DOOR | G.PROP | G.PLAYER)), body);
    body.sleep(); // коллайдер будить тіло — присипляємо знову: стоїть, як поставили
    this.items.push({ body, view, scale: s, kind, meshes, vx: 0, vy: 0, vz: 0, cd: 0, awake: false, quiet: 0.6, upright: Math.abs(this.up.set(0, 1, 0).applyQuaternion(q).y) > 0.9 });
  }

  get count(): number { return this.items.length; }
  /** Скільки речей зараз рухається (для тестів і профілю). */
  get moving(): number { return this.items.filter((i) => !i.body.isSleeping()).length; }

  /** Після кроків фізики: переписати матриці речей, що рухаються; почути удари. dt — скільки часу минуло. */
  sync(dt: number): void {
    for (const it of this.items) {
      const b = it.body;
      if (b.isSleeping()) {
        if (it.awake) { it.awake = false; for (const im of it.meshes) im.computeBoundingSphere(); }
        continue;
      }
      it.awake = true;
      const t = b.translation(), r = b.rotation(), v = b.linvel();
      this.p.set(t.x, t.y, t.z); this.q.set(r.x, r.y, r.z, r.w);
      it.view(this.m.compose(this.p, this.q, it.scale));
      // удар: різка зміна швидкості (об підлогу, стіну, іншу річ)
      const dv = Math.hypot(v.x - it.vx, v.y - it.vy, v.z - it.vz);
      it.vx = v.x; it.vy = v.y; it.vz = v.z;
      it.cd -= dt;
      if (it.quiet > 0) { it.quiet -= dt; it.upright = Math.abs(this.up.set(0, 1, 0).applyQuaternion(this.q).y) > 0.6; continue; }
      const upright = Math.abs(this.up.set(0, 1, 0).applyQuaternion(this.q).y) > 0.6;
      const topple = it.upright && !upright;
      it.upright = upright;
      if ((dv > 0.8 || topple) && it.cd <= 0) {
        it.cd = 0.12;
        this.onImpact?.(t.x, t.y, t.z, Math.min(1, dv / 4 + (topple ? 0.45 : 0)), it.kind, topple);
      }
    }
  }

  /** Прибрати все (зміна рівня): тіла разом із коллайдерами. */
  clear(): void {
    for (const it of this.items) this.physics.world.removeRigidBody(it.body);
    this.items = [];
  }
}
