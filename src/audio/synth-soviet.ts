// Радянські звуки «за стіною» (детермінований синтез, без запису): сигнали точного часу з радіоточки,
// друкарська машинка в сусідньому кабінеті (серія ударів, дзвіночок і повернення каретки), гудок телефону в трубці,
// що лежить поруч. Усе звучить як крізь стіну — гра ще й приглушує їх оклюзією.
const rng = (seed: number) => () => { seed = (seed + 0x6d2b79f5) | 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

/** Простий смуговий фільтр «динамік радіоточки» (300–3000 Гц) і тихе шипіння лінії. */
function speaker(d: Float32Array, sr: number, r: () => number, hiss = 0.012): void {
  let lp = 0, hp = 0, prev = 0;
  const a = 1 - Math.exp((-2 * Math.PI * 3000) / sr), b = Math.exp((-2 * Math.PI * 300) / sr);
  for (let i = 0; i < d.length; i++) {
    const x = (d[i] ?? 0) + (r() * 2 - 1) * hiss;
    lp += (x - lp) * a;
    hp = b * (hp + lp - prev); prev = lp;
    d[i] = Math.tanh(hp * 1.6) * 0.8;
  }
}

/** «Пи-пи-пи…» — шість сигналів точного часу (1 кГц, кожну секунду; останній — початок години). */
export function radioPips(ctx: BaseAudioContext): AudioBuffer {
  const sr = ctx.sampleRate, n = Math.floor(sr * 6.6);
  const b = ctx.createBuffer(1, n, sr), d = b.getChannelData(0);
  const r = rng(1986);
  for (let k = 0; k < 6; k++) {
    const start = Math.floor(sr * (0.3 + k)), len = Math.floor(sr * (k === 5 ? 0.2 : 0.1));
    for (let i = 0; i < len; i++) {
      const t = i / sr, env = Math.min(1, t / 0.004, (len / sr - t) / 0.004);
      d[start + i] = Math.sin(2 * Math.PI * 1000 * t) * env * 0.5;
    }
  }
  speaker(d, sr, r, 0.02);
  return b;
}

/** Друкарська машинка за стіною: дві-три строки ударів з паузами, дзвіночок і повернення каретки. */
export function typingBurst(ctx: BaseAudioContext, seed: number): AudioBuffer {
  const sr = ctx.sampleRate, r = rng(seed * 131 + 7);
  const lines = 2 + Math.floor(r() * 2);
  const events: [number, 'key' | 'bell' | 'return'][] = [];
  let t = 0.2;
  for (let l = 0; l < lines; l++) {
    const keys = 18 + Math.floor(r() * 22);
    for (let k = 0; k < keys; k++) {
      events.push([t, 'key']);
      t += r() < 0.12 ? 0.32 + r() * 0.4 : 0.09 + r() * 0.08; // пауза між словами чи думка
    }
    events.push([t + 0.05, 'bell']);
    events.push([t + 0.35, 'return']);
    t += 1.2 + r() * 1.6;
  }
  const n = Math.floor(sr * (t + 0.6));
  const b = ctx.createBuffer(1, n, sr), d = b.getChannelData(0);
  for (const [at, kind] of events) {
    const s = Math.floor(at * sr);
    if (kind === 'key') {
      const len = Math.floor(sr * 0.06), f = 1700 + r() * 900, g = 0.45 + r() * 0.35;
      for (let i = 0; i < len && s + i < n; i++) {
        const tt = i / sr;
        d[s + i]! += ((r() * 2 - 1) * Math.exp(-tt * 190) * 0.6 + Math.sin(2 * Math.PI * f * tt) * Math.exp(-tt * 260) * 0.25 + Math.sin(2 * Math.PI * 120 * tt) * Math.exp(-tt * 70) * 0.5) * g;
      }
    } else if (kind === 'bell') {
      const len = Math.floor(sr * 0.9);
      for (let i = 0; i < len && s + i < n; i++) {
        const tt = i / sr;
        d[s + i]! += (Math.sin(2 * Math.PI * 2350 * tt) + 0.4 * Math.sin(2 * Math.PI * 5900 * tt) * Math.exp(-tt * 8)) * Math.exp(-tt * 5) * 0.28;
      }
    } else {
      // каретка: тріскучий проїзд ~0.4 с і глухий удар об упор
      const len = Math.floor(sr * 0.45);
      for (let i = 0; i < len && s + i < n; i++) {
        const tt = i / sr, rat = (Math.sin(2 * Math.PI * 38 * tt) > 0.6 ? 1 : 0.25);
        d[s + i]! += (r() * 2 - 1) * rat * 0.12 * (1 - tt / 0.45);
      }
      const e = s + len;
      for (let i = 0; i < sr * 0.12 && e + i < n; i++) { const tt = i / sr; d[e + i]! += Math.sin(2 * Math.PI * 95 * tt) * Math.exp(-tt * 40) * 0.8; }
    }
  }
  // кімната за стіною: трохи «коробкове» відлуння
  const dl = Math.floor(sr * 0.021);
  for (let i = dl; i < n; i++) d[i]! += (d[i - dl] ?? 0) * 0.35;
  let peak = 0;
  for (const v of d) peak = Math.max(peak, Math.abs(v));
  if (peak > 0.9) for (let i = 0; i < n; i++) d[i]! *= 0.9 / peak;
  return b;
}

/** Гудки в покладеній поруч трубці («занято»): 425 Гц, 0.35 с / 0.35 с. */
export function busyTone(ctx: BaseAudioContext): AudioBuffer {
  const sr = ctx.sampleRate, n = Math.floor(sr * 5.6);
  const b = ctx.createBuffer(1, n, sr), d = b.getChannelData(0);
  for (let i = 0; i < n; i++) {
    const t = i / sr, on = (t % 0.7) < 0.35 ? 1 : 0;
    d[i] = Math.sin(2 * Math.PI * 425 * t) * on * 0.35;
  }
  speaker(d, sr, rng(425), 0.006);
  return b;
}
