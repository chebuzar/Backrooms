import { describe, it, expect, beforeAll } from 'vitest';
import { Brain, type Traits, type PlayerView } from '../../src/ai/brain';
import { Nav, type NavLike, type V3 } from '../../src/ai/nav';
import { generateLayout } from '../../src/world/layout';
import { rng } from '../../src/core/rng';

// навігація «по прямій» для тестів поведінки
const straight: NavLike = {
  path: (a, b) => [a, b],
  closest: (p) => p,
  randomAround: (p, r) => ({ x: p.x + r * 0.5, y: p.y, z: p.z }),
  pathLength: (a, b) => Math.hypot(a.x - b.x, a.z - b.z)
};
const base: Traits = { sightRange: 18, fovHalf: 1.1, hearing: 1, walkSpeed: 1.2, runSpeed: 4, searchTime: 12, alertness: 1.6 };
const player = (o: Partial<PlayerView> = {}): PlayerView => ({ x: 0, y: 0, z: 6, vx: 0, vz: 0, light: 0.8, flashlightOn: false, crouched: false, looksAtMe: false, litByFlashlight: false, ...o });
const eye = (b: Brain): V3 => ({ x: b.pos.x, y: 1.6, z: b.pos.z });
const run = (b: Brain, p: PlayerView, sec: number) => { let last = b.update(0, p, eye(b)); for (let i = 0; i < sec * 60; i++) last = b.update(1 / 60, p, eye(b)); return last; };

describe('monster brain', () => {
  it('during a search goes to a nearby hiding spot, stands there and checks it', () => {
    const b = new Brain(base, straight, { los: () => true }, { x: 0, y: 0, z: 0 }, rng(7));
    b.hideSpots = [{ x: 0.2, y: 0, z: 0.2, look: { x: 0.2, y: 1, z: 0.9 } }, { x: 40, y: 0, z: 40 }];
    b.mem.last = { x: 1, y: 0, z: 1 };
    (b as unknown as { set(s: string): void }).set('search');
    const checked: number[] = [];
    b.onCheck = (i) => checked.push(i);
    const hidden = player({ hidden: true });
    const first = b.update(1 / 60, hidden, eye(b));
    expect(first.target).toBeNull(); // уже на місці: стоїть і дивиться на дверцята
    expect(first.lookAt).toEqual({ x: 0.2, y: 1, z: 0.9 });
    run(b, hidden, 3);
    expect(checked).toEqual([0]); // далеку (за 12 м) не перевіряє
  });

  it('sees a lit player in front and starts a chase', () => {
    let wall = false;
    const b = new Brain(base, straight, { los: () => !wall }, { x: 0, y: 0, z: 0 }, rng(1));
    run(b, player(), 2);
    expect(b.state).toBe('chase');
    // гравець сховався за стіною: пошук, потім здається й повертається до патрулю
    wall = true;
    run(b, player({ z: 3 }), 8);
    expect(['search', 'lost', 'patrol']).toContain(b.state);
    run(b, player({ x: 60, z: 60 }), 25);
    expect(b.state).toBe('patrol');
  });

  it('does not notice a crouched player in the dark at distance', () => {
    const b = new Brain(base, straight, { los: () => true }, { x: 0, y: 0, z: 0 }, rng(2));
    run(b, player({ z: 9, light: 0.05, crouched: true }), 3);
    expect(b.state).toBe('patrol');
  });

  it('cannot see behind its back', () => {
    const b = new Brain(base, straight, { los: () => true }, { x: 0, y: 0, z: 0 }, rng(3));
    run(b, player({ z: -8 }), 3);
    expect(b.seesPlayer).toBe(false);
  });

  it('hears loud footsteps, stops to listen, then goes to check', () => {
    const b = new Brain(base, straight, { los: () => false }, { x: 0, y: 0, z: 0 }, rng(4));
    for (let k = 0; k < 4; k++) b.hear({ x: 8, y: 0, z: 0, loudness: 1, t: k });
    const first = b.update(1 / 60, player({ x: 8, z: 0 }), eye(b));
    expect(b.state).toBe('suspicious');
    expect(first.target).toBeNull();
    const later = run(b, player({ x: 8, z: 0 }), 2);
    expect(b.state).toBe('investigate');
    expect(later.target?.x).toBeGreaterThan(5);
  });

  it('ignores quiet footsteps far away', () => {
    const b = new Brain(base, straight, { los: () => false }, { x: 0, y: 0, z: 0 }, rng(5));
    b.hear({ x: 15, y: 0, z: 0, loudness: 0.15, t: 0 });
    run(b, player({ x: 15 }), 1);
    expect(b.state).toBe('patrol');
  });

  it('a monster that moves only when unseen freezes while watched', () => {
    const b = new Brain({ ...base, movesWhenUnseen: true }, straight, { los: () => true }, { x: 0, y: 0, z: 0 }, rng(6));
    const i = run(b, player({ looksAtMe: true }), 1);
    expect(i.target).toBeNull();
    expect(i.speed).toBe(0);
  });

  it('a light-fearing monster backs away from the flashlight beam', () => {
    const b = new Brain({ ...base, fearsLight: true }, straight, { los: () => true }, { x: 0, y: 0, z: 0 }, rng(7));
    const i = run(b, player({ litByFlashlight: true, flashlightOn: true }), 0.5);
    expect(i.target && i.target.z).toBeLessThan(0);
  });
});

describe('navmesh on the real level 0 layout', () => {
  let nav: Nav;
  const l = generateLayout({ seed: 1987 });
  beforeAll(async () => { nav = await Nav.fromLayout(l); }, 60000);

  it('finds a path from spawn to the exit', () => {
    const p = nav.path({ x: l.spawn.x, y: 0, z: l.spawn.z }, { x: l.exit.x, y: 0, z: l.exit.z });
    expect(p.length).toBeGreaterThan(2);
    const end = p[p.length - 1] as V3;
    expect(Math.hypot(end.x - l.exit.x, end.z - l.exit.z)).toBeLessThan(0.6);
  });

  it('path never goes through walls', () => {
    const p = nav.path({ x: l.spawn.x, y: 0, z: l.spawn.z }, { x: l.exit.x, y: 0, z: l.exit.z });
    for (let i = 1; i < p.length; i++) {
      const a = p[i - 1] as V3, b = p[i] as V3;
      for (let s = 0; s <= 10; s++) {
        const x = a.x + (b.x - a.x) * s / 10, z = a.z + (b.z - a.z) * s / 10;
        const hit = l.walls.find((w) => Math.abs(x - w.x) < w.w / 2 && Math.abs(z - w.z) < w.d / 2);
        expect(hit).toBeUndefined();
      }
    }
  });
});

describe('hiding (lockers on level 1)', () => {
  it('a hidden player is invisible even right in front of a monster in full light', () => {
    const b = new Brain(base, straight, { los: () => true }, { x: 0, y: 0, z: 0 }, rng(9));
    run(b, player({ z: 3, light: 1, flashlightOn: true, hidden: true }), 3);
    expect(b.seesPlayer).toBe(false);
    expect(b.state).toBe('patrol');
  });
});
