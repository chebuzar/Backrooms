import { describe, it, expect } from 'vitest';
import * as THREE from 'three/webgpu';
import { goreRef, goreAttributes } from '../../src/world/monsters/gore';

// Спрощене «тіло» в T-позі (метри, s = 1): маківка, рот спереду, потилиця, груди, кінчики рук.
function body(): THREE.Mesh {
  const D = 0.22;
  const pts = [
    [0, 1.8, 0.1], // маківка
    [0, 1.8 - D * 0.84, 0.21], // рот (перед обличчя)
    [0, 1.8 - D * 0.84, -0.01], // потилиця на тій самій висоті
    [0, 1.8 - D * 1.3, 0.15], // шия/груди спереду
    [0.85, 1.4, 0.05], [-0.85, 1.4, 0.05], // кінчики рук
    [0.2, 1.4, 0.05], // плече
    [0, 0, 0.1] // ноги
  ];
  const nz = [0.2, 1, -1, 1, 0, 0, 0, 0.3];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts.flat()), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nz.flatMap((z) => [0, Math.sqrt(1 - z * z), z])), 3));
  return new THREE.Mesh(g);
}

describe('gore', () => {
  it('кров на роті, на грудях смугами й на руках, але не на потилиці, плечах і ногах', () => {
    const m = body(), ref = goreRef(m);
    expect(ref.headD).toBeCloseTo(0.22, 2);
    goreAttributes(m.geometry, ref, 'watcher');
    const K = m.geometry.getAttribute('goreK');
    const at = (i: number) => [K.getX(i), K.getY(i), K.getZ(i), K.getW(i)];
    expect(at(1)[0]).toBeGreaterThan(0.5); // рот
    expect(Math.max(...at(2))).toBe(0); // потилиця
    expect(at(3)[1]).toBeGreaterThan(0.5); // смуги на шиї спереду
    expect(at(4)[2]).toBeGreaterThan(0.9); expect(at(5)[3]).toBeGreaterThan(0.9); // кисті
    expect(Math.max(...at(6))).toBe(0); // плече
    expect(Math.max(...at(7))).toBe(0); // ноги
    for (let i = 0; i < K.count * 4; i++) expect(Number.isFinite((K.array as Float32Array)[i])).toBe(true);
  });
});
