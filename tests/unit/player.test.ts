import { describe, it, expect, beforeAll } from 'vitest';
import { Physics } from '../../src/physics/physics';
import { Player, PLAYER, type MoveIntent } from '../../src/game/player';

let physics: Physics;
const idle: MoveIntent = { x: 0, y: 0, run: false, crouch: false };
const sim = (p: Player, sec: number, m: MoveIntent) => {
  for (let i = 0; i < sec * 60; i++) { p.update(1 / 60, m); physics.step(); }
};

beforeAll(async () => {
  physics = await Physics.create();
  physics.addBox(0, -0.5, 0, 20, 0.5, 20); // підлога, верх на y = 0
  physics.addBox(2, 1.5, 0, 0.1, 1.5, 5); // стіна, грань на x = 1.9
  physics.addBox(-5, 1.25 + 0.05, 0, 1, 0.05, 1); // низька стеля над (-5, 0) на висоті 1.25 м
  physics.step();
});

describe('player controller', () => {
  it('stands on the floor after falling', () => {
    const p = new Player(physics, 0, 2, -3);
    sim(p, 2, idle);
    expect(p.grounded).toBe(true);
    expect(Math.abs(p.pos.y)).toBeLessThan(0.05);
  });

  it('never passes through a wall, even running into it', () => {
    const p = new Player(physics, 0, 0, 0);
    p.yaw = 0; // рух x=1 → +X
    sim(p, 6, { x: 1, y: 0, run: true, crouch: false });
    expect(p.pos.x).toBeLessThanOrEqual(1.9 - PLAYER.radius + 0.03);
    expect(p.pos.x).toBeGreaterThan(1.4);
  });

  it('walks forward at about walking speed', () => {
    const p = new Player(physics, -10, 0, 8);
    p.yaw = 0; // вперед = −Z
    sim(p, 2, { x: 0, y: 1, run: false, crouch: false });
    const travelled = 8 - p.pos.z;
    expect(travelled).toBeGreaterThan(PLAYER.walk * 1.6);
    expect(travelled).toBeLessThan(PLAYER.walk * 2.05);
  });

  it('cannot stand up under a low ceiling', () => {
    const p = new Player(physics, -5, 0, 0);
    sim(p, 0.5, { ...idle, crouch: true });
    expect(p.crouched).toBe(true);
    sim(p, 0.5, idle);
    expect(p.crouched).toBe(true);
    p.teleport(-10, 0, 0);
    sim(p, 0.5, idle);
    expect(p.crouched).toBe(false);
  });

  it('stamina runs out while running and comes back', () => {
    const p = new Player(physics, -15, 0, 15);
    p.yaw = 0;
    sim(p, 7, { x: 0, y: 1, run: true, crouch: false });
    expect(p.exhausted).toBe(true);
    sim(p, 6, idle);
    expect(p.exhausted).toBe(false);
  });

  it('emits footsteps louder when running', () => {
    const p = new Player(physics, 10, 0, 15);
    const steps: number[] = [];
    p.onFootstep = (e) => steps.push(e.loudness);
    sim(p, 2, { x: 0, y: 1, run: false, crouch: false });
    sim(p, 1.5, { x: 0, y: 1, run: true, crouch: false });
    expect(steps.length).toBeGreaterThan(3);
    expect(Math.max(...steps)).toBe(1);
    expect(Math.min(...steps)).toBeCloseTo(0.45);
  });
});
