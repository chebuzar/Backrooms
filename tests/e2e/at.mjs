// Кадри з заданих точок: node tests/e2e/at.mjs <браузер> <назва> '<JSON>' [query]
//   JSON — масив [рівень, x, z, yaw, pitch, ліхтарик(0/1), eval?]; точка зсувається до найближчого вільного місця;
//   x = "lamp" — стати за 2.5 м від z-ї лампи, що світить.
//   → .shots/at-<назва>-<браузер>-<i>.png і сітка .shots/at-<назва>-<браузер>.png
import { webkit, chromium } from 'playwright';
import { createServer } from 'vite';
import { execFileSync } from 'node:child_process';

const [which = 'webkit', name = 'cur', spec = '[]', extra = ''] = process.argv.slice(2);
const views = JSON.parse(spec);
const srv = await createServer({ root: process.cwd(), server: { port: 5191, strictPort: true }, logLevel: 'error' });
await srv.listen();
const b = which === 'chromium'
  ? await chromium.launch({ args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
  : await webkit.launch();
const page = await (await b.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })).newPage();
const logs = [];
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(m.text()); });
page.on('pageerror', (e) => { console.error('pageerror: ' + e.message); process.exit(1); });
await page.goto(`http://localhost:5191/?debug&nodbg${extra ? '&' + extra : ''}`);
await page.waitForFunction(() => window.__zk?.ready, null, { timeout: 180000 });
await page.evaluate(() => window.__zk.play());
await page.waitForFunction(() => window.__zk.game.mode === 'play' && window.__zk.game.player && !window.__zk.game.cameraOverride, null, { timeout: 60000 });
await page.waitForTimeout(1500);
await page.evaluate(() => document.querySelector('.touch')?.classList.remove('shown'));
const files = [];
let i = 0;
for (const [lv, x, z, yaw, pitch, light, ev] of views) {
  await page.evaluate(async ([lv, x, z, yaw, pitch, light]) => {
    const g = window.__zk.game;
    if (g.level.id !== lv) { await g.loadLevel(lv); g.enterLevelStart(); g.mode = 'play'; }
    const l = g.level.layout;
    // x = "lamp": стати за 2.5 м від z-ї лампи, що світить, і дивитися на неї
    if (x === 'lamp') { const on = l.lights.filter((p) => p.state === 'on'); const p = on[z % on.length]; x = p.x + 2.5; z = p.z; }
    // x = "dressed": стати за 3 м перед z-ю розставленою річчю (обстановка рівня) і дивитися на неї
    if (x === 'dressed') { const d = g.dressed[z % g.dressed.length]; x = d.x + Math.sin(d.yaw) * 3.2; z = d.z + Math.cos(d.yaw) * 3.2; yaw = d.yaw; }
    const free = (px, pz) => !l.walls.some((w) => Math.abs(px - w.x) < w.w / 2 + 0.35 && Math.abs(pz - w.z) < w.d / 2 + 0.35);
    let best = [x, z];
    outer: for (let r = 0; r < 6; r += 0.2) for (let a = 0; a < 6.28; a += 0.4) {
      const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
      if (free(px, pz)) { best = [px, pz]; break outer; }
    }
    window.__zk.tp(best[0], best[1], yaw, pitch);
    g.flashlightOn = !!light;
  }, [lv, x, z, yaw, pitch, light]);
  if (ev) await page.evaluate(ev);
  await page.waitForTimeout(Number(process.env.WAIT ?? 2600));
  const f = `.shots/at-${name}-${which}-${i++}.png`;
  for (let k = 0; k < 4; k++) { const buf = await page.screenshot({ path: f }); if (buf.length > 40000) break; await page.waitForTimeout(2500); }
  files.push(f);
}
console.log('console:', JSON.stringify(logs.slice(0, 20)));
await b.close(); await srv.close();
const grid = `.shots/at-${name}-${which}.png`;
execFileSync('python3', ['-c', `
import sys
from PIL import Image
fs=sys.argv[2:]; n=len(fs); cols=min(n,3); rows=(n+cols-1)//cols; W=Image.new('RGB',(cols*853,rows*480))
for i,f in enumerate(fs): W.paste(Image.open(f).convert('RGB').resize((853,480)),((i%cols)*853,(i//cols)*480))
W.save(sys.argv[1])`, grid, ...files]);
console.log(grid);
