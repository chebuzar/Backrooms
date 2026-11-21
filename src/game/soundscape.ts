// Звуковий простір рівня:
// • луна приміщення: своя для кожного рівня (НИИ — коридори з лінолеумом, база — бетон, парковка — велика порожнина);
// • гучномовець: інколи дзвін і нерозбірливий голос із найближчого рупора, а на екрані — що «сказали» (повідомлення бреше);
// • тиск: низький гул під шкірою, що наростає з нервами і стихає разом з усім у тиші.
import type { AudioEngine } from '../audio/audio';
import { paChime, paVoice, tensionPad } from '../audio/synth';
import type { Level } from '../world/level0';
import { zoneOf } from '../world/decor';
import { PA } from '../story/tasks';

/** Луна рівня: довжина хвоста (с), крутизна згасання, частка «мокрого» звуку; у великих залах — більше. */
export const ROOMS: Record<number, { seconds: number; decay: number; wet: number; hall: number }> = {
  0: { seconds: 1.6, decay: 3.2, wet: 0.22, hall: 0.12 },
  1: { seconds: 2.3, decay: 2.6, wet: 0.3, hall: 0.1 },
  2: { seconds: 3.6, decay: 2.1, wet: 0.38, hall: 0.08 }
};

export type Surface = 'parquet' | 'linoleum' | 'concrete';

/** Під ногами: у НИИ — паркет у кабінетах і залі, лінолеум у коридорах; база й парковка — бетон. */
export function surfaceAt(lvl: Level, x: number, z: number): Surface {
  if (lvl.id !== 0) return 'concrete';
  const zn = zoneOf(lvl.layout, x, z);
  return zn === 'rooms' || zn === 'hall' ? 'parquet' : 'linoleum';
}

export class Soundscape {
  private lvl: Level | null = null;
  private paCd = 50;
  private padGain: GainNode | null = null;
  private pad: AudioBufferSourceNode | null = null;
  private chime: AudioBuffer | null = null;
  private voices: AudioBuffer[] = [];
  private zoneT = 0;
  private lastPa = -1;
  private roomFor = -1;

  constructor(private readonly audio: AudioEngine, private readonly say: (t: string, sec: number) => void) {}

  attach(lvl: Level): void {
    this.lvl = lvl;
    this.paCd = 45 + Math.random() * 40;
    this.roomFor = -1;
    this.prepare();
  }

  private prepare(): void {
    const ctx = this.audio.ctx;
    if (!ctx || this.chime) return;
    this.chime = paChime(ctx);
    for (let i = 0; i < 4; i++) this.voices.push(paVoice(ctx, 3.2 + i * 0.6, i + 3));
    this.padGain = ctx.createGain();
    this.padGain.gain.value = 0;
    this.padGain.connect(this.audio.music);
    this.pad = this.audio.play2D(tensionPad(ctx), 1, 1, this.padGain);
    if (this.pad) this.pad.loop = true;
  }

  /** Оголосити зараз (для перевірок і сюжетних моментів). */
  announce(x: number, z: number, idx?: number): void {
    const lvl = this.lvl;
    if (!lvl || !this.chime) return;
    const lines = PA[lvl.id] ?? PA[0] ?? [];
    let i = idx ?? Math.floor(Math.random() * lines.length);
    if (idx === undefined && i === this.lastPa && lines.length > 1) i = (i + 1) % lines.length;
    this.lastPa = i;
    // найближчий рупор (на рівнях без них — десь далеко під стелею)
    const sp = lvl.speakers?.length
      ? lvl.speakers.reduce((a, b) => (Math.hypot(b.x - x, b.z - z) < Math.hypot(a.x - x, a.z - z) ? b : a))
      : { x: x + 14, y: lvl.layout.height - 0.3, z: z - 9 };
    const far = Math.hypot(sp.x - x, sp.z - z);
    const opts = { gain: 1.4, ref: 4, wet: 0.7, occlusion: Math.min(0.7, far / 30) };
    this.audio.play3D(this.chime, sp.x, sp.y, sp.z, opts);
    const v = this.voices[i % this.voices.length];
    const text = lines[i];
    setTimeout(() => {
      if (this.lvl !== lvl) return;
      if (v) this.audio.play3D(v, sp.x, sp.y, sp.z, { ...opts, gain: 1.6 });
      if (text) this.say(`Громкоговоритель: «${text}»`, 4.5);
    }, 1900);
  }

  update(dt: number, s: { x: number; z: number; dread: number; silence: number; danger: number }): void {
    const lvl = this.lvl, ctx = this.audio.ctx;
    if (!lvl || !ctx) return;
    this.prepare();
    if (this.roomFor !== lvl.id) { const r = ROOMS[lvl.id] ?? ROOMS[0]!; this.audio.setRoom(r.seconds, r.decay, r.wet); this.roomFor = lvl.id; }
    // тиск: від нервів, сильніше при небезпеці; у тиші — зникає разом з усім
    if (this.padGain) this.padGain.gain.setTargetAtTime(Math.min(0.55, s.dread * 0.45 + s.danger * 0.25) * (1 - s.silence), ctx.currentTime, 1.2);
    // у великому залі — більше луни
    if ((this.zoneT -= dt) <= 0) {
      this.zoneT = 0.5;
      const r = ROOMS[lvl.id] ?? ROOMS[0]!, hall = zoneOf(lvl.layout, s.x, s.z) === 'hall';
      this.audio.reverbSend.gain.setTargetAtTime((r.wet + (hall ? r.hall : 0)) * (1 - s.silence * 0.6), ctx.currentTime, 0.8);
    }
    // гучномовець: не під час погоні й не в тиші
    if (s.danger > 0.5 || s.silence > 0.1) return;
    if ((this.paCd -= dt) > 0) return;
    this.paCd = 95 + Math.random() * 70;
    this.announce(s.x, s.z);
  }
}
