// Звук гри поза мисливцями: кроки за поверхнею (і хлюпіт у воді), фон рівня, гул ламп (голоси «переїжджають» до
// найближчих ламп), гул Швів, телефон, звуки завдань (печатки, задвижки, насос…), машинка й папір, дозиметр.
import type { AudioEngine, SpatialVoice } from '../audio/audio';
import type { SoundBank } from '../audio/bank';
import { humLoop, footstepCarpet, typeClick, paperRustle, seamDrone, geigerClick, phoneRing } from '../audio/synth';
import { musicBox, splashStep, pumpLoop, kinderAmbience, poolAmbience } from '../audio/synth2';
import type { Level } from '../world/level0';
import type { Seam } from '../world/seam';
import type { Hunt } from './hunt';
import { surfaceAt } from './soundscape';

export type TaskSoundName = 'take' | 'stamp' | 'fuse' | 'gen' | 'radio' | 'valve' | 'pin' | 'pump' | 'canister';

export class GameSound {
  private steps: AudioBuffer[] = [];
  private clicks: AudioBuffer[] = [];
  private geiger: AudioBuffer[] = [];
  rustle: AudioBuffer | null = null;
  private stepIdx = 0;
  private clickIdx = 0;
  private humVoices: { voice: SpatialVoice; lamp: number }[] = [];
  private humT = 0;
  private seamVoices: SpatialVoice[] = [];
  private ambSrc: AudioBufferSourceNode | null = null;
  /** Гучність фону рівня (стихає в «тишу»). */
  ambGain: GainNode | null = null;
  phoneVoice: SpatialVoice | null = null;
  /** Генератор / насос, що працює (петля). */
  genVoice: SpatialVoice | null = null;

  constructor(private readonly audio: AudioEngine, private readonly sfx: SoundBank, private readonly hunt: Hunt) {}

  /** Після першого жесту: синтезовані звуки, записані (CC0), гул Швів і ламп. onBank — коли записані завантажились. */
  prepare(onBank: () => void): void {
    const ctx = this.audio.ctx;
    if (!ctx || this.steps.length) return;
    for (let i = 0; i < 8; i++) this.steps.push(footstepCarpet(ctx, i + 1));
    for (let i = 0; i < 6; i++) this.clicks.push(typeClick(ctx, i + 1));
    this.rustle = paperRustle(ctx, 1);
    for (let i = 0; i < 4; i++) this.geiger.push(geigerClick(ctx, i + 1));
    // тихий фоновий трек рівня (наш, ACE-Step): шар під гулом ламп
    void this.sfx.load(ctx, `${import.meta.env.BASE_URL}assets/sfx/`).then(onBank);
    // гул Шва і (тихіше, глухіше) прихованого розлому
    const drone = seamDrone(ctx);
    for (const [gain, ref] of [[0.9, 1.5], [0.5, 0.9]] as const) {
      const v = this.audio.play3D(drone, 0, -100, 0, { loop: true, gain, ref, wet: 0.4, rate: ref < 1 ? 0.8 : 1 });
      if (v) this.seamVoices.push(v);
    }
    const hum = humLoop(ctx, 4, 3);
    // гул: 6 голосів «переїжджають» до найближчих ламп, що світять
    for (let i = 0; i < 6; i++) {
      const v = this.audio.play3D(hum, 0, -100, 0, { loop: true, gain: 0.45, ref: 1.1, wet: 0.12, rate: 0.985 + i * 0.006 });
      if (v) this.humVoices.push({ voice: v, lamp: -1 });
    }
  }

  /** Фон рівня, телефон (доки не знімуть трубку), гул Швів — до нового рівня. */
  levelAudio(lvl: Level, phone: { x: number; y: number; z: number } | null): void {
    if (!this.sfx.ready) return;
    this.ambSrc?.stop();
    const ctx = this.audio.ctx, bus = this.audio.music;
    // рівні 3–4 — синтезований фон (дитсадок: тиша й далека скринька; басейн: краплі й вода)
    const amb = this.sfx.get(`amb_l${lvl.id}`) ?? (ctx && lvl.id === 3 ? kinderAmbience(ctx) : ctx && lvl.id === 4 ? poolAmbience(ctx) : null);
    if (!this.ambGain && ctx && bus) { this.ambGain = ctx.createGain(); this.ambGain.connect(bus); }
    this.ambSrc = amb && this.ambGain ? this.audio.play2D(amb, 0.32, 1, this.ambGain) : null;
    if (this.ambSrc) this.ambSrc.loop = true;
    this.phoneVoice?.stop(0.05); this.phoneVoice = null;
    if (phone && ctx) this.phoneVoice = this.audio.play3D(phoneRing(ctx), phone.x, phone.y, phone.z, { loop: true, gain: 0.9, ref: 2.2, wet: 0.45 });
    const seams: (Seam | undefined)[] = [lvl.seam, lvl.rift];
    this.seamVoices.forEach((v, i) => {
      const p = seams[i]?.group.position;
      v.setPosition(p ? p.x : 0, p ? 1.3 : -100, p ? p.z : 0);
    });
  }

  stopGen(): void { this.genVoice?.stop(0.2); this.genVoice = null; }

  /** Клацання друкарської машинки (пролог, фінал). */
  typeClick(): void {
    const b = this.clicks[this.clickIdx++ % Math.max(1, this.clicks.length)];
    if (b) this.audio.play2D(b, 0.5, 0.95 + Math.random() * 0.1);
  }

  /** Тріск дозиметра (n клацань). */
  geigerClicks(n: number): void {
    for (let i = 0; i < n; i++) {
      const b = this.geiger[(Math.random() * this.geiger.length) | 0];
      if (b) this.audio.play2D(b, 0.32 + Math.random() * 0.1, 0.92 + Math.random() * 0.16);
    }
  }

  /** Крок гравця: звук за поверхнею (у воді — хлюпіт, гучніший) і шум для мисливця. */
  footstep(lvl: Level | null, x: number, y: number, z: number, loud: number): void {
    if (lvl?.water?.wetAt(x, z)) {
      const sp = this.hunt.splash();
      if (sp) this.audio.play3D(sp, x, y + 0.02, z, { gain: 0.55 + loud * 0.6, rate: 0.92 + Math.random() * 0.16, ref: 2, wet: 0.5 });
      this.hunt.noise(x, y, z, Math.min(1.4, loud * 2.2 + 0.25));
      return;
    }
    // паркет — дзвінкий дерев'яний стук, лінолеум — глухіший, бетон — нижчий і з луною, кахель — дзвінкий з довгою луною
    const surf = lvl ? surfaceAt(lvl, x, z) : 'linoleum';
    const rec = this.sfx.ready ? this.sfx.pick(surf === 'linoleum' ? 'carpet_' : 'step_') : null;
    const b = rec ?? this.steps[this.stepIdx++ % Math.max(1, this.steps.length)];
    const k = surf === 'parquet' ? { g: 0.75, r: 1.04, w: 0.22 } : surf === 'concrete' ? { g: 0.85, r: 0.9, w: 0.4 } : surf === 'tile' ? { g: 0.9, r: 1.12, w: 0.55 } : { g: 1, r: 1, w: 0.2 };
    if (b) this.audio.play3D(b, x, y + 0.05, z, { gain: (0.35 + loud * 0.65) * k.g, rate: k.r * (0.94 + Math.random() * 0.12), ref: 2, wet: k.w });
    this.hunt.noise(x, y, z, loud);
  }

  /** Гул ламп: голоси на найближчих лампах; гучність — від яскравості лампи й «тиші» (quiet 0..1). */
  updateHum(dt: number, lvl: Level, cx: number, cz: number, quiet: number): void {
    this.humT -= dt;
    if (this.humT <= 0 && this.humVoices.length) {
      this.humT = 0.4;
      const near = lvl.lamps.nearest(cx, cz, this.humVoices.length);
      this.humVoices.forEach((h, i) => {
        const li = near[i];
        if (li === undefined) { h.voice.setPosition(0, -100, 0); h.lamp = -1; return; }
        const p = lvl.layout.lights[li];
        if (p) h.voice.setPosition(p.x, lvl.layout.height - 0.05, p.z);
        h.lamp = li;
      });
    }
    for (const h of this.humVoices) h.voice.gain.gain.value = h.lamp >= 0 ? 0.45 * lvl.lamps.levelOf(h.lamp) * quiet : 0;
    if (this.ambGain) this.ambGain.gain.value = quiet;
  }

  /** Звуки завдань рівнів. */
  task(n: TaskSoundName, x: number, y: number, z: number): void {
    const ctx = this.audio.ctx;
    if (n === 'valve') {
      const c = this.sfx.pick('creak'), m = this.sfx.get('metalclick');
      if (c) this.audio.play3D(c, x, y, z, { gain: 1, rate: 0.55, ref: 2.5, wet: 0.5 });
      if (m) this.audio.play3D(m, x, y, z, { gain: 0.8, rate: 0.5, ref: 2, wet: 0.4 });
      return;
    }
    if (n === 'canister') {
      const c = this.sfx.pick('cloth') ?? this.sfx.get('metalclick');
      if (c) this.audio.play3D(c, x, y, z, { gain: 0.8, rate: 0.7, ref: 2, wet: 0.3 });
      if (ctx) this.audio.play3D(splashStep(ctx, 3), x, y + 0.3, z, { gain: 0.5, rate: 1.4, ref: 1.5, wet: 0.3 });
      return;
    }
    if (n === 'pin') {
      const m = this.sfx.get('metalclick');
      if (m) this.audio.play3D(m, x, y, z, { gain: 0.5, rate: 2.2, ref: 1.5, wet: 0.2 });
      // десь у групі заводиться музична скринька
      if (ctx) setTimeout(() => this.audio.play3D(musicBox(ctx), x + 6, 1.0, z - 4, { gain: 1.1, ref: 3, wet: 0.7 }), 1400);
      return;
    }
    if (n === 'gen' || n === 'pump') {
      if (!ctx || this.genVoice) return;
      this.genVoice = n === 'pump'
        ? this.audio.play3D(pumpLoop(ctx), x, y, z, { loop: true, gain: 2.4, ref: 5, wet: 0.7 })
        : this.audio.play3D(humLoop(ctx, 4, 9), x, y, z, { loop: true, gain: 2.2, rate: 0.42, ref: 5, wet: 0.6 });
      const hit = this.sfx.pick('hit_');
      if (hit) this.audio.play3D(hit, x, y, z, { gain: 0.8, rate: 0.6, ref: 4, wet: 0.5 });
      return;
    }
    const b = n === 'stamp' ? this.sfx.pick('doorclose') : this.sfx.get('metalclick');
    if (b) this.audio.play3D(b, x, y, z, { gain: n === 'stamp' ? 0.5 : 0.7, rate: n === 'stamp' ? 2.1 : n === 'fuse' ? 0.75 : 1.2, ref: 1.6, wet: 0.3 });
  }
}
