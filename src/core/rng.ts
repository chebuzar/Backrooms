// Детермінований генератор випадкових чисел (mulberry32): однакове зерно — однаковий світ на всіх пристроях.
export type Rng = () => number;

export function rng(seed: number): Rng {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const pick = <T>(r: Rng, a: readonly T[]): T => a[Math.floor(r() * a.length)] as T;
export const range = (r: Rng, lo: number, hi: number) => lo + (hi - lo) * r();
export const irange = (r: Rng, lo: number, hi: number) => Math.floor(lo + (hi - lo + 1) * r());
