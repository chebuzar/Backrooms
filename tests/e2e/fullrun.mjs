// Повне проходження гри ботом-гравцем з відеозаписом: «18+» → пролог → рівні 0–4 (усі записи, батарейки, завдання,
// Шов) → фінал (вибір, кінцівка, титри) → меню. Лише клавіші й «миша»; тактики проти мисливців — у bot.mjs.
//   node tests/e2e/fullrun.mjs [webkit|chromium] [--from 3] [--ending stay] [--no-video] [--prod]
// Результат: .shots/fullrun/<браузер>/{run.webm, *.png, report.json}; код 1 — якщо крок не вдався.
import { mkdirSync, renameSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { startServer, gotoGame, wait, CHROMIUM_ARGS } from './lib.mjs';
import { makeBot } from './bot.mjs';

const pw = createRequire(import.meta.url)('playwright');
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d; };
const which = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'webkit';
const from = Number(arg('from', 0)), ending = arg('ending', 'leave');
const OUT = `.shots/fullrun/${which}`;
mkdirSync(OUT, { recursive: true });
const srv = await startServer(process.argv.includes('--prod'));
const browser = await pw[which].launch(which === 'chromium' ? { args: CHROMIUM_ARGS } : {});
const video = !process.argv.includes('--no-video');
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, ...(video ? { recordVideo: { dir: OUT, size: { width: 960, height: 540 } } } : {}) });
const page = await ctx.newPage();
const logs = [];
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(`${m.type()}: ${m.text()}`); });
page.on('pageerror', (e) => logs.push('pageerror: ' + e.message));

const steps = [], levels = {};
let failed = null;
const t0 = Date.now();
const log = (name, ok, extra = {}) => {
  steps.push({ name, ok, s: Math.round((Date.now() - t0) / 1000), ...extra });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`, Object.keys(extra).length ? JSON.stringify(extra) : '');
  if (!ok && !failed) failed = name;
  return ok;
};
const shot = (n) => page.screenshot({ path: `${OUT}/${n}.png` }).catch(() => {});
const bot = makeBot(page, { log, shot });
const game = (fn, a) => page.evaluate(fn, a);

/** Один рівень: записи → завдання → Шов; схопили — знову (до 4 спроб). */
async function playLevel(id) {
  const lt = Date.now(), d0 = (await bot.state()).deaths, bat = [];
  const fps = await game(() => { const g = window.__zk.game; return g.fps ?? null; });
  let r = 'caught';
  for (let a = 0; a < 4 && r === 'caught'; a++) {
    if (a) await page.waitForFunction(() => window.__zk.game.input.enabled && window.__zk.game.mode === 'play', null, { timeout: 60000 }).catch(() => {});
    // ліхтарик увімкнений (на рівні 3 це головний захист)
    if (!(await game(() => window.__zk.game.flashlightOn))) await page.keyboard.press('KeyF');
    r = await bot.collect(`l${id}`);
    if (r === 'caught') continue;
    bat.push(await game(() => window.__zk.game.battery));
    r = await bot.doTasks(`l${id}`);
    if (r === 'caught') continue;
    if (r !== 'ok') break;
    r = await bot.seam(id + 1, `шов-${id}`);
  }
  const s = await bot.state();
  levels[id] = { seconds: Math.round((Date.now() - lt) / 1000), deaths: s.deaths - d0, result: r, battery: bat.map((b) => +b.toFixed(2)), fps };
  log(`уровень ${id} пройден`, r === 'ok', levels[id]);
  return r === 'ok';
}

try {
  await gotoGame(page);
  if (from > 0) {
    // почати з рівня N: збереження з контрольною точкою, далі «Продолжить» (як після перезапуску)
    await game((n) => { const g = window.__zk.game; g.store.progress.checkpoint = { level: n, spawn: 'start' }; g.store.save(); }, from);
    await page.click('.age [data-go]');
    await page.waitForSelector('.menu [data-c]', { timeout: 30000 });
    await page.click('.menu [data-c]');
    await page.waitForFunction((n) => window.__zk.game.level?.id === n && window.__zk.game.input.enabled, from, { timeout: 300000 });
  } else {
    await page.click('.age [data-go]');
    await page.waitForSelector('.menu [data-s]', { timeout: 30000 });
    await page.click('.menu [data-s]');
    await wait(400);
    if (await page.$('[data-confirm-yes]')) await page.click('[data-confirm-yes]');
    await page.waitForSelector('.prologue', { timeout: 10000 });
    await wait(4000); await shot('prologue');
    await page.keyboard.press('Space'); await wait(200); await page.keyboard.press('Space');
    await page.waitForFunction(() => window.__zk.game.input.enabled && window.__zk.game.mode === 'play', null, { timeout: 60000 });
  }
  log('управление включено', true);
  let lv = from, ok = true;
  while (ok && lv <= 4) {
    await shot(`level${lv}-start`);
    ok = await playLevel(lv);
    lv++;
  }
  if (ok) {
    // фінал: епілог (пропустити), вибір, кінцівка, титри
    const intro = await page.waitForSelector('.prologue', { timeout: 30000 }).then(() => true, () => false);
    log('финал: эпилог', intro);
    await wait(5000); await shot('finale-intro');
    await page.keyboard.press('Space'); await wait(300); await page.keyboard.press('Space');
    const choice = await page.waitForSelector('.finale-choice.shown', { timeout: 30000 }).then(() => true, () => false);
    await wait(1800); await shot('finale-choice');
    log('финал: выбор', choice);
    await page.keyboard.press(ending === 'stay' ? 'Digit2' : 'Digit1');
    await page.waitForSelector('.prologue:not(.finale-choice)', { timeout: 30000 }).catch(() => {});
    await wait(5000); await shot(`finale-${ending}`);
    await page.keyboard.press('Space'); await wait(300); await page.keyboard.press('Space');
    const cr = await page.waitForSelector('.finale-credits.shown', { timeout: 30000 }).then(() => true, () => false);
    await wait(9000); await shot('finale-credits');
    const name = await page.$eval('.cr-name', (e) => e.textContent).catch(() => null);
    log('финал: титры', cr, { name });
    await page.waitForFunction(() => document.activeElement?.classList.contains('cr-close'), null, { timeout: 60000 }).catch(() => {});
    await page.click('.cr-close');
    const menu = await page.waitForSelector('.menu [data-s]', { timeout: 30000 }).then(() => true, () => false);
    log('после титров — меню', menu, { endings: await game(() => window.__zk.game.store.progress.endings) });
  }
} catch (e) {
  log('исключение', false, { error: String(e).split('\n')[0] });
  await shot('exception');
}
log('консоль без ошибок и предупреждений', logs.length === 0, { logs: logs.slice(0, 8) });
const med = (a) => { const q = [...a].sort((x, y) => x - y); return q[Math.floor((q.length - 1) / 2)]; };
const found = await game(() => { const P = window.__zk.game.store.progress; return { docs: P.docs.length, notes: P.notes.length, tapes: P.tapes.length, deaths: P.deaths, minutes: Math.round(P.playSeconds / 60) }; }).catch(() => null);
const report = {
  browser: which, wallSeconds: Math.round((Date.now() - t0) / 1000), failed, levels, found,
  bot: { nudges: bot.m.nudges, chaseSeconds: Math.round(bot.m.chaseS), minMonsterDist: +bot.m.minDist.toFixed(2), facedMonster: bot.m.faced },
  draws: Object.fromEntries(Object.entries(bot.m.draws).map(([k, a]) => [k, { median: med(a), max: Math.max(...a) }])), steps
};
writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 1));
console.log(JSON.stringify({ ...report, steps: undefined }));
await page.close();
await ctx.close();
if (video) {
  const v = readdirSync(OUT).filter((f) => f.endsWith('.webm') && f !== 'run.webm').map((f) => `${OUT}/${f}`);
  if (v[0]) renameSync(v[0], `${OUT}/run.webm`);
}
await browser.close();
await srv.close();
process.exitCode = failed ? 1 : 0;
