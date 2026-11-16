// Планування рівня на сітці клітинок: стіни лежать на ребрах клітинок, колони — у вузлах.
// Результат (Layout) — спільне джерело правди для гри (колізії, навмеш, предмети) і для Blender
// (геометрія + запікання світла). Тому генерація детермінована від зерна.
import { rng, irange, pick, type Rng } from '../core/rng';

export type ZoneStyle = 'rooms' | 'hall' | 'corridors' | 'dark';
export type Preset = 'yellow' | 'base' | 'parking';
type RGB = [number, number, number];

/** Вигляд рівня: висота, фарба на стінах, лампи, альбедо для запікання (Blender) — спільне для гри й Blender. */
export interface Theme {
  id: Preset;
  height: number;
  /** Висота нижньої фарбованої смуги стін (матеріал wallLow), 0 — без смуги. */
  paintH: number;
  /** Плінтус (матеріал base). */
  plinth: boolean;
  lamp: { w: number; d: number; spacing: number; color: RGB; power: number; offP: number; flickerP: number };
  /** Альбедо поверхонь для запікання (лінійні). */
  albedo: Record<'wall' | 'wallLow' | 'base' | 'floor' | 'ceil', RGB>;
  pillar: number;
}

export const THEMES: Record<Preset, Theme> = {
  yellow: {
    id: 'yellow', height: 2.7, paintH: 0, plinth: true, pillar: 0.56,
    lamp: { w: 1.2, d: 0.6, spacing: 2, color: [1.0, 0.95, 0.8], power: 22, offP: 0.06, flickerP: 0.05 },
    albedo: { wall: [0.58, 0.47, 0.2], wallLow: [0.58, 0.47, 0.2], base: [0.3, 0.23, 0.12], floor: [0.26, 0.19, 0.09], ceil: [0.68, 0.66, 0.58] }
  },
  // радянська база: нижня частина стін — зелена олійна фарба, верх — побілка; лінолеум; холодні лампи денного світла
  base: {
    id: 'base', height: 3.0, paintH: 1.5, plinth: false, pillar: 0.6,
    lamp: { w: 1.25, d: 0.22, spacing: 3, color: [0.86, 0.95, 1.0], power: 40, offP: 0.14, flickerP: 0.1 },
    albedo: { wall: [0.62, 0.62, 0.58], wallLow: [0.12, 0.26, 0.17], base: [0.1, 0.1, 0.1], floor: [0.36, 0.24, 0.12], ceil: [0.5, 0.5, 0.48] }
  },
  // підземна парковка: сирий бетон, натрієві лампи, більшість не світить
  parking: {
    id: 'parking', height: 3.2, paintH: 1.1, plinth: false, pillar: 0.7,
    lamp: { w: 1.25, d: 0.16, spacing: 4, color: [1.0, 0.62, 0.3], power: 48, offP: 0.42, flickerP: 0.16 },
    albedo: { wall: [0.4, 0.39, 0.36], wallLow: [0.32, 0.36, 0.4], base: [0.2, 0.2, 0.2], floor: [0.22, 0.21, 0.2], ceil: [0.36, 0.35, 0.33] }
  }
};

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
  theme: Theme;
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
  preset?: Preset;
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

interface Plan { g: EdgeGrid; pillars: [number, number][]; zones: ZoneStyle[]; start: [number, number] }

/** Жовті кімнати: зони 3×3 різних стилів (кімнати, зал із колонами, коридори, темрява). */
function planYellow(r: Rng, cols: number, rows: number, zonesOpt?: ZoneStyle[]): Plan {
  const g = new EdgeGrid(cols, rows);
  const zones: ZoneStyle[] = zonesOpt ?? Array.from({ length: 9 }, () => pick(r, ['rooms', 'rooms', 'hall', 'corridors', 'dark'] as const));
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
  const startZone = Math.max(0, zones.findIndex((z) => z === 'rooms'));
  return { g, pillars, zones, start: [(startZone % 3) * zw + (zw >> 1), Math.floor(startZone / 3) * zh + (zh >> 1)] };
}

/** Позиції ліній коридорів: перша — з відступом, далі через крок (коридор займає 2 клітинки). */
function corridorLines(r: Rng, n: number): number[] {
  const out: number[] = [];
  for (let p = irange(r, 4, 7); p < n - 5; p += irange(r, 10, 14)) out.push(p);
  return out;
}

/** Радянська база: сітка широких коридорів (2 клітинки), між ними блоки — лабораторії, кабінети, склади, зали. */
function planBase(r: Rng, cols: number, rows: number): Plan {
  const g = new EdgeGrid(cols, rows);
  const ys = corridorLines(r, rows), xs = corridorLines(r, cols);
  const pillars: [number, number][] = [];
  const bx = [0, ...xs.flatMap((c) => [c, c + 2]), cols], by = [0, ...ys.flatMap((c) => [c, c + 2]), rows];
  for (let j = 0; j < by.length - 1; j += 2) for (let i = 0; i < bx.length - 1; i += 2) {
    const x0 = bx[i] as number, x1 = bx[i + 1] as number, y0 = by[j] as number, y1 = by[j + 1] as number;
    if (x1 - x0 < 2 || y1 - y0 < 2) continue;
    // межі блоку з коридором — стіни з 1–2 дверима на кожному боці
    const side = (len: number, set: (t: number, on: boolean) => void) => {
      for (let t = 0; t < len; t++) set(t, true);
      const doors = len > 9 && r() < 0.6 ? 2 : 1;
      for (let k = 0; k < doors; k++) if (r() < 0.85) set(irange(r, 1, Math.max(1, len - 2)), false);
    };
    if (y0 > 0) side(x1 - x0, (t, on) => g.setH(x0 + t, y0 - 1, on));
    if (y1 < rows) side(x1 - x0, (t, on) => g.setH(x0 + t, y1 - 1, on));
    if (x0 > 0) side(y1 - y0, (t, on) => g.setV(x0 - 1, y0 + t, on));
    if (x1 < cols) side(y1 - y0, (t, on) => g.setV(x1 - 1, y0 + t, on));
    const kind = r();
    if (kind < 0.62) carveRooms(g, r, x0, y0, x1, y1);
    else if (kind < 0.8) {
      // зал (диспетчерська, цех): колони через 3 клітинки
      for (let y = y0 + 3; y < y1 - 2; y += 3) for (let x = x0 + 3; x < x1 - 2; x += 3) pillars.push([x, y]);
    } // інакше — великий склад без перегородок (стелажі ставить гра)
  }
  const zones: ZoneStyle[] = Array.from({ length: 9 }, () => (r() < 0.25 ? 'dark' : 'rooms'));
  zones[0] = 'rooms';
  return { g, pillars, zones, start: [xs[0] ?? 4, ys[0] ?? 4] };
}

/** Парковка: відкритий простір, колони через 5 клітинок, сходові клітки й будки, кілька довгих стінок-пандусів. */
function planParking(r: Rng, cols: number, rows: number): Plan {
  const g = new EdgeGrid(cols, rows);
  const pillars: [number, number][] = [];
  for (let y = 5; y < rows - 2; y += 5) for (let x = 5; x < cols - 2; x += 5) pillars.push([x, y]);
  const boxes: [number, number, number, number][] = [];
  for (let k = 0, tries = 0; k < 5 && tries < 200; tries++) {
    const w = irange(r, 3, 5), h = irange(r, 3, 5), x = irange(r, 1, cols - w - 1), y = irange(r, 1, rows - h - 1);
    if (x < 9 && y < 9) continue; // не біля старту
    if (boxes.some(([bx, by, bw, bh]) => x < bx + bw + 2 && bx < x + w + 2 && y < by + bh + 2 && by < y + h + 2)) continue;
    boxes.push([x, y, w, h]); k++;
    for (let t = 0; t < w; t++) { g.setH(x + t, y - 1, true); g.setH(x + t, y + h - 1, true); }
    for (let t = 0; t < h; t++) { g.setV(x - 1, y + t, true); g.setV(x + w - 1, y + t, true); }
    const d = r() < 0.5 ? (r() < 0.5 ? () => g.setH(x + irange(r, 0, w - 1), y - 1, false) : () => g.setH(x + irange(r, 0, w - 1), y + h - 1, false))
      : (r() < 0.5 ? () => g.setV(x - 1, y + irange(r, 0, h - 1), false) : () => g.setV(x + w - 1, y + irange(r, 0, h - 1), false));
    d();
  }
  for (let k = 0; k < 6; k++) {
    const len = irange(r, 6, 13), x = irange(r, 2, cols - 3), y = irange(r, 2, rows - 3);
    if (r() < 0.5) for (let t = 0; t < len && y + t < rows - 1; t++) g.setV(x, y + t, true);
    else for (let t = 0; t < len && x + t < cols - 1; t++) g.setH(x + t, y, true);
  }
  const zones: ZoneStyle[] = Array.from({ length: 9 }, () => (r() < 0.55 ? 'dark' : 'hall'));
  zones[0] = 'hall';
  return { g, pillars, zones, start: [2, 2] };
}

export function generateLayout(o: LayoutOptions): Layout {
  const preset = o.preset ?? 'yellow', theme = THEMES[preset];
  const dflt = preset === 'yellow' ? 60 : 40;
  const cols = o.cols ?? dflt, rows = o.rows ?? dflt, cell = o.cell ?? 1.2, height = o.height ?? theme.height;
  const r = rng(o.seed);
  const plan = preset === 'yellow' ? planYellow(r, cols, rows, o.zones) : preset === 'base' ? planBase(r, cols, rows) : planParking(r, cols, rows);
  const { g, pillars, zones } = plan;
  const zw = Math.floor(cols / 3), zh = Math.floor(rows / 3);

  // старт — центр першої «кімнатної» зони; зв'язність: усе, що недосяжне, приєднуємо, прорізаючи стіну
  const [sx, sy] = plan.start;
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
  for (const k of isPillarCorner) { const [px, py] = k.split(',').map(Number) as [number, number]; walls.push({ x: px * cell, z: py * cell, w: theme.pillar, d: theme.pillar, kind: 'pillar' }); }

  // світло: світильники через theme.lamp.spacing клітинок; у темних зонах більшість вимкнена
  const lights: LightPanel[] = [];
  const L = theme.lamp, sp = L.spacing;
  for (let y = 0; y < rows; y += sp) for (let x = 0; x < cols; x += sp) {
    const zi = Math.min(2, Math.floor(x / zw)) + 3 * Math.min(2, Math.floor(y / zh));
    const dark = zones[zi] === 'dark';
    const roll = r();
    const state: LightPanel['state'] = dark ? (roll < 0.18 ? 'on' : roll < 0.26 ? 'flicker' : 'off') : roll < L.offP ? 'off' : roll < L.offP + L.flickerP ? 'flicker' : 'on';
    const lx = (x + sp / 2) * cell, lz = (y + sp / 2) * cell;
    // не вмуровувати світильник у стіну чи колону (для нових рівнів; жовті кімнати лишаються як запечені)
    if (preset !== 'yellow' && walls.some((w) => Math.abs(w.x - lx) < w.w / 2 + L.w / 2 + 0.1 && Math.abs(w.z - lz) < w.d / 2 + L.d / 2 + 0.1)) continue;
    lights.push({ x: lx, z: lz, w: L.w, d: L.d, state });
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

  // «Розлам» — прихований другий шов: найдальша клітинка темної зони, що не біля виходу (якщо темних зон нема — 70 % шляху)
  let rift = -1;
  for (let c = 0; c < dist.length; c++) {
    const x = c % cols, y = (c / cols) | 0;
    const zi = Math.min(2, Math.floor(x / zw)) + 3 * Math.min(2, Math.floor(y / zh));
    if (zones[zi] !== 'dark' || Math.hypot(x - ex, y - ey) < 12) continue;
    if (rift < 0 || (dist[c] as number) > (dist[rift] as number)) rift = c;
  }
  if (rift < 0) { const t7 = Math.floor((dist[far] as number) * 0.7); for (let c = 0; c < dist.length; c++) if (dist[c] === t7) { rift = c; break; } }

  return {
    seed: o.seed, theme, cell, cols, rows, height, wallThickness: T, walls, lights, zones,
    spawn: at(sx, sy, 0),
    exit: { ...at(ex, ey), cx: ex, cz: ey },
    points: { order7: at(sx + 1, sy), note1: at(mid % cols, (mid / cols) | 0), rift: at(rift % cols, (rift / cols) | 0) },
    dist
  };
}

/** Перевірка: чи вільна клітинка від колон (для розміщення предметів). */
export function cellCenter(l: Layout, cx: number, cz: number): [number, number] {
  return [(cx + 0.5) * l.cell, (cz + 0.5) * l.cell];
}
