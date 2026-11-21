// Пам'ять карти: які клітинки рівня гравець бачив поруч із собою. З неї блокнот «малює олівцем» карту —
// лише там, де гравець пройшов (стіни в межах ~2 клітинок від пройденого шляху).
import type { Layout, WallBox } from '../world/layout';

export class MapMemory {
  readonly seen: Uint8Array;
  constructor(readonly layout: Layout) {
    this.seen = new Uint8Array(layout.cols * layout.rows);
  }

  /** Позначити клітинки довкола гравця (радіус r клітинок). */
  mark(x: number, z: number, r = 2): void {
    const l = this.layout, cx = Math.floor(x / l.cell), cz = Math.floor(z / l.cell);
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dz * dz > r * r + 1) continue;
      const X = cx + dx, Z = cz + dz;
      if (X >= 0 && Z >= 0 && X < l.cols && Z < l.rows) this.seen[Z * l.cols + X] = 1;
    }
  }

  isSeen(x: number, z: number): boolean {
    const l = this.layout, cx = Math.floor(x / l.cell), cz = Math.floor(z / l.cell);
    return cx >= 0 && cz >= 0 && cx < l.cols && cz < l.rows && this.seen[cz * l.cols + cx] === 1;
  }

  /** Відрізки стін, біля яких гравець був (лише побачені частини довгих стін), і колони. */
  knownWalls(): { a: [number, number]; b: [number, number]; pillar: WallBox | null }[] {
    const l = this.layout, out: { a: [number, number]; b: [number, number]; pillar: WallBox | null }[] = [];
    for (const w of l.walls) {
      if (w.kind === 'pillar') { if (this.isSeen(w.x + 0.5, w.z + 0.5) || this.isSeen(w.x - 0.5, w.z - 0.5)) out.push({ a: [w.x, w.z], b: [w.x, w.z], pillar: w }); continue; }
      const long = Math.max(w.w, w.d), alongX = w.w >= w.d, step = l.cell / 2;
      const n = Math.max(1, Math.round(long / step));
      let run = -1;
      const at = (i: number): [number, number] => { const t = -long / 2 + (long * i) / n; return alongX ? [w.x + t, w.z] : [w.x, w.z + t]; };
      for (let i = 0; i <= n; i++) {
        const [px, pz] = at(Math.min(n, i + 0.5));
        const seen = i < n && [-0.6, 0.6].some((o) => this.isSeen(px + (alongX ? 0 : o), pz + (alongX ? o : 0)));
        if (seen && run < 0) run = i;
        if (!seen && run >= 0) { out.push({ a: at(run), b: at(i), pillar: null }); run = -1; }
      }
    }
    return out;
  }

  /** Частка відкритої карти (для «обійдено»). */
  get coverage(): number {
    let s = 0;
    for (const v of this.seen) s += v;
    return s / this.seen.length;
  }

  /** Для збереження: стислий рядок (base64 бітової карти). */
  serialize(): string {
    const bits = new Uint8Array(Math.ceil(this.seen.length / 8));
    this.seen.forEach((v, i) => { if (v) bits[i >> 3]! |= 1 << (i & 7); });
    let s = '';
    for (const b of bits) s += String.fromCharCode(b);
    return btoa(s);
  }

  load(b64: string | undefined): void {
    this.seen.fill(0);
    if (!b64) return;
    try {
      const s = atob(b64);
      for (let i = 0; i < this.seen.length; i++) this.seen[i] = (s.charCodeAt(i >> 3) >> (i & 7)) & 1;
    } catch { /* пошкоджене збереження — карта з нуля */ }
  }
}
