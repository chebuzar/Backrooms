// Кадри в центрі кожного типу кімнати рівня (ліхтарик вимкнено): node tests/e2e/rooms.mjs <рівень> → .shots/lit-*.png
import { startServer, openPage, gotoGame, wait } from './lib.mjs';
const id = Number(process.argv[2] ?? 3);
const srv = await startServer();
const { page, logs, close } = await openPage('webkit', {});
try {
  await gotoGame(page);
  for (let k = 0; k < 6; k++) { await page.evaluate(() => window.__zk.play()); await wait(1500); if (await page.evaluate(() => window.__zk.game.mode === 'play')) break; }
  await page.evaluate(async (id) => { const g = window.__zk.game; await g.loadLevel(id); g.enterLevelStart(false); g.play(); }, id);
  await page.evaluate(() => { document.querySelector('.touch')?.classList.remove('shown'); });
  await wait(3000);
  const pts = await page.evaluate(() => {
    const g = window.__zk.game, L = g.level.layout, out = [];
    const free = (x, z) => !L.walls.some((w) => Math.abs(x - w.x) < w.w / 2 + 0.5 && Math.abs(z - w.z) < w.d / 2 + 0.5) && !L.pools.some((q) => Math.abs(x - q.x) < q.w / 2 + 0.5 && Math.abs(z - q.z) < q.d / 2 + 0.5);
    const rooms = L.rooms.length ? L.rooms : [];
    for (const r of rooms.slice(0, 40)) {
      const x = (r.x0 + r.x1) / 2 * L.cell, z = (r.y0 + r.y1) / 2 * L.cell;
      if (free(x, z) && !out.some((o) => o[3] === r.kind)) out.push([x, z, 0.7, r.kind]);
    }
    return out.slice(0, 6);
  });
  for (const [i, [x, z, yaw, k]] of pts.entries()) {
    await page.evaluate(([x, z, yaw]) => { window.__zk.tp(x, z, yaw, -0.08); window.__zk.game.flashlightOn = false; }, [x, z, yaw]);
    await wait(2500);
    await page.screenshot({ path: `.shots/lit-${id}-${i}-${k}.png` });
    console.log(i, k);
  }
} finally { await close(); await srv.close(); }
console.log('console', JSON.stringify(logs));
