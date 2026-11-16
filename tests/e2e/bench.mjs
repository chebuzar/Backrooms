// Автотест: «Тест швидкодії» (?bench) проходить усі пресети й показує таблицю; дебаг-панель відкривається.
// node tests/e2e/bench.mjs [webkit|chromium]
import { webkit, chromium, devices } from 'playwright';
import { createServer } from 'vite';
const srv = await createServer({ root: process.cwd(), server: { port: 5191, strictPort: true }, logLevel: 'error' });
await srv.listen();
const which = process.argv[2] ?? 'webkit';
const b = which === 'chromium'
  ? await chromium.launch({ args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
  : await webkit.launch();
const page = await (await b.newContext(which === 'chromium' ? { viewport: { width: 1280, height: 800 } } : { ...devices['iPad Pro 11 landscape'] })).newPage();
const logs = [];
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(m.text()); });
page.on('pageerror', (e) => logs.push('pageerror: ' + e.message));
await page.goto('http://localhost:5191/?debug&bench=' + (process.argv[3] ?? 'ultra,low'));
await page.waitForSelector('.bench-result', { timeout: 300000 });
await page.screenshot({ path: `.shots/bench-${which}.png` });
const text = await page.locator('.bench-result').innerText();
await page.locator('.bench-result').evaluate((e) => e.remove());
await page.locator('.dbg-btn').click();
await page.waitForTimeout(800);
await page.screenshot({ path: `.shots/debug-${which}.png` });
console.log(text);
console.log('console:', JSON.stringify(logs));
await b.close(); await srv.close();
if (logs.length || !/FPS/.test(text)) process.exitCode = 1;
