// Огляд рівнів 1 і 2: кілька кадрів у різних зонах (ліхтарик увімкнено) — для оцінки вигляду бази й парковки.
// node tests/e2e/levels.mjs [webkit|chromium] [назва]  →  .shots/levels-<назва>-<браузер>.png
import { startServer, openPage, gotoGame, wait } from './lib.mjs';
import { execFileSync } from 'node:child_process';

const which = process.argv[2] ?? 'webkit', name = process.argv[3] ?? 'cur';
const srv = await startServer();
const { page, logs, close } = await openPage(which, {});
const files = [];
try {
  await gotoGame(page);
  for (let k = 0; k < 6; k++) {
    await page.evaluate(() => window.__zk.play());
    await wait(1500);
    if (await page.evaluate(() => window.__zk.game.mode === 'play')) break;
  }
  for (const id of [1, 2]) {
    await page.evaluate(async (id) => { const g = window.__zk.game; await g.loadLevel(id); g.enterLevelStart(false); g.play(); }, id);
    await page.evaluate(() => { document.querySelector('.touch')?.classList.remove('shown'); });
    await wait(3000);
    const pts = await page.evaluate(() => {
      const l = window.__zk.game.level.layout, out = [];
      const free = (x, z) => !l.walls.some((w) => Math.abs(x - w.x) < w.w / 2 + 0.5 && Math.abs(z - w.z) < w.d / 2 + 0.5);
      out.push([l.spawn.x, l.spawn.z, l.spawn.yaw + Math.PI]);
      const W = l.cols * l.cell, D = l.rows * l.cell;
      for (const [fx, fz, yaw] of [[0.25, 0.3, 0.8], [0.7, 0.25, 2.4], [0.5, 0.6, 4], [0.8, 0.8, 5.5]]) {
        let x = fx * W, z = fz * D;
        for (let r = 0; r < 8 && !free(x, z); r += 0.4) { x += 0.6; z += 0.3; }
        out.push([x, z, yaw]);
      }
      for (const d of window.__zk.game.dressed.slice(0, 4)) out.push([d.x + Math.sin(d.yaw) * 1.9, d.z + Math.cos(d.yaw) * 1.9, d.yaw, d.kind]);
      return out.slice(0, 7);
    });
    for (const [i, [x, z, yaw]] of pts.entries()) {
      await page.evaluate(([x, z, yaw, i]) => { window.__zk.tp(x, z, yaw, i > 4 ? -0.45 : -0.05); window.__zk.game.flashlightOn = i % 2 === 1 || i > 4; }, [x, z, yaw, i]);
      await wait(2400);
      const f = `.shots/lv-${name}-${which}-${id}-${i}.png`;
      await page.screenshot({ path: f }); files.push(f);
    }
  }
} finally {
  await close(); await srv.close();
}
execFileSync('python3', ['-c', `
import sys
from PIL import Image
fs=sys.argv[2:]; W=Image.new('RGB',(7*512,2*288))
for i,f in enumerate(fs): W.paste(Image.open(f).resize((512,288)),((i%7)*512,(i//7)*288))
W.save(sys.argv[1])`, `.shots/levels-${name}-${which}.png`, ...files]);
console.log('console:', JSON.stringify(logs));
if (logs.length) process.exitCode = 1;
