// Обстановка «Бесконечного НИИ» (рівень 0): кабінети перестають бути порожніми коробками.
// • кабінети: робочі місця — металевий стіл спиною до стіни, відсунутий стілець, на столі — лампа або папери;
//   шафи з шухлядами, книжкові шафи, стелажі;
// • зали: «ленинская комната» / нарадча — ряди учнівських парт перед дошкою;
// • коридори: стільці під стіною, як біля кабінету в очікуванні прийому;
// • темні відділи: перекинуті стільці й відсунуті парти — тут щось сталося.
// Справжні CC0-моделі Poly Haven (див. CREDITS.md). Однакові речі однієї зони рівня — один InstancedMesh на
// кожну частину моделі (зона відсікається камерою цілком), освітленість кожної речі — атрибут інстанса.
import * as THREE from 'three/webgpu';
import { instancedBufferAttribute } from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Assets } from '../assets/loader';
import type { Physics } from '../physics/physics';
import { G } from '../physics/physics';
import { KNOCKABLE, instanceView, instanceLight, type InstancePart } from '../physics/knock';
import { rng } from '../core/rng';
import type { Level } from './level0';
import { probeAt, probeLit } from './materials';
import { wallRows, type Spot } from './dressing';
import { zoneOf } from './decor';

interface Place { m: THREE.Matrix4; E: number; zone: number; parts?: InstancePart[] }

/** Набір розстановок: модель → місця; build() робить інстанси й тіла зіткнень. */
class Batch {
  private readonly items = new Map<string, Place[]>();
  private readonly solid: { file: string; m: THREE.Matrix4 }[] = [];
  constructor(private readonly lvl: Level) {}

  add(file: string, x: number, z: number, yaw: number, o: { y?: number; scale?: number; tilt?: THREE.Euler; collide?: boolean } = {}): void {
    const L = this.lvl.layout;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0));
    if (o.tilt) q.multiply(new THREE.Quaternion().setFromEuler(o.tilt));
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, o.y ?? 0, z), q, new THREE.Vector3().setScalar(o.scale ?? 1));
    const zw = Math.floor(L.cols / 3) * L.cell, zh = Math.floor(L.rows / 3) * L.cell;
    const zone = Math.min(2, Math.floor(x / zw)) + 3 * Math.min(2, Math.floor(z / zh));
    const list = this.items.get(file) ?? [];
    // стільці тощо — не нерухомі коробки, а речі, які можна зачепити й перекинути (тіло — у build)
    const knock = o.collide !== false && !!KNOCKABLE[file];
    list.push({ m, E: probeAt(L.lights, x, z), zone, ...(knock ? { parts: [] } : {}) });
    this.items.set(file, list);
    if (o.collide !== false && !knock) this.solid.push({ file, m });
  }

  /** Габарити моделі в її власних координатах. */
  private readonly boxes = new Map<string, THREE.Box3>();
  async box(assets: Assets, file: string): Promise<THREE.Box3> {
    let b = this.boxes.get(file);
    if (!b) {
      const s = (await assets.model(`assets/models/${file}.glb`)).scene;
      s.updateMatrixWorld(true);
      b = new THREE.Box3().setFromObject(s);
      this.boxes.set(file, b);
    }
    return b;
  }

  async build(assets: Assets, physics: Physics, scene: THREE.Scene): Promise<THREE.Group> {
    const group = new THREE.Group();
    group.name = 'nii-furniture';
    for (const [file, places] of this.items) {
      const root = (await assets.model(`assets/models/${file}.glb`)).scene;
      root.updateMatrixWorld(true);
      const parts = partsByMaterial(root);
      // дрібниця (папери, лампа) тіней не кидає: тінь від неї не видно, а прохід тіні — це ще один виклик малювання
      const shadow = !SMALL.has(file);
      for (let zone = 0; zone < 9; zone++) {
        const ps = places.filter((p) => p.zone === zone);
        if (!ps.length) continue;
        const E = new THREE.InstancedBufferAttribute(new Float32Array(ps.map((p) => p.E)), 1);
        const eNode = instancedBufferAttribute(E) as unknown as THREE.Node<'float'>;
        for (const { geometry, material } of parts) {
          const im = new THREE.InstancedMesh(geometry, probeLit(material, eNode), ps.length);
          ps.forEach((p, i) => { im.setMatrixAt(i, p.m); p.parts?.push({ im, i, light: E }); });
          im.castShadow = shadow; im.receiveShadow = true;
          im.computeBoundingSphere();
          group.add(im);
        }
      }
    }
    scene.add(group);
    for (const [file, places] of this.items) {
      const k = KNOCKABLE[file];
      if (!k) continue;
      if (!physics.knock) { for (const p of places) if (p.parts) this.solid.push({ file, m: p.m }); continue; }
      const model = (await assets.model(`assets/models/${file}.glb`)).scene;
      for (const p of places) if (p.parts) physics.knock.add(file, instanceView(p.parts), p.m, model, p.parts.map((x) => x.im), instanceLight(p.parts));
    }
    // тіла зіткнень: коробка за габаритами (після повороту — осьова обгортка); книжкова шафа — полиці, з яких можна
    // зняти книги (суцільна коробка виштовхнула б їх)
    for (const s of this.solid) {
      if (s.file === 'bookshelf') { shelfColliders(physics, await this.box(assets, s.file), s.m); continue; }
      const bb = (await this.box(assets, s.file)).clone().applyMatrix4(s.m);
      const c = bb.getCenter(new THREE.Vector3()), sz = bb.getSize(new THREE.Vector3());
      physics.addBox(c.x, c.y, c.z, Math.max(0.05, sz.x / 2 - 0.03), sz.y / 2, Math.max(0.05, sz.z / 2 - 0.03), 0, G.PROP);
    }
    return group;
  }
}

const SMALL = new Set(['notepads', 'desk-lamp', 'books']);

/** Книжкова шафа (перед — +Z моделі): задня стінка, боковини, полиці SHELVES і кришка — окремі нерухомі коробки. */
function shelfColliders(physics: Physics, b: THREE.Box3, m: THREE.Matrix4): void {
  const yaw = new THREE.Euler().setFromRotationMatrix(m).y, p = new THREE.Vector3();
  const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number) => {
    p.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2).applyMatrix4(m);
    physics.addBox(p.x, p.y, p.z, (x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2, yaw, G.PROP);
  };
  const { min: a, max: c } = b, t = 0.02;
  box(a.x, c.x, a.y, c.y, a.z, a.z + t); // задня стінка
  box(a.x, a.x + t, a.y, c.y, a.z, c.z); box(c.x - t, c.x, a.y, c.y, a.z, c.z); // боковини
  box(a.x, c.x, c.y - t, c.y, a.z, c.z); // кришка
  for (const y of SHELVES) box(a.x + t, c.x - t, Math.max(a.y, y - 0.025), y, a.z, c.z);
}

/**
 * Частини моделі, зведені за матеріалом: у Poly Haven стіл — 9 окремих сіток з одним матеріалом, а кожна сітка
 * в InstancedMesh — окремий виклик малювання (ще й у кожній зоні й у проході тіні). Злиті — 1–3 на модель.
 */
function partsByMaterial(root: THREE.Object3D): { geometry: THREE.BufferGeometry; material: THREE.Material }[] {
  const by = new Map<THREE.Material, THREE.BufferGeometry[]>();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const mat = m.material as THREE.Material;
    // моделі квантовані (KHR_mesh_quantization: цілі координати + масштаб у вузлі) — спершу у float, потім у світ вузла
    const g = new THREE.BufferGeometry();
    for (const [k, at] of Object.entries(m.geometry.attributes)) {
      const n = at.count, sz = at.itemSize, f = new Float32Array(n * sz);
      for (let i = 0; i < n; i++) for (let c = 0; c < sz; c++) f[i * sz + c] = at.getComponent(i, c);
      g.setAttribute(k, new THREE.BufferAttribute(f, sz));
    }
    if (m.geometry.index) g.setIndex(Array.from(m.geometry.index.array));
    g.applyMatrix4(m.matrixWorld);
    by.set(mat, [...(by.get(mat) ?? []), g]);
  });
  const out: { geometry: THREE.BufferGeometry; material: THREE.Material }[] = [];
  for (const [material, gs] of by) {
    if (gs.length === 1) { out.push({ geometry: gs[0] as THREE.BufferGeometry, material }); continue; }
    // спільні атрибути; індекси або в усіх, або в жодної
    const keys = Object.keys((gs[0] as THREE.BufferGeometry).attributes).filter((k) => gs.every((g) => g.getAttribute(k)));
    const indexed = gs.every((g) => g.index);
    const ready = gs.map((g) => {
      const n = indexed ? g : g.index ? g.toNonIndexed() : g;
      for (const k of Object.keys(n.attributes)) if (!keys.includes(k)) n.deleteAttribute(k);
      n.morphAttributes = {};
      return n;
    });
    const merged = mergeGeometries(ready, false);
    if (merged) out.push({ geometry: merged, material });
    else for (const g of gs) out.push({ geometry: g, material }); // несумісні — як були
  }
  return out;
}

/** Точка в системі речі (вперед — від стіни) → світові координати. */
const at = (s: Spot, side: number, fwd: number) => ({ x: s.x + Math.cos(s.yaw) * side + Math.sin(s.yaw) * fwd, z: s.z - Math.sin(s.yaw) * side + Math.cos(s.yaw) * fwd });

/** Верх полиць книжкової шафи (виміряно з моделі wooden_bookshelf_worn), м. */
const SHELVES = [0.11, 0.38, 0.66, 0.95, 1.26, 1.65];
/**
 * Книжкова шафа: на полицях томи енциклопедії (набір 0.55 м, лівий край у x = -0.02) — де два, де один,
 * де порожньо; ряд трохи зсунутий і не завжди рівний.
 */
function fillShelf(b: Batch, r: () => number, s: Spot): void {
  // нижня й верхня полиці порожні: їх майже не видно, а кожен набір — 4.5 тис. трикутників
  for (const y of SHELVES.slice(1, 5)) {
    const k = r();
    if (k < 0.45) continue;
    const sets = k < 0.88 ? [(r() - 0.5) * 0.6] : [-0.33 + (r() - 0.5) * 0.06, 0.31 + (r() - 0.5) * 0.06];
    for (const c of sets) {
      const p = at(s, c - 0.257, 0.02 + (r() - 0.5) * 0.04);
      b.add('books', p.x, p.z, s.yaw + (r() - 0.5) * 0.05, { y: y + 0.004 });
    }
  }
}

export async function furnishNii(assets: Assets, physics: Physics, lvl: Level, taken: { x: number; z: number }[]): Promise<(Spot & { kind: string })[]> {
  const L = lvl.layout, r = rng(L.seed ^ 0x0ff1ce);
  const shown: (Spot & { kind: string })[] = [];
  const sp = lvl.seam.group.position, ap = lvl.arrival.group.position;
  const avoid = [...taken.map((t) => ({ ...t, r: 1.7 })), { x: sp.x, z: sp.z, r: 3.2 }, { x: ap.x, z: ap.z, r: 3.2 }, { x: L.spawn.x, z: L.spawn.z, r: 3.5 },
    ...lvl.doors.list.map((d) => ({ x: d.cx, z: d.cz, r: 1.5 }))];
  const zone = (k: string) => (x: number, z: number) => zoneOf(L, x, z) === k;
  const b = new Batch(lvl);
  const deskTop = (await b.box(assets, 'desk')).max.y;

  // кабінети: робочі місця (стіл 2×0.95 м, стілець відсунутий під різними кутами, на столі — лампа чи папери)
  for (const row of wallRows(lvl, r, 16, 1 + (r() < 0.35 ? 1 : 0), 2.0, 0.95, 0.5, avoid, { where: zone('rooms') })) {
    shown.push({ ...(row[0] as Spot), kind: 'desk' });
    for (const s of row) {
      b.add('desk', s.x, s.z, s.yaw);
      const c = at(s, (r() - 0.5) * 0.6, 0.75 + r() * 0.35);
      b.add('chair', c.x, c.z, s.yaw + Math.PI + (r() - 0.5) * 0.9);
      const k = r();
      if (k < 0.45) { const p = at(s, -0.65, -0.12); b.add('desk-lamp', p.x, p.z, s.yaw + Math.PI * 0.85 + (r() - 0.5) * 0.4, { y: deskTop + 0.002 }); }
      if (k > 0.3) { const p = at(s, 0.35 + r() * 0.2, 0.05); b.add('notepads', p.x, p.z, s.yaw + (r() - 0.5) * 0.5, { y: deskTop + 0.004, scale: 0.42 }); }
    }
  }
  // кабінети й архіви: шафи вздовж стін (по 1–3 поруч)
  const cabs: [string, number, number][] = [['drawer-cabinet', 1.16, 0.5], ['bookshelf', 1.4, 0.6], ['vintage-cabinet', 2.05, 0.68]];
  for (let k = 0; k < 3; k++) {
    const [file, w, d] = cabs[k] as [string, number, number];
    for (const row of wallRows(lvl, r, k === 2 ? 3 : 7, k === 2 ? 1 : 1 + Math.floor(r() * 3), w, d, 0.04, avoid, { where: (x, z) => zoneOf(L, x, z) !== 'hall' })) {
      shown.push({ ...(row[0] as Spot), kind: file });
      for (const s of row) {
        b.add(file, s.x, s.z, s.yaw);
        if (file === 'bookshelf') fillShelf(b, r, s);
      }
    }
  }
  // архів у коридорах: металеві стелажі (модель у сантиметрах)
  for (const row of wallRows(lvl, r, 4, 1 + Math.floor(r() * 2), 1.12, 0.52, 0.05, avoid, { where: zone('corridors') })) {
    shown.push({ ...(row[0] as Spot), kind: 'shelves' });
    for (const s of row) b.add('steel-shelves', s.x, s.z, s.yaw, { scale: 0.1 });
  }
  // коридори: стільці під стіною — чекали прийому
  for (const row of wallRows(lvl, r, 8, 2 + Math.floor(r() * 2), 0.6, 0.6, 0.12, avoid, { where: zone('corridors') })) {
    shown.push({ ...(row[0] as Spot), kind: 'waiting' });
    for (const s of row) b.add('chair', s.x, s.z, s.yaw + Math.PI + (r() - 0.5) * 0.15);
  }
  // зали: дошка під стіною, перед нею ряди парт зі стільцями (3 ряди по 3)
  for (const row of wallRows(lvl, r, 3, 1, 1.0, 0.8, 0, avoid, { where: zone('hall') })) {
    const s = row[0] as Spot;
    const desks: { x: number; z: number }[] = [];
    for (let i = 0; i < 3; i++) for (let j = -1; j <= 1; j++) desks.push(at(s, j * 1.25, 1.9 + i * 1.3));
    const free = desks.filter((p) => !L.walls.some((w) => Math.abs(p.x - w.x) < w.w / 2 + 0.75 && Math.abs(p.z - w.z) < w.d / 2 + 0.75))
      .filter((p) => !avoid.some((a) => Math.hypot(a.x - p.x, a.z - p.z) < a.r));
    if (free.length < 5) continue;
    shown.push({ ...s, kind: 'lecture' });
    b.add('chalkboard', s.x, s.z, s.yaw);
    for (const p of free) {
      // парта дивиться на дошку; стілець за партою (деякі відсунуті)
      b.add('school-desk', p.x, p.z, s.yaw + Math.PI + (r() - 0.5) * 0.12);
      const c = { x: p.x + Math.sin(s.yaw) * (0.55 + r() * 0.2), z: p.z + Math.cos(s.yaw) * (0.55 + r() * 0.2) };
      b.add('chair', c.x, c.z, s.yaw + (r() - 0.5) * 0.5);
      avoid.push({ x: p.x, z: p.z, r: 1.0 });
    }
  }
  // темні відділи: перекинуті стільці посеред кімнат і відсунута від стіни шафа
  for (let k = 0, n = 0; k < 400 && n < 14; k++) {
    const x = 1.5 + r() * (L.cols * L.cell - 3), z = 1.5 + r() * (L.rows * L.cell - 3);
    if (zoneOf(L, x, z) !== 'dark') continue;
    if (L.walls.some((w) => Math.abs(x - w.x) < w.w / 2 + 0.6 && Math.abs(z - w.z) < w.d / 2 + 0.6)) continue;
    if (avoid.some((a) => Math.hypot(a.x - x, a.z - z) < a.r)) continue;
    // на боці або на спинці
    const back = r() < 0.4;
    b.add('chair', x, z, r() * 6.28, { tilt: back ? new THREE.Euler(-Math.PI / 2, 0, 0) : new THREE.Euler(0, 0, Math.PI / 2), y: back ? 0.34 : 0.28 });
    avoid.push({ x, z, r: 1.2 });
    n++;
  }
  await b.build(assets, physics, lvl.scene);
  physics.step();
  return shown;
}
