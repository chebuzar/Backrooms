// Плавність камери від першої особи: похитування без «кутів» (різких відскоків) і без підкидання на порогах.
import { describe, expect, it } from 'vitest';
import { CameraRig } from '../../src/game/camera-rig';
import { Hand } from '../../src/game/hand';
import * as THREE from 'three/webgpu';
import type { Player } from '../../src/game/player';

function fakeCam() {
  const pos = { x: 0, y: 0, z: 0, set(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; } };
  const rot = { x: 0, y: 0, z: 0, order: 'XYZ', set(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; } };
  return { position: pos, rotation: rot };
}

function walker(speed: number, running: boolean) {
  return {
    pos: { x: 0, y: 0, z: 0 }, prev: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0, vx: 0, vz: -speed, vy: -0.5,
    eye: 1.66, stamina: 1, bobPhase: 0, bobAmp: running ? 1.6 : 1, running
  };
}

/** Найбільше «прискорення» камери по вертикалі (друга різниця за кадр), м/с². */
function maxAccel(ys: number[], dt: number): number {
  let m = 0;
  for (let i = 2; i < ys.length; i++) m = Math.max(m, Math.abs((ys[i] as number) - 2 * (ys[i - 1] as number) + (ys[i - 2] as number)) / (dt * dt));
  return m;
}

describe('CameraRig', () => {
  it('хода й біг — плавна хвиля: без різкого відскоку на кожному кроці', () => {
    for (const [speed, running, stride] of [[1.85, false, 1.5], [4.3, true, 2.05]] as const) {
      const cam = fakeCam(), rig = new CameraRig(cam as unknown as THREE.PerspectiveCamera), p = walker(speed, running);
      const dt = 1 / 60, ys: number[] = [];
      for (let i = 0; i < 240; i++) {
        p.bobPhase += (speed * dt / stride) * Math.PI * 2;
        rig.update(p as unknown as Player, 1, dt);
        if (i > 30) ys.push(cam.position.y);
      }
      // плавна хвиля дає ~3 м/с² при ходьбі (як голова справжньої людини) і ~10 при бігу;
      // старий |sin| давав «удар» 40 і 110 м/с² на кожному кроці — це й було «смикання»
      expect(maxAccel(ys, dt)).toBeLessThan(running ? 12 : 4);
      const span = Math.max(...ys) - Math.min(...ys);
      expect(span).toBeGreaterThan(0.012); // похитування є — гравець відчуває кроки
      expect(span).toBeLessThan(running ? 0.06 : 0.04);
    }
  });

  it('поріг 25 см не підкидає камеру стрибком: висота доганяє плавно', () => {
    const cam = fakeCam(), rig = new CameraRig(cam as unknown as THREE.PerspectiveCamera), p = walker(0, false);
    p.bobAmp = 0;
    const dt = 1 / 60;
    for (let i = 0; i < 10; i++) rig.update(p as unknown as Player, 1, dt);
    const y0 = cam.position.y;
    p.pos.y = p.prev.y = 0.25;
    rig.update(p as unknown as Player, 1, dt);
    expect(cam.position.y - y0).toBeLessThan(0.08);
    for (let i = 0; i < 30; i++) rig.update(p as unknown as Player, 1, dt);
    expect(cam.position.y - y0).toBeGreaterThan(0.24);
  });
});

describe('Hand', () => {
  it('ліхтарик трохи відстає при різкому повороті й наздоганяє за частку секунди', () => {
    const h = new Hand(), q = new THREE.Quaternion(), pos = new THREE.Vector3(0, 1.6, 0);
    h.update({ camPos: pos, camQuat: q, phase: 0, amp: 0, shake: 0, dt: 1 / 60, t: 0 });
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), 1.2);
    h.update({ camPos: pos, camQuat: q, phase: 0, amp: 0, shake: 0, dt: 1 / 60, t: 0 });
    const want = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
    expect(h.dir.angleTo(want)).toBeGreaterThan(0.5); // одразу — ще позаду
    for (let i = 0; i < 20; i++) h.update({ camPos: pos, camQuat: q, phase: 0, amp: 0, shake: 0, dt: 1 / 60, t: i / 60 });
    expect(h.dir.angleTo(want)).toBeLessThan(0.03); // за 1/3 с — там, куди дивишся
  });
});
