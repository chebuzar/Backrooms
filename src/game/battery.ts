// Батарея ліхтарика: розряджається лише коли світить (~12 хв світла; у дитсадку 7, у басейні 9); повна на «Начать заново» і на новому рівні;
// після смерті — щонайменше 40 % (щоб не лишитися в темряві без шансу); знайдена батарейка додає частку заряду.
export const BATTERY = {
  /** Секунд світла від повного заряду. */
  seconds: 720,
  /** Мінімум після смерті. */
  afterDeath: 0.4,
  /** Скільки додає підібрана батарейка. */
  pickup: 0.45,
  /** Глибші рівні: ліхтарик — головний захист, і батарейки «сідають» швидше (холод, вогкість). */
  perLevel: { 3: 420, 4: 540 } as Record<number, number>
};

export class Battery {
  /** Секунд світла від повного заряду на поточному рівні. */
  seconds = BATTERY.seconds;
  constructor(public level = 1) {}

  forLevel(id: number): void { this.seconds = BATTERY.perLevel[id] ?? BATTERY.seconds; }

  update(dt: number, on: boolean): void {
    if (on) this.level = Math.max(0, this.level - dt / this.seconds);
  }

  newGame(): void { this.level = 1; }
  enterLevel(): void { this.level = 1; }
  afterDeath(): void { this.level = Math.max(this.level, BATTERY.afterDeath); }
  pickup(): void { this.level = Math.min(1, this.level + BATTERY.pickup); }
}
