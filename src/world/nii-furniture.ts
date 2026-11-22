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
import type { Assets } from '../assets/loader';
import type { Physics } from '../physics/physics';
import { G } from '../physics/physics';
import { rng } from '../core/rng';
import type { Level } from './level0';
import { probeAt, probeLit } from './materials';
import { wallRows, type Spot } from './dressing';
import { zoneOf } from './decor';

interface Place { m: THREE.Matrix4; E: number; zone: number }

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
    list.push({ m, E: probeAt(L.lights, x, z), zone });
    this.items.set(file, list);
    if (o.collide !== false) this.solid.push({ file, m });
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
      const meshes: THREE.Mesh[] = [];
      root.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
      for (let zone = 0; zone < 9; zone++) {
        const ps = places.filter((p) => p.zone === zone);
        if (!ps.length) continue;
        const E = new THREE.InstancedBufferAttribute(new Float32Array(ps.map((p) => p.E)), 1);
        const eNode = instancedBufferAttribute(E) as unknown as THREE.Node<'float'>;
        for (const mesh of meshes) {
          const mat = probeLit(mesh.material as THREE.Material, eNode);
          const im = new THREE.InstancedMesh(mesh.geometry, mat, ps.length);
          const t = new THREE.Matrix4();
          ps.forEach((p, i) => im.setMatrixAt(i, t.multiplyMatrices(p.m, mesh.matrixWorld)));
          im.castShadow = true; im.receiveShadow = true;
          im.computeBoundingSphere();
          group.add(im);
        }
      }
    }
    scene.add(group);
    // тіла зіткнень: коробка за габаритами (після повороту — осьова обгортка)
    for (const s of this.solid) {
      const bb = (await this.box(assets, s.file)).clone().applyMatrix4(s.m);
      const c = bb.getCenter(new THREE.Vector3()), sz = bb.getSize(new THREE.Vector3());
      physics.addBox(c.x, c.y, c.z, Math.max(0.05, sz.x / 2 - 0.03), sz.y / 2, Math.max(0.05, sz.z / 2 - 0.03), 0, G.PROP);
    }
    return group;
  }
}

/** Точка в системі речі (вперед — від стіни) → світові координати. */
const at = (s: Spot, side: number, fwd: number) => ({ x: s.x + Math.cos(s.yaw) * side + Math.sin(s.yaw) * fwd, z: s.z - Math.sin(s.yaw) * side + Math.cos(s.yaw) * fwd });

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
      if (k < 0.45) { const p = at(s, -0.65, -0.12); b.add('desk-lamp', p.x, p.z, s.yaw + Math.PI * 0.85 + (r() - 0.5) * 0.4, { y: deskTop, collide: false }); }
      if (k > 0.3) { const p = at(s, 0.35 + r() * 0.2, 0.05); b.add('notepads', p.x, p.z, s.yaw + (r() - 0.5) * 0.5, { y: deskTop + 0.002, scale: 0.42, collide: false }); }
    }
  }
  // кабінети й архіви: шафи вздовж стін (по 1–3 поруч)
  const cabs: [string, number, number][] = [['drawer-cabinet', 1.16, 0.5], ['bookshelf', 1.4, 0.6], ['vintage-cabinet', 2.05, 0.68]];
  for (let k = 0; k < 3; k++) {
    const [file, w, d] = cabs[k] as [string, number, number];
    for (const row of wallRows(lvl, r, k === 2 ? 3 : 7, k === 2 ? 1 : 1 + Math.floor(r() * 3), w, d, 0.04, avoid, { where: (x, z) => zoneOf(L, x, z) !== 'hall' })) {
      shown.push({ ...(row[0] as Spot), kind: file });
      for (const s of row) b.add(file, s.x, s.z, s.yaw);
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
