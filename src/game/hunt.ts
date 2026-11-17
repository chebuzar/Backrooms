// Полювання на рівнях 1–2: створює мисливця рівня (navmesh, модель, «дім» далеко від старту), щокадру складає для його
// мозку «що він знає про гравця» (світло, ліхтарик, чи гравець на нього дивиться), веде звук (клацання «Слепого»,
// його кроки) і передає шум від гравця (кроки, двері, клацання ліхтарика).
import * as THREE from 'three/webgpu';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { Nav } from '../ai/nav';
import type { PlayerView } from '../ai/brain';
import { Stalker, type StalkerKind } from '../world/monsters/stalker';
import { probeAt } from '../world/materials';
import type { Level } from '../world/level0';
import type { Assets } from '../assets/loader';
import type { Physics } from '../physics/physics';
import type { AudioEngine, SpatialVoice } from '../audio/audio';
import { tongueClicks, heartbeat } from '../audio/synth';
import type { SoundBank } from '../audio/bank';
import type { Player } from './player';

export interface HuntEvents { onCatch(): void; onCloser(by: number): void }

export class Hunt {
  stalker: Stalker | null = null;
  private voice: SpatialVoice | null = null;
  private heart: AudioBufferSourceNode | null = null;
  private heartGain: GainNode | null = null;
  /** Небезпека 0..1 (згладжена): погоня, близькість мисливця. */
  danger = 0;
  private readonly view: PlayerView = { x: 0, y: 0, z: 0, vx: 0, vz: 0, light: 0, flashlightOn: false, crouched: false, looksAtMe: false, litByFlashlight: false };
  private readonly fwd = new THREE.Vector3();

  constructor(private readonly audio: AudioEngine, private readonly sfx: SoundBank, private readonly ev: HuntEvents) {}

  /** Мисливець для рівня (лише 1 і 2). */
  async setup(lvl: Level, assets: Assets, physics: Physics): Promise<void> {
    this.dispose();
    const kind: StalkerKind | null = lvl.id === 1 ? 'watcher' : lvl.id === 2 ? 'blind' : null;
    if (!kind) return;
    const [nav, gl] = await Promise.all([Nav.fromLayout(lvl.layout), assets.model(`assets/models/${kind}.glb`)]);
    const L = lvl.layout;
    // «дім» — клітинка на ~60 % найдовшого шляху від старту: далеко, але не в глухому куті
    let far = 0;
    for (const v of L.dist) far = Math.max(far, v);
    let home = { x: L.exit.x, y: 0, z: L.exit.z };
    for (let c = 0; c < L.dist.length; c++) {
      if (L.dist[c] === Math.floor(far * 0.6)) { home = { x: ((c % L.cols) + 0.5) * L.cell, y: 0, z: (Math.floor(c / L.cols) + 0.5) * L.cell }; break; }
    }
    home = nav.closest(home);
    const s = new Stalker(kind, cloneSkinned(gl.scene), nav, physics, lvl.lamps, lvl.doors, home, {
      onCatch: () => this.ev.onCatch(),
      onCloser: (_s, by) => this.ev.onCloser(by)
    });
    s.onStep = (x, z, loud) => {
      const b = this.sfx.pick('step_');
      if (b) this.audio.play3D(b, x, 0.05, z, { gain: 0.25 + loud * 0.5, rate: 0.62 + Math.random() * 0.08, ref: 2.5, wet: 0.45 });
    };
    lvl.scene.add(s.root);
    this.stalker = s;
    const ctx = this.audio.ctx;
    if (kind === 'blind' && ctx) this.voice = this.audio.play3D(tongueClicks(ctx, 3), home.x, 1.6, home.z, { loop: true, gain: 0.7, ref: 2.2, wet: 0.5 });
  }

  dispose(): void {
    this.voice?.stop(0.2);
    this.voice = null;
    this.stalker = null;
    this.danger = 0;
    if (this.heartGain) this.heartGain.gain.value = 0;
  }

  /** Серцебиття на шині музики: гучніше й частіше з небезпекою. */
  private heartbeat(dt: number, target: number): void {
    const ctx = this.audio.ctx, bus = this.audio.music;
    if (!ctx || !bus) return;
    if (!this.heart) {
      this.heartGain = ctx.createGain();
      this.heartGain.gain.value = 0;
      this.heartGain.connect(bus);
      this.heart = ctx.createBufferSource();
      this.heart.buffer = heartbeat(ctx);
      this.heart.loop = true;
      this.heart.connect(this.heartGain);
      this.heart.start();
    }
    this.danger += (target - this.danger) * Math.min(1, dt * (target > this.danger ? 1.5 : 0.35));
    (this.heartGain as GainNode).gain.value = Math.max(0, this.danger - 0.12) * 1.1;
    this.heart.playbackRate.value = 0.85 + this.danger * 0.7;
  }

  /** Шум від гравця чи дверей. */
  noise(x: number, y: number, z: number, loudness: number): void {
    this.stalker?.hear(x, y, z, loudness);
  }

  update(dt: number, lvl: Level, player: Player, cam: THREE.Camera, flashlightOn: boolean, physics: Physics): void {
    const s = this.stalker;
    if (!s) return;
    const v = this.view, sp = s.pos;
    Object.assign(v, { x: player.pos.x, y: player.pos.y, z: player.pos.z, vx: player.vx, vz: player.vz, flashlightOn, crouched: player.crouched });
    v.light = probeAt(lvl.layout.lights, v.x, v.z);
    // чи бачить гравець монстра: у кадрі (кут від погляду), без стін між ними, і монстр освітлений (лампа чи ліхтарик)
    const c = cam.position, dx = sp.x - c.x, dz = sp.z - c.z, d = Math.hypot(dx, dz);
    this.fwd.set(0, 0, -1).applyQuaternion(cam.quaternion);
    const ang = Math.acos(Math.max(-1, Math.min(1, (this.fwd.x * dx + this.fwd.z * dz) / Math.max(1e-3, d * Math.hypot(this.fwd.x, this.fwd.z)))));
    const clear = d < 40 && ang < 0.75 && physics.lineOfSight(c.x, c.y, c.z, sp.x, 1.4, sp.z);
    v.litByFlashlight = clear && flashlightOn && ang < 0.42 && d < 18;
    const near = lvl.lamps.nearest(sp.x, sp.z, 1)[0];
    const lampLit = probeAt(lvl.layout.lights, sp.x, sp.z) * (near === undefined ? 0 : lvl.lamps.levelOf(near));
    v.looksAtMe = clear && (v.litByFlashlight || lampLit > 0.3 || d < 2.2);
    s.update(dt, v);
    const st = s.brain.state, dist = Math.hypot(sp.x - v.x, sp.z - v.z);
    const close = Math.max(0, 1 - dist / 14);
    this.heartbeat(dt, st === 'chase' ? 1 : Math.max(close * (v.looksAtMe ? 1 : 0.6), st === 'investigate' || st === 'search' ? 0.45 : 0));
    // клацання голосніші, коли він полює
    if (this.voice) {
      this.voice.setPosition(sp.x, 1.6, sp.z);
      const hunting = s.brain.state === 'chase' || s.brain.state === 'investigate';
      this.voice.gain.gain.value = hunting ? 1.0 : s.brain.state === 'suspicious' ? 0.8 : 0.45;
    }
  }
}
