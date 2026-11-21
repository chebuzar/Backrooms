// Камера як предмет, блокнот і годинник: кадр очима → камера піднята (видно приховане) → блокнот із картою → годинник.
// node tests/e2e/camera.mjs [webkit|chromium] [device]  →  .shots/cam-<браузер>-*.png
import { startServer, openPage, gotoGame, wait } from './lib.mjs';

const which = process.argv[2] ?? 'webkit', device = process.argv[3] ?? null;
const srv = await startServer();
const { page, logs, close } = await openPage(which, device ? { device } : {});
const tag = `${which}${device ? '-' + device.replace(/\s+/g, '_') : ''}`;
try {
  await gotoGame(page);
  for (let k = 0; k < 6; k++) {
    await page.evaluate(() => window.__zk.play());
    await wait(1500);
    if (await page.evaluate(() => window.__zk.game.mode === 'play')) break;
  }
  // пройтися по шляху до Шва кілька кроків (карта олівцем)
  await page.evaluate(() => {
    const g = window.__zk.game, l = g.level.layout;
    for (let i = 0; i < 40; i++) g.mapmem.mark(l.spawn.x + Math.sin(i / 6) * i * 0.4, l.spawn.z + i * 0.35);
  });
  await wait(1200);
  await page.screenshot({ path: `.shots/cam-${tag}-eye.png` });
  await page.evaluate(() => window.__zk.game.input.press('camera'));
  await wait(1500);
  await page.screenshot({ path: `.shots/cam-${tag}-cam.png` });
  await page.evaluate(() => window.__zk.game.input.press('zoom'));
  await wait(1200);
  await page.screenshot({ path: `.shots/cam-${tag}-zoom.png` });
  await page.evaluate(() => { const g = window.__zk.game; g.input.press('zoom'); g.input.press('camera'); });
  await wait(800);
  await page.evaluate(() => window.__zk.game.input.press('watch'));
  await wait(900);
  await page.screenshot({ path: `.shots/cam-${tag}-watch.png` });
  await page.evaluate(() => window.__zk.game.input.press('journal'));
  await wait(1200);
  await page.screenshot({ path: `.shots/cam-${tag}-book.png` });
} finally {
  await close(); await srv.close();
}
console.log('console:', JSON.stringify(logs));
if (logs.length) process.exitCode = 1;
