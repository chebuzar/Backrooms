import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three';
import { blindClickRate } from '../../src/ai/traits';
import { Doors } from '../../src/world/doors';
import { Physics } from '../../src/physics/physics';
import { generateLayout } from '../../src/world/layout';
import { decorate } from '../../src/world/decor';

describe('the Blind (level 2)', () => {
  it('tongue clicks get faster the closer it is, and faster still while hunting', () => {
    expect(blindClickRate(30, false)).toBeCloseTo(1, 2);
    expect(blindClickRate(2, false)).toBeGreaterThan(1.6);
    expect(blindClickRate(6, true)).toBeGreaterThan(blindClickRate(6, false));
    let prev = Infinity;
    for (let d = 0; d <= 30; d += 2) { const r = blindClickRate(d, false); expect(r).toBeLessThanOrEqual(prev); prev = r; }
  });

  let physics: Physics;
  beforeAll(async () => { physics = await Physics.create(); });
  it('a closed door is bashed open: fast, with a bash event (not a slow creak)', () => {
    const lv0 = generateLayout({ seed: 1987 });
    const doors = new Doors(lv0, decorate(lv0), physics, { door_c: new THREE.Texture(), door_n: new THREE.Texture() });
    const d = doors.list.find((x) => x.target === 0)!;
    expect(d).toBeDefined();
    let bashed = 0;
    doors.onBash = () => bashed++;
    doors.bash(d);
    for (let i = 0; i < 12; i++) doors.update(1 / 60); // 0.2 с
    expect(bashed).toBe(1);
    expect(d.angle).toBeGreaterThan(1.0);
  });
});
