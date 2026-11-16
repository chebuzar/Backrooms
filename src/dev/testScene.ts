// Тестова кімната для перевірки рендера й ефектів (етап 0). Не входить у гру.
import * as THREE from 'three/webgpu';

export function buildTestScene(): { scene: THREE.Scene; camera: THREE.PerspectiveCamera; update: (t: number) => void } {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  scene.fog = new THREE.FogExp2(0x1b1608, 0.06);
  const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.05, 120);
  camera.position.set(0, 1.62, 4.5);
  const wall = new THREE.MeshStandardMaterial({ color: 0xc9b56a, roughness: 0.85 });
  const floor = new THREE.MeshStandardMaterial({ color: 0x8a7a3e, roughness: 1 });
  const ceil = new THREE.MeshStandardMaterial({ color: 0xd8d2bd, roughness: 0.9 });
  const lampMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff3d6, emissiveIntensity: 6 });
  const add = (g: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number) => { const o = new THREE.Mesh(g, m); o.position.set(x, y, z); scene.add(o); return o; };
  add(new THREE.BoxGeometry(14, 0.1, 14), floor, 0, -0.05, 0);
  add(new THREE.BoxGeometry(14, 0.1, 14), ceil, 0, 2.75, 0);
  add(new THREE.BoxGeometry(14, 2.8, 0.2), wall, 0, 1.4, -7);
  add(new THREE.BoxGeometry(0.2, 2.8, 14), wall, -7, 1.4, 0);
  add(new THREE.BoxGeometry(0.2, 2.8, 14), wall, 7, 1.4, 0);
  add(new THREE.BoxGeometry(0.8, 2.8, 0.8), wall, -2, 1.4, -2);
  add(new THREE.BoxGeometry(0.8, 2.8, 0.8), wall, 2.5, 1.4, -3.5);
  add(new THREE.BoxGeometry(1, 0.8, 1), floor, 0.5, 0.4, 0);
  const lights: THREE.PointLight[] = [];
  for (const [x, z] of [[-3, -3], [3, -3], [0, 2]] as const) {
    add(new THREE.BoxGeometry(1.2, 0.04, 0.3), lampMat, x, 2.69, z);
    const l = new THREE.PointLight(0xfff0cc, 6, 12, 2); l.position.set(x, 2.55, z); scene.add(l); lights.push(l);
  }
  scene.add(new THREE.AmbientLight(0x4a4026, 0.6));
  return { scene, camera, update: (t) => { camera.position.x = Math.sin(t * 0.3) * 1.5; camera.lookAt(0, 1.2, -4); const f = lights[0]; if (f) f.intensity = 6 * (Math.sin(t * 37) > 0.9 ? 0.2 : 1); } };
}
