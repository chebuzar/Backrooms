// Скріншот моделі в Chromium і WebKit: npm run asset-view -- <файл.glb>
// Перевіряє, що модель (зокрема KTX2 + Meshopt) відкривається в three 0.160 без помилок.
// Знімки — у .shots/asset-<ім'я>-<браузер>.png
import { createRequire } from 'node:module';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const require = createRequire(import.meta.url);
const pw = require('playwright');
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const file = resolve(process.argv[2] || '');
const server = await createServer({ root: fileURLToPath(new URL('./asset-view/', import.meta.url)), logLevel: 'error', server: { port: 4182, strictPort: true, fs: { allow: [ROOT, file] } } });
await server.listen();
const basis = '/@fs' + resolve(ROOT, 'node_modules/three/examples/jsm/libs/basis') + '/';
const url = `http://localhost:4182/?src=${encodeURIComponent('/@fs' + file)}&basis=${encodeURIComponent(basis)}`;
const LAUNCH = { chromium: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] }, webkit: {} };
let failed = false;
for (const name of ['chromium', 'webkit']) {
  const browser = await pw[name].launch(LAUNCH[name]);
  const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(url);
  const v = await page.waitForFunction(() => window.__view, null, { timeout: 60000 }).then((h) => h.jsonValue()).catch((e) => ({ ok: false, error: e.message }));
  const shot = resolve(ROOT, `.shots/asset-${basename(file, '.glb')}-${name}.png`);
  await page.screenshot({ path: shot });
  if (!v.ok || errors.length) failed = true;
  console.log(`[${name}] ${v.ok ? 'OK' : 'FAIL'} ${JSON.stringify(v)}${errors.length ? ' errors: ' + errors.join(' | ') : ''}\n  ${shot}`);
  await browser.close();
}
await server.close();
process.exit(failed ? 1 : 0);
