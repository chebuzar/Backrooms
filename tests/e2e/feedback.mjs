// Автотест «Книги жалоб и предложений»: гравець у паузі відкриває бланк, пише про неполадку (літери не керують грою),
// здає запис зі знімком екрана; запис із відомостями про гру доходить до сервера (server/server.mjs без бази — у пам'яті);
// розробник ставить статус — гравець бачить відповідь у «Ваших записях»; Esc повертає в паузу; консоль чиста.
// node tests/e2e/feedback.mjs [webkit|chromium] [--device "iPhone 15 Pro landscape"]   (код 1 при збої; кадри — .shots/feedback-*.png)
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { startServer, openPage, BASE } from './lib.mjs';

const which = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'webkit';
const di = process.argv.indexOf('--device'), device = di > 0 ? process.argv[di + 1] : null;
const tag = `${which}${device ? '-' + device.split(' ')[0] : ''}`;
const FB_PORT = 8792, FB = `http://localhost:${FB_PORT}`, KEY = 'e2e-key';
mkdirSync('.shots', { recursive: true });

const api = spawn(process.execPath, ['server/server.mjs'], { env: { ...process.env, PORT: String(FB_PORT), FEEDBACK_KEY: KEY, DATABASE_URL: '' }, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((r) => api.stdout.on('data', (d) => { if (String(d).includes('listening')) r(); }));
const srv = await startServer();
const { browser, page, logs } = await openPage(which, device ? { device } : {});
const fail = [];
const check = (ok, what) => { if (!ok) fail.push(what); console.log(ok ? '✓' : '✗', what); };
const admin = (path, init = {}) => fetch(FB + path, { ...init, headers: { 'x-admin-key': KEY, 'Content-Type': 'application/json', ...(init.headers || {}) } });

try {
  await page.goto(`${BASE}?debug&nodbg&server=${encodeURIComponent(FB)}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__zk?.ready, null, { timeout: 180000 });
  await page.evaluate(() => window.__zk.play());
  await page.waitForFunction(() => window.__zk.game.mode === 'play', null, { timeout: 60000 });
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.__zk.game.pause());
  await page.waitForSelector('.pause [data-fb]');
  await page.click('.pause [data-fb]');
  await page.waitForSelector('.feedback-screen.shown .fb-text');
  await page.waitForSelector('.fb-shot:not([hidden]) img', { timeout: 10000 }).catch(() => {});
  check(await page.isVisible('.fb-shot:not([hidden])'), 'знімок екрана приколото до бланка');

  // текст: літери e / p / f / v не мають керувати грою, стрілки — рухати курсор, а не фокус
  const report = 'На третьем уровне прошёл сквозь стену у лестницы, потом фонарик (f) не включался. Esc-p-v-e.';
  await page.click('.fb-text');
  await page.keyboard.type(report, { delay: 2 });
  await page.keyboard.press('ArrowUp');
  const st = await page.evaluate(() => ({ mode: window.__zk.game.mode, focus: document.activeElement?.className, val: document.querySelector('.fb-text').value }));
  check(st.mode === 'pause' && st.focus === 'fb-text' && st.val === report, 'набір тексту не керує грою, фокус лишається в полі');
  await page.click('[data-k="bug"]');
  await page.screenshot({ path: `.shots/feedback-${tag}-form.png` });

  await page.click('[data-send]');
  await page.waitForSelector('.fb-stamp.on', { timeout: 30000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `.shots/feedback-${tag}-sent.png` });
  const no = await page.evaluate(() => Number(document.querySelector('.fb-stamp span').textContent.replace(/\D/g, '')));
  check(no > 0, `запис прийнято, № ${no}`);

  // що дійшло до сервера
  const list = await (await admin('/admin/feedback')).json();
  const row = list.rows.find((r) => r.id === no);
  check(!!row && row.text === report.trim() && row.kind === 'bug', 'текст і вид запису на сервері');
  check(!!row?.ctx?.build?.commit && row.ctx.build.commit !== 'unknown', `версія збірки: ${row?.ctx?.build?.commit?.slice(0, 8)}`);
  check(row?.ctx?.game?.level?.id !== undefined && Array.isArray(row?.ctx?.game?.pos), `рівень і місце: ${JSON.stringify(row?.ctx?.game?.level)} ${JSON.stringify(row?.ctx?.game?.pos)}`);
  check(!!row?.ctx?.device?.ua && !!row?.ctx?.game?.render?.backend, `пристрій і рендер: ${row?.ctx?.game?.render?.backend}`);
  const shot = row?.has_shot ? Buffer.from(await (await admin(`/admin/feedback/${no}/shot`)).arrayBuffer()) : null;
  check(!!shot && shot[0] === 0xff && shot[1] === 0xd8 && shot.length > 8000, `знімок на сервері (${shot ? Math.round(shot.length / 1024) : 0} КБ)`);

  // повтор того самого тексту не створює нового запису
  const again = await page.evaluate(async () => {
    const { sendFeedback } = await import('/src/net/feedback.ts');
    return sendFeedback({ kind: 'bug', text: document.querySelector('.fb-text').value, shot: null, ctx: {} }, 5000);
  });
  check(again.ok && again.no === no, 'повтор — той самий номер');

  // розробник відповів — гравець бачить статус і відповідь
  await admin(`/admin/feedback/${no}`, { method: 'POST', body: JSON.stringify({ status: 'fixed', note: 'Исправлено: стена у лестницы снова твёрдая.' }) });
  await page.click('[data-send]'); // «Готово»
  await page.waitForSelector('.pause [data-fb]');
  await page.click('.pause [data-fb]');
  await page.waitForSelector('.fb-entry.st-fixed .answer', { timeout: 10000 }).catch(() => {});
  check(await page.isVisible('.fb-entry.st-fixed .answer'), 'гравець бачить «исправлено» і відповідь');
  await page.screenshot({ path: `.shots/feedback-${tag}-answer.png` });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);
  check(await page.evaluate(() => window.__zk.game.mode === 'pause' && !!document.querySelector('.pause.shown')), 'Esc — назад у паузу');

  // спам: без доказу роботи й з приманкою — не зберігається
  const forged = await fetch(FB + '/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'bug', text: 'spam spam spam spam', challenge: 'x', nonce: '1', ms: 9000 }) });
  check(forged.status === 400, 'без доказу роботи — відмова');
  const count = (await (await admin('/admin/feedback')).json()).rows.length;
  check(count === 1, `у базі один запис (${count})`);
  check(logs.length === 0, 'консоль без помилок і попереджень' + (logs.length ? ': ' + logs.join(' | ') : ''));
} catch (e) {
  fail.push(String(e));
  console.error(e);
  await page.screenshot({ path: `.shots/feedback-${tag}-error.png` }).catch(() => {});
} finally {
  await browser.close();
  await srv.close();
  api.kill();
}
if (fail.length) { console.log('FAIL:', fail.join('; ')); process.exitCode = 1; }
