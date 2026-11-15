// Пыль в воздухе: несколько сотен светлых пылинок медленно дрейфуют вокруг камеры.
// Позиции «заворачиваются» в куб вокруг игрока, поэтому пыль есть везде, а точек мало.
import * as THREE from 'three';

const N = 350, B = 14; // кол-во и размер куба, м

export function makeDust(glowTex) {
  const base = new Float32Array(N * 3), pos = new Float32Array(N * 3), ph = new Float32Array(N);
  for (let i = 0; i < N; i++) { base[i * 3] = Math.random() * B; base[i * 3 + 1] = Math.random() * 3.2; base[i * 3 + 2] = Math.random() * B; ph[i] = Math.random() * 6.28; }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const m = new THREE.PointsMaterial({ size: 0.014, map: glowTex || null, color: 0xfff4d8, transparent: true, opacity: 0.4, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true });
  const pts = new THREE.Points(g, m); pts.frustumCulled = false; pts.renderOrder = 3;
  return { pts, base, pos, ph, g, m };
}

// cam — позиция камеры; t — время; bright — яркость ламп (в темноте пыль почти не видна)
export function updateDust(d, cam, t, bright, ceil = 2.8) {
  const { base, pos, ph } = d, wrap = (v, c) => c + ((((v - c) % B) + B * 1.5) % B) - B / 2;
  for (let i = 0; i < N; i++) {
    const k = i * 3, p = ph[i];
    const x = base[k] + t * 0.05 + Math.sin(t * 0.21 + p) * 0.4;
    const z = base[k + 2] + t * 0.03 + Math.cos(t * 0.17 + p) * 0.4;
    pos[k] = wrap(x, cam.x); pos[k + 2] = wrap(z, cam.z);
    pos[k + 1] = 0.1 + (((base[k + 1] - t * 0.02 + Math.sin(t * 0.3 + p) * 0.15) % ceil) + ceil) % ceil;
  }
  d.g.attributes.position.needsUpdate = true;
  d.m.opacity = 0.08 + 0.3 * Math.min(1, bright);
}
