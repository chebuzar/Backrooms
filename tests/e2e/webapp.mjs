// Веб-додаток: маніфест, іконки й памятка «играть с экрана „Домой“» — є у вкладці Safari на iPad/iPhone, немає в режимі
// «з головного екрана» (navigator.standalone) і на ПК.
//   node tests/e2e/webapp.mjs  → .shots/webapp-<пристрій>.png; код 1 — якщо ні
import { startServer, openPage, wait, BASE } from './lib.mjs';

const srv = await startServer(process.argv.includes('--prod'));
let bad = false;
const check = (name, ok, extra) => { if (!ok) bad = true; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`, extra === undefined ? '' : JSON.stringify(extra)); };
for (const [tag, device, standalone, want] of [
  ['ipad', 'iPad Pro 11 landscape', false, true], ['iphone', 'iPhone 15 Pro landscape', false, true],
  ['ipad-home', 'iPad Pro 11 landscape', true, false], ['desktop', null, false, false]
]) {
  const { page, logs, close } = await openPage('webkit', device ? { device } : {});
  if (standalone) await page.addInitScript(() => Object.defineProperty(navigator, 'standalone', { get: () => true }));
  await page.goto(`${BASE}?debug&nodbg`, { waitUntil: 'commit', timeout: 120000 });
  await page.waitForSelector('.age [data-go]', { timeout: 120000 });
  await wait(2600); // памятка проявляється після машинопису
  const st = await page.evaluate(() => {
    const m = document.querySelector('.age .memo'), go = document.querySelector('.age [data-go]');
    const r = (e) => e ? e.getBoundingClientRect() : null, vr = { w: innerWidth, h: innerHeight };
    const inView = (b) => !!b && b.top >= 0 && b.bottom <= vr.h + 1 && b.left >= 0 && b.right <= vr.w + 1;
    return { memo: !!m, memoIn: inView(r(m)), goIn: inView(r(go)), text: m?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 120) ?? '' };
  });
  await page.screenshot({ path: `.shots/webapp-${tag}.png` });
  check(`${tag}: памятка ${want ? 'есть' : 'нет'}`, st.memo === want, st);
  if (want) check(`${tag}: памятка и кнопка помещаются на экране`, st.memoIn && st.goIn, st);
  if (tag === 'desktop') {
    const man = await page.evaluate(async () => {
      const l = document.querySelector('link[rel=manifest]'), j = await (await fetch(l.href)).json();
      const icons = await Promise.all(j.icons.map(async (i) => (await fetch(new URL(i.src, l.href))).ok));
      const touch = await fetch(document.querySelector('link[rel=apple-touch-icon]').href);
      return { name: j.name, display: j.display, icons, touch: touch.ok };
    });
    check('манифест и иконки загружаются', man.name === 'Закулисье' && man.icons.every(Boolean) && man.touch, man);
  }
  check(`${tag}: консоль без ошибок`, logs.length === 0, logs.slice(0, 3));
  await close();
}
await srv.close();
process.exitCode = bad ? 1 : 0;
