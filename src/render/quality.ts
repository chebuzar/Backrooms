// Профілі графіки. «Авто» вибирає стартовий профіль за пристроєм, а під час гри
// QualityGovernor стежить за часом кадру й акуратно підлаштовує лише роздільність рендера.
import type { DeviceInfo } from '../core/device';

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
  /** Скільки живих джерел світла біля гравця. */
  dynamicLights: number;
}

export const PROFILES: Record<QualityName, QualityProfile> = {
  low: { name: 'low', maxPixelRatio: 1, ao: 0, bloom: 0.25, traa: true, anisotropy: 2, dynamicLights: 2 },
  medium: { name: 'medium', maxPixelRatio: 1.5, ao: 0.5, bloom: 0.5, traa: true, anisotropy: 4, dynamicLights: 3 },
  high: { name: 'high', maxPixelRatio: 2, ao: 0.5, bloom: 0.5, traa: true, anisotropy: 8, dynamicLights: 4 },
  ultra: { name: 'ultra', maxPixelRatio: 2, ao: 1, bloom: 0.5, traa: true, anisotropy: 16, dynamicLights: 6 }
};

export function autoQuality(d: DeviceInfo, webgpu: boolean): QualityName {
  if (d.software) return 'low';
  if (d.platform === 'apple') {
    // iPadOS/iOS 27+: чипи M-серії та A17+ — ультра на планшеті, висока на телефоні
    if (d.form === 'tablet' || d.form === 'desktop') return webgpu ? 'ultra' : 'high';
    return 'high';
  }
  if (d.platform === 'android') return d.cores >= 8 ? 'medium' : 'low';
  return webgpu ? 'ultra' : 'high';
}

/**
 * Стежить за часом кадру. Якщо кадр стабільно довший за ціль — трохи зменшує роздільність рендера
 * (не нижче 70 % від профілю); коли запас з'являється — повертає назад. Різких стрибків немає.
 */
export class QualityGovernor {
  scale = 1;
  private acc = 0;
  private frames = 0;
  constructor(private readonly minScale = 0.7, private readonly targetMs = 1000 / 58) {}

  /** @returns true, якщо масштаб змінився й треба оновити розмір рендера */
  update(dtMs: number): boolean {
    this.acc += dtMs;
    this.frames++;
    if (this.acc < 2000) return false;
    const avg = this.acc / this.frames;
    this.acc = 0;
    this.frames = 0;
    const prev = this.scale;
    if (avg > this.targetMs * 1.15) this.scale = Math.max(this.minScale, this.scale - 0.08);
    else if (avg < this.targetMs * 0.8) this.scale = Math.min(1, this.scale + 0.05);
    return prev !== this.scale;
  }
}
