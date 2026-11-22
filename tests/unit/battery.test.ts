import { describe, it, expect } from 'vitest';
import { Battery, BATTERY } from '../../src/game/battery';
import { parseSave } from '../../src/core/save';

describe('flashlight battery', () => {
  it('drains only while the light is on (≈ 12 min of light)', () => {
    const b = new Battery(1);
    b.update(60, false);
    expect(b.level).toBe(1);
    b.update(360, true);
    expect(b.level).toBeCloseTo(0.5, 2);
  });

  it('drains faster on the deep levels (kindergarten, pool)', () => {
    const b = new Battery(1);
    b.forLevel(3);
    b.update(210, true);
    expect(b.level).toBeCloseTo(0.5, 2);
    b.forLevel(1);
    expect(b.seconds).toBe(BATTERY.seconds);
  });

  it('is full on «Начать заново» and when entering a new level', () => {
    const b = new Battery(0.1);
    b.newGame();
    expect(b.level).toBe(1);
    b.level = 0.2;
    b.enterLevel();
    expect(b.level).toBe(1);
  });

  it('after death the charge is at least 40 %, a higher charge is kept', () => {
    const b = new Battery(0.05);
    b.afterDeath();
    expect(b.level).toBeGreaterThanOrEqual(0.4);
    const c = new Battery(0.8);
    c.afterDeath();
    expect(c.level).toBe(0.8);
  });

  it('a picked battery adds a fixed share, never above full', () => {
    const b = new Battery(0.3);
    b.pickup();
    expect(b.level).toBeCloseTo(0.3 + BATTERY.pickup, 5);
    b.pickup(); b.pickup();
    expect(b.level).toBe(1);
  });

  it('the charge is kept in the save (old saves without it start full)', () => {
    expect(parseSave(JSON.stringify({ progress: {} })).progress.battery).toBe(1);
    expect(parseSave(JSON.stringify({ progress: { battery: 0.37 } })).progress.battery).toBe(0.37);
    expect(parseSave(JSON.stringify({ progress: { battery: 'x' } })).progress.battery).toBe(1);
    expect(parseSave(JSON.stringify({ progress: { battery: 7 } })).progress.battery).toBe(1);
  });
});
