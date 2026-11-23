// Обстановка рівнів 1–4 справжніми CC0-моделями (Poly Haven):
// • база «Глубина-1»: спальні (ряди залізних ліжок), лабораторії (металеві столи з мікроскопами, каністри),
//   диспетчерська (столи вряд, шафа);
// • парковка: машини під брезентом уздовж стін, розмітка місць білою фарбою, каністри.
// Детерміновано від зерна рівня; не на шляху Швів, старту й дверей; тіла для зіткнень — коробки за габаритами.
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { attribute, instancedBufferAttribute } from 'three/tsl';
import type { Assets } from '../assets/loader';
import type { Physics } from '../physics/physics';
import { G } from '../physics/physics';
import { KNOCKABLE, instanceView, instanceLight, type InstancePart } from '../physics/knock';
import { rng } from '../core/rng';
import type { Level } from './level0';
import type { WallBox } from './layout';
import { probeAt, probeLit } from './materials';
import { dressLate } from './dressing-late';

export interface Spot { x: number; z: number; yaw: number }

function inWall(lvl: Level, x: number, z: number, r: number): boolean {
  return lvl.layout.walls.some((w) => Math.abs(x - w.x) < w.w / 2 + r && Math.abs(z - w.z) < w.d / 2 + r);
}

/** Місця вздовж стін: ряд із n речей шириною w (м) і глибиною d, з відступом gap; вільно перед стіною. */
export function wallRows(lvl: Level, r: () => number, rows: number, n: number, w: number, d: number, gap: number, avoid: { x: number; z: number; r: number }[],
  opt: { where?: (x: number, z: number) => boolean; dark?: boolean; walls?: WallBox[] } = {}): Spot[][] {
  const L = lvl.layout, out: Spot[][] = [];
  const walls = (opt.walls ?? L.walls).filter((wl) => wl.kind !== 'pillar' && Math.max(wl.w, wl.d) >= n * (w + gap) + 0.6);
  for (let tries = 0; tries < 300 && out.length < rows; tries++) {
    const wl = walls[Math.floor(r() * walls.length)];
    if (!wl) break;
    const horiz = wl.w >= wl.d, len = horiz ? wl.w : wl.d, side = r() < 0.5 ? 1 : -1;
    const nx = horiz ? 0 : side, nz = horiz ? side : 0, ax = horiz ? 1 : 0, az = horiz ? 0 : 1;
    const span = n * (w + gap) - gap, start = (r() - 0.5) * (len - span - 0.4) - span / 2 + w / 2;
    const face = (horiz ? wl.d : wl.w) / 2;
    const row: Spot[] = [];
    let ok = true;
    for (let i = 0; i < n && ok; i++) {
      const along = start + i * (w + gap);
      const x = wl.x + ax * along + nx * (face + d / 2 + 0.03), z = wl.z + az * along + nz * (face + d / 2 + 0.03);
      // уся площа речі й прохід перед нею вільні
      for (const [u, v] of [[-w / 2, -d / 2 + 0.06], [w / 2, -d / 2 + 0.06], [-w / 2, d / 2 + 0.7], [w / 2, d / 2 + 0.7], [0, 0]] as const) {
        if (inWall(lvl, x + ax * u + nx * v, z + az * u + nz * v, 0.04)) ok = false;
      }
      if (avoid.some((a) => Math.hypot(a.x - x, a.z - z) < a.r)) ok = false;
      // у межах рівня (зовнішні стіни мають і «зовнішній» бік) і не в цілковитій темряві — інакше речей ніхто не побачить
      if (x < 1 || z < 1 || x > L.cols * L.cell - 1 || z > L.rows * L.cell - 1 || (!opt.dark && probeAt(L.lights, x, z) < 0.38)) ok = false;
      if (opt.where && !opt.where(x, z)) ok = false;
      row.push({ x, z, yaw: Math.atan2(nx, nz) });
    }
    if (!ok) continue;
    out.push(row);
    for (const s of row) avoid.push({ x: s.x, z: s.z, r: Math.max(w, d) * 0.8 });
  }
  return out;
}

/** Речі обстановки, зібрані за моделлю: наприкінці — по одному InstancedMesh на кожну сітку моделі
 *  (десятки ліжечок, стільців і шафок — кілька викликів малювання замість сотень; освітленість — атрибут екземпляра). */
const batch = new Map<string, { scene: THREE.Object3D; items: { m: THREE.Matrix4; E: number; parts?: InstancePart[] }[] }>();
const localBox = new Map<string, THREE.Box3>();

export async function put(assets: Assets, physics: Physics, lvl: Level, file: string, s: Spot, yawOff = 0, y = 0, collide = true, scale = 1): Promise<THREE.Box3> {
  const scene = (await assets.model(`assets/models/${file}.glb`)).scene;
  let lb = localBox.get(file);
  if (!lb) { scene.updateMatrixWorld(true); lb = new THREE.Box3().setFromObject(scene); localBox.set(file, lb); }
  const m = new THREE.Matrix4().compose(new THREE.Vector3(s.x, y, s.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), s.yaw + yawOff), new THREE.Vector3(scale, scale, scale));
  const b = batch.get(file) ?? { scene, items: [] };
  // відро, каністра, стілець — динамічне тіло (можна перекинути), а не нерухома коробка
  const knock = collide && !!KNOCKABLE[file] && !!physics.knock;
  b.items.push({ m, E: probeAt(lvl.layout.lights, s.x, s.z), ...(knock ? { parts: [] } : {}) });
  batch.set(file, b);
  const bb = lb.clone().applyMatrix4(m);
  if (collide && !knock) {
    const c = bb.getCenter(new THREE.Vector3()), sz = bb.getSize(new THREE.Vector3());
    physics.addBox(c.x, c.y, c.z, Math.max(0.05, sz.x / 2 - 0.03), sz.y / 2, Math.max(0.05, sz.z / 2 - 0.03), 0, G.PROP);
  }
  return bb;
}

/** Зібрати накопичені речі в InstancedMesh-і (по одному на кожну сітку кожної моделі). */
function flushProps(lvl: Level, physics: Physics): void {
  for (const [file, { scene, items }] of batch) {
    scene.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(scene.matrixWorld).invert();
    scene.traverse((o) => {
      const src = o as THREE.Mesh;
      if (!src.isMesh) return;
      // спільні буфери, але своя геометрія (атрибут екземпляра не має чіплятися до кешованої моделі)
      const g = new THREE.BufferGeometry();
      for (const [k, a] of Object.entries(src.geometry.attributes)) g.setAttribute(k, a);
      if (src.geometry.index) g.setIndex(src.geometry.index);
      for (const gr of src.geometry.groups) g.addGroup(gr.start, gr.count, gr.materialIndex);
      g.boundingSphere = null;
      const light = new THREE.InstancedBufferAttribute(new Float32Array(items.map((i) => i.E)), 1);
      const Es = instancedBufferAttribute(light) as unknown as THREE.Node<'float'>;
      const mats = (Array.isArray(src.material) ? src.material : [src.material]).map((mt) => probeLit(mt, Es));
      const im = new THREE.InstancedMesh(g, mats.length === 1 ? mats[0] as THREE.Material : mats, items.length);
      const local = new THREE.Matrix4().multiplyMatrices(inv, src.matrixWorld);
      items.forEach((it, i) => { im.setMatrixAt(i, new THREE.Matrix4().multiplyMatrices(it.m, local)); it.parts?.push({ im, i, local, light }); });
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
      im.castShadow = true; im.receiveShadow = true;
      lvl.scene.add(im);
    });
    if (KNOCKABLE[file] && physics.knock) for (const it of items) if (it.parts) physics.knock.add(file, instanceView(it.parts), it.m, scene, it.parts.map((p) => p.im), instanceLight(it.parts));
  }
  batch.clear();
}

/** Повертає перші місця кожного ряду (для контрольних кадрів). */
export async function dressLevel(assets: Assets, physics: Physics, lvl: Level, taken: { x: number; z: number }[]): Promise<(Spot & { kind: string })[]> {
  const shown: (Spot & { kind: string })[] = [];
  const L = lvl.layout, r = rng(L.seed ^ 0xd2e55);
  const sp = lvl.seam.group.position, ap = lvl.arrival.group.position;
  const avoid = [...taken.map((t) => ({ ...t, r: 1.6 })), { x: sp.x, z: sp.z, r: 3 }, { x: ap.x, z: ap.z, r: 3 }, { x: L.spawn.x, z: L.spawn.z, r: 2.5 },
    ...lvl.doors.list.map((d) => ({ x: d.cx, z: d.cz, r: 1.4 }))];
  if (lvl.id === 1) {
    // спальні: ряди по 3–4 залізні ліжка ногами до проходу
    for (const row of wallRows(lvl, r, 4, 3 + (r() < 0.5 ? 1 : 0), 1.0, 2.0, 0.45, avoid)) { shown.push({ ...(row[0] as Spot), kind: 'dorm' }); for (const s of row) await put(assets, physics, lvl, 'bed', s); }
    // лабораторії: стіл, на ньому мікроскоп; поруч каністра
    for (const row of wallRows(lvl, r, 4, 2, 1.3, 0.75, 0.3, avoid)) {
      shown.push({ ...(row[0] as Spot), kind: 'lab' });
      for (const [i, s] of row.entries()) {
        const bb = await put(assets, physics, lvl, 'mdesk', s, Math.PI);
        if (i === 0 || r() < 0.5) await put(assets, physics, lvl, 'microscope', { x: s.x, z: s.z, yaw: s.yaw + 0.3 }, Math.PI, bb.max.y + 0.002);
      }
      const s0 = row[row.length - 1] as Spot;
      if (r() < 0.7) await put(assets, physics, lvl, 'jerrycan', { x: s0.x + Math.cos(s0.yaw) * 1.0, z: s0.z - Math.sin(s0.yaw) * 1.0, yaw: s0.yaw + 0.4 });
    }
    // диспетчерська / склад: шафи
    for (const row of wallRows(lvl, r, 3, 2, 1.0, 0.5, 0.15, avoid)) { shown.push({ ...(row[0] as Spot), kind: 'cabinet' }); for (const s of row) await put(assets, physics, lvl, 'cabinet', s); }
  } else if (lvl.id === 2) {
    // машини під брезентом носом до стіни + біла розмітка місць
    const lines: THREE.BufferGeometry[] = [];
    for (const row of wallRows(lvl, r, 7, 2 + Math.floor(r() * 2), 2.0, 4.4, 0.7, avoid)) {
      shown.push({ ...(row[0] as Spot), kind: 'cars' });
      for (const s of row) {
        if (r() < 0.85) await put(assets, physics, lvl, 'car', s, (r() < 0.5 ? 0 : Math.PI) + (r() - 0.5) * 0.06);
        else if (r() < 0.6) await put(assets, physics, lvl, 'jerrycan', s, 0.7);
        // лінії обабіч місця: 4.6 м уздовж машини, 0.1 м завширшки
        const ux = Math.cos(s.yaw), uz = -Math.sin(s.yaw);
        for (const side of [-1, 1]) {
          const g = new THREE.PlaneGeometry(0.1, 4.6);
          g.rotateX(-Math.PI / 2); g.rotateY(s.yaw);
          g.translate(s.x + ux * side * 1.35, 0.006, s.z + uz * side * 1.35);
          g.setAttribute('lightE', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position!.count).fill(probeAt(L.lights, s.x, s.z) * 0.8), 1));
          lines.push(g);
        }
      }
    }
    if (lines.length) {
      const m = probeLit(new THREE.MeshStandardMaterial({ color: 0xbdb6a0, roughness: 0.9, transparent: true, opacity: 0.75, depthWrite: false }), attribute('lightE', 'float') as unknown as THREE.Node<'float'>);
      m.polygonOffset = true; m.polygonOffsetFactor = -2;
      const mesh = new THREE.Mesh(mergeGeometries(lines) as THREE.BufferGeometry, m);
      mesh.receiveShadow = true;
      lvl.scene.add(mesh);
    }
  } else if (lvl.id === 3 || lvl.id === 4) {
    await dressLate(assets, physics, lvl, r, avoid, shown);
  }
  flushProps(lvl, physics);
  physics.step();
  return shown;
}
