// Плейтест плавності: бот грає кожен рівень ~N секунд (ходить, збирає записи, вмикає камеру й ліхтарик),
// гра рахує кадри й ривки (__zk.perf): скільки довгих кадрів, наскільки довгі й чому (нові шейдери, буфери, текстури).
//   npm run build && node tests/e2e/stutter.mjs [webkit|chromium] [--prod] [--levels 0,1,2,3,4] [--seconds 45]
// Результат: .shots/stutter-<браузер>.json; код 1 — якщо консоль із помилками або ривки від компіляції шейдерів.
import { writeFileSync, mkdirSync } from 'node:fs';
import { startServer, openPage, gotoGame, wait } from './lib.mjs';
import { makeBot } from './bot.mjs';

const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d; };
const which = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'webkit';
const levels = arg('levels', '0,1,2,3,4').split(',').map(Number);
const seconds = Number(arg('seconds', 45));
mkdirSync('.shots', { recursive: true });
const srv = await startServer(process.argv.includes('--prod'));
const { page, logs, close } = await openPage(which);
const out = { browser: which, levels: {} };
const log = (name, ok, extra = {}) => console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`, Object.keys(extra).length ? JSON.stringify(extra) : '');
try {
  for (const id of levels) {
    await gotoGame(page, process.env.ZK_QUERY ?? '');
    const pre = await page.evaluate(() => window.__zk.perf());
    await page.evaluate((n) => { const g = window.__zk.game; g.store.progress.checkpoint = { level: n, spawn: 'start' }; g.store.save(); }, id);
    await page.click('.age [data-go]');
    await page.waitForSelector('.menu [data-c]', { timeout: 60000 });
    await page.click('.menu [data-c]');
    await page.waitForFunction((n) => window.__zk.game.level?.id === n && window.__zk.game.input.enabled && window.__zk.game.mode === 'play', id, { timeout: 300000 });
    await wait(1500);
    await page.evaluate(() => window.__zk.perf(true));
    const bot = makeBot(page, { log: () => {}, shot: async () => {} });
    if (!(await page.evaluate(() => window.__zk.game.flashlightOn))) await page.keyboard.press('KeyF');
    let stop = false;
    const run = bot.collect(`s${id}`).catch(() => 'stopped');
    // посеред гри — камеру до ока й назад (там свої шари й шейдери)
    const extra = (async () => { await wait(seconds * 400); if (stop) return; await page.keyboard.press('KeyV'); await wait(2500); await page.keyboard.press('KeyV'); })().catch(() => {});
    await Promise.race([run, wait(seconds * 1000)]);
    stop = true;
    await extra;
    const st = await page.evaluate(() => window.__zk.perf());
    out.levels[id] = { quality: await page.evaluate(() => window.__zk.game.profile.name), boot: { frames: pre.frames }, ...st };
    log(`уровень ${id}`, true, { fps: st.fps, p50: st.p50, p95: st.p95, max: st.max, hitches: st.hitches, compile: st.compileHitches });
    for (const h of st.worst.slice(0, 5)) console.log('   ', JSON.stringify(h));
  }
} catch (e) {
  log('исключение', false, { error: String(e).split('\n')[0] });
  out.error = String(e);
}
out.console = logs;
writeFileSync(`.shots/stutter-${which}.json`, JSON.stringify(out, null, 1));
log('консоль без ошибок и предупреждений', logs.length === 0, { logs: logs.slice(0, 6) });
await close(); await srv.close();
const compile = Object.values(out.levels).reduce((a, l) => a + l.compileHitches, 0);
if (logs.length || out.error) process.exitCode = 1;
console.log(`итог: ривків від компіляції шейдерів — ${compile}`);
