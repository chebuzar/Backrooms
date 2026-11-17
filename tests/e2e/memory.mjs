// Тест пам'яті: рівні 0 → 1 → 2 → 0 (той самий шлях, що й Шов: Game.loadLevel). Після повернення на рівень 0
// пам'ять текстур (МБ), кількість текстур і геометрій мають бути як на початку (±10 %). Код 1 — витік.
//   node tests/e2e/memory.mjs [webkit|chromium] [--prod]
import { startServer, openPage, gotoGame, INFO_JS, wait } from './lib.mjs';

const which = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'webkit';
const srv = await startServer(process.argv.includes('--prod'));
const { page, logs, close } = await openPage(which);
await gotoGame(page, 'q=high');
await page.click('.age [data-go]');
await page.waitForFunction(() => document.querySelector('.menu'), null, { timeout: 30000 });
await page.evaluate(() => window.__zk.game.play());
const snap = async (label) => {
  await wait(2500); // кілька кадрів: усе, що потрібно рівню, вже на GPU
  const m = await page.evaluate(INFO_JS);
  console.log(label.padEnd(8), JSON.stringify(m));
  return m;
};
const rows = [await snap('L0')];
for (const lv of [1, 2, 0]) {
  await page.evaluate(async (n) => { const g = window.__zk.game; await g.loadLevel(n); g.enterLevelStart(); g.play(); }, lv);
  rows.push(await snap(`L${lv}`));
}
const a = rows[0], b = rows[rows.length - 1];
const within = (x, y, k = 0.1) => Math.abs(y - x) <= Math.max(1, x * k);
const res = { texMB: within(a.texMB, b.texMB), tex: within(a.tex, b.tex), geo: within(a.geo, b.geo), totalMB: within(a.totalMB, b.totalMB) };
console.log('L0 → L0:', JSON.stringify({ texMB: [a.texMB, b.texMB], tex: [a.tex, b.tex], geo: [a.geo, b.geo], totalMB: [a.totalMB, b.totalMB], heapMB: [a.heapMB, b.heapMB] }),
  Object.values(res).every(Boolean) ? 'OK' : 'ВИТІК', 'console:', JSON.stringify(logs));
await close(); await srv.close();
process.exitCode = Object.values(res).every(Boolean) && !logs.length ? 0 : 1;
