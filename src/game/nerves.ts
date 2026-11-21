// Нерви Оператора (0 — спокій, 1 — зрив). Замість здоров'я: ростуть у темряві, від небезпеки й самотності,
// повільно спадають під світлом. Від них залежить, наскільки гравець може довіряти очам: галюцинації,
// годинник, що бреше, тиша, кімнати, що змінюються за спиною, затемнення кадру.
export interface NerveInput {
  /** Освітленість від ламп у точці гравця (probeAt: ~0.2 — темрява, >1 — під лампою). */
  light: number;
  flashlight: boolean;
  /** Небезпека від мисливця 0..1. */
  danger: number;
  /** Гравець у схованці (шафка): страшно, але не так. */
  hidden: boolean;
}

export const NERVES = {
  /** Самотність: повільний ріст завжди (≈0.4 за 4 хвилини). */
  base: 0.0017,
  dark: 0.011,
  darkWithLight: 0.003,
  calm: 0.006,
  danger: 0.06,
  /** Нижня межа після смерті: тіло не забуває. */
  afterDeath: 0.4
};

export function stepNerves(n: number, dt: number, i: NerveInput): number {
  let d = NERVES.base;
  if (i.light < 0.45) d += i.flashlight ? NERVES.darkWithLight : NERVES.dark;
  else if (i.light > 0.9 && i.danger < 0.1) d -= NERVES.calm;
  d += NERVES.danger * i.danger;
  if (i.hidden) d *= 0.5;
  return Math.max(0, Math.min(1, n + d * dt));
}

/** Наскільки кадр «давить» (look.dread): нічого до 0.25, далі плавно до 1. */
export function dreadOf(n: number): number {
  const k = Math.max(0, Math.min(1, (n - 0.25) / 0.75));
  return k * k * (3 - 2 * k);
}

/** Чи збреше годинник цього разу (детерміновано від кидка 0..1). */
export function watchLies(n: number, roll: number): boolean {
  return n > 0.5 && roll < (n - 0.5) * 1.6 + 0.2;
}
