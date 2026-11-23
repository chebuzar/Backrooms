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

describe('deep levels (kindergarten, pool)', () => {
  it.each([['kinder', 3], ['kinder', 31], ['pool', 4], ['pool', 44]] as const)('%s %i: reachable, rooms typed, no lamp in a wall', (preset, seed) => {
    const l = generateLayout({ seed, preset });
    // клітинки чаш непрохідні; усі інші досяжні
    const unreachable = Array.from(l.dist).filter((d) => d < 0).length;
    const basinCells = l.pools.reduce((n, q) => n + Math.round((q.w / l.cell) * (q.d / l.cell)), 0);
    expect(unreachable).toBeLessThanOrEqual(basinCells);
    expect(Math.hypot(l.exit.x - l.spawn.x, l.exit.z - l.spawn.z)).toBeGreaterThan(25);
    for (const p of l.lights) for (const w of l.walls) {
      const hit = Math.abs(p.x - w.x) < w.w / 2 + p.w / 2 && Math.abs(p.z - w.z) < w.d / 2 + p.d / 2;
      expect(hit).toBe(false);
    }
    if (preset === 'kinder') {
      for (const k of ['cloak', 'play', 'sleep', 'hall'] as const) expect(l.rooms.some((r) => r.kind === k)).toBe(true);
      expect(l.pools.length).toBe(0);
    } else {
      expect(l.pools.length).toBeGreaterThanOrEqual(2);
      expect(l.puddles.length).toBeGreaterThanOrEqual(3);
      // старт і вихід — не в чаші
      for (const p of [l.spawn, l.exit]) expect(l.pools.some((q) => Math.abs(p.x - q.x) < q.w / 2 && Math.abs(p.z - q.z) < q.d / 2)).toBe(false);
    }
  });
});

describe('level 0 «Бесконечный НИИ» (designed floor)', () => {
  const l = generateLayout({ seed: 1987, preset: 'nii' });
  it('every cell is reachable and the exit is the stairwell', () => {
    expect(Array.from(l.dist).filter((d) => d < 0).length).toBe(0);
    const stairs = l.rooms.find((q) => q.kind === 'stairs');
    expect(stairs).toBeDefined();
    expect(l.exit.cx).toBeGreaterThanOrEqual(stairs!.x0);
    expect(l.exit.cx).toBeLessThan(stairs!.x1);
    expect(Math.hypot(l.exit.x - l.spawn.x, l.exit.z - l.spawn.z)).toBeGreaterThan(25);
  });
  it('has rooms of every purpose and lamps only where they belong', () => {
    for (const k of ['office', 'director', 'lab', 'drafting', 'archive', 'assembly', 'lobby', 'wc', 'stairs', 'dark'] as const) {
      expect(l.rooms.some((q) => q.kind === k)).toBe(true);
    }
    // острови світла й темні проміжки: світить більшість, але не всі
    const on = l.lights.filter((x) => x.state === 'on').length;
    expect(on / l.lights.length).toBeGreaterThan(0.5);
    expect(on / l.lights.length).toBeLessThan(0.85);
    for (const p of l.lights) {
      const inWall = l.walls.some((w) => Math.abs(p.x - w.x) < w.w / 2 + 0.05 && Math.abs(p.z - w.z) < w.d / 2 + 0.05);
      expect(inWall).toBe(false);
    }
  });
});
