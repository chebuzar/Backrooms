// Перевірка бібліотек: збирає scripts/libs-check (Vite) і відкриває в Chromium + WebKit.
// Запуск: npm run libs
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build, preview } from 'vite';

const require = createRequire(import.meta.url);
const pw = require('playwright');
const root = fileURLToPath(new URL('./libs-check/', import.meta.url));
const outDir = fileURLToPath(new URL('../.shots/libs-check/', import.meta.url));
await build({ root, base: './', logLevel: 'warn', build: { outDir, emptyOutDir: true, target: 'es2022' } });
const server = await preview({ root, build: { outDir }, preview: { port: 4181, strictPort: true } });
const url = server.resolvedUrls.local[0];
let failed = false;
const LAUNCH = { chromium: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] }, webkit: {} };
for (const name of ['chromium', 'webkit']) {
  const browser = await pw[name].launch(LAUNCH[name]);
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url);
  const res = await page.waitForFunction(() => window.__libs, null, { timeout: 60000 }).then((h) => h.jsonValue()).catch((e) => ({ timeout: { ok: false, info: e.message } }));
  for (const [k, v] of Object.entries(res)) {
    if (!v.ok) failed = true;
    console.log(`[${name}] ${v.ok ? 'OK  ' : 'FAIL'} ${k}: ${v.info}`);
  }
  if (errors.length) { failed = true; console.log(`[${name}] page errors: ${errors.join(' | ')}`); }
  await browser.close();
}
server.httpServer.close();
process.exit(failed ? 1 : 0);
