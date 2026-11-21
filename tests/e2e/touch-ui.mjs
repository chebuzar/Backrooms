// Значки на iPad/iPhone: жодних емодзі й «веселих» картинок — лише строгі лінійні позначки з підписами,
// як на радянських приладах. Перевіряє кнопки дотику, підказку «Действие» біля предмета, навчання і екран «Управление».
//   node tests/e2e/touch-ui.mjs [webkit|chromium] [--device "iPad Pro 11 landscape"]
//   → .shots/touch-ui-<що>-<пристрій>.png; код 1 — якщо знайдено емодзі або чогось бракує
import { startServer, openPage, gotoGame, wait } from './lib.mjs';

const which = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'webkit';
const di = process.argv.indexOf('--device'), device = di > 0 ? process.argv[di + 1] : 'iPad Pro 11 landscape';
const srv = await startServer(process.argv.includes('--prod'));
const { page, logs, close } = await openPage(which, { device });
let bad = false;
const check = (name, ok, extra) => { if (!ok) bad = true; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`, extra === undefined ? '' : JSON.stringify(extra)); };
const tag = device.replace(/\s+/g, '_');
// емодзі й піктограми-символи (стрілки, руки, кружечки, усе з площини емодзі)
const EMOJI = /[←-⇿⌀-⏿①-➿⤀-⯿\u{1F000}-\u{1FAFF}]|️/u;
const emojiIn = (s) => [...(s ?? '')].filter((ch) => EMOJI.test(ch));

await gotoGame(page);
await page.tap('.age [data-go]');
await page.waitForSelector('.menu [data-s]', { timeout: 60000 });
await page.tap('.menu [data-s]');
await page.waitForSelector('.prologue', { timeout: 10000 });
await wait(800);
await page.tap('.prologue'); await wait(200); await page.tap('.prologue');
await page.waitForFunction(() => window.__zk.game.input.enabled && window.__zk.game.mode === 'play', null, { timeout: 40000 });
await wait(1500);

// 1) навчання + кнопки
await page.waitForSelector('.tutorial.on', { timeout: 8000 }).catch(() => {});
await wait(700);
await page.screenshot({ path: `.shots/touch-ui-buttons-${tag}.png` });
const btn = await page.evaluate(() => [...document.querySelectorAll('.touch .tb')].map((b) => ({ cls: b.className, text: b.textContent.trim(), svg: !!b.querySelector('svg') })));
check('кнопки: у кожної значок, у всіх, крім паузы, — подпись', btn.length === 7 && btn.every((b) => b.svg) && btn.filter((b) => !/tb-pause/.test(b.cls)).every((b) => b.text.length >= 2), btn);
const tut = await page.evaluate(() => document.querySelector('.hud .tutorial')?.textContent ?? '');
check('навчання без емодзі', emojiIn(tut).length === 0, { tut });

// 2) підказка біля документа — «клавіша» на дотику
await page.evaluate(() => {
  const g = window.__zk.game, L = g.level, doc = Object.values(L.spots)[0];
  window.__zk.tp(doc.x + 0.9, doc.z + 0.3, Math.atan2(0.9, 0.3), Math.atan2(doc.y - 1.66, Math.hypot(0.9, 0.3)));
});
const shown = await page.waitForSelector('.hud .prompt.on', { timeout: 6000 }).then(() => true, () => false);
await wait(400);
await page.screenshot({ path: `.shots/touch-ui-prompt-${tag}.png` });
const pr = await page.evaluate(() => { const k = document.querySelector('.hud .prompt kbd'); return { text: document.querySelector('.hud .prompt')?.textContent ?? '', kbd: k?.textContent ?? '', svg: !!k?.querySelector('svg') }; });
check('подсказка у предмета видна', shown, pr);
check('в подсказке вместо ✋ — значок кнопки «Действие»', emojiIn(pr.text).length === 0 && pr.svg, pr);

// 3) пауза → «Управление»
await page.tap('.tb-pause');
await page.waitForSelector('.screen.pause [data-ctl]', { timeout: 4000 });
await page.tap('.screen.pause [data-ctl]');
await page.waitForSelector('.controls-screen', { timeout: 4000 });
await wait(1200);
await page.screenshot({ path: `.shots/touch-ui-controls-${tag}.png` });
const ctl = await page.evaluate(() => { const el = document.querySelector('.controls-screen'); return { text: el?.textContent ?? '', icons: el?.querySelectorAll('.ti svg').length ?? 0 }; });
check('«Управление» без емодзі, у каждой строки значок', emojiIn(ctl.text).length === 0 && ctl.icons === 9, { emoji: emojiIn(ctl.text), icons: ctl.icons });
check('консоль без ошибок', logs.length === 0, logs.slice(0, 5));
await close(); await srv.close();
process.exitCode = bad ? 1 : 0;
