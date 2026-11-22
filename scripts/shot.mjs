// Скріншоти гри + помилки консолі + стан гри.
//   node scripts/shot.mjs [--browser chromium|webkit|firefox|all] [--device "iPhone 15 Pro landscape"]
//        [--query "q=high&scene=..."] [--wait 3000] [--name x] [--out .shots] [--webgl] [--eval "js"] [--prod]
// Chromium запускається з програмним WebGPU (SwiftShader/Vulkan), WebKit і Firefox — як є.
// Код виходу 1, якщо в консолі були помилки або попередження.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { createServer, preview } from 'vite';

const require = createRequire(import.meta.url);
const pw = require('playwright');
const A = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (!argv[i].startsWith('--')) continue;
  const k = argv[i].slice(2), v = argv[i + 1];
  if (v === undefined || v.startsWith('--')) A[k] = true; else { A[k] = v; i++; }
}
const outDir = path.resolve(A.out || '.shots');
mkdirSync(outDir, { recursive: true });
const browsers = A.browser === 'all' ? ['chromium', 'webkit', 'firefox'] : String(A.browser || 'chromium').split(',');
const LAUNCH = {
  chromium: { args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] },
  webkit: {},
  firefox: { headless: !process.env.DISPLAY, firefoxUserPrefs: { 'webgl.force-enabled': true, 'webgl.disabled': false, 'webgl.enable-webgl2': true } }
};

const server = A.prod
  ? await preview({ preview: { port: 5191, strictPort: true }, logLevel: 'error' })
  : await createServer({ server: { port: 5191, strictPort: true }, logLevel: 'error', optimizeDeps: { entries: ['index.html'] } });
if (!A.prod) await server.listen();
const base = 'http://localhost:5191/';
let bad = false;

for (const b of browsers) {
  let browser;
  try { browser = await pw[b].launch(LAUNCH[b]); } catch (e) { console.log(JSON.stringify({ browser: b, fail: 'launch: ' + e.message.split('\n')[0] })); bad = true; continue; }
  const ctxOpts = A.device ? { ...pw.devices[A.device] } : { viewport: { width: 1280, height: 720 } };
  if (b === 'firefox') delete ctxOpts.isMobile;
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  const logs = [];
  page.on('pageerror', (e) => logs.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(m.type() + ': ' + m.text()); });
  const q = new URLSearchParams(A.query || '');
  q.set('debug', '1'); if (!A.dbg) q.set('nodbg', '1'); if (A.webgl) q.set('webgl', '1');
  const t0 = Date.now();
  await page.goto(base + '?' + q.toString(), { waitUntil: 'commit', timeout: 120000 });
  let info = null;
  try {
    await page.waitForFunction(() => window.__zk && window.__zk.ready, null, { timeout: 90000 });
    await page.waitForTimeout(Number(A.wait || 2500));
    if (A.eval) info = { eval: await page.evaluate(A.eval) };
    info = { ...(info || {}), ...(await page.evaluate(() => window.__zk.info())) };
  } catch (e) { logs.push('timeout: ' + e.message.split('\n')[0]); }
  const dev = A.device ? A.device.replace(/\s+/g, '_') : 'desktop';
  const file = path.join(outDir, `${A.name || 'shot'}-${b}-${dev}.png`);
  // програмний WebGPU на CI (SwiftShader) з меню-проїздом, що малює кожен кадр, віддає знімок повільно: 30 с за замовчуванням
  // інколи не вистачає (22.11, run 45048945818). Smoke перевіряє консоль і стан гри, а не швидкість знімка, тож даємо більше часу.
  await page.screenshot({ path: file, timeout: 90000 });
  if (logs.length) bad = true;
  console.log(JSON.stringify({ file: path.relative(process.cwd(), file), browser: b, device: dev, loadMs: Date.now() - t0, info, logs }));
  await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 5000))]);
}
if (A.prod) server.httpServer.close(); else await server.close();
process.exit(bad ? 1 : 0);
