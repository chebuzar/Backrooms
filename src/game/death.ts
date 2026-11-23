// Смерть Оператора (18+, Назар 23.11: «страшний скример, потім коротка дуже жорстока сцена»).
//   0.00–0.55 с  скример: монстр ривком упритул обличчям у камеру, крик-гарчання, удар, кадр трясе;
//   0.55–1.00 с  удар збиває з ніг: камера падає на підлогу, голова лягає набік, ліхтарик випадає й світить знизу;
//   1.00–3.70 с  монстр над тілом: ривки головою вниз — роздирання, хрускіт, мокрі удари; кров розтікається під тобою,
//                край кадру червоніє, світ пливе й гасне; останній хрускіт — і тиша.
// Без нових джерел світла й шейдерів посеред гри (калюжа — спільний матеріал, прогрітий із рівнем).
import * as THREE from 'three/webgpu';
import type { Stalker } from '../world/monsters/stalker';
import type { AudioEngine } from '../audio/audio';
import type { SoundBank } from '../audio/bank';
import { look } from '../render/post';

export interface DeathDeps {
  camera: THREE.PerspectiveCamera;
  stalker: Stalker;
  audio: AudioEngine;
  sfx: SoundBank;
  /** Калюжа під тілом (прихована до смерті), масштаб — розтікання. */
  pool: THREE.Object3D | null;
  /** Куди світить ліхтарик (null — звичайний, з руки). */
  setFlash(o: { from: THREE.Vector3; at: THREE.Vector3; intensity: number } | null): void;
  shake(v: number): void;
}

const ease = (k: number) => k * k * (3 - 2 * k);
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export class DeathScene {
  readonly length = 3.7;
  t = 0;
  private readonly eye = new THREE.Vector3();
  private readonly floor = new THREE.Vector3();
  private readonly yaw: number;
  private readonly fwd = new THREE.Vector3();
  private nextStrike = 1.05;
  private strikeT = -1;
  private strikes = 0;
  private hurt = 0;
  private readonly flash = { from: new THREE.Vector3(), at: new THREE.Vector3(), intensity: 0 };
  private readonly head = new THREE.Vector3();
  private readonly feet = new THREE.Vector3();
  private feetSet = false;
  /** Монстр дивиться назад, на тіло (протилежно погляду гравця). */
  private readonly myaw: number;
  /** «Верх» кадру лежачого: до маківки (−fwd) — не перевертається, навіть коли голова монстра прямо над тобою. */
  private readonly up = new THREE.Vector3();
  private readonly m = new THREE.Matrix4();
  private readonly q0 = new THREE.Quaternion();
  private readonly q1 = new THREE.Quaternion();
  private readonly q2 = new THREE.Quaternion();
  private readonly e = new THREE.Euler();

  constructor(private readonly d: DeathDeps) {
    const c = d.camera, s = d.stalker;
    this.eye.copy(c.position);
    this.yaw = Math.atan2(-(s.pos.x - c.position.x), -(s.pos.z - c.position.z));
    this.fwd.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    this.myaw = Math.atan2(-this.fwd.x, -this.fwd.z);
    this.up.set(-this.fwd.x, 0.35, -this.fwd.z).normalize();
    // впав на спину й трохи вбік: голова там, де стояли ноги, — на 0.35 м назад від монстра
    this.floor.set(c.position.x - this.fwd.x * 0.35, 0.17, c.position.z - this.fwd.z * 0.35);
    this.play('scare_', 1.0, 1.0);
    this.play('hit_', 0.9, 0.62);
    look.fear.value = 1;
    d.shake(1);
    if (d.pool) { d.pool.position.set(this.floor.x, 0.006, this.floor.z); d.pool.scale.setScalar(0.01); d.pool.visible = true; }
  }

  private play(prefix: string, gain: number, rate = 0.9 + Math.random() * 0.15): void {
    const b = this.d.sfx.pick(prefix);
    if (b) this.d.audio.play2D(b, gain, rate);
  }

  /** Крок сцени; true — кінець (екран чорний). */
  update(dt: number): boolean {
    const d = this.d, c = d.camera, s = d.stalker;
    this.t += Math.min(dt, 1 / 20); // навіть якщо кадр загальмував — сцена не «перескакує»
    const t = this.t;
    const n = (k: number) => Math.sin(t * k) * Math.sin(t * k * 1.37);
    // 1) скример: обличчя ривком упритул
    if (t < 0.55) {
      const k = ease(clamp01(t / 0.1));
      const dist = 1.3 - k * 0.92;
      c.position.copy(this.eye);
      c.rotation.set(0.04 + n(41) * 0.03, this.yaw + n(37) * 0.04, n(29) * 0.05, 'YXZ');
      s.grabFace(c);
      // grabFace ставить голову на 0.4 м — під час ривка відсуваємо тіло назад уздовж погляду
      s.root.position.addScaledVector(this.fwd, dist - 0.4);
      this.flash.from.copy(this.eye).addScaledVector(this.fwd, 0.1); this.flash.from.x += 0.05; this.flash.from.y -= 0.38;
      this.flash.at.copy(this.eye).addScaledVector(this.fwd, dist);
      this.flash.intensity = 1.4 + (1 - k) * 4;
      d.setFlash(this.flash);
      return false;
    }
    // 2) падіння: голова лягає на підлогу набік, погляд — угору, на нього
    const fall = ease(clamp01((t - 0.55) / 0.42));
    if (t >= 0.97 && this.strikes === 0) { this.strikes = 1; this.play('gore_', 1.0, 0.8); this.play('crunch_', 0.6); d.shake(0.9); }
    c.position.lerpVectors(this.eye, this.floor, fall);
    // монстр навис над тілом: стоїть біля голови, обличчям до неї, зігнувся — обличчя над твоїм
    // ноги — за 1.05 м від голови Оператора (не над камерою: інакше камера опиняється всередині його тіла)
    if (!this.feetSet) { this.feetSet = true; this.feet.set(this.floor.x + this.fwd.x * 1.05, 0, this.floor.z + this.fwd.z * 1.05); }
    // на ривку — уперед на тебе, головою вниз
    const sk0 = this.strikeT < 0 ? 0 : clamp01(1 - Math.abs(t - this.strikeT - 0.08) / 0.12);
    const fx = this.feet.x - this.fwd.x * 0.45 * sk0, fz = this.feet.z - this.fwd.z * 0.45 * sk0;
    // ривки: голова вниз на 0.12 с і назад, з різним проміжком — щоразу звук плоті
    if (t >= this.nextStrike && t < this.length - 0.55) {
      this.strikeT = t;
      this.nextStrike = t + 0.42 + Math.random() * 0.22;
      this.strikes++;
      const pick = this.strikes % 3;
      this.play(pick === 0 ? 'crunch_' : pick === 1 ? 'rip_' : 'gore_', 0.95);
      if (Math.random() < 0.6) this.play('feed_', 0.7, 0.8);
      d.shake(0.55);
      this.hurt = Math.min(1, this.hurt + 0.22);
    }
    const sk = this.strikeT < 0 ? 0 : clamp01(1 - Math.abs(t - this.strikeT - 0.08) / 0.12);
    s.feed(fx, fz, this.myaw, sk);
    // погляд з підлоги — на його обличчя (падаючи, камера доводить погляд до нього), голова завалена набік
    s.root.updateMatrixWorld(true);
    s.headWorld(this.head);
    this.q0.setFromEuler(this.e.set(0.04, this.yaw, 0, 'YXZ'));
    this.m.lookAt(c.position, this.head, this.up);
    this.q1.setFromRotationMatrix(this.m);
    const shake = n(43) * 0.035 * (0.4 + sk);
    this.q2.setFromEuler(this.e.set(shake, shake * 0.6, fall * 0.42 + shake, 'YXZ'));
    c.quaternion.slerpQuaternions(this.q0, this.q1, fall).multiply(this.q2);
    c.rotation.setFromQuaternion(c.quaternion, 'YXZ');
    // ліхтарик лежить поруч на підлозі й світить знизу на нього
    this.flash.from.set(this.floor.x + this.fwd.z * 0.45, 0.08, this.floor.z - this.fwd.x * 0.45);
    this.flash.at.copy(this.head);
    this.flash.intensity = 9;
    d.setFlash(this.flash);
    // кров розтікається; край кадру червоніє; світ пливе й гасне
    if (d.pool) d.pool.scale.setScalar(0.01 + ease(clamp01((t - 0.95) / 2.4)) * 1.5);
    look.hurt.value = this.hurt * (0.7 + 0.3 * Math.sin(t * 9));
    look.fear.value = 1;
    look.fade.value = clamp01((t - (this.length - 0.9)) / 0.85);
    if (t >= this.length - 0.5 && this.strikes < 99) { this.strikes = 99; this.play('crunch_', 1.0, 0.75); }
    return t >= this.length;
  }

  /** Прибрати наслідки сцени з кадру (перед «Связь потеряна»). */
  end(): void {
    look.hurt.value = 0;
    this.d.setFlash(null);
    if (this.d.pool) this.d.pool.visible = false;
  }
}
