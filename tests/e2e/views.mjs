// Контрольні кадри рівня 0: однакові ракурси до/після кожної зміни графіки (правило: перевіряти скріншотами).
// node tests/e2e/views.mjs [webkit|chromium] [назва] [query]  →  .shots/views-<назва>-<браузер>.png (сітка) + окремі кадри
import { webkit, chromium } from 'playwright';
import { createServer } from 'vite';
import { execFileSync } from 'node:child_process';

const which = process.argv[2] ?? 'webkit', name = process.argv[3] ?? 'cur', extra = process.argv[4] ?? '';
// [мітка, x, z, yaw, pitch, ліхтарик]; точка зсувається до найближчого вільного місця
// задуманий поверх НИИ (40×40 клітинок по 1.2 м): коридори, кабінет, вестибюль, актова зала, лабораторія, туалет, архів, темне крило
const VIEWS = [
  ['corridor-n', 2.4, 9.6, -1.57, 0, 0], ['office', 3.6, 3.0, 3.14, -0.05, 0], ['lobby', 24, 29.5, 0, 0, 0], ['assembly', 3.6, 24, -1.57, 0, 0],
  ['lab', 34.8, 2.4, 3.14, -0.05, 0], ['wc', 32.4, 21.6, -0.8, -0.1, 0], ['corridor-s', 46, 38.4, 1.57, 0, 0], ['dark', 43.2, 43.2, 1.57, -0.05, 1]
];
const srv = await createServer({ root: process.cwd(), server: { port: 5191, strictPort: true }, logLevel: 'error' });
await srv.listen();
const b = which === 'chromium'
  ? await chromium.launch({ args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
  : await webkit.launch();
const page = await (await b.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })).newPage();
const logs = [];
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(m.text()); });
page.on('pageerror', (e) => logs.push('pageerror: ' + e.message));
await page.goto(`http://localhost:5191/?debug&nodbg${extra ? '&' + extra : ''}`);
await page.waitForFunction(() => window.__zk?.ready && window.__zk.game.player && window.__zk.game.dressed?.length > 0, null, { timeout: 240000 });
for (let k = 0; k < 6; k++) {
  await page.evaluate(() => window.__zk.play());
  await page.waitForTimeout(1500);
  if (await page.evaluate(() => window.__zk.game.mode === 'play')) break;
}
// контрольні кадри — без підказок керування (сенсорні кнопки, «Щёлкните, чтобы осмотреться»)
await page.addStyleTag({ content: '.hud .lockhint { display: none !important; }' });
await page.evaluate(() => { document.querySelector('.touch')?.classList.remove('shown'); });
const files = [];
for (const [label, x, z, yaw, pitch, light] of VIEWS) {
  await page.evaluate(([x, z, yaw, pitch, light]) => {
    const g = window.__zk.game, l = g.level.layout;
    const free = (px, pz) => !l.walls.some((w) => Math.abs(px - w.x) < w.w / 2 + 0.45 && Math.abs(pz - w.z) < w.d / 2 + 0.45);
    let best = [x, z];
    outer: for (let r = 0; r < 6; r += 0.3) for (let a = 0; a < 6.28; a += 0.5) {
      const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
      if (free(px, pz)) { best = [px, pz]; break outer; }
    }
    window.__zk.tp(best[0], best[1], yaw, pitch);
    g.flashlightOn = !!light;
  }, [x, z, yaw, pitch, light]);
  await page.waitForTimeout(2600);
  const f = `.shots/view-${name}-${which}-${label}.png`;
  // під навантаженням браузер іноді показує чорний кадр, поки компілює шейдер — перезнімаємо
  for (let k = 0; k < 4; k++) {
    const buf = await page.screenshot({ path: f });
    if (buf.length > 60000) break;
    await page.waitForTimeout(3000);
  }
  files.push(f);
}
await b.close(); await srv.close();
const grid = `.shots/views-${name}-${which}.png`;
execFileSync('python3', ['-c', `
import sys
from PIL import Image
fs=sys.argv[2:]; W=Image.new('RGB',(4*640,2*360))
for i,f in enumerate(fs): W.paste(Image.open(f).resize((640,360)),((i%4)*640,(i//4)*360))
W.save(sys.argv[1])`, grid, ...files]);
console.log(grid, 'console:', JSON.stringify(logs));
if (logs.length) process.exitCode = 1;
