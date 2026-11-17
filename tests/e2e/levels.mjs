// Рівні 1–2: перехід крізь Шов (справжній шлях гри), кадри з кількох точок, без помилок консолі.
// node tests/e2e/levels.mjs [webkit|chromium]  → .shots/lv<n>-<k>.png
import { webkit, chromium } from 'playwright';
import { createServer } from 'vite';
const which = process.argv[2] ?? 'webkit';
const srv = await createServer({ root: process.cwd(), server: { port: 5191, strictPort: true }, logLevel: 'error' });
await srv.listen();
const b = which === 'chromium'
  ? await chromium.launch({ args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
  : await webkit.launch();
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
const out = [];
for (const [lv, via] of [[1, 'seam'], [2, 'seam']]) {
  // справжній перехід: Шов поточного рівня
  await page.evaluate((v) => { const g = window.__zk.game; void g.enterSeam(v === 'rift' ? g.level.rift : g.level.seam, g.level.next); }, via);
  await page.waitForFunction((n) => window.__zk.game.level?.id === n && window.__zk.game.input.enabled, lv, { timeout: 120000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `.shots/lv${lv}-0.png` });
  // ще кілька точок: світильники вздовж плану
  const pts = await page.evaluate(() => { const L = window.__zk.game.level.layout; const on = L.lights.filter((l) => l.state === 'on'); return [0.2, 0.5, 0.8].map((f) => on[Math.floor(f * on.length)]); });
  let k = 1;
  for (const p of pts) {
    await page.evaluate(([x, z, y]) => window.__zk.tp(x + 1.0, z + 1.0, y, 0.05), [p.x, p.z, k * 1.7]);
    await page.waitForTimeout(900);
    await page.screenshot({ path: `.shots/lv${lv}-${k++}.png` });
  }
  out.push({ lv, id: await page.evaluate(() => window.__zk.game.level.id), calls: await page.evaluate(() => window.__zk.game.gfx.renderer.info.render.drawCalls) });
}
console.log(which, JSON.stringify(out), 'console:', JSON.stringify(logs));
await b.close(); await srv.close();
if (logs.length) process.exitCode = 1;
