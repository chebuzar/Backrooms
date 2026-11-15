import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { rng, clamp, smooth } from '../core/util.js';
import * as TX from '../render/textures.js';

// Генерация лабиринта, геометрия, запечённый свет, предметы, тайная комната.

const S = 2;      // размер клетки, м
const H = 2.7;    // высота потолка, м
const BAKE = { value: Math.PI };       // общая яркость ламп (мигает)
const ROOMBAKE = { value: Math.PI };
const AMBK = { value: 0.3 };       // доля общего «рассеянного» света на запечённых стенах (меньше — контрастнее)   // свет тайной комнаты (не гаснет)
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const solidMove = (t) => t === 1 || t === 2 || t === 5;
const solidSight = (t) => t === 1 || t === 2 || t === 3 || t === 5;
const PD = 0.62;  // глубина бассейна

function bfs(g, mw, mh, sx, sy, walk) {
  const N = mw * mh, d = new Int16Array(N).fill(-1);
  if (sx < 0 || sy < 0 || sx >= mw || sy >= mh) return d;
  const s = sy * mw + sx;
  if (!walk(g[s])) return d;
  const q = new Int32Array(N); let h = 0, t = 0;
  d[s] = 0; q[t++] = s;
  while (h < t) {
    const i = q[h++], x = i % mw, y = (i / mw) | 0, nd = d[i] + 1;
    if (x + 1 < mw) { const j = i + 1; if (d[j] < 0 && walk(g[j])) { d[j] = nd; q[t++] = j; } }
    if (x > 0) { const j = i - 1; if (d[j] < 0 && walk(g[j])) { d[j] = nd; q[t++] = j; } }
    if (y + 1 < mh) { const j = i + mw; if (d[j] < 0 && walk(g[j])) { d[j] = nd; q[t++] = j; } }
    if (y > 0) { const j = i - mw; if (d[j] < 0 && walk(g[j])) { d[j] = nd; q[t++] = j; } }
  }
  return d;
}

// ---------------------------------------------------------------------------
// Сетка: 0 пол, 1 стена, 2 дверь-выход, 3 ложная стена, 4 пол тайной комнаты, 5 стеллаж, 6 вода
const walkT = (t) => t === 0 || t === 6;

function interior(g, mw, mh) { for (let y = 1; y < mh - 1; y++) for (let x = 1; x < mw - 1; x++) g[y * mw + x] = 0; }
function layMaze(g, mw, mh, n, r, th, rooms) {
  const st = [mw + 1]; g[mw + 1] = 0;
  while (st.length) {
    const i = st[st.length - 1], x = i % mw, y = (i / mw) | 0, opts = [];
    if (x + 2 < mw - 1 && g[i + 2]) opts.push(1);
    if (x - 2 > 0 && g[i - 2]) opts.push(-1);
    if (y + 2 < mh - 1 && g[i + 2 * mw]) opts.push(mw);
    if (y - 2 > 0 && g[i - 2 * mw]) opts.push(-mw);
    if (!opts.length) { st.pop(); continue; }
    const k = opts[(r() * opts.length) | 0];
    g[i + k] = 0; g[i + 2 * k] = 0; st.push(i + 2 * k);
  }
  for (let y = 1; y < mh - 1; y++) for (let x = 1; x < mw - 1; x++) {
    const i = y * mw + x;
    if (((x + y) & 1) && g[i] === 1 && r() < th.open) g[i] = 0;
  }
  for (let k = 0; k < th.rooms; k++) {
    const w = 2 + ((r() * 3) | 0), h = 2 + ((r() * 3) | 0);
    const cx = 1 + 2 * ((r() * Math.max(1, n - w)) | 0), cy = 1 + 2 * ((r() * Math.max(1, n - h)) | 0);
    const x1 = Math.min(mw - 2, cx + 2 * w - 2), y1 = Math.min(mh - 2, cy + 2 * h - 2);
    rooms.push({ x0: cx, y0: cy, x1, y1 });
    for (let y = cy; y <= y1; y++) for (let x = cx; x <= x1; x++) {
      const post = !(x & 1) && !(y & 1);
      g[y * mw + x] = post ? (r() < 0.4 ? 1 : 0) : 0;
    }
  }
}
function layHalls(g, mw, mh, r, pill, segK) {
  interior(g, mw, mh);
  const segs = Math.round(mw * mh / segK);
  for (let k = 0; k < segs; k++) {
    const hor = r() < 0.5, len = 2 + ((r() * 6) | 0), x = 1 + ((r() * (mw - 2)) | 0), y = 1 + ((r() * (mh - 2)) | 0);
    for (let i = 0; i < len; i++) { const X = hor ? x + i : x, Y = hor ? y : y + i; if (X > 0 && Y > 0 && X < mw - 1 && Y < mh - 1) g[Y * mw + X] = 1; }
  }
  for (let y = 2; y < mh - 2; y += 2) for (let x = 2; x < mw - 2; x += 2) if (r() < pill) g[y * mw + x] = 1;
}
function layRooms(g, mw, mh, r, rooms) {
  const split = (x0, y0, x1, y1, depth) => {
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    const canX = w >= 7, canY = h >= 7;
    if ((!canX && !canY) || (depth > 2 && w <= 9 && h <= 9 && r() < 0.35)) {
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) g[y * mw + x] = 0;
      rooms.push({ x0, y0, x1, y1 }); return;
    }
    if (canX && (!canY || w >= h)) {
      const c = x0 + 3 + ((r() * (w - 6)) | 0);
      split(x0, y0, c - 1, y1, depth + 1); split(c + 1, y0, x1, y1, depth + 1);
      const doors = r() < 0.35 ? 2 : 1;
      for (let k = 0; k < doors; k++) g[(y0 + ((r() * h) | 0)) * mw + c] = 0;
    } else {
      const c = y0 + 3 + ((r() * (h - 6)) | 0);
      split(x0, y0, x1, c - 1, depth + 1); split(x0, c + 1, x1, y1, depth + 1);
      const doors = r() < 0.35 ? 2 : 1;
      for (let k = 0; k < doors; k++) g[c * mw + x0 + ((r() * w) | 0)] = 0;
    }
  };
  split(1, 1, mw - 2, mh - 2, 0);
}
function layParking(g, mw, mh, r) {
  interior(g, mw, mh);
  const vx = Math.floor(mw / 3) + ((r() * 3) | 0), hy = Math.floor(mh * 2 / 3) - ((r() * 3) | 0);
  for (let y = 1; y < mh - 1; y++) if (y % 7 !== 3 && y % 7 !== 4) g[y * mw + vx] = 1;
  for (let x = 1; x < mw - 1; x++) if (x % 7 !== 2 && x % 7 !== 3 && x !== vx) g[hy * mw + x] = 1;
  for (let k = 0; k < 4; k++) { const x = 2 + ((r() * (mw - 4)) | 0), y = 2 + ((r() * (mh - 4)) | 0); g[y * mw + x] = 1; }
}
function layShelves(g, mw, mh, r) {
  interior(g, mw, mh);
  for (let y = 3; y < mh - 2; y += 3) for (let x = 2; x < mw - 2; x++) {
    if (x % 8 === 0 || x % 8 === 1 || r() < 0.04) continue;
    g[y * mw + x] = 5;
  }
}
function layPool(g, mw, mh, r, pill) {
  layHalls(g, mw, mh, r, pill, 48);
  const pools = 3 + ((mw * mh / 80) | 0);
  for (let k = 0; k < pools; k++) {
    const w = 2 + ((r() * 4) | 0), h = 2 + ((r() * 4) | 0), x0 = 1 + ((r() * (mw - w - 1)) | 0), y0 = 1 + ((r() * (mh - h - 1)) | 0);
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) if (g[y * mw + x] === 0) g[y * mw + x] = 6;
  }
}

function layPits(g, mw, mh, r, k) {
  const pools = k + ((mw * mh / 80) | 0);
  for (let q = 0; q < pools; q++) {
    const w = 2 + ((r() * 4) | 0), h = 2 + ((r() * 4) | 0), x0 = 1 + ((r() * (mw - w - 1)) | 0), y0 = 1 + ((r() * (mh - h - 1)) | 0);
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) if (g[y * mw + x] === 0) g[y * mw + x] = 6;
  }
}
function layCircus(g, mw, mh, r) {
  interior(g, mw, mh);
  const cx = mw >> 1, cy = mh >> 1, R = 4, want = Math.round(mw * mh / 34);
  let placed = 0;
  for (let k = 0; k < want * 6 && placed < want; k++) {
    const w = 1 + ((r() * 2) | 0), h = 1 + ((r() * 2) | 0), x = 2 + ((r() * (mw - 4 - w)) | 0), y = 2 + ((r() * (mh - 4 - h)) | 0);
    if (Math.hypot(x + w / 2 - cx, y + h / 2 - cy) < R + 3) continue;
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) g[yy * mw + xx] = 1;
    placed++;
  }
  for (let k = 0; k < 3; k++) {
    const hor = r() < 0.5, len = 4 + ((r() * 5) | 0), x = 2 + ((r() * (mw - 4)) | 0), y = 2 + ((r() * (mh - 4)) | 0);
    for (let i = 0; i < len; i++) { const X = hor ? x + i : x, Y = hor ? y : y + i; if (X > 0 && Y > 0 && X < mw - 1 && Y < mh - 1 && Math.hypot(X - cx, Y - cy) >= R + 2) g[Y * mw + X] = 1; }
  }
}

// ---------------------------------------------------------------------------
// Открытый мир: 3×3 блока по 27 клеток (≈160×160 м). Каждый блок — зона со своей планировкой,
// иногда два соседних блока сливаются в огромный атриум. Между зонами пробиты проходы.
const ZB = 27, ZN = 3;
const ZONE_NAMES = {
  maze: 'ЛАБИРИНТ', atrium: 'АТРИУМ', halls: 'КОЛОННЫЙ ЗАЛ', rooms: 'ОФИСНЫЙ БЛОК', pool: 'БАССЕЙНЫ',
  parking: 'ПАРКОВКА', shelves: 'СКЛАД', smiles: 'ИГРОВАЯ', circus: 'ШАТЁР'
};
function layAtrium(g, mw, mh, r) {
  interior(g, mw, mh);
  const step = 4, ox = 2 + ((r() * 2) | 0), oy = 2 + ((r() * 2) | 0);
  for (let y = oy; y < mh - 2; y += step) for (let x = ox; x < mw - 2; x += step) g[y * mw + x] = 1;
  // пара перегородок, чтобы зал не просматривался насквозь
  for (let k = 0; k < Math.round(mw * mh / 350); k++) {
    const hor = r() < 0.5, len = 3 + ((r() * 4) | 0), x = 2 + ((r() * (mw - 4)) | 0), y = 2 + ((r() * (mh - 4)) | 0);
    for (let i = 0; i < len; i++) { const X = hor ? x + i : x, Y = hor ? y : y + i; if (X > 1 && Y > 1 && X < mw - 2 && Y < mh - 2) g[Y * mw + X] = 1; }
  }
}
function layZone(type, w, h, r, th, rooms) {
  const s = new Uint8Array(w * h).fill(1);
  if (type === 'maze') layMaze(s, w, h, (Math.min(w, h) - 1) >> 1, r, { open: th.layout === 'maze' ? th.open : 0.3, rooms: 3 }, rooms);
  else if (type === 'atrium') layAtrium(s, w, h, r);
  else if (type === 'halls') layHalls(s, w, h, r, th.pillars || 0.25, 26);
  else if (type === 'rooms') layRooms(s, w, h, r, rooms);
  else if (type === 'pool') layPool(s, w, h, r, 0.14);
  else if (type === 'parking') layParking(s, w, h, r);
  else if (type === 'shelves') layShelves(s, w, h, r);
  else if (type === 'smiles') { layHalls(s, w, h, r, th.pillars || 0.1, 30); layPits(s, w, h, r, 2); }
  else if (type === 'circus') layCircus(s, w, h, r);
  return s;
}
function layWorld(th, r) {
  const mw = ZB * ZN, mh = mw, g = new Uint8Array(mw * mh).fill(1), rooms = [];
  const P = th.layout || 'maze', circus = P === 'circus', CENTER = 4;
  // типы зон: основная планировка уровня + атриум + случайные «чужие» зоны
  const others = ['maze', 'halls', 'rooms', 'pool', 'parking', 'shelves'].filter((x) => x !== P && !(circus && x === 'maze'));
  for (let i = others.length - 1; i > 0; i--) { const j = (r() * (i + 1)) | 0; [others[i], others[j]] = [others[j], others[i]]; }
  // 7 одиночных блоков (два блока заняты атриумом): основная планировка ×3, «чужие» ×3, лабиринт ×1
  const Pm = circus ? 'halls' : P;
  const types = [Pm, Pm, others[0], others[1], others[2], others[3], circus ? 'smiles' : P === 'maze' ? 'halls' : 'maze'];
  for (let i = types.length - 1; i > 0; i--) { const j = (r() * (i + 1)) | 0; [types[i], types[j]] = [types[j], types[i]]; }
  // слить два соседних блока в гигантский атриум
  const block = new Int8Array(ZN * ZN).fill(-1), zones = [];
  const pairs = [];
  for (let b = 0; b < ZN * ZN; b++) {
    const bx = b % ZN, by = (b / ZN) | 0;
    if (bx < ZN - 1) pairs.push([b, b + 1]);
    if (by < ZN - 1) pairs.push([b, b + ZN]);
  }
  const okPair = pairs.filter(([a, b]) => !(circus && (a === CENTER || b === CENTER)));
  const merge = okPair[(r() * okPair.length) | 0];
  const letters = 'ABCDEFGHJKLMNPRSTUVWXYZ';
  const mk = (bs, type) => {
    const xs = bs.map((b) => b % ZN), ys = bs.map((b) => (b / ZN) | 0);
    const x0 = Math.min(...xs) * ZB, y0 = Math.min(...ys) * ZB, w = (Math.max(...xs) - Math.min(...xs) + 1) * ZB, h = (Math.max(...ys) - Math.min(...ys) + 1) * ZB;
    const id = zones.length, code = letters[(r() * letters.length) | 0] + '-' + (10 + ((r() * 90) | 0));
    zones.push({ id, type, x0, y0, x1: x0 + w - 1, y1: y0 + h - 1, name: ZONE_NAMES[type] || type, code });
    for (const b of bs) block[b] = id;
    const sub = [], sr = rng((r() * 4294967296) >>> 0);
    const s = layZone(type, w, h, sr, th, sub);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) g[(y0 + y) * mw + x0 + x] = s[y * w + x];
    for (const q of sub) rooms.push({ x0: q.x0 + x0, y0: q.y0 + y0, x1: q.x1 + x0, y1: q.y1 + y0 });
  };
  mk(merge, 'atrium');
  let ti = 0;
  for (let b = 0; b < ZN * ZN; b++) {
    if (block[b] >= 0) continue;
    mk([b], circus && b === CENTER ? 'circus' : types[ti++ % types.length]);
  }
  // проходы между соседними зонами
  const walk = (v) => v === 0 || v === 6;
  const dig = (x, y, dx, dy) => { for (let k = 0; k < 7; k++) { const X = x + dx * k, Y = y + dy * k; if (X <= 0 || Y <= 0 || X >= mw - 1 || Y >= mh - 1) return; const i = Y * mw + X; if (walk(g[i])) return; g[i] = 0; } };
  for (const [a, b] of pairs) {
    if (block[a] === block[b]) continue;
    const ax = a % ZN, ay = (a / ZN) | 0, hor = b === a + 1;
    const n = 2 + ((r() * 2) | 0);
    for (let k = 0; k < n; k++) {
      const off = 3 + 2 * ((r() * 11) | 0), wide = r() < 0.35;
      for (let q = 0; q <= (wide ? 1 : 0); q++) {
        if (hor) { const xa = (ax + 1) * ZB - 1, y = ay * ZB + off + q; dig(xa, y, -1, 0); dig(xa + 1, y, 1, 0); }
        else { const ya = (ay + 1) * ZB - 1, x = ax * ZB + off + q; dig(x, ya, 0, -1); dig(x, ya + 1, 0, 1); }
      }
    }
  }
  // стартовая зона: угловой блок, не бассейн и не атриум
  const corners = [0, ZN - 1, ZN * (ZN - 1), ZN * ZN - 1].filter((b) => !['pool', 'atrium', 'shelves'].includes(zones[block[b]].type));
  const startZone = zones[block[corners.length ? corners[(r() * corners.length) | 0] : 0]];
  return { g, mw, mh, rooms, zones, startZone };
}
const zoneAt = (zones, tx, ty) => { for (const z of zones) if (tx >= z.x0 && tx <= z.x1 && ty >= z.y0 && ty <= z.y1) return z; return null; };

function genGrid(th, level, seed, o = {}) {
  const r = rng(seed);
  const world = o.world ? layWorld(th, r) : null;
  const n = th.n, mw = world ? world.mw : 2 * n + 1, mh = mw;
  let g = world ? world.g : new Uint8Array(mw * mh).fill(1);
  const rooms = world ? world.rooms : [], L = world ? 'world' : (th.layout || 'maze');
  if (world) { /* уже размечено */ }
  else if (L === 'maze') layMaze(g, mw, mh, n, r, th, rooms);
  else if (L === 'halls') layHalls(g, mw, mh, r, th.pillars || 0.25, 26);
  else if (L === 'rooms') layRooms(g, mw, mh, r, rooms);
  else if (L === 'parking') layParking(g, mw, mh, r);
  else if (L === 'shelves') layShelves(g, mw, mh, r);
  else if (L === 'pool') layPool(g, mw, mh, r, th.pillars || 0.14);
  else if (L === 'smiles') { layHalls(g, mw, mh, r, th.pillars || 0.1, 30); layPits(g, mw, mh, r, 2); }
  else if (L === 'circus') layCircus(g, mw, mh, r);
  // дивные находки: место расчищается до постройки геометрии; процессия всегда в атриуме
  const finds = [];
  if (world && !o.demo) {
    const CLR = { lunar: 2, astronaut: 1, procession: 1, carousel: 2, seats: 2, soda: 1 };
    const pool = ['lunar', 'astronaut', 'carousel', 'seats', 'soda'];
    for (let i = pool.length - 1; i > 0; i--) { const j = (r() * (i + 1)) | 0; [pool[i], pool[j]] = [pool[j], pool[i]]; }
    const zs = world.zones.filter((z) => z !== world.startZone);
    const atr = zs.find((z) => z.type === 'atrium');
    const rest = zs.filter((z) => z !== atr && z.type !== 'circus');
    for (let i = rest.length - 1; i > 0; i--) { const j = (r() * (i + 1)) | 0; [rest[i], rest[j]] = [rest[j], rest[i]]; }
    const plan = [];
    if (atr) plan.push(['procession', atr]);
    pool.slice(0, Math.min(4, rest.length)).forEach((k, i) => plan.push([k, rest[i]]));
    for (const [kind, z] of plan) {
      const rc = CLR[kind], m = rc + 2;
      const tx = z.x0 + m + ((r() * Math.max(1, z.x1 - z.x0 - 2 * m)) | 0), ty = z.y0 + m + ((r() * Math.max(1, z.y1 - z.y0 - 2 * m)) | 0);
      for (let y = ty - rc; y <= ty + rc; y++) for (let x = tx - rc; x <= tx + rc; x++) if (x > z.x0 && y > z.y0 && x < z.x1 && y < z.y1) g[y * mw + x] = 0;
      finds.push({ kind, tx, ty, yaw: kind === 'procession' ? 0 : ((r() * 4) | 0) * Math.PI / 2, zone: z });
    }
  }
  // старт: самое открытое место
  let sx = 1, sy = 1, best = -1;
  const sz = world && world.startZone;
  for (let k = 0; k < (world ? 200 : 60); k++) {
    const x = sz ? sz.x0 + 1 + ((r() * (sz.x1 - sz.x0 - 1)) | 0) : L === 'maze' ? 1 + 2 * ((r() * n) | 0) : 1 + ((r() * (mw - 2)) | 0);
    const y = sz ? sz.y0 + 1 + ((r() * (sz.y1 - sz.y0 - 1)) | 0) : L === 'maze' ? 1 + 2 * ((r() * n) | 0) : 1 + ((r() * (mh - 2)) | 0);
    if (g[y * mw + x] !== 0) continue;
    let open = 0;
    for (let yy = -2; yy <= 2; yy++) for (let xx = -2; xx <= 2; xx++) {
      const X = x + xx, Y = y + yy;
      if (X > 0 && Y > 0 && X < mw && Y < mh && g[Y * mw + X] === 0) open++;
    }
    if (open > best) { best = open; sx = x; sy = y; }
  }
  if (g[sy * mw + sx] !== 0) g[sy * mw + sx] = 0;
  let d = bfs(g, mw, mh, sx, sy, walkT);
  for (let i = 0; i < d.length; i++) if (d[i] < 0 && walkT(g[i])) g[i] = 1;   // закрыть недостижимое
  let maxD = 0; for (let i = 0; i < d.length; i++) if (d[i] > maxD) maxD = d[i];
  // выход: самая дальняя сухая клетка у стены
  let bd = -1, bi = -1;
  for (let i = 0; i < d.length; i++) {
    if (d[i] <= bd || g[i] !== 0) continue;
    let wall = false; for (const k of [1, -1, mw, -mw]) if (g[i + k] === 1) wall = true;
    if (wall) { bd = d[i]; bi = i; }
  }
  let door = -1;
  for (const k of [1, -1, mw, -mw]) {
    const j = bi + k; if (g[j] !== 1) continue;
    const jx = j % mw, jy = (j / mw) | 0;
    const bx = jx + (k === 1 ? 1 : k === -1 ? -1 : 0), by = jy + (k === mw ? 1 : k === -mw ? -1 : 0);
    const out = bx < 0 || by < 0 || bx >= mw || by >= mh;
    if (out || g[by * mw + bx] === 1) { door = j; break; }
    if (door < 0) door = j;
  }
  g[door] = 2;
  const D = { tx: door % mw, ty: (door / mw) | 0, fx: bi % mw, fy: (bi / mw) | 0 };
  let yaw = 0, bestRun = -1;
  for (const [dx, dy] of DIRS) {
    let run = 0; while (walkT(g[(sy + dy * (run + 1)) * mw + sx + dx * (run + 1)]) && run < 12) run++;
    if (run > bestRun) { bestRun = run; yaw = Math.atan2(-dx, -dy); }
  }
  const cands = [];
  for (let i = 0; i < d.length; i++) if (g[i] === 0 && d[i] >= 0) cands.push(i);
  for (let i = cands.length - 1; i > 0; i--) { const j = (r() * (i + 1)) | 0; const t = cands[i]; cands[i] = cands[j]; cands[j] = t; }
  const used = [[sx, sy], [D.fx, D.fy]];
  for (const f of finds) for (let y = -2; y <= 2; y += 2) for (let x = -2; x <= 2; x += 2) used.push([f.tx + x, f.ty + y]);
  let key = null;
  if (th.needKey && !o.demo) {
    let bs = -1;
    for (const i of cands) {
      if (d[i] < maxD * 0.3 || d[i] > maxD * 0.85) continue;
      const tx = i % mw, ty = (i / mw) | 0, e = Math.hypot(tx - D.tx, ty - D.ty);
      if (e > bs) { bs = e; key = { tx, ty }; }
    }
    if (key) used.push([key.tx, key.ty]);
  }
  const place = (count, minD) => {
    const out = [];
    for (const i of cands) {
      if (out.length >= count) break;
      if (d[i] < minD) continue;
      const tx = i % mw, ty = (i / mw) | 0;
      if (used.some((u) => Math.abs(u[0] - tx) + Math.abs(u[1] - ty) < 4)) continue;
      out.push({ tx, ty }); used.push([tx, ty]);
    }
    return out;
  };
  const demo = !!o.demo;
  const ids = o.noteIds || [];
  const notes = demo ? [] : place(ids.length, 5).map((p, k) => ({ ...p, id: ids[k] }));
  const water = demo ? [] : place(o.water ?? th.water, 4);
  const batt = demo ? [] : place(o.batt ?? th.batt, 4);
  // тайная комната: только на уровне 0
  let secret = null, W2 = mw;
  if (th.secret && o.allowSecret && !demo) {
    const ys = [];
    for (let y = 3; y <= mh - 4; y += 2) {
      const i = y * mw + (mw - 2);
      if (g[i] !== 0 || d[i] < maxD * 0.35) continue;
      if (D.tx === mw - 1 && Math.abs(D.ty - y) <= 2) continue;
      if (used.some((u) => u[0] === mw - 2 && u[1] === y)) continue;
      ys.push(y);
    }
    if (!ys.length) for (let y = 3; y <= mh - 4; y += 2) if (g[y * mw + mw - 2] === 0 && !(D.tx === mw - 1 && Math.abs(D.ty - y) <= 2)) ys.push(y);
    if (ys.length) {
      const fy = ys[(r() * ys.length) | 0];
      W2 = mw + 4;
      const g2 = new Uint8Array(W2 * mh).fill(1);
      for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) g2[y * W2 + x] = g[y * mw + x];
      g2[fy * W2 + mw - 1] = 3;
      for (let y = fy - 1; y <= fy + 1; y++) for (let x = mw; x <= mw + 2; x++) g2[y * W2 + x] = 4;
      g = g2;
      secret = { fx: mw - 1, fy, cx: mw + 1, cy: fy, kind: th.secret };
    }
  }
  return { g, mw: W2, mh, spawn: { tx: sx, ty: sy, yaw }, door: D, key, notes, water, batt, secret, rooms, used, zones: world ? world.zones : null, finds };
}

// ---------------------------------------------------------------------------
class GB {
  constructor() { this.pos = []; this.nor = []; this.uv = []; this.bk = []; this.idx = []; this.vc = 0; }
  grid(o, u, v, n, us, vs, uvf, bakef) {
    const base = this.vc, out = [0, 0, 0];
    for (let j = 0; j < vs.length; j++) for (let i = 0; i < us.length; i++) {
      const fu = us[i], fv = vs[j];
      const x = o[0] + u[0] * fu + v[0] * fv, y = o[1] + u[1] * fu + v[1] * fv, z = o[2] + u[2] * fu + v[2] * fv;
      this.pos.push(x, y, z); this.nor.push(n[0], n[1], n[2]);
      const t = uvf(fu, fv, x, y, z); this.uv.push(t[0], t[1]);
      bakef(x, y, z, n, out); this.bk.push(out[0], out[1], out[2]);
      this.vc++;
    }
    const nu = us.length;
    for (let j = 0; j < vs.length - 1; j++) for (let i = 0; i < nu - 1; i++) {
      const a = base + j * nu + i, b = a + 1, c = a + nu + 1, e = a + nu;
      this.idx.push(a, b, c, a, c, e);
    }
  }
  geom() {
    if (!this.vc) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('bake', new THREE.Float32BufferAttribute(this.bk, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

// Тот же интерфейс, что у GB, но геометрия раскладывается по квадратам CH×CH клеток,
// чтобы камера отсекала невидимые части мира (frustum culling).
const CH = 12;
class CGB {
  constructor() { this.parts = new Map(); }
  grid(o, ...rest) {
    const k = Math.floor(o[0] / (S * CH)) + ',' + Math.floor(o[2] / (S * CH));
    let gb = this.parts.get(k); if (!gb) { gb = new GB(); this.parts.set(k, gb); }
    gb.grid(o, ...rest);
  }
  get vc() { let n = 0; for (const gb of this.parts.values()) n += gb.vc; return n; }
  geoms() { return [...this.parts.values()].map((gb) => gb.geom()).filter(Boolean); }
}
GB.prototype.geoms = function () { const g = this.geom(); return g ? [g] : []; };

function bakedMat(map, uni = BAKE, extra = {}) {
  const m = new THREE.MeshLambertMaterial(Object.assign({ map }, extra));
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uBake = uni; sh.uniforms.uAmbK = AMBK;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 bake;\nvarying vec3 vBake;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvBake = bake;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBake;\nuniform float uBake;\nuniform float uAmbK;')
      .replace('#include <lights_fragment_maps>', '#include <lights_fragment_maps>\n\tirradiance = irradiance * uAmbK + vBake * uBake;');
  };
  m.customProgramCacheKey = () => 'zk-baked';
  return m;
}

const floorListCount = (g) => { let n = 0; for (let i = 0; i < g.length; i++) if (g[i] === 0) n++; return n; };
const box = (w, h, d, x, y, z, ry = 0) => { const b = new THREE.BoxGeometry(w, h, d); if (ry) b.rotateY(ry); b.translate(x, y, z); return b; };

// ---------------------------------------------------------------------------
function buildLevel(th, G, opts = {}) {
  const { g, mw, mh } = G;
  const HH = th.h || H;
  const root = new THREE.Group();
  const textures = [];
  const add = (o) => { root.add(o); return o; };
  const tile = (x, y) => (x < 0 || y < 0 || x >= mw || y >= mh) ? 1 : g[y * mw + x];
  const r = rng((opts.seed || 1) ^ 0x9e3779b9);
  const aniso = opts.aniso || 4;
  const tex = (c, o = {}) => { const t = TX.toTex(c, Object.assign({ aniso }, o)); textures.push(t); return t; };
  const lampI = th.lampI || 1;
  const floorY = (t) => (t === 6 ? -PD : 0);
  const noCeil = !!th.noCeil, LY = noCeil ? HH - 0.5 : HH - 0.04;

  // --- лампы
  const lamps = [];
  for (let ty = 1; ty < mh; ty += 3) for (let tx = 1; tx < mw; tx += 3) {
    const t = tile(tx, ty);
    if (t !== 0 && t !== 5 && t !== 6) continue;
    const dead = r() < th.dead;
    const emerg = !dead && th.props === 'emergency' && r() < 0.3;
    lamps.push({ x: tx * S + S / 2, z: ty * S + S / 2, dead, emerg, on5: t === 5 });
  }
  const LC = th.lampCol, EC = [1, 0.14, 0.08];

  const D = G.door;
  const dnx = D.fx - D.tx, dnz = D.fy - D.ty;
  const dfx = (D.tx + 0.5 + dnx * 0.5) * S, dfz = (D.ty + 0.5 + dnz * 0.5) * S;
  const sign = { x: dfx + dnx * 0.3, y: 2.33, z: dfz + dnz * 0.3 };

  const vis = (x0, z0, x1, z1) => {
    const dx = x1 - x0, dz = z1 - z0, len = Math.hypot(dx, dz), steps = Math.ceil(len / 0.3);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (solidSight(tile(Math.floor((x0 + dx * t) / S), Math.floor((z0 + dz * t) / S)))) return false;
    }
    return true;
  };

  function lightAt(x, y, z, nx, ny, nz, out) {
    let R = 0.05, Gc = 0.045, B = 0.036;
    const ox = x + nx * 0.1, oz = z + nz * 0.1;
    for (const L of lamps) {
      if (L.dead || L.on5) continue;
      const dx = L.x - x, dy = LY - y, dz = L.z - z, hd2 = dx * dx + dz * dz;
      if (hd2 > 110) continue;
      const col = L.emerg ? EC : LC, pw = (L.emerg ? 0.5 : 1) * lampI;
      if (ny < -0.5) {
        if (hd2 < 40 && vis(L.x, L.z, ox, oz)) { const k = pw * 0.32 / (1 + hd2 * 0.38) / lampI ** 0.5; R += col[0] * k; Gc += col[1] * k; B += col[2] * k; }
        continue;
      }
      const d2 = hd2 + dy * dy, dd = Math.sqrt(d2);
      const ndl = (dx * nx + dy * ny + dz * nz) / dd;
      if (ndl <= 0) continue;
      if (!vis(L.x, L.z, ox, oz)) continue;
      const k = pw * ndl * (0.35 + 0.65 * Math.max(0, dy / dd)) * 2.6 / (1 + d2 * 0.4);
      R += col[0] * k; Gc += col[1] * k; B += col[2] * k;
    }
    if (!opts.demo) {
      const dx = sign.x - x, dy = sign.y - y, dz = sign.z - z, d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < 30 && vis(sign.x, sign.z, ox, oz)) { const k = 0.55 / (1 + d2 * 1.0); R += 0.15 * k; Gc += 1.0 * k; B += 0.4 * k; }
    }
    out[0] = R; out[1] = Gc; out[2] = B;
  }
  function aoXZ(x, z, ex, ey) {
    const tx = Math.floor(x / S), ty = Math.floor(z / S); let ao = 1;
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      const X = tx + ox, Y = ty + oy;
      if (X === ex && Y === ey) continue;
      const t = tile(X, Y);
      if (!solidSight(t)) continue;
      const cx = clamp(x, X * S, X * S + S), cz = clamp(z, Y * S, Y * S + S);
      const dd = Math.hypot(x - cx, z - cz);
      const lim = t === 5 ? 0.5 : 0.75;
      if (dd < lim) ao *= (t === 5 ? 0.72 : 0.6) + (t === 5 ? 0.28 : 0.4) * smooth(dd / lim);
    }
    return ao;
  }
  const sc = G.secret;
  const hx = sc ? (sc.cx + 0.5) * S : 0, hz = sc ? (sc.cy + 0.5) * S : 0;
  function roomLight(x, y, z, out) {
    const dx = hx - x, dy = 1.45 - y, dz = hz - z, d2 = dx * dx + dy * dy + dz * dz;
    const k = 1.25 / (1 + d2 * 0.22), kind = sc.kind;
    if (kind === 'smile') { out[0] = 0.42 + 1.0 * k; out[1] = 0.32 + 0.75 * k; out[2] = 0.16 + 0.3 * k; }
    else if (kind === 'circus') { out[0] = 0.4 + 1.0 * k; out[1] = 0.18 + 0.4 * k; out[2] = 0.32 + 0.7 * k; }
    else { out[0] = 0.34 + 1.0 * k; out[1] = 0.17 + 0.36 * k; out[2] = 0.22 + 0.5 * k; }
  }
  const mul = (o, a) => { o[0] *= a; o[1] *= a; o[2] *= a; };

  // --- геометрия
  const FU = [0, 0.14, 0.5, 0.86, 1];
  const WU = [0, 0.5, 1];
  const tallRepeat = th.wall === 'concrete' || th.wall === 'tiles';
  const gW = new CGB(), gF = new CGB(), gC = new CGB(), gD = new GB(), gRW = new GB(), gRF = new GB(), gRC = new GB(), gP = new CGB(), gPS = new CGB();
  const floorBake = (x, y, z, n, o) => { lightAt(x, y, z, 0, 1, 0, o); mul(o, aoXZ(x, z, -9, -9)); };
  const ceilBake = (x, y, z, n, o) => { lightAt(x, y, z, 0, -1, 0, o); mul(o, 0.72 + 0.28 * aoXZ(x, z, -9, -9)); };
  const rFloorBake = (x, y, z, n, o) => { roomLight(x, y, z, o); mul(o, aoXZ(x, z, -9, -9)); };
  const rCeilBake = (x, y, z, n, o) => { roomLight(x, y, z, o); mul(o, 0.6 + 0.3 * aoXZ(x, z, -9, -9)); };
  const wallBake = (ex, ey, y0) => (x, y, z, nn, out) => {
    lightAt(x, y, z, nn[0], nn[1], nn[2], out);
    mul(out, aoXZ(x + nn[0] * 0.02, z + nn[2] * 0.02, ex, ey) * (0.55 + 0.45 * smooth((y - y0) / 0.5)) * (0.8 + 0.2 * smooth((HH - y) / 0.4)));
  };
  const faceOf = (tx, ty, dx, dy, y0) => {
    const x0 = tx * S, z0 = ty * S, x1 = x0 + S, z1 = z0 + S;
    if (dx === 1) return [[x1, y0, z0], [0, 0, S], [-1, 0, 0]];
    if (dx === -1) return [[x0, y0, z1], [0, 0, -S], [1, 0, 0]];
    if (dy === 1) return [[x1, y0, z1], [-S, 0, 0], [0, 0, -1]];
    return [[x0, y0, z0], [S, 0, 0], [0, 0, 1]];
  };
  for (let ty = 0; ty < mh; ty++) for (let tx = 0; tx < mw; tx++) {
    const t = g[ty * mw + tx];
    if (t !== 0 && t !== 4 && t !== 5 && t !== 6) continue;
    const room = t === 4, x0 = tx * S, z0 = ty * S, x1 = x0 + S, z1 = z0 + S, fy = floorY(t);
    const fb = room ? gRF : t === 6 ? gP : gF;
    fb.grid([x0, fy, z1], [S, 0, 0], [0, 0, -S], [0, 1, 0], FU, FU, (fu, fv, x, y, z) => [x / S, -z / S], room ? rFloorBake : floorBake);
    if (!noCeil || room) (room ? gRC : gC).grid([x0, HH, z0], [S, 0, 0], [0, 0, S], [0, -1, 0], FU, FU, (fu, fv, x, y, z) => [x / S, z / S], room ? rCeilBake : ceilBake);
    if (t === 5) continue;
    for (const [dx, dy] of DIRS) {
      const nt = tile(tx + dx, ty + dy);
      if (t === 6 && (nt === 0 || nt === 5)) {
        // бортик бассейна от дна до пола
        const [o, u, n] = faceOf(tx, ty, dx, dy, -PD);
        gPS.grid(o, u, [0, PD, 0], n, WU, [0, 0.5, 1], (fu, fv) => [fu, fv * PD / S], wallBake(tx + dx, ty + dy, -PD));
        continue;
      }
      if (!solidSight(nt) || nt === 5) continue;
      const [o, u, n] = faceOf(tx, ty, dx, dy, fy);
      const hgt = HH - fy;
      const vs = [0, 0.05, 0.16, 0.42, 0.72, 0.92, 1];
      const b = room ? gRW : nt === 2 ? gD : gW;
      const uvf = (b === gW && tallRepeat) ? (fu, fv) => [fu, fv * hgt / H] : (fu, fv) => [fu, fv];
      b.grid(o, u, [0, hgt, 0], n, WU, vs, uvf, room
        ? (x, y, z, nn, out) => { roomLight(x, y, z, out); mul(out, aoXZ(x + nn[0] * 0.02, z + nn[2] * 0.02, tx + dx, ty + dy) * (0.6 + 0.4 * smooth(y / 0.5))); }
        : wallBake(tx + dx, ty + dy, fy));
    }
  }
  const wallT = tex(TX.wallCanvas(th, r), { clampT: !tallRepeat });
  const floorT = tex(TX.floorCanvas(th, r));
  const ceilT = tex(TX.ceilCanvas(th, r));
  const mWall = bakedMat(wallT, BAKE, { bumpMap: wallT, bumpScale: 1.2 });
  const mFloor = bakedMat(floorT, BAKE, { bumpMap: floorT, bumpScale: 1.5 });
  const mCeil = bakedMat(ceilT);
  const mesh = (gb, m) => { for (const geo of gb.geoms()) add(new THREE.Mesh(geo, m)); };
  mesh(gW, mWall); mesh(gF, mFloor); mesh(gC, mCeil);

  // --- лампы на потолке
  const lampT = tex(TX.lampCanvas(), { repeat: false });
  const lampGeo = new THREE.BoxGeometry(1.2, 0.05, 1.2);
  const frameGeo = new THREE.BoxGeometry(1.3, 0.03, 1.3);
  const lampMat = new THREE.MeshBasicMaterial({ map: lampT, color: new THREE.Color().fromArray(LC).multiplyScalar(3.2) });
  const emMat = new THREE.MeshBasicMaterial({ map: lampT, color: new THREE.Color().fromArray(EC).multiplyScalar(2.2) });
  const deadMat = new THREE.MeshLambertMaterial({ map: lampT, color: 0x56544c });
  const frameMat = new THREE.MeshLambertMaterial({ color: 0x77746a });
  const m4 = new THREE.Matrix4(), WHITE = new THREE.Color(1, 1, 1);
  const inst = (list, geo, mat, y) => {
    if (!list.length) return null;
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((l, i) => { m4.makeTranslation(l.x, y, l.z); im.setMatrixAt(i, m4); im.setColorAt(i, WHITE); });
    im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
    return add(im);
  };
  const lit = lamps.filter((l) => !l.on5);
  const alive = lit.filter((l) => !l.dead && !l.emerg), em = lit.filter((l) => l.emerg), dd = lit.filter((l) => l.dead);
  let lampIM;
  if (noCeil) {
    const bulb = new THREE.SphereGeometry(0.16, 14, 10);
    lampIM = inst(alive, bulb, lampMat, LY); inst(em, bulb, emMat, LY); inst(dd, bulb, deadMat, LY);
  } else {
    inst(lit, frameGeo, frameMat, HH - 0.012);
    lampIM = inst(alive, lampGeo, lampMat, HH - 0.03);
    inst(em, lampGeo, emMat, HH - 0.03);
    inst(dd, lampGeo, deadMat, HH - 0.03);
  }
  const flick = { i: -1, t: 0, burst: false };

  // --- дверь, табличка, кодовый замок
  let keypadMat = null;
  if (!opts.demo) {
    mesh(gD, bakedMat(tex(TX.doorCanvas(th, r), { clampT: true })));
    const signMat = new THREE.MeshBasicMaterial({ map: tex(TX.signCanvas(), { repeat: false }), color: new THREE.Color(1.9, 1.9, 1.9) });
    const side = new THREE.MeshLambertMaterial({ color: 0x1d2a20 });
    const sg = add(new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.24, 0.06), [side, side, side, side, signMat, side]));
    sg.position.set(dfx + dnx * 0.03, 2.33, dfz + dnz * 0.03); sg.rotation.y = Math.atan2(dnx, dnz);
    const tx_ = -dnz, tz_ = dnx;
    const kp = add(new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.17, 0.04), new THREE.MeshLambertMaterial({ color: 0x24252a })));
    kp.position.set(dfx + tx_ * 0.66 + dnx * 0.02, 1.15, dfz + tz_ * 0.66 + dnz * 0.02); kp.rotation.y = sg.rotation.y;
    keypadMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.2, 0.1) });
    const kl = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.035, 0.01), keypadMat); kl.position.set(0, 0.05, 0.022); kp.add(kl);
  }

  // --- реквизит
  const colliders = [];
  const reserved = new Set(G.used.map((u) => u[0] + ',' + u[1]));
  const isRes = (tx, ty) => reserved.has(tx + ',' + ty);
  if (th.props === 'pipes') {
    const geos = [];
    for (let ty = 0; ty < mh; ty++) for (let tx = 0; tx < mw; tx++) {
      if (g[ty * mw + tx] !== 0) continue;
      for (const [dx, dy] of DIRS) {
        if (tile(tx + dx, ty + dy) !== 1 || r() > 0.22) continue;
        for (const [rad, yy, off] of r() < 0.4 ? [[0.075, HH - 0.22, 0.2], [0.045, HH - 0.42, 0.14]] : [[0.075, HH - 0.22, 0.2]]) {
          const c = new THREE.CylinderGeometry(rad, rad, S, 10);
          if (dx !== 0) { c.rotateX(Math.PI / 2); c.translate((tx + 0.5 + dx * 0.5) * S - dx * off, yy, (ty + 0.5) * S); }
          else { c.rotateZ(Math.PI / 2); c.translate((tx + 0.5) * S, yy, (ty + 0.5 + dy * 0.5) * S - dy * off); }
          geos.push(c);
        }
      }
    }
    if (geos.length) add(new THREE.Mesh(mergeGeometries(geos), new THREE.MeshLambertMaterial({ color: 0x5a5e60 })));
  }
  const puddles = []; // [x, z, радиус] — для звука шагов по лужам
  if (th.props === 'puddles') {
    const geos = [];
    for (let ty = 0; ty < mh; ty++) for (let tx = 0; tx < mw; tx++) {
      if (g[ty * mw + tx] !== 0 || r() > 0.24) continue;
      const rad = 0.35 + r() * 0.45;
      const c = new THREE.CircleGeometry(rad, 20);
      c.rotateX(-Math.PI / 2); c.scale(1, 1, 0.5 + r() * 0.4); c.rotateY(r() * Math.PI);
      const px = (tx + 0.5) * S + (r() - 0.5) * 0.7, pz = (ty + 0.5) * S + (r() - 0.5) * 0.7;
      c.translate(px, 0.006, pz); puddles.push([px, pz, rad * 0.85]);
      geos.push(c);
    }
    if (geos.length) add(new THREE.Mesh(mergeGeometries(geos), new THREE.MeshStandardMaterial({ color: 0x1c2410, roughness: 0.04, metalness: 0.35, transparent: true, opacity: 0.38, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 })));
  }
  if (th.props === 'office') {
    const desk = [], chair = [], mon = [], scr = [];
    for (const rm of G.rooms) for (let ty = rm.y0; ty <= rm.y1; ty++) for (let tx = rm.x0; tx <= rm.x1; tx++) {
      if (tile(tx, ty) !== 0 || isRes(tx, ty)) continue;
      if (!DIRS.every(([a, b]) => tile(tx + a, ty + b) === 0)) continue;
      if (r() < 0.4) continue;
      reserved.add(tx + ',' + ty);
      const cx = (tx + 0.5) * S, cz = (ty + 0.5) * S, rot = r() < 0.5 ? 0 : Math.PI / 2;
      const c = Math.cos(rot), s = Math.sin(rot);
      const P = (lx, lz) => [cx + lx * c + lz * s, cz - lx * s + lz * c];
      const b = (arr, w, h, d_, lx, y, lz) => { const p = P(lx, lz); arr.push(box(w, h, d_, p[0], y, p[1], rot)); };
      b(desk, 1.4, 0.05, 0.7, 0, 0.74, 0);
      for (const ax of [-0.66, 0.66]) for (const az of [-0.31, 0.31]) b(desk, 0.05, 0.72, 0.05, ax, 0.36, az);
      b(desk, 1.3, 0.4, 0.02, 0, 0.5, -0.33);
      b(mon, 0.52, 0.34, 0.04, 0, 1.0, -0.2); b(mon, 0.06, 0.2, 0.06, 0, 0.83, -0.22); b(mon, 0.22, 0.02, 0.16, 0, 0.775, -0.22);
      const sp = new THREE.PlaneGeometry(0.47, 0.29); sp.rotateY(rot); const pp = P(0, -0.177); sp.translate(pp[0], 1.0, pp[1]); scr.push(sp);
      const cr = rot + (r() - 0.5) * 0.8, ccos = Math.cos(cr), csin = Math.sin(cr), cp = P(0, 0.62);
      const cb = (w, h, d_, lx, y, lz) => chair.push(box(w, h, d_, cp[0] + lx * ccos + lz * csin, y, cp[1] - lx * csin + lz * ccos, cr));
      cb(0.48, 0.07, 0.46, 0, 0.48, 0); cb(0.46, 0.5, 0.06, 0, 0.8, 0.22); cb(0.05, 0.42, 0.05, 0, 0.24, 0); cb(0.5, 0.04, 0.5, 0, 0.03, 0);
      const hw = rot === 0 ? 0.72 : 0.37, hd = rot === 0 ? 0.37 : 0.72;
      colliders.push({ x0: cx - hw, x1: cx + hw, z0: cz - hd, z1: cz + hd });
      colliders.push({ x0: cp[0] - 0.24, x1: cp[0] + 0.24, z0: cp[1] - 0.24, z1: cp[1] + 0.24 });
    }
    if (desk.length) {
      add(new THREE.Mesh(mergeGeometries(desk), new THREE.MeshLambertMaterial({ color: 0x7c6b55 })));
      add(new THREE.Mesh(mergeGeometries(chair), new THREE.MeshLambertMaterial({ color: 0x2a2c31 })));
      add(new THREE.Mesh(mergeGeometries(mon), new THREE.MeshLambertMaterial({ color: 0x1d1e22 })));
      add(new THREE.Mesh(mergeGeometries(scr), new THREE.MeshBasicMaterial({ map: tex(TX.screenCanvas(), { repeat: false }), color: new THREE.Color(1.3, 1.3, 1.3) })));
    }
  }
  if (th.props === 'cars') {
    // колонны в узлах сетки и брошенные машины
    const pil = [];
    for (let ty = 3; ty < mh - 1; ty += 3) for (let tx = 3; tx < mw - 1; tx += 3) {
      if (![tile(tx, ty), tile(tx - 1, ty), tile(tx, ty - 1), tile(tx - 1, ty - 1)].every((t) => t === 0)) continue;
      pil.push(box(0.6, HH, 0.6, tx * S, HH / 2, ty * S));
      colliders.push({ x0: tx * S - 0.3, x1: tx * S + 0.3, z0: ty * S - 0.3, z1: ty * S + 0.3 });
    }
    if (pil.length) add(new THREE.Mesh(mergeGeometries(pil), new THREE.MeshLambertMaterial({ map: tex(TX.pillarCanvas(r), { repeat: false }) })));
    const COLS = [0x6e2020, 0x2f4a6b, 0x6b6b5e, 0x34503a, 0xb0a894, 0x3a3a40];
    const byCol = COLS.map(() => []), glass = [], wheels = [];
    let cars = 0;
    const want = Math.round(mw * mh / 22);
    for (let k = 0; k < 400 && cars < want; k++) {
      const tx = 2 + ((r() * (mw - 4)) | 0), ty = 2 + ((r() * (mh - 5)) | 0);
      const ok = [[0, 0], [0, 1], [-1, 0], [1, 0], [-1, 1], [1, 1]].every(([a, b]) => tile(tx + a, ty + b) === 0 && !isRes(tx + a, ty + b));
      if (!ok) continue;
      reserved.add(tx + ',' + ty); reserved.add(tx + ',' + (ty + 1));
      const cx = (tx + 0.5) * S + (r() - 0.5) * 0.2, cz = (ty + 1) * S, rot = (r() < 0.5 ? 0 : Math.PI) + (r() - 0.5) * 0.12;
      const ci = (r() * COLS.length) | 0;
      const part = (arr, w, h, d_, lx, y, lz) => { const c = Math.cos(rot), s = Math.sin(rot); arr.push(box(w, h, d_, cx + lx * c + lz * s, y, cz - lx * s + lz * c, rot)); };
      part(byCol[ci], 1.78, 0.62, 4.2, 0, 0.6, 0);
      part(byCol[ci], 1.6, 0.5, 2.1, 0, 1.15, -0.2);
      part(glass, 1.62, 0.36, 2.0, 0, 1.17, -0.2);
      for (const wx of [-0.82, 0.82]) for (const wz of [-1.35, 1.35]) {
        const wg = new THREE.CylinderGeometry(0.33, 0.33, 0.24, 12); wg.rotateZ(Math.PI / 2); wg.rotateY(rot);
        const c = Math.cos(rot), s = Math.sin(rot); wg.translate(cx + wx * c + wz * s, 0.33, cz - wx * s + wz * c); wheels.push(wg);
      }
      colliders.push({ x0: cx - 0.95, x1: cx + 0.95, z0: cz - 2.15, z1: cz + 2.15 });
      cars++;
    }
    byCol.forEach((arr, k) => { if (arr.length) add(new THREE.Mesh(mergeGeometries(arr), new THREE.MeshStandardMaterial({ color: COLS[k], roughness: 0.55, metalness: 0.35 }))); });
    if (glass.length) add(new THREE.Mesh(mergeGeometries(glass), new THREE.MeshStandardMaterial({ color: 0x0b0e12, roughness: 0.1, metalness: 0.6 })));
    if (wheels.length) add(new THREE.Mesh(mergeGeometries(wheels), new THREE.MeshLambertMaterial({ color: 0x141414 })));
  }
  if (th.props === 'shelves') {
    const metalB = [], metalO = [], boxes = [];
    const top = Math.min(HH - 0.6, 4.0), levels = [0.12, 1.1, 2.1, 3.1].filter((y) => y < top - 0.3);
    for (let ty = 0; ty < mh; ty++) for (let tx = 0; tx < mw; tx++) {
      if (g[ty * mw + tx] !== 5) continue;
      const cx = (tx + 0.5) * S, cz = (ty + 0.5) * S;
      for (const px of [-0.95, 0.95]) for (const pz of [-0.45, 0.45]) metalB.push(box(0.07, top, 0.07, cx + px, top / 2, cz + pz));
      for (const y of levels) {
        metalO.push(box(S, 0.08, 0.06, cx, y + 0.04, cz - 0.45)); metalO.push(box(S, 0.08, 0.06, cx, y + 0.04, cz + 0.45));
        metalB.push(box(S - 0.06, 0.02, 0.9, cx, y + 0.09, cz));
        let x = -0.9;
        while (x < 0.8) {
          const w = 0.35 + r() * 0.45; if (x + w > 0.95) break;
          if (r() < 0.82) { const h = 0.3 + r() * 0.5, d_ = 0.5 + r() * 0.35; boxes.push(box(w - 0.04, Math.min(h, 0.9), d_, cx + x + w / 2, y + 0.1 + Math.min(h, 0.9) / 2, cz + (r() - 0.5) * 0.15, (r() - 0.5) * 0.15)); }
          x += w;
        }
      }
    }
    if (metalB.length) {
      add(new THREE.Mesh(mergeGeometries(metalB), new THREE.MeshLambertMaterial({ color: 0x2e4a73 })));
      add(new THREE.Mesh(mergeGeometries(metalO), new THREE.MeshLambertMaterial({ color: 0xd06a1c })));
      add(new THREE.Mesh(mergeGeometries(boxes), new THREE.MeshLambertMaterial({ map: tex(TX.boxCanvas(r), { repeat: false }) })));
    }
  }
  let water = null;
  if (gP.vc) {
    const pit = th.props === 'smiles';
    const pt = tex(pit ? TX.padCanvas(r) : TX.poolBottomCanvas(r));
    mesh(gP, bakedMat(pt)); mesh(gPS, bakedMat(pit ? pt : floorT));
  }
  if (th.props !== 'smiles') {
    const wg = [];
    for (let ty = 0; ty < mh; ty++) for (let tx = 0; tx < mw; tx++) {
      if (g[ty * mw + tx] !== 6) continue;
      const p = new THREE.PlaneGeometry(S, S); p.rotateX(-Math.PI / 2); p.translate((tx + 0.5) * S, -0.14, (ty + 0.5) * S); wg.push(p);
    }
    if (wg.length) {
      const nT = TX.toTex(TX.waveNormalCanvas(r), { aniso }); nT.colorSpace = THREE.NoColorSpace; textures.push(nT);
      const geo = mergeGeometries(wg);
      const uv = geo.attributes.uv, pos = geo.attributes.position;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) / 4, pos.getZ(i) / 4);
      const wm = new THREE.MeshStandardMaterial({ color: 0x8fe0f0, transparent: true, opacity: 0.5, roughness: 0.06, metalness: 0.1, normalMap: nT, normalScale: new THREE.Vector2(0.5, 0.5), emissive: 0x0c4652, emissiveIntensity: 0.8, depthWrite: false });
      water = add(new THREE.Mesh(geo, wm));
      water.renderOrder = 2;
    }
  }

  // --- Улыбки: плакаты, неон, мягкие блоки, шарики в бассейнах
  const anim = [];
  const faces = [];
  if (th.props === 'smiles' || th.props === 'circus') {
    for (let ty = 1; ty < mh - 1; ty++) for (let tx = 1; tx < mw - 1; tx++) {
      if (g[ty * mw + tx] !== 0 || isRes(tx, ty)) continue;
      for (const [a, b] of DIRS) if (tile(tx + a, ty + b) === 1) faces.push([tx, ty, a, b]);
    }
    for (let i = faces.length - 1; i > 0; i--) { const j = (r() * (i + 1)) | 0; const t = faces[i]; faces[i] = faces[j]; faces[j] = t; }
  }
  const onWall = (f, w, h, y, mat, off = 0.012) => {
    const [tx, ty, a, b] = f, m = add(new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat));
    m.position.set((tx + 0.5 + a * 0.5) * S - a * off + (b !== 0 ? (r() - 0.5) * 0.6 : 0), y, (ty + 0.5 + b * 0.5) * S - b * off + (a !== 0 ? (r() - 0.5) * 0.6 : 0));
    m.rotation.y = Math.atan2(-a, -b); return m;
  };
  if (th.props === 'smiles') {
    const pm = [0, 1, 2, 3].map((k) => new THREE.MeshLambertMaterial({ map: tex(TX.posterCanvas(k, r), { repeat: false }) }));
    const nm = new THREE.MeshBasicMaterial({ map: tex(TX.neonSmileCanvas(), { repeat: false }), color: new THREE.Color(1.7, 1.6, 1.3) });
    let k = 0;
    for (const f of faces) {
      if (k < 18) onWall(f, 0.72, 0.96, 1.45 + (r() - 0.5) * 0.3, pm[k % 4]);
      else if (k < 24) onWall(f, 0.9, 0.9, 1.9, nm);
      else break;
      k++;
    }
    const blocks = [], COL = [0xe8483f, 0x3d7fe0, 0x3fbf62, 0xf28a30, 0xc06ad8];
    const bm = COL.map((c) => []);
    for (let ty = 1; ty < mh - 1; ty++) for (let tx = 1; tx < mw - 1; tx++) {
      if (g[ty * mw + tx] !== 0 || isRes(tx, ty) || r() > 0.07) continue;
      if (!DIRS.every(([a, b]) => tile(tx + a, ty + b) === 0)) continue;
      reserved.add(tx + ',' + ty);
      const cx = (tx + 0.5) * S + (r() - 0.5) * 0.6, cz = (ty + 0.5) * S + (r() - 0.5) * 0.6, n = 1 + ((r() * 3) | 0);
      for (let q = 0; q < n; q++) bm[(r() * COL.length) | 0].push(box(0.55, 0.55, 0.55, cx + (r() - 0.5) * 0.08, 0.275 + q * 0.55, cz + (r() - 0.5) * 0.08, r() * 0.5));
      colliders.push({ x0: cx - 0.33, x1: cx + 0.33, z0: cz - 0.33, z1: cz + 0.33 });
    }
    bm.forEach((arr, i) => { if (arr.length) add(new THREE.Mesh(mergeGeometries(arr), new THREE.MeshLambertMaterial({ color: COL[i] }))); });
    const pits = []; for (let i = 0; i < g.length; i++) if (g[i] === 6) pits.push(i);
    if (pits.length) {
      // Верхний слой шариков — текстура на плоскости, под ней немного объёмных шариков.
      // Шарики разложены по квадратам мира, чтобы невидимые не рисовались.
      const BCs = ['#e8483f', '#3d7fe0', '#3fbf62', '#f2c230', '#ff8fb1', '#f28a30'];
      const bc = TX.canvas(256, 256), bx = bc.getContext('2d');
      bx.fillStyle = '#2a2a2a'; bx.fillRect(0, 0, 256, 256);
      for (let k2 = 0; k2 < 900; k2++) {
        const x = r() * 256, y = r() * 256, rad = 9 + r() * 3, col = BCs[(r() * BCs.length) | 0];
        const gr = bx.createRadialGradient(x - rad * 0.35, y - rad * 0.35, rad * 0.1, x, y, rad);
        gr.addColorStop(0, '#ffffffcc'); gr.addColorStop(0.25, col); gr.addColorStop(1, '#00000088');
        bx.fillStyle = gr; bx.beginPath(); bx.arc(x, y, rad, 0, Math.PI * 2); bx.fill();
        for (const [ox, oy] of [[256, 0], [-256, 0], [0, 256], [0, -256]]) { bx.beginPath(); bx.arc(x + ox, y + oy, rad, 0, Math.PI * 2); bx.fill(); }
      }
      const bT = tex(bc), pg = [];
      const per = 24, ball = new THREE.SphereGeometry(0.085, 7, 5);
      const BC = BCs.map((c) => new THREE.Color(c));
      const byChunk = new Map();
      for (const i of pits) {
        const tx = i % mw, ty = (i / mw) | 0;
        const p = new THREE.PlaneGeometry(S, S); p.rotateX(-Math.PI / 2); p.translate((tx + 0.5) * S, -0.11, (ty + 0.5) * S); pg.push(p);
        const k = ((tx / CH) | 0) + ',' + ((ty / CH) | 0); if (!byChunk.has(k)) byChunk.set(k, []); byChunk.get(k).push(i);
      }
      if (pg.length) {
        const geo = mergeGeometries(pg), uv = geo.attributes.uv, pos = geo.attributes.position;
        for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) / 2.2, pos.getZ(i) / 2.2);
        add(new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: bT })));
      }
      const bMat = new THREE.MeshLambertMaterial();
      for (const list of byChunk.values()) {
        const im = new THREE.InstancedMesh(ball, bMat, list.length * per);
        let q = 0;
        for (const i of list) {
          const tx = i % mw, ty = (i / mw) | 0;
          for (let k2 = 0; k2 < per; k2++) {
            m4.makeTranslation((tx + 0.06 + r() * 0.88) * S, -0.07 - r() * 0.03, (ty + 0.06 + r() * 0.88) * S);
            im.setMatrixAt(q, m4); im.setColorAt(q, BC[(r() * BC.length) | 0]); q++;
          }
        }
        im.instanceMatrix.needsUpdate = true; im.instanceColor.needsUpdate = true; im.computeBoundingSphere(); add(im);
      }
    }
  }
  // --- Пиксельный цирк: шатёр, кольцо, барабаны, шары, гирлянды, цифровое небо
  let circus = null;
  if (th.props === 'circus') {
    const cx = (mw >> 1) * S + S / 2, cz = (mh >> 1) * S + S / 2;
    const sky = add(new THREE.Mesh(new THREE.SphereGeometry(150, 40, 20), new THREE.MeshBasicMaterial({ map: tex(TX.gridCanvas(), {}), color: new THREE.Color(1.5, 1.4, 1.8), side: THREE.BackSide, fog: false, depthWrite: false })));
    sky.material.map.repeat.set(48, 24); sky.position.set(cx, 0, cz); sky.renderOrder = -1;
    const tentT = tex(TX.tentCanvas(), {}); tentT.repeat.set(3, 1);
    const tm = new THREE.MeshLambertMaterial({ map: tentT, side: THREE.DoubleSide, emissive: 0x2a0508 });
    const Rt = 7.2;
    const cone = add(new THREE.Mesh(new THREE.ConeGeometry(Rt, 5.5, 32, 1, true), tm)); cone.position.set(cx, HH + 0.6 + 2.75, cz);
    const val = add(new THREE.Mesh(new THREE.CylinderGeometry(Rt, Rt, 0.7, 32, 1, true), tm)); val.position.set(cx, HH + 0.25, cz);
    const gold = new THREE.MeshLambertMaterial({ color: 0xd6a434, emissive: 0x302008 });
    const pole = add(new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.16, HH + 6.4, 12), gold)); pole.position.set(cx, (HH + 6.4) / 2, cz);
    colliders.push({ x0: cx - 0.2, x1: cx + 0.2, z0: cz - 0.2, z1: cz + 0.2 });
    const flag = add(new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.5), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 0.2, 0.3), side: THREE.DoubleSide }))); flag.position.set(cx + 0.45, HH + 6.1, cz);
    const ring = add(new THREE.Mesh(new THREE.PlaneGeometry(13, 13), new THREE.MeshLambertMaterial({ map: tex(TX.ringCanvas(r), { repeat: false }), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 })));
    ring.rotation.x = -Math.PI / 2; ring.position.set(cx, 0.01, cz);
    const drumT = tex(TX.drumCanvas(), {}); const dmat = [new THREE.MeshLambertMaterial({ map: drumT }), new THREE.MeshLambertMaterial({ color: 0xc41e2e }), new THREE.MeshLambertMaterial({ color: 0xc41e2e })];
    const balloons = [];
    const BCOL = [0xe8303f, 0x3d6fe0, 0x3fbf62, 0x9a4ae0, 0xf28a30, 0xff6fa8];
    const bGeo = new THREE.SphereGeometry(0.24, 16, 12); bGeo.scale(1, 1.18, 1);
    for (let k = 0; k < 6; k++) {
      const a = k / 6 * Math.PI * 2 + 0.3, dx = cx + Math.cos(a) * 4.4, dz = cz + Math.sin(a) * 4.4;
      const dr = add(new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.72, 24), dmat)); dr.position.set(dx, 0.36, dz);
      colliders.push({ x0: dx - 0.6, x1: dx + 0.6, z0: dz - 0.6, z1: dz + 0.6 });
      for (let q = 0; q < 3; q++) {
        const col = BCOL[(k * 3 + q) % BCOL.length];
        const b = add(new THREE.Mesh(bGeo, new THREE.MeshStandardMaterial({ color: col, roughness: 0.25, metalness: 0.05, emissive: col, emissiveIntensity: 0.18 })));
        const bx = dx + (r() - 0.5) * 0.5, bz = dz + (r() - 0.5) * 0.5, by = 1.7 + q * 0.32 + r() * 0.2;
        b.position.set(bx, by, bz);
        const sg = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, -0.28, 0), new THREE.Vector3(dx - bx, 0.72 - by, dz - bz)]);
        b.add(new THREE.Line(sg, new THREE.LineBasicMaterial({ color: 0xdddddd })));
        balloons.push({ m: b, y: by, ph: r() * 6 });
      }
    }
    // гирлянды от шатра к стенам
    const bulbs = [], wires = [], BUL = [[2.4, 0.5, 0.4], [2.4, 2.0, 0.5], [0.5, 1.2, 2.6], [0.6, 2.2, 0.8]];
    for (let k = 0; k < 10; k++) {
      const a = k / 10 * Math.PI * 2, sx = cx + Math.cos(a) * Rt, sz = cz + Math.sin(a) * Rt, sy = HH + 0.6;
      let ex = sx, ez = sz;
      for (let d = 0; d < 40; d += 0.5) { const nx = cx + Math.cos(a) * (Rt + d), nz = cz + Math.sin(a) * (Rt + d); if (tile(Math.floor(nx / S), Math.floor(nz / S)) === 1 && (Math.floor(nx / S) === 0 || Math.floor(nz / S) === 0 || Math.floor(nx / S) >= mw - 1 || Math.floor(nz / S) >= mh - 1)) break; ex = nx; ez = nz; }
      const pts = [];
      for (let q = 0; q <= 16; q++) { const t = q / 16; pts.push(new THREE.Vector3(sx + (ex - sx) * t, sy + (HH - 0.2 - sy) * t - Math.sin(t * Math.PI) * 1.1, sz + (ez - sz) * t)); }
      wires.push(new THREE.BufferGeometry().setFromPoints(pts));
      pts.forEach((p, q) => { if (q % 2 === 0 && q > 0) bulbs.push([p, BUL[(q / 2 + k) % 4]]); });
    }
    wires.forEach((w) => add(new THREE.Line(w, new THREE.LineBasicMaterial({ color: 0x222222 }))));
    const bim = new THREE.InstancedMesh(new THREE.SphereGeometry(0.075, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff }), bulbs.length);
    bulbs.forEach(([p, c], i) => { m4.makeTranslation(p.x, p.y - 0.08, p.z); bim.setMatrixAt(i, m4); bim.setColorAt(i, new THREE.Color(c[0], c[1], c[2])); });
    bim.instanceMatrix.needsUpdate = true; bim.instanceColor.needsUpdate = true; add(bim);
    // летающие цифровые фигуры
    const shapes = [];
    for (let k = 0; k < 8; k++) {
      const geo = new THREE.EdgesGeometry(k % 2 ? new THREE.IcosahedronGeometry(1.2 + r(), 0) : new THREE.OctahedronGeometry(1.4 + r(), 0));
      const ln = add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: k % 2 ? new THREE.Color(0.6, 2.4, 2.6) : new THREE.Color(2.4, 0.6, 2.4), fog: false })));
      const a = r() * 6.28, d = 8 + r() * 18; ln.position.set(cx + Math.cos(a) * d, HH + 4 + r() * 9, cz + Math.sin(a) * d);
      shapes.push({ m: ln, s: 0.2 + r() * 0.4, y: ln.position.y, ph: r() * 6 });
    }
    // конфетти
    const confN = Math.min(1400, floorListCount(g) * 10);
    const cim = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.06, 0.035), new THREE.MeshLambertMaterial({ side: THREE.DoubleSide }), confN);
    const CC = [0xe8303f, 0x3d6fe0, 0x3fbf62, 0xf2c230, 0xff6fa8, 0xffffff].map((c) => new THREE.Color(c));
    const qq = new THREE.Quaternion(), e = new THREE.Euler(), sc1 = new THREE.Vector3(1, 1, 1), pv = new THREE.Vector3();
    let ci = 0;
    for (let t = 0; t < confN * 4 && ci < confN; t++) {
      const x = 2 + r() * (mw - 4) * S, z = 2 + r() * (mh - 4) * S;
      if (tile(Math.floor(x / S), Math.floor(z / S)) !== 0) continue;
      e.set(-Math.PI / 2, 0, r() * 6.28); qq.setFromEuler(e); pv.set(x, 0.004, z);
      m4.compose(pv, qq, sc1); cim.setMatrixAt(ci, m4); cim.setColorAt(ci, CC[(r() * CC.length) | 0]); ci++;
    }
    cim.count = ci; cim.instanceMatrix.needsUpdate = true; if (cim.instanceColor) cim.instanceColor.needsUpdate = true; add(cim);
    circus = { x: cx, z: cz, balloons, shapes, flag };
  }

  // --- шкафчики
  const lockers = [];
  // в открытом мире шкафчиков много: несколько на каждую зону, иначе от монстра негде спрятаться
  const nLock = G.zones ? 22 + (th.lockers || 0) * 3 : th.lockers, lockGap = G.zones ? 8 : 6;
  if (!opts.demo && nLock) {
    const lockT = tex(TX.lockerCanvas(r), { repeat: false });
    const lm = new THREE.MeshLambertMaterial({ color: 0x4b574f }), lf = new THREE.MeshLambertMaterial({ map: lockT });
    const cands = [];
    for (let ty = 1; ty < mh - 1; ty++) for (let tx = 1; tx < mw - 1; tx++) {
      if (g[ty * mw + tx] !== 0 || isRes(tx, ty)) continue;
      const walls = DIRS.filter(([a, b]) => tile(tx + a, ty + b) === 1);
      if (walls.length !== 1) continue;
      cands.push([tx, ty, walls[0]]);
    }
    for (let i = cands.length - 1; i > 0; i--) { const j = (r() * (i + 1)) | 0; const t = cands[i]; cands[i] = cands[j]; cands[j] = t; }
    for (const [tx, ty, [a, b]] of cands) {
      if (lockers.length >= nLock) break;
      if (lockers.some((l) => Math.abs(l.tx - tx) + Math.abs(l.ty - ty) < lockGap)) continue;
      const x = (tx + 0.5) * S + a * (S / 2 - 0.3), z = (ty + 0.5) * S + b * (S / 2 - 0.3);
      const grp = new THREE.Group(); grp.position.set(x, 0, z); grp.rotation.y = Math.atan2(-a, -b);
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.64, 1.95, 0.56), [lm, lm, lm, lm, lf, lm]); body.position.y = 0.975; grp.add(body);
      add(grp);
      colliders.push({ x0: x - 0.32, x1: x + 0.32, z0: z - 0.32, z1: z + 0.32 });
      reserved.add(tx + ',' + ty);
      lockers.push({ tx, ty, x, z, fx: -a, fz: -b, obj: grp });
    }
  }

  // --- предметы
  const items = [];
  const glowT = tex(TX.glowCanvas(), { repeat: false });
  const glow = (color, size, y, op = 0.5) => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowT, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: op }));
    s.scale.set(size, size, 1); s.position.y = y; return s;
  };
  if (!opts.demo) {
    const at = (p) => ({ x: (p.tx + 0.5) * S + (r() - 0.5) * 0.8, z: (p.ty + 0.5) * S + (r() - 0.5) * 0.8 });
    const wBody = new THREE.CylinderGeometry(0.055, 0.055, 0.22, 14), wIn = new THREE.CylinderGeometry(0.05, 0.05, 0.15, 14);
    const wCap = new THREE.CylinderGeometry(0.024, 0.024, 0.035, 10), wLab = new THREE.CylinderGeometry(0.057, 0.057, 0.05, 14, 1, true);
    const mBody = new THREE.MeshStandardMaterial({ color: 0xdff4ff, transparent: true, opacity: 0.45, roughness: 0.1, emissive: 0x1d4a66, emissiveIntensity: 0.6 });
    const mIn = new THREE.MeshStandardMaterial({ color: 0x3a9ad9, emissive: 0x15507a, emissiveIntensity: 0.8, roughness: 0.2 });
    const mCap = new THREE.MeshStandardMaterial({ color: 0x2266dd, emissive: 0x0a2a66, roughness: 0.5 });
    const mLab = new THREE.MeshStandardMaterial({ color: 0xf0e8d0, emissive: 0x3a362a, roughness: 0.8, side: THREE.DoubleSide });
    for (const p of G.water) {
      const o = new THREE.Group();
      const b = new THREE.Mesh(wBody, mBody); b.position.y = 0.11; o.add(b);
      const w = new THREE.Mesh(wIn, mIn); w.position.y = 0.08; o.add(w);
      const c = new THREE.Mesh(wCap, mCap); c.position.y = 0.238; o.add(c);
      const l = new THREE.Mesh(wLab, mLab); l.position.y = 0.12; o.add(l);
      o.add(glow(0x66c8ff, 0.7, 0.14, 0.35));
      const q = at(p); o.position.set(q.x, 0, q.z); add(o);
      items.push({ type: 'water', x: q.x, z: q.z, obj: o, taken: false });
    }
    const bBody = new THREE.CylinderGeometry(0.03, 0.03, 0.11, 12), bBand = new THREE.CylinderGeometry(0.031, 0.031, 0.04, 12, 1, true), bTop = new THREE.CylinderGeometry(0.011, 0.011, 0.012, 8);
    const mbB = new THREE.MeshStandardMaterial({ color: 0x1b1b1d, roughness: 0.4 }), mbY = new THREE.MeshStandardMaterial({ color: 0xe8b500, emissive: 0x6a5000, roughness: 0.4, side: THREE.DoubleSide }), mbT = new THREE.MeshStandardMaterial({ color: 0xc08040, metalness: 0.6, roughness: 0.3 });
    for (const p of G.batt) {
      const o = new THREE.Group(), inner = new THREE.Group(); inner.rotation.z = Math.PI / 2; inner.position.y = 0.032; o.add(inner);
      inner.add(new THREE.Mesh(bBody, mbB)); const bd = new THREE.Mesh(bBand, mbY); bd.position.y = 0.02; inner.add(bd);
      const tp = new THREE.Mesh(bTop, mbT); tp.position.y = 0.061; inner.add(tp);
      o.add(glow(0xffd23a, 0.55, 0.05, 0.4));
      o.rotation.y = r() * 6.28;
      const q = at(p); o.position.set(q.x, 0, q.z); add(o);
      items.push({ type: 'batt', x: q.x, z: q.z, obj: o, taken: false });
    }
    if (G.key) {
      const cardT = tex(TX.keycardCanvas(), { repeat: false });
      const edge = new THREE.MeshStandardMaterial({ color: 0xdddddd });
      const face = new THREE.MeshStandardMaterial({ map: cardT, emissive: 0xffffff, emissiveMap: cardT, emissiveIntensity: 0.35, roughness: 0.4 });
      const o = new THREE.Group();
      const card = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.106, 0.006), [edge, edge, edge, edge, face, face]); card.position.y = 0.9; o.add(card);
      o.add(glow(0x5fe8ff, 0.9, 0.9, 0.5));
      const q = { x: (G.key.tx + 0.5) * S, z: (G.key.ty + 0.5) * S }; o.position.set(q.x, 0, q.z); add(o);
      items.push({ type: 'key', x: q.x, z: q.z, obj: o, spin: card, taken: false });
    }
    const paperT = tex(TX.paperCanvas(r), { repeat: false });
    const mPaper = new THREE.MeshLambertMaterial({ map: paperT, emissive: 0x2a251a, side: THREE.DoubleSide });
    for (const p of G.notes) {
      const o = new THREE.Group();
      const pl = new THREE.Mesh(new THREE.PlaneGeometry(0.21, 0.28), mPaper); pl.rotation.x = -Math.PI / 2; pl.rotation.z = r() * 6.28; pl.position.y = 0.006; o.add(pl);
      o.add(glow(0xfff1c8, 0.8, 0.05, 0.3));
      const q = at(p); o.position.set(q.x, 0, q.z); add(o);
      items.push({ type: 'note', id: p.id, x: q.x, z: q.z, obj: o, taken: false });
    }
  }

  // --- тайная комната (по теме уровня)
  let secret = null;
  if (sc && !opts.demo) {
    const kind = sc.kind || 'love';
    mesh(gRF, bakedMat(tex(kind === 'circus' ? TX.checkerCanvas(r) : TX.roomFloorCanvas(r)), ROOMBAKE, kind === 'circus' ? { color: 0xffc8dc } : {}));
    mesh(gRC, bakedMat(ceilT, ROOMBAKE, { color: kind === 'smile' ? 0xfff0c8 : 0xffe0ea }));
    mesh(gRW, bakedMat(tex(TX.secretWallCanvas(kind, r), { clampT: true }), ROOMBAKE));
    const decal = add(new THREE.Mesh(new THREE.PlaneGeometry(0.15, 0.15), new THREE.MeshLambertMaterial({ map: tex(TX.heartDecalCanvas(), { repeat: false }), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 })));
    decal.position.set(sc.fx * S - 0.004, 0.23, (sc.fy + 0.5) * S + (r() - 0.5) * 1.1);
    decal.rotation.y = -Math.PI / 2;
    const sh = new THREE.Shape();
    sh.moveTo(5, 5); sh.bezierCurveTo(5, 5, 4, 0, 0, 0); sh.bezierCurveTo(-6, 0, -6, 7, -6, 7);
    sh.bezierCurveTo(-6, 11, -3, 15.4, 5, 19); sh.bezierCurveTo(12, 15.4, 16, 11, 16, 7);
    sh.bezierCurveTo(16, 7, 16, 0, 10, 0); sh.bezierCurveTo(7, 0, 5, 5, 5, 5);
    const heartGeo = (scale) => { const hg = new THREE.ExtrudeGeometry(sh, { depth: 3.5, bevelEnabled: true, bevelThickness: 1.3, bevelSize: 1.1, bevelSegments: 8, curveSegments: 40 }); hg.rotateZ(Math.PI); hg.center(); hg.scale(scale, scale, scale); return hg; };
    const zf = (3.5 / 2 + 1.3) * 0.045 + 0.012;
    const hgrp = new THREE.Group(); hgrp.position.set(hx, 1.45, hz); add(hgrp);
    let heart = null;
    const hearts = [];
    if (kind === 'love' || kind === 'smile') {
      const col = kind === 'smile' ? [0xffc23a, 0xff8a1a] : [0xff3d6e, 0xff1450];
      heart = new THREE.Mesh(heartGeo(0.045), new THREE.MeshStandardMaterial({ color: col[0], emissive: col[1], emissiveIntensity: 0.55, roughness: 0.28, metalness: 0.1 }));
      const face = kind === 'smile'
        ? { c: TX.smileHeartFaceCanvas(), w: 0.82, h: 0.82, y: 0.02 }
        : { c: TX.heartTextCanvas(), w: 0.74, h: 0.37, y: 0.05 };
      const tm = new THREE.MeshBasicMaterial({ map: tex(face.c, { repeat: false }), transparent: true, depthWrite: false, color: new THREE.Color(1.5, 1.5, 1.5) });
      const t1 = new THREE.Mesh(new THREE.PlaneGeometry(face.w, face.h), tm); t1.position.set(0, face.y, zf); heart.add(t1);
      const t2 = t1.clone(); t2.rotation.y = Math.PI; t2.position.z = -zf; heart.add(t2);
      hgrp.add(heart);
      hgrp.add(glow(kind === 'smile' ? 0xffc040 : 0xff4f86, 2.6, 0, 0.45));
    } else {
      // цирк: шарики-сердечки над подарком и вывеска с лампочками
      hgrp.position.y = 0;
      const gift = new THREE.Group(); hgrp.add(gift);
      gift.add(new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.5, 0.62), new THREE.MeshStandardMaterial({ color: 0xff6fa8, roughness: 0.5, emissive: 0x40102a })));
      const rib = new THREE.MeshStandardMaterial({ color: 0xfff1f6, emissive: 0x403038 });
      const r1 = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.52, 0.1), rib), r2 = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.52, 0.64), rib);
      gift.add(r1); gift.add(r2); gift.position.y = 0.25;
      const bow = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.035, 8, 16), rib); bow.position.y = 0.55; bow.rotation.x = Math.PI / 2; gift.add(bow);
      const HC = [0xff2d55, 0xff7aa8, 0xfff0f5];
      for (let k = 0; k < 3; k++) {
        const hm = new THREE.Mesh(heartGeo(0.022), new THREE.MeshStandardMaterial({ color: HC[k], emissive: HC[k], emissiveIntensity: 0.35, roughness: 0.25 }));
        const bx = (k - 1) * 0.42, by = 1.6 + (k === 1 ? 0.45 : 0.1);
        hm.position.set(bx, by, (k - 1) * 0.12); hgrp.add(hm);
        const sg = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(bx, by - 0.24, (k - 1) * 0.12), new THREE.Vector3(0, 0.56, 0)]);
        hgrp.add(new THREE.Line(sg, new THREE.LineBasicMaterial({ color: 0xffffff })));
        hearts.push({ m: hm, y: by, ph: k * 2 });
      }
      const sign = add(new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.85), new THREE.MeshBasicMaterial({ map: tex(TX.marqueeCanvas('Уля'), { repeat: false }), color: new THREE.Color(1.6, 1.5, 1.5) })));
      sign.position.set((sc.cx + 2) * S - 0.02, 2.0, hz); sign.rotation.y = -Math.PI / 2;
      hgrp.add(glow(0xff6fa8, 3.2, 1.4, 0.4));
    }
    const pet = [];
    for (let k = 0; k < 46; k++) {
      const p = new THREE.CircleGeometry(0.035 + r() * 0.025, 6); p.rotateX(-Math.PI / 2); p.scale(1, 1, 0.6); p.rotateY(r() * 6.28);
      const a = r() * 6.28, rad = 0.5 + r() * 2.1;
      p.translate(hx + Math.cos(a) * rad, 0.004 + k * 0.0001, hz + Math.sin(a) * rad); pet.push(p);
    }
    const petCol = kind === 'smile' ? [0xffc23a, 0x503008] : kind === 'circus' ? [0xff6fa8, 0x400a20] : [0xff6f91, 0x501020];
    add(new THREE.Mesh(mergeGeometries(pet), new THREE.MeshLambertMaterial({ color: petCol[0], emissive: petCol[1], side: THREE.DoubleSide })));
    const N = 90, pos = new Float32Array(N * 3);
    for (let k = 0; k < N; k++) { pos[k * 3] = hx + (r() - 0.5) * 5.4; pos[k * 3 + 1] = r() * HH; pos[k * 3 + 2] = hz + (r() - 0.5) * 5.4; }
    const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pts = add(new THREE.Points(pg, new THREE.PointsMaterial({ size: 0.07, map: glowT, color: kind === 'smile' ? 0xffd27a : 0xff9fc0, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })));
    secret = { kind, x: hx, z: hz, wallX: sc.fx * S, wallZ: (sc.fy + 0.5) * S, heart: hgrp, heartMesh: heart, hearts, pts };
  }

  const floorList = [];
  for (let i = 0; i < g.length; i++) if (walkT(g[i])) floorList.push(i);
  const TMP = new THREE.Color();

  function update(dt, t, power, emPower) {
    lampMat.color.setRGB(LC[0], LC[1], LC[2]).multiplyScalar(3.2 * power + 0.02);
    emMat.color.setRGB(EC[0], EC[1], EC[2]).multiplyScalar(2.2 * emPower);
    if (lampIM && flick.i >= 0) {
      flick.t -= dt;
      const on = flick.t <= 0 ? 1 : (Math.random() < (flick.burst ? 0.25 : 0.55) ? 1 : 0.06);
      lampIM.setColorAt(flick.i, TMP.setScalar(on)); lampIM.instanceColor.needsUpdate = true;
      if (flick.t <= 0) flick.i = -1;
    }
    if (water) { const nm = water.material.normalMap; nm.offset.x = t * 0.012; nm.offset.y = t * 0.008; }
    for (const it of items) {
      if (it.taken) continue;
      if (it.type === 'key') { it.spin.rotation.y = t * 1.6; it.spin.position.y = 0.9 + Math.sin(t * 2) * 0.05; }
      else if (it.type === 'water') it.obj.rotation.y = t * 0.6;
    }
    if (circus) {
      for (const b of circus.balloons) { b.m.position.y = b.y + Math.sin(t * 1.3 + b.ph) * 0.06; b.m.rotation.z = Math.sin(t * 0.9 + b.ph) * 0.08; }
      for (const s_ of circus.shapes) { s_.m.rotation.x += dt * s_.s; s_.m.rotation.y += dt * s_.s * 0.7; s_.m.position.y = s_.y + Math.sin(t * 0.5 + s_.ph) * 0.6; }
      circus.flag.rotation.y = Math.sin(t * 2.2) * 0.35;
    }
    if (secret) {
      if (secret.heartMesh) {
        const beat = 1 + Math.max(0, Math.sin(t * 6.2)) * 0.05 * (Math.sin(t * 3.1) > 0 ? 1 : 0.4);
        secret.heartMesh.scale.setScalar(beat);
        secret.heart.rotation.y = -Math.PI / 2 + Math.sin(t * 0.55) * 0.45;
        secret.heart.position.y = 1.45 + Math.sin(t * 1.1) * 0.06;
      }
      for (const h of secret.hearts) { h.m.position.y = h.y + Math.sin(t * 1.2 + h.ph) * 0.07; h.m.rotation.y = -Math.PI / 2 + Math.sin(t * 0.8 + h.ph) * 0.3; }
      const a = secret.pts.geometry.attributes.position;
      for (let k = 0; k < a.count; k++) { let y = a.getY(k) + dt * 0.12; if (y > HH) y = 0.05; a.setY(k, y); }
      a.needsUpdate = true;
    }
  }
  function flickerOne(near) {
    if (!lampIM || !alive.length || flick.i >= 0) return null;
    let i = (Math.random() * alive.length) | 0;
    if (near) {
      const c = alive.map((l, k) => [k, Math.hypot(l.x - near.x, l.z - near.z)]).filter((p) => p[1] > 3 && p[1] < 12);
      if (!c.length) return null; i = c[(Math.random() * c.length) | 0][0];
    }
    flick.i = i; flick.t = near ? 1.6 : 0.6 + Math.random() * 0.9; flick.burst = !!near;
    return alive[i];
  }
  function setKeypad(ok, t) {
    if (!keypadMat) return;
    if (ok) keypadMat.color.setRGB(0.2, 3, 0.6);
    else { const b = Math.sin(t * 5) > 0 ? 3 : 0.6; keypadMat.color.setRGB(b, 0.12, 0.08); }
  }
  function dispose() {
    root.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
    });
    textures.forEach((t) => t.dispose());
  }
  const los = (x0, z0, x1, z1) => vis(x0, z0, x1, z1);
  const losWide = (x0, z0, x1, z1) => {
    const dx = x1 - x0, dz = z1 - z0, l = Math.hypot(dx, dz) || 1, px = -dz / l * 0.32, pz = dx / l * 0.32;
    return vis(x0, z0, x1, z1) && vis(x0 + px, z0 + pz, x1 + px, z1 + pz) && vis(x0 - px, z0 - pz, x1 - px, z1 - pz);
  };

  return {
    root, g, mw, mh, tile, lamps, items, colliders, secret, floorList, lockers, HH, circus, puddles,
    glowT, zones: G.zones, zoneAt: (x, z) => (G.zones ? zoneAt(G.zones, Math.floor(x / S), Math.floor(z / S)) : null),
    spawn: { x: (G.spawn.tx + 0.5) * S, z: (G.spawn.ty + 0.5) * S, yaw: G.spawn.yaw },
    door: { x: dfx, z: dfz, nx: dnx, nz: dnz },
    idx: (x, z) => Math.floor(z / S) * mw + Math.floor(x / S),
    bfs: (tx, ty) => bfs(g, mw, mh, tx, ty, walkT),
    groundY: (x, z) => floorY(tile(Math.floor(x / S), Math.floor(z / S))),
    los, losWide, update, flickerOne, setKeypad, dispose
  };
}

export { S, H, BAKE, ROOMBAKE, AMBK, solidMove, solidSight, PD, genGrid, buildLevel };
