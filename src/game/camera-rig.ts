// Камера від першої особи: згладжування між кроками фізики, похитування від кроків,
// легкий нахил, «дихання» на місці. Усе в метрах і радіанах.
import type * as THREE from 'three/webgpu';
import type { Player } from './player';

export class CameraRig {
  private t = 0;
  private roll = 0;
  private lastYaw = 0;
  /** Додаткові поштовхи камери (страх, удар): затухають самі. */
  shake = 0;
  /** 1 — гравець лежить на підлозі (щойно випав зі Шва), 0 — стоїть. */
  wake = 0;

  constructor(private readonly camera: THREE.PerspectiveCamera) {
    camera.rotation.order = 'YXZ';
  }

  /** Згладжена висота ніг: пороги, сходинки й «прилипання» до підлоги не підкидають камеру. */
  private sy = Number.NaN;

  update(p: Player, alpha: number, dt: number): void {
    this.t += dt;
    const x = p.prev.x + (p.pos.x - p.prev.x) * alpha;
    const y = p.prev.y + (p.pos.y - p.prev.y) * alpha;
    const z = p.prev.z + (p.pos.z - p.prev.z) * alpha;
    // вертикаль: плавно доганяє ноги (~70 мс), падіння й телепорт (великий стрибок) — одразу
    if (!Number.isFinite(this.sy) || Math.abs(y - this.sy) > 0.6 || p.vy < -3) this.sy = y;
    else this.sy += (y - this.sy) * (1 - Math.exp(-dt * 14));
    const a = p.bobAmp, ph = p.bobPhase;
    // дихання: на місці ледь помітне, після бігу (мало витривалості) — глибоке й часте
    const tired = 1 - p.stamina;
    const breathe = Math.sin(this.t * (1.7 + tired * 2.2)) * (0.006 + tired * 0.014) * (1 - Math.min(1, a) * 0.6);
    // нахил голови: у бік руху вбік і трохи «відстає» при різкому повороті (інерція тіла)
    const lat = p.vx * Math.cos(p.yaw) - p.vz * Math.sin(p.yaw);
    let dy = p.yaw - this.lastYaw;
    if (dy > Math.PI) dy -= Math.PI * 2; else if (dy < -Math.PI) dy += Math.PI * 2;
    this.lastYaw = p.yaw;
    const turnRate = dt > 0 ? dy / dt : 0;
    const targetRoll = -lat * 0.009 + Math.max(-0.015, Math.min(0.015, turnRate * 0.003));
    this.roll += (targetRoll - this.roll) * Math.min(1, dt * 6);
    // хода: голова найнижче в момент, коли ступня торкається підлоги (фаза 0 і π), найвище — посередині кроку.
    // Плавна хвиля (косинус подвійної фази) без «кута» — раніше |sin| давав різкий відскок на кожному кроці.
    // Біг: частіше й трохи глибше, але не в півтора раза (a до 1.6 → м'якшає з квадратним коренем).
    const amp = Math.sqrt(Math.max(0, a));
    const bobY = -Math.cos(ph * 2) * 0.013 * amp + breathe;
    const bobX = Math.sin(ph) * 0.011 * amp;
    const sin = Math.sin(p.yaw), cos = Math.cos(p.yaw);
    this.shake = Math.max(0, this.shake - dt * 1.8);
    const s = this.shake * this.shake;
    const n = (k: number) => Math.sin(this.t * k) * Math.sin(this.t * k * 1.31);
    // підйом з підлоги: очі біля підлоги, погляд трохи вгору, голова завалена набік
    const w = this.wake * this.wake * (3 - 2 * this.wake);
    this.camera.position.set(x + cos * bobX + n(37) * s * 0.03, this.sy + p.eye - w * (p.eye - 0.22) + bobY + n(41) * s * 0.03, z - sin * bobX);
    // легкий «кивок» на кожен крок і перекат з ноги на ногу — ледь відчутні, щоб очі не тремтіли
    this.camera.rotation.set(p.pitch + w * 0.32 - Math.cos(ph * 2) * 0.0025 * amp + breathe * 0.25 + n(29) * s * 0.02, p.yaw, Math.sin(ph) * 0.0035 * amp + this.roll + w * 0.5 + n(23) * s * 0.03);
  }
}
