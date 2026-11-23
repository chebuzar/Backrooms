// Рука: узята річ тягнеться до точки перед очима, не проходить крізь стіну; кинута — летить уздовж погляду.
import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three/webgpu';
import { Physics } from '../../src/physics/physics';
import { Knockables, type PropItem } from '../../src/physics/knock';
import { Carry, type Eye } from '../../src/physics/carry';

let physics: Physics, carry: Carry;
const box = new THREE.Group();
box.add(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3).translate(0, 0.15, 0)));

beforeAll(async () => {
  physics = await Physics.create();
  physics.knock = new Knockables(physics);
  physics.addBox(0, -0.5, 0, 30, 0.5, 30); // підлога
  physics.addBox(0, 1.5, -3, 30, 1.5, 0.1); // стіна за 3 м попереду
  physics.step();
  carry = new Carry(physics, physics.knock);
});

const eye: Eye = { x: 0, y: 1.6, z: 0, dx: 0, dy: 0, dz: -1, yaw: 0 };
const run = (sec: number, e = eye) => { for (let i = 0; i < sec * 60; i++) { carry.step(1 / 60, e); physics.step(); physics.knock!.sync(1 / 60); } };

describe('carry', () => {
  let it0: PropItem;
  it('узята річ — перед очима, гравітація не тягне вниз', () => {
    it0 = physics.knock!.add('box', () => {}, new THREE.Matrix4().makeTranslation(0, 0, -1), box) as PropItem;
    expect(it0.grab).toBe(true);
    carry.grab(it0, eye);
    run(1.2);
    const c = it0.body.worldCom();
    expect(Math.hypot(c.x, c.y - 1.48, c.z + 0.84)).toBeLessThan(0.15);
  });

  it('несеш до стіни — річ упирається, а не проходить крізь неї', () => {
    const near: Eye = { ...eye, z: -2.2 };
    run(1, near);
    expect(it0.body.worldCom().z).toBeGreaterThan(-2.92);
  });

  it('кинута — летить уздовж погляду й падає', () => {
    carry.release(eye, false);
    run(1);
    it0.body.setTranslation({ x: 0, y: 1.4, z: -1 }, true);
    carry.grab(it0, eye);
    run(0.6);
    const back: Eye = { ...eye, dz: 1 };
    carry.release(back, true);
    expect(it0.thrown).toBeGreaterThan(0);
    run(2);
    const t = it0.body.translation();
    expect(t.z).toBeGreaterThan(1.5);
    expect(t.y).toBeLessThan(0.3);
    expect(carry.held).toBeNull();
  });
});
