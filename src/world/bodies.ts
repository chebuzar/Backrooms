// Тіла Оператора там, де він загинув раніше (з минулих спроб): лежать на підлозі, лишаються назавжди.
// Позначаються хрестиком «тело» в блокноті. Нікому не пояснюється, чиї вони.
import * as THREE from 'three/webgpu';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { makeBloodPool } from './blood';

const LIMP: Record<string, [number, number, number]> = {
  upperarm_l: [0.2, 0.9, -0.7], upperarm_r: [-0.3, -0.5, 0.4], lowerarm_l: [0, 0, 0.6], lowerarm_r: [0, 0, -0.9],
  thigh_l: [0.15, 0, 0.12], thigh_r: [-0.25, 0, -0.08], calf_r: [0.5, 0, 0], neck_01: [0.25, 0.5, 0]
};

export function makeBody(figure: THREE.Object3D, x: number, z: number, yaw: number, bloodAtlas: THREE.Texture | null = null): THREE.Object3D {
  const root = new THREE.Group();
  const o = cloneSkinned(figure);
  // спецодяг оператора: темна бавовна, без відблиску
  const cloth = new THREE.MeshStandardNodeMaterial({ color: 0x2b2e27, roughness: 1 });
  o.traverse((n) => {
    const mm = n as THREE.Mesh;
    if (mm.isMesh) { mm.material = cloth; mm.frustumCulled = false; mm.castShadow = true; mm.receiveShadow = true; }
    const b = n as THREE.Bone;
    const r = b.isBone ? LIMP[b.name] : undefined;
    if (r) { b.rotation.x += r[0]; b.rotation.y += r[1]; b.rotation.z += r[2]; }
  });
  // лежить ниць: модель (ноги в 0, зріст уздовж +Y) кладемо вздовж підлоги
  o.rotation.x = Math.PI / 2;
  o.scale.setScalar(0.78);
  o.position.y = 0.12;
  root.add(o);
  root.position.set(x, 0, z);
  root.rotation.y = yaw;
  root.name = 'body';
  // засохла калюжа під тілом (18+): там, де його розірвали
  if (bloodAtlas) { const pool = makeBloodPool(bloodAtlas, 0, 0, 1.5, x * 3.1 + z); pool.position.set(0, 0.006, -0.4); root.add(pool); }
  return root;
}
