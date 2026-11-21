// Деталі стін НИИ зблизька: стенди, стінгазета, Доска почёта, графік, транспарант, рупор.
// node tests/e2e/details.mjs [webkit|chromium]  →  .shots/details-<браузер>.png (сітка)
import { startServer, openPage, gotoGame, wait } from './lib.mjs';
import { execFileSync } from 'node:child_process';

const which = process.argv[2] ?? 'webkit';
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
  await page.evaluate(() => { document.querySelector('.touch')?.classList.remove('shown'); });
  const boards = await page.evaluate(() => window.__zk.game.level.boards ?? []);
  const seen = new Set(), pick = [];
  for (const b of boards) if (!seen.has(b.id)) { seen.add(b.id); pick.push(b); }
  const sp = await page.evaluate(() => window.__zk.game.level.speakers ?? []);
  if (sp[0]) pick.push({ id: 'speaker', ...sp[0], yaw: 0, sp: true });
  console.log('boards', boards.length, 'kinds', [...seen].join(','), 'speakers', sp.length);
  await wait(4000);
  for (const b of pick.slice(0, 8)) {
    await page.evaluate((b) => {
      const d = b.id === 'slava' ? 3.2 : b.id === 'graf' ? 0.9 : 1.7;
      if (b.sp) window.__zk.tp(b.x + 1.8, b.z + 1.2, Math.atan2(1.8, 1.2), 0.35);
      else window.__zk.tp(b.x + Math.sin(b.yaw) * d, b.z + Math.cos(b.yaw) * d, b.yaw, b.id === 'slava' ? 0.25 : -0.05);
    }, b);
    await wait(2600);
    console.log(b.id, b.x.toFixed(2), b.z.toFixed(2), b.yaw.toFixed(2), await page.evaluate(() => { const c = window.__zk.game.camera.position; return c.x.toFixed(2) + ',' + c.z.toFixed(2); }));
    const f = `.shots/detail-${which}-${b.id}.png`;
    await page.screenshot({ path: f });
    files.push(f);
  }
} finally {
  await close(); await srv.close();
}
execFileSync('python3', ['-c', `
import sys
from PIL import Image
fs=sys.argv[2:]; W=Image.new('RGB',(4*640,2*360))
for i,f in enumerate(fs): W.paste(Image.open(f).resize((640,360)),((i%4)*640,(i//4)*360))
W.save(sys.argv[1])`, `.shots/details-${which}.png`, ...files]);
console.log('console:', JSON.stringify(logs));
if (logs.length) process.exitCode = 1;
