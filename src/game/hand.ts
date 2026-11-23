// Рука з ліхтариком: не прибита до очей, а тримається рукою — трохи відстає при повороті (інерція кисті),
// м'яко погойдується в такт крокам, «пливе» від дихання й тремтить від страху. Промінь іде з ліхтарика, а не з голови.
// Чиста математика без сцени (стан + update), тож перевіряється в Node.
import * as THREE from 'three/webgpu';

export interface HandInput {
  /** Камера (вже з похитуванням голови). */
  camPos: THREE.Vector3;
  camQuat: THREE.Quaternion;
  /** Фаза й сила кроку гравця (як у CameraRig). */
  phase: number;
  amp: number;
  /** 0..1 — тремтіння рук (страх, небезпека). */
  shake: number;
  dt: number;
  t: number;
  /** Скільки вільного місця перед ліхтарем (м): біля стіни рука підтягує ліхтар до себе, а не встромляє його в стіну. */
  room?: number;
}

/** Де в руці ліхтар відносно очей (м): тримають за ручку, правіше й нижче погляду, на зігнутій руці. */
const HOLD = new THREE.Vector3(0.22, -0.26, -0.52);

export class Hand {
  /** Орієнтація руки (запізнюється за поглядом). */
  readonly quat = new THREE.Quaternion();
  /** Положення ліхтарика у світі. */
  readonly pos = new THREE.Vector3();
  /** Куди світить (одиничний вектор). */
  readonly dir = new THREE.Vector3(0, 0, -1);
  private init = false;
  /** Наскільки рука зараз підтягнута до себе (м), плавно. */
  private pull = 0;
  private readonly off = new THREE.Vector3();
  private readonly sway = new THREE.Quaternion();
  private readonly e = new THREE.Euler(0, 0, 0, 'YXZ');

  /** Скинути інерцію (телепорт, кат-сцена): рука одразу там, куди дивишся. */
  snap(): void { this.init = false; this.pull = 0; }

  update(i: HandInput): void {
    if (!this.init) { this.quat.copy(i.camQuat); this.init = true; }
    // кисть доганяє погляд за ~60 мс: різкий поворот — промінь на мить «відстає» і м'яко наздоганяє
    this.quat.slerp(i.camQuat, 1 - Math.exp(-Math.max(0, i.dt) * 16));
    const amp = Math.sqrt(Math.max(0, i.amp));
    // погойдування рукою в такт крокам (протифаза голові) + дихання + тремтіння
    const tr = i.shake * i.shake;
    const n = (k: number) => Math.sin(i.t * k) * Math.sin(i.t * k * 1.37);
    this.e.set(
      Math.cos(i.phase * 2) * 0.006 * amp + Math.sin(i.t * 1.3) * 0.004 + n(31) * tr * 0.02,
      Math.sin(i.phase) * 0.012 * amp + Math.sin(i.t * 0.9) * 0.003 + n(27) * tr * 0.02,
      0
    );
    this.sway.setFromEuler(this.e);
    this.quat.multiply(this.sway);
    // стіна ближче за витягнуту руку → згинаємо лікоть: ліхтар ближче до тіла й трохи нижче
    // (room міряється від того місця, де ліхтар зараз, — тобто вже з підтягнутою рукою; віднімаємо, щоб не «гойдалось»)
    const want = Math.min(0.26, Math.max(0, 0.62 - ((i.room ?? 10) - this.pull)));
    this.pull += (want - this.pull) * (1 - Math.exp(-Math.max(0, i.dt) * 10));
    this.off.set(HOLD.x - Math.sin(i.phase) * 0.012 * amp, HOLD.y + Math.cos(i.phase * 2) * 0.008 * amp - this.pull * 0.25, HOLD.z + this.pull).applyQuaternion(this.quat);
    this.pos.copy(i.camPos).add(this.off);
    this.dir.set(0, -0.012, -1).normalize().applyQuaternion(this.quat);
    // наступного кадру повертаємося до «чистої» орієнтації руки (погойдування не накопичується)
    this.quat.multiply(this.sway.invert());
  }
}
