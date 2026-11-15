// Инструмент QA: открыть игру в браузере, поставить сцену, сделать скриншот, собрать ошибки и FPS.
//
//   node scripts/shot.mjs                                  меню, Chromium, 1280×720
//   node scripts/shot.mjs --level 3                        уровень 3 у точки старта
//   node scripts/shot.mjs --level all --browser all        все уровни в Chromium и WebKit (Safari)
//   node scripts/shot.mjs --level 0 --scene exit           перед дверью выхода
//   node scripts/shot.mjs --level 5 --scene monster        монстр перед камерой
//   node scripts/shot.mjs --level 0 --scene find:lunar     перед дивной находкой (lunar, astronaut, procession, carousel, seats, soda или номер)
//   node scripts/shot.mjs --device "iPhone 15 Pro landscape" --browser webkit
//   node scripts/shot.mjs --level 2 --fps                  замер FPS (3 с)
//   node scripts/shot.mjs --panel help --lang uk           экран меню: settings, levels, help, about, journal, ach, online
//   node scripts/shot.mjs --prod                           собранная версия (dist/) вместо dev-сервера
//
// Прочие флаги: --scene spawn|exit|monster, --wait <мс>, --q low|med|high|auto, --diff easy|normal|nightmare,
// --seed <n>, --yaw <рад>, --eval "<js>" (выполнить в странице перед снимком), --out <папка>, --url <адрес>,
// --scale 1|2 (deviceScaleFactor), --name <имя файла>.
//
// Выход: PNG в .shots/ (или --out) и строка-отчёт на каждый снимок. Код возврата 1, если были ошибки страницы.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const pw = require('playwright');

// ---------- аргументы
const argv = process.argv.slice(2);
const A = {};
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (!a.startsWith('--')) continue;
  const k = a.slice(2), v = argv[i + 1];
  if (v === undefined || v.startsWith('--')) A[k] = true; else { A[k] = v; i++; }
}
const browsers = A.browser === 'all' ? ['chromium', 'webkit'] : [A.browser || 'chromium'];
const levels = A.level === undefined ? [null] : A.level === 'all' ? [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] : String(A.level).split(',').map(Number);
const scene = A.scene || 'spawn';
const outDir = path.resolve(A.out || '.shots');
mkdirSync(outDir, { recursive: true });

// ---------- сервер
let server = null, base = A.url;
if (!base) {
  const vite = await import('vite');
  if (A.prod) {
    server = await vite.preview({ preview: { port: 4180, strictPort: false }, logLevel: 'error' });
  } else {
    server = await vite.createServer({ server: { port: 5180, strictPort: false, host: '127.0.0.1' }, logLevel: 'error' });
    await server.listen();
  }
  base = server.resolvedUrls.local[0];
}

const query = new URLSearchParams({ debug: '1' });
if (A.lang) query.set('lang', A.lang);
// --query "tier=3&apple" — дополнительные параметры адреса (напр. притвориться устройством: apple|android, tier=0..3)
if (A.query) for (const [k, v] of new URLSearchParams(A.query)) query.set(k, v);
const url = base + (base.includes('?') ? '&' : '?') + query;

const LAUNCH = {
  chromium: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] },
  webkit: {}
};

let hadErrors = false;

async function run(bname, lv) {
  const browser = await pw[bname].launch(LAUNCH[bname]);
  const devName = A.device;
  const ctxOpts = devName ? { ...pw.devices[devName] } : { viewport: { width: 1280, height: 720 } };
  if (devName && !pw.devices[devName]) throw new Error('Нет такого устройства в Playwright: ' + devName);
  if (A.scale) ctxOpts.deviceScaleFactor = Number(A.scale);
  const ctx = await browser.newContext(ctxOpts);
  // Настройки сохранения: качество графики, подсказки уже показаны, все уровни открыты.
  await ctx.addInitScript(({ q, diff }) => {
    try {
      const k = 'zakulisye_v2';
      const s = JSON.parse(localStorage.getItem(k) || '{}');
      s.set = Object.assign({ sens: 1, vol: 0, q: 'auto', diff: 'normal', vib: false }, s.set || {}, { q, diff, vol: 0 });
      s.toolsTip = 1; s.max = Math.max(s.max ?? -1, 9);
      localStorage.setItem(k, JSON.stringify(s));
    } catch (e) { /* ignore */ }
  }, { q: A.q || 'high', diff: A.diff || 'normal' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
  page.on('requestfailed', (r) => errors.push('requestfailed: ' + r.url() + ' ' + (r.failure() && r.failure().errorText)));

  const t0 = Date.now();
  await page.goto(url);
  await page.waitForFunction(() => window.__zkReady === true && window.__zk, null, { timeout: 90000 });
  const loadMs = Date.now() - t0;
  await page.click('#splash').catch(() => {});
  await page.waitForTimeout(500);

  let label;
  if (lv === null) {
    if (A.panel) {
      await page.evaluate((id) => { const b = document.querySelector(`#menu [data-go="${id}"]`); b && b.click(); }, A.panel);
      label = 'panel-' + A.panel;
    } else label = 'menu';
    await page.waitForTimeout(Number(A.wait || 1200));
  } else {
    await page.evaluate(([l, seed, god]) => { window.__zk.god(god); window.__zk.start(l, seed ? { seed: Number(seed) } : {}); }, [lv, A.seed, scene !== 'death']);
    await page.waitForFunction(() => window.__zk.ready, null, { timeout: 90000 });
    await page.evaluate(([sc, yaw]) => {
      const z = window.__zk;
      if (sc !== 'monster') z.calm();
      if (sc === 'exit') z.toExit();
      if (sc.startsWith('find')) z.toFind(sc.includes(':') ? (isNaN(+sc.split(':')[1]) ? sc.split(':')[1] : +sc.split(':')[1]) : 0);
      if (yaw !== undefined) z.look(Number(yaw));
      if (sc === 'monster') z.meet(4.5);
    }, [scene, A.yaw]);
    await page.waitForTimeout(Number(A.wait || 1500));
    label = `lv${lv}-${scene}`;
  }
  if (A.eval) { await page.evaluate(`(async () => { ${A.eval} })()`); await page.waitForTimeout(400); }

  let fps = null;
  if (A.fps) {
    fps = await page.evaluate(() => new Promise((res) => {
      const ts = []; const t0 = performance.now();
      const f = (t) => { ts.push(t); if (t - t0 < 3000) requestAnimationFrame(f); else {
        const d = ts.slice(1).map((v, i) => v - ts[i]).sort((a, b) => a - b);
        res({ avg: +(1000 / (d.reduce((a, b) => a + b, 0) / d.length)).toFixed(1), p95ms: +d[Math.floor(d.length * 0.95)].toFixed(1) });
      } };
      requestAnimationFrame(f);
    }));
  }
  const info = await page.evaluate(() => window.__zk.info());
  const dev = devName ? devName.replace(/\s+/g, '_') : 'desktop';
  const file = path.join(outDir, `${A.name ? A.name + (lv !== null && levels.length > 1 ? "-lv" + lv : "") : label}-${bname}-${dev}${A.lang ? '-' + A.lang : ''}.png`);
  await page.screenshot({ path: file, timeout: 120000 });
  if (errors.length) hadErrors = true;
  console.log(JSON.stringify({ file: path.relative(process.cwd(), file), browser: bname, device: dev, loadMs, fps, info, errors }));
  await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 5000))]);
}

try {
  for (const b of browsers) for (const lv of levels) {
    try { await run(b, lv); } catch (e) { hadErrors = true; console.log(JSON.stringify({ browser: b, level: lv, fail: e.message.split('\n')[0] })); }
  }
} finally {
  if (server) { if (server.httpServer) { server.httpServer.closeAllConnections?.(); server.httpServer.close(); } if (server.close) await server.close().catch(() => {}); }
}
process.exit(hadErrors ? 1 : 0);
