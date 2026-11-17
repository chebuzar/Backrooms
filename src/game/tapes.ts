// Плівки Савельєва: магнітофон на підлозі шипить у просторі (чути, де він), розшифровка йде субтитрами
// за часом запису. Гравець може йти й слухати; нова плівка зупиняє попередню.
import type { AudioEngine, SpatialVoice } from '../audio/audio';
import type { SoundBank } from '../audio/bank';
import { tapeHiss } from '../audio/synth';
import type { Tape } from '../story/ru';

export class TapePlayer {
  private voice: SpatialVoice | null = null;
  private hiss: AudioBuffer | null = null;
  private tape: Tape | null = null;
  private t = 0;
  private next = 0;
  /** Іде запис (для автотестів і HUD). */
  get playing(): string | null { return this.tape?.id ?? null; }

  constructor(private readonly audio: AudioEngine, private readonly sfx: SoundBank, private readonly say: (text: string, seconds: number) => void) {}

  play(tape: Tape, x: number, z: number): void {
    this.stop();
    const ctx = this.audio.ctx;
    const click = this.sfx.get('metalclick');
    if (click) this.audio.play3D(click, x, 0.1, z, { gain: 0.7, rate: 0.75, ref: 1.5 });
    if (ctx) {
      this.hiss ??= tapeHiss(ctx);
      this.voice = this.audio.play3D(this.hiss, x, 0.1, z, { loop: true, gain: 0.55, ref: 1.6, wet: 0.3 });
    }
    this.tape = tape; this.t = 0; this.next = 0;
  }

  stop(): void {
    this.voice?.stop(0.15);
    this.voice = null;
    this.tape = null;
  }

  update(dt: number): void {
    const tp = this.tape;
    if (!tp) return;
    this.t += dt;
    while (this.next < tp.lines.length && (tp.lines[this.next] as [number, string])[0] <= this.t) {
      const [at, text] = tp.lines[this.next] as [number, string];
      const nextAt = (tp.lines[this.next + 1]?.[0] ?? at + 5);
      this.say(`${tp.speaker ?? 'Савельев: '}${text}`, Math.max(3, nextAt - at));
      this.next++;
    }
    const end = (tp.lines[tp.lines.length - 1]?.[0] ?? 0) + 4;
    if (this.t > end) {
      const click = this.sfx.get('metalclick');
      if (click) this.audio.play2D(click, 0.4, 0.7);
      this.stop();
    }
  }
}
