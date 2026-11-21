// Радянські деталі «Бесконечного НИИ» на стінах: стенди ТБ і ГО, стінгазета, Доска почёта, графіки чергувань,
// таблички на дверях, «Уходя, гасите свет» над вимикачами, транспаранти в залах, рупори гучного зв'язку в коридорах.
// Усе детерміновано з планування; дві злиті сітки (папір/табличкиі метал рупорів) — два виклики малювання на весь рівень.
import * as THREE from 'three/webgpu';
import { attribute } from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { rng } from '../core/rng';
import type { Layout } from './layout';
import { zoneOf, type Decor } from './decor';
import { probeAt, probeLit } from './materials';
import { buildPosterAtlas, PLAQUES, type Slot } from './nii-posters';

export interface NiiDetails {
  group: THREE.Group;
  /** Рупори гучного зв'язку (для звуку «объявлений»). */
  speakers: { x: number; y: number; z: number }[];
  /** Що висить на довгих стінах (стенди, графіки, Доска почёта) — для взаємодії/сюжету. */
  boards: { id: string; x: number; y: number; z: number; yaw: number }[];
}

const DEPTH: Record<string, number> = { tb: 0.03, go: 0.03, hon: 0.025, gaz: 0.002, graf: 0.002, slava: 0.004, tish: 0.006, post: 0.006, svet: 0.003 };

function inWall(l: Layout, x: number, z: number, r = 0): boolean {
  return l.walls.some((w) => Math.abs(x - w.x) < w.w / 2 + r && Math.abs(z - w.z) < w.d / 2 + r);
}

/** Тонкий брусок: лице — слот атласу, торці — кольоровий клаптик рамки. */
function board(slot: Slot, edge: Slot, depth: number, m: THREE.Matrix4, E: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(slot.w, slot.h, depth).toNonIndexed();
  const uv = g.attributes.uv as THREE.BufferAttribute;
  const eu = (edge.u0 + edge.u1) / 2, ev = (edge.v0 + edge.v1) / 2;
  for (let i = 0; i < uv.count; i++) {
    const face = Math.floor(i / 6); // 0 +x, 1 −x, 2 +y, 3 −y, 4 +z (лице), 5 −z
    if (face === 4) uv.setXY(i, slot.u0 + uv.getX(i) * (slot.u1 - slot.u0), slot.v0 + uv.getY(i) * (slot.v1 - slot.v0));
    else uv.setXY(i, eu, ev);
  }
  g.translate(0, 0, depth / 2);
  g.applyMatrix4(m);
  g.setAttribute('lightE', new THREE.Float32BufferAttribute(new Float32Array(uv.count).fill(E), 1));
  return g;
}

/** Рупорний гучномовець на кронштейні (дивиться вздовж коридору, трохи донизу). */
function hornGeometry(m: THREE.Matrix4, E: number): THREE.BufferGeometry {
  const pts = [new THREE.Vector2(0.045, 0), new THREE.Vector2(0.05, 0.06), new THREE.Vector2(0.08, 0.2), new THREE.Vector2(0.15, 0.34), new THREE.Vector2(0.158, 0.345)];
  const horn = new THREE.LatheGeometry(pts, 20);
  horn.rotateX(Math.PI / 2); // вісь уздовж +Z
  const back = new THREE.CylinderGeometry(0.075, 0.075, 0.1, 16);
  back.rotateX(Math.PI / 2); back.translate(0, 0, -0.04);
  const parts = [horn, back].map((g) => g.toNonIndexed());
  const head = mergeGeometries(parts) as THREE.BufferGeometry;
  head.rotateX(0.35); // нахил донизу
  head.translate(0, 0, 0.2);
  const arm = new THREE.BoxGeometry(0.04, 0.04, 0.26).toNonIndexed(); arm.translate(0, 0.02, 0.1);
  const plateG = new THREE.BoxGeometry(0.12, 0.16, 0.015).toNonIndexed(); plateG.translate(0, 0.02, 0.008);
  const g = mergeGeometries([head, arm, plateG]) as THREE.BufferGeometry;
  g.deleteAttribute('uv');
  g.applyMatrix4(m);
  g.setAttribute('lightE', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position!.count).fill(E), 1));
  return g;
}

export async function buildNiiDetails(l: Layout, decor: Decor[], avoid: { x: number; z: number }[]): Promise<NiiDetails> {
  const atlas = await buildPosterAtlas();
  const S = atlas.slots, edge = S.edge as Slot;
  const r = rng(l.seed ^ 0x5017);
  const T = l.wallThickness, H = l.height;
  const geos: THREE.BufferGeometry[] = [], horns: THREE.BufferGeometry[] = [];
  const placed: { x: number; z: number; w: number }[] = [...avoid.map((a) => ({ ...a, w: 1.4 }))];
  const boards: NiiDetails['boards'] = [], speakers: NiiDetails['speakers'] = [];
  const counts: Record<string, number> = {};
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
  const others = decor.filter((d) => d.t !== 'hole');

  const put = (id: string, x: number, y: number, z: number, yaw: number) => {
    const slot = S[id] as Slot;
    q.setFromAxisAngle(up, yaw);
    m.compose(new THREE.Vector3(x, y, z), q, one);
    geos.push(board(slot, edge, DEPTH[id] ?? 0.004, m, probeAt(l.lights, x, z)));
    placed.push({ x, z, w: slot.w });
    counts[id] = (counts[id] ?? 0) + 1;
  };

  // --- на довгих гранях стін: що висить, залежить від зони
  const LIMIT: Record<string, number> = { tb: 6, go: 4, gaz: 3, hon: 2, graf: 7, slava: 3, tish: 7 };
  const pick = (zone: string): string | null => {
    const roll = r();
    const opts = zone === 'hall' ? [['slava', 0.18], ['hon', 0.14], ['gaz', 0.2], ['tb', 0.1]]
      : zone === 'corridors' ? [['tb', 0.12], ['go', 0.1], ['tish', 0.12], ['graf', 0.08]]
        : zone === 'rooms' ? [['graf', 0.08], ['gaz', 0.05], ['tish', 0.04]]
          : [['tb', 0.05], ['graf', 0.04]];
    let acc = 0;
    for (const [id, p] of opts as [string, number][]) { acc += p; if (roll < acc) return (counts[id] ?? 0) < (LIMIT[id] ?? 9) ? id : null; }
    return null;
  };
  for (const w of l.walls) {
    if (w.kind !== 'wall') continue;
    const horiz = w.w >= w.d, len = horiz ? w.w : w.d;
    if (len < 1.6) continue;
    const zone = zoneOf(l, w.x, w.z);
    for (const side of [1, -1]) {
      const id = pick(zone);
      if (!id) continue;
      const slot = S[id] as Slot;
      if (slot.w > len - 0.5) continue;
      const nx = horiz ? 0 : side, nz = horiz ? side : 0, yaw = Math.atan2(nx, nz);
      const along = (r() * 2 - 1) * Math.max(0, len / 2 - slot.w / 2 - 0.3);
      const fx = horiz ? w.x + along : w.x + nx * (w.w / 2 + 0.004), fz = horiz ? w.z + nz * (w.d / 2 + 0.004) : w.z + along;
      // грань видима по всій ширині й ніщо не заважає
      const ax = horiz ? 1 : 0, az = horiz ? 0 : 1, hw = slot.w / 2 + 0.05;
      if ([-hw, 0, hw].some((o) => inWall(l, fx + ax * o + nx * 0.3, fz + az * o + nz * 0.3, 0.05))) continue;
      if (others.some((d) => Math.hypot(d.x - fx, d.z - fz) < hw + (d.t === 'door' ? 0.75 : 0.25))) continue;
      if (placed.some((p) => Math.hypot(p.x - fx, p.z - fz) < hw + p.w / 2 + 0.35)) continue;
      const y = id === 'slava' ? H - 0.42 : id === 'tish' ? 1.95 : id === 'graf' ? 1.45 : 1.5;
      put(id, fx, y, fz, yaw);
      boards.push({ id, x: fx + nx * 0.02, y, z: fz + nz * 0.02, yaw });
    }
  }

  // --- «Уходя, гасите свет» над частиною вимикачів
  for (const d of decor) {
    if (d.t !== 'switch' || r() > 0.4) continue;
    put('svet', d.x + Math.sin(d.yaw) * 0.006, d.y + 0.16, d.z + Math.cos(d.yaw) * 0.006, d.yaw);
  }

  // --- таблички біля дверей (на стіні поруч із рамою), подекуди «Посторонним вход воспрещён»
  let k = 0;
  for (const d of decor) {
    if (d.t !== 'door' || r() > 0.7) continue;
    const horiz = Math.abs(Math.sin(d.yaw)) < 0.5;
    const ax = horiz ? 1 : 0, az = horiz ? 0 : 1, nx = horiz ? 0 : 1, nz = horiz ? 1 : 0;
    for (const s of r() < 0.5 ? [1, -1] : [-1, 1]) {
      const off = d.w / 2 + 0.24, along = r() < 0.5 ? off : -off;
      const fx = d.x + ax * along + nx * s * (T / 2 + 0.004), fz = d.z + az * along + nz * s * (T / 2 + 0.004);
      // за табличкою — стіна, перед нею — вільно
      if (!inWall(l, fx - nx * s * 0.03, fz - nz * s * 0.03) || inWall(l, fx + nx * s * 0.3, fz + nz * s * 0.3, 0.05)) continue;
      put(`kab${k++ % PLAQUES.length}`, fx, 1.62, fz, Math.atan2(nx * s, nz * s));
      if (r() < 0.25) {
        const bx = d.x - ax * along + nx * s * (T / 2 + 0.004), bz = d.z - az * along + nz * s * (T / 2 + 0.004);
        if (inWall(l, bx - nx * s * 0.03, bz - nz * s * 0.03) && !inWall(l, bx + nx * s * 0.3, bz + nz * s * 0.3, 0.05)) put('post', bx, 1.5, bz, Math.atan2(nx * s, nz * s));
      }
      break;
    }
  }

  // --- рупори гучного зв'язку: у коридорах і залах, під стелею, рідко
  for (const w of l.walls) {
    if (w.kind !== 'wall' || speakers.length >= 12) continue;
    const horiz = w.w >= w.d, len = horiz ? w.w : w.d, zone = zoneOf(l, w.x, w.z);
    if (len < 2.4 || (zone !== 'corridors' && zone !== 'hall') || r() > 0.1) continue;
    const side = r() < 0.5 ? 1 : -1, nx = horiz ? 0 : side, nz = horiz ? side : 0;
    const along = (r() * 2 - 1) * (len / 2 - 0.6);
    const fx = horiz ? w.x + along : w.x + nx * (w.w / 2), fz = horiz ? w.z + nz * (w.d / 2) : w.z + along;
    if (inWall(l, fx + nx * 0.4, fz + nz * 0.4, 0.05) || speakers.some((s) => Math.hypot(s.x - fx, s.z - fz) < 9)) continue;
    // рупор дивиться вздовж стіни (уздовж коридору)
    const yaw = Math.atan2(nx, nz) + (r() < 0.5 ? 0.9 : -0.9);
    q.setFromAxisAngle(up, yaw);
    m.compose(new THREE.Vector3(fx, H - 0.38, fz), q, one);
    horns.push(hornGeometry(m, probeAt(l.lights, fx, fz)));
    speakers.push({ x: fx + nx * 0.3, y: H - 0.45, z: fz + nz * 0.3 });
  }

  const group = new THREE.Group();
  group.name = 'nii-details';
  const E = attribute('lightE', 'float') as unknown as THREE.Node<'float'>;
  if (geos.length) {
    const mat = probeLit(new THREE.MeshStandardMaterial({ map: atlas.texture, color: 0xe2ddd2, roughness: 0.78 }), E);
    mat.polygonOffset = true; mat.polygonOffsetFactor = -1;
    const mesh = new THREE.Mesh(mergeGeometries(geos) as THREE.BufferGeometry, mat);
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  if (horns.length) {
    const metal = probeLit(new THREE.MeshStandardMaterial({ color: 0x6d7466, roughness: 0.55, metalness: 0.35, side: THREE.DoubleSide }), E);
    const mesh = new THREE.Mesh(mergeGeometries(horns) as THREE.BufferGeometry, metal);
    mesh.castShadow = true; mesh.receiveShadow = true;
    group.add(mesh);
  }
  geos.forEach((g) => g.dispose()); horns.forEach((g) => g.dispose());
  return { group, speakers, boards };
}
