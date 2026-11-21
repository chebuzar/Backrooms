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
// гучномовець: дзвін, голос і субтитр; луна й тиск рівня
await page.waitForFunction(() => window.__zk.game.mode === 'play', null, { timeout: 120000 }).catch(() => {});
await page.evaluate(() => { const g = window.__zk.game; const h = g.hud, o = h.subtitle.bind(h); window.__subs = []; h.subtitle = (t, n) => { window.__subs.push(t); o(t, n); }; g.soundscape.update(0.1, { x: g.player.pos.x, z: g.player.pos.z, dread: 0.5, silence: 0, danger: 0 }); g.soundscape.announce(g.player.pos.x, g.player.pos.z, 3); });
await page.waitForFunction(() => window.__subs.some((t) => t.startsWith('Громкоговоритель')), null, { timeout: 15000 }).catch(() => {});
info.pa = await page.evaluate(() => window.__subs.some((t) => t.startsWith('Громкоговоритель')));
info.wet = await page.evaluate(() => +window.__zk.game.audio.reverbSend.gain.value.toFixed(2));
console.log(which, JSON.stringify(info), 'console:', JSON.stringify(logs));
await b.close(); await srv.close();
if (logs.length || !info.step || !info.carpet || !info.door || !info.amb || !info.pa) process.exitCode = 1;
