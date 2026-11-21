// Мисливці рівнів 1–2: кадри «Наблюдателя» й «Слепого» перед гравцем, сцена «схопив» → повернення на старт рівня.
// node tests/e2e/monsters.mjs  → .shots/mon-*.png; код 1 при помилках консолі чи збої
import { webkit } from 'playwright';
import { createServer } from 'vite';
const srv = await createServer({ root: process.cwd(), server: { port: 5191, strictPort: true }, logLevel: 'error' });
await srv.listen();
const b = await webkit.launch();
const page = await (await b.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
const logs = [];
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(m.text()); });
page.on('pageerror', (e) => logs.push('pageerror: ' + e.message));
await page.goto('http://localhost:5191/?debug&nodbg');
await page.waitForFunction(() => window.__zk?.ready, null, { timeout: 180000 });
await page.click('.age [data-go]');
await page.waitForTimeout(500);
await page.click('[data-s]');
await page.waitForTimeout(1200);
await page.mouse.click(640, 360); await page.waitForTimeout(200); await page.mouse.click(640, 360);
await page.waitForFunction(() => window.__zk.game.input.enabled, null, { timeout: 30000 });
const res = {};
for (const lv of [1, 2]) {
  await page.evaluate(() => { const g = window.__zk.game; void g.enterSeam(g.level.seam, g.level.next); });
  await page.waitForFunction((n) => window.__zk.game.level?.id === n && window.__zk.game.input.enabled && window.__zk.game.hunt.stalker, lv, { timeout: 120000 });
  // монстр за 4 м перед гравцем (на navmesh), гравець з ліхтариком
  const placed = await page.evaluate(() => {
    const g = window.__zk.game, s = g.hunt.stalker, p = g.player;
    const fx = -Math.sin(p.yaw + Math.PI), fz = -Math.cos(p.yaw + Math.PI);
    p.yaw += Math.PI; // обличчям від стіни прибуття
    g.flashlightOn = true;
    Object.assign(s.pos, { x: p.pos.x + fx * 4, z: p.pos.z + fz * 4 });
    return { kind: s.kind, x: s.pos.x, z: s.pos.z };
  });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `.shots/mon-${lv}-a.png` });
  // ще ракурс: ближче й трохи збоку
  await page.evaluate(() => { const g = window.__zk.game, s = g.hunt.stalker; window.__zk.tp(s.pos.x + 1.6, s.pos.z + 1.6, Math.atan2(-(s.pos.x - (s.pos.x + 1.6)), -(s.pos.z - (s.pos.z + 1.6))), 0.15); });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `.shots/mon-${lv}-b.png` });
  res[lv] = { placed, state: await page.evaluate(() => window.__zk.game.hunt.stalker.brain.state) };
}
// «Слепой» схоплює: впритул і в погоні
await page.evaluate(() => { const g = window.__zk.game, s = g.hunt.stalker, p = g.player; Object.assign(s.pos, { x: p.pos.x + 0.6, z: p.pos.z }); s.brain.state = 'chase'; s.brain.mem.last = { x: p.pos.x, y: 0, z: p.pos.z }; s.brain.mem.age = 0; });
await page.waitForFunction(() => window.__zk.game.store.progress.deaths > 0, null, { timeout: 15000 });
await page.waitForTimeout(300);
await page.screenshot({ path: '.shots/mon-catch.png' });
await page.waitForFunction(() => window.__zk.game.input.enabled, null, { timeout: 20000 });
res.after = await page.evaluate(() => ({ deaths: window.__zk.game.store.progress.deaths, level: window.__zk.game.level.id }));
console.log(JSON.stringify(res), 'console:', JSON.stringify(logs));
await b.close(); await srv.close();
if (logs.length) process.exitCode = 1;
