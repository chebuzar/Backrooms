// Звуки глибших рівнів (детермінований синтез): музична скринька дитсадка, кроки по воді, бульканий подих «Утопленника»,
// смішок «Улыбаки», рев насоса з водою в трубах.
const rng = (seed: number) => () => { seed = (seed + 0x6d2b79f5) | 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

/** Музична скринька: власна повільна мелодія в мінорі, гребінець трохи розладнаний і пружина сповільнюється до кінця. */
export function musicBox(ctx: BaseAudioContext): AudioBuffer {
  const sr = ctx.sampleRate, seconds = 15, n = Math.floor(sr * seconds);
  const b = ctx.createBuffer(2, n, sr);
  // ля-мінор, ноти (півтони від A4) і тривалість у долях
  const tune: [number, number][] = [[0, 1], [3, 1], [7, 1], [12, 2], [10, 1], [7, 1], [8, 2], [7, 1], [3, 1], [5, 1], [2, 2],
    [0, 1], [3, 1], [7, 1], [10, 1], [8, 1], [7, 1], [3, 2], [2, 1], [-2, 1], [0, 3]];
  const r = rng(91);
  const L = b.getChannelData(0), R = b.getChannelData(1);
  let t = 0.2;
  tune.forEach(([semi, beats], k) => {
    const slow = 1 + (k / tune.length) * 0.45; // пружина слабне
    const f = 440 * Math.pow(2, semi / 12) * 2 * (1 + (r() - 0.5) * 0.006);
    const start = Math.floor(t * sr), len = Math.floor(sr * 2.2);
    const pan = 0.5 + (r() - 0.5) * 0.4;
    for (let i = 0; i < len && start + i < n; i++) {
      const tt = i / sr;
      const env = Math.exp(-tt * 2.6) * (1 - Math.exp(-tt * 900));
      // зубчик гребінця: основний тон + негармонійні обертони металу
      const v = (Math.sin(2 * Math.PI * f * tt) + 0.32 * Math.sin(2 * Math.PI * f * 2.76 * tt) * Math.exp(-tt * 6) + 0.12 * Math.sin(2 * Math.PI * f * 5.4 * tt) * Math.exp(-tt * 12)) * env * 0.22;
      L[start + i]! += v * (1 - pan); R[start + i]! += v * pan;
    }
    t += beats * 0.42 * slow;
  });
  // механізм: тихе тріскотіння
  for (let i = 0; i < n; i += Math.floor(sr * 0.21)) { const c = (r() - 0.5) * 0.05; L[i] = (L[i] ?? 0) + c; R[i] = (R[i] ?? 0) + c; }
  return b;
}

/** Крок по мілкій воді: хлюпіт (кілька бризок) і плескіт, що розходиться. */
export function splashStep(ctx: BaseAudioContext, seed: number): AudioBuffer {
  const sr = ctx.sampleRate, n = Math.floor(sr * 0.55);
  const b = ctx.createBuffer(1, n, sr);
  const d = b.getChannelData(0);
  const r = rng(seed * 4099 + 7);
  let lp = 0, bp = 0, bpv = 0;
  const drops = Array.from({ length: 5 + Math.floor(r() * 4) }, () => [0.02 + r() * 0.3, 600 + r() * 1400, 0.1 + r() * 0.3] as const);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const w = r() * 2 - 1;
    lp += (w - lp) * 0.25;
    // смуговий фільтр навколо 900 Гц — «вода»
    bpv += (w - bp) * 0.18; bp += bpv * 0.18; bpv *= 0.82;
    const body = (lp * 0.6 + bp * 0.5) * Math.exp(-t * 9) * (1 - Math.exp(-t * 300));
    let drip = 0;
    for (const [at, f, a] of drops) if (t > at) { const u = t - at; drip += Math.sin(2 * Math.PI * (f + 900 * u) * u) * Math.exp(-u * 40) * a; }
    d[i] = (body * 0.9 + drip * 0.35) * 0.8;
  }
  return b;
}

/** Бульканий подих під водою («Утопленник»): повільні бульбашки, глухий хрип. Безшовна петля. */
export function drownedBreath(ctx: BaseAudioContext, seconds = 5): AudioBuffer {
  const sr = ctx.sampleRate, n = Math.floor(sr * seconds);
  const b = ctx.createBuffer(1, n, sr);
  const d = b.getChannelData(0);
  const r = rng(4242);
  let lp = 0;
  const bubbles = Array.from({ length: 22 }, () => [r() * seconds, 180 + r() * 420, 0.2 + r() * 0.5] as const);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    lp += (r() * 2 - 1 - lp) * 0.03;
    const rasp = lp * (0.5 + 0.5 * Math.sin((2 * Math.PI * t) / seconds * 2)) * 1.4;
    let bub = 0;
    for (const [at, f, a] of bubbles) { let u = t - at; if (u < 0) u += seconds; if (u < 0.12) bub += Math.sin(2 * Math.PI * (f + f * 3 * u) * u) * Math.exp(-u * 35) * a; }
    d[i] = (rasp * 0.5 + bub * 0.4) * 0.7;
  }
  return b;
}

/** Смішок «Улыбаки»: придушене хихикання на видиху, кілька коротких «хе» з придихом. */
export function giggle(ctx: BaseAudioContext, seed: number): AudioBuffer {
  const sr = ctx.sampleRate, n = Math.floor(sr * 1.6);
  const b = ctx.createBuffer(1, n, sr);
  const d = b.getChannelData(0);
  const r = rng(seed * 313 + 5);
  const k = 4 + Math.floor(r() * 3), f0 = 230 + r() * 60;
  let lp = 0, f1 = 0, f1v = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const beat = (t * 6.5) % 1, idx = Math.floor(t * 6.5);
    const on = idx < k ? Math.exp(-beat * 7) * (1 - Math.exp(-beat * 60)) * (1 - idx / (k + 1)) : 0;
    const w = r() * 2 - 1;
    lp += (w - lp) * 0.35;
    // голосова щілина + шум придиху, формант ~ «е»
    const pitch = f0 * (1 - idx * 0.03) * (1 + 0.06 * Math.sin(t * 40));
    const glott = Math.sign(Math.sin(2 * Math.PI * pitch * t)) * 0.3 + lp * 0.9;
    f1v += (glott - f1) * 0.09; f1 += f1v * 0.09; f1v *= 0.9;
    d[i] = (f1 * 0.7 + lp * 0.25) * on * 0.8;
  }
  return b;
}

/** Насос: низький ревучий гул мотора й булькання води в трубах. Безшовна петля. */
export function pumpLoop(ctx: BaseAudioContext, seconds = 4): AudioBuffer {
  const sr = ctx.sampleRate, n = Math.floor(sr * seconds);
  const b = ctx.createBuffer(2, n, sr);
  const r = rng(707);
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c);
    let lp = 0, lp2 = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const motor = Math.sin(2 * Math.PI * 25 * t) * 0.5 + Math.sin(2 * Math.PI * 50 * t) * 0.35 + Math.sin(2 * Math.PI * 75 * t + c) * 0.12;
      lp += (r() * 2 - 1 - lp) * 0.02;
      lp2 += (r() * 2 - 1 - lp2) * 0.2;
      const gurgle = lp2 * (0.5 + 0.5 * Math.sin(2 * Math.PI * 3 * t + c * 2)) * 0.25;
      d[i] = (motor * (0.8 + lp * 2) * 0.35 + gurgle) * 0.7;
    }
  }
  return b;
}

/** Фон дитсадка: тепла кімнатна тиша, повільний розладнаний акорд, тикання батареї й далека, сповільнена скринька. Петля. */
export function kinderAmbience(ctx: BaseAudioContext, seconds = 24): AudioBuffer {
  const sr = ctx.sampleRate, n = Math.floor(sr * seconds);
  const b = ctx.createBuffer(2, n, sr);
  const r = rng(3303);
  const ticks = Array.from({ length: 9 }, () => r() * seconds);
  const notes = Array.from({ length: 7 }, (_, i) => [2 + i * 3.1 + r() * 1.2, 220 * Math.pow(2, [0, 3, 7, 12, 10, 7, 3][i]! / 12)] as const);
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c);
    let lp = 0, lp2 = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      lp += (r() * 2 - 1 - lp) * 0.012;
      lp2 += (lp - lp2) * 0.05;
      // акорд ля-мінор, кожен тон трохи «пливе» (дві копії з биттям), петля замкнена: частоти кратні 1/seconds
      const ph = (2 * Math.PI * t) / seconds;
      const pad = (Math.sin(2 * Math.PI * 110 * t + Math.sin(ph) * 2) + Math.sin(2 * Math.PI * 130.8 * t + c) * 0.7 + Math.sin(2 * Math.PI * 164.8 * t + Math.sin(ph * 2)) * 0.5)
        * (0.5 + 0.5 * Math.sin(ph + c)) * 0.012;
      d[i] = lp2 * 0.6 + pad;
    }
    // короткі події дописуються лише у свої відрізки (не перебираються на кожному семплі)
    const add = (at: number, len: number, f: (u: number) => number) => {
      const s0 = Math.floor(at * sr);
      for (let j = 0; j < len * sr; j++) d[(s0 + j) % n] = (d[(s0 + j) % n] ?? 0) + f(j / sr);
    };
    for (const at of ticks) add(at, 0.05, (u) => Math.sin(2 * Math.PI * 2400 * u) * Math.exp(-u * 160) * 0.05);
    for (const [at, f] of notes) add(at, 3, (u) => Math.sin(2 * Math.PI * f * u) * Math.exp(-u * 1.6) * 0.018 * (c ? 0.7 : 1));
  }
  return b;
}

/** Фон басейну: краплі в порожній залі з довгим хвостом, хлюпання води біля бортиків, далекий гул насоса. Петля. */
export function poolAmbience(ctx: BaseAudioContext, seconds = 20): AudioBuffer {
  const sr = ctx.sampleRate, n = Math.floor(sr * seconds);
  const b = ctx.createBuffer(2, n, sr);
  const r = rng(4404);
  const drops = Array.from({ length: 26 }, () => [r() * seconds, 900 + r() * 1800, 0.3 + r() * 0.7, r()] as const);
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c);
    let lp = 0, lp2 = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr, ph = (2 * Math.PI * t) / seconds;
      lp += (r() * 2 - 1 - lp) * 0.04;
      lp2 += (lp - lp2) * 0.08;
      const lap = lp2 * (0.4 + 0.6 * Math.max(0, Math.sin(ph * 6 + c * 1.3))) * 0.9;
      const hum = (Math.sin(2 * Math.PI * 50 * t) * 0.6 + Math.sin(2 * Math.PI * 100 * t + c) * 0.25) * 0.012;
      d[i] = lap + hum;
    }
    // сама крапля і її відлуння від кахлю (кілька згасаючих повторів) — лише у своїх відрізках
    for (const [at, f, a, pan] of drops) {
      const g = (c ? pan : 1 - pan) * a * 0.09;
      for (let k = 0; k < 4; k++) {
        const s0 = Math.floor((at + k * 0.19) * sr), amp = g * Math.pow(0.42, k);
        for (let j = 0; j < 0.12 * sr; j++) { const v = j / sr, idx = (s0 + j) % n; d[idx] = (d[idx] ?? 0) + Math.sin(2 * Math.PI * (f + 1800 * v) * v) * Math.exp(-v * 55) * amp; }
      }
    }
  }
  return b;
}
