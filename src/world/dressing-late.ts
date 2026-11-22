// Обстановка рівнів 3–4 (Poly Haven, CC0), по кімнатах планування:
// • дитсадок: у спальнях — ряди дитячих залізних ліжечок (у темряві), в ігрових — низькі столики зі стільчиками,
//   шафа з іграшками, м'ячі й гумові каченята на підлозі; у роздягальнях — шафки; у залі — лавки вздовж стін;
// • басейн: лавки вздовж бортиків, рятувальні кола на стінах, годинник над чашею, таблички «мокрий пол», відра.
import type { Assets } from '../assets/loader';
import type { Physics } from '../physics/physics';
import type { Level } from './level0';
import type { RoomKind } from './layout';
import { wallRows, put, type Spot } from './dressing';

type Avoid = { x: number; z: number; r: number }[];

export async function dressLate(assets: Assets, physics: Physics, lvl: Level, r: () => number, avoid: Avoid, shown: (Spot & { kind: string })[]): Promise<void> {
  const L = lvl.layout, c = L.cell;
  const kindAt = (x: number, z: number): RoomKind | null =>
    L.rooms.find((q) => x >= q.x0 * c + 0.2 && x <= q.x1 * c - 0.2 && z >= q.y0 * c + 0.2 && z <= q.y1 * c - 0.2)?.kind ?? null;
  const inKind = (k: RoomKind | null) => (x: number, z: number) => kindAt(x, z) === k;
  const count = (k: RoomKind) => L.rooms.filter((q) => q.kind === k).length;
  const along = (s: Spot, d: number): Spot => ({ x: s.x + Math.cos(s.yaw) * d, z: s.z - Math.sin(s.yaw) * d, yaw: s.yaw });
  const out = (s: Spot, d: number): Spot => ({ x: s.x + Math.sin(s.yaw) * d, z: s.z + Math.cos(s.yaw) * d, yaw: s.yaw });

  if (lvl.id === 3) {
    // спальні: ліжечка рядами (залізні ліжка, зменшені до дитячих), темрява — їх видно лише ліхтариком
    for (const row of wallRows(lvl, r, count('sleep') * 2, 3 + Math.floor(r() * 2), 0.64, 1.3, 0.4, avoid, { where: inKind('sleep'), dark: true })) {
      shown.push({ ...(row[0] as Spot), kind: 'cots' });
      for (const s of row) await put(assets, physics, lvl, 'bed', s, 0, 0, true, 0.64);
    }
    // ігрові: низький столик і два стільчики
    for (const row of wallRows(lvl, r, count('play'), 2, 1.1, 1.6, 0.9, avoid, { where: inKind('play'), dark: true })) {
      shown.push({ ...(row[0] as Spot), kind: 'tables' });
      for (const s of row) {
        const t = out(s, 0.2);
        await put(assets, physics, lvl, 'painted-wooden-table', t, 0, 0, true, 0.62);
        for (const side of [-1, 1]) if (r() < 0.85) await put(assets, physics, lvl, 'painted-wooden-chair-01', along(out(t, 0.05), side * 0.62), side * Math.PI / 2 + (r() - 0.5) * 0.5, 0, true, 0.62);
      }
    }
    // ігрові: шафа з іграшками; на підлозі — м'яч і гумові каченята
    for (const row of wallRows(lvl, r, count('play'), 1, 1.0, 0.5, 0.1, avoid, { where: inKind('play'), dark: true })) {
      const s = row[0] as Spot;
      shown.push({ ...s, kind: 'toys' });
      const bb = await put(assets, physics, lvl, 'cabinet', s);
      await put(assets, physics, lvl, 'rubber-duck-toy', { x: s.x, z: s.z, yaw: s.yaw + r() }, 0, bb.max.y, false, 1.4);
      const f = out(s, 1.2 + r()), g = along(f, (r() - 0.5) * 2);
      await put(assets, physics, lvl, r() < 0.5 ? 'dirty-football' : 'rubber-duck-toy', { ...g, yaw: r() * 6 }, 0, 0, false, r() < 0.5 ? 0.75 : 1.6);
    }
    // роздягальні: шафки рядами
    for (const row of wallRows(lvl, r, count('cloak') * 2, 4, 0.5, 0.5, 0.05, avoid, { where: inKind('cloak'), dark: true })) {
      shown.push({ ...(row[0] as Spot), kind: 'lockers' });
      for (const s of row) await put(assets, physics, lvl, 'locker', s, 0, 0, true, 0.82);
    }
    // музичний зал і кухня: лавки вздовж стін, відро
    for (const row of wallRows(lvl, r, 4, 2, 1.6, 0.45, 0.6, avoid, { where: (x, z) => kindAt(x, z) === 'hall' })) {
      shown.push({ ...(row[0] as Spot), kind: 'benches' });
      for (const s of row) await put(assets, physics, lvl, 'painted-wooden-bench', s, Math.PI / 2);
    }
    for (const row of wallRows(lvl, r, 2, 1, 0.4, 0.4, 0.1, avoid, { where: (x, z) => kindAt(x, z) === 'kitchen', dark: true })) await put(assets, physics, lvl, 'wooden-bucket-01', row[0] as Spot);
  } else {
    // басейн: лавки й табличка «мокрий пол» уздовж стін залів (навколо чаш), відра біля стін
    const hall = inKind('pool');
    for (const row of wallRows(lvl, r, 8, 2, 1.6, 0.45, 0.8, avoid, { where: hall })) {
      shown.push({ ...(row[0] as Spot), kind: 'benches' });
      for (const s of row) await put(assets, physics, lvl, 'painted-wooden-bench', s, Math.PI / 2);
    }
    // рятувальні кола — на стінах залів, на висоті 1.4 м (без зіткнень: висять)
    for (const row of wallRows(lvl, r, 5, 1, 0.8, 0.12, 0.1, avoid, { where: hall })) {
      const s = row[0] as Spot;
      shown.push({ ...s, kind: 'lifebuoy' });
      await put(assets, physics, lvl, 'lifebuoy', out(s, -0.02), 0, 1.3, false);
    }
    // годинник над найбільшою чашею — на стіні, високо
    for (const row of wallRows(lvl, r, 1, 1, 0.6, 0.1, 0.1, avoid, { where: hall })) await put(assets, physics, lvl, 'wall-clock', row[0] as Spot, 0, 3.1, false, 1.6);
    for (const row of wallRows(lvl, r, 3, 1, 0.5, 0.4, 0.1, avoid, { where: hall })) await put(assets, physics, lvl, 'wooden-bucket-01', row[0] as Spot, r());
    // кімнати поза залами (роздягальні, душові): шафки
    for (const row of wallRows(lvl, r, 5, 4, 0.5, 0.5, 0.05, avoid, { where: (x, z) => kindAt(x, z) === null })) {
      shown.push({ ...(row[0] as Spot), kind: 'lockers' });
      for (const s of row) await put(assets, physics, lvl, 'locker', s);
    }
  }
}
