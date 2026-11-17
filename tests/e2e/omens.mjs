// Прикмети перед мисливцем (Д3): лампа лускає з іскрами й гасне, відчинені двері за спиною грюкають, кроки за спиною.
//   node tests/e2e/omens.mjs [webkit|chromium]   → .shots/omen-lamp.png
import { startServer, openPage, gotoGame, wait } from './lib.mjs';
const which = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'webkit';
const srv = await startServer();
const { page, logs, close } = await openPage(which);
let bad = false;
const check = (name, ok, extra) => { if (!ok) bad = true; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`, extra === undefined ? '' : JSON.stringify(extra)); };
await gotoGame(page);
await page.click('.age [data-go]');
await page.waitForSelector('.menu', { timeout: 90000 });
await page.evaluate(async () => { const g = window.__zk.game; await g.loadLevel(1); g.enterLevelStart(); g.play(); g.hunt.update = () => {}; });
await wait(1500);
// лампа: стати під світлом і дивитися на лампу за ~6 м
const lamp = await page.evaluate(() => {
  const g = window.__zk.game, L = g.level.layout;
  const on = L.lights.map((p, i) => [p, i]).filter(([, i]) => g.level.lamps.levelOf(i) > 0.9);
  for (const [p] of on) for (const [q] of on) {
    const d = Math.hypot(p.x - q.x, p.z - q.z);
    if (d > 5.5 && d < 8 && g.physics.lineOfSight(p.x, 1.6, p.z, q.x, 2.6, q.z)) {
      window.__zk.tp(p.x, p.z, Math.atan2(-(q.x - p.x), -(q.z - p.z)), 0.25);
      return { from: [p.x, p.z], to: [q.x, q.z] };
    }
  }
  return null;
});
await wait(1200);
const lampRes = await page.evaluate(() => { const g = window.__zk.game, p = g.player; const before = g.level.layout.lights.filter((_, i) => g.level.lamps.levelOf(i) > 0.5).length;
  const ok = g.omens.play('lamp', g.level, { x: p.pos.x, z: p.pos.z, yaw: p.yaw }, g.camera);
  const after = g.level.layout.lights.filter((_, i) => g.level.lamps.levelOf(i) > 0.5).length; return { ok, before, after }; });
await wait(250);
await page.screenshot({ path: '.shots/omen-lamp.png' });
check('лампа лопнула и погасла', !!lamp && lampRes.ok && lampRes.after === lampRes.before - 1, { lamp, lampRes });
// двері: відчинені за спиною зачиняються
const doorRes = await page.evaluate(async () => {
  const g = window.__zk.game, ds = g.level.doors.list;
  const d = ds.find((x) => x.target > 0.1) ?? ds[0];
  if (d.target <= 0.1) g.level.doors.toggle(d);
  await new Promise((r) => setTimeout(r, 1500));
  // стати за 6 м від дверей, спиною до них
  const L = g.level.layout, free = (x, z) => !L.walls.some((w) => Math.abs(x - w.x) < w.w / 2 + 0.4 && Math.abs(z - w.z) < w.d / 2 + 0.4);
  let spot = null;
  for (let a = 0; a < 6.28 && !spot; a += 0.3) { const x = d.cx + Math.cos(a) * 6, z = d.cz + Math.sin(a) * 6; if (free(x, z) && g.physics.lineOfSight(x, 1.2, z, d.cx, 1.2, d.cz)) spot = [x, z]; }
  if (!spot) return { skip: true };
  window.__zk.tp(spot[0], spot[1], Math.atan2(spot[0] - d.cx, spot[1] - d.cz), 0); // обличчям від дверей
  await new Promise((r) => setTimeout(r, 300));
  const p = g.player;
  const ok = g.omens.play('door', g.level, { x: p.pos.x, z: p.pos.z, yaw: p.yaw }, g.camera);
  await new Promise((r) => setTimeout(r, 1200));
  return { ok, target: d.target, angle: +d.angle.toFixed(2) };
});
check('двери за спиной захлопнулись', doorRes.skip || (doorRes.ok && doorRes.target === 0 && doorRes.angle < 0.1), doorRes);
const stepsRes = await page.evaluate(() => { const g = window.__zk.game, p = g.player; return g.omens.play('steps', g.level, { x: p.pos.x, z: p.pos.z, yaw: p.yaw }, g.camera); });
await wait(2600);
check('шаги за спиной', stepsRes === true);
check('консоль без ошибок', logs.length === 0, logs.slice(0, 5));
await close(); await srv.close();
process.exitCode = bad ? 1 : 0;
