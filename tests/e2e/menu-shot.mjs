// Кадр головного меню (після «18+»): node tests/e2e/menu-shot.mjs [webkit|chromium] [назва] [затримка мс]
import { webkit, chromium } from 'playwright';
import { createServer } from 'vite';
const [which = 'webkit', name = 'cur', wait = '6000'] = process.argv.slice(2);
const srv = await createServer({ root: process.cwd(), server: { port: 5191, strictPort: true }, logLevel: 'error' });
await srv.listen();
const b = which === 'chromium'
  ? await chromium.launch({ args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
  : await webkit.launch();
const page = await (await b.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
const logs = [];
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(m.text()); });
page.on('pageerror', (e) => { console.error('pageerror: ' + e.message); process.exit(1); });
await page.goto('http://localhost:5191/?debug&nodbg');
await page.waitForFunction(() => window.__zk?.ready, null, { timeout: 180000 });
await page.click('.age [data-go]');
await page.waitForTimeout(Number(wait));
await page.screenshot({ path: `.shots/menu-${name}-${which}.png` });
if (process.env.DBG) console.log(await page.evaluate(process.env.DBG));
await page.waitForTimeout(3000);
await page.screenshot({ path: `.shots/menu-${name}-${which}-b.png` });
console.log('console:', JSON.stringify(logs), `.shots/menu-${name}-${which}.png`);
await b.close(); await srv.close();
