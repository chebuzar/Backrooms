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
}

/** Де в руці ліхтарик відносно очей (м): правіше й нижче, трохи вперед. */
const HOLD = new THREE.Vector3(0.2, -0.2, -0.32);

export class Hand {
  /** Орієнтація руки (запізнюється за поглядом). */
  readonly quat = new THREE.Quaternion();
  /** Положення ліхтарика у світі. */
  readonly pos = new THREE.Vector3();
  /** Куди світить (одиничний вектор). */
  readonly dir = new THREE.Vector3(0, 0, -1);
  private init = false;
  private readonly off = new THREE.Vector3();
  private readonly sway = new THREE.Quaternion();
  private readonly e = new THREE.Euler(0, 0, 0, 'YXZ');

  /** Скинути інерцію (телепорт, кат-сцена): рука одразу там, куди дивишся. */
  snap(): void { this.init = false; }

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
    this.off.set(HOLD.x - Math.sin(i.phase) * 0.012 * amp, HOLD.y + Math.cos(i.phase * 2) * 0.008 * amp, HOLD.z).applyQuaternion(this.quat);
    this.pos.copy(i.camPos).add(this.off);
    this.dir.set(0, -0.012, -1).normalize().applyQuaternion(this.quat);
    // наступного кадру повертаємося до «чистої» орієнтації руки (погойдування не накопичується)
    this.quat.multiply(this.sway.invert());
  }
}
