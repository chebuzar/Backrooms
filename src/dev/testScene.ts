// Тестова кімната для перевірки рендера, фізики й керування (етап 0). Не входить у гру.
import * as THREE from 'three/webgpu';
import type { Physics } from '../physics/physics';

export function buildTestScene(physics: Physics): { scene: THREE.Scene; update: (t: number) => void; spawn: [number, number, number] } {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  scene.fog = new THREE.FogExp2(0x1b1608, 0.06);
  const wall = new THREE.MeshStandardMaterial({ color: 0xc9b56a, roughness: 0.85 });
  const floor = new THREE.MeshStandardMaterial({ color: 0x8a7a3e, roughness: 1 });
  const ceil = new THREE.MeshStandardMaterial({ color: 0xd8d2bd, roughness: 0.9 });
  const lampMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff3d6, emissiveIntensity: 4 });
  // блок: і меш, і колізія
  const box = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, solid = true) => {
    const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); scene.add(o);
    if (solid) physics.addBox(x, y, z, w / 2, h / 2, d / 2);
    return o;
  };
  box(14, 0.1, 14, floor, 0, -0.05, 0);
  box(14, 0.1, 14, ceil, 0, 2.75, 0);
  box(14, 2.8, 0.2, wall, 0, 1.4, -7);
  box(14, 2.8, 0.2, wall, 0, 1.4, 7);
  box(0.2, 2.8, 14, wall, -7, 1.4, 0);
  box(0.2, 2.8, 14, wall, 7, 1.4, 0);
  box(0.8, 2.8, 0.8, wall, -2, 1.4, -2);
  box(0.8, 2.8, 0.8, wall, 2.5, 1.4, -3.5);
  box(1, 0.8, 1, floor, 0.5, 0.4, 0);
  box(2, 0.05, 1.2, floor, -4, 1.2, 3); // низький «стіл» — під ним можна пролізти присівши
  const lights: THREE.PointLight[] = [];
  for (const [x, z] of [[-3, -3], [3, -3], [0, 2]] as const) {
    box(1.2, 0.04, 0.3, lampMat, x, 2.69, z, false);
    const l = new THREE.PointLight(0xfff0cc, 5, 12, 2); l.position.set(x, 2.55, z); scene.add(l); lights.push(l);
  }
  scene.add(new THREE.AmbientLight(0x4a4026, 0.6));
  physics.step();
  return { scene, spawn: [0, 0, 4.5], update: (t) => { const f = lights[0]; if (f) f.intensity = 5 * (Math.sin(t * 37) > 0.93 ? 0.15 : 1); } };
}
