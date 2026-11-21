// Мозок монстра: відчуття (зір з урахуванням світла, слух з урахуванням стін), пам'ять і стани
// патруль → підозра → пошук → погоня → втрата сліду. Кожен монстр має свої «правила» (Traits),
// тож поведінка різна. Без three.js і DOM — повністю тестується в Node.
import type { NavLike, V3 } from './nav';

export type State = 'patrol' | 'suspicious' | 'investigate' | 'search' | 'chase' | 'lost' | 'idle';

export interface Traits {
  /** Зір: дальність (м), половина кута огляду (рад). 0 — сліпий. */
  sightRange: number;
  fovHalf: number;
  /** Слух: множник радіуса чутності шуму. 0 — глухий. */
  hearing: number;
  walkSpeed: number;
  runSpeed: number;
  /** Скільки секунд шукає, перш ніж здатися. */
  searchTime: number;
  /** Як швидко помічає (0..1 за секунду при повній видимості). */
  alertness: number;
  /** Боїться світла ліхтарика: у промені відступає/завмирає. */
  fearsLight?: boolean;
  /** Рухається лише тоді, коли на нього не дивляться. */
  movesWhenUnseen?: boolean;
  /** Намагається перехопити гравця, а не просто бігти за ним. */
  cutsOff?: boolean;
  /** Не блукає: стоїть на місці, доки вперше не помітить гравця (далі — звичайні стани). */
  stillUntilNoticed?: boolean;
}

export interface PlayerView {
  x: number; y: number; z: number;
  vx: number; vz: number;
  /** Наскільки гравця видно в цій точці: світло довкола 0..1 (ліхтарик — окремо). */
  light: number;
  flashlightOn: boolean;
  crouched: boolean;
  /** Чи дивиться гравець прямо на монстра (і бачить його). */
  looksAtMe: boolean;
  /** Чи світить ліхтарик на монстра. */
  litByFlashlight: boolean;
  /** Сховався (шафка): не видно зовсім. */
  hidden?: boolean;
  /** Мисливець бачив, як гравець ховався (тоді йде до шафки й відчиняє). */
  hiddenSeen?: boolean;
}

export interface Noise { x: number; y: number; z: number; loudness: number; t: number }

export interface Senses {
  /** Пряма видимість (без стін) між точками на рівні очей. */
  los(a: V3, b: V3): boolean;
}

export interface Memory {
  /** Остання відома позиція гравця та впевненість 0..1. */
  last: V3 | null;
  confidence: number;
  /** Скільки секунд тому бачив/чув. */
  age: number;
  /** Накопичена підозра 0..1 (миттєво не реагує на одну мить). */
  suspicion: number;
}

export interface Intent {
  /** Куди йти (null — стояти). */
  target: V3 | null;
  speed: number;
  /** Куди дивитися (для голови/звуку). */
  lookAt: V3 | null;
  /** Атакувати, якщо близько. */
  attack: boolean;
}

export class Brain {
  state: State = 'patrol';
  readonly mem: Memory = { last: null, confidence: 0, age: 0, suspicion: 0 };
  private stateT = 0;
  private patrolTarget: V3 | null = null;
  private searchPoints: V3[] = [];
  private pause = 0;
  /** Схованки (шафки): точка перед дверцятами. Під час обшуку перевіряє найближчі до місця, де втратив гравця. */
  hideSpots: (V3 & { look?: V3 })[] = [];
  private checked = new Set<number>();
  private checking = -1;
  private checkT = 0;
  /** Стоїть перед схованкою й відчиняє її (індекс) — рішення, чи там гравець, ухвалює гра. */
  onCheck: ((i: number) => void) | null = null;
  /** Зараз біля схованки (для звуку й анімації). */
  get checkingSpot(): number { return this.checkT > 0 ? this.checking : -1; }
  /** Бачить гравця в цей момент. */
  seesPlayer = false;
  /** Хоч раз помічав гравця (підозра дійшла до дії) — для stillUntilNoticed. */
  noticed = false;
  private readonly rnd: () => number;

  constructor(readonly traits: Traits, private readonly nav: NavLike, private readonly senses: Senses, readonly pos: V3, rnd: () => number = Math.random) {
    this.rnd = rnd;
  }

  private set(s: State): void {
    if (s === this.state) return;
    this.state = s;
    this.stateT = 0;
    if (s !== 'patrol' && s !== 'idle') this.noticed = true;
    if (s === 'search') { this.searchPoints = []; this.checked.clear(); this.checking = -1; this.checkT = 0; }
    if (s === 'patrol') this.patrolTarget = null;
  }

  /** Почути шум: що гучніший і ближчий, то сильніша підозра; стіни глушать (шлях довший за пряму). */
  hear(n: Noise): void {
    if (this.traits.hearing <= 0) return;
    const straight = Math.hypot(n.x - this.pos.x, n.z - this.pos.z);
    const radius = n.loudness * 22 * this.traits.hearing;
    if (straight > radius) return;
    const walk = this.nav.pathLength(this.pos, n);
    const muffle = Number.isFinite(walk) ? Math.min(1, straight / Math.max(walk, 0.01)) : 0.3;
    const strength = (1 - straight / radius) * (0.4 + 0.6 * muffle);
    if (strength <= 0.05) return;
    this.mem.suspicion = Math.min(1, this.mem.suspicion + strength * 0.8);
    // гучний шум зблизька — точне місце; тихий — приблизне
    const err = (1 - strength) * 3;
    this.mem.last = { x: n.x + (this.rnd() - 0.5) * err, y: n.y, z: n.z + (this.rnd() - 0.5) * err };
    this.mem.confidence = Math.max(this.mem.confidence, strength);
    this.mem.age = 0;
  }

  /** Чи бачить гравця: дальність, кут, стіни, освітленість, ліхтарик, присід. Повертає «ступінь видимості» 0..1. */
  visibility(p: PlayerView, eye: V3): number {
    const t = this.traits;
    if (t.sightRange <= 0 || p.hidden) return 0;
    const dx = p.x - this.pos.x, dz = p.z - this.pos.z;
    const d = Math.hypot(dx, dz);
    // ліхтарик видно здалеку; у темряві силует губиться
    const lit = Math.min(1, p.light + (p.flashlightOn ? 0.75 : 0));
    const range = t.sightRange * (0.35 + 0.65 * lit) * (p.crouched ? 0.75 : 1);
    if (d > range) return 0;
    const heading = Math.atan2(this.headX, this.headZ);
    const ang = Math.abs(normAngle(Math.atan2(dx, dz) - heading));
    const fov = d < 2.5 ? Math.PI * 0.9 : t.fovHalf; // зовсім поруч відчуває збоку
    if (ang > fov) return 0;
    if (!this.senses.los(eye, { x: p.x, y: p.y + (p.crouched ? 0.9 : 1.5), z: p.z })) return 0;
    return (1 - d / range) * (0.4 + 0.6 * lit) * (1 - ang / (fov * 1.4));
  }

  headX = 0;
  headZ = 1;

  update(dt: number, p: PlayerView, eye: V3): Intent {
    const t = this.traits;
    this.stateT += dt;
    this.mem.age += dt;
    const vis = this.visibility(p, eye);
    this.seesPlayer = vis > 0;
    if (vis > 0) {
      this.mem.suspicion = Math.min(1, this.mem.suspicion + vis * t.alertness * dt * (this.state === 'chase' ? 3 : 1));
      if (this.mem.suspicion > 0.35 || this.state === 'chase') {
        this.mem.last = { x: p.x, y: p.y, z: p.z };
        this.mem.confidence = 1;
        this.mem.age = 0;
      }
    } else {
      this.mem.suspicion = Math.max(0, this.mem.suspicion - dt * (this.state === 'chase' ? 0.08 : 0.05));
      this.mem.confidence = Math.max(0, this.mem.confidence - dt * 0.06);
    }

    // правила монстра, що діють поверх станів
    if (t.movesWhenUnseen && p.looksAtMe) return { target: null, speed: 0, lookAt: p, attack: false };
    if (t.fearsLight && p.litByFlashlight) {
      // відступає від світла, тримаючи погляд на гравцеві
      const dx = this.pos.x - p.x, dz = this.pos.z - p.z, d = Math.hypot(dx, dz) || 1;
      const away = this.nav.closest({ x: this.pos.x + (dx / d) * 3, y: this.pos.y, z: this.pos.z + (dz / d) * 3 });
      return { target: away, speed: t.runSpeed * 0.8, lookAt: p, attack: false };
    }

    switch (this.state) {
      case 'idle':
      case 'patrol': {
        if (this.mem.suspicion >= 0.9 && this.seesPlayer) this.set('chase');
        else if (this.mem.suspicion >= 0.3 && this.mem.last) this.set('suspicious');
        break;
      }
      case 'suspicious': {
        // завмирає, «прислухається», потім іде перевірити
        if (this.seesPlayer && this.mem.suspicion >= 0.9) this.set('chase');
        else if (this.stateT > 0.8 + this.rnd() * 0.8) this.set('investigate');
        break;
      }
      case 'investigate': {
        if (this.seesPlayer && this.mem.suspicion >= 0.75) this.set('chase');
        else if (this.mem.last && dist(this.pos, this.mem.last) < 1.2) this.set('search');
        else if (this.stateT > 25) this.set('search');
        break;
      }
      case 'chase': {
        if (!this.seesPlayer && this.mem.age > 1.5 && (!this.mem.last || dist(this.pos, this.mem.last) < 1.0)) this.set('search');
        else if (!this.seesPlayer && this.mem.age > 6) this.set('search');
        break;
      }
      case 'search': {
        if (this.seesPlayer && this.mem.suspicion >= 0.6) this.set('chase');
        else if (this.stateT > t.searchTime) this.set('lost');
        break;
      }
      case 'lost': {
        if (this.seesPlayer && this.mem.suspicion >= 0.6) this.set('chase');
        else if (this.stateT > 3) { this.mem.last = null; this.mem.suspicion = 0; this.set('patrol'); }
        break;
      }
    }

    return this.act(p, dt);
  }

  private act(p: PlayerView, dt: number): Intent {
    const t = this.traits;
    switch (this.state) {
      case 'patrol': {
        if (t.stillUntilNoticed && !this.noticed) return { target: null, speed: 0, lookAt: null, attack: false };
        if (this.pause > 0) { this.pause -= dt; return { target: null, speed: 0, lookAt: null, attack: false }; }
        if (!this.patrolTarget || dist(this.pos, this.patrolTarget) < 0.8) {
          // непередбачуваність: інколи зупиняється й «слухає», інколи йде далеко
          if (this.patrolTarget && this.rnd() < 0.35) this.pause = 1.5 + this.rnd() * 4;
          this.patrolTarget = this.nav.randomAround(this.pos, 6 + this.rnd() * 18);
        }
        return { target: this.patrolTarget, speed: t.walkSpeed, lookAt: null, attack: false };
      }
      case 'suspicious':
        return { target: null, speed: 0, lookAt: this.mem.last, attack: false };
      case 'investigate':
        return { target: this.mem.last, speed: t.walkSpeed * 1.15, lookAt: this.mem.last, attack: false };
      case 'chase': {
        let target: V3 = this.mem.last ?? p;
        if (this.seesPlayer && t.cutsOff) {
          // перехоплення: біжить туди, де гравець буде за ~1 с
          const lead = Math.min(1.4, dist(this.pos, p) / Math.max(t.runSpeed, 0.1));
          target = this.nav.closest({ x: p.x + p.vx * lead, y: p.y, z: p.z + p.vz * lead });
        }
        return { target, speed: t.runSpeed, lookAt: p, attack: dist(this.pos, p) < 1.0 };
      }
      case 'search': {
        // обшук: спершу схованки поблизу місця, де втратив гравця (стоїть перед кожною, відчиняє), потім — точки довкола
        const c = this.mem.last ?? this.pos;
        if (this.checking < 0) {
          let best = -1, bd = 12;
          this.hideSpots.forEach((h, i) => { const d = dist(h, c); if (!this.checked.has(i) && d < bd) { bd = d; best = i; } });
          this.checking = best;
        }
        if (this.checking >= 0) {
          const h = this.hideSpots[this.checking] as V3 & { look?: V3 };
          if (dist(this.pos, h) > 0.55 && this.checkT === 0) return { target: h, speed: t.walkSpeed * 1.1, lookAt: null, attack: false };
          this.checkT += dt;
          if (this.checkT > 2.4) {
            this.onCheck?.(this.checking);
            this.checked.add(this.checking);
            this.checking = -1; this.checkT = 0;
          }
          return { target: null, speed: 0, lookAt: h.look ?? h, attack: false };
        }
        if (!this.searchPoints.length || dist(this.pos, this.searchPoints[0] as V3) < 0.9) {
          this.searchPoints.shift();
          if (!this.searchPoints.length) this.searchPoints.push(this.nav.randomAround(c, 3 + this.stateT * 0.4));
        }
        return { target: this.searchPoints[0] ?? null, speed: t.walkSpeed * 1.1, lookAt: null, attack: false };
      }
      case 'lost':
      case 'idle':
      default:
        return { target: null, speed: 0, lookAt: null, attack: false };
    }
  }
}

export const dist = (a: V3, b: V3) => Math.hypot(a.x - b.x, a.z - b.z);
export const normAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
