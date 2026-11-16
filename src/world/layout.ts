// Планування рівня на сітці клітинок: стіни лежать на ребрах клітинок, колони — у вузлах.
// Результат (Layout) — спільне джерело правди для гри (колізії, навмеш, предмети) і для Blender
// (геометрія + запікання світла). Тому генерація детермінована від зерна.
import { rng, irange, pick, type Rng } from '../core/rng';

export type ZoneStyle = 'rooms' | 'hall' | 'corridors' | 'dark';

export interface WallBox {
  /** Центр і розміри в метрах (w — уздовж X, d — уздовж Z). */
  x: number; z: number; w: number; d: number;
  kind: 'wall' | 'pillar' | 'outer';
}

export interface LightPanel {
  x: number; z: number; w: number; d: number;
  state: 'on' | 'off' | 'flicker';
}

export interface Spot { x: number; z: number; yaw: number }

export interface Layout {
  seed: number;
  cell: number;
  cols: number;
  rows: number;
  height: number;
  wallThickness: number;
  walls: WallBox[];
  lights: LightPanel[];
  zones: ZoneStyle[]; // по зонах 3×3, рядками
  spawn: Spot;
  exit: Spot & { /** клітинка біля «Шва» */ cx: number; cz: number };
  /** Важливі місця (документи, записки, події) за назвою. */
  points: Record<string, Spot>;
  /** Відстань (у клітинках) від старту до кожної клітинки; −1 — недосяжна. */
  dist: Int32Array;
}

export interface LayoutOptions {
  seed: number;
  cols?: number;
  rows?: number;
  cell?: number;
  height?: number;
  zones?: ZoneStyle[];
}

/** Ребра: h[y*cols+x] — стіна між (x,y) і (x,y+1); v[y*cols+x] — між (x,y) і (x+1,y). */
class EdgeGrid {
  readonly h: Uint8Array;
  readonly v: Uint8Array;
  constructor(readonly cols: number, readonly rows: number) {
    this.h = new Uint8Array(cols * rows);
    this.v = new Uint8Array(cols * rows);
  }
  setH(x: number, y: number, on: boolean) { if (x >= 0 && x < this.cols && y >= 0 && y < this.rows - 1) this.h[y * this.cols + x] = on ? 1 : 0; }
  setV(x: number, y: number, on: boolean) { if (x >= 0 && x < this.cols - 1 && y >= 0 && y < this.rows) this.v[y * this.cols + x] = on ? 1 : 0; }
  hasH(x: number, y: number) { return y < 0 || y >= this.rows - 1 ? true : this.h[y * this.cols + x] === 1; }
  hasV(x: number, y: number) { return x < 0 || x >= this.cols - 1 ? true : this.v[y * this.cols + x] === 1; }
  /** Сусіди клітинки, до яких можна пройти. */
  open(x: number, y: number): [number, number][] {
    const o: [number, number][] = [];
    if (x > 0 && !this.hasV(x - 1, y)) o.push([x - 1, y]);
    if (x < this.cols - 1 && !this.hasV(x, y)) o.push([x + 1, y]);
    if (y > 0 && !this.hasH(x, y - 1)) o.push([x, y - 1]);
    if (y < this.rows - 1 && !this.hasH(x, y)) o.push([x, y + 1]);
    return o;
  }
}

function bfs(g: EdgeGrid, sx: number, sy: number): Int32Array {
  const d = new Int32Array(g.cols * g.rows).fill(-1);
  const q: number[] = [sy * g.cols + sx];
  d[q[0] as number] = 0;
  for (let i = 0; i < q.length; i++) {
    const c = q[i] as number, x = c % g.cols, y = (c / g.cols) | 0;
    for (const [nx, ny] of g.open(x, y)) {
      const n = ny * g.cols + nx;
      if (d[n] === -1) { d[n] = (d[c] as number) + 1; q.push(n); }
    }
  }
  return d;
}

/** Кімнати рекурсивним поділом з дверними прорізами. */
function carveRooms(g: EdgeGrid, r: Rng, x0: number, y0: number, x1: number, y1: number, depth = 0): void {
  const w = x1 - x0, h = y1 - y0;
  const minRoom = 3;
  if (w < minRoom * 2 && h < minRoom * 2) return;
  if (depth > 6 || (w * h < 30 && r() < 0.35)) return;
  const vertical = w > h ? true : h > w ? false : r() < 0.5;
  if (vertical && w >= minRoom * 2) {
    const sx = irange(r, x0 + minRoom, x1 - minRoom);
    const doors = h > 8 ? 2 : 1;
    const holes = new Set<number>();
    for (let k = 0; k < doors; k++) { const dy = irange(r, y0, y1 - 1); holes.add(dy); if (r() < 0.4) holes.add(Math.min(y1 - 1, dy + 1)); }
    for (let y = y0; y < y1; y++) g.setV(sx - 1, y, !holes.has(y));
    carveRooms(g, r, x0, y0, sx, y1, depth + 1);
    carveRooms(g, r, sx, y0, x1, y1, depth + 1);
  } else if (h >= minRoom * 2) {
    const sy = irange(r, y0 + minRoom, y1 - minRoom);
    const doors = w > 8 ? 2 : 1;
    const holes = new Set<number>();
    for (let k = 0; k < doors; k++) { const dx = irange(r, x0, x1 - 1); holes.add(dx); if (r() < 0.4) holes.add(Math.min(x1 - 1, dx + 1)); }
    for (let x = x0; x < x1; x++) g.setH(x, sy - 1, !holes.has(x));
    carveRooms(g, r, x0, y0, x1, sy, depth + 1);
    carveRooms(g, r, x0, sy, x1, y1, depth + 1);
  }
}

/** Вузькі коридори: «лабіринт» з широкими проходами, потім частину стін прибираємо. */
function carveCorridors(g: EdgeGrid, r: Rng, x0: number, y0: number, x1: number, y1: number): void {
  // спершу всі ребра зони — стіни, потім випадковий DFS прорізає проходи
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { if (x < x1 - 1) g.setV(x, y, true); if (y < y1 - 1) g.setH(x, y, true); }
  const seen = new Set<number>();
  const st: [number, number][] = [[x0, y0]];
  seen.add(y0 * g.cols + x0);
  while (st.length) {
    const [x, y] = st[st.length - 1] as [number, number];
    const nb = ([[1, 0], [-1, 0], [0, 1], [0, -1]] as const).map(([dx, dy]) => [x + dx * 2, y + dy * 2, dx, dy] as const)
      .filter(([nx, ny]) => nx >= x0 && nx < x1 && ny >= y0 && ny < y1 && !seen.has(ny * g.cols + nx));
    if (!nb.length) { st.pop(); continue; }
    const [nx, ny, dx, dy] = pick(r, nb);
    // прорізати дві клітинки (коридор шириною 1 клітинку, з «кишенями»)
    if (dx) { g.setV(Math.min(x, x + dx), y, false); g.setV(Math.min(x + dx, nx), y, false); }
    else { g.setH(x, Math.min(y, y + dy), false); g.setH(x, Math.min(y + dy, ny), false); }
    seen.add(ny * g.cols + nx); seen.add((y + dy) * g.cols + (x + dx));
    st.push([nx, ny]);
  }
  // розширити: прибрати частину стін, щоб коридори місцями ставали ширшими
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    if (r() < 0.36) g.setV(x, y, false);
    if (r() < 0.36) g.setH(x, y, false);
  }
}

export function generateLayout(o: LayoutOptions): Layout {
  const cols = o.cols ?? 60, rows = o.rows ?? 60, cell = o.cell ?? 1.2, height = o.height ?? 2.7;
  const r = rng(o.seed);
  const g = new EdgeGrid(cols, rows);
  const zones: ZoneStyle[] = o.zones ?? Array.from({ length: 9 }, () => pick(r, ['rooms', 'rooms', 'hall', 'corridors', 'dark'] as const));
  const zw = Math.floor(cols / 3), zh = Math.floor(rows / 3);
  const pillars: [number, number][] = [];
  zones.forEach((style, i) => {
    const zx = (i % 3) * zw, zy = Math.floor(i / 3) * zh;
    const x1 = i % 3 === 2 ? cols : zx + zw, y1 = Math.floor(i / 3) === 2 ? rows : zy + zh;
    if (style === 'rooms' || style === 'dark') carveRooms(g, r, zx, zy, x1, y1);
    else if (style === 'corridors') carveCorridors(g, r, zx, zy, x1, y1);
    else {
      // зал: колони у вузлах сітки через кожні 4 клітинки + кілька окремих стін-перегородок
      for (let y = zy + 3; y < y1 - 2; y += 4) for (let x = zx + 3; x < x1 - 2; x += 4) pillars.push([x, y]);
      for (let k = 0; k < 4; k++) {
        const len = irange(r, 3, 7), x = irange(r, zx + 1, x1 - 2), y = irange(r, zy + 1, y1 - 2);
        if (r() < 0.5) for (let t = 0; t < len; t++) g.setV(x, y + t, true); else for (let t = 0; t < len; t++) g.setH(x + t, y, true);
      }
    }
  });
  // між зонами — межі з кількома проходами, щоб світ не був «одним полем»
  for (let k = 1; k < 3; k++) {
    for (let y = 0; y < rows; y++) if (r() < 0.55) g.setV(k * zw - 1, y, true);
    for (let x = 0; x < cols; x++) if (r() < 0.55) g.setH(x, k * zh - 1, true);
  }
  // кілька зайвих проходів — кільця в маршрутах, щоб від монстра можна було втекти по колу
  for (let i = 0; i < cols * rows * 0.03; i++) { const x = irange(r, 0, cols - 2), y = irange(r, 0, rows - 2); if (r() < 0.5) g.setV(x, y, false); else g.setH(x, y, false); }

  // старт — центр першої «кімнатної» зони; зв'язність: усе, що недосяжне, приєднуємо, прорізаючи стіну
  const startZone = Math.max(0, zones.findIndex((z) => z === 'rooms'));
  const sx = (startZone % 3) * zw + (zw >> 1), sy = Math.floor(startZone / 3) * zh + (zh >> 1);
  let dist = bfs(g, sx, sy);
  for (let guard = 0; guard < cols * rows; guard++) {
    let fixed = false;
    for (let c = 0; c < dist.length && !fixed; c++) {
      if (dist[c] !== -1) continue;
      const x = c % cols, y = (c / cols) | 0;
      // знайти досяжного сусіда за стіною
      const cand: (() => void)[] = [];
      if (x > 0 && (dist[c - 1] as number) >= 0) cand.push(() => g.setV(x - 1, y, false));
      if (x < cols - 1 && (dist[c + 1] as number) >= 0) cand.push(() => g.setV(x, y, false));
      if (y > 0 && (dist[c - cols] as number) >= 0) cand.push(() => g.setH(x, y - 1, false));
      if (y < rows - 1 && (dist[c + cols] as number) >= 0) cand.push(() => g.setH(x, y, false));
      if (cand.length) { pick(r, cand)(); fixed = true; }
    }
    if (!fixed) break;
    dist = bfs(g, sx, sy);
  }

  // стіни: зливаємо сусідні ребра в довгі блоки (менше колізій і вершин)
  const T = 0.14;
  const walls: WallBox[] = [];
  const isPillarCorner = new Set(pillars.map(([x, y]) => `${x},${y}`));
  for (let y = 0; y < rows - 1; y++) {
    let start = -1;
    for (let x = 0; x <= cols; x++) {
      const on = x < cols && g.hasH(x, y);
      if (on && start < 0) start = x;
      if (!on && start >= 0) { walls.push({ x: ((start + x) / 2) * cell, z: (y + 1) * cell, w: (x - start) * cell + T, d: T, kind: 'wall' }); start = -1; }
    }
  }
  for (let x = 0; x < cols - 1; x++) {
    let start = -1;
    for (let y = 0; y <= rows; y++) {
      const on = y < rows && g.hasV(x, y);
      if (on && start < 0) start = y;
      if (!on && start >= 0) { walls.push({ x: (x + 1) * cell, z: ((start + y) / 2) * cell, w: T, d: (y - start) * cell + T, kind: 'wall' }); start = -1; }
    }
  }
  const W = cols * cell, D = rows * cell;
  walls.push({ x: W / 2, z: -T / 2, w: W + 2 * T, d: T, kind: 'outer' }, { x: W / 2, z: D + T / 2, w: W + 2 * T, d: T, kind: 'outer' });
  walls.push({ x: -T / 2, z: D / 2, w: T, d: D, kind: 'outer' }, { x: W + T / 2, z: D / 2, w: T, d: D, kind: 'outer' });
  for (const k of isPillarCorner) { const [px, py] = k.split(',').map(Number) as [number, number]; walls.push({ x: px * cell, z: py * cell, w: 0.56, d: 0.56, kind: 'pillar' }); }

  // світло: панелі 1.2×0.6 м кожні 2 клітинки; у темних зонах більшість вимкнена
  const lights: LightPanel[] = [];
  for (let y = 0; y < rows; y += 2) for (let x = 0; x < cols; x += 2) {
    const zi = Math.min(2, Math.floor(x / zw)) + 3 * Math.min(2, Math.floor(y / zh));
    const dark = zones[zi] === 'dark';
    const roll = r();
    const state: LightPanel['state'] = dark ? (roll < 0.18 ? 'on' : roll < 0.26 ? 'flicker' : 'off') : roll < 0.06 ? 'off' : roll < 0.11 ? 'flicker' : 'on';
    lights.push({ x: (x + 1) * cell, z: (y + 1) * cell, w: 1.2, d: 0.6, state });
  }

  // вихід («Шов») — найдальша досяжна клітинка
  let far = 0;
  for (let c = 0; c < dist.length; c++) if ((dist[c] as number) > (dist[far] as number)) far = c;
  const ex = far % cols, ey = (far / cols) | 0;
  const at = (cx: number, cy: number, yaw = 0): Spot => ({ x: (cx + 0.5) * cell, z: (cy + 0.5) * cell, yaw });

  // точки сюжету: документ біля старту, записка — на середині шляху до виходу
  const target = Math.floor((dist[far] as number) * 0.45);
  let mid = 0;
  for (let c = 0; c < dist.length; c++) if (dist[c] === target) { mid = c; break; }

  return {
    seed: o.seed, cell, cols, rows, height, wallThickness: T, walls, lights, zones,
    spawn: at(sx, sy, 0),
    exit: { ...at(ex, ey), cx: ex, cz: ey },
    points: { order7: at(sx + 1, sy), note1: at(mid % cols, (mid / cols) | 0) },
    dist
  };
}

/** Перевірка: чи вільна клітинка від колон (для розміщення предметів). */
export function cellCenter(l: Layout, cx: number, cz: number): [number, number] {
  return [(cx + 0.5) * l.cell, (cz + 0.5) * l.cell];
}
