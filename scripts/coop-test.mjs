// Автотест онлайн-режима: два отдельных браузера через настоящий PeerJS (или ?local: BroadcastChannel).
// Хост создаёт комнату, гость входит по коду, хост запускает уровень 1 (задание «предохранители»).
// Проверяем: оба в игре; гость видит хоста там, где тот стоит; взятый хостом предмет засчитан гостю; задержка.
//   node scripts/coop-test.mjs [уровень]
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const vite = await import('vite');
const lv = Number(process.argv[2] || 1);
const server = await vite.createServer({ server: { port: 5197, strictPort: false, host: '127.0.0.1' }, logLevel: 'error' });
await server.listen();
const url = server.resolvedUrls.local[0] + '?debug=1';
const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream'] });
const errors = [];
const page = async (name) => {
  const ctx = await b.newContext({ viewport: { width: 800, height: 450 } });
  await ctx.addInitScript(() => { localStorage.setItem('zakulisye_v2', JSON.stringify({ set: { q: 'low', vol: 0 }, toolsTip: 1, max: 9, docs: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] })); });
  const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(name + ': ' + e.message));
  await p.goto(url); await p.waitForFunction(() => window.__zk && window.__zkReady, null, { timeout: 90000 });
  await p.evaluate((name) => { document.querySelector('#menu [data-go="online"]').click(); document.getElementById('oName').value = name; }, name);
  return p;
};
const ok = (c, m) => console.log((c ? '✓ ' : '✗ ') + m);
try {
  const A = await page('Хост'), B = await page('Гость');
  await A.evaluate(() => document.getElementById('oHost').click()); await A.waitForFunction(() => document.getElementById('oRoomCode').textContent.length === 5, null, { timeout: 30000 });
  const code = await A.textContent('#oRoomCode'); const mode = await A.evaluate(() => window.__zk.net.mode);
  ok(true, `комната ${code} (${mode})`);
  await B.evaluate((c) => { document.getElementById('oCode').value = c; }, code); const tj = Date.now(); await B.evaluate(() => document.getElementById('oJoin').click());
  await B.waitForFunction(() => window.__zk.game.coop && window.__zk.net.conns.size > 0, null, { timeout: 30000 });
  ok(true, `гость вошёл за ${((Date.now() - tj) / 1000).toFixed(1)} с`);
  await A.waitForFunction(() => window.__zk.game.roster.length === 2, null, { timeout: 10000 }); ok(true, 'хост видит 2 игроков');
  await A.evaluate((lv) => { document.getElementById('oLevel').value = String(lv); document.getElementById('oGo').click(); }, lv);
  await Promise.all([A, B].map((p) => p.waitForFunction(() => window.__zk.ready, null, { timeout: 120000 })));
  ok(true, `оба в игре на уровне ${lv}`);
  const same = await Promise.all([A, B].map((p) => p.evaluate(() => { const z = window.__zk; return [z.game.seed, z.lvl.items.length, (z.game.task || {}).kind, z.game.ex.items.filter((i) => i.type === 'fuse' || i.type === 'clue').length]; })));
  ok(JSON.stringify(same[0]) === JSON.stringify(same[1]), `одинаковый уровень у обоих: ${JSON.stringify(same[0])} / ${JSON.stringify(same[1])}`);
  // хост переходит в точку — гость должен увидеть его там
  const target = await A.evaluate(() => { const z = window.__zk; z.pl.wake = 1; const x = z.lvl.spawn.x + 2, zz = z.lvl.spawn.z; z.tp(x, zz); return [x, zz]; });
  const t0 = Date.now();
  await B.waitForFunction(([x, zz]) => { for (const r of window.__zk.rp.values()) if (Math.hypot(r.x - x, r.z - zz) < 0.6) return true; return false; }, target, { timeout: 10000 });
  ok(true, `гость увидел новое место хоста через ${Date.now() - t0} мс`);
  // хост берёт первый предмет задания — засчитано у гостя
  const before = await B.evaluate(() => window.__zk.game.parts);
  await A.evaluate(() => { const z = window.__zk; const it = z.lvl.items.find((i) => (i.type === 'fuse' || i.type === 'ticket' || i.type === 'clue') && !i.taken); if (it) { z.tp(it.x, it.z); } });
  await A.waitForTimeout(400);
  await A.evaluate(() => { const z = window.__zk; const it = z.lvl.items.find((i) => (i.type === 'fuse' || i.type === 'ticket' || i.type === 'clue') && !i.taken && Math.hypot(i.x - z.pl.x, i.z - z.pl.z) < 2); if (it) z.take(it); });
  const t1 = Date.now();
  const after = await B.waitForFunction((b0) => window.__zk.game.parts > b0 || window.__zk.game.ex.code && window.__zk.game.ex.code.known.some(Boolean), before, { timeout: 8000 }).then(() => true, () => false);
  ok(after, `предмет, взятый хостом, засчитан гостю${after ? ' через ' + (Date.now() - t1) + ' мс' : ''}`);
} catch (e) { ok(false, 'ошибка: ' + e.message.split('\n')[0]); }
ok(!errors.length, 'ошибок страниц: ' + errors.length + (errors.length ? '\n  ' + errors.join('\n  ') : ''));
await b.close(); await server.close(); process.exit(0);
