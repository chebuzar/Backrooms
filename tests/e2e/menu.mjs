// Меню: «Начать заново» при наявному збереженні питає підтвердження (Отмена — збереження ціле; Да — нове проходження).
//   node tests/e2e/menu.mjs [webkit|chromium]   → код 1, якщо щось не так
import { startServer, openPage, gotoGame, wait } from './lib.mjs';

const which = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'webkit';
const srv = await startServer(process.argv.includes('--prod'));
const di = process.argv.indexOf('--device'), device = di > 0 ? process.argv[di + 1] : null;
const { page, logs, close } = await openPage(which, { device });
const res = {};
let bad = false;
const check = (name, ok, extra) => { res[name] = ok; if (!ok) bad = true; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`, extra === undefined ? '' : JSON.stringify(extra)); };

// збереження з пройденим рівнем 1
await page.addInitScript(() => {
  if (sessionStorage.getItem('seeded')) return;
  sessionStorage.setItem('seeded', '1');
  localStorage.setItem('zakulisye_v3', JSON.stringify({ v: 3, ageConfirmed: true, settings: {}, progress: { checkpoint: { level: 1, spawn: 'start' }, docs: ['order7'], completed: [0], deaths: 2, playSeconds: 600, battery: 0.6 } }));
});
await gotoGame(page);
await page.click('.age [data-go]');
await page.waitForSelector('.menu [data-s]', { timeout: 60000 });
await page.click('.menu [data-s]');
await wait(500);
const ask = await page.$('[data-confirm-yes]');
await wait(1200); // анімація появи бланка
await page.screenshot({ path: `.shots/menu-confirm-${which}${device ? '-' + device.replace(/\s+/g, '_') : ''}.png` });
check('«Начать заново» спрашивает подтверждение', !!ask, { text: await page.evaluate(() => document.querySelector('.confirm')?.textContent?.replace(/\s+/g, ' ').trim() ?? null) });
if (ask) {
  await page.click('[data-confirm-no]');
  await wait(500);
  const kept = await page.evaluate(() => JSON.parse(localStorage.getItem('zakulisye_v3')).progress.checkpoint);
  check('«Отмена» — сохранение на месте, снова меню', !!kept && !!(await page.$('.menu [data-c]')), { kept });
  await page.click('.menu [data-s]');
  await page.waitForSelector('[data-confirm-yes]', { timeout: 5000 });
  await page.click('[data-confirm-yes]');
  const started = await page.waitForSelector('.prologue', { timeout: 10000 }).then(() => true, () => false);
  const fresh = await page.evaluate(() => JSON.parse(localStorage.getItem('zakulisye_v3')).progress);
  check('«Начать заново» после подтверждения — пролог и новое прохождение', started && fresh.docs.length === 0 && fresh.deaths === 0, { docs: fresh.docs, deaths: fresh.deaths });
}
check('консоль без ошибок', logs.length === 0, logs.slice(0, 5));
await close(); await srv.close();
process.exitCode = bad ? 1 : 0;
