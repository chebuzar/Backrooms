// «Книга жалоб и предложений», коли сервер відгуків лежить (як Ample з gateway_unreachable):
// гра не ламається, запис стає в чергу на пристрої, гравець бачить «отправим позже» і повертається в паузу;
// коли сервер ожив — черга сама досилається при наступному запуску гри, запис з'являється в «Ваших записях».
// node tests/e2e/feedback-offline.mjs [webkit|chromium]   (код 1 при збої)
import { spawn } from 'node:child_process';
import http from 'node:http';
import { mkdirSync } from 'node:fs';
import { startServer, openPage, BASE } from './lib.mjs';

const which = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'webkit';
const API_PORT = 8794, GATE_PORT = 8795, GATE = `http://localhost:${GATE_PORT}`, KEY = 'e2e-key';
mkdirSync('.shots', { recursive: true });

// «шлюз»: поки down — 503 без CORS (так відповідає шлюз хостингу, коли застосунок недоступний), потім — проксі на справжній сервер
let down = true;
const gate = http.createServer((req, res) => {
  if (down) { res.writeHead(503, { 'Content-Type': 'application/json' }); res.end('{"error":"gateway_unreachable"}'); return; }
  const up = http.request({ host: 'localhost', port: API_PORT, path: req.url, method: req.method, headers: { ...req.headers, host: `localhost:${API_PORT}` } }, (r) => { res.writeHead(r.statusCode ?? 502, r.headers); r.pipe(res); });
  up.on('error', () => { res.writeHead(502); res.end(); });
  req.pipe(up);
});
await new Promise((r) => gate.listen(GATE_PORT, r));
const api = spawn(process.execPath, ['server/server.mjs'], { env: { ...process.env, PORT: String(API_PORT), FEEDBACK_KEY: KEY, DATABASE_URL: '' }, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((r) => api.stdout.on('data', (d) => { if (String(d).includes('listening')) r(); }));

const srv = await startServer();
const { browser, page, logs } = await openPage(which);
const fail = [];
const check = (ok, what) => { if (!ok) fail.push(what); console.log(ok ? '✓' : '✗', what); };
// мережеві відмови браузер сам пише в консоль — це очікувано, коли сервер лежить; усе інше — помилка гри
const network = /gateway|503|Failed to load resource|access control|Access-Control|CORS|Load failed|Failed to fetch|NetworkError|status of 50/i;
const url = `${BASE}?debug&nodbg&server=${encodeURIComponent(GATE)}`;

try {
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__zk?.ready, null, { timeout: 180000 });
  await page.evaluate(() => window.__zk.play());
  await page.waitForFunction(() => window.__zk.game.mode === 'play', null, { timeout: 60000 });
  await page.waitForTimeout(1200);
  await page.evaluate(() => window.__zk.game.pause());
  await page.click('.pause [data-fb]');
  await page.waitForSelector('.feedback-screen.shown .fb-text');
  const report = 'Сервер лежит, а я всё равно пишу: дверь на втором уровне не открывается.';
  await page.fill('.fb-text', report);
  await page.waitForTimeout(1600); // мінімальний час заповнення
  await page.click('[data-send]');
  await page.waitForSelector('.fb-msg.warn', { timeout: 20000 }).catch(() => {});
  const st = await page.evaluate(() => ({
    msg: document.querySelector('.fb-msg')?.textContent ?? '', btn: document.querySelector('[data-send]')?.textContent ?? '',
    queued: JSON.parse(localStorage.getItem('zakulisye_feedback_v1') || '{}').outbox?.length ?? 0
  }));
  check(st.queued === 1, `запис у черзі на пристрої (${st.queued})`);
  check(/сохранена/i.test(st.msg), `гравцю сказано, що відправиться пізніше: «${st.msg}»`);
  await page.screenshot({ path: `.shots/feedback-offline-${which}-queued.png` });
  await page.click('[data-send]'); // «Готово»
  await page.waitForSelector('.pause.shown');
  await page.evaluate(() => window.__zk.game.play());
  await page.waitForTimeout(800);
  const mode = await page.evaluate(() => window.__zk.game.mode);
  check(mode === 'play', `після бланка гра йде далі (${mode})`);

  // сервер ожив: наступний запуск гри досилає чергу сам
  down = false;
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__zk?.ready, null, { timeout: 180000 });
  await page.click('.age [data-go]'); // як гравець: «18+» → меню, і тут гра досилає чергу
  await page.waitForFunction(() => (JSON.parse(localStorage.getItem('zakulisye_feedback_v1') || '{}').outbox?.length ?? 1) === 0, null, { timeout: 30000 }).catch(() => {});
  const box = await page.evaluate(() => JSON.parse(localStorage.getItem('zakulisye_feedback_v1') || '{}'));
  check((box.outbox?.length ?? 1) === 0 && box.mine?.length === 1, `черга дослана, у «Ваших записях» — № ${box.mine?.[0]?.no}`);
  const rows = (await (await fetch(`http://localhost:${API_PORT}/admin/feedback`, { headers: { 'x-admin-key': KEY } })).json()).rows;
  check(rows.length === 1 && rows[0].text === report, `на сервері один запис з тим самим текстом (${rows.length})`);
  const bad = logs.filter((l) => !network.test(l));
  check(bad.length === 0, 'консоль без помилок гри' + (bad.length ? ': ' + bad.join(' | ') : ''));
} catch (e) {
  fail.push(String(e));
  console.error(e);
  await page.screenshot({ path: `.shots/feedback-offline-${which}-error.png` }).catch(() => {});
} finally {
  await browser.close();
  await srv.close();
  api.kill();
  gate.close();
}
if (fail.length) { console.log('FAIL:', fail.join('; ')); process.exitCode = 1; }
