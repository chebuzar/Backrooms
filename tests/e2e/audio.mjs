// Автотест: після справжнього натискання (Safari вимагає жест) записані звуки завантажуються й декодуються (AAC .m4a),
// без помилок у консолі. node tests/e2e/audio.mjs [webkit|chromium]
import { webkit, chromium } from 'playwright';
import { startServer, BASE } from './lib.mjs';

const which = process.argv[2] ?? 'webkit';
const srv = await startServer(); // спільні налаштування сервера тестів (lib.mjs)
const b = which === 'chromium'
  ? await chromium.launch({ args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
  : await webkit.launch();
const page = await (await b.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
const logs = [];
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(m.text()); });
page.on('pageerror', (e) => logs.push('pageerror: ' + e.message));
await page.goto(BASE + '?debug&nodbg');
await page.waitForFunction(() => window.__zk?.ready, null, { timeout: 180000 });
await page.click('.age [data-go]');
await page.waitForTimeout(800);
await page.click('[data-s]'); // «Начать экспедицию» — жест, що розблоковує звук
await page.waitForFunction(() => window.__zk.game.sfx.ready, null, { timeout: 60000 });
const info = await page.evaluate(() => {
  const s = window.__zk.game.sfx;
  return { state: window.__zk.game.audio.ctx?.state, step: !!s.get('step_0'), carpet: !!s.get('carpet_0'), door: !!s.pick('doorclose'), amb: !!s.get('amb_l0') };
});
console.log(which, JSON.stringify(info), 'console:', JSON.stringify(logs));
await b.close(); await srv.close();
if (logs.length || !info.step || !info.carpet || !info.door || !info.amb) process.exitCode = 1;
