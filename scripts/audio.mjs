// Запись звуков игры в WAV (OfflineAudioContext) + замер громкости.
//   node scripts/audio.mjs                       все пресеты
//   node scripts/audio.mjs scream water          выбранные
// Файлы: .shots/audio/<имя>.wav. Печатает пик и RMS в dBFS.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const vite = await import('vite');

// [имя, длительность, код: s — Sound, ctx — OfflineAudioContext; at(t, fn) выполняет fn в момент t]
const PRESETS = {
  scream: [6, `amb(); at(1.2, () => { s.scream(); s.frame(0.016, G); }); at(2.6, () => s.deathDrone());`],
  water: [4, `amb(); for (let i = 0; i < 6; i++) at(0.3 + i * 0.45, () => s.step('water'));`],
  wade: [4, `amb(); at(0.2, () => { G.wade = 1; s.frame(0.016, G); }); at(3, () => { G.wade = 0; s.frame(0.016, G); });`],
  puddle: [3, `amb(); for (let i = 0; i < 5; i++) at(0.3 + i * 0.45, () => s.step(i % 2 ? 'puddle' : 'wet'));`],
  steps: [3, `amb(); for (let i = 0; i < 5; i++) at(0.3 + i * 0.45, () => s.step('carpet'));`],
  hall: [5, `s.setReverb(3.6, 0.5); amb(); for (let i = 0; i < 4; i++) at(0.3 + i * 0.45, () => s.step('concrete')); at(2.4, () => s.slam(3, -6));`],
  ambience: [6, `amb();`],
  // записи (CC0): ставка «появление», «заметил», далёкие события, голоса, фон страха по близости
  fear: [16, `amb(); at(0.3, () => s.hit()); at(3, () => { s.setEnt(3, 1.8, -4); s.spotted(); }); [0,1,2,3,4].forEach((i) => at(6 + i * 1.8, () => s.ambientEvent(true))); at(15, () => s.torch(true));`],
  dread: [10, `amb(); at(0.1, () => { G.prox = 0; s.frame(0.016, G); }); at(5, () => { G.prox = 1; G.chase = true; for (let k = 0; k < 40; k++) s.frame(0.1, G); });`],
  voices: [12, `amb(); ['watcher','blind','crawler','grinner','drowned','swimmer','puppet','mimic','stalker','shadow'].forEach((k, i) => at(0.3 + i * 1.15, () => s.voice(k, 2, -3, true)));`],
  'steps-dry': [3, `for (let i = 0; i < 5; i++) at(0.3 + i * 0.45, () => s.step('carpet'));`],
  'concrete-dry': [3, `for (let i = 0; i < 5; i++) at(0.3 + i * 0.45, () => s.step('concrete'));`]
};
const want = process.argv.slice(2);
const names = want.length ? want : Object.keys(PRESETS);
const out = path.resolve('.shots/audio'); mkdirSync(out, { recursive: true });

const server = await vite.createServer({ server: { port: 5181, strictPort: false, host: '127.0.0.1' }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(server.resolvedUrls.local[0] + '?debug=1');
await page.waitForFunction(() => window.__zk, null, { timeout: 60000 });

for (const name of names) {
  const [dur, code] = PRESETS[name];
  const res = await page.evaluate(async ([dur, code]) => {
    const SR = 44100, ctx = new OfflineAudioContext(2, SR * dur, SR);
    const s = new window.__zk.sound.constructor(); s.vol = 0.8; s.init(ctx);
    await s.loadSamples('/assets/sfx/');
    const G = { mode: 'game', power: 1, prox: 0, beacon: false, ent: false, chase: false, tin: 0, wade: 0, box: false, circus: false, black: false };
    const amb = () => s.frame(0.016, G);
    const jobs = [];
    const at = (t, fn) => jobs.push([t, fn]);
    new Function('s', 'ctx', 'G', 'amb', 'at', code)(s, ctx, G, amb, at);
    for (const [t, fn] of jobs.sort((a, b) => a[0] - b[0])) ctx.suspend(t).then(() => { fn(); ctx.resume(); });
    const buf = await ctx.startRendering();
    const L = buf.getChannelData(0), R = buf.getChannelData(1), n = L.length;
    let peak = 0, sum = 0;
    const pcm = new Int16Array(n * 2);
    for (let i = 0; i < n; i++) {
      const a = L[i], b = R[i]; peak = Math.max(peak, Math.abs(a), Math.abs(b)); sum += a * a + b * b;
      pcm[i * 2] = Math.max(-1, Math.min(1, a)) * 32767; pcm[i * 2 + 1] = Math.max(-1, Math.min(1, b)) * 32767;
    }
    const db = (v) => +(20 * Math.log10(v || 1e-9)).toFixed(1);
    let bin = ''; const u8 = new Uint8Array(pcm.buffer);
    for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return { sr: SR, peak: db(peak), rms: db(Math.sqrt(sum / (n * 2))), b64: btoa(bin) };
  }, [dur, code]);
  const data = Buffer.from(res.b64, 'base64'), h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(2, 22); h.writeUInt32LE(res.sr, 24);
  h.writeUInt32LE(res.sr * 4, 28); h.writeUInt16LE(4, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
  const file = path.join(out, name + '.wav');
  writeFileSync(file, Buffer.concat([h, data]));
  console.log(`${name.padEnd(9)} peak ${String(res.peak).padStart(6)} dBFS   rms ${String(res.rms).padStart(6)} dBFS   ${path.relative(process.cwd(), file)}`);
}
await browser.close();
await server.close();
process.exit(0);
