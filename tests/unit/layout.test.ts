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
