// Розклад draw calls за групами об'єктів (лише для діагностики в автотестах): які видимі меші камера малює
// і скільки з них потрапляють у тінь ліхтарика. Гра цей модуль не завантажує.
import * as THREE from 'three/webgpu';
import type { Game } from '../game/game';

export function drawStats(game: Game): Record<string, number> {
  const cam = game.camera;
  cam.updateMatrixWorld();
  const fr = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
  const out: Record<string, number> = {};
  const add = (k: string, n = 1) => { out[k] = (out[k] ?? 0) + n; };
  const fl = game.level?.flashlight;
  let lightFr: THREE.Frustum | null = null;
  if (fl && fl.intensity > 0.01 && fl.castShadow) {
    const sc = fl.shadow.camera as THREE.PerspectiveCamera;
    fl.shadow.updateMatrices(fl);
    lightFr = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(sc.projectionMatrix, sc.matrixWorldInverse));
  }
  game.scene.traverseVisible((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const group = groupOf(m);
    const visible = !m.frustumCulled || fr.intersectsObject(m);
    if (visible) add(`view:${group}`);
    if (lightFr && m.castShadow && (!m.frustumCulled || lightFr.intersectsObject(m))) add(`shadow:${group}`);
  });
  return out;
}

function groupOf(m: THREE.Object3D): string {
  let o: THREE.Object3D | null = m;
  while (o) {
    if (/^chunk|level|c\d+_\d+/i.test(o.name)) return 'chunk:' + ((m as THREE.Mesh).material as THREE.Material).name;
    o = o.parent;
  }
  const mat = (m as THREE.Mesh).material as THREE.Material;
  if ((m as THREE.InstancedMesh).isInstancedMesh) return 'instanced';
  if ((m as THREE.SkinnedMesh).isSkinnedMesh) return 'monster';
  return 'other:' + (m.parent?.name || mat?.type || '?');
}
