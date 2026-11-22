// Автовибір графіки: «що цей пристрій реально тягне в НАШІЙ грі».
// 1) Межі за пристроєм (сигнали): програмний рендер → лише «Низкое»; телефон/планшет — не вище «Высокого» (нагрів за
//    пів години гри); мало пам'яті, слабкий процесор чи відома слабка відеокарта — нижча межа.
// 2) Короткий тест на справжній сцені рівня (1–2 с під заставкою, кадр чорний): кілька кадрів поспіль повним конвеєром
//    у справжній роздільності, з очікуванням GPU — це «скільки мс коштує кадр», а не обмежені екраном 60 FPS.
// 3) Найвищий пресет, чий кадр вкладається в бюджет 60 FPS із запасом на логіку гри й випадкові піки.
// Результат кешується на пристрої (відбиток: GPU, рендер, екран, ядра, версія тесту); якщо під час гри кадр стабільно
// задовгий і гра сама знизила якість — це теж запам'ятовується («вивчене»), щоб наступного запуску не смикалось.
import type { DeviceInfo } from '../core/device';
import type { QualityName } from './quality';

export const ORDER: readonly QualityName[] = ['low', 'medium', 'high', 'ultra'];
/** Версія тесту: зміниш методику чи пресети — підніми, і всі пристрої переміряються. */
export const BENCH_V = 1;
/** Кадр рендера має вкладатися в 70 % від 1/60 с: решта — логіка гри (ШІ, фізика, звук) і запас на піки. */
export const BUDGET_MS = (1000 / 60) * 0.7;
/** «Вивчене» зниження живе 10 днів: потім тест знову вирішує (можливо, тоді грали в спеку на зарядці). */
const LEARNED_DAYS = 10;
const KEY = 'zakulisye_gfx_v1';

const rank = (q: QualityName) => ORDER.indexOf(q);
const minQ = (a: QualityName, b: QualityName) => (rank(a) <= rank(b) ? a : b);

export interface DeviceSignals extends DeviceInfo {
  /** navigator.deviceMemory (ГБ; лише Chromium), якщо є. */
  memory?: number | null;
}

/** Найвищий пресет, який дозволяють сигнали пристрою (тест вибирає в цих межах). */
export function deviceCap(d: DeviceSignals): QualityName {
  if (d.software) return 'low';
  let cap: QualityName = d.form === 'desktop' ? 'ultra' : 'high';
  const mem = d.memory ?? null;
  if (mem !== null && mem <= 2) cap = minQ(cap, 'low');
  else if (mem !== null && mem < 4) cap = minQ(cap, 'medium');
  // Safari занижує/округлює кількість ядер з міркувань приватності — на Apple не довіряємо
  if (d.platform !== 'apple') {
    if (d.cores <= 2) cap = minQ(cap, 'low');
    else if (d.cores <= 4) cap = minQ(cap, 'medium');
  }
  // відомі слабкі відеокарти (вбудовані старих поколінь, бюджетні мобільні)
  if (/Intel.*\b(U?HD|HD) Graphics|Mali-[GT]\d{2}\b|Mali-4|Adreno.*\b[3-5]\d\d\b|PowerVR|Apple A(9|10|11)\b/i.test(d.gpu)) cap = minQ(cap, 'medium');
  return cap;
}

/** Відбиток пристрою: змінився — тест проводиться знову. */
export function deviceKey(d: DeviceSignals, backend: string, screen: { width: number; height: number }): string {
  const s = [Math.max(screen.width, screen.height), Math.min(screen.width, screen.height)].join('x');
  return [`v${BENCH_V}`, backend, d.gpu || '?', d.platform, d.form, d.dpr, s, d.cores, d.memory ?? '?'].join('|');
}

export interface Calibration {
  key: string;
  /** Що вибрав тест. */
  preset: QualityName;
  /** Виміряний час кадру рендера, мс, за пресетами. */
  ms: Partial<Record<QualityName, number>>;
  /** Нижчий пресет, до якого гра сама знизилась під час гри, і коли. */
  learned?: { preset: QualityName; at: number } | null;
  at: number;
}

/** Що «Авто» вмикає зараз: результат тесту, але не вище вивченого під час гри. */
export function effectivePreset(c: Calibration, now = Date.now()): QualityName {
  const l = c.learned;
  return l && now - l.at < LEARNED_DAYS * 864e5 ? minQ(c.preset, l.preset) : c.preset;
}

/** Найвищий пресет у межах cap, чий виміряний кадр ≤ бюджету; нічого не вкладається — «Низкое». */
export function choose(ms: Partial<Record<QualityName, number>>, cap: QualityName, budget = BUDGET_MS): QualityName {
  let best: QualityName = 'low';
  for (const q of ORDER) if (rank(q) <= rank(cap) && (ms[q] ?? Infinity) <= budget) best = q;
  return best;
}

/**
 * Порядок замірів: з «Высокого» (або межі), далі вгору, поки вкладається, чи вниз, поки ні. Звичайно — 2 заміри.
 * measure(q) повертає мс кадру.
 */
export async function runCalibration(cap: QualityName, measure: (q: QualityName) => Promise<number>, budget = BUDGET_MS): Promise<{ preset: QualityName; ms: Partial<Record<QualityName, number>> }> {
  const ms: Partial<Record<QualityName, number>> = {};
  let i = Math.min(rank('high'), rank(cap));
  const fits = async (k: number) => { const q = ORDER[k] as QualityName; ms[q] = +(await measure(q)).toFixed(2); return (ms[q] as number) <= budget; };
  if (await fits(i)) {
    while (i < rank(cap) && (await fits(i + 1))) i++;
  } else {
    while (i > 0 && !(await fits(i - 1))) i--;
  }
  return { preset: choose(ms, cap, budget), ms };
}

const QS = new Set<string>(ORDER);
export function loadCalibration(key: string): Calibration | null {
  try {
    const o = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Calibration> | null;
    if (!o || o.key !== key || typeof o.preset !== 'string' || !QS.has(o.preset)) return null;
    const l = o.learned;
    return {
      key, preset: o.preset, ms: o.ms && typeof o.ms === 'object' ? o.ms : {}, at: typeof o.at === 'number' ? o.at : 0,
      learned: l && typeof l.preset === 'string' && QS.has(l.preset) && typeof l.at === 'number' ? l : null
    };
  } catch { return null; }
}
export function saveCalibration(c: Calibration): void {
  try { localStorage.setItem(KEY, JSON.stringify(c)); } catch { /* приватний режим Safari */ }
}
export function clearCalibration(): void {
  try { localStorage.removeItem(KEY); } catch { /* немає сховища */ }
}
