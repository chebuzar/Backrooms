// Фізика речей у грі: стілець на шляху — збиваєш на бігу, він падає з гуркотом (монстр чує); плечем — двері.
//   node tests/e2e/knock.mjs [webkit|chromium]  → .shots/knock-*.png; код 1 — якщо ні
import { startServer, openPage, gotoGame } from './lib.mjs';

const which = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'webkit';
const srv = await startServer(process.argv.includes('--prod'));
const { page, logs, close } = await openPage(which);
let bad = false;
const check = (name, ok, extra) => { if (!ok) bad = true; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`, extra === undefined ? '' : JSON.stringify(extra)); };
await gotoGame(page);
await page.click('.age [data-go]');
await page.waitForSelector('.menu', { timeout: 90000 });
await page.waitForFunction(() => window.__zk.game.dressed?.length > 0, null, { timeout: 180000 }); // обстановка рівня розставлена
await page.evaluate(() => window.__zk.play());
await page.waitForFunction(() => window.__zk.game.mode === 'play' && window.__zk.game.input.enabled, null, { timeout: 120000 });
// дочекатися, поки гра справді йде (програмний рендер у контейнері перші секунди збирає шейдери)
await page.waitForFunction(() => window.__zk.game.time > 1.5, null, { timeout: 180000 });
const info = await page.evaluate(() => {
  const g = window.__zk.game, k = g.physics.knock, L = g.level.layout;
  window.__hits = [];
  const prev = k.onImpact;
  k.onImpact = (...a) => { window.__hits.push(a[3]); prev?.(...a); };
  // стілець, до якого можна розігнатися по прямій 3 м (промінь без стін)
  for (const [idx, it] of k.items.entries()) {
    const t = it.body.translation();
    for (let a = 0; a < 8; a++) {
      const dx = Math.sin(a * Math.PI / 4), dz = Math.cos(a * Math.PI / 4);
      const sx = t.x + dx * 3.2, sz = t.z + dz * 3.2;
      if (sx < 1 || sz < 1 || sx > L.cols * L.cell - 1 || sz > L.rows * L.cell - 1) continue;
      const free = g.physics.raycast(sx, 1.0, sz, -dx, 0, -dz, 3.0, 1 | 16 | 8);
      if (free !== null && free > 2.7 && Math.abs(t.y) < 0.05) {
        g.player.teleport(sx, 0, sz, Math.atan2(dx, dz)); g.player.pitch = -0.25;
        window.__ki = idx; return { n: k.count, at: [t.x, t.z], y: t.y, from: [sx, sz] };
      }
    }
  }
  return { n: k.count, at: null };
});
check('на уровне есть вещи, которые можно опрокинуть', info.n > 5 && !!info.at, info);
await page.screenshot({ path: '.shots/knock-before.png' });
const t0 = await page.evaluate(() => window.__zk.game.time);
await page.keyboard.down('ShiftLeft'); await page.keyboard.down('KeyW');
await page.waitForFunction((t) => window.__zk.game.time > t + 2.2, t0, { timeout: 180000 });
await page.keyboard.up('KeyW'); await page.keyboard.up('ShiftLeft');
const t1 = await page.evaluate(() => window.__zk.game.time);
await page.waitForFunction((t) => window.__zk.game.time > t + 1.2, t1, { timeout: 120000 });
await page.screenshot({ path: '.shots/knock-after.png' });
const after = await page.evaluate((at) => {
  const g = window.__zk.game, k = g.physics.knock;
  const t = k.items[window.__ki].body.translation(), p = g.player.pos;
  const awake = k.items.filter((i) => !i.body.isSleeping()).slice(0, 3).map((i) => { const v = i.body.linvel(), q = i.body.translation(); return [+q.y.toFixed(3), +Math.hypot(v.x, v.y, v.z).toFixed(3)]; });
  return { hits: window.__hits.length, max: Math.max(0, ...window.__hits), moved: Math.hypot(t.x - at[0], t.z - at[1]), y: t.y, player: [p.x, p.z], moving: k.moving, awake };
}, info.at);
check('стул отлетел и загремел', after.moved > 0.4 && after.hits > 0, after);
check('консоль без ошибок', logs.length === 0, logs.slice(0, 5));
await close(); await srv.close();
process.exitCode = bad ? 1 : 0;
