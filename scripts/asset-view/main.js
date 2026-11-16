// Переглядач моделі для scripts/asset-view.mjs: GLTFLoader + KTX2Loader + MeshoptDecoder (three 0.160),
// камера сама наводиться на модель. Результат — window.__view.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const q = new URLSearchParams(location.search);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1b1a17);
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.01, 1000);

const ktx2 = new KTX2Loader().setTranscoderPath(q.get('basis')).detectSupport(renderer);
const loader = new GLTFLoader().setKTX2Loader(ktx2).setMeshoptDecoder(MeshoptDecoder);
loader.load(q.get('src'), (gltf) => {
  const root = gltf.scene;
  scene.add(root);
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const c = box.getCenter(new THREE.Vector3());
  const r = Math.max(size.x, size.y, size.z) || 1;
  camera.position.set(c.x + r * 1.1, c.y + r * 0.7, c.z + r * 1.4);
  camera.near = r / 100; camera.far = r * 20; camera.updateProjectionMatrix();
  camera.lookAt(c);
  let tris = 0, ktx = 0, meshes = 0;
  root.traverse((o) => {
    if (!o.isMesh) return;
    meshes++;
    const g = o.geometry;
    tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
    for (const m of [].concat(o.material)) for (const k of ['map', 'normalMap', 'roughnessMap', 'emissiveMap', 'aoMap'])
      if (m[k] && m[k].isCompressedTexture) ktx++;
  });
  renderer.render(scene, camera);
  window.__view = { ok: true, meshes, tris, compressedTextures: ktx, size: size.toArray().map((v) => +v.toFixed(2)), animations: gltf.animations.length };
}, undefined, (e) => { window.__view = { ok: false, error: String(e && e.message || e) }; });
