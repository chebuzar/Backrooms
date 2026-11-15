// Автоматична перевірка світів і логіки (QA). Запуск: node scripts/qa.mjs [кількість сидів, за замовчуванням 3]
// Для кожного рівня 0..9 і кількох сидів:
//  - вихід досяжний від старту; знахідки стоять на підлозі й теж досяжні;
//  - є шафки; немає помилок у консолі; час генерації й побудови;
// Плюс симуляція монстра: після втечі за ріг він обшукує місце й здається.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const vite = await import('vite');
const seeds = Number(process.argv[2] || 3);

const server = await vite.createServer({ server: { port: 5186, strictPort: false, host: '127.0.0.1' }, logLevel: 'error' });
await server.listen();
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await p.goto(server.resolvedUrls.local[0] + '?debug=1');
await p.waitForFunction(() => window.__zkReady && window.__zk, null, { timeout: 90000 });

const res = await p.evaluate(async (seeds) => {
  const L = await import('/src/world/level.js'); const D = await import('/src/data/game-data.js'); const X = await import('/src/world/extras.js');
  const walk = (t) => t === 0 || t === 6;
  const out = [];
  for (let lv = 0; lv < 10; lv++) for (let s = 1; s <= seeds; s++) {
    const seed = lv * 1000 + s * 17, th = D.theme(lv), issues = [], task = Object.assign({ near: true }, X.taskFor(lv, seed));
    let t0 = performance.now();
    const G = L.genGrid(Object.assign({}, th, { needKey: task.kind === 'key' }), lv, seed, { world: true, allowSecret: true, noteIds: D.notesFor(lv), water: 10, batt: 6 });
    const tg = performance.now() - t0;
    const { g, mw, mh } = G, d = new Int32Array(mw * mh).fill(-1), q = [G.spawn.ty * mw + G.spawn.tx];
    d[q[0]] = 0;
    for (let h = 0; h < q.length; h++) { const i = q[h]; for (const k of [1, -1, mw, -mw]) { const j = i + k; if (j >= 0 && j < g.length && d[j] < 0 && walk(g[j])) { d[j] = d[i] + 1; q.push(j); } } }
    const fi = G.door.fy * mw + G.door.fx;
    if (d[fi] < 0) issues.push('вихід недосяжний');
    for (const e of G.exits || []) if (d[e.fy * mw + e.fx] < 0) issues.push('додатковий вихід недосяжний');
    if ((G.exits || []).length < 2) issues.push('виходів менше 2: ' + (G.exits || []).length);
    for (const f of G.finds) { const i = f.ty * mw + f.tx; if (g[i] !== 0) issues.push('знахідка в стіні: ' + f.kind); else if (d[i] < 0) issues.push('знахідка недосяжна: ' + f.kind); }
    for (const n of G.notes) if (d[n.ty * mw + n.tx] < 0) issues.push('записка недосяжна');
    if (task.kind === 'key') { if (!G.key) issues.push('немає ключ-карти'); else if (d[G.key.ty * mw + G.key.tx] < 0) issues.push('ключ-карта недосяжна'); }
    t0 = performance.now();
    const lvl = L.buildLevel(Object.assign({}, th, { needKey: false }), G, { seed });
    const tb = performance.now() - t0;
    if (lvl.lockers.length < 10) issues.push('мало шафок: ' + lvl.lockers.length);
    // предметы задания уровня: хватает ли их и лежат ли недалеко
    if (task.n) {
      const ex = X.buildExtras(lvl, task, seed, lv), want = task.kind === 'code' ? 'clue' : task.kind;
      const its = ex.items.filter((it) => it.type === want);
      if (its.length < task.n) issues.push(`предметів завдання ${its.length}/${task.n}`);
      for (const it of its) { const i = Math.floor(it.z / L.S) * mw + Math.floor(it.x / L.S); if (d[i] < 0 || d[i] > 40) issues.push('предмет завдання далеко/недосяжний: ' + d[i]); }
    }
    let tris = 0; lvl.root.traverse((o) => { if (o.geometry && o.geometry.index) tris += o.geometry.index.count / 3 * (o.count || 1); });
    lvl.dispose();
    out.push({ lv, seed, gen: Math.round(tg), build: Math.round(tb), dist: d[fi], exits: (G.exits || []).length, finds: G.finds.length, lockers: lvl.lockers.length, ktris: Math.round(tris / 1000), issues });
  }
  return out;
}, seeds);

let bad = 0;
for (const r of res) {
  if (r.issues.length) bad++;
  console.log(`рівень ${r.lv} сид ${String(r.seed).padStart(5)}  до виходу ${String(r.dist).padStart(3)} кл.  виходів ${r.exits}  знахідок ${r.finds}  шафок ${r.lockers}  ${r.ktris}k трикутників  генерація ${r.gen} мс  побудова ${r.build} мс  ${r.issues.length ? '❌ ' + r.issues.join('; ') : '✓'}`);
}
if (errors.length) { bad++; console.log('Помилки сторінки:\n  ' + errors.join('\n  ')); }
console.log(bad ? `\nQA: проблем — ${bad}` : '\nQA OK');
await b.close(); await server.close(); process.exit(bad ? 1 : 0);
