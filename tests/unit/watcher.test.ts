import { describe, it, expect } from 'vitest';
import { Brain, type PlayerView } from '../../src/ai/brain';
import type { NavLike, V3 } from '../../src/ai/nav';
import { TRAITS, watcherSpeed, WATCHER_LUNGE } from '../../src/ai/traits';
import { rng } from '../../src/core/rng';

// «Наблюдатель» на рівній підлозі: навігація по прямій, рух — як у Stalker (за наміром мозку), хапає за 1.05 м,
// лише коли гравець на нього не дивиться.
const straight: NavLike = {
  path: (a, b) => [a, b], closest: (p) => p,
  randomAround: (p, r) => ({ x: p.x + r * 0.5, y: p.y, z: p.z }), pathLength: (a, b) => Math.hypot(a.x - b.x, a.z - b.z)
};
const view = (o: Partial<PlayerView> = {}): PlayerView => ({ x: 0, y: 0, z: 10, vx: 0, vz: 0, light: 0.7, flashlightOn: true, crouched: false, looksAtMe: false, litByFlashlight: false, ...o });

function sim(seen: (t: number) => boolean, opts: { los?: boolean; seconds?: number; walkAway?: number } = {}) {
  const pos: V3 = { x: 0, y: 0, z: 0 };
  const st = { unseen: 0, lunge: WATCHER_LUNGE.dist };
  let pz = 10;
  const b = new Brain(TRAITS.watcher, straight, { los: () => opts.los ?? true }, pos, rng(7));
  b.headX = 0; b.headZ = 1; // дивиться на гравця
  const dt = 1 / 60;
  let maxSpeed = 0, moved = 0;
  for (let i = 0; i < (opts.seconds ?? 90) * 60; i++) {
    const t = i * dt, look = seen(t);
    pz += (opts.walkAway ?? 0) * dt;
    const p = view({ z: pz, looksAtMe: look, litByFlashlight: look });
    const it = b.update(dt, p, { x: pos.x, y: 2, z: pos.z });
    const mv = !!it.target && it.speed > 0;
    const v = watcherSpeed(st, look, dt, it.speed, mv);
    if (mv) it.speed = v;
    if (it.target && it.speed > 0) {
      const dx = it.target.x - pos.x, dz = it.target.z - pos.z, d = Math.hypot(dx, dz);
      const step = Math.min(d, it.speed * dt);
      if (d > 1e-6) { pos.x += (dx / d) * step; pos.z += (dz / d) * step; moved += step; }
      maxSpeed = Math.max(maxSpeed, it.speed);
    }
    if (!look && Math.hypot(p.x - pos.x, p.z - pos.z) < 1.05) return { caughtAt: t, pos, maxSpeed, moved };
  }
  return { caughtAt: null as number | null, pos, maxSpeed, moved };
}

describe('the Watcher (level 1)', () => {
  it('stands still until it has noticed the player', () => {
    // гравець за стіною (не видно), не дивиться — «статуя» не блукає
    const r = sim(() => false, { los: false, seconds: 20 });
    expect(r.moved).toBeLessThan(0.05);
  });

  it('lunges when the player looks away, then follows faster than a walk', () => {
    const r = sim(() => false, { seconds: 4 });
    expect(r.maxSpeed).toBeGreaterThanOrEqual(6); // ривок
    expect(TRAITS.watcher.runSpeed).toBeGreaterThan(1.85); // швидше за крок гравця
    expect(TRAITS.watcher.runSpeed).toBeLessThan(4.3); // повільніше за біг — утекти бігом можна (поки є сили)
  });

  it('catches a player who just walks away without looking back', () => {
    const r = sim((t) => t < 2, { seconds: 60, walkAway: 1.85 });
    expect(r.caughtAt).not.toBeNull();
  });

  it('never catches a player who keeps it in the light', () => {
    const r = sim(() => true, { seconds: 60, walkAway: -0.5 });
    expect(r.caughtAt).toBeNull();
    expect(r.moved).toBeLessThan(0.05);
  });

  it('from 10 m it catches no earlier than the 3rd time the player looks away', () => {
    // дивиться 2 с, відвертається на 1.5 с — і так по колу
    const cycle = 3.5, away = (t: number) => t % cycle >= 2;
    const r = sim((t) => !away(t), { seconds: 120 });
    expect(r.caughtAt).not.toBeNull();
    const turn = Math.floor((r.caughtAt as number) / cycle) + 1; // котрий раз відвернувся
    expect(turn).toBeGreaterThanOrEqual(3);
    expect(turn).toBeLessThanOrEqual(4); // і не пізніше 4-го: «важко, але можливо»
  });
});
