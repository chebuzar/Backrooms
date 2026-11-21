// Психологічний шар: зрив нервів (кадр), галюцинація лише для очей (у камері її нема), тіло після смерті, особова справа.
// node tests/e2e/psyche.mjs [webkit|chromium]  →  .shots/psy-<браузер>.png (сітка)
import { startServer, openPage, gotoGame, wait } from './lib.mjs';
import { execFileSync } from 'node:child_process';

const which = process.argv[2] ?? 'webkit';
const srv = await startServer();
const { page, logs, close } = await openPage(which, {});
const files = [];
const shot = async (n) => { const f = `.shots/psy-${which}-${n}.png`; await page.screenshot({ path: f }); files.push(f); };
try {
  await gotoGame(page);
  for (let k = 0; k < 6; k++) {
    await page.evaluate(() => window.__zk.play());
    await wait(1500);
    if (await page.evaluate(() => window.__zk.game.mode === 'play')) break;
  }
  await page.evaluate(() => { document.querySelector('.touch')?.classList.remove('shown'); });
  await wait(4000);
  await shot('calm');
  // довгий коридор, нерви на межі → галюцинація попереду
  const st = await page.evaluate(() => {
    const g = window.__zk.game, l = g.level.layout;
    let best = null;
    for (let i = 0; i < 400 && !best; i++) {
      const x = (Math.floor(Math.random() * l.cols) + 0.5) * l.cell, z = (Math.floor(Math.random() * l.rows) + 0.5) * l.cell, yaw = [0, Math.PI / 2, Math.PI, -Math.PI / 2][i % 4];
      if (l.walls.some((w) => Math.abs(x - w.x) < w.w / 2 + 0.45 && Math.abs(z - w.z) < w.d / 2 + 0.45)) continue;
      if (g.ray(x, z, -Math.sin(yaw), -Math.cos(yaw), 16) > 13) best = [x, z, yaw];
    }
    if (best) window.__zk.tp(best[0], best[1], best[2], 0);
    g.psyche.nerves = 0.9;
    g.psyche.ghostCd = 0;
    return !!best;
  });
  await wait(3500);
  console.log('corridor', st, 'ghost', await page.evaluate(() => JSON.stringify(window.__zk.game.psyche.ghostAt)), 'stills', await page.evaluate(() => window.__zk.game.psyche.stillCount));
  await shot('ghost-eye');
  await page.evaluate(() => window.__zk.game.input.press('camera'));
  await wait(1500);
  await shot('ghost-cam');
  console.log('ghost after camera', await page.evaluate(() => JSON.stringify(window.__zk.game.psyche.ghostAt)));
  await page.evaluate(() => window.__zk.game.input.press('camera'));
  await wait(1000);
  // смерть → тіло на цьому місці; дивимось на нього з відстані
  const at = await page.evaluate(() => { const p = window.__zk.game.player.pos; return [p.x, p.z]; });
  await page.evaluate(() => window.__zk.game.caught());
  await wait(7000);
  await page.evaluate(([x, z]) => { window.__zk.tp(x + 1.6, z + 1.6, Math.atan2(1.6, 1.6), -0.55); window.__zk.game.flashlightOn = true; }, at);
  await wait(2500);
  await shot('body');
  await page.evaluate(() => window.__zk.game.readDoc('delo7'));
  await wait(1500);
  await shot('delo7');
} finally {
  await close(); await srv.close();
}
execFileSync('python3', ['-c', `
import sys
from PIL import Image
fs=sys.argv[2:]; W=Image.new('RGB',(3*640,2*360))
for i,f in enumerate(fs): W.paste(Image.open(f).resize((640,360)),((i%3)*640,(i//3)*360))
W.save(sys.argv[1])`, `.shots/psy-${which}.png`, ...files]);
console.log('console:', JSON.stringify(logs));
if (logs.length) process.exitCode = 1;
