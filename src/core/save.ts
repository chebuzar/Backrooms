// Збереження: налаштування й прогрес гравця в localStorage (ключ zakulisye_v3).
// Формат має номер версії; невідомі/зіпсовані дані не ламають гру — береться значення за замовчуванням.
import type { QualityName } from '../render/quality';

export interface Settings {
  quality: 'auto' | QualityName;
  brightness: number; // 0.6..1.6 (множник експозиції)
  masterVolume: number; // 0..1
  musicVolume: number;
  sfxVolume: number;
  sensitivity: number; // 0.2..3
  invertY: boolean;
  crouchToggle: boolean;
  fov: number; // 60..90
  subtitles: boolean;
  /** Обмеження частоти кадрів: '30', '60' або 'off' (без обмеження). */
  fpsLimit: '30' | '60' | 'off';
}

export interface Progress {
  /** Остання контрольна точка: рівень і місце. */
  checkpoint: { level: number; spawn: string } | null;
  /** Знайдені документи, записки, плівки (id). */
  docs: string[];
  notes: string[];
  tapes: string[];
  /** Пройдені рівні. */
  completed: number[];
  endings: string[];
  playSeconds: number;
  deaths: number;
  /** Заряд ліхтарика 0..1 (необов'язкове в старих записах — тоді повний). */
  battery: number;
  /** Підібрані батарейки поточного проходження (id) — щоб не з'являлися знову. */
  pickups: string[];
}

interface SaveFile {
  v: 3;
  ageConfirmed: boolean;
  settings: Settings;
  progress: Progress;
}

const KEY = 'zakulisye_v3';

export const DEFAULT_SETTINGS: Settings = {
  quality: 'auto', brightness: 1, masterVolume: 0.85, musicVolume: 0.7, sfxVolume: 1,
  sensitivity: 1, invertY: false, crouchToggle: false, fov: 75, subtitles: true, fpsLimit: '60'
};

const freshProgress = (): Progress => ({ checkpoint: null, docs: [], notes: [], tapes: [], completed: [], endings: [], playSeconds: 0, deaths: 0, battery: 1, pickups: [] });

const num = (v: unknown, d: number, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const QUALITIES = ['auto', 'low', 'medium', 'high', 'ultra'] as const;

/** Розібрати збережені дані з перевіркою кожного поля. */
export function parseSave(raw: string | null): SaveFile {
  let o: Record<string, unknown> = {};
  try { const p = raw ? JSON.parse(raw) : null; if (p && typeof p === 'object') o = p as Record<string, unknown>; } catch { /* зіпсований запис */ }
  const s = (o.settings ?? {}) as Record<string, unknown>;
  const p = (o.progress ?? {}) as Record<string, unknown>;
  const d = DEFAULT_SETTINGS;
  const cp = p.checkpoint as { level?: unknown; spawn?: unknown } | null | undefined;
  return {
    v: 3,
    ageConfirmed: bool(o.ageConfirmed, false),
    settings: {
      quality: (QUALITIES as readonly string[]).includes(s.quality as string) ? (s.quality as Settings['quality']) : d.quality,
      brightness: num(s.brightness, d.brightness, 0.6, 1.6),
      masterVolume: num(s.masterVolume, d.masterVolume, 0, 1),
      musicVolume: num(s.musicVolume, d.musicVolume, 0, 1),
      sfxVolume: num(s.sfxVolume, d.sfxVolume, 0, 1),
      sensitivity: num(s.sensitivity, d.sensitivity, 0.2, 3),
      invertY: bool(s.invertY, d.invertY),
      crouchToggle: bool(s.crouchToggle, d.crouchToggle),
      fov: num(s.fov, d.fov, 60, 90),
      subtitles: bool(s.subtitles, d.subtitles),
      fpsLimit: s.fpsLimit === '30' || s.fpsLimit === '60' || s.fpsLimit === 'off' ? s.fpsLimit : d.fpsLimit
    },
    progress: {
      ...freshProgress(),
      checkpoint: cp && typeof cp.level === 'number' && typeof cp.spawn === 'string' ? { level: cp.level, spawn: cp.spawn } : null,
      docs: strs(p.docs), notes: strs(p.notes), tapes: strs(p.tapes),
      completed: Array.isArray(p.completed) ? p.completed.filter((x): x is number => typeof x === 'number') : [],
      endings: strs(p.endings),
      playSeconds: num(p.playSeconds, 0, 0, 1e9),
      deaths: num(p.deaths, 0, 0, 1e9),
      battery: typeof p.battery === 'number' && p.battery >= 0 && p.battery <= 1 ? p.battery : 1,
      pickups: strs(p.pickups)
    }
  };
}

export class Store {
  data: SaveFile;
  constructor(private readonly storage: Pick<Storage, 'getItem' | 'setItem'> | null = safeStorage()) {
    this.data = parseSave(this.storage?.getItem(KEY) ?? null);
  }
  get settings(): Settings { return this.data.settings; }
  get progress(): Progress { return this.data.progress; }
  save(): void {
    try { this.storage?.setItem(KEY, JSON.stringify(this.data)); } catch { /* приватний режим Safari / переповнено */ }
  }
  newGame(): void {
    this.data.progress = freshProgress();
    this.save();
  }
}

function safeStorage(): Storage | null {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
}
