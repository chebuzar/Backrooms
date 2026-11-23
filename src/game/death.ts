// Смерть Оператора (18+, Назар 23.11: «страшний скример, потім коротка дуже жорстока сцена», «не тільки жорстока, а й реалістична»).
//   0.00–0.55 с  скример: монстр ривком упритул обличчям у камеру, крик-гарчання, удар, кадр трясе;
//   0.55–1.05 с  удар збиває з ніг: падаєш навзнак (вільне падіння, не плавний «наїзд»), він кидається слідом;
//   1.05 с       потилицею об підлогу: відскок, у очах темніє на мить, власний зойк;
//   1.05–4.4 с   він сидить навпочіпки на тобі й рве: укус униз → ривок головою назад і вбік (відриває), тіло смикає;
//                серце б'ється шалено й сповільнюється, голос слабне до хрипу, світ сіріє, повіки двічі опускаються —
//                удруге вже не піднімаються. Кров розтікається під тобою.
// Без нових джерел світла й шейдерів посеред гри (калюжа — спільний матеріал, прогрітий із рівнем).
import * as THREE from 'three/webgpu';
import type { Stalker } from '../world/monsters/stalker';
import type { AudioEngine } from '../audio/audio';
import type { SoundBank } from '../audio/bank';
import { look } from '../render/post';
import type { BloodSpray } from '../world/blood';

export interface DeathDeps {
  camera: THREE.PerspectiveCamera;
  stalker: Stalker;
  audio: AudioEngine;
  sfx: SoundBank;
  /** Калюжа під тілом (прихована до смерті), масштаб — розтікання. */
  pool: THREE.Object3D | null;
  /** Бризки крові (приховані до смерті). */
  spray: BloodSpray | null;
  /** Куди світить ліхтарик (null — звичайний, з руки). */
  setFlash(o: { from: THREE.Vector3; at: THREE.Vector3; intensity: number } | null): void;
  shake(v: number): void;
}

const ease = (k: number) => k * k * (3 - 2 * k);
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Ключові моменти сцени (с). */
export const DEATH = { lunge: 0.55, fall: 0.5, length: 4.4 } as const;
const IMPACT = DEATH.lunge + DEATH.fall;

export class DeathScene {
  readonly length = DEATH.length;
  t = 0;
  private readonly eye = new THREE.Vector3();
  private readonly floor = new THREE.Vector3();
  private readonly yaw: number;
  private readonly fwd = new THREE.Vector3();
  private readonly side = new THREE.Vector3();
  /** Монстр дивиться назад, на тіло (протилежно погляду гравця). */
  private readonly myaw: number;
  /** «Верх» кадру лежачого: до маківки (−fwd) — не перевертається, навіть коли голова монстра прямо над тобою. */
  private readonly up = new THREE.Vector3();
  private readonly feet = new THREE.Vector3();
  private readonly grabAt = new THREE.Vector3();
  private grabSet = false;
  private nextStrike = IMPACT + 0.35;
  private strikeT = -9;
  private strikes = 0;
  private tore = false;
  private nextBeat = IMPACT + 0.05;
  private beatT = -9;
  private hurt = 0;
  private impacted = false;
  private lastWords = false;
  private readonly sat0: number;
  private readonly flash = { from: new THREE.Vector3(), at: new THREE.Vector3(), intensity: 0 };
  private readonly head = new THREE.Vector3();
  private readonly m = new THREE.Matrix4();
  private readonly q0 = new THREE.Quaternion();
  private readonly q1 = new THREE.Quaternion();
  private readonly q2 = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly dir = new THREE.Vector3();
  private readonly mouth = new THREE.Vector3();
  private splashed = false;
  private dripT = 0;

  constructor(private readonly d: DeathDeps) {
    const c = d.camera, s = d.stalker;
    this.eye.copy(c.position);
    this.yaw = Math.atan2(-(s.pos.x - c.position.x), -(s.pos.z - c.position.z));
    this.fwd.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    this.side.set(-this.fwd.z, 0, this.fwd.x);
    this.myaw = Math.atan2(-this.fwd.x, -this.fwd.z);
    this.up.set(-this.fwd.x, 0.35, -this.fwd.z).normalize();
    // падає навзнак: потилиця — на 0.45 м позаду того місця, де стояв; очі — на висоті ~13 см над підлогою
    this.floor.set(c.position.x - this.fwd.x * 0.45, 0.13, c.position.z - this.fwd.z * 0.45);
    // він сідає навпочіпки на тебе — ступні обабіч грудей/живота, обличчям до твого обличчя
    this.feet.set(this.floor.x + this.fwd.x * 0.62, 0, this.floor.z + this.fwd.z * 0.62);
    this.sat0 = look.saturation.value;
    this.play('scare_', 1.0, 1.0);
    this.play('hit_', 0.9, 0.62);
    look.fear.value = 1;
    d.shake(1);
    if (d.spray) { d.spray.clear(); d.spray.mesh.visible = true; }
    if (d.pool) { d.pool.position.set(this.floor.x + this.fwd.x * 0.25, 0.006, this.floor.z + this.fwd.z * 0.25); d.pool.scale.setScalar(0.01); d.pool.visible = true; }
  }

  private play(prefix: string, gain: number, rate = 0.9 + Math.random() * 0.15): void {
    const b = this.d.sfx.pick(prefix);
    if (b) this.d.audio.play2D(b, gain, rate);
  }

  /** Крок сцени; true — кінець (екран чорний). */
  update(dt: number): boolean {
    const d = this.d, c = d.camera, s = d.stalker;
    const step = Math.min(dt, 1 / 20); // навіть якщо кадр загальмував — сцена не «перескакує»
    this.t += step;
    const t = this.t;
    const n = (k: number) => Math.sin(t * k) * Math.sin(t * k * 1.37);
    // 1) скример: обличчя ривком упритул
    if (t < DEATH.lunge) {
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
    if (!this.grabSet) { this.grabSet = true; this.grabAt.copy(s.root.position); this.play('yelp_', 0.8, 1); }
    // кров, що влучила в очі, — червона пелена
    if (d.spray) this.hurt = Math.min(1, this.hurt + d.spray.update(step, c.position) * 0.12);
    // 2) падіння навзнак: вільне падіння (прискорюється), а не плавний наїзд; удар потилицею — відскок
    const tf = clamp01((t - DEATH.lunge) / DEATH.fall);
    c.position.lerpVectors(this.eye, this.floor, tf * tf);
    if (t >= IMPACT) {
      const u = t - IMPACT;
      c.position.y += Math.abs(Math.sin(u * 22)) * 0.045 * Math.exp(-u * 9);
      if (!this.impacted) {
        this.impacted = true;
        this.play('hit_', 1.0, 0.5);
        this.play('victim_', 0.85, 1);
        d.shake(1);
        this.hurt = 0.35;
      }
    }
    // він кидається слідом і сідає на тебе
    // (поки падаєш — він ще стоїть, де схопив: інакше камера пролітає крізь його голову)
    const pounce = ease(clamp01((t - 0.8) / 0.35));
    // 3) ривки: укус униз (0–0.1 с), тримає, ривок назад і вбік — відриває (0.2–0.62 с)
    if (t >= this.nextStrike && t < this.length - 0.7) {
      this.strikeT = t;
      this.nextStrike = t + 0.62 + Math.random() * 0.25;
      this.strikes++;
      this.tore = false;
      this.play('gore_', 0.95);
      if (Math.random() < 0.5) this.play('feed_', 0.6, 0.8);
      // перші рази кричиш, потім лише здригаєшся й хрипиш
      const weak = clamp01((this.strikes - 1) / 4);
      if (this.strikes <= 2) this.play('victim_', 0.8 - weak * 0.3, 1);
      else if (Math.random() < 0.6) this.play('yelp_', 0.55 - weak * 0.3, 0.9 - weak * 0.1);
      d.shake(0.5);
    }
    const u = t - this.strikeT;
    const bite = u < 0.1 ? u / 0.1 : u < 0.24 ? 1 : clamp01(1 - (u - 0.24) / 0.2);
    const pull = u > 0.2 && u < 0.62 ? Math.sin(Math.PI * (u - 0.2) / 0.42) : 0;
    if (u > 0.22 && !this.tore && this.strikeT > 0) {
      this.tore = true;
      this.play(this.strikes % 2 ? 'rip_' : 'crunch_', 0.95);
      d.shake(0.7);
      // з розірваного горла б'є кров — угору, на нього й на ліхтарик
      if (d.spray) {
        this.dir.copy(this.fwd).addScaledVector(this.side, (Math.random() - 0.5) * 0.8).normalize();
        d.spray.burst(this.floor.x + this.fwd.x * 0.18, 0.06, this.floor.z + this.fwd.z * 0.18, this.dir, 16 + Math.floor(Math.random() * 8), Math.max(2.4, 4.2 - this.strikes * 0.3));
      }
      this.hurt = Math.min(1, this.hurt + 0.16);
    }
    const fx = THREE.MathUtils.lerp(this.grabAt.x, this.feet.x - this.fwd.x * 0.1 * bite, pounce);
    const fz = THREE.MathUtils.lerp(this.grabAt.z, this.feet.z - this.fwd.z * 0.1 * bite, pounce);
    if (t >= 0.8) s.feed(fx, fz, this.myaw, bite * pounce, pull, t, pounce);
    // тіло смикає разом із ним: на ривку тебе тягне до нього й трохи вгору
    if (t >= IMPACT) { c.position.addScaledVector(this.fwd, pull * 0.06).addScaledVector(this.side, pull * 0.025); c.position.y += pull * 0.03; }
    // погляд з підлоги — на його обличчя; голова завалена набік і безвольно хитається від ривків
    s.root.updateMatrixWorld(true);
    s.headWorld(this.head);
    this.q0.setFromEuler(this.e.set(0.04, this.yaw, 0, 'YXZ'));
    this.m.lookAt(c.position, this.head, this.up);
    this.q1.setFromRotationMatrix(this.m);
    const jolt = n(43) * 0.03 * (0.3 + pull + bite * 0.5);
    this.q2.setFromEuler(this.e.set(jolt + pull * 0.05, jolt * 0.6 - pull * 0.06, ease(tf) * 0.38 + jolt, 'YXZ'));
    c.quaternion.slerpQuaternions(this.q0, this.q1, ease(tf)).multiply(this.q2);
    c.rotation.setFromQuaternion(c.quaternion, 'YXZ');
    // ліхтарик випав і лежить поруч, світить знизу на нього
    this.flash.from.set(this.floor.x + this.side.x * 0.5, 0.06, this.floor.z + this.side.z * 0.5);
    this.flash.at.copy(this.head);
    this.flash.intensity = 9;
    d.setFlash(this.flash);
    // 4) серце: спершу шалене (~140 уд/хв), далі все повільніше й тихіше; червоне в очах — у такт
    const life = clamp01((t - IMPACT) / (this.length - IMPACT - 0.3));
    if (t >= this.nextBeat && life < 0.97) {
      this.beatT = t;
      this.nextBeat = t + 0.42 + life * life * 1.1;
      this.play('heart_', 0.95 - life * 0.5, 1);
    }
    const pulse = Math.exp(-(t - this.beatT) * 7);
    // з його рота: на ривку назад — бризки тобі в обличчя, між ривками — капає з підборіддя
    if (d.spray && this.strikes > 0 && this.strikes < 99) {
      this.mouth.copy(this.head).addScaledVector(this.fwd, -0.06); this.mouth.y -= 0.12;
      if (pull > 0.6 && !this.splashed) {
        this.splashed = true;
        this.dir.copy(c.position).sub(this.mouth).normalize();
        d.spray.burst(this.mouth.x, this.mouth.y, this.mouth.z, this.dir, 12, 1.4);
      }
      if (pull < 0.1) this.splashed = false;
      this.dripT -= step;
      if (this.dripT <= 0) { this.dripT = 0.07 + Math.random() * 0.12; this.dir.set(0, -1, 0); d.spray.burst(this.mouth.x, this.mouth.y, this.mouth.z, this.dir, 1, 0.15); }
    }
    // останній хрип
    if (!this.lastWords && t >= this.length - 1.55) { this.lastWords = true; this.play('victim_', 0.45, 0.8); }
    // кров розтікається; світ сіріє; повіки опускаються двічі — вдруге не піднімаються
    if (d.pool) d.pool.scale.setScalar(0.01 + ease(clamp01((t - IMPACT + 0.1) / 3.0)) * 1.7);
    this.hurt = Math.max(0, this.hurt - step * 0.08);
    look.hurt.value = Math.min(1, this.hurt * (0.55 + 0.45 * pulse) + life * 0.25);
    look.fear.value = 1;
    look.saturation.value = this.sat0 * (1 - life * 0.75);
    const knock = t >= IMPACT ? Math.exp(-(t - IMPACT) * 5) * 0.75 : 0; // у очах темніє від удару потилицею
    const blink = Math.sin(Math.PI * clamp01((t - (this.length - 1.7)) / 0.5)) * 0.75;
    const close = clamp01((t - (this.length - 0.95)) / 0.85);
    look.fade.value = Math.max(knock, blink, ease(close));
    if (t >= this.length - 0.45 && this.strikes < 99) { this.strikes = 99; this.play('crunch_', 1.0, 0.75); }
    return t >= this.length;
  }

  /** Прибрати наслідки сцени з кадру (перед «Связь потеряна»). */
  end(): void {
    look.hurt.value = 0;
    look.saturation.value = this.sat0;
    this.d.setFlash(null);
    if (this.d.pool) this.d.pool.visible = false;
    if (this.d.spray) this.d.spray.mesh.visible = false;
  }
}
