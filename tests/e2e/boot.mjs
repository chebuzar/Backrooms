// Відчуття старту: меню з'являється не пізніше ~0.6 с після «Мне есть 18 лет» (рівень може ще вантажитися),
// пролог без пропуску триває ~45–50 с, а пропуск (два натискання) працює.
//   node tests/e2e/boot.mjs [webkit|chromium] [--prod] [--skip-prologue-timing]
import { startServer, openPage, BASE, wait } from './lib.mjs';

const which = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'webkit';
const srv = await startServer(process.argv.includes('--prod'));
const { page, logs, close } = await openPage(which);
let bad = false;
const check = (name, ok, extra) => { if (!ok) bad = true; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`, extra === undefined ? '' : JSON.stringify(extra)); };

await page.goto(`${BASE}?debug&nodbg`, { waitUntil: 'commit' });
// як гравець: натиснути, щойно кнопка з'явилася (рівень ще вантажиться)
await page.waitForSelector('.age [data-go]', { timeout: 120000 });
await wait(1500); // прочитати попередження
const loadedAtClick = await page.evaluate(() => !!window.__zk?.ready);
// момент появи меню — у самій сторінці (опитування Playwright саме гальмує, поки рівень довантажується)
await page.evaluate(() => {
  window.__menuAt = null;
  const t0 = performance.now();
  new MutationObserver((_, o) => { if (document.querySelector('.screen.shown .menu [data-s]')) { window.__menuAt = performance.now() - t0; o.disconnect(); } })
    .observe(document.body, { subtree: true, childList: true, attributes: true });
  document.querySelector('.age [data-go]').click();
});
await wait(600);
// що бачить гравець через 0.6 с: бланк меню вже на екрані (не чорний кадр)
const shot = await page.screenshot({ path: `.shots/boot-menu-600ms-${which}.png` });
const menuMs = await page.evaluate(() => window.__menuAt);
const visible = await page.evaluate(() => { const el = document.querySelector('.screen.shown .dossier'); return !!el && parseFloat(getComputedStyle(el.closest('.screen')).opacity) > 0.5; });
check('меню после «18+» ≤ 0.6 с (и видно на кадре через 0.6 с)', menuMs !== null && menuMs <= 600 && visible, { menuMs: menuMs && Math.round(menuMs), visible, loadedAtClick, shotKB: Math.round(shot.length / 1024) });
await page.waitForSelector('.screen.shown .menu [data-s]', { timeout: 120000 });

if (!process.argv.includes('--skip-prologue-timing')) {
  await page.click('.menu [data-s]');
  await page.waitForSelector('.prologue', { timeout: 10000 });
  const p0 = Date.now();
  await page.waitForFunction(() => !document.querySelector('.prologue:not(.title-card)'), null, { timeout: 150000 });
  const sec = (Date.now() - p0) / 1000;
  check('пролог без пропуска — 40…52 с', sec >= 40 && sec <= 52, { sec: +sec.toFixed(1) });
  const ready = await page.waitForFunction(() => window.__zk.game.input.enabled && window.__zk.game.mode === 'play', null, { timeout: 60000 }).then(() => true, () => false);
  check('после пролога — игра', ready);
}
check('консоль без ошибок', logs.length === 0, logs.slice(0, 5));
await close(); await srv.close();
process.exitCode = bad ? 1 : 0;
