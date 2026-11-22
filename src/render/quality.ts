// Профілі графіки. «Авто» вибирає профіль коротким тестом на справжній сцені (autotune.ts) у межах пристрою;
// під час гри PresetGovernor знижує пресет, якщо кадр стабільно задовгий, а QualityGovernor у «Низком» — роздільність.
import { deviceCap, ORDER, type DeviceSignals } from './autotune';

export type QualityName = 'low' | 'medium' | 'high' | 'ultra';

export interface QualityProfile {
  name: QualityName;
  /** Максимальна щільність пікселів (множник до CSS-пікселів). */
  maxPixelRatio: number;
  /** Тіні в кутах (GTAO): 0 — вимкнено, інакше частка роздільності. */
  ao: number;
  /** Свічення (bloom): частка роздільності, 0 — вимкнено. */
  bloom: number;
  /** Часове згладжування (TRAA): прибирає «драбинки» й шум AO. */
  traa: boolean;
  /** Анізотропна фільтрація текстур. */
  anisotropy: number;
  /** Розмір карти тіні ліхтарика (пікселів на бік): єдина справжня тінь у грі — на слабких пристроях дешевша. */
  shadow: number;
}

export const PROFILES: Record<QualityName, QualityProfile> = {
  low: { name: 'low', maxPixelRatio: 1, ao: 0, bloom: 0.25, traa: true, anisotropy: 2, shadow: 512 },
  medium: { name: 'medium', maxPixelRatio: 1.5, ao: 0.5, bloom: 0.5, traa: true, anisotropy: 4, shadow: 1024 },
  high: { name: 'high', maxPixelRatio: 2, ao: 0.5, bloom: 0.5, traa: true, anisotropy: 8, shadow: 1024 },
  ultra: { name: 'ultra', maxPixelRatio: 2, ao: 1, bloom: 0.5, traa: true, anisotropy: 16, shadow: 2048 }
};

/**
 * Здогад без тесту (поки тест не пройшов або коли він неможливий): евристика за платформою, але не вище меж пристрою.
 * Остаточний вибір «Авто» робить тест на справжній сцені (render/autotune.ts).
 */
export function autoQuality(d: DeviceSignals, webgpu: boolean): QualityName {
  if (d.software) return 'low';
  let q: QualityName;
  if (d.platform === 'apple') q = d.form === 'desktop' ? (webgpu ? 'ultra' : 'high') : d.form === 'tablet' ? 'medium' : 'medium';
  else if (d.platform === 'android') q = d.cores >= 8 ? 'medium' : 'low';
  else q = webgpu ? 'ultra' : 'high';
  const cap = deviceCap(d);
  return ORDER.indexOf(q) <= ORDER.indexOf(cap) ? q : cap;
}

const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1] ?? 0; };

/**
 * Роздільність рендера в пресеті «Низкое»: якщо медіана кадру (поодинокі ривки її не зсувають) стабільно довша за ціль —
 * трохи зменшує (не нижче 70 %); коли запас з'являється — повертає. Різких стрибків немає.
 */
export class QualityGovernor {
  scale = 1;
  private acc = 0;
  private win: number[] = [];
  constructor(private readonly minScale = 0.7, private readonly targetMs = 1000 / 58) {}

  /** @returns true, якщо масштаб змінився й треба оновити розмір рендера */
  update(dtMs: number): boolean {
    this.acc += dtMs;
    this.win.push(dtMs);
    if (this.acc < 2000) return false;
    const med = median(this.win);
    this.acc = 0;
    this.win = [];
    const prev = this.scale;
    if (med > this.targetMs * 1.15) this.scale = Math.max(this.minScale, this.scale - 0.08);
    else if (med < this.targetMs * 0.8) this.scale = Math.min(1, this.scale + 0.05);
    return prev !== this.scale;
  }
}

/**
 * «Авто» під час гри: вікна по 2 с; якщо медіана кадру довша за межу два вікна поспіль — пора на пресет нижче.
 * Медіана, а не середнє: одиничний ривок (завантаження, збирач сміття) не має знижувати якість назавжди.
 */
export class PresetGovernor {
  private acc = 0;
  private win: number[] = [];
  private strikes = 0;
  private cool = 0;
  constructor(private readonly windowMs = 2000, private readonly need = 2) {}

  reset(): void { this.acc = 0; this.win = []; this.strikes = 0; this.cool = 3000; }

  /** @returns true — кадр стабільно задовгий, знизити пресет */
  update(dtMs: number, limitMs: number): boolean {
    this.cool -= dtMs;
    this.acc += dtMs;
    this.win.push(dtMs);
    if (this.acc < this.windowMs) return false;
    const med = median(this.win);
    this.acc = 0;
    this.win = [];
    if (this.cool > 0) return false;
    this.strikes = med > limitMs ? this.strikes + 1 : 0;
    if (this.strikes < this.need) return false;
    this.strikes = 0;
    this.cool = 6000; // новому пресету — час показати себе
    return true;
  }
}
