// «Режисер» напруги: коли мисливець наближається (небезпека середня — він ще не женеться), зрідка трапляється
// прикмета: кроки за спиною, двері самі зачиняються, лампа лускає з іскрами. Не частіше раза на ~25 с і не двічі
// однакова поспіль — щоб лякало, а не набридало. Під час погоні — нічого (тоді не до прикмет).
export type Omen = 'steps' | 'door' | 'lamp';

export const TENSION = {
  cooldown: 25,
  /** Небезпека, в межах якої бувають прикмети. */
  min: 0.2,
  max: 0.85,
  /** Ймовірність за секунду при небезпеці 1 (масштабується). */
  rate: 0.12
};

const ALL: Omen[] = ['steps', 'door', 'lamp'];

export class TensionDirector {
  private cd = 8; // перші секунди рівня — спокій
  private last: Omen | null = null;
  constructor(private readonly rnd: () => number = Math.random) {}

  /** danger 0..1 (згладжена небезпека від мисливця). Повертає прикмету, яку треба показати зараз, або null. */
  update(dt: number, danger: number): Omen | null {
    this.cd = Math.max(0, this.cd - dt);
    if (this.cd > 0 || danger < TENSION.min || danger > TENSION.max) return null;
    if (this.rnd() > TENSION.rate * danger * dt) return null;
    const pool = ALL.filter((o) => o !== this.last);
    const o = pool[Math.floor(this.rnd() * pool.length)] as Omen;
    this.last = o;
    this.cd = TENSION.cooldown * (0.8 + this.rnd() * 0.5);
    return o;
  }
}
