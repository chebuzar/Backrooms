// Звуки, що синтезуються наперед (OfflineAudioContext), поки не підключено записи.
// Кожен генератор детермінований від зерна — однаковий звук на всіх пристроях.

const rng = (seed: number) => () => { seed = (seed + 0x6d2b79f5) | 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

/** Гул люмінесцентних ламп: мережеві 50 Гц і гармоніки + дзижчання дроселя + тихий шипучий шум. Безшовна петля. */
export function humLoop(ctx: BaseAudioContext, seconds = 4, seed = 1): AudioBuffer {
  const sr = ctx.sampleRate, n = Math.floor(sr * seconds);
  const b = ctx.createBuffer(2, n, sr);
  const r = rng(seed);
  // частоти кратні 1/seconds — петля зшивається без клацання
  const harm: [number, number][] = [[50, 0.32], [100, 0.5], [150, 0.18], [200, 0.22], [300, 0.08], [400, 0.05], [1200, 0.012]];
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c);
    const ph = harm.map(() => r() * Math.PI * 2);
    let lp = 0, buzz = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      let v = 0;
      harm.forEach(([f, a], k) => { v += a * Math.sin(2 * Math.PI * f * t + (ph[k] ?? 0)); });
      // «дзижчання» — обрізана синусоїда 100 Гц (дросель)
      const s = Math.sin(2 * Math.PI * 100 * t);
      buzz = Math.max(-0.4, Math.min(0.4, s * 3)) * 0.06;
      lp += (r() * 2 - 1 - lp) * 0.08;
      d[i] = (v * 0.35 + buzz + lp * 0.05) * 0.6;
    }
  }
  return b;
}

/** Крок по вологому ковроліну: глухий удар + м'який шурхіт + ледь чутне «чвакання». */
export function footstepCarpet(ctx: BaseAudioContext, seed: number): AudioBuffer {
  const sr = ctx.sampleRate, n = Math.floor(sr * 0.32);
  const b = ctx.createBuffer(1, n, sr);
  const d = b.getChannelData(0);
  const r = rng(seed * 7919 + 13);
  const thudF = 55 + r() * 25, scuff = 0.5 + r() * 0.5, wet = r() * 0.6;
  let lp = 0, bp1 = 0, bp2 = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const env = Math.exp(-t * 38) * (t < 0.003 ? t / 0.003 : 1);
    const thud = Math.sin(2 * Math.PI * thudF * t * (1 - t * 1.5)) * Math.exp(-t * 30);
    const noise = r() * 2 - 1;
    lp += (noise - lp) * 0.12;
    // смуговий шум ~900 Гц: шурхіт ворсу
    bp1 += (noise - bp1) * 0.35; bp2 += (bp1 - bp2) * 0.35;
    const sc = (bp1 - bp2) * Math.exp(-Math.pow((t - 0.05) / 0.05, 2)) * scuff;
    const sq = Math.sin(2 * Math.PI * (700 + 400 * t) * t) * lp * Math.exp(-Math.pow((t - 0.11) / 0.03, 2)) * wet * 0.5;
    d[i] = (thud * 0.9 + lp * env * 1.4 + sc * 0.5 + sq) * 0.7;
  }
  return b;
}

/** Синтезувати буфер через OfflineAudioContext (не блокує звук гри). */
export async function render(seconds: number, fn: (ctx: OfflineAudioContext) => AudioNode, channels = 2, sampleRate = 48000): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(channels, Math.ceil(seconds * sampleRate), sampleRate);
  fn(ctx).connect(ctx.destination);
  return ctx.startRendering();
}

/** Удар клавіші друкарської машинки: металевий клац + глухий стук каретки. */
export function typeClick(ctx: BaseAudioContext, seed: number): AudioBuffer {
  const sr = ctx.sampleRate, n = Math.floor(sr * 0.09);
  const b = ctx.createBuffer(1, n, sr), d = b.getChannelData(0);
  const r = rng(seed * 31 + 5);
  const f = 2400 + r() * 900;
  let hp = 0, prev = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const noise = r() * 2 - 1;
    hp = 0.6 * (hp + noise - prev); prev = noise;
    d[i] = (hp * Math.exp(-t * 160) * 0.7 + Math.sin(2 * Math.PI * f * t) * Math.exp(-t * 220) * 0.25 + Math.sin(2 * Math.PI * 140 * t) * Math.exp(-t * 60) * 0.35) * 0.6;
  }
  return b;
}

/** Шелест паперу: кілька коротких сплесків смугового шуму. */
export function paperRustle(ctx: BaseAudioContext, seed: number): AudioBuffer {
  const sr = ctx.sampleRate, n = Math.floor(sr * 0.6);
  const b = ctx.createBuffer(1, n, sr), d = b.getChannelData(0);
  const r = rng(seed * 97 + 3);
  const bursts = Array.from({ length: 5 }, () => [r() * 0.45, 0.02 + r() * 0.06, 0.4 + r() * 0.6] as const);
  let bp1 = 0, bp2 = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const noise = r() * 2 - 1;
    bp1 += (noise - bp1) * 0.5; bp2 += (bp1 - bp2) * 0.5;
    let env = 0;
    for (const [s, w, a] of bursts) env += a * Math.exp(-Math.pow((t - s) / w, 2));
    d[i] = (bp1 - bp2) * env * 0.9;
  }
  return b;
}

/** Низький гул «Шва»: 31 Гц з повільними биттями й шипінням. Петля. */
export function seamDrone(ctx: BaseAudioContext, seconds = 6): AudioBuffer {
  const sr = ctx.sampleRate, n = Math.floor(sr * seconds);
  const b = ctx.createBuffer(2, n, sr);
  const r = rng(77);
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      lp += (r() * 2 - 1 - lp) * 0.02;
      const beat = 0.6 + 0.4 * Math.sin(2 * Math.PI * (1 / seconds) * t * 2);
      d[i] = (Math.sin(2 * Math.PI * 31 * t) * 0.5 + Math.sin(2 * Math.PI * (62 + c * 0.5) * t) * 0.25 + Math.sin(2 * Math.PI * 233 * t) * 0.03) * beat * 0.5 + lp * 0.6;
    }
  }
  return b;
}
