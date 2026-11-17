// Завантажити 3D-модель (лише CC0) → оптимізувати → public/assets/models → запис у CREDITS.md.
//
//   npm run fetch-model -- search <слова>                     # пошук у Poly Haven і Sketchfab (CC0)
//   npm run fetch-model -- polyhaven <id> [--res 2k]          # напр. WoodenTable_01
//   npm run fetch-model -- sketchfab <uid>                    # 32-символьний uid з адреси моделі
//        спільні: [--name ім'я] [--raw] (без оптимізації) [--ratio 0.5] [--tex 2048]
//
// Ключ Sketchfab — SKETCHFAB_API_KEY зі змінних середовища (або network secret у хмарі Claude).
// Сирі файли — у .assets-src/ (не в git). Оптимізація — scripts/optimize-asset.mjs.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { addCredit, apiKey, UA } from './lib/credits.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const VALUE = ['--res', '--name', '--ratio', '--tex', '--error'];
const pos = argv.filter((a, i) => !a.startsWith('--') && !VALUE.includes(argv[i - 1]));
const [source, ...rest] = pos;
const query = rest.join(' ');
const SF = { Authorization: 'Token ' + apiKey('SKETCHFAB_API_KEY'), 'User-Agent': UA };
const PH = { 'User-Agent': UA };

async function json(url, headers) {
  const r = await fetch(url, { headers });
  if (r.status === 401 || r.status === 403) throw new Error(`${r.status}: немає доступу — перевір ключ (${new URL(url).host})`);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}
async function download(url, file, headers = PH) {
  mkdirSync(dirname(file), { recursive: true });
  const r = await fetch(url, { headers });
  if (!r.ok) throw new Error(`${r.status} при завантаженні ${url}`);
  writeFileSync(file, Buffer.from(await r.arrayBuffer()));
}
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const bin = (n) => join(ROOT, 'node_modules/.bin', n);

async function search(q) {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const ph = await json('https://api.polyhaven.com/assets?type=models', PH);
  const hits = Object.entries(ph).filter(([id, a]) => words.every((w) => (id + ' ' + a.name + ' ' + a.tags.join(' ') + ' ' + a.categories.join(' ')).toLowerCase().includes(w))).slice(0, 8);
  console.log(`Poly Haven (CC0): ${hits.length ? '' : 'нічого'}`);
  for (const [id, a] of hits) console.log(`  polyhaven ${id}  — ${a.name}, ${a.polycount} трикутників, автор: ${Object.keys(a.authors).join(', ')}`);
  const sf = await json(`https://api.sketchfab.com/v3/search?type=models&downloadable=true&license=cc0&count=8&q=${encodeURIComponent(q)}`, SF)
    .catch((e) => { console.log(`Sketchfab: ${e.message}`); return null; });
  if (!sf) return;
  console.log(`Sketchfab (CC0): ${sf.results.length ? '' : 'нічого'}`);
  for (const m of sf.results) console.log(`  sketchfab ${m.uid}  — ${m.name}, ${m.faceCount} трикутників, автор: ${m.user.displayName || m.user.username}`);
}

async function fromPolyHaven(id) {
  const info = await json(`https://api.polyhaven.com/info/${id}`, PH);
  const files = await json(`https://api.polyhaven.com/files/${id}`, PH);
  const res = opt('res', '2k');
  const g = files.gltf?.[res]?.gltf;
  if (!g) throw new Error(`у ${id} немає glTF ${res}; є: ${Object.keys(files.gltf || {}).join(', ')}`);
  const dir = join(ROOT, '.assets-src', 'polyhaven', id);
  await download(g.url, join(dir, `${id}.gltf`));
  for (const [path, f] of Object.entries(g.include || {})) await download(f.url, join(dir, path));
  const glb = join(dir, `${id}.glb`);
  execFileSync(bin('gltf-transform'), ['copy', join(dir, `${id}.gltf`), glb], { stdio: 'ignore' });
  return { glb, title: info.name, author: Object.keys(info.authors).join(', '), license: 'CC0 1.0', url: `https://polyhaven.com/a/${id}`, src: 'Poly Haven' };
}

async function fromSketchfab(uid) {
  const m = await json(`https://api.sketchfab.com/v3/models/${uid}`, SF);
  const lic = m.license?.slug || m.license?.label || '?';
  if (!/cc0|public domain/i.test(lic)) throw new Error(`ліцензія «${m.license?.label}» — за правилами проєкту беремо лише CC0`);
  const d = await json(`https://api.sketchfab.com/v3/models/${uid}/download`, SF);
  const dir = join(ROOT, '.assets-src', 'sketchfab', uid);
  let glb = join(dir, 'model.glb');
  if (d.glb) await download(d.glb.url, glb, { 'User-Agent': UA });
  else if (d.gltf) {
    const zip = join(dir, 'model.zip');
    await download(d.gltf.url, zip, { 'User-Agent': UA });
    execFileSync('python3', ['-I', '-c', 'import sys,zipfile;zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])', zip, dir]);
    const gltf = readdirSync(dir, { recursive: true }).find((f) => String(f).endsWith('.gltf'));
    if (!gltf) throw new Error('в архіві немає .gltf');
    execFileSync(bin('gltf-transform'), ['copy', join(dir, String(gltf)), glb], { stdio: 'ignore' });
  } else throw new Error('Sketchfab не дав GLB/glTF для цієї моделі');
  return { glb, title: m.name, author: m.user.displayName || m.user.username, license: 'CC0 1.0', url: m.viewerUrl, src: 'Sketchfab' };
}

try {
  if (source === 'search' && query) { await search(query); process.exit(0); }
  if (!['polyhaven', 'sketchfab'].includes(source) || !query) {
    console.log('Використання:\n  npm run fetch-model -- search <слова>\n  npm run fetch-model -- polyhaven <id> [--res 2k] [--name ім\'я]\n  npm run fetch-model -- sketchfab <uid> [--name ім\'я] [--raw]');
    process.exit(1);
  }
  const a = source === 'polyhaven' ? await fromPolyHaven(query) : await fromSketchfab(query);
  const name = opt('name', slug(a.title || query));
  const out = join(ROOT, 'public/assets/models', name + '.glb');
  console.log(`Завантажено: «${a.title}» — ${a.author} (${a.license}, ${a.src})`);
  if (argv.includes('--raw')) { mkdirSync(dirname(out), { recursive: true }); copyFileSync(a.glb, out); }
  else {
    const extra = ['ratio', 'tex', 'error'].flatMap((k) => (opt(k) ? ['--' + k, opt(k)] : []));
    execFileSync('node', [join(ROOT, 'scripts/optimize-asset.mjs'), a.glb, '--name', name, ...extra], { stdio: 'inherit' });
  }
  if (!existsSync(out)) throw new Error('файл не створено: ' + out);
  const entry = addCredit('Завантажені моделі (fetch-model)', `models/${name}.glb`, `«${a.title}» — ${a.author}, **${a.license}**, ${a.src}: ${a.url}`);
  console.log('CREDITS.md:', entry);
} catch (e) {
  console.error('Помилка:', e.message);
  process.exit(1);
}
