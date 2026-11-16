// Ядро гри: режими (меню / гра / пауза), фіксований крок фізики (60 Гц), рендер із частотою екрана,
// камера згладжується між кроками. Налаштування застосовуються на льоту.
import * as THREE from 'three/webgpu';
import type { RendererHandle } from '../render/renderer';
import { PostPipeline, look } from '../render/post';
import { lampDeficits } from '../world/materials';
import { PROFILES, QualityGovernor, autoQuality, type QualityProfile } from '../render/quality';
import type { DeviceInfo } from '../core/device';
import { Physics } from '../physics/physics';
import { Player } from './player';
import { CameraRig } from './camera-rig';
import { Input } from '../input/input';
import { AudioEngine, type SpatialVoice } from '../audio/audio';
import { humLoop, footstepCarpet, typeClick, paperRustle, seamDrone } from '../audio/synth';
import { SoundBank } from '../audio/bank';
import { HUD } from '../ui/hud';
import { Ambience } from './ambience';
import { Interactions } from './interact';
import { DOCS, PROLOGUE, OBJECTIVES, HINTS, LEVEL_END } from '../story/ru';
import { Store, type Settings } from '../core/save';
import { UI } from '../ui/screens';
import { T } from '../i18n/ru';
import { Assets } from '../assets/loader';
import { buildLevel0, type Level } from '../world/level0';

const STEP = 1 / 60;
/** Базова експозиція «камери»; налаштування «Яркость» множить її. */
const BASE_EXPOSURE = 1.9;
type Mode = 'boot' | 'menu' | 'play' | 'pause';

export class Game {
  readonly camera = new THREE.PerspectiveCamera(72, 16 / 9, 0.05, 150);
  scene = new THREE.Scene();
  readonly post: PostPipeline;
  readonly governor = new QualityGovernor();
  readonly input: Input;
  readonly rig: CameraRig;
  readonly audio = new AudioEngine();
  readonly store = new Store();
  readonly ui: UI;
  player!: Player;
  physics!: Physics;
  mode: Mode = 'boot';
  profile: QualityProfile;
  private acc = 0;
  private last = performance.now();
  private lastDraw = 0;
  /** Обмеження FPS (0 — без обмеження). */
  fpsCap = 60;
  /** Автопідлаштування роздільності (вимикає тест швидкодії й debug-панель). */
  autoScale = true;
  /** Гачки для інструментів (debug-панель, тест швидкодії): виклик після кадру й керування камерою. */
  onFrame: ((dtMs: number) => void) | null = null;
  cameraOverride: ((cam: THREE.PerspectiveCamera, dt: number) => void) | null = null;
  private time = 0;
  level: Level | null = null;
  assets!: Assets;
  private loading: Promise<void> | null = null;
  private humVoices: { voice: SpatialVoice; lamp: number }[] = [];
  private humT = 0;
  private dimT = 0;
  /** Записані звуки (CC0): кроки, двері, папір, ліхтарик, тканина, удари, фон. */
  readonly sfx = new SoundBank();
  flashlightOn = false;
  hud!: HUD;
  readonly ambience = new Ambience(this.audio);
  interact!: Interactions;
  private clicks: AudioBuffer[] = [];
  private rustle: AudioBuffer | null = null;
  private stage: 'desk' | 'seam' | 'done' = 'desk';
  private ending = false;
  private steps: AudioBuffer[] = [];
  private stepIdx = 0;

  constructor(readonly gfx: RendererHandle, readonly device: DeviceInfo, forced: QualityProfile | null) {
    const canvas = gfx.renderer.domElement;
    this.profile = forced ?? this.qualityFromSettings();
    this.post = new PostPipeline(gfx.renderer, this.scene, this.camera);
    const s = this.store.settings;
    const uiRoot = document.getElementById('ui') as HTMLElement;
    this.input = new Input(canvas, uiRoot, { sensitivity: s.sensitivity, invertY: s.invertY, crouchToggle: s.crouchToggle });
    this.ui = new UI(uiRoot);
    this.hud = new HUD(uiRoot);
    this.rig = new CameraRig(this.camera);
    canvas.addEventListener('click', () => { if (this.mode === 'play') this.input.lockPointer(); });
    document.addEventListener('pointerlockchange', () => { if (!this.input.pointerLocked && this.mode === 'play' && !this.device.touch) this.pause(); });
    // будь-який жест «оживляє» звук (iOS)
    for (const ev of ['pointerdown', 'keydown', 'touchend'] as const) addEventListener(ev, () => this.audio.unlock(), { passive: true });
    addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.mode === 'play') this.pause(); });
  }

  private qualityFromSettings(): QualityProfile {
    const q = this.store.settings.quality;
    return PROFILES[q === 'auto' ? autoQuality(this.device, this.gfx.backend === 'webgpu') : q];
  }

  async init(onProgress: (p: number) => void = () => {}): Promise<void> {
    this.physics = await Physics.create();
    this.assets = new Assets(this.gfx.renderer);
    const lvl = await buildLevel0(this.assets, this.physics, onProgress);
    this.level = lvl;
    this.setScene(lvl.scene);
    const s = lvl.layout.spawn;
    this.player = new Player(this.physics, s.x, 0, s.z);
    this.player.yaw = s.yaw;
    this.player.onFootstep = (e) => this.footstep(e.x, e.y, e.z, e.loudness);
    this.setupInteractions(lvl);
    this.applySettings(this.store.settings);
    this.input.enabled = false;
    this.resize();
    // заздалегідь скомпілювати шейдери, щоб не було ривків при першому погляді на щось нове
    try { this.gfx.renderer.setRenderTarget(null); await this.gfx.renderer.compileAsync(lvl.scene, this.camera); } catch { /* не критично */ }
  }

  private setScene(s: THREE.Scene): void {
    this.scene = s;
    this.post.scene = s;
    this.post.apply(this.profile);
  }

  private prepareAudio(): void {
    const ctx = this.audio.ctx;
    if (!ctx || this.steps.length) return;
    for (let i = 0; i < 8; i++) this.steps.push(footstepCarpet(ctx, i + 1));
    for (let i = 0; i < 6; i++) this.clicks.push(typeClick(ctx, i + 1));
    this.rustle = paperRustle(ctx, 1);
    void this.sfx.load(ctx, `${import.meta.env.BASE_URL}assets/sfx/`).then(() => {
      // тихий фоновий трек рівня (наш, ACE-Step): шар під гулом ламп
      const amb = this.sfx.get('amb_l0');
      const bus = this.audio.music;
      const src = amb && bus ? this.audio.play2D(amb, 0.32, 1, bus) : null;
      if (src) src.loop = true;
    });
    this.ambience.prepare();
    const sp = this.level?.seam.group.position;
    if (sp) this.audio.play3D(seamDrone(ctx), sp.x, 1.3, sp.z, { loop: true, gain: 0.9, ref: 1.5, wet: 0.4 });
    const hum = humLoop(ctx, 4, 3);
    // гул: 6 голосів «переїжджають» до найближчих ламп, що світять
    for (let i = 0; i < 6; i++) {
      const v = this.audio.play3D(hum, 0, -100, 0, { loop: true, gain: 0.45, ref: 1.1, wet: 0.12, rate: 0.985 + i * 0.006 });
      if (v) this.humVoices.push({ voice: v, lamp: -1 });
    }
  }

  private footstep(x: number, y: number, z: number, loud: number): void {
    // записані кроки (на килимі — приглушені); поки бібліотека вантажиться — синтез
    const rec = this.sfx.ready ? this.sfx.pick('carpet_') : null;
    const b = rec ?? this.steps[this.stepIdx++ % Math.max(1, this.steps.length)];
    if (b) this.audio.play3D(b, x, y + 0.05, z, { gain: 0.35 + loud * 0.65, rate: 0.94 + Math.random() * 0.12, ref: 2, wet: 0.25 });
  }

  applySettings(s: Settings): void {
    look.exposure.value = BASE_EXPOSURE * s.brightness;
    this.camera.fov = s.fov; this.camera.updateProjectionMatrix();
    this.fpsCap = s.fpsLimit === 'off' ? 0 : Number(s.fpsLimit);
    this.audio.setVolumes(s.masterVolume, s.musicVolume, s.sfxVolume);
    Object.assign(this.input.settings, { sensitivity: s.sensitivity, invertY: s.invertY, crouchToggle: s.crouchToggle });
    const p = this.qualityFromSettings();
    if (p !== this.profile && this.mode !== 'boot') { this.profile = p; this.post.apply(p); this.resize(); }
    this.store.save();
  }

  // ---------- потік екранів ----------
  async run(): Promise<void> {
    this.mode = 'menu';
    // рівень вантажиться, поки гравець читає попередження
    let pct = 0;
    const bar = document.createElement('div');
    bar.className = 'loadline';
    this.loading = this.init((p) => { pct = p; bar.textContent = `Подготовка экспедиции… ${Math.round(p * 100)} %`; }).then(() => this.start());
    await this.ui.age(this.store.data.ageConfirmed);
    if (pct < 1) {
      bar.textContent = `Подготовка экспедиции… ${Math.round(pct * 100)} %`;
      document.getElementById('ui')?.appendChild(bar);
    }
    await this.loading;
    bar.remove();
    this.store.data.ageConfirmed = true; this.store.save();
    this.audio.unlock(); this.prepareAudio();
    this.showMenu();
  }

  private showMenu(): void {
    this.mode = 'menu';
    this.hud.show(false);
    this.input.enabled = false; this.input.touch?.show(false);
    this.ui.onBack = null;
    this.ui.menu({
      canContinue: !!this.store.progress.checkpoint,
      onContinue: () => this.play(),
      onStart: () => { this.store.newGame(); void this.startNewGame(); },
      onSettings: () => this.openSettings(() => this.showMenu()),
      onAbout: () => { this.ui.close('menu'); this.ui.about(() => this.showMenu()); }
    });
  }

  private openSettings(back: () => void): void {
    const auto = autoQuality(this.device, this.gfx.backend === 'webgpu');
    const dev = `${this.device.platform === 'apple' ? 'Apple' : this.device.platform === 'android' ? 'Android' : 'ПК'}, ${this.gfx.backend === 'webgpu' ? 'WebGPU' : 'WebGL 2'}`;
    for (const n of ['menu', 'pause']) this.ui.close(n);
    this.ui.onBack = () => { this.ui.close('settings'); back(); };
    this.ui.settings(this.store.settings, T.settings.device(dev, T.settings.qualities[auto]), (s) => this.applySettings(s), back);
  }

  private async startNewGame(): Promise<void> {
    this.ui.closeAll();
    this.input.enabled = false;
    this.audio.unlock(); this.prepareAudio();
    let k = 0;
    await this.hud.prologue(PROLOGUE, () => { const b = this.clicks[k++ % Math.max(1, this.clicks.length)]; if (b) this.audio.play2D(b, 0.5, 0.95 + Math.random() * 0.1); });
    const s = this.level?.layout.spawn;
    if (s) this.player.teleport(s.x, 0, s.z, s.yaw);
    this.player.pitch = 0;
    this.stage = 'desk';
    this.store.progress.checkpoint = { level: 0, spawn: 'start' };
    this.store.save();
    this.play();
    this.hud.setObjective(OBJECTIVES.level0Start);
  }

  private setupInteractions(lvl: Level): void {
    this.interact = new Interactions(this.physics);
    const docSpot = (id: 'order7' | 'note1', after?: () => void) => {
      const s = lvl.spots[id];
      if (!s) return;
      this.interact.add({ id, x: s.x, y: s.y, z: s.z, reach: 1.9, prompt: HINTS.read, enabled: true, use: () => this.readDoc(id, after) });
    };
    docSpot('order7', () => { if (this.stage === 'desk') { this.stage = 'seam'; this.hud.setObjective(OBJECTIVES.level0Find); } });
    docSpot('note1');
    const sp = lvl.seam.group.position;
    this.interact.add({ id: 'seam', x: sp.x, y: 1.3, z: sp.z, reach: 1.7, prompt: HINTS.enterSeam, enabled: true, use: () => void this.enterSeam() });
    // двері: по точці взаємодії з кожного боку прорізу; підказка міняється з відчинено/зачинено
    for (const d of lvl.doors.list) {
      d.sides.forEach(([x, y, z], i) => {
        const doors = lvl.doors;
        this.interact.add({ id: `${d.id}-${i}`, x, y, z, reach: 1.7, enabled: true,
          get prompt() { return d.target > 0.1 ? HINTS.doorShut : HINTS.doorOpen; }, use: () => doors.toggle(d) });
      });
    }
    const doorSound = (name: string, d: { pivot: THREE.Object3D }, gain: number) => {
      const b = this.sfx.pick(name);
      const p = d.pivot.position;
      if (b) this.audio.play3D(b, p.x, 1.2, p.z, { gain, rate: 0.9 + Math.random() * 0.15, ref: 2, wet: 0.4 });
    };
    lvl.doors.onMove = (d, opening) => { doorSound('creak', d, 0.7); if (opening) doorSound('dooropen', d, 0.6); };
    lvl.doors.onShut = (d) => doorSound('doorclose', d, 0.9);
  }

  private readDoc(id: keyof typeof DOCS, after?: () => void): void {
    const d = DOCS[id];
    if (!d) return;
    const flip = this.sfx.pick('bookflip') ?? this.rustle;
    if (flip) this.audio.play2D(flip, 0.8);
    const list = d.kind === 'note' ? this.store.progress.notes : this.store.progress.docs;
    if (!list.includes(id)) { list.push(id); this.store.save(); }
    this.mode = 'pause';
    this.input.enabled = false;
    this.input.touch?.show(false); // кнопки гри не перекривають записку; play() поверне їх
    if (document.pointerLockElement) document.exitPointerLock();
    this.hud.openDoc(d, () => { this.play(); after?.(); });
  }

  private async enterSeam(): Promise<void> {
    if (this.ending || !this.level) return;
    this.ending = true;
    this.input.enabled = false;
    this.mode = 'pause';
    const seam = this.level.seam;
    // Шов розкривається, світ «стискається» й гасне
    const t0 = performance.now();
    await new Promise<void>((done) => {
      const step = () => {
        const k = Math.min(1, (performance.now() - t0) / 2600);
        seam.open.value = k;
        look.fear.value = k;
        look.fade.value = Math.max(0, (k - 0.55) / 0.45);
        this.rig.shake = 0.6 * k;
        if (k < 1) requestAnimationFrame(step); else done();
      };
      step();
    });
    if (!this.store.progress.completed.includes(0)) this.store.progress.completed.push(0);
    this.store.progress.checkpoint = null;
    this.store.save();
    this.stage = 'done';
    if (document.pointerLockElement) document.exitPointerLock();
    this.hud.show(false);
    this.hud.levelEnd(LEVEL_END.title, LEVEL_END.body, LEVEL_END.soon, () => {
      look.fade.value = 0; look.fear.value = 0; seam.open.value = 0; this.ending = false;
      const s = this.level?.layout.spawn;
      if (s) this.player.teleport(s.x, 0, s.z, s.yaw);
      this.showMenu();
    });
  }

  play(): void {
    this.ui.closeAll();
    this.hud.show(true);
    this.mode = 'play';
    this.input.enabled = true;
    this.input.touch?.show(true);
    this.input.lockPointer();
    this.ui.onBack = null;
    this.audio.unlock(); this.prepareAudio();
  }

  pause(): void {
    if (this.mode !== 'play' || this.hud.readerOpen) return;
    this.mode = 'pause';
    this.hud.show(false);
    this.input.enabled = false; this.input.touch?.show(false);
    this.ui.onBack = () => this.play();
    this.ui.pause({
      onResume: () => this.play(),
      onSettings: () => this.openSettings(() => this.pauseMenuAgain()),
      onMenu: () => { this.ui.closeAll(); this.showMenu(); }
    });
  }

  private pauseMenuAgain(): void { this.mode = 'play'; this.pause(); }

  resize(): void {
    const w = innerWidth, h = innerHeight;
    const r = this.gfx.renderer;
    r.setPixelRatio(Math.min(this.device.dpr, this.profile.maxPixelRatio) * this.governor.scale);
    r.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    look.aspect.value = w / h;
  }

  frame(): void {
    const now = performance.now();
    // обмеження частоти: пропускаємо виклики rAF, що прийшли зарано (120 Гц екран → 60, 60 Гц → 30)
    if (this.fpsCap > 0 && now - this.lastDraw < (1000 / this.fpsCap) * 0.92) return;
    this.lastDraw = now;
    const dtMs = Math.min(100, now - this.last);
    this.last = now;
    const dt = dtMs / 1000;
    if (this.mode === 'play' && this.autoScale && this.governor.update(dtMs)) this.resize();
    this.input.poll(dt);
    if (this.input.consume('pause') && this.mode === 'play') this.pause();
    const [lx, ly] = this.input.takeLook();
    this.time += dt;
    if (this.mode === 'play') {
      this.player.look(lx, ly);
      this.acc += dt;
      const m = { x: this.input.move.x, y: this.input.move.y, run: this.input.run, crouch: this.input.crouch };
      while (this.acc >= STEP) { this.player.update(STEP, m); this.physics.step(); this.acc -= STEP; }
    } else if (this.mode === 'menu') {
      // у меню камера повільно «дихає» й оглядає кімнату
      this.player.yaw = Math.sin(this.time * 0.07) * 0.5;
      this.player.pitch = -0.04 + Math.sin(this.time * 0.11) * 0.03;
    }
    if (this.input.consume('flashlight') && this.mode === 'play') {
      this.flashlightOn = !this.flashlightOn;
      const click = this.sfx.get('metalclick');
      if (click) this.audio.play2D(click, 0.5, this.flashlightOn ? 1.1 : 0.9);
    }
    if (this.hud.readerOpen && (this.input.consume('interact') || this.input.consume('pause'))) this.hud.closeDoc();
    const lvl = this.level;
    this.rig.update(this.player, this.acc / STEP, dt);
    this.cameraOverride?.(this.camera, dt);
    if (lvl) {
      lvl.update(this.time, dt, this.camera);
      // живе згасання запеченого світла біля ламп, що мерехтять/згасли (оновлюємо кілька разів на секунду — дешево)
      this.dimT -= dt;
      if (this.dimT <= 0) { this.dimT = 0.05; lvl.lamps.fillDeficits(this.camera.position.x, this.camera.position.z, lampDeficits.array as THREE.Vector4[]); }
      // ліхтарик у руці: трохи нижче й правіше очей, світить туди, куди дивишся
      const fl = lvl.flashlight, c = this.camera;
      fl.intensity += ((this.flashlightOn ? 26 : 0) - fl.intensity) * Math.min(1, dt * 18);
      const spill = fl.children[0] as THREE.SpotLight | undefined;
      if (spill) spill.intensity = fl.intensity * 0.12;
      fl.position.set(0.18, -0.16, 0.05).applyQuaternion(c.quaternion).add(c.position);
      fl.target.position.set(0, -0.08, -6).applyQuaternion(c.quaternion).add(c.position);
      this.humT -= dt;
      if (this.humT <= 0 && this.humVoices.length) {
        this.humT = 0.4;
        const near = lvl.lamps.nearest(c.position.x, c.position.z, this.humVoices.length);
        this.humVoices.forEach((h, i) => {
          const li = near[i];
          if (li === undefined) { h.voice.setPosition(0, -100, 0); h.lamp = -1; return; }
          const p = lvl.layout.lights[li];
          if (p) h.voice.setPosition(p.x, lvl.layout.height - 0.05, p.z);
          h.lamp = li;
        });
      }
      for (const h of this.humVoices) h.voice.gain.gain.value = h.lamp >= 0 ? 0.45 * lvl.lamps.levelOf(h.lamp) : 0;
    }
    const c = this.camera, f = new THREE.Vector3(0, 0, -1).applyQuaternion(c.quaternion);
    if (this.mode === 'play' && this.interact) {
      const it = this.interact.update(c, f.x, f.y, f.z);
      const key = this.input.lastDevice === 'gamepad' ? 'A' : this.input.lastDevice === 'touch' ? '✋' : 'E';
      this.hud.setPrompt(it ? it.prompt : null, key);
      if (it && this.input.consume('interact')) it.use();
      this.store.progress.playSeconds += dt;
      this.ambience.update(dt, this.player);
      this.hud.setTime(this.store.progress.playSeconds);
    } else this.hud.setPrompt(null, '');
    this.hud.update(dt);
    this.audio.updateListener({ x: c.position.x, y: c.position.y, z: c.position.z, fx: f.x, fy: f.y, fz: f.z });
    this.post.render();
    this.onFrame?.(dtMs);
  }

  start(): void {
    this.gfx.renderer.setAnimationLoop(() => this.frame());
  }
}
