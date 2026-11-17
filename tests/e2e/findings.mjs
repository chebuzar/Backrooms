// Знахідки (Д2): по 2 записки й 1 плівці Савельєва на рівень (рівень 0 — нова записка + плівка, бо перша записка вже є).
// Підійти, глянути, натиснути E: записка відкривається; плівка грає (шипіння + субтитри «Савельев: …») і йде в журнал.
//   node tests/e2e/findings.mjs [webkit|chromium]   → .shots/finding-*.png
import { startServer, openPage, gotoGame, wait } from './lib.mjs';
const which = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'webkit';
const srv = await startServer();
const { page, logs, close } = await openPage(which);
let bad = false;
const check = (name, ok, extra) => { if (!ok) bad = true; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`, extra === undefined ? '' : JSON.stringify(extra)); };
await gotoGame(page);
await page.click('.age [data-go]');
await page.waitForSelector('.menu', { timeout: 90000 });
await page.evaluate(() => { const g = window.__zk.game; g.enterLevelStart(); g.play(); g.hunt.update = () => {}; });
for (const lv of [0, 1, 2]) {
  if (lv) await page.evaluate(async (n) => { const g = window.__zk.game; await g.loadLevel(n); g.enterLevelStart(); g.play(); g.hunt.update = () => {}; }, lv);
  await wait(1200);
  const list = await page.evaluate(() => window.__zk.game.findings.map((f) => ({ id: f.id, kind: f.kind, x: f.x, y: f.y, z: f.z })));
  const notes = list.filter((f) => f.kind === 'note').length + (lv === 0 ? 1 : 0), tapes = list.filter((f) => f.kind === 'tape').length;
  check(`уровень ${lv}: 2 записки и 1 плёнка`, notes === 2 && tapes === 1, list.map((f) => f.id));
  for (const f of list) {
    // стати поруч (вільне місце), подивитися на знахідку, натиснути E
    await page.evaluate((f) => {
      const g = window.__zk.game, L = g.level.layout, ph = g.physics;
      const free = (x, z) => !L.walls.some((w) => Math.abs(x - w.x) < w.w / 2 + 0.4 && Math.abs(z - w.z) < w.d / 2 + 0.4);
      for (const r of [1.0, 0.8, 1.25, 0.65, 1.45]) for (let a = 0; a < 6.28; a += 0.3) { const x = f.x + Math.cos(a) * r, z = f.z + Math.sin(a) * r; if (free(x, z) && ph.lineOfSight(x, 1.6, z, f.x, f.y, f.z)) { window.__zk.tp(x, z, Math.atan2(-(f.x - x), -(f.z - z)), Math.atan2(f.y - 1.66, r)); return; } }
    }, f);
    await wait(700);
    const prompt = await page.evaluate(() => document.querySelector('.hud .prompt.on')?.textContent ?? null);
    await page.keyboard.press('KeyE');
    if (f.kind === 'note') {
      const open = await page.waitForSelector('.reader.shown', { timeout: 4000 }).then(() => true, () => false);
      await page.screenshot({ path: `.shots/finding-${f.id}.png` });
      check(`${f.id}: «Читать» → записка открыта`, /Читать/.test(prompt ?? '') && open, { prompt });
      await page.keyboard.press('KeyE');
      await page.waitForFunction(() => !document.querySelector('.reader') && window.__zk.game.mode === 'play', null, { timeout: 4000 }).catch(() => {});
    } else {
      await wait(1500);
      const r = await page.evaluate(() => ({ playing: window.__zk.game.tapes.playing, sub: document.querySelector('.hud .subs.on')?.textContent ?? null, saved: window.__zk.game.store.progress.tapes }));
      await page.screenshot({ path: `.shots/finding-${f.id}.png` });
      check(`${f.id}: «Слушать» → плёнка играет с субтитрами и в журнале`, /Слушать/.test(prompt ?? '') && r.playing === f.id && /Савельев/.test(r.sub ?? '') && r.saved.includes(f.id), { prompt, ...r });
    }
  }
}
// журнал: усе прочитане й прослухане
await page.keyboard.press('KeyJ');
await page.waitForSelector('.journal-screen', { timeout: 3000 }).catch(() => {});
await wait(900);
await page.screenshot({ path: '.shots/finding-journal.png' });
const items = await page.evaluate(() => [...document.querySelectorAll('.journal-screen [data-doc]')].map((b) => b.textContent));
check('журнал: записки и плёнки', items.filter((t) => /Плёнка/.test(t)).length === 3 && items.length >= 8, items);
check('консоль без ошибок', logs.length === 0, logs.slice(0, 5));
await close(); await srv.close();
process.exitCode = bad ? 1 : 0;
