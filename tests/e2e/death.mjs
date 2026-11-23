// Смерть 18+: скример упритул → падіння → монстр над тілом, кров → темрява → «Связь потеряна» → гра триває.
//   node tests/e2e/death.mjs [webkit|chromium] [--levels 1,2]  → .shots/death-<рівень>-<мітка>.png; код 1 — якщо ні
import { startServer, openPage, gotoGame, wait } from './lib.mjs';

const which = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'webkit';
const li = process.argv.indexOf('--levels'), levels = li > 0 ? process.argv[li + 1].split(',').map(Number) : [1, 2];
const srv = await startServer(process.argv.includes('--prod'));
const { page, logs, close } = await openPage(which);
let bad = false;
const check = (name, ok, extra) => { if (!ok) bad = true; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`, extra === undefined ? '' : JSON.stringify(extra)); };
await gotoGame(page);
await page.click('.age [data-go]');
await page.waitForSelector('.menu', { timeout: 90000 });
for (const lv of levels) {
  await page.evaluate(async (n) => { const g = window.__zk.game; await g.loadLevel(n); g.enterLevelStart(); g.play(); }, lv);
  await wait(1500);
  await page.evaluate(() => {
    const g = window.__zk.game, s = g.hunt.stalker, p = g.player;
    const bx = Math.sin(p.yaw) * 0.7, bz = Math.cos(p.yaw) * 0.7; // позаду
    Object.assign(s.pos, { x: p.pos.x + bx, z: p.pos.z + bz });
    s.sub = 0; s.brain.state = 'chase'; s.brain.noticed = true; s.brain.mem.last = { x: p.pos.x, y: 0, z: p.pos.z }; s.brain.mem.age = 0;
  });
  await page.waitForFunction(() => !!window.__zk.game.death, null, { timeout: 15000 });
  const seen = {};
  for (const [tag, at] of [['scare', 0.25], ['fall', 0.8], ['feed', 1.75], ['feed2', 2.75], ['end', 3.9]]) {
    await page.waitForFunction((a) => !window.__zk.game.death || window.__zk.game.death.t >= a, at, { timeout: 60000 });
    // «feed2» — саме в мить ривка (кров летить)
    if (tag === 'feed2') await page.waitForFunction(() => { const d = window.__zk.game.death; return !d || (d.t - d.strikeT > 0.3 && d.t - d.strikeT < 0.5); }, null, { timeout: 60000 });
    const st = await page.evaluate(() => {
      const g = window.__zk.game, s = g.hunt.stalker, c = g.camera, d = g.death;
      let head = null;
      s.root.traverse((o) => { if (o.isBone && o.name === 'head') head = o; });
      const hp = head ? head.getWorldPosition(c.position.clone()) : null;
      const ndc = hp ? hp.clone().project(c) : null;
      const sp = g.deathSpray, live = sp ? [...sp.live].filter((v) => v > 0).length : -1;
      const flying = sp ? [...sp.live].map((v, i) => { if (v !== 1) return null; const q = c.position.clone().set(sp.p[i * 3], sp.p[i * 3 + 1], sp.p[i * 3 + 2]).project(c); return [+q.x.toFixed(2), +q.y.toFixed(2), +sp.p[i * 3 + 1].toFixed(2)]; }).filter(Boolean).slice(0, 8) : [];
      return { spray: { vis: sp?.mesh.visible, live, flying, cam: [+c.position.x.toFixed(2), +c.position.y.toFixed(2), +c.position.z.toFixed(2)], strikes: d?.strikes }, t: d ? +d.t.toFixed(2) : null, camY: +c.position.y.toFixed(2), head: hp ? +hp.distanceTo(c.position).toFixed(2) : null, ndc: ndc ? [+ndc.x.toFixed(2), +ndc.y.toFixed(2)] : null };
    });
    seen[tag] = st;
    await page.screenshot({ path: `.shots/death-${lv}-${tag}.png` });
  }
  console.log(lv, JSON.stringify(seen));
  check(`уровень ${lv}: скример — лицо вплотную`, seen.scare.head !== null && seen.scare.head < 0.9, seen.scare);
  check(`уровень ${lv}: оператор на полу, монстр над ним`, seen.feed.camY < 0.4 && seen.feed.head !== null && seen.feed.head < 1.6 && seen.feed2.head < 1.6, seen);
  await page.waitForFunction(() => window.__zk.game.input.enabled && !window.__zk.game.ending, null, { timeout: 60000 });
  const after = await page.evaluate(() => ({ y: window.__zk.game.camera.position.y, bodies: window.__zk.game.store.progress.bodies.length }));
  check(`уровень ${lv}: после — снова на ногах, тело осталось`, after.y > 1.2 && after.bodies > 0, after);
}
check('консоль без ошибок', logs.length === 0, logs.slice(0, 5));
await close(); await srv.close();
process.exitCode = bad ? 1 : 0;
