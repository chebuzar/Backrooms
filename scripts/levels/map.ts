// Карта рівня зверху (PNG): npx tsx scripts/levels/map.ts <seed> [out.png] [yellow|base|parking]
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { generateLayout, type Preset } from '../../src/world/layout';

const seed = Number(process.argv[2] ?? 1987), preset = (process.argv[4] ?? 'yellow') as Preset, out = process.argv[3] ?? `.shots/map-${preset}-${seed}.png`;
const l = generateLayout({ seed, preset });
const S = 12; // пікселів на метр
const W = Math.ceil(l.cols * l.cell * S) + 8, H = Math.ceil(l.rows * l.cell * S) + 8;
const px = new Uint8Array(W * H * 3).fill(0);
const rect = (x0: number, z0: number, x1: number, z1: number, c: [number, number, number]) => {
  for (let y = Math.max(0, Math.floor(z0 * S) + 4); y < Math.min(H, Math.ceil(z1 * S) + 4); y++)
    for (let x = Math.max(0, Math.floor(x0 * S) + 4); x < Math.min(W, Math.ceil(x1 * S) + 4); x++) px.set(c, (y * W + x) * 3);
};
const zoneCol: Record<string, [number, number, number]> = { rooms: [70, 62, 30], hall: [80, 72, 34], corridors: [60, 54, 26], dark: [28, 26, 20] };
const zw = Math.floor(l.cols / 3) * l.cell, zh = Math.floor(l.rows / 3) * l.cell;
l.zones.forEach((z, i) => rect((i % 3) * zw, Math.floor(i / 3) * zh, (i % 3 === 2 ? l.cols * l.cell : (i % 3 + 1) * zw), (Math.floor(i / 3) === 2 ? l.rows * l.cell : (Math.floor(i / 3) + 1) * zh), zoneCol[z] ?? [50, 50, 50]));
for (const p of l.lights) rect(p.x - p.w / 2, p.z - p.d / 2, p.x + p.w / 2, p.z + p.d / 2, p.state === 'on' ? [230, 220, 150] : p.state === 'flicker' ? [200, 120, 60] : [40, 40, 40]);
for (const q of l.pools) rect(q.x - q.w / 2, q.z - q.d / 2, q.x + q.w / 2, q.z + q.d / 2, [30, 90, 140]);
for (const q of l.puddles) rect(q.x - q.w / 2, q.z - q.d / 2, q.x + q.w / 2, q.z + q.d / 2, [50, 70, 90]);
for (const w of l.walls) rect(w.x - w.w / 2, w.z - w.d / 2, w.x + w.w / 2, w.z + w.d / 2, w.kind === 'pillar' ? [160, 150, 120] : [235, 235, 225]);
const dot = (x: number, z: number, c: [number, number, number]) => rect(x - 0.5, z - 0.5, x + 0.5, z + 0.5, c);
dot(l.spawn.x, l.spawn.z, [60, 200, 255]);
dot(l.exit.x, l.exit.z, [60, 255, 90]);
for (const p of Object.values(l.points)) dot(p.x, p.z, [255, 80, 200]);
// мінімальний PNG
const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc = (b: Buffer) => { let c = -1; for (const x of b) c = (crcT[(c ^ x) & 255] as number) ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (t: string, d: Buffer) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
const raw = Buffer.alloc((W * 3 + 1) * H);
for (let y = 0; y < H; y++) { raw[y * (W * 3 + 1)] = 0; Buffer.from(px.buffer, y * W * 3, W * 3).copy(raw, y * (W * 3 + 1) + 1); }
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
writeFileSync(out, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
console.log(out, 'zones:', l.zones.join(','), 'walls:', l.walls.length, 'lights on:', l.lights.filter((x) => x.state === 'on').length, 'exit dist:', Math.max(...l.dist));
