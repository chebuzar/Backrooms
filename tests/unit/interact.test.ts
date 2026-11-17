import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { Interactions, type Interactable } from '../../src/game/interact';
import type { Physics } from '../../src/physics/physics';

// без стін між гравцем і предметом
const clear = { lineOfSight: () => true } as unknown as Physics;
const cam = (x: number, y: number, z: number) => { const c = new THREE.PerspectiveCamera(); c.position.set(x, y, z); return c; };
const item = (o: Partial<Interactable> = {}): Interactable => ({ id: 'a', x: 0, y: 1, z: -1.2, reach: 1.9, prompt: 'p', enabled: true, use: () => {}, ...o });
/** Погляд: yaw (вліво +) і pitch (вгору +) від «вперед» = −Z. */
const look = (yaw: number, pitch: number): [number, number, number] =>
  [-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)];

describe('interactions: what the player is looking at', () => {
  it('catches an item about 20° off the centre of view', () => {
    const it = new Interactions(clear);
    it.add(item({ y: 1.66 }));
    expect(it.update(cam(0, 1.66, 0), ...look(0.35, 0))?.id).toBe('a');
  });

  it('ignores an item 40° away', () => {
    const it = new Interactions(clear);
    it.add(item({ y: 1.66 }));
    expect(it.update(cam(0, 1.66, 0), ...look(0.7, 0))).toBeNull();
  });

  it('a document on a low box is readable from 1.4 m away (reach counts along the floor)', () => {
    const it = new Interactions(clear);
    it.add(item({ x: 0, y: 0.36, z: -1.4 }));
    const c = cam(0, 1.66, 0);
    const pitch = Math.atan2(0.36 - 1.66, 1.4);
    expect(it.update(c, ...look(0, pitch))?.id).toBe('a');
  });

  it('a door is caught when looking straight at the leaf at eye level (not only at the handle)', () => {
    const it = new Interactions(clear);
    // полотно 2 м заввишки: центр на 1.02, половина висоти 0.9
    it.add(item({ x: 0, y: 1.02, z: -0.8, halfHeight: 0.9, reach: 1.7 }));
    expect(it.update(cam(0, 1.66, 0), ...look(0, 0))?.id).toBe('a');
  });

  it('still respects reach', () => {
    const it = new Interactions(clear);
    it.add(item({ y: 1.66, z: -2.6 }));
    expect(it.update(cam(0, 1.66, 0), ...look(0, 0))).toBeNull();
  });

  it('prefers the item closest to the centre of view', () => {
    const it = new Interactions(clear);
    it.add(item({ id: 'left', x: -0.3, y: 1.66, z: -1.2 }));
    it.add(item({ id: 'mid', x: 0.02, y: 1.66, z: -1.2 }));
    expect(it.update(cam(0, 1.66, 0), ...look(0, 0))?.id).toBe('mid');
  });
});
