// Фізичний світ Rapier: статичні колізії рівня, промені (зір монстрів, взаємодія), крок симуляції.
import RAPIER from '@dimforge/rapier3d-compat';
import type { Knockables } from './knock';

export type Rapier = typeof RAPIER;

/** Групи колізій (біти): хто з ким зіштовхується. */
export const G = {
  STATIC: 1 << 0,
  PLAYER: 1 << 1,
  MONSTER: 1 << 2,
  PROP: 1 << 3,
  DOOR: 1 << 4
} as const;

/** Rapier пакує «членство» у верхні 16 біт, «фільтр» — у нижні. */
export const groups = (member: number, filter: number) => ((member & 0xffff) << 16) | (filter & 0xffff);

let ready: Promise<Rapier> | null = null;
export function loadRapier(): Promise<Rapier> {
  ready ??= RAPIER.init().then(() => RAPIER);
  return ready;
}

export class Physics {
  readonly world: RAPIER.World;
  private readonly ray: RAPIER.Ray;
  /** Речі, які можна перекинути (у грі; у тестових сценах — немає). */
  knock: Knockables | null = null;

  constructor(readonly R: Rapier) {
    this.world = new R.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = 1 / 60;
    this.ray = new R.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
  }

  static async create(): Promise<Physics> {
    return new Physics(await loadRapier());
  }

  /** Статичний прямокутний блок (стіна, підлога, колона). Розміри — половинні. */
  addBox(cx: number, cy: number, cz: number, hx: number, hy: number, hz: number, rotY = 0, member: number = G.STATIC): RAPIER.Collider {
    const R = this.R;
    const desc = R.ColliderDesc.cuboid(hx, hy, hz)
      .setTranslation(cx, cy, cz)
      .setCollisionGroups(groups(member, 0xffff))
      .setFriction(0.8);
    if (rotY) {
      const s = Math.sin(rotY / 2), c = Math.cos(rotY / 2);
      desc.setRotation({ x: 0, y: s, z: 0, w: c });
    }
    return this.world.createCollider(desc);
  }

  /** Статична сітка трикутників (для складних моделей). */
  addTrimesh(vertices: Float32Array, indices: Uint32Array, member: number = G.STATIC): RAPIER.Collider {
    const desc = this.R.ColliderDesc.trimesh(vertices, indices).setCollisionGroups(groups(member, 0xffff));
    return this.world.createCollider(desc);
  }

  /**
   * Промінь від точки в напрямку (нормалізованому). Повертає відстань до першої перешкоди або null.
   * mask — які групи вважати перешкодою (за замовчуванням — стіни й двері).
   */
  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number, mask: number = G.STATIC | G.DOOR, exclude?: RAPIER.Collider): number | null {
    this.ray.origin = { x: ox, y: oy, z: oz };
    this.ray.dir = { x: dx, y: dy, z: dz };
    const hit = this.world.castRay(this.ray, maxDist, true, undefined, groups(0xffff, mask), exclude);
    return hit ? hit.timeOfImpact : null;
  }

  /** Промінь: перший коллайдер (з масками) і відстань до нього — для «що під поглядом». */
  castCollider(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number, mask: number, exclude?: RAPIER.Collider): { collider: RAPIER.Collider; toi: number } | null {
    this.ray.origin = { x: ox, y: oy, z: oz };
    this.ray.dir = { x: dx, y: dy, z: dz };
    const hit = this.world.castRay(this.ray, maxDist, true, undefined, groups(0xffff, mask), exclude);
    return hit ? { collider: hit.collider, toi: hit.timeOfImpact } : null;
  }

  /** Чи видно точку B з точки A (немає стін між ними). */
  lineOfSight(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const d = Math.hypot(dx, dy, dz);
    if (d < 1e-4) return true;
    const t = this.raycast(ax, ay, az, dx / d, dy / d, dz / d, d);
    return t === null || t >= d - 0.05;
  }

  step(): void {
    this.world.step();
  }
}
