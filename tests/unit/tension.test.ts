import { describe, it, expect } from 'vitest';
import { TensionDirector, TENSION } from '../../src/game/tension';
import { rng } from '../../src/core/rng';

const run = (t: TensionDirector, seconds: number, danger: number) => {
  const ev: string[] = [];
  for (let i = 0; i < seconds * 10; i++) { const e = t.update(0.1, danger); if (e) ev.push(e); }
  return ev;
};

describe('tension before the monster', () => {
  it('stays quiet when nothing hunts the player', () => {
    expect(run(new TensionDirector(rng(1)), 300, 0)).toEqual([]);
  });
  it('stays quiet during a chase (no time for omens then)', () => {
    expect(run(new TensionDirector(rng(2)), 120, 1)).toEqual([]);
  });
  it('when the monster draws near: omens come, but rarely (cooldown) and not the same twice in a row', () => {
    const ev = run(new TensionDirector(rng(3)), 300, 0.55);
    expect(ev.length).toBeGreaterThanOrEqual(3);
    expect(ev.length).toBeLessThanOrEqual(300 / TENSION.cooldown + 1);
    for (let i = 1; i < ev.length; i++) expect(ev[i]).not.toBe(ev[i - 1]);
    expect(new Set(ev).size).toBe(3); // кроки, двері, лампа — усі трапляються
  });
});
