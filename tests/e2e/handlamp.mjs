// Ліхтар у руці: модель видно (праворуч унизу), скло світиться, коли ввімкнено, промінь не крізь стіни;
// біля стіни рука підтягує ліхтар до себе.  node tests/e2e/handlamp.mjs [webkit|chromium] → .shots/handlamp-*.png
import { startServer, openPage, gotoGame } from './lib.mjs';

const which = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'webkit';
const srv = await startServer(process.argv.includes('--prod'));
const { page, logs, close } = await openPage(which);
let bad = false;
const check = (name, ok, extra) => { if (!ok) bad = true; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`, extra === undefined ? '' : JSON.stringify(extra)); };
const waitGame = async (s) => { const t = await page.evaluate(() => window.__zk.game.time); await page.waitForFunction((t) => window.__zk.game.time > t, t + s, { timeout: 180000 }); };
await gotoGame(page);
await page.click('.age [data-go]');
await page.waitForSelector('.menu', { timeout: 90000 });
await page.waitForFunction(() => window.__zk.game.dressed?.length > 0, null, { timeout: 180000 });
await page.evaluate(() => window.__zk.play());
await page.waitForFunction(() => window.__zk.game.mode === 'play' && window.__zk.game.input.enabled, null, { timeout: 120000 });
await page.waitForFunction(() => window.__zk.game.time > 1.5, null, { timeout: 180000 });
// довгий вільний коридор: дивимось уздовж нього
const open = await page.evaluate(() => {
  const g = window.__zk.game, p = g.player.pos;
  let best = 0, yaw = 0;
  for (let a = 0; a < 16; a++) {
    const y = a * Math.PI / 8, d = g.physics.raycast(p.x, 1.5, p.z, -Math.sin(y), 0, -Math.cos(y), 12) ?? 12;
    if (d > best) { best = d; yaw = y; }
  }
  g.player.yaw = yaw; g.player.pitch = -0.08; g.flashlightOn = true;
  return best;
});
await waitGame(1.0);
const on = await page.evaluate(() => {
  const g = window.__zk.game, h = g.handLamp;
  return { visible: h.root.visible, ready: h.ready, glow: h.glass?.emissiveIntensity ?? -1, beam: h.beam.visible, len: h.beam.scale.z, hit: g.flashHit };
});
await page.screenshot({ path: '.shots/handlamp-on.png' });
check('фонарь в руке виден и светится', on.visible && on.ready && on.glow > 1.5 && on.beam, { ...on, open });
await page.evaluate(() => { window.__zk.game.flashlightOn = false; });
await waitGame(0.6);
const off = await page.evaluate(() => { const h = window.__zk.game.handLamp; return { visible: h.root.visible, glow: h.glass?.emissiveIntensity ?? -1, beam: h.beam.visible }; });
await page.screenshot({ path: '.shots/handlamp-off.png' });
check('выключен: стекло тёмное, луча нет, сам фонарь в руке', off.visible && off.glow < 0.1 && !off.beam, off);
// упираемся в стену: рука подтягивает фонарь
await page.evaluate(() => {
  const g = window.__zk.game, p = g.player.pos;
  g.flashlightOn = true;
  let best = 99, yaw = 0;
  for (let a = 0; a < 16; a++) {
    const y = a * Math.PI / 8, d = g.physics.raycast(p.x, 1.5, p.z, -Math.sin(y), 0, -Math.cos(y), 12) ?? 12;
    if (d < best) { best = d; yaw = y; }
  }
  // шаг к стене на 0.45 м от неё
  const k = Math.max(0, best - 0.62);
  g.player.teleport(p.x - Math.sin(yaw) * k, 0, p.z - Math.cos(yaw) * k, yaw); g.player.pitch = 0;
});
await waitGame(1.0);
const wall = await page.evaluate(() => {
  const g = window.__zk.game, c = g.camera.position, h = g.hand.pos;
  return { hit: g.flashHit, ahead: Math.hypot(h.x - c.x, h.z - c.z), len: g.handLamp.beam.scale.z };
});
await page.screenshot({ path: '.shots/handlamp-wall.png' });
check('у стены фонарь ближе к телу, луч короткий', wall.ahead < 0.42 && wall.len < 0.8, wall);
check('консоль без ошибок', logs.length === 0, logs.slice(0, 5));
await close(); await srv.close();
process.exitCode = bad ? 1 : 0;
