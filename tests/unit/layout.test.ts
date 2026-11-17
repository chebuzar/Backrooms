import { describe, it, expect } from 'vitest';
import { generateLayout } from '../../src/world/layout';

describe('level layout', () => {
  const seeds = [1, 7, 42, 1987, 0x4b];
  it.each(seeds)('every cell is reachable from spawn (seed %i)', (seed) => {
    const l = generateLayout({ seed });
    const unreachable = Array.from(l.dist).filter((d) => d < 0).length;
    expect(unreachable).toBe(0);
  });

  it('is deterministic for the same seed', () => {
    const a = generateLayout({ seed: 1987 }), b = generateLayout({ seed: 1987 });
    expect(a.walls).toEqual(b.walls);
    expect(a.lights).toEqual(b.lights);
    expect(a.exit).toEqual(b.exit);
  });

  it.each(seeds)('exit is far from spawn and spawn is not inside a wall (seed %i)', (seed) => {
    const l = generateLayout({ seed });
    expect(Math.hypot(l.exit.x - l.spawn.x, l.exit.z - l.spawn.z)).toBeGreaterThan(25);
    for (const w of l.walls) {
      const inside = Math.abs(l.spawn.x - w.x) < w.w / 2 + 0.3 && Math.abs(l.spawn.z - w.z) < w.d / 2 + 0.3;
      expect(inside).toBe(false);
    }
  });

  it('has a sensible amount of lights and walls', () => {
    const l = generateLayout({ seed: 1987 });
    expect(l.lights.length).toBe(900);
    expect(l.lights.filter((x) => x.state === 'on').length).toBeGreaterThan(400);
    expect(l.walls.length).toBeGreaterThan(80);
  });
});

describe('level presets (base, parking)', () => {
  const cases = [['base', 1961], ['base', 7], ['parking', 4], ['parking', 99]] as const;
  it.each(cases)('%s %i: every cell reachable, exit far, rift set, no lamp inside a wall', (preset, seed) => {
    const l = generateLayout({ seed, preset });
    expect(Array.from(l.dist).filter((d) => d < 0).length).toBe(0);
    expect(Math.hypot(l.exit.x - l.spawn.x, l.exit.z - l.spawn.z)).toBeGreaterThan(30);
    expect(l.points.rift).toBeDefined();
    for (const p of l.lights) for (const w of l.walls) {
      const hit = Math.abs(p.x - w.x) < w.w / 2 + p.w / 2 && Math.abs(p.z - w.z) < w.d / 2 + p.d / 2;
      expect(hit).toBe(false);
    }
  });
  it('themes differ in height and lamps', () => {
    const b = generateLayout({ seed: 1, preset: 'base' }), p = generateLayout({ seed: 1, preset: 'parking' });
    expect(b.height).toBeGreaterThan(2.7);
    expect(p.theme.lamp.color[2]).toBeLessThan(0.5);
  });
});
