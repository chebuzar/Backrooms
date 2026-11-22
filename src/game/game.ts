// Ядро гри: режими (меню / гра / пауза), фіксований крок фізики (60 Гц), рендер із частотою екрана,
// камера згладжується між кроками. Налаштування застосовуються на льоту.
import * as THREE from 'three/webgpu';
import type { RendererHandle } from '../render/renderer';
import { PostPipeline, look, setFilm } from '../render/post';
import { Camcorder } from './camcorder';
import { Notebook } from '../ui/notebook';
import { MapMemory } from './mapmem';
import { buildUnseen } from '../world/unseen';
import { makeBody } from '../world/bodies';
import { furnishNii } from '../world/nii-furniture';
import { dressLevel } from '../world/dressing';
import { Psyche } from './psyche';
import { Soundscape } from './soundscape';
import { Tasks } from './tasks';
import { RADIO } from '../story/tasks';
import { lampDeficits } from '../world/materials';
import { PROFILES, QualityGovernor, autoQuality, type QualityProfile } from '../render/quality';
import type { DeviceInfo } from '../core/device';
import { Physics, G } from '../physics/physics';
import { Player } from './player';
import { CameraRig } from './camera-rig';
import { Input } from '../input/input';
import { AudioEngine } from '../audio/audio';
import { SoundBank } from '../audio/bank';
import { GameSound } from './game-sound';
import { Figure } from '../world/monsters/figure';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { HUD } from '../ui/hud';
import { Ambience } from './ambience';
import { Interactions } from './interact';
import { DOCS, NOTES, PSY_DOCS, TAPES, FINDINGS, SPECIAL, PROLOGUE, OBJECTIVES, HINTS, LEVEL_TITLES, levelObjective, type Doc } from '../story/ru';
import { runFinale } from './ending';
import { placeFindings, type Finding } from '../world/findings';
import { placeLockers, type Locker } from '../world/lockers';
import { placeSpecialRooms, type Special } from '../world/special-rooms';
import { TapePlayer } from './tapes';
import { Store, type Settings } from '../core/save';
import { UI } from '../ui/screens';
import { T } from '../i18n/ru';
import { Assets } from '../assets/loader';
import { buildLevel0, type Level } from '../world/level0';
import { buildThemedLevel, type ThemedId } from '../world/level-themed';
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
  /** Відстань до того, куди влучає промінь ліхтарика (до 12 м). */
  private flashHit = 12;
  private flashK = 1;
  private flashT = 0;
  private readonly fwd = new THREE.Vector3();
  /** «Схопив»: ліхтарик на пів секунди світить на обличчя монстра знизу. */
  private flashOverride: { from: THREE.Vector3; at: THREE.Vector3; intensity: number } | null = null;
  /** Відеокамера в руках (V): видошукач, приближення, приховане. */
  readonly cam = new Camcorder();
  private baseFov = 75;
  /** Блокнот (Tab): завдання, карта олівцем, папери. */
  private notebook!: Notebook;
  /** Пам'ять карти поточного рівня. */
  mapmem: MapMemory | null = null;
  private mapT = 0;
  /** Поточне завдання (пишеться олівцем угорі й лишається в блокноті). */
  objective = '';
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
  private phoneAnswered = false;
  private writingSeen = false;
  hide: { l: Locker; dyaw: number; dpitch: number; seen: boolean } | null = null;
  /** Звук поза мисливцями: кроки, фон, гул ламп і Швів, завдання, машинка, дозиметр. */
  readonly snd = new GameSound(this.audio, this.sfx, this.hunt);
  readonly tapes = new TapePlayer(this.audio, this.sfx, (t, sec) => this.hud.subtitle(t, sec));
  private dosiNoiseT = 0;
  /** Батарейки, що лежать на поточному рівні. */
  private pickups: Pickup[] = [];
  hud!: HUD;
  readonly ambience = new Ambience(this.audio);
  interact!: Interactions;
  private stage: 'desk' | 'seam' | 'done' = 'desk';
  private ending = false;
  readonly psyche = new Psyche();
  /** Експозиція з налаштувань (яскравість) і адаптація ока: у темряві зір поволі звикає, під лампою — швидко звужується. */
  private baseExposure = BASE_EXPOSURE;
  private adapt = 1;
  readonly soundscape = new Soundscape(this.audio, (t, sec) => this.hud.subtitle(t, sec));
  /** Обстановка рівня (для контрольних кадрів). */
  dressed: { x: number; z: number; yaw: number; kind: string }[] = [];
  readonly tasks = new Tasks({
    have: (k) => this.store.progress.items.includes(k),
    give: (k) => { if (!this.store.progress.items.includes(k)) { this.store.progress.items.push(k); this.persist(); this.firstMinutes(k); } },
    say: (t, sec) => this.hud.subtitle(t, sec),
    objective: (t) => this.setObjective(t),
    sound: (n, x, y, z) => this.snd.task(n, x, y, z),
    noise: (x, z, loud) => this.hunt.noise(x, 1, z, loud),
    radio: (x, z) => this.tapes.play(RADIO, x, z)
  });
  private figureModel: THREE.Object3D | null = null;
  /** Горизонтальна відстань до стіни/дверей на висоті очей (для психологічного шару). */
  private readonly ray = (x: number, z: number, dx: number, dz: number, max: number): number => {
    const l = Math.hypot(dx, dz) || 1;
    return this.physics.raycast(x, 1.3, z, dx / l, 0, dz / l, max) ?? max;
  };

  constructor(readonly gfx: RendererHandle, readonly device: DeviceInfo, forced: QualityProfile | null) {
    const canvas = gfx.renderer.domElement;
    this.profile = forced ?? this.qualityFromSettings();
    this.post = new PostPipeline(gfx.renderer, this.scene, this.camera);
    const s = this.store.settings;
    const uiRoot = document.getElementById('ui') as HTMLElement;
    this.input = new Input(canvas, uiRoot, { sensitivity: s.sensitivity, invertY: s.invertY, crouchToggle: s.crouchToggle });
    this.ui = new UI(uiRoot);
    this.hud = new HUD(uiRoot);
    this.notebook = new Notebook(uiRoot);
    this.rig = new CameraRig(this.camera);
    this.psyche.events = {
      // кінець тиші: десь зовсім поруч за спиною грюкають двері — і гул повертається
      silenceEnd: (x, z) => {
        const b = this.sfx.pick('doorclose');
        if (b) this.audio.play3D(b, x, 1.2, z, { gain: 0.9, ref: 2, wet: 0.5, rate: 0.8 });
      },
      // крізь видошукач — людина лицем до стіни, якої очима не видно
      sawStill: () => { this.rig.shake = Math.max(this.rig.shake, 0.25); look.fear.value = Math.min(1, look.fear.value + 0.35); }
    };
    const tt = T.tutorial, touch = this.device.touch;
    this.tutorial = new Tutorial([
      { id: 'light', key: 'F', icon: touch ? svg(ICONS.light) : undefined, text: tt.light },
      { id: 'run', key: 'Shift', icon: touch ? svg(ICONS.run) : undefined, text: tt.run },
      { id: 'crouch', key: 'C', icon: touch ? svg(ICONS.crouch) : undefined, text: tt.crouch },
      { id: 'use', key: 'E', icon: touch ? svg(ICONS.use) : undefined, text: tt.use },
      { id: 'camera', key: 'V', icon: touch ? svg(ICONS.camera) : undefined, text: tt.camera },
      { id: 'book', key: 'Tab', icon: touch ? svg(ICONS.book) : undefined, text: tt.book }
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
    this.cam.charge = this.store.progress.camCharge;
    this.psyche.nerves = this.store.progress.nerves;
    this.player.onFootstep = (e) => this.snd.footstep(this.level, e.x, e.y, e.z, e.loudness);
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
    const lvl = id === 0 ? await buildLevel0(this.assets, this.physics, onProgress) : await buildThemedLevel(id as ThemedId, this.assets, this.physics, onProgress, this.profile.name === 'high' || this.profile.name === 'ultra');
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
    // приховане, що видно лише крізь камеру: шлях експедиції до Шва й люди, що лишилися тут
    let unseen: THREE.Object3D | null = null;
    this.figureModel = null;
    try {
      const gl = await this.assets.model('assets/models/figure.glb');
      this.figureModel = gl.scene;
      unseen = buildUnseen(lvl.layout, gl.scene, lvl.id * 977 + 13);
      lvl.scene.add(unseen);
      // тіла з минулих спроб на цьому рівні
      for (const b of this.store.progress.bodies) if (b.level === id) lvl.scene.add(makeBody(gl.scene, b.x, b.z, b.yaw));
    } catch { /* без моделі гра йде далі без прихованого й тіл */ }
    this.psyche.attach(lvl, this.figureModel, unseen);
    this.soundscape.attach(lvl);
    // НИИ, ще без печаток: за пів хвилини рупор кличе Оператора № 7 на вахту — так гравець дізнається, куди йти й що його чекають
    if (lvl.id === 0 && !this.store.progress.items.some((i) => i.startsWith('0:stamp_'))) this.soundscape.schedule(0, 30);
    this.level = lvl;
    this.bat.forLevel(lvl.id);
    setFilm(lvl.id);
    this.saveMap();
    this.mapmem = new MapMemory(lvl.layout);
    this.mapmem.load(this.store.progress.maps[String(lvl.id)]);
    this.omens.attach(lvl);
    this.pickups = await placeBatteries(this.assets, lvl, this.store.progress.pickups);
    this.tapes.stop();
    this.findings = await placeFindings(this.assets, lvl, FINDINGS[lvl.id] ?? []);
    this.hide = null;
    this.lockers = lvl.id === 1 ? await placeLockers(this.assets, this.physics, lvl, [0.33, 0.5, 0.7]) : [];
    this.specials = lvl.id === 0 ? await placeSpecialRooms(this.assets, this.physics, lvl, [...this.findings, ...this.pickups].map((f) => ({ x: f.x, z: f.z }))) : [];
    this.snd.stopGen();
    const busy = [...this.findings, ...this.pickups, ...this.specials, ...this.lockers].map((f) => ({ x: f.x, z: f.z }));
    await this.tasks.build(this.assets, this.physics, lvl, busy);
    const taken = [...busy, ...this.tasks.spots(), ...Object.values(lvl.spots)];
    this.dressed = lvl.id > 0 ? await dressLevel(this.assets, this.physics, lvl, taken) : await furnishNii(this.assets, this.physics, lvl, taken);
    this.phoneAnswered = false; this.writingSeen = false;
    this.setScene(lvl.scene);
    if (this.player) this.setupInteractions(lvl);
    this.levelAudio();
    await this.hunt.setup(lvl, this.assets, this.physics);
    this.setupHideChecks();
    return lvl;
  }

  /** Фон рівня й гул Швів — до нового рівня. */
  private levelAudio(): void {
    const lvl = this.level;
    if (!lvl) return;
    const ph = this.specials.find((s) => s.id === 'phone');
    this.snd.levelAudio(lvl, ph && !this.phoneAnswered ? ph : null);
  }

  private setScene(s: THREE.Scene): void {
    this.scene = s;
    this.post.setScene(s, this.profile);
  }

  private prepareAudio(): void {
    this.snd.prepare(() => this.levelAudio());
    this.ambience.prepare();
    this.levelAudio();
  }

  /** Перші хвилини на рівні 0: печатки ведуть не лише до вахти. Перша — рупор кличе на ім'я, друга — хтось стоїть у кінці коридору. */
  private firstMinutes(k: string): void {
    const stamps = this.store.progress.items.filter((i) => i.startsWith('0:stamp_')).length;
    if (!k.startsWith('0:stamp_')) return;
    if (stamps === 1) this.soundscape.schedule(4, 7);
    if (stamps === 2) this.psyche.scriptGhost(9);
  }

  applySettings(s: Settings): void {
    this.baseExposure = BASE_EXPOSURE * s.brightness;
    look.exposure.value = this.baseExposure * this.adapt;
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
        const start = () => { this.store.newGame(); this.bat.newGame(); this.cam.charge = 1; this.cam.tape = 0; this.psyche.nerves = 0; this.mapmem?.load(undefined); void this.startNewGame(); };
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
      await this.hud.titleCard(c0?.title ?? 'Уровень 0', c0?.sub ?? 'Бесконечный НИИ', async () => { await this.loading; });
    }
    const cp = this.store.progress.checkpoint;
    const card = cp ? LEVEL_TITLES[cp.level] : undefined;
    if (cp && card && this.level?.id !== cp.level) {
      this.ui.closeAll();
      this.audio.unlock(); this.prepareAudio();
      await this.hud.titleCard(card.title, card.sub, async () => { await this.loadLevel(cp.level); });
      this.enterLevelStart(false);
      this.setObjective(this.tasks.objective() ?? levelObjective(cp.level));
    }
    this.play();
  }

  private async startNewGame(): Promise<void> {
    this.ui.closeAll();
    this.input.enabled = false;
    this.audio.unlock(); this.prepareAudio();
    // якщо гравець був на іншому рівні — рівень 0 вантажиться під час прологу
    // рівень 0 ще міг не довантажитися після «18+» — пролог іде поверх завантаження
    const reload = (this.loading ?? Promise.resolve()).then(() => (this.level?.id !== 0 ? this.loadLevel(0).then(() => {}) : this.resetPickups()));
    await this.hud.prologue(PROLOGUE, () => this.snd.typeClick());
    await reload;
    // отямлюється на підлозі обличчям до стіни, крізь яку випав (стіл експедиції — за спиною)
    this.enterLevelStart();
    this.store.progress.checkpoint = { level: 0, spawn: 'start' };
    this.persist();
    await this.arrive();
    this.play();
    this.setObjective(OBJECTIVES.level0Start);
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
      this.hud.subtitle(T.hud.batteries, 2.5);
      this.cam.charge = Math.min(1, this.cam.charge + 0.35); // запасні батарейки підходять і до камери
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
    this.snd.phoneVoice?.stop(0.05); this.snd.phoneVoice = null;
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

  /** Звуки задач: печатка (глухий стук), запобіжник (клацання), генератор (гуркіт, що не стихає). */
  /** Мисливець під час обшуку перевіряє шафки: стає перед дверцятами, смикає їх. Якщо гравець усередині —
   *  знаходить не завжди: що гірше нерви (важке дихання), то вірогідніше. */
  private setupHideChecks(): void {
    const s = this.hunt.stalker;
    if (!s) return;
    s.brain.hideSpots = this.lockers.map((l) => {
      const nx = Math.sin(l.yaw), nz = Math.cos(l.yaw);
      return { x: l.door.x + nx * 0.55, y: 0, z: l.door.z + nz * 0.55, look: { x: l.door.x, y: 1.2, z: l.door.z } };
    });
    s.brain.onCheck = (i) => {
      const l = this.lockers[i];
      if (!l) return;
      const b = this.sfx.get('metalclick'), shut = this.sfx.pick('doorclose');
      if (b) this.audio.play3D(b, l.door.x, 1.1, l.door.z, { gain: 1, rate: 0.7, ref: 2, wet: 0.3 });
      if (shut) this.audio.play3D(shut, l.door.x, 1.1, l.door.z, { gain: 0.6, rate: 1.3, ref: 2, wet: 0.3 });
      const h = this.hide;
      if (h && h.l === l) {
        this.rig.shake = Math.max(this.rig.shake, 0.3);
        look.fear.value = 1;
        this.psyche.shock(0.2);
        if (Math.random() < 0.3 + this.psyche.nerves * 0.4) h.seen = true; // почув дихання — відчиняє
      }
    };
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
    this.store.progress.camCharge = this.cam.charge;
    this.store.progress.nerves = this.psyche.nerves;
    this.saveMap();
    this.store.save();
  }

  private setupInteractions(lvl: Level): void {
    this.interact = new Interactions(this.physics);
    for (const s of Object.values(lvl.spots)) {
      const id = s.id;
      const after = id === 'order7' ? () => { if (this.stage === 'desk') { this.stage = 'seam'; this.setObjective(this.tasks.objective() ?? OBJECTIVES.level0Find); } } : undefined;
      this.interact.add({ id, x: s.x, y: s.y, z: s.z, reach: 1.9, prompt: HINTS.read, enabled: true, use: () => this.readDoc(id, after) });
    }
    const sp = lvl.seam.group.position;
    const tasks = this.tasks;
    this.interact.add({ id: 'seam', x: sp.x, y: 1.3, z: sp.z, reach: 1.7, enabled: true,
      get prompt() { return tasks.gateOpen ? HINTS.enterSeam : HINTS.seamShut; },
      use: () => { if (tasks.gateOpen) void this.enterSeam(lvl.seam, lvl.next); else this.hud.subtitle(tasks.objective() ?? '', 3); } });
    this.tasks.register(this.interact);
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
    return DOCS[id] ?? NOTES[id] ?? PSY_DOCS[id];
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
    const flip = this.sfx.pick('bookflip') ?? this.snd.rustle;
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
      // за останнім Швом — фінал: вибір, кінцівка, ім'я, титри; потім меню (проходження завершене)
      await runFinale(this.hud, this.hud.root, this.store.progress, () => this.snd.typeClick());
      this.store.save();
      look.fade.value = 0; look.fear.value = 0; seam.open.value = 0; this.ending = false;
      this.showMenu();
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
    this.setObjective(this.tasks.objective() ?? levelObjective(target));
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
    // тіло лишається тут назавжди (і в наступних спробах), нерви — не обнуляються
    if (this.level) {
      const body = { level: this.level.id, x: p.x, z: p.z, yaw: this.player.yaw };
      this.store.progress.bodies = [...this.store.progress.bodies, body].slice(-12);
      if (this.figureModel) this.level.scene.add(makeBody(this.figureModel, body.x, body.z, body.yaw));
    }
    this.psyche.afterDeath();
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

  /** Записати карту поточного рівня в збереження (без запису на диск). */
  private saveMap(): void {
    if (this.mapmem && this.level) this.store.progress.maps[String(this.level.id)] = this.mapmem.serialize();
  }

  /** Нове завдання: олівцем угорі на кілька секунд і в блокноті. */
  setObjective(text: string): void {
    this.objective = text;
    this.hud.setObjective(text);
  }

  /** Поставити гравця на старт поточного рівня обличчям до Шва прибуття. */
  private enterLevelStart(face = true): void {
    if (this.hide) { this.hide = null; this.hud.setHidden(false); }
    const s = this.level?.layout.spawn;
    if (s) this.player.teleport(s.x, 0, s.z, s.yaw + (face ? Math.PI : 0));
    this.player.pitch = 0;
    this.stage = this.level?.id === 0 ? 'desk' : 'seam';
    this.cam.lower();
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
    this.cam.lower();
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

  /** Блокнот (Tab / J): завдання, карта олівцем, знайдені папери; Esc, Tab чи J — назад у гру. */
  private openJournal(): void {
    if (this.mode !== 'play' || this.hud.readerOpen) return;
    this.cam.lower();
    this.mode = 'pause';
    this.hud.show(false);
    this.input.enabled = false; this.input.touch?.show(false);
    if (document.pointerLockElement) document.exitPointerLock();
    const flip = this.sfx.pick('bookflip') ?? this.snd.rustle;
    if (flip) this.audio.play2D(flip, 0.55, 1.1);
    this.tried.add('book');
    const docs = [...this.store.progress.docs, ...this.store.progress.notes, ...this.store.progress.tapes].map((id) => ({ id, title: this.docOf(id)?.title ?? id }));
    const lvl = this.level, card = lvl ? LEVEL_TITLES[lvl.id] : undefined;
    this.ui.onBack = () => { this.notebook.close(); this.play(); };
    this.notebook.show({
      level: card?.sub ?? '', objective: this.objective, items: this.taskItems(), docs, map: this.mapmem,
      me: { x: this.player.pos.x, z: this.player.pos.z, yaw: this.player.yaw },
      marks: this.store.progress.bodies.filter((b) => b.level === lvl?.id).map((b) => ({ x: b.x, z: b.z, label: '†' }))
    }, (id) => {
      const d = this.docOf(id);
      if (!d) return;
      this.notebook.close(false);
      this.hud.openDoc(d, () => { this.mode = 'play'; this.openJournal(); });
    }, () => this.play());
  }

  /** Речі задачі рівня для блокнота (заповнюється задачами рівнів). */
  taskItems(): { text: string; done: boolean }[] { return this.tasks.items(); }

  /** ДП-5: клацання за відстанню до найближчого Шва (головний і прихований розлом), стрілка, шум для «Слепого». */
  private updateDosimeter(dt: number): void {
    const lvl = this.level;
    if (!lvl || !this.player) return;
    const p = this.player.pos;
    let d = Infinity;
    for (const s of [lvl.seam, lvl.rift]) if (s) d = Math.min(d, Math.hypot(s.group.position.x - p.x, s.group.position.z - p.z));
    const clicks = this.dosi.update(dt, d, this.mode !== 'play');
    this.snd.geigerClicks(clicks);
    // тріск приладу — теж звук: «Слепой» його чує (тихо, але постійно)
    if (this.dosi.rate > 0 && (this.dosiNoiseT -= dt) <= 0) { this.dosiNoiseT = 1; this.hunt.noise(p.x, p.y + 1, p.z, 0.12 + 0.1 * (this.dosi.rate / 9)); }
    this.hud.setDosimeter(this.dosi.on && this.mode === 'play' ? this.dosi.needle * 0.7 : null); // повний фон ≈ 3.5 мР/ч, не в червоній зоні
  }

  /** Глянути на годинник «Электроника 5»: година експедиції (почали о 23:40); коли нерви на межі — годинник бреше. */
  private lookAtWatch(): void {
    const t = 23 * 3600 + 40 * 60 + this.store.progress.playSeconds;
    const lie = this.watchLies();
    const h = lie ? 1 : Math.floor(t / 3600) % 24, m = lie ? 23 : Math.floor(t / 60) % 60, sec = lie ? 0 : Math.floor(t) % 60;
    this.hud.showWatch(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`, String(sec).padStart(2, '0'));
    const b = this.sfx.get('cloth') ?? this.sfx.pick('cloth');
    if (b) this.audio.play2D(b, 0.25, 1.3);
  }

  /** Чи бреше годинник: що гірше нервам, то частіше показує 01:23. */
  watchLies(): boolean { return this.psyche.lies(); }

  private applyFov(): void {
    const t = Math.tan((this.baseFov * Math.PI) / 360) / (1 + this.cam.zoomK);
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
    if (this.input.consume('journal')) { if (this.mode === 'play') this.openJournal(); else if (this.notebook.open) { this.notebook.close(); this.play(); } }
    if (this.input.consume('camera') && this.mode === 'play' && !this.hide) {
      const was = this.cam.up;
      if (this.cam.toggle()) {
        const click = this.sfx.get('metalclick');
        if (click) this.audio.play2D(click, 0.35, this.cam.up ? 1.45 : 1.2);
        this.tried.add('camera');
      } else if (!was) this.hud.subtitle(T.hud.camDead, 1.5);
      this.input.touch?.setCamera(this.cam.up);
    }
    if (this.input.consume('zoom') && this.mode === 'play' && this.cam.toggleZoom()) {
      const click = this.sfx.get('metalclick');
      if (click) this.audio.play2D(click, 0.2, this.cam.zoom ? 1.6 : 1.4);
      this.hud.setZoom(this.cam.zoom, T.hud.zoom);
    }
    if (this.input.consume('watch') && this.mode === 'play') this.lookAtWatch();
    if (this.input.consume('dosimeter') && this.mode === 'play') {
      this.dosi.on = !this.dosi.on;
      const sw = this.sfx.get('metalclick');
      if (sw) this.audio.play2D(sw, 0.35, this.dosi.on ? 1.3 : 1.15);
      this.input.touch?.setLatched('dosi', this.dosi.on);
    }
    const zk0 = this.cam.zoomK;
    if (this.cam.update(dt, this.mode === 'play')) { this.hud.subtitle(T.hud.camDead, 2); this.input.touch?.setCamera(false); }
    if (zk0 !== this.cam.zoomK) this.applyFov();
    if (!this.cam.zoom) this.hud.setZoom(false, T.hud.zoom);
    look.cam.value = this.cam.k;
    this.hud.setCamera(this.cam.k, this.cam.charge);
    this.hud.setTape(this.cam.tape);
    this.cam.applyLayers(this.camera);
    let [lx, ly] = this.input.takeLook();
    // у зумі погляд повертається повільніше — точніше роздивитися далеке
    const lk = 1 / (1 + this.cam.zoomK); lx *= lk; ly *= lk;
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
        this.psyche.update(dt, {
          x: this.player.pos.x, z: this.player.pos.z, yaw: this.player.yaw, camera: this.camera, camUp: this.cam.k > 0.5,
          flashlight: this.flashlightOn, danger: this.hunt.danger, hidden: !!this.hide, playing: true, ray: this.ray
        });
        this.hunt.heartFloor = Math.max(0, this.psyche.nerves - 0.55) * 0.9;
        const omen = this.tension.update(dt, this.hunt.danger);
        if (omen) this.omens.play(omen, lvl, { x: this.player.pos.x, z: this.player.pos.z, yaw: this.player.yaw }, this.camera);
      }
      this.omens.update(dt);
      look.fear.value = Math.max(0, look.fear.value - dt * 0.12);
      look.dread.value += (this.psyche.dread - look.dread.value) * Math.min(1, dt * 0.8);
      if (this.mode === 'play' && !this.ending) this.soundscape.update(dt, { x: this.player.pos.x, z: this.player.pos.z, dread: this.psyche.dread, silence: this.psyche.silence, danger: this.hunt.danger });
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
        this.flashHit = this.physics.raycast(c.position.x, c.position.y, c.position.z, d.x, d.y, d.z, 12, G.STATIC | G.DOOR | G.PROP) ?? 12;
        this.flashNear = Math.min(10, this.flashHit);
      }
      const nearK = Math.min(1, Math.max(0.1, (this.flashNear / 1.4) ** 2));
      this.flashK += (nearK - this.flashK) * Math.min(1, dt * 8);
      fl.intensity += ((this.flashlightOn ? 26 * (0.35 + 0.65 * low) * dip * this.flashK : 0) - fl.intensity) * Math.min(1, dt * 18);
      const spill = fl.children[0] as THREE.SpotLight | undefined;
      if (spill) spill.intensity = fl.intensity * 0.12;
      // відбите від плями світло: трохи перед точкою влучання, слабшає з відстанню (пляма більша, але тьмяніша)
      const bounce = fl.userData.bounce as THREE.PointLight | undefined;
      if (bounce) {
        const d = this.fwd.set(0, 0, -1).applyQuaternion(c.quaternion), h = Math.max(0.3, this.flashHit - 0.45);
        bounce.position.copy(c.position).addScaledVector(d, h);
        bounce.intensity = this.flashHit >= 12 ? 0 : fl.intensity * 0.075 / (1 + this.flashHit * 0.12);
      }
      fl.position.set(0.18, -0.16, 0.05).applyQuaternion(c.quaternion).add(c.position);
      fl.target.position.set(0, -0.08, -6).applyQuaternion(c.quaternion).add(c.position);
      const fo = this.flashOverride;
      if (fo) { fl.position.copy(fo.from); fl.target.position.copy(fo.at); fl.intensity = fo.intensity; }
      this.snd.updateHum(dt, lvl, c.position.x, c.position.z, 1 - this.psyche.silence);
      // адаптація ока: скільки світла довкола (живі лампи + власний ліхтарик) → бажана «діафрагма»;
      // у темряві очі звикають за ~6 с (тіні проступають, але чорне лишається чорним), на світлі — за ~0.7 с
      const E = lvl.lamps.lightAt(c.position.x, c.position.z) + (this.flashlightOn ? 0.3 * this.flashK : 0);
      const want = Math.min(1.75, Math.max(0.85, Math.sqrt(0.75 / (E + 0.26))));
      this.adapt += (want - this.adapt) * Math.min(1, dt * (want > this.adapt ? 0.4 : 2.2));
      look.exposure.value = this.baseExposure * this.adapt;
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
      this.tasks.update(dt);
      if (this.level?.water) {
        this.level.water.update(this.tasks.drain);
        this.player.slow = this.level.water.wetAt(this.player.pos.x, this.player.pos.z) ? 0.8 : 1;
      }
      if ((this.persistT -= dt) <= 0) { this.persistT = 10; this.persist(); }
      if (this.psyche.silence < 0.3) this.ambience.update(dt, this.player);
      if (this.mapmem && (this.mapT -= dt) <= 0) { this.mapT = 0.25; this.mapmem.mark(this.player.pos.x, this.player.pos.z); }
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
