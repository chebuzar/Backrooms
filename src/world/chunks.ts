// Спільне для всіх рівнів: шматки геометрії з Blender (12×12 м) із запеченими картами світла, матеріали за іменем,
// статичні колізії зі спільного планування.
import * as THREE from 'three/webgpu';
import { yieldTask, type Assets } from '../assets/loader';
import { attribute } from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BakedMaterial } from './materials';
import type { Physics } from '../physics/physics';
import type { Layout } from './layout';

interface Manifest { chunk: number; nx: number; nz: number; height: number; chunks: { x: number; z: number; glb: string; lm: string }[] }

/** Завантажити всі шматки рівня з public/assets/levels/<dir>/ і призначити матеріали за іменами з Blender. */
export async function loadChunks(assets: Assets, dir: string, scene: THREE.Scene,
  materialsFor: (lm: THREE.Texture) => Record<string, THREE.Material>, onProgress: (p: number) => void): Promise<void> {
  const base = `${import.meta.env.BASE_URL}assets/levels/${dir}/`;
  const manifest = (await (await fetch(`${base}manifest.json`)).json()) as Manifest;
  const lmLoader = new THREE.TextureLoader();
  let done = 0;
  await Promise.all(manifest.chunks.map(async (c) => {
    const lmPromise = c.lm.endsWith('.ktx2') ? assets.texture(`assets/levels/${dir}/${c.lm}`) : lmLoader.loadAsync(base + c.lm);
    const [gltf, lm] = await Promise.all([assets.model(`assets/levels/${dir}/${c.glb}`), lmPromise]);
    lm.colorSpace = THREE.NoColorSpace;
    lm.flipY = false;
    if (!c.lm.endsWith('.ktx2')) { lm.generateMipmaps = true; lm.minFilter = THREE.LinearMipmapLinearFilter; }
    await assets.gate();
    await yieldTask();
    const mats = materialsFor(lm);
    // копія: кешована модель зберігає свої іменовані матеріали для повторного входу на рівень
    const root = gltf.scene.clone(true);
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const name = (mesh.material as THREE.Material).name;
      mesh.material = (mats[name] ?? mats.wall) as THREE.Material;
      mesh.receiveShadow = true;
      mesh.castShadow = true;
    });
    mergeKit(root, mats);
    scene.add(root);
    onProgress(done++ / manifest.chunks.length);
  }));
}

/** Однотонні деталі кіту будівлі (плінтус, рамки, пластик, метал, порожнина над стелею). */
const KIT = ['base', 'tbar', 'plenum', 'plastic', 'metal', 'frame'];

/**
 * Дрібні однотонні деталі шматка — в один меш (один виклик малювання замість ~5): колір, шорсткість і металічність
 * кожної деталі записуються у її вершини, освітлення — та сама запечена карта шматка. Вигляд не змінюється.
 */
function mergeKit(root: THREE.Object3D, mats: Record<string, THREE.Material>): void {
  const kit = new Set(KIT.map((k) => mats[k]).filter(Boolean));
  const parts: THREE.Mesh[] = [];
  root.updateMatrixWorld(true);
  root.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && kit.has(m.material as THREE.Material)) parts.push(m); });
  if (parts.length < 2) return;
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const names = Object.keys((parts[0] as THREE.Mesh).geometry.attributes).sort().join();
  if (parts.some((p) => Object.keys(p.geometry.attributes).sort().join() !== names)) return; // різний набір атрибутів — не чіпаємо
  const geos = parts.map((p) => {
    const g = p.geometry.clone();
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, p.matrixWorld));
    const m = p.material as THREE.MeshStandardMaterial, n = (g.attributes.position as THREE.BufferAttribute).count;
    const col = new Float32Array(n * 3), rm = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) { col.set([m.color.r, m.color.g, m.color.b], i * 3); rm.set([m.roughness, m.metalness], i * 2); }
    g.setAttribute('kitColor', new THREE.BufferAttribute(col, 3));
    g.setAttribute('kitRM', new THREE.BufferAttribute(rm, 2));
    return g;
  });
  const merged = mergeGeometries(geos, false);
  for (const g of geos) g.dispose();
  if (!merged) return;
  const src = parts[0]!.material as BakedMaterial;
  const mat = new BakedMaterial();
  mat.colorNode = attribute('kitColor', 'vec3');
  const rmA = attribute('kitRM', 'vec2') as unknown as THREE.Node<'vec2'>;
  mat.roughnessNode = rmA.x;
  mat.metalnessNode = rmA.y;
  mat.lmNode = src.lmNode;
  const mesh = new THREE.Mesh(merged, mat);
  mesh.name = 'kit';
  mesh.castShadow = true; mesh.receiveShadow = true;
  for (const p of parts) p.removeFromParent();
  root.add(mesh);
}

/** Підлога, стеля, стіни й колони як статичні тіла. */
export function addLayoutColliders(physics: Physics, layout: Layout): void {
  const W = layout.cols * layout.cell, D = layout.rows * layout.cell, H = layout.height;
  physics.addBox(W / 2, -0.5, D / 2, W / 2 + 1, 0.5, D / 2 + 1);
  physics.addBox(W / 2, H + 0.5, D / 2, W / 2 + 1, 0.5, D / 2 + 1);
  for (const w of layout.walls) physics.addBox(w.x, H / 2, w.z, w.w / 2, H / 2, w.d / 2);
  physics.step();
}

/** Звільнити GPU-пам'ять усього, що було в сцені (при переході на інший рівень). */
export function disposeScene(scene: THREE.Scene): void {
  const seen = new Set<unknown>();
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry && !seen.has(m.geometry)) { seen.add(m.geometry); m.geometry.dispose(); }
    const mats = m.material ? (Array.isArray(m.material) ? m.material : [m.material]) : [];
    for (const mat of mats) {
      if (seen.has(mat)) continue;
      seen.add(mat);
      for (const v of Object.values(mat)) if ((v as THREE.Texture)?.isTexture && !seen.has(v)) { seen.add(v); (v as THREE.Texture).dispose(); }
      mat.dispose();
    }
    if ((o as THREE.Light).isLight) (o as THREE.Light).dispose();
    // буфери екземплярів (лампи) і текстура кісток (монстри)
    if ((o as THREE.InstancedMesh).isInstancedMesh || (o as THREE.SkinnedMesh).isSkinnedMesh) (o as THREE.InstancedMesh).dispose();
  });
  scene.clear();
}
