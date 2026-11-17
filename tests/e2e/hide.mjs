// Шафки на рівні 1 (Д6): E — сховатися (погляд крізь жалюзі), «Наблюдатель», що не бачив цього, не знаходить;
// якщо бачив — іде до шафки й хапає. E — вийти.  node tests/e2e/hide.mjs [webkit|chromium]  → .shots/hide-*.png
import { startServer, openPage, gotoGame, wait } from './lib.mjs';
const which = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'webkit';
const srv = await startServer();
const { page, logs, close } = await openPage(which);
let bad = false;
const check = (name, ok, extra) => { if (!ok) bad = true; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`, extra === undefined ? '' : JSON.stringify(extra)); };
await gotoGame(page);
await page.click('.age [data-go]');
await page.waitForSelector('.menu', { timeout: 90000 });
await page.evaluate(async () => { const g = window.__zk.game; await g.loadLevel(1); g.enterLevelStart(); g.play(); });
await wait(1500);
const n = await page.evaluate(() => window.__zk.game.lockers.length);
check('на уровне 1 есть шкафчики', n >= 2, { n });
const goTo = async (k) => page.evaluate((k) => {
  const g = window.__zk.game, l = g.lockers[k], nx = Math.sin(l.yaw), nz = Math.cos(l.yaw);
  const x = l.door.x + nx * 1.0, z = l.door.z + nz * 1.0;
  window.__zk.tp(x, z, Math.atan2(-(l.door.x - x), -(l.door.z - z)), -0.25);
  return { x, z };
}, k);
// 1) монстр далеко, гравця не бачив → сховатися, 15 с — живий
await goTo(0);
await wait(2500);
await page.screenshot({ path: '.shots/hide-locker.png' });
await page.evaluate(() => { const s = window.__zk.game.hunt.stalker; s.brain.state = 'patrol'; s.brain.mem.suspicion = 0; });
await wait(600);
const prompt = await page.evaluate(() => document.querySelector('.hud .prompt.on')?.textContent ?? null);
await page.keyboard.press('KeyE');
await wait(2500);
const inside = await page.evaluate(() => ({ hidden: !!window.__zk.game.hide, slits: !!document.querySelector('.hud .slits.on'), prompt: document.querySelector('.hud .prompt.on')?.textContent ?? null }));
await page.screenshot({ path: '.shots/hide-inside.png' });
check('E «Спрятаться» → внутри шкафчика, вид сквозь жалюзи', /Спрятаться/.test(prompt ?? '') && inside.hidden && inside.slits && /Выйти/.test(inside.prompt ?? ''), { prompt, ...inside });
// «Наблюдатель» поруч (4 м), але не бачив, як ховалися
const d0 = await page.evaluate(() => window.__zk.game.store.progress.deaths);
await page.evaluate(() => { const g = window.__zk.game, s = g.hunt.stalker, l = g.hide.l; const nx = Math.sin(l.yaw), nz = Math.cos(l.yaw); Object.assign(s.pos, { x: l.x + nx * 4, z: l.z + nz * 4 }); });
await wait(15000);
const safe = await page.evaluate((d) => ({ deaths: window.__zk.game.store.progress.deaths - d, state: window.__zk.game.hunt.stalker.brain.state }), d0);
check('не видел, как прятались → не нашёл за 15 с', safe.deaths === 0, safe);
await page.keyboard.press('KeyE');
await wait(800);
const out = await page.evaluate(() => ({ hidden: !!window.__zk.game.hide, slits: !!document.querySelector('.hud .slits.on') }));
check('E «Выйти» → снаружи', !out.hidden && !out.slits, out);
// 2) бачив, як ховалися → знайде
await page.evaluate(() => { const g = window.__zk.game; g.hunt.stalker.reset(); });
await goTo(Math.min(1, n - 1));
await wait(400);
await page.evaluate(() => {
  const g = window.__zk.game, s = g.hunt.stalker, p = g.player;
  const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
  Object.assign(s.pos, { x: p.pos.x - fx * 5, z: p.pos.z - fz * 5 }); // за спиною, бачить гравця
  s.brain.state = 'chase'; s.brain.noticed = true; s.brain.seesPlayer = true; s.brain.mem.last = { x: p.pos.x, y: 0, z: p.pos.z }; s.brain.mem.age = 0;
});
await page.keyboard.press('KeyE');
const d1 = await page.evaluate(() => window.__zk.game.store.progress.deaths);
const found = await page.waitForFunction((d) => window.__zk.game.store.progress.deaths > d || window.__zk.game.hunt.stalker.grabbed, d1, { timeout: 25000 }).then(() => true, () => false);
check('видел, как прятались → нашёл', found);
check('консоль без ошибок', logs.length === 0, logs.slice(0, 5));
await close(); await srv.close();
process.exitCode = bad ? 1 : 0;
