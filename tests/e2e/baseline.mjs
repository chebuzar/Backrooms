// Еталон «нічого не погіршити»: 8 фіксованих точок на кожному рівні (0, 1, 2) + цифри — draw calls (медіана/макс),
// трикутники, пам'ять GPU (текстури, геометрія), кількість текстур, вага завантаження.
//   node tests/e2e/baseline.mjs [webkit|chromium] [тека=.shots/baseline] [--device "iPad Pro 11 landscape"] [--query q=high]
// → <тека>/<браузер>/L<рівень>-<n>-<мітка>.png і metrics.json. Порівняння: python3 scripts/qa/compare-shots.py <A> <B>
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { startServer, openPage, gotoGame, INFO_JS, median, wait } from './lib.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const pos = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
const which = pos[0] ?? 'webkit';
const device = opt('device', null);
const query = opt('query', 'q=high');
const outDir = path.join(pos[1] ?? '.shots/baseline', device ? `${which}-${device.replace(/\s+/g, '_')}` : which);
mkdirSync(outDir, { recursive: true });

const srv = await startServer(args.includes('--prod'));
// --viewport 960x540: програмний Chromium (SwiftShader) інакше знімає кадр по кілька хвилин
const vp = opt('viewport', null);
const { page, logs, net, close } = await openPage(which, { device, ...(vp ? { viewport: { width: +vp.split('x')[0], height: +vp.split('x')[1] } } : {}) });
const t0 = Date.now();
await gotoGame(page, query);
const bootBytes = net.bytes;
await page.click('.age [data-go]');
await page.waitForFunction(() => document.querySelector('.menu'), null, { timeout: 90000 });
await page.evaluate(() => window.__zk.game.play());
await page.waitForFunction(() => window.__zk.game.mode === 'play', null, { timeout: 60000 });
// стабільні кадри: монстри й «Фигура» стоять, кнопки дотику сховані
const FREEZE = () => {
  const g = window.__zk.game;
  g.hunt.update = () => {};
  if (g.figure) g.figure.update = () => {};
  document.querySelector('.touch')?.classList.remove('shown');
  document.querySelector('.hud')?.classList.remove('shown');
};
await page.evaluate(FREEZE);

/** 8 точок рівня — з його ж планування (однакові до/після будь-яких змін). */
const VIEWS = () => {
  const g = window.__zk.game, L = g.level, l = L.layout;
  const free = (x, z, r = 0.45) => x > r && z > r && x < l.cols * l.cell - r && z < l.rows * l.cell - r
    && !l.walls.some((w) => Math.abs(x - w.x) < w.w / 2 + r && Math.abs(z - w.z) < w.d / 2 + r);
  const near = (x, z) => { for (let r = 0; r < 6; r += 0.2) for (let a = 0; a < 6.28; a += 0.4) { const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r; if (free(px, pz)) return [px, pz]; } return [x, z]; };
  const yawTo = (fx, fz, tx, tz) => Math.atan2(-(tx - fx), -(tz - fz));
  const out = [];
  const sp = l.spawn;
  out.push({ label: 'start', x: sp.x, z: sp.z, yaw: sp.yaw, pitch: 0, light: 0 });
  // впритул до стіни прибуття з ліхтариком (перевірка «вибілювання»)
  const ar = L.arrival.group, an = ar.rotation.y;
  { const [x, z] = near(ar.position.x + Math.sin(an) * 0.75, ar.position.z + Math.cos(an) * 0.75); out.push({ label: 'wall-flash', x, z, yaw: yawTo(x, z, ar.position.x, ar.position.z), pitch: -0.05, light: 1 }); }
  const doc = Object.values(L.spots).find((s) => s.id !== 'note1') ?? Object.values(L.spots)[0];
  { const [x, z] = near(doc.x + 1.1, doc.z + 0.4); const d = Math.hypot(doc.x - x, doc.z - z); out.push({ label: 'doc', x, z, yaw: yawTo(x, z, doc.x, doc.z), pitch: Math.atan2(doc.y - 1.66, d), light: 0 }); }
  const se = L.seam.group, sn = se.rotation.y;
  { const [x, z] = near(se.position.x + Math.sin(sn) * 2.6, se.position.z + Math.cos(sn) * 2.6); out.push({ label: 'seam', x, z, yaw: yawTo(x, z, se.position.x, se.position.z), pitch: 0, light: 0 }); }
  const dr = L.doors.list[Math.floor(L.doors.list.length / 2)];
  if (dr) {
    // центр прорізу — посередині між точками з обох боків; стати за 2.2 м навпроти
    const [ax, , az] = dr.sides[0], [bx, , bz] = dr.sides[1], cx = (ax + bx) / 2, cz = (az + bz) / 2;
    const nl = Math.hypot(ax - cx, az - cz) || 1;
    const [x, z] = near(cx + ((ax - cx) / nl) * 2.2, cz + ((az - cz) / nl) * 2.2);
    out.push({ label: 'door', x, z, yaw: yawTo(x, z, cx, cz), pitch: -0.03, light: 0 });
  }
  const on = l.lights.filter((p) => p.state === 'on');
  // без дверей (парковка) — ще одна точка з лампою, щоб точок завжди було 8
  const rooms = [[0.25, 0.4, 0], [0.55, 2.1, 0], [0.85, 3.9, 1]];
  if (!dr) rooms.push([0.4, 5.2, 0]);
  rooms.forEach(([f, yaw, light], k) => {
    const p = on[Math.floor(f * on.length)]; const [x, z] = near(p.x + 1, p.z + 1);
    out.push({ label: `room${k + 1}${light ? '-flash' : ''}`, x, z, yaw, pitch: 0, light });
  });
  return out.slice(0, 8);
};

const report = { browser: which, device, query, bootBytes, levels: {} };
// --levels 1,2 — лише ці рівні (швидка перевірка однієї зміни)
const LEVELS = (opt('levels', '0,1,2')).split(',').map(Number);
for (const lv of [0, 1, 2]) {
  if (!LEVELS.includes(lv)) { if (lv < Math.max(...LEVELS)) continue; else break; }
  const before = net.bytes;
  if (lv > 0) {
    await page.evaluate(async (n) => { const g = window.__zk.game; await g.loadLevel(n); g.enterLevelStart(); g.play(); }, lv);
    await page.evaluate(FREEZE);
  }
  const views = await page.evaluate(VIEWS);
  const draws = [], tris = [];
  for (const [k, v] of views.entries()) {
    await page.evaluate((v) => { const g = window.__zk.game; window.__zk.tp(v.x, v.z, v.yaw, v.pitch); g.flashlightOn = !!v.light; }, v);
    await wait(2400);
    // 12 кадрів поспіль: draw calls / трикутники
    const s = await page.evaluate(() => new Promise((res) => {
      const d = [], t = []; let n = 0;
      const f = () => { const i = window.__zk.game.gfx.renderer.info.render; d.push(i.drawCalls); t.push(i.triangles); if (++n < 12) requestAnimationFrame(f); else res({ d, t }); };
      requestAnimationFrame(f);
    }));
    draws.push(...s.d); tris.push(...s.t);
    const file = path.join(outDir, `L${lv}-${k + 1}-${v.label}.png`);
    for (let a = 0; a < 3; a++) { const buf = await page.screenshot({ path: file, timeout: 180000 }); if (buf.length > 40000) break; await wait(2000); }
    v.draw = median(s.d); v.tris = Math.round(median(s.t));
  }
  const mem = await page.evaluate(INFO_JS);
  report.levels[lv] = {
    views, loadBytes: net.bytes - before,
    draw: { median: median(draws), max: Math.max(...draws) },
    tris: { median: Math.round(median(tris)), max: Math.round(Math.max(...tris)) },
    memory: mem
  };
  console.log(`L${lv}`, JSON.stringify({ draw: report.levels[lv].draw, tris: report.levels[lv].tris, mem, loadMB: +((net.bytes - before) / 1048576).toFixed(1) }));
}
report.totalBytes = net.bytes;
report.seconds = Math.round((Date.now() - t0) / 1000);
report.logs = logs;
writeFileSync(path.join(outDir, 'metrics.json'), JSON.stringify(report, null, 1));
console.log(outDir, 'boot', (bootBytes / 1048576).toFixed(1), 'MB', 'console:', JSON.stringify(logs));
await close(); await srv.close();
if (logs.length) process.exitCode = 1;
