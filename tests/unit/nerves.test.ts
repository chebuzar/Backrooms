import { describe, it, expect } from 'vitest';
import { stepNerves, dreadOf, watchLies } from '../../src/game/nerves';

const run = (n: number, sec: number, i: Parameters<typeof stepNerves>[2]) => { for (let t = 0; t < sec; t += 0.1) n = stepNerves(n, 0.1, i); return n; };

describe('nerves', () => {
  it('ростуть у темряві без ліхтарика швидше, ніж із ним', () => {
    const dark = run(0, 30, { light: 0.2, flashlight: false, danger: 0, hidden: false });
    const lit = run(0, 30, { light: 0.2, flashlight: true, danger: 0, hidden: false });
    expect(dark).toBeGreaterThan(lit);
    expect(dark).toBeGreaterThan(0.3);
  });
  it('спадають під яскравим світлом без небезпеки', () => {
    expect(run(0.6, 60, { light: 1.4, flashlight: false, danger: 0, hidden: false })).toBeLessThan(0.45);
  });
  it('небезпека швидко доводить до межі, але не вище 1', () => {
    expect(run(0.2, 30, { light: 1, flashlight: true, danger: 1, hidden: false })).toBe(1);
  });
  it('dread 0 при спокої і 1 при зриві', () => {
    expect(dreadOf(0.1)).toBe(0);
    expect(dreadOf(1)).toBeCloseTo(1);
  });
  it('годинник не бреше спокійним', () => {
    expect(watchLies(0.3, 0)).toBe(false);
    expect(watchLies(0.9, 0.5)).toBe(true);
  });
});
