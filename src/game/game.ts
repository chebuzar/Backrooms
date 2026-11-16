// Ядро гри: режими (меню / гра / пауза), фіксований крок фізики (60 Гц), рендер із частотою екрана,
// камера згладжується між кроками. Налаштування застосовуються на льоту.
import * as THREE from 'three/webgpu';
import type { RendererHandle } from '../render/renderer';
import { PostPipeline, look } from '../render/post';
import { PROFILES, QualityGovernor, autoQuality, type QualityProfile } from '../render/quality';
import type { DeviceInfo } from '../core/device';
import { Physics } from '../physics/physics';
import { Player } from './player';
import { CameraRig } from './camera-rig';
import { Input } from '../input/input';
import { AudioEngine } from '../audio/audio';
import { humLoop, footstepCarpet } from '../audio/synth';
import { Store, type Settings } from '../core/save';
import { UI } from '../ui/screens';
import { T } from '../i18n/ru';
import { buildTestScene } from '../dev/testScene';

const STEP = 1 / 60;
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
  private time = 0;
  private levelUpdate: (t: number) => void = () => {};
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

  async init(): Promise<void> {
    this.physics = await Physics.create();
    const lvl = buildTestScene(this.physics);
    this.setScene(lvl.scene);
    this.levelUpdate = lvl.update;
    this.player = new Player(this.physics, ...lvl.spawn);
    this.player.onFootstep = (e) => this.footstep(e.x, e.y, e.z, e.loudness);
    this.applySettings(this.store.settings);
    this.input.enabled = false;
    this.resize();
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
    const hum = humLoop(ctx, 4, 3);
    for (const [x, z] of [[-3, -3], [3, -3], [0, 2]] as const) this.audio.play3D(hum, x, 2.6, z, { loop: true, gain: 0.5, ref: 1.2, wet: 0.15 });
  }

  private footstep(x: number, y: number, z: number, loud: number): void {
    const b = this.steps[this.stepIdx++ % Math.max(1, this.steps.length)];
    if (b) this.audio.play3D(b, x, y + 0.05, z, { gain: 0.35 + loud * 0.65, rate: 0.94 + Math.random() * 0.12, ref: 2, wet: 0.25 });
  }

  applySettings(s: Settings): void {
    look.exposure.value = s.brightness;
    this.camera.fov = s.fov; this.camera.updateProjectionMatrix();
    this.audio.setVolumes(s.masterVolume, s.musicVolume, s.sfxVolume);
    Object.assign(this.input.settings, { sensitivity: s.sensitivity, invertY: s.invertY, crouchToggle: s.crouchToggle });
    const p = this.qualityFromSettings();
    if (p !== this.profile && this.mode !== 'boot') { this.profile = p; this.post.apply(p); this.resize(); }
    this.store.save();
  }

  // ---------- потік екранів ----------
  async run(): Promise<void> {
    this.start();
    this.mode = 'menu';
    await this.ui.age(this.store.data.ageConfirmed);
    this.store.data.ageConfirmed = true; this.store.save();
    this.audio.unlock(); this.prepareAudio();
    this.showMenu();
  }

  private showMenu(): void {
    this.mode = 'menu';
    this.input.enabled = false; this.input.touch?.show(false);
    this.ui.onBack = null;
    this.ui.menu({
      canContinue: !!this.store.progress.checkpoint,
      onContinue: () => this.play(),
      onStart: () => { this.store.newGame(); this.play(); },
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

  play(): void {
    this.ui.closeAll();
    this.mode = 'play';
    this.input.enabled = true;
    this.input.touch?.show(true);
    this.input.lockPointer();
    this.ui.onBack = null;
    this.audio.unlock(); this.prepareAudio();
  }

  pause(): void {
    if (this.mode !== 'play') return;
    this.mode = 'pause';
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
    const dtMs = Math.min(100, now - this.last);
    this.last = now;
    const dt = dtMs / 1000;
    if (this.mode === 'play' && this.governor.update(dtMs)) this.resize();
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
    this.levelUpdate(this.time);
    this.rig.update(this.player, this.acc / STEP, dt);
    const c = this.camera, f = new THREE.Vector3(0, 0, -1).applyQuaternion(c.quaternion);
    this.audio.updateListener({ x: c.position.x, y: c.position.y, z: c.position.z, fx: f.x, fy: f.y, fz: f.z });
    this.post.render();
  }

  start(): void {
    this.gfx.renderer.setAnimationLoop(() => this.frame());
  }
}
