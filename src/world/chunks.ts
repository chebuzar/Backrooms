// Спільне для всіх рівнів: шматки геометрії з Blender (12×12 м) із запеченими картами світла, матеріали за іменем,
// статичні колізії зі спільного планування.
import * as THREE from 'three/webgpu';
import type { Assets } from '../assets/loader';
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
    scene.add(root);
    onProgress(done++ / manifest.chunks.length);
  }));
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
  });
  scene.clear();
}
