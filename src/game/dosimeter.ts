// Дозиметр ДП-5 (R / кнопка): у Закулиссі він тріщить скрізь, а біля Шва замовкає — «Шов ест радиацию» (сюжет).
// Тому ним можна шукати Шов наосліп: що тихіше, то ближче. Клацання — випадковий (пуассонівський) потік.
export const DOSIMETER = {
  /** Клацань за секунду далеко від Шва. */
  maxRate: 9,
  /** Ближче цього (м) — повна тиша. */
  silentR: 3.5,
  /** Звідки (м) починає стихати. */
  fadeR: 30
};

export class Dosimeter {
  on = false;
  /** Показ стрілки 0..1 (згладжений). */
  needle = 0;
  rate = 0;
  constructor(private readonly rnd: () => number = Math.random) {}

  /** Швидкість клацань на відстані d від найближчого Шва. */
  static rateAt(d: number): number {
    const k = Math.min(1, Math.max(0, (d - DOSIMETER.silentR) / (DOSIMETER.fadeR - DOSIMETER.silentR)));
    return DOSIMETER.maxRate * Math.pow(k, 0.8);
  }

  /** Крок: повертає кількість клацань за цей кадр. paused — гра на паузі (тиша). */
  update(dt: number, seamDist: number, paused: boolean): number {
    this.rate = this.on && !paused ? Dosimeter.rateAt(seamDist) : 0;
    this.needle += ((this.on ? this.rate / DOSIMETER.maxRate : 0) - this.needle) * Math.min(1, dt * 3);
    if (!this.rate) return 0;
    // пуассон: ймовірність клацання за малий крок ≈ rate·dt (крок ділимо, щоб не втрачати подвійні)
    let n = 0;
    const sub = Math.max(1, Math.ceil(this.rate * dt * 4));
    for (let i = 0; i < sub; i++) if (this.rnd() < (this.rate * dt) / sub) n++;
    return n;
  }
}
