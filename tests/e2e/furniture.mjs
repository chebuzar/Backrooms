// Кадри обстановки НИИ: по одному місцю кожного виду (стіл, шафи, стелажі, стільці в коридорі, ленінська кімната).
// node tests/e2e/furniture.mjs → .shots/kind-<вид>.png і сітка .shots/kinds.png
import { webkit } from 'playwright';
import { createServer } from 'vite';
import { execFileSync } from 'node:child_process';
const srv = await createServer({ root: process.cwd(), server: { port: 5191, strictPort: true }, logLevel: 'error' });
await srv.listen();
const b = await webkit.launch();
const page = await (await b.newContext({ viewport: { width: 960, height: 540 } })).newPage();
const logs = [];
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(m.text()); });
page.on('pageerror', (e) => { console.error('pageerror', e.message); process.exit(1); });
await page.goto('http://localhost:5191/?debug&nodbg');
await page.waitForFunction(() => window.__zk?.ready, null, { timeout: 180000 });
await page.evaluate(() => window.__zk.play());
await page.waitForFunction(() => window.__zk.game.mode === 'play' && window.__zk.game.player && !window.__zk.game.cameraOverride, null, { timeout: 60000 });
const kinds = (process.argv[2] ?? 'desk,drawer-cabinet,bookshelf,vintage-cabinet,shelves,waiting,lecture').split(',');
const files = [];
for (const k of kinds) {
  await page.evaluate((k) => {
    const g = window.__zk.game, d = g.dressed.find((x) => x.kind === k);
    if (!d) return;
    const dist = ['shelves', 'waiting'].includes(k) ? 1.25 : k === 'lecture' ? -1.2 : 2.6;
    window.__zk.tp(d.x + Math.sin(d.yaw) * dist, d.z + Math.cos(d.yaw) * dist, d.yaw, -0.25);
    g.flashlightOn = true;
  }, k);
  await page.waitForTimeout(k === kinds[0] ? 6000 : 2200);
  const f = `.shots/kind-${k}.png`; await page.screenshot({ path: f }); files.push(f);
}
console.log('console:', JSON.stringify(logs.slice(0, 10)));
await b.close(); await srv.close();
execFileSync('python3', ['-c', `
import sys
from PIL import Image
fs=sys.argv[2:]; W=Image.new('RGB',(4*480,2*270))
for i,f in enumerate(fs): W.paste(Image.open(f).convert('RGB').resize((480,270)),((i%4)*480,(i//4)*270))
W.save(sys.argv[1])`, '.shots/kinds.png', ...files]);
