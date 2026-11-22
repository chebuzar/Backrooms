// Хода монстрів збоку: монстр ходить туди-сюди під лампою, гравець стоїть за 4.5 м і дивиться впритул.
// node tests/e2e/gait.mjs [браузер] [рівні, напр. 2,3,4] [run]  → .shots/gait-<рівень>-<браузер>.png (сітка кадрів)
// run — у погоні (швидко); без нього — спокійна хода. Код 1 — помилки консолі.
import { webkit, chromium } from 'playwright';
import { createServer } from 'vite';
import { execFileSync } from 'node:child_process';

const [which = 'webkit', ids = '2,3,4', mode = 'walk', bare = ''] = process.argv.slice(2);
const srv = await createServer({ root: process.cwd(), server: { port: 5191, strictPort: true }, logLevel: 'error' });
await srv.listen();
const b = which === 'chromium'
  ? await chromium.launch({ args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
  : await webkit.launch();
const page = await (await b.newContext({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1 })).newPage();
const logs = [];
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(m.text()); });
page.on('pageerror', (e) => { console.error('pageerror: ' + e.message); process.exit(1); });
await page.goto('http://localhost:5191/?debug&nodbg');
await page.waitForFunction(() => window.__zk?.ready, null, { timeout: 180000 });
await page.evaluate(() => window.__zk.play());
await page.waitForFunction(() => window.__zk.game.mode === 'play' && window.__zk.game.player && !window.__zk.game.cameraOverride, null, { timeout: 60000 });
await page.evaluate(() => document.querySelector('.touch')?.classList.remove('shown'));
for (const lv of ids.split(',').map(Number)) {
  const info = await page.evaluate(async ([lv, mode, bare]) => {
    const g = window.__zk.game;
    try { if (g.level.id !== lv) { await g.loadLevel(lv); g.enterLevelStart(); g.mode = 'play'; } } catch (e) { return { err: String(e) + ' ' + e.stack }; }
    const l = g.level.layout, s = g.hunt.stalker;
    if (!s) return { err: 'no stalker' };
    // світла лампа з вільним місцем: відрізок ±3 м по X і гравець за 4.5 м по Z
    const free = (px, pz, m) => !l.walls.some((w) => Math.abs(px - w.x) < w.w / 2 + m && Math.abs(pz - w.z) < w.d / 2 + m);
    const ok = (p) => { for (let t = -3.2; t <= 3.2; t += 0.4) if (!free(p.x + t, p.z, 0.6)) return false; for (let t = 0; t <= 4.6; t += 0.4) if (!free(p.x, p.z + t, 0.4)) return false; return true; };
    const lamp = l.lights.filter((p) => p.state === 'on' && Math.hypot(p.x - l.spawn.x, p.z - l.spawn.z) > 8).find(ok);
    if (!lamp) return { err: 'no spot' };
    const run = mode === 'run';
    const a = { x: lamp.x - 2, y: 0, z: lamp.z + 0.9 }, c = { x: lamp.x + 2, y: 0, z: lamp.z + 0.9 };
    s.brain.traits = { ...s.brain.traits, darkOnly: false }; // «Улыбака» інакше не виходить на світло
    const idle = mode === 'idle';
    if (idle) Object.assign(a, { x: lamp.x });
    Object.assign(s.pos, a); s.sub = 0; s.subGoal = 0;
    let goal = c;
    s.brain.update = () => {
      if (Math.hypot(goal.x - s.pos.x, goal.z - s.pos.z) < 0.5) goal = goal === c ? a : c;
      s.brain.state = run ? 'chase' : 'patrol';
      if (idle) return { target: null, speed: 0, lookAt: { x: s.pos.x + 10, y: 0, z: s.pos.z }, attack: false };
      return { target: goal, speed: run ? 2.6 : (s.brain.traits.walkSpeed ?? 1.1), lookAt: null, attack: false };
    };
    window.__zk.tp(lamp.x, lamp.z + 3.7, 0, -0.1);
    if (s.loco) s.loco.constructor.bare = bare;
    g.flashlightOn = s.kind !== 'smiler';
    s.tension = () => {}; // без мерехтіння ламп довкола — щоб тіло було видно
    // монстр не хапає і не реагує на погляд — лише ходить
    g.hunt.ev.onCatch = () => {};
    return { kind: s.kind, lamp: [lamp.x, lamp.z] };
  }, [lv, mode, bare === 'bare']);
  console.log(lv, JSON.stringify(info));
  if (info.err) continue;
  await page.waitForTimeout(3000);
  const files = [];
  for (let k = 0; k < 6; k++) {
    const f = `.shots/gait-${lv}-${which}-${k}.png`;
    await page.screenshot({ path: f });
    files.push(f);
    await page.waitForTimeout(450);
  }
  execFileSync('python3', ['-c', `
import sys
from PIL import Image
fs=sys.argv[2:]; W=Image.new('RGB',(3*640,2*360))
for i,f in enumerate(fs): W.paste(Image.open(f).convert('RGB').resize((640,360)),((i%3)*640,(i//3)*360))
W.save(sys.argv[1])`, `.shots/gait-${lv}-${which}-${mode}${bare ? '-bare' : ''}.png`, ...files]);
}
console.log('console:', JSON.stringify(logs.slice(0, 20)));
await b.close(); await srv.close();
if (logs.length) process.exitCode = 1;
