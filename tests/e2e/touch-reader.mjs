// Автотест: на iPad/iPhone (WebKit, сенсор) записку можна закрити дотиком по «Закрыть», а кнопки гри під час читання сховані.
// node tests/e2e/touch-reader.mjs  (код 1 при збої)
import { webkit, devices } from 'playwright';
import { createServer } from 'vite';
const srv = await createServer({ root: process.cwd(), server: { port: 5191, strictPort: true }, logLevel: 'error' });
await srv.listen();
const out = [];
for (const name of ['iPad Pro 11 landscape', 'iPhone 15 Pro landscape']) {
  const b = await webkit.launch();
  const ctx = await b.newContext({ ...devices[name] });
  const page = await ctx.newPage();
  const errs = []; page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.text()); });
  await page.goto('http://localhost:5191/?debug', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__zk?.ready, null, { timeout: 120000 });
  await page.evaluate(() => window.__zk.play());
  await page.waitForFunction(() => window.__zk.game.mode === 'play', null, { timeout: 30000 });
  await page.waitForTimeout(500);
  await page.evaluate(() => window.__zk.game.readDoc('note1'));
  await page.waitForSelector('.reader .close');
  const shownWhileReading = await page.evaluate(() => document.querySelector('.touch')?.classList.contains('shown'));
  await page.locator('.reader .close').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `.shots/tap-${name.split(' ')[0]}-reader.png` });
  await page.tap('.reader .close');
  await page.waitForTimeout(400);
  const st = await page.evaluate(() => ({ reader: window.__zk.game.hud.readerOpen, mode: window.__zk.game.mode, touch: document.querySelector('.touch')?.classList.contains('shown') }));
  out.push({ name, shownWhileReading, ...st, errs });
  await b.close();
}
console.log(JSON.stringify(out, null, 1));
const bad = out.filter((r) => r.reader || r.mode !== "play" || r.shownWhileReading || !r.touch || r.errs.length);
if (bad.length) process.exitCode = 1;
await srv.close();
