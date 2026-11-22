// Огляд гри кадрами: меню, кожен рівень з різних точок, HUD у грі. Для оцінки «як виглядає» після змін.
// node tests/e2e/tour.mjs [webkit|chromium] [назва] [рівні, напр. 0,1,2] [query]
//   →  .shots/tour-<назва>-<браузер>-*.png  і сітка .shots/tour-<назва>-<браузер>.png
import { webkit, chromium } from 'playwright';
import { createServer } from 'vite';
import { execFileSync } from 'node:child_process';

const which = process.argv[2] ?? 'webkit', name = process.argv[3] ?? 'cur';
const levels = (process.argv[4] ?? '0,1,2').split(',').map(Number);
const extra = process.argv[5] ?? '';
const srv = await createServer({ root: process.cwd(), server: { port: 5191, strictPort: true }, logLevel: 'error' });
await srv.listen();
const b = which === 'chromium'
  ? await chromium.launch({ args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
  : await webkit.launch();
const page = await (await b.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })).newPage();
const logs = [];
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(m.text()); });
page.on('pageerror', (e) => logs.push('pageerror: ' + e.message));
const files = [];
const snap = async (label, wait = 2200) => {
  await page.waitForTimeout(wait);
  const f = `.shots/tour-${name}-${which}-${label}.png`;
  for (let k = 0; k < 4; k++) { const buf = await page.screenshot({ path: f }); if (buf.length > 40000) break; await page.waitForTimeout(2500); }
  files.push(f);
};
await page.goto(`http://localhost:5191/?debug&nodbg${extra ? '&' + extra : ''}`);
await page.waitForFunction(() => window.__zk?.ready, null, { timeout: 180000 });
await snap('age', 800);
await page.click('.age [data-go]').catch(() => {});
await snap('menu', 1500);
await page.evaluate(() => { const g = window.__zk.game; const go = () => { if (g.mode === 'menu') g.play(); else setTimeout(go, 100); }; go(); });
await page.waitForFunction(() => window.__zk.game.mode === 'play', null, { timeout: 60000 });
for (const id of levels) {
  if (id !== 0 || (await page.evaluate(() => window.__zk.game.level.id)) !== 0) {
    await page.evaluate(async (id) => { const g = window.__zk.game; await g.loadLevel(id); g.enterLevelStart(); g.mode = 'play'; }, id);
  }
  // точки: старт, і 5 випадкових вільних точок рівня з фіксованим seed (кімнати, коридори, темні зони)
  const pts = await page.evaluate((id) => {
    const l = window.__zk.game.level.layout;
    const free = (px, pz) => !l.walls.some((w) => Math.abs(px - w.x) < w.w / 2 + 0.5 && Math.abs(pz - w.z) < w.d / 2 + 0.5);
    let s = 12345 + id * 7; const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
    const out = [[l.spawn.x, l.spawn.z, l.spawn.yaw + Math.PI]];
    for (let k = 0; out.length < 6 && k < 5000; k++) {
      const cx = Math.floor(r() * l.cols), cz = Math.floor(r() * l.rows);
      if (l.dist[cz * l.cols + cx] < 0) continue;
      const x = (cx + 0.5) * l.cell, z = (cz + 0.5) * l.cell;
      if (free(x, z)) out.push([x, z, r() * 6.28]);
    }
    return out;
  }, id);
  let i = 0;
  for (const [x, z, yaw] of pts) {
    await page.evaluate(([x, z, yaw, fl]) => { window.__zk.tp(x, z, yaw, 0); window.__zk.game.flashlightOn = fl; }, [x, z, yaw, i >= 4]);
    await snap(`L${id}-${i++}`);
  }
}
console.log('console:', JSON.stringify(logs.slice(0, 20)));
await b.close(); await srv.close();
const grid = `.shots/tour-${name}-${which}.png`;
execFileSync('python3', ['-c', `
import sys
from PIL import Image
fs=sys.argv[2:]; n=len(fs); cols=4; rows=(n+cols-1)//cols; W=Image.new('RGB',(cols*640,rows*360))
for i,f in enumerate(fs): W.paste(Image.open(f).convert('RGB').resize((640,360)),((i%cols)*640,(i//cols)*360))
W.save(sys.argv[1])`, grid, ...files]);
console.log(grid);
