// Задачі рівнів: допуск із трьома печатками й вахта (0), запобіжники й щит (1), ключ і генератор (2).
// Підходить до кожної речі, «використовує» її, перевіряє, що Шов відкрився; знімки речей.
// node tests/e2e/tasks.mjs [webkit|chromium]  →  .shots/tasks-<браузер>.png
import { startServer, openPage, gotoGame, wait } from './lib.mjs';
import { execFileSync } from 'node:child_process';

const which = process.argv[2] ?? 'webkit';
const srv = await startServer();
const { page, logs, close } = await openPage(which, {});
const files = [];
let fail = '';
try {
  await gotoGame(page);
  for (let k = 0; k < 6; k++) {
    await page.evaluate(() => window.__zk.play());
    await wait(1500);
    if (await page.evaluate(() => window.__zk.game.mode === 'play')) break;
  }
  await page.evaluate(() => { document.querySelector('.touch')?.classList.remove('shown'); });
  for (const lvlId of [0, 1, 2]) {
    if (lvlId > 0) {
      await page.evaluate(async (id) => { const g = window.__zk.game; await g.loadLevel(id); g.enterLevelStart(false); g.play(); }, lvlId);
      await wait(3000);
    }
    const items = await page.evaluate(() => window.__zk.game.tasks.placed.map((p) => ({ id: p.def.id, x: p.x, y: p.y, z: p.z, yaw: p.yaw })));
    const before = await page.evaluate(() => window.__zk.game.tasks.gateOpen);
    for (const [k, it] of items.entries()) {
      await page.evaluate((it) => {
        const g = window.__zk.game, ia = g.interact.items.find((x) => x.id === `task-${it.id}`);
        window.__zk.tp(it.x + Math.sin(it.yaw) * 1.3, it.z + Math.cos(it.yaw) * 1.3, it.yaw, -0.45);
        ia?.use();
      }, it);
      await wait(2600);
      if (k === 0) { const f = `.shots/task-${which}-${lvlId}-item.png`; await page.screenshot({ path: f }); files.push(f); }
    }
    const gate = await page.evaluate(() => { const g = window.__zk.game.tasks.gate; return { x: g.x, z: g.z, yaw: g.yaw }; });
    await page.evaluate((gt) => window.__zk.tp(gt.x + Math.sin(gt.yaw) * 1.8, gt.z + Math.cos(gt.yaw) * 1.8, gt.yaw, -0.2), gate);
    await wait(1500);
    await page.evaluate(() => { const g = window.__zk.game; g.interact.items.find((x) => x.id === "task-gate")?.use(); });
    await wait(2500);
    const f = `.shots/task-${which}-${lvlId}-gate.png`; await page.screenshot({ path: f }); files.push(f);
    const after = await page.evaluate(() => ({ open: window.__zk.game.tasks.gateOpen, obj: window.__zk.game.objective, items: window.__zk.game.taskItems() }));
    console.log(`level ${lvlId}: items ${items.length}, gate before ${before}, after ${after.open}; objective «${after.obj}»`, JSON.stringify(after.items.map((i) => i.done)));
    if (before || !after.open) fail += ` level${lvlId}`;
  }
} finally {
  await close(); await srv.close();
}
execFileSync('python3', ['-c', `
import sys
from PIL import Image
fs=sys.argv[2:]; W=Image.new('RGB',(3*640,2*360))
for i,f in enumerate(fs): W.paste(Image.open(f).resize((640,360)),((i//2)*640,(i%2)*360))
W.save(sys.argv[1])`, `.shots/tasks-${which}.png`, ...files]);
console.log('console:', JSON.stringify(logs), fail ? 'FAIL' + fail : 'OK');
if (logs.length || fail) process.exitCode = 1;
