// Прикмети перед появою мисливця (вибирає TensionDirector): кроки за спиною, двері самі грюкають, лампа лускає з іскрами.
// Іскри — одна система точок на рівень, завжди в сцені (поза кадром), щоб шейдер скомпілювався з рівнем, а не в мить лякання.
import * as THREE from 'three/webgpu';
import { vec3, uniform } from 'three/tsl';
import type { Level } from '../world/level0';
import type { AudioEngine } from '../audio/audio';
import type { SoundBank } from '../audio/bank';
import { lampBurst } from '../audio/synth';
import type { Omen } from './tension';

const N = 48;

export class Omens {
  private sparks: THREE.InstancedMesh | null = null;
  private readonly spos = new Float32Array(N * 3);
  private readonly m4 = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly up = new THREE.Vector3(0, 0, 1);
  private readonly v3 = new THREE.Vector3();
  private vel = new Float32Array(N * 3);
  private life = 0;
  private readonly glow = uniform(0);
  private burst: AudioBuffer | null = null;
  private steps: { t: number; x: number; z: number; k: number }[] = [];

  constructor(private readonly audio: AudioEngine, private readonly sfx: SoundBank) {}

  /** Новий рівень: іскри — розпечені штрихи, витягнуті вздовж польоту (InstancedMesh, сховані під підлогою). */
  attach(lvl: Level): void {
    const g = new THREE.BoxGeometry(0.008, 0.008, 1);
    const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    m.colorNode = vec3(1.0, 0.62, 0.26).mul(this.glow.mul(14));
    const sp = new THREE.InstancedMesh(g, m, N);
    sp.frustumCulled = false;
    this.spos.fill(-50);
    this.sparks = sp;
    this.writeSparks();
    lvl.scene.add(sp);
    this.life = 0;
    this.steps = [];
  }

  /** Матриці штрихів: позиція, напрям і довжина — за швидкістю (що швидше, то довший слід). */
  private writeSparks(): void {
    const sp = this.sparks;
    if (!sp) return;
    for (let i = 0; i < N; i++) {
      const v = this.v3.set(this.vel[i * 3] as number, this.vel[i * 3 + 1] as number, this.vel[i * 3 + 2] as number);
      const len = Math.max(0.01, Math.min(0.12, v.length() * 0.025));
      if (v.lengthSq() > 1e-6) this.q.setFromUnitVectors(this.up, v.normalize()); else this.q.identity();
      this.m4.compose(new THREE.Vector3(this.spos[i * 3], this.spos[i * 3 + 1], this.spos[i * 3 + 2]), this.q, new THREE.Vector3(1, 1, len));
      sp.setMatrixAt(i, this.m4);
    }
    sp.instanceMatrix.needsUpdate = true;
  }

  /** Показати прикмету. Повертає false, якщо для неї зараз немає місця (немає дверей/лампи поруч). */
  play(o: Omen, lvl: Level, player: { x: number; z: number; yaw: number }, cam: THREE.Camera): boolean {
    const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw);
    if (o === 'steps') {
      // 4 важкі кроки за спиною, кожен трохи ближче — і тиша
      for (let k = 0; k < 4; k++) this.steps.push({ t: k * 0.55, x: player.x - fx * (3.6 - k * 0.35), z: player.z - fz * (3.6 - k * 0.35), k });
      return true;
    }
    if (o === 'door') {
      let best: { d: (typeof lvl.doors.list)[number]; s: number } | null = null;
      for (const d of lvl.doors.list) {
        if (d.target <= 0.1) continue;
        const dx = d.cx - player.x, dz = d.cz - player.z, dist = Math.hypot(dx, dz);
        if (dist < 3.5 || dist > 14) continue;
        const behind = -(dx * fx + dz * fz) / dist; // 1 — просто за спиною
        const s = behind * 2 - dist * 0.08;
        if (!best || s > best.s) best = { d, s };
      }
      if (!best) return false;
      lvl.doors.slamShut(best.d);
      return true;
    }
    // лампа попереду, в полі зору, 4–14 м
    let li = -1, ls = -Infinity;
    lvl.layout.lights.forEach((p, i) => {
      if (lvl.lamps.levelOf(i) < 0.5) return;
      const dx = p.x - player.x, dz = p.z - player.z, dist = Math.hypot(dx, dz);
      if (dist < 4 || dist > 14) return;
      const ahead = (dx * fx + dz * fz) / dist;
      if (ahead < 0.55) return;
      const s = ahead * 2 - dist * 0.05;
      if (s > ls) { ls = s; li = i; }
    });
    if (li < 0) return false;
    const lp = lvl.layout.lights[li] as { x: number; z: number };
    lvl.lamps.kill(li);
    const ctx = this.audio.ctx;
    if (ctx) { this.burst ??= lampBurst(ctx, 2); this.audio.play3D(this.burst, lp.x, lvl.layout.height - 0.1, lp.z, { gain: 1, ref: 3, wet: 0.5 }); }
    this.emit(lp.x, lvl.layout.height - 0.05, lp.z);
    void cam;
    return true;
  }

  /** Сніп іскор з точки (лампа під стелею). */
  emit(x: number, y: number, z: number): void {
    for (let i = 0; i < N; i++) {
      this.spos.set([x + (Math.random() - 0.5) * 0.4, y, z + (Math.random() - 0.5) * 0.2], i * 3);
      const a = Math.random() * Math.PI * 2, sp = 0.5 + Math.random() * 2.4;
      this.vel.set([Math.cos(a) * sp, -0.3 - Math.random() * 1.8, Math.sin(a) * sp], i * 3);
    }
    this.life = 1.3;
    this.writeSparks();
  }

  update(dt: number): void {
    // кроки за спиною
    for (const s of this.steps) s.t -= dt;
    while (this.steps.length && (this.steps[0] as { t: number }).t <= 0) {
      const s = this.steps.shift() as { x: number; z: number; k: number };
      const b = this.sfx.pick('step_');
      if (b) this.audio.play3D(b, s.x, 0.05, s.z, { gain: 0.35 + s.k * 0.08, rate: 0.6 + Math.random() * 0.06, ref: 2.2, wet: 0.5 });
    }
    // іскри: падають (гравітація), відскакують від підлоги, гаснуть
    if (!this.sparks || this.life <= 0) { this.glow.value = 0; return; }
    this.life -= dt;
    this.glow.value = Math.max(0, this.life / 1.3) ** 1.6;
    const v = this.vel, p = this.spos;
    for (let i = 0; i < N; i++) {
      v[i * 3 + 1] = (v[i * 3 + 1] as number) - 9.8 * dt;
      for (let k = 0; k < 3; k++) p[i * 3 + k] = (p[i * 3 + k] as number) + (v[i * 3 + k] as number) * dt;
      if ((p[i * 3 + 1] as number) < 0.01) { p[i * 3 + 1] = 0.01; v[i * 3 + 1] = -(v[i * 3 + 1] as number) * 0.3; v[i * 3] = (v[i * 3] as number) * 0.6; v[i * 3 + 2] = (v[i * 3 + 2] as number) * 0.6; }
    }
    if (this.life <= 0) { this.spos.fill(-50); this.vel.fill(0); }
    this.writeSparks();
  }
}
