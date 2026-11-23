// Фізика речей: стілець спить, поки не зачепиш; на бігу — відлітає й падає зі звуком (його чує монстр); стіни тримають.
import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three/webgpu';
import { Physics } from '../../src/physics/physics';
import { Knockables } from '../../src/physics/knock';
import { Player, type MoveIntent } from '../../src/game/player';

let physics: Physics;
const chairBox = new THREE.Box3(new THREE.Vector3(-0.22, 0, -0.22), new THREE.Vector3(0.22, 0.9, 0.22));

beforeAll(async () => {
  physics = await Physics.create();
  physics.knock = new Knockables(physics);
  physics.addBox(0, -0.5, 0, 30, 0.5, 30); // підлога
  physics.addBox(0, 1.5, -12, 30, 1.5, 0.1); // стіна
  physics.step();
});

function chair(x: number, z: number) {
  const m = new THREE.Matrix4().makeTranslation(x, 0, z), got = new THREE.Matrix4().copy(m);
  physics.knock!.add((w) => got.copy(w), m, chairBox, 6, 'wood');
  return got;
}
const sim = (p: Player, sec: number, mv: MoveIntent, k = physics.knock!) => {
  for (let i = 0; i < sec * 60; i++) { p.update(1 / 60, mv); physics.step(); k.sync(1 / 60); }
};

describe('knockable props', () => {
  it('спить, поки ніхто не чіпає: жодних ударів і руху на старті', () => {
    const k = physics.knock!;
    const hits: number[] = [];
    k.onImpact = (_x, _y, _z, s) => hits.push(s);
    const m = chair(8, 8);
    const p = new Player(physics, 8, 0, 14);
    sim(p, 1, { x: 0, y: 0, run: false, crouch: false });
    expect(hits).toHaveLength(0);
    expect(new THREE.Vector3().setFromMatrixPosition(m).distanceTo(new THREE.Vector3(8, 0, 8))).toBeLessThan(0.02);
  });

  it('на бігу стілець відлітає, перекидається й гримить — і гравець не застрягає', () => {
    const k = physics.knock!;
    const hits: { s: number; topple: boolean }[] = [];
    k.onImpact = (_x, _y, _z, s, _kind, topple) => hits.push({ s, topple });
    const m = chair(0, -4);
    const p = new Player(physics, 0, 0, 0);
    p.yaw = 0; // вперед = −Z
    sim(p, 2.2, { x: 0, y: 1, run: true, crouch: false });
    const pos = new THREE.Vector3().setFromMatrixPosition(m);
    expect(pos.z).toBeLessThan(-4.5); // відштовхнуло вперед
    expect(p.pos.z).toBeLessThan(-4); // гравець пробіг далі, а не вперся
    expect(hits.length).toBeGreaterThan(0);
    expect(Math.max(...hits.map((h) => h.s))).toBeGreaterThan(0.3);
  });

  it('стіна тримає: стілець не пролітає крізь неї', () => {
    const m = chair(3, -10.5);
    const p = new Player(physics, 3, 0, -6);
    p.yaw = 0;
    sim(p, 3, { x: 0, y: 1, run: true, crouch: false });
    expect(new THREE.Vector3().setFromMatrixPosition(m).z).toBeGreaterThan(-11.9);
  });

  it('clear() прибирає тіла', () => {
    const before = physics.world.bodies.len();
    physics.knock!.clear();
    expect(physics.world.bodies.len()).toBeLessThan(before);
    expect(physics.knock!.count).toBe(0);
  });
});
