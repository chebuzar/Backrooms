// Особливі кімнати рівня 0 (Д7): вежа стільців до стелі, телефон дзвонить → «Снять трубку» → голос у субтитрах,
// кімната з почерком гравця → «Рассмотреть». node tests/e2e/special.mjs [webkit|chromium] → .shots/special-*.png
import { startServer, openPage, gotoGame, wait } from './lib.mjs';
const which = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'webkit';
const srv = await startServer();
const { page, logs, close } = await openPage(which);
let bad = false;
const check = (name, ok, extra) => { if (!ok) bad = true; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`, extra === undefined ? '' : JSON.stringify(extra)); };
await gotoGame(page);
await page.click('.age [data-go]');
await page.waitForSelector('.menu', { timeout: 90000 });
await page.evaluate(() => { const g = window.__zk.game; g.enterLevelStart(); g.play(); });
await wait(1500);
const sp = await page.evaluate(() => window.__zk.game.specials.map((s) => ({ id: s.id, x: s.x, y: s.y, z: s.z, yaw: s.yaw })));
check('три особые комнаты', ['chairs', 'phone', 'writing'].every((id) => sp.some((s) => s.id === id)), sp.map((s) => s.id));
const view = async (s, r, pitch) => page.evaluate(([s, r, pitch]) => {
  const g = window.__zk.game, L = g.level.layout, ph = g.physics;
  const free = (x, z) => !L.walls.some((w) => Math.abs(x - w.x) < w.w / 2 + 0.4 && Math.abs(z - w.z) < w.d / 2 + 0.4);
  for (const rr of [r, r * 0.8, r * 1.3, r * 0.6]) for (let a = 0; a < 6.28; a += 0.25) { const x = s.x + Math.cos(a) * rr, z = s.z + Math.sin(a) * rr; if (free(x, z) && ph.lineOfSight(x, 1.6, z, s.x, s.y, s.z)) { window.__zk.tp(x, z, Math.atan2(-(s.x - x), -(s.z - z)), pitch ?? Math.atan2(s.y - 1.66, rr)); return true; } }
  return false;
}, [s, r, pitch]);
const chairs = sp.find((s) => s.id === 'chairs');
await view(chairs, 3.2, 0.25); await wait(2500);
await page.screenshot({ path: '.shots/special-chairs.png' });
const phone = sp.find((s) => s.id === 'phone');
await view(phone, 1.2); await wait(2000);
const ringing = await page.evaluate(() => !!window.__zk.game.phoneVoice);
await page.screenshot({ path: '.shots/special-phone.png' });
const pPrompt = await page.evaluate(() => document.querySelector('.hud .prompt.on')?.textContent ?? null);
await page.keyboard.press('KeyE');
await wait(3800);
const call = await page.evaluate(() => ({ ringing: !!window.__zk.game.phoneVoice, sub: document.querySelector('.hud .subs.on')?.textContent ?? null }));
check('телефон звонит → «Снять трубку» → голос в субтитрах, звонок стих', ringing && /трубку/.test(pPrompt ?? '') && !call.ringing && /Голос|треск/.test(call.sub ?? ''), { ringing, pPrompt, ...call });
const wr = sp.find((s) => s.id === 'writing');
await page.evaluate((w) => { const x = w.x + Math.sin(w.yaw) * 1.9, z = w.z + Math.cos(w.yaw) * 1.9; window.__zk.tp(x, z, w.yaw, -0.1); }, wr); await wait(2500);
await page.screenshot({ path: '.shots/special-writing.png' });
const wPrompt = await page.evaluate(() => document.querySelector('.hud .prompt.on')?.textContent ?? null);
await page.keyboard.press('KeyE');
await wait(600);
const wsub = await page.evaluate(() => document.querySelector('.hud .subs.on')?.textContent ?? null);
check('почерк на стенах → «Рассмотреть» → «Это мой почерк»', /Рассмотреть/.test(wPrompt ?? '') && /мой почерк/.test(wsub ?? ''), { wPrompt, wsub });
check('консоль без ошибок', logs.length === 0, logs.slice(0, 5));
await close(); await srv.close();
process.exitCode = bad ? 1 : 0;
