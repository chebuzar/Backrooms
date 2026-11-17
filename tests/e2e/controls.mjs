// Керування, яке раніше нічого не робило: V / кнопка 📹 — зум камери 2× з написом «ZOOM 2×»; Tab / J — журнал документів.
// Плюс навчання на старті (підказки клавіш) і розділ «Управление» в паузі.
//   node tests/e2e/controls.mjs [webkit|chromium] [--device "iPad Pro 11 landscape"]
import { startServer, openPage, gotoGame, wait } from './lib.mjs';

const which = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'webkit';
const di = process.argv.indexOf('--device'), device = di > 0 ? process.argv[di + 1] : null;
const srv = await startServer(process.argv.includes('--prod'));
const { page, logs, close } = await openPage(which, { device });
let bad = false;
const check = (name, ok, extra) => { if (!ok) bad = true; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`, extra === undefined ? '' : JSON.stringify(extra)); };
const tag = device ? '-' + device.replace(/\s+/g, '_') : '';
await gotoGame(page);
await page.click('.age [data-go]');
await page.waitForSelector('.menu [data-s]', { timeout: 60000 });
await page.click('.menu [data-s]');
await page.waitForSelector('.prologue', { timeout: 10000 });
await wait(800);
if (device) { await page.tap('.prologue'); await wait(200); await page.tap('.prologue'); } else { await page.keyboard.press('Space'); await wait(200); await page.keyboard.press('Space'); }
await page.waitForFunction(() => window.__zk.game.input.enabled && window.__zk.game.mode === 'play', null, { timeout: 40000 });
await wait(1500);
// навчання: перша підказка з'являється сама
const tip = await page.waitForSelector('.tutorial.on', { timeout: 8000 }).then((e) => e.textContent(), () => null);
await page.screenshot({ path: `.shots/controls-tutorial-${which}${tag}.png` });
check('на старте — подсказка управления', !!tip && /фонарик|Фонарик/.test(tip), { tip });

if (!device) {
  const fov0 = await page.evaluate(() => window.__zk.game.camera.fov);
  await page.keyboard.press('KeyV');
  await wait(900);
  const z = await page.evaluate(() => ({ fov: window.__zk.game.camera.fov, label: document.querySelector('.hud .zoom')?.textContent ?? null, shown: !!document.querySelector('.hud .zoom.on') }));
  await page.screenshot({ path: `.shots/controls-zoom-${which}.png` });
  const want = (2 * Math.atan(Math.tan((fov0 * Math.PI) / 360) / 2) * 180) / Math.PI;
  check('V — зум 2× и надпись «ZOOM 2×»', Math.abs(z.fov - want) < 1 && z.shown && /ZOOM 2×/.test(z.label ?? ''), { fov0, fov: z.fov, want: +want.toFixed(1), label: z.label });
  await page.keyboard.press('KeyV');
  await wait(900);
  const back = await page.evaluate(() => ({ fov: window.__zk.game.camera.fov, shown: !!document.querySelector('.hud .zoom.on') }));
  check('V ещё раз — обратно', Math.abs(back.fov - fov0) < 0.5 && !back.shown, back);

  for (const key of ['Tab', 'KeyJ']) {
    await page.keyboard.press(key);
    const opened = await page.waitForSelector('.journal-screen', { timeout: 3000 }).then(() => true, () => false);
    if (key === 'Tab') { await wait(1000); await page.screenshot({ path: `.shots/controls-journal-${which}.png` }); }
    check(`${key} — журнал документов`, opened);
    await page.keyboard.press('Escape');
    const closed = await page.waitForFunction(() => !document.querySelector('.journal-screen') && window.__zk.game.mode === 'play', null, { timeout: 3000 }).then(() => true, () => false);
    check(`Esc — закрыть журнал (${key})`, closed);
  }
  // ДП-5: R — шкала й тріск; біля Шва — тиша
  await page.keyboard.press('KeyR');
  await wait(1500);
  const far = await page.evaluate(() => ({ on: !!document.querySelector('.hud .dosi.on'), rate: window.__zk.game.dosi.rate }));
  await page.screenshot({ path: `.shots/controls-dosimeter-${which}.png` });
  await page.evaluate(() => { const g = window.__zk.game, s = g.level.seam.group; window.__zk.tp(s.position.x + Math.sin(s.rotation.y) * 1.5, s.position.z + Math.cos(s.rotation.y) * 1.5, s.rotation.y, 0); });
  await wait(1500);
  const near = await page.evaluate(() => window.__zk.game.dosi.rate);
  check('R — дозиметр: трещит вдали, у Шва молчит', far.on && far.rate > 3 && near === 0, { far, near });
  await page.keyboard.press('KeyR');
  // пауза → «Управление»
  await page.keyboard.press('Escape');
  await page.waitForSelector('.screen.pause [data-ctl]', { timeout: 3000 }).catch(() => {});
  const hasCtl = !!(await page.$('.screen.pause [data-ctl]'));
  if (hasCtl) { await page.click('.screen.pause [data-ctl]'); await wait(1200); await page.screenshot({ path: `.shots/controls-pause-${which}.png` }); }
  const ctlText = hasCtl ? await page.evaluate(() => document.querySelector('.controls-screen')?.textContent ?? '') : '';
  check('в паузе — раздел «Управление» со всеми клавишами', hasCtl && ['Фонарик', 'Бег', 'Присесть', 'Действие', 'Журнал', 'Камера'].every((w) => ctlText.includes(w)));
} else {
  // iPad/iPhone: кнопка 📹 — зум
  const fov0 = await page.evaluate(() => window.__zk.game.camera.fov);
  await page.tap('.tb-cam');
  await wait(900);
  const z = await page.evaluate(() => ({ fov: window.__zk.game.camera.fov, shown: !!document.querySelector('.hud .zoom.on') }));
  await page.screenshot({ path: `.shots/controls-zoom-${which}${tag}.png` });
  check('кнопка 📹 — зум 2×', z.fov < fov0 * 0.6 && z.shown, { fov0, fov: z.fov });
}
check('консоль без ошибок', logs.length === 0, logs.slice(0, 5));
await close(); await srv.close();
process.exitCode = bad ? 1 : 0;
