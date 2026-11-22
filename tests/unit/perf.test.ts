import { describe, expect, it } from 'vitest';
import type * as THREE from 'three/webgpu';
import { FrameProbe } from '../../src/render/perf';

const fakeRenderer = () => ({ info: { memory: { geometries: 0, textures: 0 } } }) as unknown as THREE.WebGPURenderer;

describe('FrameProbe — ривки', () => {
  it('рівні 60 FPS — жодного ривка, навіть на старті', () => {
    const p = new FrameProbe(fakeRenderer());
    for (let i = 0; i < 300; i++) p.record(16.7);
    const s = p.stats();
    expect(s.hitches).toBe(0);
    expect(s.p50).toBeCloseTo(16.7, 1);
  });
  it('поодинокий довгий кадр — ривок', () => {
    const p = new FrameProbe(fakeRenderer());
    for (let i = 0; i < 300; i++) p.record(i === 150 ? 120 : 16.7);
    const s = p.stats();
    expect(s.hitches).toBe(1);
    expect(s.worst[0]?.ms).toBe(120);
    expect(s.max).toBe(120);
  });
  it('повільний пристрій (рівні 45 мс) — це не ривки', () => {
    const p = new FrameProbe(fakeRenderer());
    for (let i = 0; i < 300; i++) p.record(45);
    expect(p.stats().hitches).toBe(0);
  });
  it('медіана не зсувається від ривків', () => {
    const p = new FrameProbe(fakeRenderer());
    for (let i = 0; i < 120; i++) p.record(i % 10 === 0 ? 200 : 16.7);
    expect(p.median()).toBeCloseTo(16.7, 1);
  });
});
