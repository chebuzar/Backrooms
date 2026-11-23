// Гравець: капсула з кінематичним контролером Rapier. Ходьба, біг з витривалістю, присідання,
// гравітація, похитування камери, кроки (події шуму для ШІ та звуку). Без залежностей від DOM — тестується в Node.
import type RAPIER from '@dimforge/rapier3d-compat';
import { G, groups, type Physics } from '../physics/physics';

export interface MoveIntent {
  /** Вперед/вбік у межах −1..1 (x — вправо, y — вперед). */
  x: number;
  y: number;
  run: boolean;
  crouch: boolean;
}

export interface FootstepEvent {
  x: number;
  y: number;
  z: number;
  /** Гучність 0..1: присід ≈ 0.15, крок ≈ 0.45, біг = 1. */
  loudness: number;
  running: boolean;
}

export const PLAYER = {
  radius: 0.3,
  standHalf: 0.6, // половина висоти циліндра капсули: повний зріст = 2·(0.6 + 0.3) = 1.8 м
  crouchHalf: 0.25, // 1.1 м
  eyeStand: 1.66,
  eyeCrouch: 0.98,
  walk: 1.85,
  run: 4.3,
  crouchSpeed: 0.95,
  accel: 9, // розгін кроком: ~0.25 с до повної швидкості — відчувається вага тіла, але без «ковзанки»
  runAccel: 4.5, // розгін у біг довший: людина в робі й чоботях не зривається з місця
  decel: 10,
  staminaDrain: 0.17,
  staminaRegen: 0.11,
  stepWalk: 1.5, // довжина кроку, м
  stepRun: 2.05
};

export class Player {
  readonly collider: RAPIER.Collider;
  private readonly body: RAPIER.RigidBody;
  private readonly ctrl: RAPIER.KinematicCharacterController;
  /** Позиція ніг (низ капсули). */
  readonly pos = { x: 0, y: 0, z: 0 };
  /** Попередня позиція — для згладжування камери між кроками фізики. */
  readonly prev = { x: 0, y: 0, z: 0 };
  yaw = 0;
  pitch = 0;
  vx = 0;
  vz = 0;
  vy = 0;
  grounded = false;
  crouched = false;
  /** Плавна висота очей (переходить між стоячи/присівши). */
  eye = PLAYER.eyeStand;
  stamina = 1;
  /** Множник швидкості від поверхні (у воді — повільніше). */
  slow = 1;
  exhausted = false;
  running = false;
  /** Фаза кроку, рад (для похитування камери). */
  bobPhase = 0;
  bobAmp = 0;
  onFootstep: ((e: FootstepEvent) => void) | null = null;

  constructor(private readonly physics: Physics, x: number, y: number, z: number) {
    const R = physics.R;
    this.body = physics.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(x, y + PLAYER.standHalf + PLAYER.radius, z));
    this.collider = physics.world.createCollider(
      R.ColliderDesc.capsule(PLAYER.standHalf, PLAYER.radius).setCollisionGroups(groups(G.PLAYER, G.STATIC | G.DOOR | G.PROP | G.MONSTER | G.RAG)),
      this.body
    );
    this.ctrl = physics.world.createCharacterController(0.02);
    this.ctrl.setUp({ x: 0, y: 1, z: 0 });
    this.ctrl.setMaxSlopeClimbAngle((50 * Math.PI) / 180);
    this.ctrl.setMinSlopeSlideAngle((35 * Math.PI) / 180);
    this.ctrl.enableAutostep(0.32, 0.15, false); // пороги й сходинки до 32 см
    this.ctrl.enableSnapToGround(0.35);
    this.ctrl.setSlideEnabled(true);
    // не «прилипати» до кутів і стику стін — ковзати вздовж
    this.ctrl.setNormalNudgeFactor(1e-4);
    // штовхає речі (стільці, відра): імпульс, як від людини ~45 кг «ефективної» ваги — зачепив на бігу — полетіло
    this.ctrl.setApplyImpulsesToDynamicBodies(true);
    this.ctrl.setCharacterMass(45);
    this.pos.x = x; this.pos.y = y; this.pos.z = z;
    this.prev.x = x; this.prev.y = y; this.prev.z = z;
  }

  private get half(): number { return this.crouched ? PLAYER.crouchHalf : PLAYER.standHalf; }

  /** Чи вистачає місця, щоб устати (над головою немає стелі/столу). */
  private canStand(): boolean {
    const t = this.body.translation();
    const headTop = t.y + this.half + PLAYER.radius;
    const need = (PLAYER.standHalf - PLAYER.crouchHalf) * 2 + 0.02;
    const hit = this.physics.raycast(t.x, headTop - 0.01, t.z, 0, 1, 0, need, G.STATIC | G.DOOR | G.PROP, this.collider);
    return hit === null;
  }

  private setCrouch(c: boolean): void {
    if (c === this.crouched) return;
    if (!c && !this.canStand()) return;
    const t = this.body.translation();
    const feet = t.y - this.half - PLAYER.radius;
    this.crouched = c;
    const shape = this.collider.shape as RAPIER.Capsule;
    shape.halfHeight = this.half;
    this.collider.setShape(shape);
    this.body.setTranslation({ x: t.x, y: feet + this.half + PLAYER.radius, z: t.z }, true);
    this.body.setNextKinematicTranslation({ x: t.x, y: feet + this.half + PLAYER.radius, z: t.z });
  }

  /** Один крок фізики (фіксований dt). */
  update(dt: number, m: MoveIntent): void {
    this.prev.x = this.pos.x; this.prev.y = this.pos.y; this.prev.z = this.pos.z;
    this.setCrouch(m.crouch);

    // напрям руху у світі з поворотом камери
    let ix = m.x, iy = m.y;
    const len = Math.hypot(ix, iy);
    if (len > 1) { ix /= len; iy /= len; }
    const moving = len > 0.05;
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const wx = ix * cos - iy * sin; // вперед = −Z у three.js
    const wz = -ix * sin - iy * cos;

    // біг і витривалість
    const wantRun = m.run && moving && iy > 0.2 && !this.crouched && !this.exhausted;
    this.running = wantRun;
    if (wantRun) this.stamina = Math.max(0, this.stamina - PLAYER.staminaDrain * dt);
    else this.stamina = Math.min(1, this.stamina + PLAYER.staminaRegen * dt * (moving ? 0.6 : 1));
    if (this.stamina <= 0.02) this.exhausted = true;
    else if (this.exhausted && this.stamina > 0.35) this.exhausted = false;

    const speed = (this.crouched ? PLAYER.crouchSpeed : wantRun ? PLAYER.run : PLAYER.walk) * this.slow;
    const tx = wx * speed * Math.min(1, len), tz = wz * speed * Math.min(1, len);
    const k = 1 - Math.exp(-(moving ? (wantRun && Math.hypot(this.vx, this.vz) > PLAYER.walk * 0.9 ? PLAYER.runAccel : PLAYER.accel) : PLAYER.decel) * dt);
    this.vx += (tx - this.vx) * k;
    this.vz += (tz - this.vz) * k;
    this.vy = this.grounded ? -0.5 : Math.max(-30, this.vy - 9.81 * dt);

    this.ctrl.computeColliderMovement(this.collider, { x: this.vx * dt, y: this.vy * dt, z: this.vz * dt }, undefined, groups(0xffff, G.STATIC | G.DOOR | G.PROP | G.MONSTER | G.RAG));
    const mv = this.ctrl.computedMovement();
    this.grounded = this.ctrl.computedGrounded();
    const t = this.body.translation();
    const nx = t.x + mv.x, ny = t.y + mv.y, nz = t.z + mv.z;
    this.body.setNextKinematicTranslation({ x: nx, y: ny, z: nz });
    this.body.setTranslation({ x: nx, y: ny, z: nz }, true);
    // справжня швидкість після зіткнень (впираєшся в стіну — не «біжиш на місці»)
    if (dt > 0) { this.vx = mv.x / dt; this.vz = mv.z / dt; }
    this.pos.x = nx; this.pos.y = ny - this.half - PLAYER.radius; this.pos.z = nz;

    // висота очей і похитування
    const eyeTarget = this.crouched ? PLAYER.eyeCrouch : PLAYER.eyeStand;
    this.eye += (eyeTarget - this.eye) * (1 - Math.exp(-10 * dt));
    const hs = Math.hypot(this.vx, this.vz);
    const ampTarget = this.grounded ? Math.min(1, hs / PLAYER.walk) * (this.running ? 1.6 : 1) : 0;
    this.bobAmp += (ampTarget - this.bobAmp) * (1 - Math.exp(-8 * dt));
    if (this.grounded && hs > 0.15) {
      // довжина кроку плавно росте зі швидкістю (без стрибка при переході в біг)
      const runK = Math.max(0, Math.min(1, (hs - PLAYER.walk) / (PLAYER.run - PLAYER.walk)));
      const stride = PLAYER.stepWalk + (PLAYER.stepRun - PLAYER.stepWalk) * runK;
      const before = Math.floor(this.bobPhase / Math.PI);
      this.bobPhase += (hs * dt / stride) * Math.PI * 2;
      // звук кроку — саме тоді, коли голова «осідає» на ногу (фаза кратна π): звук і рух камери збігаються
      if (Math.floor(this.bobPhase / Math.PI) !== before) {
        this.bobPhase %= Math.PI * 4;
        const loud = this.crouched ? 0.15 : this.running ? 1 : 0.45;
        this.onFootstep?.({ x: this.pos.x, y: this.pos.y, z: this.pos.z, loudness: loud, running: this.running });
      }
    }
  }

  /** Повернути погляд (рад). Викликається з частотою рендера, не фізики. */
  look(dYaw: number, dPitch: number): void {
    this.yaw -= dYaw;
    this.pitch = Math.max(-1.48, Math.min(1.48, this.pitch - dPitch));
  }

  teleport(x: number, y: number, z: number, yaw = this.yaw): void {
    const cy = y + this.half + PLAYER.radius;
    this.body.setTranslation({ x, y: cy, z }, true);
    this.body.setNextKinematicTranslation({ x, y: cy, z });
    this.pos.x = this.prev.x = x; this.pos.y = this.prev.y = y; this.pos.z = this.prev.z = z;
    this.vx = this.vz = this.vy = 0;
    this.yaw = yaw;
  }
}
