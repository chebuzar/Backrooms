// Кадри прибуття (новий гравець): пролог пропущено → лежить перед Швом → Шов затягується → підводиться.
// node tests/e2e/arrival.mjs  → .shots/arrival-*.png, помилки консолі — код 1
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
await page.waitForTimeout(600);
await page.click('[data-s]');
await page.waitForTimeout(1500);
await page.mouse.click(640, 360); await page.waitForTimeout(200); await page.mouse.click(640, 360); // пропустити пролог (двічі)
await page.waitForFunction(() => window.__zk.game.rig.wake > 0.99, null, { timeout: 30000 });
const t0 = Date.now();
for (const at of [1.2, 2.6, 3.9, 5.6, 7.6]) {
  await page.waitForTimeout(Math.max(0, at * 1000 - (Date.now() - t0)));
  await page.screenshot({ path: `.shots/arrival-${at}.png` });
}
await page.waitForFunction(() => window.__zk.game.input.enabled, null, { timeout: 10000 });
await page.evaluate(() => { const g = window.__zk.game; g.player.yaw += Math.PI; });
await page.waitForTimeout(800);
await page.screenshot({ path: '.shots/arrival-desk.png' });
console.log('console:', JSON.stringify(logs));
await b.close(); await srv.close();
if (logs.length) process.exitCode = 1;
