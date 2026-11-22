// Експорт планування рівня в JSON для Blender (геометрія + запікання світла).
//   npx tsx scripts/levels/export-layout.ts <seed> <out.json>
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { generateLayout, type Preset } from '../../src/world/layout';
import { decorate } from '../../src/world/decor';

const seed = Number(process.argv[2] ?? 1987), out = process.argv[3] ?? `.assets-src/levels/level0-${seed}.json`, preset = (process.argv[4] ?? 'yellow') as Preset;
const l = generateLayout({ seed, preset });
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ seed, cell: l.cell, cols: l.cols, rows: l.rows, height: l.height, chunk: 12, theme: l.theme, wallThickness: l.wallThickness, walls: l.walls, lights: l.lights, pools: l.pools, decor: l.theme.id === 'yellow' ? decorate(l) : [] }));
console.log(out, l.walls.length, 'walls', l.lights.length, 'lights');
