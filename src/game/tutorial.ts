// Навчання керуванню на старті: підказки по одній («F — фонарик», «Shift — бег», «C — присесть», «E — действие»).
// Кожна тримається, доки гравець не спробує дію (але щонайменше 2.5 с, щоб встигнути прочитати) або 7 с.
export type TipId = 'light' | 'run' | 'crouch' | 'use';
export interface Tip { id: TipId; key?: string; icon?: string; text: string }

export class Tutorial {
  private i = 0;
  private t = 0;
  active = false;

  constructor(private readonly tips: Tip[], private readonly show: (t: Tip | null) => void) {}

  start(): void {
    this.active = this.tips.length > 0;
    this.i = 0; this.t = 0;
    this.show(this.tips[0] ?? null);
  }

  stop(): void { if (this.active) { this.active = false; this.show(null); } }

  /** done(id) — чи гравець уже зробив цю дію (з моменту появи підказки). */
  update(dt: number, done: (id: TipId) => boolean): void {
    if (!this.active) return;
    this.t += dt;
    const tip = this.tips[this.i] as Tip;
    if ((this.t > 2.5 && done(tip.id)) || this.t > 7) {
      this.i++; this.t = 0;
      if (this.i >= this.tips.length) this.stop(); else this.show(this.tips[this.i] as Tip);
    }
  }

  get current(): TipId | null { return this.active ? (this.tips[this.i] as Tip).id : null; }
}
