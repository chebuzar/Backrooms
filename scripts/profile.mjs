// Профиль процессора во время игры: на что уходит время в кадре (JS-функции по «собственному» времени).
//   node scripts/profile.mjs [уровень] [секунды]
// Игрок идёт вперёд и поворачивается; монстр бодрствует. Печатает топ функций и среднее время кадра.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const vite = await import('vite');

const lv = Number(process.argv[2] || 0), secs = Number(process.argv[3] || 8);
const server = await vite.createServer({ server: { port: 5190, strictPort: false, host: '127.0.0.1' }, logLevel: 'error' });
await server.listen();
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1024, height: 640 } });
await ctx.addInitScript(() => { try { localStorage.setItem('zakulisye_v2', JSON.stringify({ set: { q: 'low', vol: 0 }, toolsTip: 1, max: 9, docs: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] })); } catch (e) { /* */ } });
const p = await ctx.newPage();
await p.goto(server.resolvedUrls.local[0] + '?debug=1');
await p.waitForFunction(() => window.__zk && window.__zkReady, null, { timeout: 90000 });
await p.evaluate((lv) => { window.__zk.god(true); window.__zk.start(lv, { seed: 7 }); }, lv);
await p.waitForFunction(() => window.__zk.ready, null, { timeout: 90000 });
await p.waitForTimeout(3000);
await p.evaluate(() => { const z = window.__zk; z.pl.wake = 1; z.wake && z.wake(); });
const cdp = await ctx.newCDPSession(p);
await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
// ходьба + поворот, счёт кадров
await p.evaluate((secs) => {
  const z = window.__zk; window.__frames = []; let last = performance.now();
  const f = (t) => { window.__frames.push(t - last); last = t; if (window.__frames.length < secs * 200) requestAnimationFrame(f); };
  requestAnimationFrame(f);
  const iv = setInterval(() => { z.pl.yaw += 0.05; }, 50); setTimeout(() => clearInterval(iv), secs * 1000);
}, secs);
await p.keyboard.down('KeyW');
await cdp.send('Profiler.start');
await p.waitForTimeout(secs * 1000);
const { profile } = await cdp.send('Profiler.stop');
await p.keyboard.up('KeyW');
const frames = await p.evaluate(() => window.__frames);
// собственное время по функциям
const dt = profile.timeDeltas, self = new Map(), byId = new Map(profile.nodes.map((n) => [n.id, n]));
for (let i = 0; i < profile.samples.length; i++) {
  const n = byId.get(profile.samples[i]); const cf = n.callFrame;
  const key = `${cf.functionName || '(anon)'}  ${cf.url.replace(/^.*\/(src|node_modules)\//, '$1/').replace(/\?.*$/, '')}:${cf.lineNumber + 1}`;
  self.set(key, (self.get(key) || 0) + (dt[i] || 0));
}
const total = [...self.values()].reduce((a, c) => a + c, 0);
const top = [...self.entries()].sort((a, c) => c[1] - a[1]).slice(0, 28);
const avg = frames.reduce((a, c) => a + c, 0) / frames.length;
console.log(`кадров ${frames.length}, среднее ${avg.toFixed(1)} мс, худшие: ${frames.sort((a, c) => c - a).slice(0, 5).map((x) => x.toFixed(0)).join(', ')} мс`);
for (const [k, v] of top) console.log(`${(v / total * 100).toFixed(1).padStart(5)}%  ${(v / 1000).toFixed(0).padStart(6)} мс  ${k}`);
await b.close(); await server.close(); process.exit(0);
