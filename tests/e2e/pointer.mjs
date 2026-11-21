// Миша на ПК після прологу: браузер дозволяє захопити мишу лише одразу після дії гравця (клік, клавіша).
// Гра не має просити захоплення «наосліп» (Firefox пише попередження в консоль), а має показати підказку
// «Щёлкните, чтобы осмотреться», доки миша не захоплена.
//   node tests/e2e/pointer.mjs [webkit|chromium] [--prod]   → .shots/pointer-<браузер>.png; код 1 — якщо ні
import { startServer, openPage, gotoGame, wait } from './lib.mjs';

const which = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'webkit';
const srv = await startServer(process.argv.includes('--prod'));
const { page, logs, close } = await openPage(which);
let bad = false;
const check = (name, ok, extra) => { if (!ok) bad = true; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`, extra === undefined ? '' : JSON.stringify(extra)); };

await gotoGame(page);
// лічильник запитів захоплення без дії гравця
await page.evaluate(() => {
  window.__lockAsks = { all: 0, blind: 0 };
  const orig = HTMLCanvasElement.prototype.requestPointerLock;
  HTMLCanvasElement.prototype.requestPointerLock = function (...a) {
    window.__lockAsks.all++;
    if (navigator.userActivation && !navigator.userActivation.isActive) window.__lockAsks.blind++;
    return orig.apply(this, a);
  };
});
await page.click('.age [data-go]');
await page.waitForSelector('.menu [data-s]', { timeout: 60000 });
await page.click('.menu [data-s]');
await page.waitForSelector('.prologue', { timeout: 10000 });
await wait(800);
await page.keyboard.press('Space'); await wait(200); await page.keyboard.press('Space');
await page.waitForFunction(() => window.__zk.game.input.enabled && window.__zk.game.mode === 'play', null, { timeout: 40000 });
await wait(6500); // «свіжа» дія гравця вже минула — як після 45 с прологу
const st = await page.evaluate(() => ({
  locked: !!document.pointerLockElement,
  hint: !!document.querySelector('.hud .lockhint.on'),
  text: document.querySelector('.hud .lockhint')?.textContent ?? null,
  asks: window.__lockAsks,
  activation: navigator.userActivation ? navigator.userActivation.isActive : 'n/a'
}));
await page.screenshot({ path: `.shots/pointer-${which}.png` });
check('без дії гравця гра не просить захопити мишу', st.asks.blind === 0, st);
check('поки миша не захоплена — підказка «Щёлкните…»', st.locked || (st.hint && /Щёлкните/.test(st.text ?? '')), st);
check('консоль без ошибок', logs.length === 0, logs.slice(0, 5));
await close(); await srv.close();
process.exitCode = bad ? 1 : 0;
