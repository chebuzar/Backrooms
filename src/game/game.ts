// Ядро гри: режими (меню / гра / пауза), фіксований крок фізики (60 Гц), рендер із частотою екрана,
// камера згладжується між кроками. Налаштування застосовуються на льоту.
import * as THREE from 'three/webgpu';
import type { RendererHandle } from '../render/renderer';
import { PostPipeline, look } from '../render/post';
import { lampDeficits } from '../world/materials';
import { PROFILES, QualityGovernor, autoQuality, type QualityProfile } from '../render/quality';
import type { DeviceInfo } from '../core/device';
import { Physics, G } from '../physics/physics';
import { Player } from './player';
import { CameraRig } from './camera-rig';
import { Input } from '../input/input';
import { AudioEngine, type SpatialVoice } from '../audio/audio';
import { humLoop, footstepCarpet, typeClick, paperRustle, seamDrone, geigerClick, phoneRing } from '../audio/synth';
import { SoundBank } from '../audio/bank';
import { Figure } from '../world/monsters/figure';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { HUD } from '../ui/hud';
import { Ambience } from './ambience';
import { Interactions } from './interact';
import { DOCS, NOTES, TAPES, FINDINGS, SPECIAL, PROLOGUE, OBJECTIVES, HINTS, LEVEL_END, LEVEL_TITLES, type Doc } from '../story/ru';
import { placeFindings, type Finding } from '../world/findings';
import { placeLockers, type Locker } from '../world/lockers';
import { placeSpecialRooms, type Special } from '../world/special-rooms';
import { TapePlayer } from './tapes';
import { Store, type Settings } from '../core/save';
import { UI } from '../ui/screens';
import { T } from '../i18n/ru';
import { Assets } from '../assets/loader';
import { buildLevel0, type Level } from '../world/level0';
import { buildThemedLevel } from '../world/level-themed';
import { disposeScene } from '../world/chunks';
import { DOOR_H } from '../world/decor';
import type { Seam } from '../world/seam';
import { Hunt } from './hunt';
import { Battery } from './battery';
import { Tutorial, type TipId } from './tutorial';
import { Dosimeter } from './dosimeter';
import { TensionDirector } from './tension';
import { Omens } from './omens';
import { ICONS, svg } from '../input/touch';
import { placeBatteries, type Pickup } from '../world/pickups';

const STEP = 1 / 60;
/** Базова експозиція «камери»; налаштування «Яркость» множить її. */
const BASE_EXPOSURE = 1.9;
type Mode = 'boot' | 'menu' | 'play' | 'pause';

export class Game {
  // далі 70 м туман уже повністю ховає світ (≈ 99 %) — нема сенсу малювати далекі шматки
  readonly camera = new THREE.PerspectiveCamera(72, 16 / 9, 0.05, 70);
  scene = new THREE.Scene();
  readonly post: PostPipeline;
  /** Роздільність рендера — лише в пресеті «Низкая» (правило власника: різкість не жертвуємо в інших пресетах). */
  readonly governor = new QualityGovernor();
  /** Авто-пресет: якщо стабільно < ~40 FPS, крок на пресет нижче (Ультра → Высокое → Среднее); роздільність не чіпаємо. */
  private readonly presetGov = new QualityGovernor(0.7, 1000 / 42);
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
  /** Мисливець рівня 1–2 («Наблюдатель», «Слепой»). */
  readonly hunt = new Hunt(this.audio, this.sfx, {
    onCatch: () => void this.caught(),
    onCloser: (by) => {
      // відвернувся — а він уже значно ближче: різкий удар і здригання
      const b = this.sfx.pick('hit_');
      if (b) this.audio.play2D(b, Math.min(0.9, 0.35 + by * 0.06), 0.9);
      this.rig.shake = Math.max(this.rig.shake, 0.5); look.fear.value = Math.min(1, look.fear.value + 0.45);
    }
  });
  /** «Фигура» рівня 0 (лише присутність). */
  figure: Figure | null = null;
  flashlightOn = false;
  /** Батарея ліхтарика (≈ 12 хв світла); на низькому заряді світло блимає. Заряд — у збереженні. */
  readonly bat = new Battery();
  get battery(): number { return this.bat.level; }
  set battery(v: number) { this.bat.level = v; }
  private persistT = 0;
  /** Ліхтарик упритул до стіни: відстань до поверхні перед ним і плавний множник яскравості. */
  private flashNear = 10;
  private flashK = 1;
  private flashT = 0;
  private readonly fwd = new THREE.Vector3();
  /** «Схопив»: ліхтарик на пів секунди світить на обличчя монстра знизу. */
  private flashOverride: { from: THREE.Vector3; at: THREE.Vector3; intensity: number } | null = null;
  /** Зум камери 2× (V / кнопка камери на дотику): плавний перехід 0..1. */
  zoom = false;
  private zoomK = 0;
  private baseFov = 75;
  /** Навчання керуванню на старті нової гри. */
  private tutorial!: Tutorial;
  private tried = new Set<TipId>();
  /** Дозиметр ДП-5 (R): тріщить скрізь, біля Шва замовкає; тріск чує «Слепой». */
  readonly dosi = new Dosimeter();
  /** Прикмети перед появою мисливця: кроки за спиною, двері грюкають, лампа лускає. */
  readonly tension = new TensionDirector();
  readonly omens = new Omens(this.audio, this.sfx);
  /** Записки й плівки поточного рівня. */
  private findings: Finding[] = [];
  /** Шафки (рівень 1) і стан «сховався»: погляд крізь жалюзі, відхилення погляду від прямого. */
  private lockers: Locker[] = [];
  /** Особливі кімнати рівня 0 і дзвінок телефона (доки не знімеш трубку). */
  private specials: Special[] = [];
  private phoneVoice: SpatialVoice | null = null;
  private phoneAnswered = false;
  private writingSeen = false;
  hide: { l: Locker; dyaw: number; dpitch: number; seen: boolean } | null = null;
  readonly tapes = new TapePlayer(this.audio, this.sfx, (t, sec) => this.hud.subtitle(t, sec));
  private geiger: AudioBuffer[] = [];
  private dosiNoiseT = 0;
  /** Батарейки, що лежать на поточному рівні. */
  private pickups: Pickup[] = [];
  hud!: HUD;
  readonly ambience = new Ambience(this.audio);
  interact!: Interactions;
  private clicks: AudioBuffer[] = [];
  private rustle: AudioBuffer | null = null;
  private stage: 'desk' | 'seam' | 'done' = 'desk';
  private ending = false;
  private steps: AudioBuffer[] = [];
  private ambSrc: AudioBufferSourceNode | null = null;
  private seamVoices: SpatialVoice[] = [];
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
    const tt = T.tutorial, touch = this.device.touch;
    this.tutorial = new Tutorial([
      { id: 'light', key: 'F', icon: touch ? svg(ICONS.light) : undefined, text: tt.light },
      { id: 'run', key: 'Shift', icon: touch ? svg(ICONS.run) : undefined, text: tt.run },
      { id: 'crouch', key: 'C', icon: touch ? svg(ICONS.crouch) : undefined, text: tt.crouch },
      { id: 'use', key: 'E', icon: touch ? svg(ICONS.use) : undefined, text: tt.use }
    ], (t) => this.hud.setTutorial(t));
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
    const lvl = await this.loadLevel(0, onProgress);
    const s = lvl.layout.spawn;
    this.player = new Player(this.physics, s.x, 0, s.z);
    this.player.yaw = s.yaw;
    this.bat.level = this.store.progress.battery;
    this.player.onFootstep = (e) => this.footstep(e.x, e.y, e.z, e.loudness);
    // взаємодії потребують гравця: при першому завантаженні рівня його ще не було (loadLevel їх пропустив)
    this.setupInteractions(lvl);
    this.applySettings(this.store.settings);
    this.input.enabled = false;
    this.resize();
    // заздалегідь скомпілювати шейдери, щоб не було ривків при першому погляді на щось нове
    await this.assets.gate();
    try { this.gfx.renderer.setRenderTarget(null); await this.gfx.renderer.compileAsync(lvl.scene, this.camera); } catch { /* не критично */ }
  }

  /** Побудувати рівень id (старий звільняється: GPU-пам'ять, колізії); гравця не чіпає. */
  private async loadLevel(id: number, onProgress: (p: number) => void = () => {}): Promise<Level> {
    const old = this.level;
    if (old) {
      const keep = this.player?.collider;
      const list: { handle: number }[] = [];
      this.physics.world.forEachCollider((c) => { if (c !== keep) list.push(c); });
      for (const c of list) this.physics.world.removeCollider(c as never, false);
      disposeScene(old.scene);
      this.assets.releaseLevel();
      this.level = null;
      this.figure = null;
    }
    const lvl = id === 0 ? await buildLevel0(this.assets, this.physics, onProgress) : await buildThemedLevel(id as 1 | 2, this.assets, this.physics, onProgress);
    if (id === 0) {
      try {
        const gl = await this.assets.model('assets/models/figure.glb');
        this.figure = new Figure(cloneSkinned(gl.scene), lvl.layout, this.physics, lvl.lamps, {
          onVanish: (x, z, seen) => {
            // коротка «оплата» напруги: глухий удар там, де вона стояла, і здригання камери, якщо гравець її бачив
            const hit = this.sfx.pick('hit_');
            if (hit) this.audio.play3D(hit, x, 1.5, z, { gain: seen ? 0.55 : 0.25, ref: 4, wet: 0.6, rate: 0.85 });
            if (seen) { this.rig.shake = Math.max(this.rig.shake, 0.6); look.fear.value = Math.min(1, look.fear.value + 0.5); }
          }
        });
        lvl.scene.add(this.figure.root);
      } catch { /* без моделі гра йде без Фигуры */ }
    }
    this.level = lvl;
    this.omens.attach(lvl);
    this.pickups = await placeBatteries(this.assets, lvl, this.store.progress.pickups);
    this.tapes.stop();
    this.findings = await placeFindings(this.assets, lvl, FINDINGS[lvl.id] ?? []);
    this.hide = null;
    this.lockers = lvl.id === 1 ? await placeLockers(this.assets, this.physics, lvl, [0.33, 0.5, 0.7]) : [];
    this.specials = lvl.id === 0 ? await placeSpecialRooms(this.assets, this.physics, lvl, [...this.findings, ...this.pickups].map((f) => ({ x: f.x, z: f.z }))) : [];
    this.phoneAnswered = false; this.writingSeen = false;
    this.setScene(lvl.scene);
    if (this.player) this.setupInteractions(lvl);
    this.levelAudio();
    await this.hunt.setup(lvl, this.assets, this.physics);
    return lvl;
  }

  /** Фон рівня й гул Швів — до нового рівня. */
  private levelAudio(): void {
    const lvl = this.level;
    if (!lvl || !this.sfx.ready) return;
    this.ambSrc?.stop();
    const amb = this.sfx.get(`amb_l${lvl.id}`), bus = this.audio.music;
    this.ambSrc = amb && bus ? this.audio.play2D(amb, 0.32, 1, bus) : null;
    if (this.ambSrc) this.ambSrc.loop = true;
    // телефон у порожній кімнаті дзвонить (рівень 0), доки не знімеш трубку
    this.phoneVoice?.stop(0.05); this.phoneVoice = null;
    const ph = this.specials.find((s) => s.id === 'phone'), ctx = this.audio.ctx;
    if (ph && ctx && !this.phoneAnswered) this.phoneVoice = this.audio.play3D(phoneRing(ctx), ph.x, ph.y, ph.z, { loop: true, gain: 0.9, ref: 2.2, wet: 0.45 });
    const seams: (Seam | undefined)[] = [lvl.seam, lvl.rift];
    this.seamVoices.forEach((v, i) => {
      const p = seams[i]?.group.position;
      v.setPosition(p ? p.x : 0, p ? 1.3 : -100, p ? p.z : 0);
    });
  }

  private setScene(s: THREE.Scene): void {
    this.scene = s;
    this.post.setScene(s, this.profile);
  }

  private prepareAudio(): void {
    const ctx = this.audio.ctx;
    if (!ctx || this.steps.length) return;
    for (let i = 0; i < 8; i++) this.steps.push(footstepCarpet(ctx, i + 1));
    for (let i = 0; i < 6; i++) this.clicks.push(typeClick(ctx, i + 1));
    this.rustle = paperRustle(ctx, 1);
    for (let i = 0; i < 4; i++) this.geiger.push(geigerClick(ctx, i + 1));
    // тихий фоновий трек рівня (наш, ACE-Step): шар під гулом ламп
    void this.sfx.load(ctx, `${import.meta.env.BASE_URL}assets/sfx/`).then(() => this.levelAudio());
    this.ambience.prepare();
    // гул Шва і (тихіше, глухіше) прихованого розлому
    const drone = seamDrone(ctx);
    for (const [gain, ref] of [[0.9, 1.5], [0.5, 0.9]] as const) {
      const v = this.audio.play3D(drone, 0, -100, 0, { loop: true, gain, ref, wet: 0.4, rate: ref < 1 ? 0.8 : 1 });
      if (v) this.seamVoices.push(v);
    }
    this.levelAudio();
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
    this.hunt.noise(x, y, z, loud);
  }

  applySettings(s: Settings): void {
    look.exposure.value = BASE_EXPOSURE * s.brightness;
    this.baseFov = s.fov; this.applyFov();
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
    this.assets?.quiet(800); // меню має з'явитися плавно й одразу — розбір рівня почекає
    this.store.data.ageConfirmed = true; this.store.save();
    this.audio.unlock(); // у жесті (iOS); синтез звуків — після показу меню, щоб не затримувати його
    setTimeout(() => this.prepareAudio(), 600);
    // меню — одразу: рівень довантажується позаду (пролог чи заставка «Продолжить» його дочекаються)
    this.showMenu();
    if (pct < 1) {
      bar.classList.add('below');
      bar.textContent = `Подготовка экспедиции… ${Math.round(pct * 100)} %`;
      document.getElementById('ui')?.appendChild(bar);
    }
    await this.loading;
    bar.remove();
  }

  private showMenu(): void {
    this.mode = 'menu';
    this.hud.show(false);
    this.input.enabled = false; this.input.touch?.show(false);
    this.ui.onBack = null;
    this.ui.menu({
      canContinue: !!this.store.progress.checkpoint,
      onContinue: () => void this.continueGame(),
      onStart: () => {
        const start = () => { this.store.newGame(); this.bat.newGame(); void this.startNewGame(); };
        // є збереження — спершу спитати: випадкове натискання не має стирати проходження
        if (!this.store.progress.checkpoint) { start(); return; }
        const m = T.menu;
        this.ui.close('menu');
        this.ui.confirm({ title: m.confirmTitle, body: m.confirmBody, yes: m.confirmYes, no: m.confirmNo, onYes: start, onNo: () => this.showMenu() });
      },
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

  /** Продовжити: якщо збережено інший рівень — завантажити його під заставкою. */
  private async continueGame(): Promise<void> {
    if (this.loading && !this.player) {
      // ще вантажиться: чорна заставка рівня, поки все не готово
      this.ui.closeAll();
      const cp0 = this.store.progress.checkpoint, c0 = cp0 ? LEVEL_TITLES[cp0.level] : undefined;
      await this.hud.titleCard(c0?.title ?? 'Уровень 0', c0?.sub ?? 'Жёлтые комнаты', async () => { await this.loading; });
    }
    const cp = this.store.progress.checkpoint;
    const card = cp ? LEVEL_TITLES[cp.level] : undefined;
    if (cp && card && this.level?.id !== cp.level) {
      this.ui.closeAll();
      this.audio.unlock(); this.prepareAudio();
      await this.hud.titleCard(card.title, card.sub, async () => { await this.loadLevel(cp.level); });
      this.enterLevelStart(false);
      this.hud.setObjective(cp.level === 1 ? OBJECTIVES.level1Start : OBJECTIVES.level2Start);
    }
    this.play();
  }

  private async startNewGame(): Promise<void> {
    this.ui.closeAll();
    this.input.enabled = false;
    this.audio.unlock(); this.prepareAudio();
    let k = 0;
    // якщо гравець був на іншому рівні — рівень 0 вантажиться під час прологу
    // рівень 0 ще міг не довантажитися після «18+» — пролог іде поверх завантаження
    const reload = (this.loading ?? Promise.resolve()).then(() => (this.level?.id !== 0 ? this.loadLevel(0).then(() => {}) : this.resetPickups()));
    await this.hud.prologue(PROLOGUE, () => { const b = this.clicks[k++ % Math.max(1, this.clicks.length)]; if (b) this.audio.play2D(b, 0.5, 0.95 + Math.random() * 0.1); });
    await reload;
    // отямлюється на підлозі обличчям до стіни, крізь яку випав (стіл експедиції — за спиною)
    this.enterLevelStart();
    this.store.progress.checkpoint = { level: 0, spawn: 'start' };
    this.persist();
    await this.arrive();
    this.play();
    this.hud.setObjective(OBJECTIVES.level0Start);
    if (!this.store.data.tutorialSeen) { this.tried.clear(); this.tutorial.start(); }
  }

  /** Прибуття: темрява → гравець лежить перед Швом → розріз затягується зі звуком → гравець підводиться. */
  private async arrive(): Promise<void> {
    const a = this.level?.arrival;
    if (!a) return;
    this.mode = 'play'; // світ живе (лампи, звук), але керування ще вимкнене
    this.hud.show(false);
    a.life.value = 1; a.open.value = 0.45;
    look.fade.value = 1; look.fear.value = 0.6;
    this.rig.wake = 1; this.rig.shake = 0.7;
    const cloth = () => { const b = this.sfx.pick('cloth'); if (b) this.audio.play2D(b, 0.7, 0.9 + Math.random() * 0.2); };
    let closed = false, up = false;
    cloth();
    const t0 = performance.now();
    await new Promise<void>((done) => {
      const step = () => {
        const t = (performance.now() - t0) / 1000;
        const k = (a0: number, a1: number) => Math.min(1, Math.max(0, (t - a0) / (a1 - a0)));
        look.fade.value = 1 - k(0.2, 1.8);
        a.open.value = 0.45 * (1 - k(1.8, 4.2));
        a.life.value = 1 - k(4.0, 4.6);
        if (!closed && t > 4.0) {
          closed = true;
          const b = this.sfx.pick('hit'); if (b) this.audio.play2D(b, 0.45, 0.8);
          this.rig.shake = 0.5;
        }
        if (!up && t > 5.0) { up = true; cloth(); }
        this.rig.wake = 1 - k(5.0, 7.0);
        look.fear.value = 0.6 * (1 - k(4.6, 7.0));
        if (t < 7.0) requestAnimationFrame(step); else done();
      };
      step();
    });
    this.rig.wake = 0; a.life.value = 0; look.fade.value = 0;
  }

  /** Батарейки: «Взять» → заряд, клацання, предмет зникає (і не з'явиться знову в цьому проходженні). */
  private addPickup(b: Pickup): void {
    this.interact.add({ id: b.id, x: b.x, y: b.y, z: b.z, reach: 1.6, prompt: HINTS.battery, enabled: true, use: () => {
      this.interact.remove(b.id);
      b.obj.removeFromParent();
      this.pickups = this.pickups.filter((p) => p !== b);
      this.bat.pickup();
      if (!this.store.progress.pickups.includes(b.id)) this.store.progress.pickups.push(b.id);
      const snd = this.sfx.get('metallatch') ?? this.sfx.get('metalclick');
      if (snd) this.audio.play2D(snd, 0.6, 1.05);
      this.hud.flashBattery(this.bat.level);
      this.persist();
    } });
  }

  /** Нове проходження на вже завантаженому рівні 0: підібрані раніше батарейки повертаються на місця. */
  private async resetPickups(): Promise<void> {
    const lvl = this.level;
    if (!lvl) return;
    for (const b of this.pickups) { b.obj.removeFromParent(); this.interact?.remove(b.id); }
    this.pickups = await placeBatteries(this.assets, lvl, this.store.progress.pickups);
    // нове проходження: телефон знову дзвонить, почерк знову «незнайомий»
    this.phoneAnswered = false; this.writingSeen = false;
    this.setupInteractions(lvl);
    this.levelAudio();
  }

  /** Зняти трубку: дзвінок обривається, у трубці тріск і голос диспетчера блочного щита (субтитри). */
  private answerPhone(): void {
    if (this.phoneAnswered) return;
    this.phoneAnswered = true;
    this.phoneVoice?.stop(0.05); this.phoneVoice = null;
    this.interact.remove('phone');
    const sp = this.specials.find((s) => s.id === 'phone');
    if (sp) this.tapes.play({ id: 'phone', title: '', meta: '', speaker: '', lines: SPECIAL.phone }, sp.x, sp.z);
    look.fear.value = Math.min(1, look.fear.value + 0.25);
  }

  /** Почерк на стінах — його власний. */
  private seeWriting(): void {
    if (this.writingSeen) return;
    this.writingSeen = true;
    this.interact.remove('writing');
    this.hud.subtitle(SPECIAL.writing, 5);
    look.fear.value = Math.min(1, look.fear.value + 0.4);
    this.rig.shake = Math.max(this.rig.shake, 0.25);
  }

  /** Сховатися в шафку: камера за жалюзі, рух вимкнено, ліхтарик гасне. Мисливець, що бачив це, знайде. */
  private enterLocker(l: Locker): void {
    const s = this.hunt.stalker;
    const seen = !!s && (s.brain.seesPlayer || (s.brain.state === 'chase' && s.brain.mem.age < 1.0));
    this.hide = { l, dyaw: 0, dpitch: 0, seen };
    this.flashlightOn = false;
    this.hud.setHidden(true);
    const snd = this.sfx.pick('doorclose');
    if (snd) this.audio.play3D(snd, l.door.x, 1.1, l.door.z, { gain: 0.5, rate: 1.5, ref: 1.5 });
    this.hunt.noise(l.x, 1, l.z, 0.25); // дверцята клацнули — тихо, але чутно поруч
  }

  private exitLocker(): void {
    const h = this.hide;
    if (!h) return;
    this.hide = null;
    this.hud.setHidden(false);
    // стати перед шафкою, дивлячись у кімнату
    const nx = Math.sin(h.l.yaw), nz = Math.cos(h.l.yaw);
    this.player.teleport(h.l.door.x + nx * 0.55, 0, h.l.door.z + nz * 0.55, h.l.yaw + Math.PI + h.dyaw);
    this.player.pitch = 0;
    const snd = this.sfx.pick('dooropen');
    if (snd) this.audio.play3D(snd, h.l.door.x, 1.1, h.l.door.z, { gain: 0.45, rate: 1.4, ref: 1.5 });
  }

  /** Записати прогрес (разом із зарядом ліхтарика). */
  private persist(): void {
    this.store.progress.battery = this.bat.level;
    this.store.save();
  }

  private setupInteractions(lvl: Level): void {
    this.interact = new Interactions(this.physics);
    for (const s of Object.values(lvl.spots)) {
      const id = s.id;
      const after = id === 'order7' ? () => { if (this.stage === 'desk') { this.stage = 'seam'; this.hud.setObjective(OBJECTIVES.level0Find); } } : undefined;
      this.interact.add({ id, x: s.x, y: s.y, z: s.z, reach: 1.9, prompt: HINTS.read, enabled: true, use: () => this.readDoc(id, after) });
    }
    const sp = lvl.seam.group.position;
    this.interact.add({ id: 'seam', x: sp.x, y: 1.3, z: sp.z, reach: 1.7, prompt: HINTS.enterSeam, enabled: true, use: () => void this.enterSeam(lvl.seam, lvl.next) });
    for (const b of this.pickups) this.addPickup(b);
    // записки й магнітофони з плівками Савельєва
    for (const f of this.findings) {
      this.interact.add({ id: f.id, x: f.x, y: f.y, z: f.z, reach: 1.7, prompt: f.kind === 'tape' ? HINTS.listen : HINTS.read, enabled: true,
        use: () => (f.kind === 'tape' ? this.playTape(f) : this.readDoc(f.id)) });
    }
    for (const sp of this.specials) {
      if (sp.id === 'phone') this.interact.add({ id: 'phone', x: sp.x, y: sp.y, z: sp.z, reach: 1.7, enabled: true, get prompt() { return HINTS.answer; }, use: () => this.answerPhone() });
      if (sp.id === 'writing') this.interact.add({ id: 'writing', x: sp.x, y: sp.y, z: sp.z, halfHeight: 0.4, reach: 2.4, prompt: HINTS.look, enabled: true, use: () => this.seeWriting() });
    }
    for (const l of this.lockers) {
      this.interact.add({ id: l.id, x: l.door.x, y: l.door.y, z: l.door.z, halfHeight: 0.7, reach: 1.6, prompt: HINTS.hide, enabled: true, use: () => this.enterLocker(l) });
    }
    const rift = lvl.rift;
    if (rift) {
      const rp = rift.group.position;
      this.interact.add({ id: 'rift', x: rp.x, y: 1.3, z: rp.z, reach: 1.5, prompt: HINTS.enterSeam, enabled: true, use: () => void this.enterSeam(rift, 2) });
    }
    // двері: ціль — центр полотна (рухається разом із ним), ловиться будь-де по висоті; з будь-якого боку
    for (const d of lvl.doors.list) {
      const doors = lvl.doors;
      this.interact.add({ id: d.id, get x() { return d.cx; }, y: DOOR_H / 2, get z() { return d.cz; }, halfHeight: 0.9, reach: 1.8, enabled: true,
        get prompt() { return d.target > 0.1 ? HINTS.doorShut : HINTS.doorOpen; }, use: () => doors.toggle(d) });
    }
    const doorSound = (name: string, d: { pivot: THREE.Object3D }, gain: number) => {
      const b = this.sfx.pick(name);
      const p = d.pivot.position;
      if (b) this.audio.play3D(b, p.x, 1.2, p.z, { gain, rate: 0.9 + Math.random() * 0.15, ref: 2, wet: 0.4 });
    };
    lvl.doors.onMove = (d, opening) => { doorSound('creak', d, 0.7); if (opening) doorSound('dooropen', d, 0.6); this.hunt.noise(d.pivot.position.x, 1, d.pivot.position.z, 0.6); };
    lvl.doors.onShut = (d) => doorSound('doorclose', d, 0.9);
    lvl.doors.onBash = (d) => {
      // вибиті двері: удар і грюкіт полотна об стіну; поруч — здригання камери
      doorSound('hit_', d, 1);
      doorSound('doorclose', d, 1);
      const p = d.pivot.position, near = Math.hypot(p.x - this.player.pos.x, p.z - this.player.pos.z);
      if (near < 9) { this.rig.shake = Math.max(this.rig.shake, 0.6 * (1 - near / 9)); look.fear.value = Math.min(1, look.fear.value + 0.3); }
    };
  }

  /** Документ, записка чи плівка (як аркуш із розшифровкою) за id. */
  private docOf(id: string): Doc | undefined {
    const t = TAPES[id];
    if (t) return { id, kind: 'tape', title: t.title, meta: t.meta, body: t.lines.map(([, l]) => l).join('\n'), sign: 'Расшифровка записи' };
    return DOCS[id] ?? NOTES[id];
  }

  /** Увімкнути плівку: шипіння магнітофона на підлозі, розшифровка субтитрами; запис потрапляє в журнал. */
  private playTape(f: Finding): void {
    const t = TAPES[f.id];
    if (!t) return;
    if (!this.store.progress.tapes.includes(f.id)) { this.store.progress.tapes.push(f.id); this.persist(); }
    this.tapes.play(t, f.x, f.z);
  }

  private readDoc(id: string, after?: () => void): void {
    const d = this.docOf(id);
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

  /** Пройти крізь Шов: розріз розкривається, світ гасне → заставка, новий рівень, прибуття; після парковки — кінець версії. */
  private async enterSeam(seam: Seam, target: number): Promise<void> {
    if (this.ending || !this.level) return;
    this.ending = true;
    this.input.enabled = false;
    this.mode = 'pause';
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
    const from = this.level.id;
    if (!this.store.progress.completed.includes(from)) this.store.progress.completed.push(from);
    if (document.pointerLockElement) document.exitPointerLock();
    this.hud.show(false);
    const card = LEVEL_TITLES[target];
    if (!card) {
      this.store.progress.checkpoint = null;
      this.store.save();
      this.stage = 'done';
      this.hud.levelEnd(LEVEL_END.title, LEVEL_END.body, LEVEL_END.soon, () => {
        look.fade.value = 0; look.fear.value = 0; seam.open.value = 0; this.ending = false;
        this.showMenu();
      });
      return;
    }
    await this.hud.titleCard(card.title, card.sub, async () => { await this.loadLevel(target); });
    look.fear.value = 0;
    this.enterLevelStart();
    this.bat.enterLevel(); // експедиція «перезарядилася» в темряві між рівнями — новий рівень починається з повним ліхтариком
    this.store.progress.checkpoint = { level: target, spawn: 'start' };
    this.persist();
    this.ending = false;
    await this.arrive();
    this.play();
    this.hud.setObjective(target === 1 ? OBJECTIVES.level1Start : OBJECTIVES.level2Start);
  }

  /** Мисливець схопив: різкий поворот до нього, удар, темрява → запис відновлюється з початку рівня. */
  private async caught(): Promise<void> {
    if (this.ending || !this.level) return;
    this.ending = true;
    this.input.enabled = false;
    const s = this.hunt.stalker, p = this.player.pos;
    if (s) { this.player.yaw = Math.atan2(-(s.pos.x - p.x), -(s.pos.z - p.z)); this.player.pitch = 0.05; }
    const b = this.sfx.pick('hit_');
    if (b) this.audio.play2D(b, 1, 0.7);
    look.fear.value = 1;
    // різкий поворот до нього → на пів секунди його обличчя впритул (освітлене ліхтариком) → темрява
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); // камера вже дивиться на нього
    s?.grabFace(this.camera);
    this.flashlightOn = true;
    // ліхтарик вислизає з руки й на пів секунди світить на обличчя знизу (те саме світло — без нових джерел і перекомпіляції)
    const fw = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const from = this.camera.position.clone().addScaledVector(fw, 0.1).add(new THREE.Vector3(0.05, -0.38, 0));
    const at = this.camera.position.clone().addScaledVector(fw, 0.42);
    this.flashOverride = { from, at, intensity: 1.4 };
    this.rig.shake = 0.35;
    // обличчя — щонайменше 0.52 с і 10 намальованих кадрів (навіть якщо пристрій саме пригальмував), потім темрява за 0.26 с
    let t0 = performance.now(), frames = 0, fading = false;
    await new Promise<void>((done) => {
      const step = () => {
        const t = performance.now() - t0;
        if (!fading) { frames++; look.fade.value = 0; if (t >= 520 && frames >= 10) { fading = true; t0 = performance.now(); } }
        else look.fade.value = Math.min(1, t / 260);
        if (!fading || t < 260) requestAnimationFrame(step); else done();
      };
      step();
    });
    this.flashOverride = null;
    this.rig.shake = 0;
    this.store.progress.deaths++;
    this.bat.afterDeath();
    this.persist();
    this.mode = 'pause';
    this.hud.show(false);
    await this.hud.titleCard('Связь с оператором потеряна', 'Запись восстановлена с последней метки', async () => {
      s?.reset();
      this.enterLevelStart(false);
    });
    look.fear.value = 0;
    const t1 = performance.now();
    this.mode = 'play';
    await new Promise<void>((done) => {
      const step = () => { const k = Math.min(1, (performance.now() - t1) / 1200); look.fade.value = 1 - k; if (k < 1) requestAnimationFrame(step); else done(); };
      step();
    });
    this.ending = false;
    this.play();
  }

  /** Поставити гравця на старт поточного рівня обличчям до Шва прибуття. */
  private enterLevelStart(face = true): void {
    if (this.hide) { this.hide = null; this.hud.setHidden(false); }
    const s = this.level?.layout.spawn;
    if (s) this.player.teleport(s.x, 0, s.z, s.yaw + (face ? Math.PI : 0));
    this.player.pitch = 0;
    this.stage = this.level?.id === 0 ? 'desk' : 'seam';
    this.setZoom(false);
  }

  play(): void {
    // клавіша, що закрила екран (Esc, Tab), не має одразу відкрити його знову
    this.input.consume('pause'); this.input.consume('journal');
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
    this.persist();
    this.setZoom(false);
    this.mode = 'pause';
    this.hud.show(false);
    this.input.enabled = false; this.input.touch?.show(false);
    this.ui.onBack = () => this.play();
    this.ui.pause({
      onResume: () => this.play(),
      onSettings: () => this.openSettings(() => this.pauseMenuAgain()),
      onControls: () => { this.ui.close('pause'); this.ui.onBack = () => { this.ui.close('controls'); this.pauseMenuAgain(); }; this.ui.controls(this.device.touch, () => { this.ui.close('controls'); this.pauseMenuAgain(); }); },
      onMenu: () => { this.ui.closeAll(); this.showMenu(); },
      docs: [...this.store.progress.docs, ...this.store.progress.notes, ...this.store.progress.tapes].map((id) => ({ id, title: this.docOf(id)?.title ?? id })),
      onDoc: (id) => {
        const d = this.docOf(id);
        if (!d) return;
        this.ui.closeAll();
        this.hud.openDoc(d, () => this.pauseMenuAgain());
      }
    });
  }

  private pauseMenuAgain(): void { this.mode = 'play'; this.pause(); }

  /** Журнал (Tab / J): знайдені документи; Esc, Tab чи J — назад у гру. */
  private openJournal(): void {
    if (this.mode !== 'play' || this.hud.readerOpen) return;
    this.setZoom(false);
    this.mode = 'pause';
    this.hud.show(false);
    this.input.enabled = false; this.input.touch?.show(false);
    if (document.pointerLockElement) document.exitPointerLock();
    const docs = [...this.store.progress.docs, ...this.store.progress.notes, ...this.store.progress.tapes].map((id) => ({ id, title: this.docOf(id)?.title ?? id }));
    this.ui.onBack = () => this.play();
    this.ui.journal(docs, (id) => {
      const d = this.docOf(id);
      if (!d) return;
      this.ui.closeAll();
      this.hud.openDoc(d, () => { this.mode = 'play'; this.openJournal(); });
    }, () => this.play());
  }

  /** ДП-5: клацання за відстанню до найближчого Шва (головний і прихований розлом), стрілка, шум для «Слепого». */
  private updateDosimeter(dt: number): void {
    const lvl = this.level;
    if (!lvl || !this.player) return;
    const p = this.player.pos;
    let d = Infinity;
    for (const s of [lvl.seam, lvl.rift]) if (s) d = Math.min(d, Math.hypot(s.group.position.x - p.x, s.group.position.z - p.z));
    const clicks = this.dosi.update(dt, d, this.mode !== 'play');
    for (let i = 0; i < clicks; i++) {
      const b = this.geiger[(Math.random() * this.geiger.length) | 0];
      if (b) this.audio.play2D(b, 0.32 + Math.random() * 0.1, 0.92 + Math.random() * 0.16);
    }
    // тріск приладу — теж звук: «Слепой» його чує (тихо, але постійно)
    if (this.dosi.rate > 0 && (this.dosiNoiseT -= dt) <= 0) { this.dosiNoiseT = 1; this.hunt.noise(p.x, p.y + 1, p.z, 0.12 + 0.1 * (this.dosi.rate / 9)); }
    this.hud.setDosimeter(this.dosi.on && this.mode === 'play' ? this.dosi.needle * 0.7 : null); // повний фон ≈ 3.5 мР/ч, не в червоній зоні
  }

  /** Зум 2× (як кнопка на відеокамері): поле зору звужується вдвічі за фокусною відстанню. */
  private setZoom(on: boolean): void {
    if (this.zoom === on) return;
    this.zoom = on;
    this.hud.setZoom(on, T.hud.zoom);
    const click = this.sfx.get('metalclick');
    if (click && this.mode === 'play') this.audio.play2D(click, 0.25, on ? 1.5 : 1.35);
  }

  private applyFov(): void {
    const t = Math.tan((this.baseFov * Math.PI) / 360) / (1 + this.zoomK);
    this.camera.fov = (2 * Math.atan(t) * 180) / Math.PI;
    this.camera.updateProjectionMatrix();
  }

  /** Автоматичний крок на пресет нижче (лише в режимі «Авто», не нижче «Среднего»). */
  private stepDownPreset(): void {
    this.presetGov.scale = 1;
    const order = ['ultra', 'high', 'medium'] as const;
    const i = order.indexOf(this.profile.name as (typeof order)[number]);
    if (i < 0 || i >= order.length - 1) return;
    this.profile = PROFILES[order[i + 1] as (typeof order)[number]];
    this.post.apply(this.profile);
    this.resize();
  }

  resize(): void {
    const w = innerWidth, h = innerHeight;
    const r = this.gfx.renderer;
    r.setPixelRatio(Math.min(this.device.dpr, this.profile.maxPixelRatio) * (this.profile.name === 'low' ? this.governor.scale : 1));
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
    if (this.mode === 'play' && this.autoScale) {
      if (this.profile.name === 'low') { if (this.governor.update(dtMs)) this.resize(); }
      else if (this.store.settings.quality === 'auto' && this.presetGov.update(dtMs) && this.presetGov.scale < 1) this.stepDownPreset();
    }
    this.input.poll(dt);
    if (this.input.consume('pause') && this.mode === 'play') this.pause();
    if (this.input.consume('journal')) { if (this.mode === 'play') this.openJournal(); else if (this.ui.top === 'journal') this.play(); }
    if (this.input.consume('camera') && this.mode === 'play') this.setZoom(!this.zoom);
    if (this.input.consume('dosimeter') && this.mode === 'play') {
      this.dosi.on = !this.dosi.on;
      const sw = this.sfx.get('metalclick');
      if (sw) this.audio.play2D(sw, 0.35, this.dosi.on ? 1.3 : 1.15);
      this.input.touch?.setLatched('dosi', this.dosi.on);
    }
    const zk = this.zoom ? 1 : 0;
    if (Math.abs(zk - this.zoomK) > 1e-4) { this.zoomK += (zk - this.zoomK) * Math.min(1, dt * 10); if (Math.abs(zk - this.zoomK) < 1e-3) this.zoomK = zk; this.applyFov(); }
    let [lx, ly] = this.input.takeLook();
    // у зумі погляд повертається повільніше — точніше роздивитися далеке
    const lk = 1 / (1 + this.zoomK); lx *= lk; ly *= lk;
    this.time += dt;
    if (this.mode === 'play' && this.hide) {
      // у шафці: лише трохи роззирнутися крізь жалюзі; E — вийти
      const h = this.hide;
      h.dyaw = Math.max(-0.6, Math.min(0.6, h.dyaw - lx));
      h.dpitch = Math.max(-0.35, Math.min(0.3, h.dpitch - ly));
      if (this.input.consume('interact')) this.exitLocker();
    }
    if (this.mode === 'play') {
      if (!this.hide) this.player.look(lx, ly);
      this.acc += dt;
      const m = this.hide ? { x: 0, y: 0, run: false, crouch: false } : { x: this.input.move.x, y: this.input.move.y, run: this.input.run, crouch: this.input.crouch };
      while (this.acc >= STEP) { this.player.update(STEP, m); this.physics.step(); this.acc -= STEP; }
    } else if (this.mode === 'menu') {
      // у меню камера повільно «дихає» й оглядає кімнату
      this.player.yaw = Math.sin(this.time * 0.07) * 0.5;
      this.player.pitch = -0.04 + Math.sin(this.time * 0.11) * 0.03;
    }
    if (this.input.consume('flashlight') && this.mode === 'play') {
      this.flashlightOn = !this.flashlightOn;
      this.tried.add('light');
      const click = this.sfx.get('metalclick');
      if (click) this.audio.play2D(click, 0.5, this.flashlightOn ? 1.1 : 0.9);
      this.hunt.noise(this.player.pos.x, this.player.pos.y, this.player.pos.z, 0.12);
    }
    if (this.hud.readerOpen && (this.input.consume('interact') || this.input.consume('pause'))) this.hud.closeDoc();
    const lvl = this.level;
    this.rig.update(this.player, this.acc / STEP, dt);
    if (this.hide) {
      // камера всередині шафки, за жалюзі, дивиться в кімнату
      const h = this.hide;
      this.camera.position.copy(h.l.eye);
      this.camera.rotation.set(h.dpitch, h.l.yaw + Math.PI + h.dyaw, 0, 'YXZ');
      this.camera.updateMatrixWorld();
    }
    this.cameraOverride?.(this.camera, dt);
    if (lvl) {
      lvl.update(this.time, dt, this.camera);
      this.figure?.update(dt, this.camera, this.mode === 'play');
      if (this.mode === 'play' && !this.ending) {
        this.hunt.update(dt, lvl, this.player, this.camera, this.flashlightOn, this.physics, this.hide ? { x: this.hide.l.eye.x, z: this.hide.l.eye.z, seen: this.hide.seen } : null);
        const omen = this.tension.update(dt, this.hunt.danger);
        if (omen) this.omens.play(omen, lvl, { x: this.player.pos.x, z: this.player.pos.z, yaw: this.player.yaw }, this.camera);
      }
      this.omens.update(dt);
      look.fear.value = Math.max(0, look.fear.value - dt * 0.12);
      // живе згасання запеченого світла біля ламп, що мерехтять/згасли (оновлюємо кілька разів на секунду — дешево)
      this.dimT -= dt;
      if (this.dimT <= 0) { this.dimT = 0.05; lvl.lamps.fillDeficits(this.camera.position.x, this.camera.position.z, lampDeficits.array as THREE.Vector4[]); }
      // ліхтарик у руці: трохи нижче й правіше очей, світить туди, куди дивишся
      const fl = lvl.flashlight, c = this.camera;
      if (this.mode === 'play') this.bat.update(dt, this.flashlightOn);
      if (this.battery <= 0) this.flashlightOn = false;
      // низький заряд: тьмяніє, жовтіє й час від часу «провалюється»
      const low = this.battery < 0.15 ? this.battery / 0.15 : 1;
      const dip = this.battery < 0.15 && Math.sin(this.time * 23.0) * Math.sin(this.time * 7.3) > 0.55 ? 0.15 : 1;
      // «автодіафрагма»: зблизька (стіна, двері, меблі) світло слабшає ~ квадрату відстані — пляма не вибілює кадр;
      // від 1.4 м і далі — як і було
      if ((this.flashT -= dt) <= 0) {
        this.flashT = 0.05;
        const d = this.fwd.set(0, 0, -1).applyQuaternion(c.quaternion);
        this.flashNear = this.physics.raycast(c.position.x, c.position.y, c.position.z, d.x, d.y, d.z, 3, G.STATIC | G.DOOR | G.PROP) ?? 10;
      }
      const nearK = Math.min(1, Math.max(0.1, (this.flashNear / 1.4) ** 2));
      this.flashK += (nearK - this.flashK) * Math.min(1, dt * 8);
      fl.intensity += ((this.flashlightOn ? 26 * (0.35 + 0.65 * low) * dip * this.flashK : 0) - fl.intensity) * Math.min(1, dt * 18);
      this.hud.setBattery(this.flashlightOn || this.battery < 0.3 ? this.battery : -1, this.battery);
      const spill = fl.children[0] as THREE.SpotLight | undefined;
      if (spill) spill.intensity = fl.intensity * 0.12;
      fl.position.set(0.18, -0.16, 0.05).applyQuaternion(c.quaternion).add(c.position);
      fl.target.position.set(0, -0.08, -6).applyQuaternion(c.quaternion).add(c.position);
      const fo = this.flashOverride;
      if (fo) { fl.position.copy(fo.from); fl.target.position.copy(fo.at); fl.intensity = fo.intensity; }
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
      // на дотику — значок кнопки «Действие» (той самий, що на екрані), а не клавіша
      const key = this.input.lastDevice === 'gamepad' ? 'A' : 'E', icon = this.input.lastDevice === 'touch' ? svg(ICONS.use) : undefined;
      if (this.hide) this.hud.setPrompt(HINTS.unhide, key, icon); // у шафці — лише «Выйти» (обробляється вище)
      else {
        const it = this.interact.update(c, f.x, f.y, f.z);
        this.hud.setPrompt(it ? it.prompt : null, key, icon);
        if (it && this.input.consume('interact')) { it.use(); this.tried.add('use'); }
      }
      if (this.player.running) this.tried.add('run');
      if (this.player.crouched) this.tried.add('crouch');
      if (this.tutorial.active) {
        this.tutorial.update(dt, (id) => this.tried.has(id));
        if (!this.tutorial.active) { this.store.data.tutorialSeen = true; this.persist(); }
      }
      this.store.progress.playSeconds += dt;
      this.tapes.update(dt);
      if ((this.persistT -= dt) <= 0) { this.persistT = 10; this.persist(); }
      this.ambience.update(dt, this.player);
      this.hud.setTime(this.store.progress.playSeconds);
    } else this.hud.setPrompt(null, '');
    // ПК: миша ще не захоплена (після прологу браузер не дає захопити без кліку) — підказати клікнути
    this.hud.setLockHint(this.mode === 'play' && this.input.enabled && !this.device.touch && !this.input.pointerLocked
      && this.input.lastDevice !== 'gamepad' && !this.hud.readerOpen);
    this.updateDosimeter(dt);
    this.hud.update(dt);
    this.audio.updateListener({ x: c.position.x, y: c.position.y, z: c.position.z, fx: f.x, fy: f.y, fz: f.z });
    this.post.render();
    this.onFrame?.(dtMs);
  }

  start(): void {
    this.gfx.renderer.setAnimationLoop(() => this.frame());
  }
}
