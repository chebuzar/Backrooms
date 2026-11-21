// «Схопив»: на пів секунди обличчя монстра впритул (голова ≤ 0.6 м від камери, у центрі кадру, освітлена), потім темрява.
//   node tests/e2e/grab.mjs [webkit|chromium]   → .shots/grab-<рівень>.png; код 1 — якщо ні
import { startServer, openPage, gotoGame, wait } from './lib.mjs';

const which = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'webkit';
const srv = await startServer();
const { page, logs, close } = await openPage(which);
let bad = false;
const check = (name, ok, extra) => { if (!ok) bad = true; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`, extra === undefined ? '' : JSON.stringify(extra)); };
await gotoGame(page);
await page.click('.age [data-go]');
await page.waitForSelector('.menu', { timeout: 90000 });
for (const lv of [1, 2]) {
  await page.evaluate(async (n) => { const g = window.__zk.game; await g.loadLevel(n); g.enterLevelStart(); g.play(); }, lv);
  await wait(1500);
  // монстр за спиною впритул, у погоні; гравець дивиться вбік — «Наблюдатель» хапає, коли на нього не дивляться
  await page.evaluate(() => {
    const g = window.__zk.game, s = g.hunt.stalker, p = g.player;
    const bx = Math.sin(p.yaw) * 0.7, bz = Math.cos(p.yaw) * 0.7; // позаду
    Object.assign(s.pos, { x: p.pos.x + bx, z: p.pos.z + bz });
    s.brain.state = 'chase'; s.brain.noticed = true; s.brain.mem.last = { x: p.pos.x, y: 0, z: p.pos.z }; s.brain.mem.age = 0;
  });
  await page.waitForFunction(() => window.__zk.game.hunt.stalker?.grabbed, null, { timeout: 15000 });
  await wait(300);
  const r = await page.evaluate(() => {
    const g = window.__zk.game, s = g.hunt.stalker, c = g.camera;
    let head = null;
    s.root.traverse((o) => { if (o.isBone && o.name === 'head') head = o; });
    const hp = head ? head.getWorldPosition(c.position.clone()) : null;
    const d = hp ? hp.distanceTo(c.position) : null;
    const ndc = hp ? hp.clone().project(c) : null;
    return { d: d && +d.toFixed(2), ndc: ndc && [+ndc.x.toFixed(2), +ndc.y.toFixed(2)], fade: +window.__zk.game.post && 0 };
  });
  await page.screenshot({ path: `.shots/grab-${lv}.png` });
  check(`уровень ${lv}: лицо монстра вплотную в центре кадра`, r.d !== null && r.d <= 0.6 && Math.abs(r.ndc[0]) < 0.35 && Math.abs(r.ndc[1]) < 0.45, r);
  await page.waitForFunction(() => window.__zk.game.input.enabled && !window.__zk.game.ending, null, { timeout: 30000 });
}
check('консоль без ошибок', logs.length === 0, logs.slice(0, 5));
await close(); await srv.close();
process.exitCode = bad ? 1 : 0;
