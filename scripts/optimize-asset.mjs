// Одна команда: модель → спрощення → текстури KTX2 → стиснення Meshopt → public/assets.
//
//   npm run optimize-asset -- <модель> [--name ім'я] [--out public/assets/models]
//        [--ratio 0.5] [--error 0.001] [--tex 2048] [--no-simplify] [--no-ktx] [--view]
//
// Вхід: .glb/.gltf, або .fbx/.obj/.dae/.stl/.ply/.blend (спершу конвертує Blender).
// Кроки: (Blender →) gltf-transform dedup/prune/weld → simplify → resize →
// KTX2 (UASTC для нормалей/ORM, ETC1S для кольору; потрібен `ktx`/`toktx` з KTX-Software)
// → gltfpack -cc (Meshopt + квантування) → public/assets/…/<ім'я>.glb.
// --view: після оптимізації відкриває модель у переглядачі (scripts/asset-view.mjs) і знімає скріншот.
// Щоб гра могла завантажити такий файл, GLTFLoader має мати KTX2Loader і MeshoptDecoder
// (приклад — scripts/asset-view/main.js).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flag = (n) => argv.includes('--' + n);
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const VALUE_FLAGS = ['--name', '--out', '--ratio', '--error', '--tex'];
const input = argv.find((a, i) => !a.startsWith('--') && !VALUE_FLAGS.includes(argv[i - 1]));
if (!input || !existsSync(input)) {
  console.error('Використання: npm run optimize-asset -- <модель> [--name ім\'я] [--ratio 0.5] [--tex 2048] [--view]');
  process.exit(1);
}
const name = opt('name', basename(input, extname(input)).toLowerCase().replace(/[^a-z0-9_-]+/g, '-'));
const outDir = resolve(ROOT, opt('out', 'public/assets/models'));
const out = join(outDir, name + '.glb');
const tmp = mkdtempSync(join(tmpdir(), 'optimize-asset-'));
const bin = (n) => join(ROOT, 'node_modules/.bin', n);
const run = (cmd, args) => execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
const step = (label, cmd, args) => {
  process.stdout.write(`• ${label}… `);
  const t = Date.now();
  try { run(cmd, args); } catch (e) { console.log('ПОМИЛКА'); console.error(String(e.stderr || e.message)); process.exit(1); }
  console.log(`${((Date.now() - t) / 1000).toFixed(1)} с`);
};
const has = (cmd) => { try { execFileSync('which', [cmd], { stdio: 'ignore' }); return true; } catch { return false; } };
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const tris = async (file) => {
  const doc = await io.read(file);
  let n = 0;
  for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) {
    if (p.getMode() !== 4) continue;
    const idx = p.getIndices();
    n += (idx ? idx.getCount() : p.getAttribute('POSITION').getCount()) / 3;
  }
  return n;
};

let cur = resolve(input);
const ext = extname(cur).toLowerCase();
if (!['.glb', '.gltf'].includes(ext)) {
  if (!has('blender')) { console.error('Для ' + ext + ' потрібен Blender (див. CLAUDE.md → Інструменти).'); process.exit(1); }
  step('Blender: ' + ext + ' → GLB', 'blender', ['-b', '-P', join(ROOT, 'scripts/blender/convert.py'), '--', cur, join(tmp, '0.glb')]);
  cur = join(tmp, '0.glb');
}
const before = { size: statSync(cur).size, tris: await tris(cur) };
const next = (() => { let i = 1; return () => join(tmp, `${i++}.glb`); })();
const T = (label, args) => { const o = next(); step(label, bin('gltf-transform'), [args[0], cur, o, ...args.slice(1)]); cur = o; };

T('очистка: дублікати', ['dedup']);
T('очистка: невикористане', ['prune']);
T('зварювання вершин', ['weld']);
if (!flag('no-simplify')) T(`спрощення (ratio ${opt('ratio', '0.5')}, похибка ${opt('error', '0.001')})`, ['simplify', '--ratio', opt('ratio', '0.5'), '--error', opt('error', '0.001')]);
const tex = opt('tex', '2048');
T(`текстури ≤ ${tex}px`, ['resize', '--width', tex, '--height', tex]);
if (!flag('no-ktx')) {
  if (!has('ktx') && !has('toktx')) console.log('• KTX2 пропущено: немає ktx/toktx (KTX-Software)');
  else {
    T('KTX2 UASTC (нормалі, ORM)', ['uastc', '--slots', '{normalTexture,occlusionTexture,metallicRoughnessTexture}', '--level', '2', '--zstd', '18']);
    T('KTX2 ETC1S (колір, світіння)', ['etc1s', '--quality', '200']);
  }
}
const packed = next();
step('Meshopt (gltfpack -cc)', bin('gltfpack'), ['-i', cur, '-o', packed, '-cc', '-kn', '-km', '-ke']);
cur = packed;

mkdirSync(outDir, { recursive: true });
copyFileSync(cur, out);
rmSync(tmp, { recursive: true, force: true });
const after = { size: statSync(out).size, tris: await tris(out) };
const kb = (b) => (b / 1024).toFixed(0) + ' КБ';
console.log(`\nГотово: ${out.replace(ROOT + '/', '')}`);
console.log(`  розмір: ${kb(before.size)} → ${kb(after.size)} (${Math.round(100 * after.size / before.size)}%)`);
console.log(`  трикутники: ${before.tris} → ${after.tris}`);
console.log('  Не забудь дописати автора й ліцензію в public/assets/CREDITS.md (fetch-model робить це сам).');
if (flag('view')) execFileSync('node', [join(ROOT, 'scripts/asset-view.mjs'), out], { stdio: 'inherit' });
