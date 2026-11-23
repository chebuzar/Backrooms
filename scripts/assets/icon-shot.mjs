// Кадр для іконки веб-додатка: справжній рендер гри (обличчя «Наблюдателя» впритул, підсвічене ліхтариком знизу).
//   node scripts/assets/icon-shot.mjs → .assets-src/icon/face.png (далі python3 -I scripts/assets/make-icons.py)
import { mkdirSync } from 'node:fs';
import { startServer, openPage, gotoGame, wait } from '../../tests/e2e/lib.mjs';

mkdirSync('.assets-src/icon', { recursive: true });
const srv = await startServer(false);
const { page, close } = await openPage('webkit', { viewport: { width: 1280, height: 720 }, dpr: 2 });
await gotoGame(page);
await page.click('.age [data-go]');
await page.waitForSelector('.menu', { timeout: 90000 });
await page.evaluate(async () => { const g = window.__zk.game; await g.loadLevel(1); g.enterLevelStart(); g.play(); });
await wait(1500);
await page.evaluate(() => {
  const g = window.__zk.game, s = g.hunt.stalker, p = g.player;
  Object.assign(s.pos, { x: p.pos.x + Math.sin(p.yaw) * 0.7, z: p.pos.z + Math.cos(p.yaw) * 0.7 });
  s.sub = 0; s.brain.state = 'chase'; s.brain.noticed = true; s.brain.mem.last = { x: p.pos.x, y: 0, z: p.pos.z }; s.brain.mem.age = 0;
});
await page.waitForFunction(() => !!window.__zk.game.death && window.__zk.game.death.t > 0.3, null, { timeout: 60000 });
// зупинити сцену на цьому кадрі (без тремтіння) і дати TRAA зібрати чистий кадр
const box = await page.evaluate(() => {
  const g = window.__zk.game, d = g.death, c = g.camera;
  const upd = d.update.bind(d);
  d.update = () => { d.t = 0.3; return false; };
  void upd;
  let head = null;
  g.hunt.stalker.root.traverse((o) => { if (o.isBone && o.name === 'head') head = o; });
  const hp = head.getWorldPosition(c.position.clone()).project(c);
  return { x: (hp.x + 1) / 2, y: (1 - hp.y) / 2 };
});
await wait(2500);
await page.screenshot({ path: '.assets-src/icon/face.png' });
console.log(JSON.stringify(box));
await close(); await srv.close();
