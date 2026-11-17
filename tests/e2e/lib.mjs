// Спільне для автотестів у браузері: сервер (dev або зібраний), запуск браузера (Chromium — програмний WebGPU),
// збір помилок/попереджень консолі, вага завантаження, кроки «як гравець».
import { createRequire } from 'node:module';
import { createServer, preview } from 'vite';

const require = createRequire(import.meta.url);
const pw = require('playwright');

export const CHROMIUM_ARGS = ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader',
  '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
export const PORT = Number(process.env.ZK_PORT || 5191);
export const BASE = `http://localhost:${PORT}/`;

/** Сервер гри: dev (за замовчуванням) або зібрана версія (prod = true, потрібен `npm run build`). */
export async function startServer(prod = false) {
  if (prod) {
    const s = await preview({ preview: { port: PORT, strictPort: true }, logLevel: 'error' });
    return { close: () => new Promise((r) => s.httpServer.close(() => r())) };
  }
  // свій кеш Vite для кожної копії коду (дві копії зі спільним node_modules інакше ламають одна одній «оптимізовані залежності»)
  const s = await createServer({ root: process.cwd(), cacheDir: '.vite', server: { port: PORT, strictPort: true, fs: { strict: false } }, logLevel: 'error',
    optimizeDeps: { entries: ['index.html', 'src/dev/*.ts'] } });
  await s.listen();
  return { close: () => s.close() };
}

/** Браузер за назвою: chromium | webkit | firefox; device — назва з playwright.devices (iPhone/iPad). */
export async function openPage(which = 'webkit', { device = null, viewport = { width: 1280, height: 720 }, dpr = 1 } = {}) {
  const browser = await pw[which].launch(which === 'chromium' ? { args: CHROMIUM_ARGS } : which === 'firefox' ? { headless: !process.env.DISPLAY } : {});
  const opts = device ? { ...pw.devices[device] } : { viewport, deviceScaleFactor: dpr };
  if (which === 'firefox') delete opts.isMobile;
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(`${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => logs.push('pageerror: ' + e.message));
  // вага завантаження: байти відповідей сервера (усі запити сторінки)
  const net = { bytes: 0, count: 0 };
  page.on('response', async (r) => {
    try { const b = await r.body(); net.bytes += b.length; net.count++; } catch { /* перенаправлення / скасовано */ }
  });
  return { browser, ctx, page, logs, net, close: () => Promise.race([browser.close(), new Promise((r) => setTimeout(r, 5000))]) };
}

/** Відкрити гру з ?debug (без панелі) і дочекатися, поки рівень 0 готовий. */
export async function gotoGame(page, query = '') {
  await page.goto(`${BASE}?debug&nodbg${query ? '&' + query : ''}`, { waitUntil: 'commit', timeout: 120000 });
  await page.waitForFunction(() => window.__zk?.ready, null, { timeout: 240000 });
}

export const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Стан для порівнянь: draw calls, трикутники й пам'ять GPU (renderer.info). */
export const INFO_JS = () => {
  const r = window.__zk.game.gfx.renderer, i = r.info;
  const m = i.memory;
  return {
    draw: i.render.drawCalls, tris: Math.round(i.render.triangles),
    tex: m.textures, texMB: +(m.texturesSize / 1048576).toFixed(1), geo: m.geometries,
    attrMB: +((m.attributesSize + m.indexAttributesSize) / 1048576).toFixed(1), totalMB: +(m.total / 1048576).toFixed(1),
    heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null
  };
};

export const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor((s.length - 1) / 2)] : 0; };
