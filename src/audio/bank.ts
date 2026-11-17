// Бібліотека записаних звуків (public/assets/sfx/*.m4a, AAC — відтворюється всюди, включно з Safari/iOS).
// Вантажиться після першого жесту (аудіоконтекст), декодується один раз. Для килиму готує приглушені копії кроків.
export class SoundBank {
  private readonly map = new Map<string, AudioBuffer>();
  ready = false;

  async load(ctx: BaseAudioContext, base: string): Promise<void> {
    const names = (await (await fetch(`${base}index.json`)).json()) as string[];
    await Promise.all(names.map(async (n) => {
      try {
        const buf = await ctx.decodeAudioData(await (await fetch(`${base}${n}.m4a`)).arrayBuffer());
        this.map.set(n, buf);
      } catch { /* відсутній чи пошкоджений файл не ламає гру — звук просто не грає */ }
    }));
    // кроки по вологому килиму: глухіші й тихіші (нижні частоти, без «стуку» підбора)
    await Promise.all(names.filter((n) => n.startsWith('step_')).map(async (n) => {
      const src = this.map.get(n);
      if (src) this.map.set(n.replace('step_', 'carpet_'), await muffle(src, 1000, 0.8));
    }));
    this.ready = true;
  }

  get(name: string): AudioBuffer | null { return this.map.get(name) ?? null; }

  /** Випадковий звук із групи за префіксом (step_, creak, hit_ …). */
  pick(prefix: string): AudioBuffer | null {
    const all = [...this.map.keys()].filter((k) => k.startsWith(prefix));
    const k = all[Math.floor(Math.random() * all.length)];
    return k ? (this.map.get(k) ?? null) : null;
  }
}

/** Пропустити буфер крізь фільтр нижніх частот офлайн (без витрат під час гри). */
async function muffle(src: AudioBuffer, freq: number, gain: number): Promise<AudioBuffer> {
  const off = new OfflineAudioContext(src.numberOfChannels, src.length, src.sampleRate);
  const s = off.createBufferSource();
  s.buffer = src;
  const f = off.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = freq;
  f.Q.value = 0.5;
  const g = off.createGain();
  g.gain.value = gain;
  s.connect(f).connect(g).connect(off.destination);
  s.start();
  return off.startRendering();
}
