// Те, що видно лише крізь відеокамеру (шар LAYER_CAM):
// • стрілки світної фарби на підлозі — шлях попередньої експедиції до Шва (камера стає «компасом», але сідає);
// • люди попередніх експедицій: нерухомі темні силуети, що стоять у кімнатах обличчям до стіни.
import * as THREE from 'three/webgpu';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import type { Layout } from './layout';
import { LAYER_CAM } from '../game/camcorder';

/** Шлях від Шва назад до старту по клітинках (dist спадає), від старту до Шва. */
export function pathToExit(l: Layout): [number, number][] {
  const out: [number, number][] = [];
  let x = l.exit.cx, z = l.exit.cz, guard = 0;
  out.push([x, z]);
  while ((l.dist[z * l.cols + x] as number) > 0 && guard++ < l.cols * l.rows) {
    const d = l.dist[z * l.cols + x] as number;
    let next: [number, number] | null = null;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx, nz = z + dz;
      if (nx < 0 || nz < 0 || nx >= l.cols || nz >= l.rows) continue;
      if (l.dist[nz * l.cols + nx] === d - 1 && !wallBetween(l, x, z, nx, nz)) { next = [nx, nz]; break; }
    }
    if (!next) break;
    [x, z] = next;
    out.push([x, z]);
  }
  return out.reverse();
}

function wallBetween(l: Layout, ax: number, az: number, bx: number, bz: number): boolean {
  const mx = ((ax + bx) / 2 + 0.5) * l.cell, mz = ((az + bz) / 2 + 0.5) * l.cell;
  return l.walls.some((w) => Math.abs(mx - w.x) < w.w / 2 + 0.02 && Math.abs(mz - w.z) < w.d / 2 + 0.02);
}

function arrowGeometry(): THREE.BufferGeometry {
  // стрілка, намальована пензлем: древко + вістря (у площині XZ, «вперед» = −Z)
  const s = new THREE.Shape();
  s.moveTo(-0.045, 0.32); s.lineTo(0.05, 0.3); s.lineTo(0.04, -0.06); s.lineTo(0.16, -0.05);
  s.lineTo(0.0, -0.32); s.lineTo(-0.17, -0.04); s.lineTo(-0.05, -0.06); s.closePath();
  const g = new THREE.ShapeGeometry(s);
  g.rotateX(-Math.PI / 2);
  return g;
}

export function buildUnseen(l: Layout, figure: THREE.Object3D | null, seed: number): THREE.Group {
  const g = new THREE.Group();
  g.name = 'unseen';
  // стрілки: кожні 5 клітинок шляху, напрямок — на 2 клітинки вперед
  const path = pathToExit(l);
  const mat = new THREE.MeshBasicNodeMaterial({ color: new THREE.Color(0.26, 0.42, 0.22), transparent: true, opacity: 0.8, depthWrite: false });
  const geo = arrowGeometry();
  const arrows: THREE.Matrix4[] = [];
  const q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), m = new THREE.Matrix4();
  for (let i = 3; i < path.length - 2; i += 5) {
    const [x, z] = path[i] as [number, number], [nx, nz] = path[Math.min(path.length - 1, i + 2)] as [number, number];
    const yaw = Math.atan2(-(nx - x), -(nz - z));
    q.setFromAxisAngle(up, yaw);
    const jitter = ((i * 7919) % 13) / 13 - 0.5;
    m.compose(new THREE.Vector3((x + 0.5) * l.cell + jitter * 0.2, 0.012, (z + 0.5) * l.cell - jitter * 0.15), q, new THREE.Vector3(1.4, 1, 1.4));
    arrows.push(m.clone());
  }
  if (arrows.length) {
    const im = new THREE.InstancedMesh(geo, mat, arrows.length);
    arrows.forEach((a, i) => im.setMatrixAt(i, a));
    im.layers.set(LAYER_CAM);
    im.renderOrder = 2;
    g.add(im);
  }
  // силуети: 5 нерухомих людей у різних місцях рівня, подалі від старту, обличчям до стіни
  if (figure) {
    let r = seed >>> 0;
    const rnd = () => { r = (r * 1664525 + 1013904223) >>> 0; return r / 4294967296; };
    const dark = new THREE.MeshStandardNodeMaterial({ color: 0x050505, roughness: 1 });
    const spots: [number, number, number][] = [];
    for (let k = 0; k < 400 && spots.length < 5; k++) {
      const cx = Math.floor(rnd() * l.cols), cz = Math.floor(rnd() * l.rows);
      const d = l.dist[cz * l.cols + cx] as number;
      if (d < 14) continue;
      const x = (cx + 0.5) * l.cell, z = (cz + 0.5) * l.cell;
      if (spots.some(([sx, sz]) => Math.hypot(sx - x, sz - z) < 14)) continue;
      // стіна поруч (на відстані клітинки): стоїть обличчям до неї
      const near = l.walls.find((w) => w.kind !== 'pillar' && Math.abs(x - w.x) < w.w / 2 + 0.75 && Math.abs(z - w.z) < w.d / 2 + 0.75);
      if (!near || l.walls.some((w) => Math.abs(x - w.x) < w.w / 2 + 0.35 && Math.abs(z - w.z) < w.d / 2 + 0.35)) continue;
      const alongX = near.w >= near.d;
      const yaw = alongX ? (z < near.z ? 0 : Math.PI) : (x < near.x ? Math.PI / 2 : -Math.PI / 2);
      spots.push([x, z, yaw]);
    }
    for (const [x, z, yaw] of spots) {
      const f = cloneSkinned(figure);
      f.position.set(x, 0, z);
      f.rotation.y = yaw;
      f.scale.setScalar(0.78); // люди, а не Фигура: людського зросту
      f.traverse((o) => {
        const mm = o as THREE.Mesh;
        if (mm.isMesh) { mm.material = dark; mm.frustumCulled = false; mm.layers.set(LAYER_CAM); }
        const b = o as THREE.Bone;
        if (b.isBone) {
          if (b.name === 'upperarm_l') { b.rotation.y += 1.25; b.rotation.z -= 1.25; }
          if (b.name === 'upperarm_r') { b.rotation.y -= 1.25; b.rotation.z += 1.25; }
          if (b.name === 'neck_01') b.rotation.x += 0.5; // голова опущена
        }
      });
      g.add(f);
    }
  }
  return g;
}
