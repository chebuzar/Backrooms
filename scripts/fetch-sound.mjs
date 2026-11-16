// Знайти й завантажити звук із Freesound (лише CC0) → public/assets/sfx → запис у CREDITS.md.
//
//   npm run fetch-sound -- search <слова> [--max-dur 30]   # список CC0-звуків
//   npm run fetch-sound -- <id> [--name ім'я]              # завантажити звук за номером
//   npm run fetch-sound -- <слова> [--name ім'я]           # завантажити найкращий збіг
//        [--no-norm] — не нормалізувати гучність (типово пік −1 dBFS, як інші sfx; потрібен ffmpeg)
//
// Ключ — FREESOUND_API_KEY зі змінних середовища (або network secret у хмарі Claude).
// З простим ключем Freesound віддає якісне прев'ю MP3 (~128 кбіт/с), оригінал — лише через OAuth2.
import { execFileSync } from 'node:child_process';
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { addCredit, apiKey, UA } from './lib/credits.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const VALUE = ['--name', '--max-dur'];
const pos = argv.filter((a, i) => !a.startsWith('--') && !VALUE.includes(argv[i - 1]));
const H = { Authorization: 'Token ' + apiKey('FREESOUND_API_KEY'), 'User-Agent': UA };
const API = 'https://freesound.org/apiv2';
const FIELDS = 'id,name,username,license,duration,previews,url,avg_rating,num_downloads';
const CC0 = 'license:"Creative Commons 0"';

async function json(url) {
  const r = await fetch(url, { headers: H });
  if (r.status === 401 || r.status === 403) throw new Error(`${r.status}: Freesound не прийняв ключ (FREESOUND_API_KEY)`);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}
const slug = (s) => s.toLowerCase().replace(/\.(wav|mp3|ogg|flac|aiff?)$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
const has = (cmd) => { try { execFileSync('which', [cmd], { stdio: 'ignore' }); return true; } catch { return false; } };

async function find(q, n) {
  const maxDur = opt('max-dur', '60');
  const filter = `${CC0} duration:[0 TO ${maxDur}]`;
  const d = await json(`${API}/search/text/?query=${encodeURIComponent(q)}&filter=${encodeURIComponent(filter)}&sort=rating_desc&fields=${FIELDS}&page_size=${n}`);
  return d.results;
}

try {
  if (pos[0] === 'search') {
    const list = await find(pos.slice(1).join(' '), 10);
    if (!list.length) console.log('Нічого не знайдено (CC0).');
    for (const s of list) console.log(`  ${s.id}  ${s.duration.toFixed(1)} с  «${s.name}» — ${s.username}  (★${(s.avg_rating || 0).toFixed(1)}, ${s.num_downloads} завант.)`);
    process.exit(0);
  }
  if (!pos.length) {
    console.log('Використання:\n  npm run fetch-sound -- search <слова>\n  npm run fetch-sound -- <id|слова> [--name ім\'я] [--no-norm]');
    process.exit(1);
  }
  const s = /^\d+$/.test(pos[0]) ? await json(`${API}/sounds/${pos[0]}/?fields=${FIELDS}`) : (await find(pos.join(' '), 1))[0];
  if (!s) throw new Error('нічого не знайдено');
  if (!/publicdomain\/zero|Creative Commons 0/i.test(s.license)) throw new Error(`ліцензія ${s.license} — за правилами проєкту беремо лише CC0`);
  const name = opt('name', slug(s.name));
  const out = join(ROOT, 'public/assets/sfx', name + '.mp3');
  mkdirSync(dirname(out), { recursive: true });
  const r = await fetch(s.previews['preview-hq-mp3'], { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`${r.status} при завантаженні прев'ю`);
  writeFileSync(out, Buffer.from(await r.arrayBuffer()));
  let note = '';
  if (!argv.includes('--no-norm') && has('ffmpeg')) {
    const det = execFileSync('ffmpeg', ['-hide_banner', '-i', out, '-af', 'volumedetect', '-f', 'null', '-'], { stdio: ['ignore', 'pipe', 'pipe'] }).toString()
      + '';
    const peak = Number((/max_volume: (-?[\d.]+) dB/.exec(det) || [])[1]);
    if (Number.isFinite(peak) && Math.abs(peak + 1) > 0.2) {
      const tmp = out + '.tmp.mp3';
      execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', out, '-af', `volume=${(-1 - peak).toFixed(2)}dB`, '-b:a', '128k', tmp]);
      renameSync(tmp, out);
      note = ', peak-normalized to −1 dBFS';
    }
  }
  console.log(`Завантажено: «${s.name}» — ${s.username}, ${s.duration.toFixed(1)} с → ${out.replace(ROOT + '/', '')}`);
  const entry = addCredit('Завантажені звуки (fetch-sound)', `sfx/${name}.mp3`, `«${s.name}» — ${s.username}, **CC0 1.0**, Freesound #${s.id}: ${s.url} (HQ MP3 preview${note})`);
  console.log('CREDITS.md:', entry);
} catch (e) {
  console.error('Помилка:', e.message);
  process.exit(1);
}
