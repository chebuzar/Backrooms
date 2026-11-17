// Звуковий рушій на WebAudio: шини (музика / ефекти / середовище), стиск піків, реверберація приміщення,
// просторові джерела з HRTF і приглушенням крізь стіни. На iOS контекст оживає лише після жесту — unlock().

export interface Listener {
  x: number; y: number; z: number;
  /** Напрям погляду й «верх» (одиничні вектори). */
  fx: number; fy: number; fz: number;
}

export class AudioEngine {
  ctx: AudioContext | null = null;
  master!: GainNode;
  music!: GainNode;
  sfx!: GainNode;
  ambience!: GainNode;
  private reverb!: ConvolverNode;
  reverbSend!: GainNode;
  private volumes = { master: 0.85, music: 0.7, sfx: 1 };
  private buffers = new Map<string, AudioBuffer>();

  get ready(): boolean { return !!this.ctx && this.ctx.state === 'running'; }

  /** Викликати в обробнику дотику/кліку/клавіші. */
  unlock(): void {
    if (!this.ctx) this.build();
    if (this.ctx && this.ctx.state !== 'running') void this.ctx.resume().catch(() => {});
  }

  private build(): void {
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 12; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.25;
    this.master = ctx.createGain();
    this.master.connect(comp).connect(ctx.destination);
    this.music = ctx.createGain(); this.music.connect(this.master);
    this.sfx = ctx.createGain(); this.sfx.connect(this.master);
    this.ambience = ctx.createGain(); this.ambience.connect(this.master);
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.makeIR(2.4, 2.8);
    this.reverbSend = ctx.createGain(); this.reverbSend.gain.value = 0.28;
    this.reverbSend.connect(this.reverb).connect(this.master);
    this.applyVolumes();
  }

  setVolumes(master: number, music: number, sfx: number): void {
    this.volumes = { master, music, sfx };
    this.applyVolumes();
  }

  private applyVolumes(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.volumes.master, t, 0.05);
    this.music.gain.setTargetAtTime(this.volumes.music, t, 0.05);
    this.sfx.gain.setTargetAtTime(this.volumes.sfx, t, 0.05);
    this.ambience.gain.setTargetAtTime(this.volumes.sfx, t, 0.05);
  }

  /** Імпульсна характеристика кімнати: шум, що згасає (seconds — довжина хвоста). */
  makeIR(seconds: number, decay: number): AudioBuffer {
    const ctx = this.ctx as AudioContext;
    const n = Math.floor(ctx.sampleRate * seconds);
    const b = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      let lp = 0;
      for (let i = 0; i < n; i++) {
        const t = i / n;
        lp += (Math.random() * 2 - 1 - lp) * (0.55 - 0.4 * t); // хвіст темнішає з часом, як у справжній кімнаті
        d[i] = lp * Math.pow(1 - t, decay) * (i < 40 ? i / 40 : 1);
      }
    }
    return b;
  }

  setRoom(seconds: number, decay: number, wet: number): void {
    if (!this.ctx) return;
    this.reverb.buffer = this.makeIR(seconds, decay);
    this.reverbSend.gain.setTargetAtTime(wet, this.ctx.currentTime, 0.3);
  }

  updateListener(l: Listener): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const L = ctx.listener;
    const t = ctx.currentTime;
    if (L.positionX) {
      L.positionX.setTargetAtTime(l.x, t, 0.02); L.positionY.setTargetAtTime(l.y, t, 0.02); L.positionZ.setTargetAtTime(l.z, t, 0.02);
      L.forwardX.setTargetAtTime(l.fx, t, 0.02); L.forwardY.setTargetAtTime(l.fy, t, 0.02); L.forwardZ.setTargetAtTime(l.fz, t, 0.02);
      L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0;
    }
  }

  register(name: string, buf: AudioBuffer): void { this.buffers.set(name, buf); }
  buffer(name: string): AudioBuffer | undefined { return this.buffers.get(name); }

  /** Непросторовий звук (інтерфейс, дихання, серце). */
  play2D(buf: AudioBuffer, gain = 1, rate = 1, bus: GainNode = this.sfx): AudioBufferSourceNode | null {
    const ctx = this.ctx;
    if (!ctx) return null;
    const s = ctx.createBufferSource();
    s.buffer = buf; s.playbackRate.value = rate;
    const g = ctx.createGain(); g.gain.value = gain;
    s.connect(g).connect(bus);
    s.start();
    return s;
  }

  /** Просторовий звук у точці світу. occlusion 0..1 — наскільки його глушать стіни. */
  play3D(buf: AudioBuffer, x: number, y: number, z: number, opts: { gain?: number; rate?: number; occlusion?: number; ref?: number; wet?: number; loop?: boolean } = {}): SpatialVoice | null {
    const ctx = this.ctx;
    if (!ctx) return null;
    const v = new SpatialVoice(this, buf, opts.loop ?? false, opts.ref ?? 1.5);
    v.setPosition(x, y, z);
    v.setOcclusion(opts.occlusion ?? 0);
    v.gain.gain.value = opts.gain ?? 1;
    v.src.playbackRate.value = opts.rate ?? 1;
    v.wet.gain.value = opts.wet ?? 0.35;
    v.src.start();
    return v;
  }
}

/** Одне просторове джерело: буфер → гучність → фільтр «крізь стіну» → HRTF-панорама → шина + реверб. */
export class SpatialVoice {
  readonly src: AudioBufferSourceNode;
  readonly gain: GainNode;
  readonly filter: BiquadFilterNode;
  readonly panner: PannerNode;
  readonly wet: GainNode;
  constructor(private readonly engine: AudioEngine, buf: AudioBuffer, loop: boolean, ref: number) {
    const ctx = engine.ctx as AudioContext;
    this.src = ctx.createBufferSource();
    this.src.buffer = buf; this.src.loop = loop;
    this.gain = ctx.createGain();
    this.filter = ctx.createBiquadFilter(); this.filter.type = 'lowpass'; this.filter.frequency.value = 20000;
    this.panner = new PannerNode(ctx, { panningModel: 'HRTF', distanceModel: 'inverse', refDistance: ref, rolloffFactor: 1.25, maxDistance: 80 });
    this.wet = ctx.createGain();
    this.src.connect(this.gain).connect(this.filter).connect(this.panner);
    this.panner.connect(engine.sfx);
    this.panner.connect(this.wet).connect(engine.reverbSend);
  }
  setPosition(x: number, y: number, z: number): void {
    const t = this.engine.ctx?.currentTime ?? 0;
    this.panner.positionX.setTargetAtTime(x, t, 0.03); this.panner.positionY.setTargetAtTime(y, t, 0.03); this.panner.positionZ.setTargetAtTime(z, t, 0.03);
  }
  /** 0 — пряма видимість, 1 — за кількома стінами (глухо й тихо). */
  setOcclusion(o: number): void {
    const t = this.engine.ctx?.currentTime ?? 0;
    this.filter.frequency.setTargetAtTime(20000 * Math.pow(0.03, o), t, 0.08);
  }
  stop(fade = 0.1): void {
    const ctx = this.engine.ctx;
    if (!ctx) return;
    this.gain.gain.setTargetAtTime(0, ctx.currentTime, fade / 3);
    this.src.stop(ctx.currentTime + fade);
  }
}
