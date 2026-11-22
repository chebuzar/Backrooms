// Автотест автовибору графіки: тест швидкодії на справжній сцені проходить на WebGPU (Chromium) і WebGL 2 (WebKit),
// результат кешується (другий запуск без тесту), консоль чиста, «Авто» в налаштуваннях показує вибране тестом.
//   node tests/e2e/autotune.mjs [chromium|webkit] [--prod]
import { startServer, openPage, gotoGame, BASE } from './lib.mjs';

const which = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'webkit';
const srv = await startServer(process.argv.includes('--prod'));
const { page, logs, close } = await openPage(which);
const info = [];
page.on('console', (m) => { if (m.text().startsWith('[autotune]')) info.push(m.text()); });
let ok = true;
const check = (name, cond, extra = '') => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}`, extra); ok &&= !!cond; };
const calib = () => page.waitForFunction(() => window.__zk?.game?.calib, null, { timeout: 300000 }).then(() => page.evaluate(() => {
  const g = window.__zk.game; return { calib: g.calib, profile: g.profile.name, auto: g.autoPreset(), backend: g.gfx.backend };
}));
try {
  // 1) переміряти з межею «Ультра» (у контейнері рендер програмний — інакше тест пропускається й одразу «Низкое»)
  const t0 = Date.now();
  await gotoGame(page, 'retune=ultra');
  const a = await calib();
  check('тест пройшов', a.calib && Object.keys(a.calib.ms).length >= 1, JSON.stringify({ backend: a.backend, preset: a.calib?.preset, ms: a.calib?.ms }));
  check('виміри — числа > 0', Object.values(a.calib.ms).every((v) => typeof v === 'number' && v > 0));
  check('гра в пресеті, який вибрав тест', a.profile === a.calib.preset && a.auto === a.calib.preset, `${a.profile}`);
  check('повідомлення [autotune] у консолі', info.length === 1, info[0] ?? '');
  console.log('   час до результату', Math.round((Date.now() - t0) / 1000), 'с');
  // 2) повторний запуск — з кешу, без нового тесту
  info.length = 0;
  await page.goto(`${BASE}?debug&nodbg`, { waitUntil: 'commit' });
  await page.waitForFunction(() => window.__zk?.ready, null, { timeout: 240000 });
  const b = await calib();
  check('другий запуск бере кеш', info.length === 0 && b.calib.at === a.calib.at, JSON.stringify(b.calib?.ms));
  // 3) налаштування: рядок «Авто выбирает: …»
  await page.click('.age [data-go]');
  await page.waitForSelector('.menu [data-o]', { timeout: 60000 }).catch(() => {});
  const names = { low: 'Низкое', medium: 'Среднее', high: 'Высокое', ultra: 'Ультра' };
  await page.click('.menu [data-o]');
  await page.waitForSelector('.dossier.wide', { timeout: 10000 });
  await page.waitForTimeout(400);
  const opened = true;
  const text = await page.evaluate(() => document.querySelector('.dossier.wide')?.textContent ?? '');
  check('в налаштуваннях видно вибір тесту', opened && text.includes(`«Авто» выбирает: ${names[b.auto]}`), text.match(/Устройство[^.]*\.[^.]*\./)?.[0] ?? '');
} catch (e) {
  check('исключение', false, String(e).split('\n')[0]);
}
check('консоль без ошибок и предупреждений', logs.length === 0, JSON.stringify(logs.slice(0, 4)));
await close(); await srv.close();
process.exitCode = ok ? 0 : 1;
