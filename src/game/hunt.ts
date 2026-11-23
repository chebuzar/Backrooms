// Полювання на рівнях 1–4: створює мисливця рівня (navmesh, модель, «дім» далеко від старту), щокадру складає для його
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
import { G, groups, type Physics } from '../physics/physics';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { AudioEngine, SpatialVoice } from '../audio/audio';
import { tongueClicks, heartbeat } from '../audio/synth';
import { splashStep, drownedBreath, giggle } from '../audio/synth2';
import { blindClickRate } from '../ai/traits';
import type { SoundBank } from '../audio/bank';
import type { Player } from './player';

export interface HuntEvents { onCatch(): void; onCloser(by: number): void }

export class Hunt {
  stalker: Stalker | null = null;
  private nav: Nav | null = null;
  private voice: SpatialVoice | null = null;
  private heart: AudioBufferSourceNode | null = null;
  private heartGain: GainNode | null = null;
  /** Небезпека 0..1 (згладжена): погоня, близькість мисливця. */
  danger = 0;
  private readonly view: PlayerView = { x: 0, y: 0, z: 0, vx: 0, vz: 0, light: 0, flashlightOn: false, crouched: false, looksAtMe: false, litByFlashlight: false };
  private readonly fwd = new THREE.Vector3();
  /** Ліхтарик на мить «провалився» (с): поруч «Наблюдатель», і світло тримає лише ліхтарик. */
  private flashCut = 0;
  private cutCd = 6;
  /** Попередній стан мозку — щоб почути перехід (помітив → гарчання здалеку, кинувся → рик). */
  private prevState = '';
  private growlCd = 0;
  private snarlCd = 0;
  /** Подих «Наблюдателя» за спиною: чути, лише коли на нього НЕ дивишся; глянув — тиша. */
  private breath: SpatialVoice | null = null;
  /** Тіло мисливця для фізики речей (кінематичне): на бігу збиває стільці, відра, парти — гуркіт чути здалеку. */
  private pusher: { body: RAPIER.RigidBody; physics: Physics } | null = null;
  /** Множник яскравості ліхтарика від мисливця (0 — провал). */
  get flashMul(): number { return this.flashCut > 0 ? 0 : 1; }

  constructor(private readonly audio: AudioEngine, private readonly sfx: SoundBank, private readonly ev: HuntEvents) {}

  private splashes: AudioBuffer[] = [];

  /** Хлюпіт (кешовані варіанти). */
  splash(): AudioBuffer | null {
    const ctx = this.audio.ctx;
    if (!ctx) return null;
    if (!this.splashes.length) for (let i = 0; i < 5; i++) this.splashes.push(splashStep(ctx, i + 1));
    return this.splashes[Math.floor(Math.random() * this.splashes.length)] ?? null;
  }

  /** Мисливець для рівня (1–4; на рівні 0 — лише «Шов» і нерви). */
  async setup(lvl: Level, assets: Assets, physics: Physics): Promise<void> {
    this.dispose();
    const KINDS: Record<number, StalkerKind> = { 1: 'watcher', 2: 'blind', 3: 'smiler', 4: 'drowned' };
    const kind = KINDS[lvl.id] ?? null;
    if (!kind) return;
    // модель свого монстра; якщо файл не завантажився — тіло «Наблюдателя» (з власною поведінкою й кольором шкіри)
    const model = assets.model(`assets/models/${kind}.glb`).catch(() => assets.model('assets/models/watcher.glb'));
    // бібліотека рухів (Quaternius UAL): хода (крім «Наблюдателя» — він не ходить на очах) і присід над тілом у сцені смерті;
    // без неї монстр рухається процедурними позами, як раніше
    const ual = assets.model('assets/anim/ual.glb').catch(() => null);
    const atlas = assets.texture('assets/tex/level0/decals.ktx2').catch(() => null); // підтьоки — для крові на монстрі
    const [nav, gl, anims, blood] = await Promise.all([Nav.fromLayout(lvl.layout), model, ual, atlas]);
    this.nav = nav;
    const L = lvl.layout;
    // «дім» — клітинка на ~60 % найдовшого шляху від старту: далеко, але не в глухому куті
    let far = 0;
    for (const v of L.dist) far = Math.max(far, v);
    let home = { x: L.exit.x, y: 0, z: L.exit.z };
    for (let c = 0; c < L.dist.length; c++) {
      if (L.dist[c] === Math.floor(far * 0.6)) { home = { x: ((c % L.cols) + 0.5) * L.cell, y: 0, z: (Math.floor(c / L.cols) + 0.5) * L.cell }; break; }
    }
    // «Утопленник» живе в чаші: дім — на бортику тієї чаші, що найближча до цієї точки
    const pool = kind === 'drowned' ? lvl.water?.nearestPool(home.x, home.z) ?? null : null;
    if (pool) {
      const sides = [[0, -pool.d / 2 - 0.7], [0, pool.d / 2 + 0.7], [-pool.w / 2 - 0.7, 0], [pool.w / 2 + 0.7, 0]] as const;
      let best = Infinity;
      for (const [ox, oz] of sides) {
        const want = { x: pool.x + ox, y: 0, z: pool.z + oz }, got = nav.closest(want);
        const err = Math.hypot(got.x - want.x, got.z - want.z) + Math.abs(got.y) * 4;
        if (err < best) { best = err; home = got; }
      }
    } else home = nav.closest(home);
    const s = new Stalker(kind, cloneSkinned(gl.scene), nav, physics, lvl.lamps, lvl.doors, home, {
      onCatch: () => this.ev.onCatch(),
      onCloser: (_s, by) => this.ev.onCloser(by)
    }, lvl.water ?? null, anims ? { scene: anims.scene, animations: anims.animations } : null);
    if (pool) s.poolAt = { x: pool.x, z: pool.z };
    if (blood) s.stain(blood);
    s.onStep = (x, z, loud, wet) => {
      const b = wet ? this.splash() : this.sfx.pick('step_');
      if (b) this.audio.play3D(b, x, 0.05, z, { gain: (0.25 + loud * 0.5) * (wet ? 1.3 : 1), rate: wet ? 0.8 + Math.random() * 0.1 : 0.62 + Math.random() * 0.08, ref: 2.5, wet: 0.45 });
    };
    const ctx = this.audio.ctx;
    s.onCue = (cue, x, z) => {
      if (!ctx) return;
      if (cue === 'giggle') this.audio.play3D(giggle(ctx, Math.floor(Math.random() * 1000)), x, 1.9, z, { gain: 0.85, ref: 2.2, wet: 0.6 });
      else {
        // підвівся з води — важкий сплеск і стікання; пірнув — глухий бульк
        const b = this.splash();
        if (b) this.audio.play3D(b, x, 0, z, { gain: cue === 'emerge' ? 1.6 : 1.0, rate: cue === 'emerge' ? 0.55 : 0.45, ref: 3, wet: 0.6 });
      }
    };
    lvl.scene.add(s.root);
    this.stalker = s;
    // капсула ~1.7 м, зіштовхується лише з речами (гравця й стіни не чіпає — його рух веде navmesh)
    const R = physics.R, body = physics.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(s.pos.x, 0.85, s.pos.z));
    physics.world.createCollider(R.ColliderDesc.capsule(0.55, 0.27).setCollisionGroups(groups(G.MONSTER, G.PROP)), body);
    this.pusher = { body, physics };
    if (kind === 'blind' && ctx) this.voice = this.audio.play3D(tongueClicks(ctx, 3), home.x, 1.6, home.z, { loop: true, gain: 0.7, ref: 2.2, wet: 0.5 });
    if (kind === 'drowned' && ctx) this.voice = this.audio.play3D(drownedBreath(ctx), home.x, 0.4, home.z, { loop: true, gain: 0.3, ref: 2, wet: 0.5 });
    const br = kind === 'watcher' ? this.sfx.pick('breath_') : null;
    if (br) this.breath = this.audio.play3D(br, home.x, 1.7, home.z, { loop: true, gain: 0, rate: 0.7, ref: 1.4, wet: 0.3 });
  }

  /** Голос кожного монстра — той самий запис, але своя «глотка»: низький «Наблюдатель», різкий «Слепой», булькіт «Утопленника». */
  private static readonly THROAT: Record<StalkerKind, number> = { watcher: 0.72, blind: 1.12, smiler: 0.9, drowned: 0.56 };

  /** Звук переходу стану: помітив щось — глухе гарчання; кинувся в погоню — рик (а «Улыбчивая» — сміється). */
  private cue(s: Stalker, st: string, d: number, occl: number): void {
    const sp = s.pos, rate = Hunt.THROAT[s.kind] * (0.94 + Math.random() * 0.12), ctx = this.audio.ctx;
    if (st === 'chase' && this.prevState !== 'chase' && this.snarlCd <= 0) {
      this.snarlCd = 16 + Math.random() * 8;
      if (s.kind === 'smiler' && ctx) { this.audio.play3D(giggle(ctx, Math.floor(Math.random() * 1000)), sp.x, 1.9, sp.z, { gain: 1.1, ref: 2.4, wet: 0.6, occlusion: occl }); return; }
      const b = this.sfx.pick('snarl_');
      if (b) this.audio.play3D(b, sp.x, 1.6, sp.z, { gain: 1.25, rate, ref: 2.6, wet: 0.55, occlusion: occl });
    } else if ((st === 'suspicious' || st === 'investigate') && this.prevState !== st && this.prevState !== 'chase' && this.growlCd <= 0 && d < 26) {
      this.growlCd = 12 + Math.random() * 8;
      const b = this.sfx.pick('growl_');
      if (b) this.audio.play3D(b, sp.x, 1.5, sp.z, { gain: st === 'suspicious' ? 0.45 : 0.7, rate: rate * 0.92, ref: 2, wet: 0.6, occlusion: occl });
    }
  }

  /** Тіло мисливця — за ним. Стрибок (ривок «Наблюдателя», поява) — переставити, а не «пролетіти» крізь кімнату;
   *  під водою («Утопленник» на дні) — прибрати вниз, щоб не штовхав речі з-під води. */
  private movePusher(s: Stalker): void {
    const p = this.pusher;
    if (!p) return;
    const t = p.body.translation(), x = s.pos.x, z = s.pos.z, y = s.sub > 0.5 ? -5 : 0.85;
    if (Math.hypot(x - t.x, z - t.z) > 0.6 || Math.abs(y - t.y) > 0.1) p.body.setTranslation({ x, y, z }, true);
    else p.body.setNextKinematicTranslation({ x, y, z });
  }

  dispose(): void {
    if (this.pusher) { const { body, physics } = this.pusher; if (physics.world.getRigidBody(body.handle)) physics.world.removeRigidBody(body); this.pusher = null; }
    this.voice?.stop(0.2);
    this.voice = null;
    this.breath?.stop(0.2);
    this.breath = null;
    this.prevState = ''; this.growlCd = 4; this.snarlCd = 0;
    this.stalker = null;
    this.nav?.destroy();
    this.nav = null;
    this.danger = 0;
    this.flashCut = 0; this.cutCd = 6;
    if (this.heartGain) this.heartGain.gain.value = 0;
  }

  /** Заглушити синтезоване серце (у сцені смерті б'ється справжнє, записане). */
  muteHeart(): void { if (this.heartGain) this.heartGain.gain.value = 0; }

  /** Мінімальне серцебиття від нервів Оператора (психологічний шар). */
  heartFloor = 0;

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
    // серце чути й від нервів, але небезпекою це не рахується (інакше нерви підганяли б самі себе)
    const beat = Math.max(this.danger, this.heartFloor);
    (this.heartGain as GainNode).gain.value = Math.max(0, beat - 0.12) * 1.1;
    this.heart.playbackRate.value = 0.85 + beat * 0.7;
  }

  /** Шум від гравця чи дверей. */
  noise(x: number, y: number, z: number, loudness: number): void {
    this.stalker?.hear(x, y, z, loudness);
  }

  update(dt: number, lvl: Level, player: Player, cam: THREE.Camera, flashlightOn: boolean, physics: Physics,
    hidden: { x: number; z: number; seen: boolean } | null = null): void {
    const s = this.stalker;
    if (!s) { this.heartbeat(dt, 0); return; } // без мисливця серце чути лише від нервів
    this.movePusher(s);
    const v = this.view, sp = s.pos;
    Object.assign(v, { x: player.pos.x, y: player.pos.y, z: player.pos.z, vx: player.vx, vz: player.vz, flashlightOn, crouched: player.crouched, hidden: !!hidden, hiddenSeen: !!hidden?.seen });
    if (hidden) {
      v.x = hidden.x; v.z = hidden.z; v.vx = v.vz = 0;
      // бачив, як гравець зачинився в шафці: пам'ятає саме її — йде туди й відчиняє
      if (hidden.seen) { s.brain.mem.last = { x: hidden.x, y: 0, z: hidden.z }; s.brain.mem.age = 0; s.brain.mem.confidence = 1; if (s.brain.state !== 'chase') s.brain.state = 'chase'; }
    }
    v.light = probeAt(lvl.layout.lights, v.x, v.z);
    // чи бачить гравець монстра: у кадрі (кут від погляду), без стін між ними, і монстр освітлений (лампа чи ліхтарик)
    const c = cam.position, dx = sp.x - c.x, dz = sp.z - c.z, d = Math.hypot(dx, dz);
    this.fwd.set(0, 0, -1).applyQuaternion(cam.quaternion);
    const ang = Math.acos(Math.max(-1, Math.min(1, (this.fwd.x * dx + this.fwd.z * dz) / Math.max(1e-3, d * Math.hypot(this.fwd.x, this.fwd.z)))));
    const clear = d < 40 && ang < 0.75 && physics.lineOfSight(c.x, c.y, c.z, sp.x, 1.4, sp.z);
    v.litByFlashlight = clear && flashlightOn && ang < 0.42 && d < 18;
    const near = lvl.lamps.nearest(sp.x, sp.z, 1)[0];
    const lampLit = probeAt(lvl.layout.lights, sp.x, sp.z) * (near === undefined ? 0 : lvl.lamps.levelOf(near));
    // «Наблюдатель» зблизька в темряві: ліхтарик зрідка «провалюється» на пів секунди — і цього досить для ривка.
    // Рідко (раз на 10–16 с, лише в погоні ближче 9 м і лише коли його тримає саме ліхтарик): страшно, але чесно.
    this.flashCut = Math.max(0, this.flashCut - dt);
    this.cutCd = Math.max(0, this.cutCd - dt);
    if (s.kind === 'watcher' && s.brain.state === 'chase' && d < 9 && v.litByFlashlight && lampLit < 0.3 && this.cutCd <= 0 && Math.random() < dt * 0.3) {
      this.flashCut = 0.35 + Math.random() * 0.25;
      this.cutCd = 10 + Math.random() * 6;
    }
    if (this.flashCut > 0) v.litByFlashlight = false;
    v.looksAtMe = clear && (v.litByFlashlight || lampLit > 0.3 || d < 2.2);
    if (hidden) { v.looksAtMe = false; v.litByFlashlight = false; } // крізь жалюзі «тримати поглядом» не вийде
    s.update(dt, v);
    const st = s.brain.state, dist = Math.hypot(sp.x - v.x, sp.z - v.z);
    // голос монстра: крізь стіни — глухо (без прямої видимості — приглушений)
    this.growlCd -= dt; this.snarlCd -= dt;
    if (st !== this.prevState) {
      const occl = d < 30 && physics.lineOfSight(c.x, c.y, c.z, sp.x, 1.5, sp.z) ? 0 : 0.65;
      this.cue(s, st, d, occl);
      this.prevState = st;
    }
    if (this.breath) {
      // «Наблюдатель» дихає, лише поки ти відвернувся; чим ближче — тим чутніше. Обернувся — подих обривається.
      const want = !v.looksAtMe && !hidden && dist < 10 ? (1 - dist / 10) ** 1.5 * (st === 'chase' ? 1.4 : 0.8) : 0;
      const g = this.breath.gain.gain;
      g.value += (want - g.value) * Math.min(1, dt * (want > g.value ? 1.5 : 12));
      this.breath.setPosition(sp.x, 1.7, sp.z);
    }
    const close = Math.max(0, 1 - dist / 14);
    this.heartbeat(dt, st === 'chase' ? 1 : Math.max(close * (v.looksAtMe ? 1 : 0.6), st === 'investigate' || st === 'search' ? 0.45 : 0));
    // «Утопленник»: під водою — ледь чутні бульбашки; вийшов — хрипкий мокрий подих
    if (this.voice && s.kind === 'drowned') {
      this.voice.setPosition(sp.x, 1.4 - s.sub * 1.5, sp.z);
      this.voice.gain.gain.value = 0.18 + (1 - s.sub) * (st === 'chase' ? 1.0 : 0.65);
    } else if (this.voice) { // клацання голосніші, коли він полює
      this.voice.setPosition(sp.x, 1.6, sp.z);
      const hunting = s.brain.state === 'chase' || s.brain.state === 'investigate';
      this.voice.gain.gain.value = hunting ? 1.0 : s.brain.state === 'suspicious' ? 0.8 : 0.45;
      // клацання частішають, коли він поруч (і ще більше — коли полює)
      const r = this.voice.src.playbackRate;
      r.value += (blindClickRate(dist, hunting) - r.value) * Math.min(1, dt * 3);
    }
  }
}
