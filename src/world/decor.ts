// Деталі будівлі для модульного кіту: де стоять дверні рами, розетки, вимикачі, решітки, щитки й вирвані плити стелі.
// Детерміновано з планування (те саме зерно) — список іде і в Blender (геометрія + запікання світла), і в гру (взаємодія, звук).
// Правила — «як у справжній будівлі»: розетки низько біля кутів, вимикачі біля прорізів на 1.5 м, решітки під стелею,
// щитки в коридорах. Рідкісні «помилки» (розетка на 2 м, решітка біля підлоги) — тихі аномалії Закулисья.
import { rng, irange } from '../core/rng';
import type { Layout, WallBox } from './layout';

export type DecorKind = 'door' | 'outlet' | 'switch' | 'vent' | 'panel' | 'hole';

export interface Decor {
  t: DecorKind;
  /** Точка на поверхні (центр деталі), м. */
  x: number; y: number; z: number;
  /** Кут нормалі поверхні навколо Y (0 = +Z). Для дверей: 0 — проріз у стіні вздовж X, π/2 — вздовж Z. */
  yaw: number;
  /** Ширина прорізу (двері) або розмір деталі, м. */
  w: number;
}

export const DOOR_H = 2.05;

/** Чи точка всередині будь-якої стіни/колони (з запасом r). */
function inWall(l: Layout, x: number, z: number, r = 0): boolean {
  return l.walls.some((w) => Math.abs(x - w.x) < w.w / 2 + r && Math.abs(z - w.z) < w.d / 2 + r);
}

function zoneOf(l: Layout, x: number, z: number): string {
  const zw = Math.floor(l.cols / 3) * l.cell, zh = Math.floor(l.rows / 3) * l.cell;
  return l.zones[Math.min(2, Math.floor(x / zw)) + 3 * Math.min(2, Math.floor(z / zh))] ?? 'rooms';
}

export function decorate(l: Layout): Decor[] {
  const r = rng(l.seed ^ 0x5eed);
  const out: Decor[] = [];
  const T = l.wallThickness, H = l.height;
  const walls = l.walls.filter((w) => w.kind === 'wall');

  // --- дверні прорізи: два співвісні відрізки стіни з проміжком в одну клітинку → рама з перемичкою
  const lines = new Map<string, WallBox[]>();
  for (const w of walls) {
    const key = w.w >= w.d ? `h${w.z.toFixed(3)}` : `v${w.x.toFixed(3)}`;
    const arr = lines.get(key) ?? [];
    arr.push(w);
    lines.set(key, arr);
  }
  for (const [key, arr] of lines) {
    const horiz = key[0] === 'h';
    arr.sort((a, b) => (horiz ? a.x - b.x : a.z - b.z));
    for (let i = 0; i < arr.length - 1; i++) {
      const a = arr[i] as WallBox, b = arr[i + 1] as WallBox;
      const end = horiz ? a.x + a.w / 2 : a.z + a.d / 2, start = horiz ? b.x - b.w / 2 : b.z - b.d / 2;
      const gap = start - end;
      if (Math.abs(gap - (l.cell - T)) > 0.02) continue; // лише вузькі прорізи в одну клітинку
      const cx = horiz ? (end + start) / 2 : a.x, cz = horiz ? a.z : (end + start) / 2;
      if (zoneOf(l, cx, cz) === 'hall' || r() < 0.12) continue; // у залах і подекуди — просто отвір
      out.push({ t: 'door', x: cx, y: 0, z: cz, yaw: horiz ? 0 : Math.PI / 2, w: gap });
    }
  }

  // --- деталі на гранях стін
  const doors = out.slice();
  const nearDoor = (x: number, z: number, d: number) => doors.some((o) => Math.hypot(o.x - x, o.z - z) < d);
  const used: [number, number, number][] = [];
  const free = (x: number, y: number, z: number, d: number) => !used.some(([ux, uy, uz]) => Math.hypot(ux - x, uy - y, uz - z) < d);
  for (const w of walls) {
    const horiz = w.w >= w.d, len = horiz ? w.w : w.d;
    if (len < 1.4) continue;
    const half = len / 2 - 0.35;
    const zone = zoneOf(l, w.x, w.z);
    for (const side of [1, -1]) {
      const nx = horiz ? 0 : side, nz = horiz ? side : 0;
      const yaw = Math.atan2(nx, nz);
      const place = (t: Decor['t'], along: number, y: number, size: number): boolean => {
        const px = horiz ? w.x + along : w.x + nx * (w.w / 2), pz = horiz ? w.z + nz * (w.d / 2) : w.z + along;
        // грань видима: попереду вільно (немає перпендикулярної стіни впритул), не поруч з іншою деталлю
        if (inWall(l, px + nx * 0.25, pz + nz * 0.25, 0.06)) return false;
        if (!free(px, y, pz, 0.9)) return false;
        out.push({ t, x: px, y, z: pz, yaw, w: size });
        used.push([px, y, pz]);
        return true;
      };
      if (r() < 0.38) place('outlet', (r() < 0.5 ? -half : half) * (0.85 + r() * 0.1), r() < 0.03 ? 2.0 : 0.3, 0.08);
      const s = r() < 0.5 ? -half : half;
      const ex = horiz ? w.x + s : w.x, ez = horiz ? w.z : w.z + s;
      if (nearDoor(ex, ez, 1.2) && r() < 0.8) place('switch', s, 1.5, 0.08);
      if (len > 2.2 && r() < 0.16) place('vent', (r() * 2 - 1) * Math.max(0, half - 0.3), r() < 0.08 ? 0.35 : H - 0.3, r() < 0.3 ? 0.6 : 0.36);
      if (zone === 'corridors' && len > 2.0 && r() < 0.1) place('panel', (r() * 2 - 1) * Math.max(0, half - 0.4), 1.45, 0.42);
    }
  }

  // --- вирвані плити стелі (темна порожнина над ними); частіше в темних зонах
  const nx = Math.floor((l.cols * l.cell) / 0.6), nz = Math.floor((l.rows * l.cell) / 0.6);
  for (let i = 0; i < l.cols * l.rows * 0.07; i++) {
    const tx = irange(r, 0, nx - 1), tz = irange(r, 1, nz - 1);
    const x = (tx + 0.5) * 0.6, z = (tz + 0.5) * 0.6 - 0.3; // плити зсунуті на 0.3 по Z (як у шейдері стелі)
    if (inWall(l, x, z, 0.36)) continue;
    if (l.lights.some((p) => Math.abs(p.x - x) < p.w / 2 + 0.32 && Math.abs(p.z - z) < p.d / 2 + 0.32)) continue;
    if (zoneOf(l, x, z) !== 'dark' && r() < 0.6) continue;
    out.push({ t: 'hole', x, y: H, z, yaw: 0, w: 0.6 });
  }
  return out;
}
