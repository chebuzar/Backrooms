import { describe, it, expect } from 'vitest';
import { Dosimeter, DOSIMETER } from '../../src/game/dosimeter';
import { rng } from '../../src/core/rng';

describe('dosimeter ДП-5', () => {
  it('crackles everywhere, falls silent near the Seam («Шов ест радиацию»)', () => {
    expect(Dosimeter.rateAt(40)).toBeGreaterThan(DOSIMETER.maxRate * 0.9);
    expect(Dosimeter.rateAt(2)).toBe(0);
    expect(Dosimeter.rateAt(DOSIMETER.silentR)).toBe(0);
  });
  it('the closer to the Seam, the quieter (monotonic) — usable to find it blind', () => {
    let prev = -1;
    for (let d = 0; d <= 40; d += 1) { const r = Dosimeter.rateAt(d); expect(r).toBeGreaterThanOrEqual(prev); prev = r; }
    expect(Dosimeter.rateAt(10)).toBeLessThan(Dosimeter.rateAt(20));
  });
  it('produces clicks only while switched on, at about the expected rate', () => {
    const d = new Dosimeter(rng(3));
    let clicks = 0;
    for (let i = 0; i < 600; i++) clicks += d.update(1 / 60, 40, false);
    expect(clicks).toBe(0);
    d.on = true;
    for (let i = 0; i < 600; i++) clicks += d.update(1 / 60, 40, false);
    expect(clicks).toBeGreaterThan(DOSIMETER.maxRate * 10 * 0.6);
    expect(clicks).toBeLessThan(DOSIMETER.maxRate * 10 * 1.5);
  });
});
