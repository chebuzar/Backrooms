import { describe, it, expect } from 'vitest';
import { radioPips, typingBurst, busyTone } from '../../src/audio/synth-soviet';

// мінімальний контекст: синтезу потрібні лише частота дискретизації й буфер
const ctx = {
  sampleRate: 48000,
  createBuffer: (ch: number, n: number) => { const data = Array.from({ length: ch }, () => new Float32Array(n)); return { length: n, getChannelData: (i: number) => data[i] } as unknown as AudioBuffer; }
} as unknown as BaseAudioContext;

const stats = (b: AudioBuffer) => {
  const d = b.getChannelData(0);
  let peak = 0, bad = 0, energy = 0;
  for (const v of d) { if (!Number.isFinite(v)) bad++; peak = Math.max(peak, Math.abs(v)); energy += v * v; }
  return { peak, bad, rms: Math.sqrt(energy / d.length) };
};

describe('радянські звуки за стіною', () => {
  it('сигнали точного часу: шість пі-пі, чути, без перевантаження', () => {
    const b = radioPips(ctx), s = stats(b);
    expect(b.length / 48000).toBeGreaterThan(6);
    expect(s.bad).toBe(0);
    expect(s.peak).toBeLessThanOrEqual(1);
    expect(s.rms).toBeGreaterThan(0.01);
    // у паузі між сигналами майже тиша (лише шипіння лінії)
    const d = b.getChannelData(0);
    let q = 0; for (let i = Math.floor(48000 * 0.7); i < 48000 * 1.1; i++) q = Math.max(q, Math.abs(d[i] ?? 0));
    expect(q).toBeLessThan(0.15);
  });
  it('друкарська машинка: детермінована, різна за зерном, без NaN', () => {
    const a = typingBurst(ctx, 1), a2 = typingBurst(ctx, 1), c = typingBurst(ctx, 2);
    expect(stats(a).bad).toBe(0);
    expect(a.length).toBe(a2.length);
    expect(a.length).not.toBe(c.length);
    expect(stats(a).peak).toBeLessThanOrEqual(0.9001);
  });
  it('гудки «занято»', () => {
    const s = stats(busyTone(ctx));
    expect(s.bad).toBe(0);
    expect(s.rms).toBeGreaterThan(0.05);
  });
});
