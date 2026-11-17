// Завантаження моделей і текстур: GLTF/GLB з геометрією Meshopt і текстурами KTX2 (Basis).
// Кеш за адресою: одна модель вантажиться один раз, далі — клон.
import type * as THREE from 'three/webgpu';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const base = import.meta.env.BASE_URL;

export class Assets {
  private readonly gltf: GLTFLoader;
  readonly ktx2: KTX2Loader;
  private readonly cache = new Map<string, Promise<GLTF>>();
  /** Прогрес для екрана завантаження: 0..1 */
  onProgress: ((p: number) => void) | null = null;
  private pending = 0;
  private done = 0;
  /** Текстури поточного рівня (карти світла, поверхні): вони живуть у TSL-вузлах, тож звільняємо їх списком. */
  private levelTextures = new Set<THREE.Texture>();

  constructor(renderer: THREE.WebGPURenderer) {
    this.ktx2 = new KTX2Loader().setTranscoderPath(`${base}libs/basis/`);
    this.ktx2.detectSupport(renderer);
    this.gltf = new GLTFLoader().setKTX2Loader(this.ktx2).setMeshoptDecoder(MeshoptDecoder);
  }

  model(path: string): Promise<GLTF> {
    let p = this.cache.get(path);
    if (!p) {
      this.pending++;
      p = this.gltf.loadAsync(`${base}${path}`).finally(() => { this.done++; this.onProgress?.(this.done / this.pending); });
      this.cache.set(path, p);
    }
    return p;
  }

  texture(path: string): Promise<THREE.Texture> {
    return this.ktx2.loadAsync(`${base}${path}`).then((t) => { this.levelTextures.add(t); return t; });
  }

  /**
   * Звільнити все, що належало рівню: його текстури (GPU) і закешовані шматки геометрії (assets/levels/…).
   * Моделі предметів і монстрів лишаються в кеші — вони спільні для рівнів.
   */
  releaseLevel(): void {
    for (const t of this.levelTextures) t.dispose();
    this.levelTextures.clear();
    for (const [k, p] of this.cache) {
      if (!k.startsWith('assets/levels/')) continue;
      this.cache.delete(k);
      void p.then((g) => g.scene.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) m.geometry.dispose(); }), () => {});
    }
  }
}
