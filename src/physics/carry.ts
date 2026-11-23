// Річ у руках (Назар 23.11: «брати речі, крутити, класти, кидати»). Як у найкращих іграх від першої особи:
// річ лишається справжнім тілом і тягнеться до точки перед очима «пружиною» (швидкість до цілі, а не телепорт) —
// тому впирається в стіни й інші речі, а не проходить крізь них; важча — відстає й гойдається.
// Покласти — відпустити з тією ж швидкістю, що й рука; кинути — поштовх уздовж погляду (сильніше для легших речей).
// Кинута річ гримить гучніше — монстр іде на звук, туди, де вона впала (так його можна відвести).
import * as THREE from 'three/webgpu';
import type RAPIER from '@dimforge/rapier3d-compat';
import { G, groups, type Physics } from './physics';
import { PROP_FILTER, type Knockables, type PropItem } from './knock';

/** Звідки дивиться гравець: очі й напрям погляду (одиничний), поворот голови. */
export interface Eye { x: number; y: number; z: number; dx: number; dy: number; dz: number; yaw: number }

/** Як далеко дістає рука до речі, м. */
export const REACH = 2.1;

export class Carry {
  held: PropItem | null = null;
  /** Річ під поглядом, яку можна взяти (оновлює look()). */
  target: PropItem | null = null;
  /** Відстань тримання від очей (залежить від розміру речі). */
  private dist = 0.9;
  /** Поворот речі відносно погляду (повертається разом із гравцем). */
  private readonly rel = new THREE.Quaternion();
  private readonly qYaw = new THREE.Quaternion();
  private readonly qWant = new THREE.Quaternion();
  private readonly qNow = new THREE.Quaternion();
  private readonly axisY = new THREE.Vector3(0, 1, 0);
  private readonly axisX = new THREE.Vector3(1, 0, 0);
  /** Скільки секунд річ застрягла далеко від руки (за стіною) — тоді випускаємо. */
  private stuck = 0;
  /** Підняли, поклали, кинули — для звуку. */
  onGrab: ((it: PropItem) => void) | null = null;
  onRelease: ((it: PropItem, thrown: boolean) => void) | null = null;

  constructor(private readonly physics: Physics, private readonly knock: Knockables) {}

  /** Що під поглядом: перший предмет на промені (стіни й двері закривають). exclude — коллайдер гравця. */
  look(e: Eye, exclude?: RAPIER.Collider): PropItem | null {
    if (this.held) { this.target = null; return null; }
    const hit = this.physics.castCollider(e.x, e.y, e.z, e.dx, e.dy, e.dz, REACH, G.STATIC | G.DOOR | G.PROP, exclude);
    const it = this.knock.itemOf(hit?.collider);
    this.target = it && it.grab && !it.broken ? it : null;
    return this.target;
  }

  /** Узяти річ: тепер вона в руці, гравця не штовхає, гравітація вимкнена (тримає рука). */
  grab(it: PropItem, e: Eye): void {
    if (this.held || it.broken || !it.grab) return;
    this.held = it;
    it.held = true; it.thrown = 0;
    this.stuck = 0;
    this.dist = Math.max(0.75, Math.min(1.25, 0.55 + it.size * 0.6));
    const b = it.body;
    b.wakeUp();
    b.setGravityScale(0, true);
    b.setAngularDamping(4);
    b.setLinearDamping(2);
    for (const c of it.colliders) c.setCollisionGroups(groups(G.PROP, PROP_FILTER & ~G.PLAYER));
    // поворот речі відносно погляду — як узяли, так і несемо (повертається разом із гравцем)
    const r = b.rotation();
    this.qYaw.setFromAxisAngle(this.axisY, e.yaw);
    this.rel.copy(this.qYaw).invert().multiply(this.qNow.set(r.x, r.y, r.z, r.w));
    this.onGrab?.(it);
  }

  /** Відпустити: покласти (тихо) чи кинути вздовж погляду. */
  release(e: Eye | null, throwIt = false): void {
    const it = this.held;
    if (!it) return;
    this.held = null;
    it.held = false;
    if (it.broken) return;
    const b = it.body;
    b.setGravityScale(1, true);
    b.setAngularDamping(0.6);
    b.setLinearDamping(0.3);
    for (const c of it.colliders) c.setCollisionGroups(groups(G.PROP, PROP_FILTER));
    if (throwIt && e) {
      // легке летить швидко (м'яч — 11 м/с), важке — ледве (стілець — ~5 м/с)
      const m = Math.max(0.15, b.mass()), v = Math.min(11, Math.max(3.2, 12 / Math.sqrt(m + 0.6)));
      const lv = b.linvel();
      b.setLinvel({ x: lv.x * 0.5 + e.dx * v, y: lv.y * 0.5 + e.dy * v + 1.2, z: lv.z * 0.5 + e.dz * v }, true);
      b.setAngvel({ x: (Math.random() - 0.5) * 6, y: (Math.random() - 0.5) * 4, z: (Math.random() - 0.5) * 6 }, true);
      it.thrown = 3;
    } else {
      const lv = b.linvel();
      b.setLinvel({ x: lv.x * 0.6, y: Math.min(0, lv.y), z: lv.z * 0.6 }, true);
    }
    this.onRelease?.(it, throwIt);
  }

  /** Повернути річ у руці (радіани: навколо вертикалі й навколо поперечної осі погляду). */
  rotate(dYaw: number, dPitch: number): void {
    if (!this.held) return;
    this.rel.premultiply(this.qWant.setFromAxisAngle(this.axisY, -dYaw));
    this.rel.premultiply(this.qWant.setFromAxisAngle(this.axisX, -dPitch));
  }

  /** Крок фізики (до world.step): тягнути річ до точки перед очима. dt — фіксований крок. */
  step(dt: number, e: Eye): void {
    const it = this.held;
    if (!it) return;
    if (it.broken) { this.held = null; return; }
    const b = it.body;
    const c = b.worldCom();
    // точка тримання: перед очима, трохи нижче (річ не закриває пів екрана)
    const tx = e.x + e.dx * this.dist, ty = e.y + e.dy * this.dist - 0.12, tz = e.z + e.dz * this.dist;
    const ex = tx - c.x, ey = ty - c.y, ez = tz - c.z, d = Math.hypot(ex, ey, ez);
    // застрягла (за стіною, під столом) — рука не дотягнеться: випустити
    this.stuck = d > 0.7 ? this.stuck + dt : 0;
    if (this.stuck > 0.6 || Math.hypot(c.x - e.x, c.y - e.y, c.z - e.z) > REACH + 0.6) { this.release(null); return; }
    // «пружина»: швидкість до цілі, важче — повільніше; обмеження — щоб не вистрілювала
    const m = b.mass(), k = 14 / (1 + m / 10), vmax = 6.5 / (1 + m / 14);
    let vx = ex * k, vy = ey * k, vz = ez * k;
    const v = Math.hypot(vx, vy, vz);
    if (v > vmax) { vx *= vmax / v; vy *= vmax / v; vz *= vmax / v; }
    b.setLinvel({ x: vx, y: vy, z: vz }, true);
    // поворот: до бажаного (погляд × як узяли) кутовою швидкістю
    const r = b.rotation();
    this.qNow.set(r.x, r.y, r.z, r.w);
    this.qWant.setFromAxisAngle(this.axisY, e.yaw).multiply(this.rel);
    const qe = this.qWant.multiply(this.qNow.invert()); // помилка повороту
    if (qe.w < 0) { qe.x = -qe.x; qe.y = -qe.y; qe.z = -qe.z; qe.w = -qe.w; }
    const ang = 2 * Math.acos(Math.min(1, qe.w)), s = Math.sqrt(Math.max(1e-8, 1 - qe.w * qe.w));
    const w = Math.min(10, ang * 9 / (1 + m / 8));
    b.setAngvel({ x: (qe.x / s) * w, y: (qe.y / s) * w, z: (qe.z / s) * w }, true);
  }

  /** Зміна рівня: нічого не тримаємо. */
  reset(): void { this.held = null; this.target = null; }
}
