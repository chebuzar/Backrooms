// Атмосфера рівня: рідкісні далекі звуки за спиною гравця (крізь стіни — глухо), «чужі кроки», що стихають,
// коли гравець зупиняється, дихання після бігу. Напруга без монстра.
import type { AudioEngine } from '../audio/audio';
import { distantThud, scrape, breath, footstepCarpet } from '../audio/synth';
import { radioPips, typingBurst, busyTone } from '../audio/synth-soviet';
import type { Player } from './player';

export class Ambience {
  private next = 18 + Math.random() * 20;
  private thuds: AudioBuffer[] = [];
  private scrapes: AudioBuffer[] = [];
  private breaths: AudioBuffer[] = [];
  private steps: AudioBuffer[] = [];
  private follow = { left: 0, t: 0, x: 0, z: 0 };
  private breathT = 0;
  private typing: AudioBuffer[] = [];
  private pips: AudioBuffer | null = null;
  private busy: AudioBuffer | null = null;
  /** Поточний рівень: друкарська машинка — у НИИ й на базі; радіоточка — скрізь, де є дроти. */
  level = 0;

  constructor(private readonly audio: AudioEngine) {}

  prepare(): void {
    const ctx = this.audio.ctx;
    if (!ctx || this.thuds.length) return;
    for (let i = 0; i < 4; i++) this.thuds.push(distantThud(ctx, i + 1));
    for (let i = 0; i < 2; i++) this.scrapes.push(scrape(ctx, i + 1));
    for (let i = 0; i < 3; i++) this.breaths.push(breath(ctx, i + 1));
    for (let i = 0; i < 6; i++) this.steps.push(footstepCarpet(ctx, 40 + i));
    for (let i = 0; i < 3; i++) this.typing.push(typingBurst(ctx, i + 1));
    this.pips = radioPips(ctx);
    this.busy = busyTone(ctx);
  }

  private behind(p: Player, dist: number, spread = 1.2): [number, number] {
    const a = p.yaw + Math.PI + (Math.random() - 0.5) * spread;
    return [p.pos.x - Math.sin(a) * dist, p.pos.z - Math.cos(a) * dist];
  }

  update(dt: number, p: Player): void {
    if (!this.thuds.length) return;
    this.next -= dt;
    if (this.next <= 0) {
      this.next = 25 + Math.random() * 45;
      const roll = Math.random();
      // радянський «побут за стіною»: хтось друкує в сусідньому кабінеті; радіоточка дає сигнали точного часу;
      // у покладеній трубці — «занято». Людей тут немає, а звуки є.
      if (roll > 0.72) {
        const [x, z] = this.behind(p, 7 + Math.random() * 7, 2.8);
        const k = Math.random();
        const typing = this.level <= 1 && k < 0.55 ? this.typing[Math.floor(Math.random() * this.typing.length)] : null;
        const b = typing ?? (k < 0.85 ? this.pips : this.busy);
        if (b) this.audio.play3D(b, x, 1.2, z, { gain: typing ? 0.7 : 0.45, occlusion: 0.7, ref: 2.5, wet: 0.6 });
        return;
      }
      if (roll < 0.3) {
        const b = this.thuds[Math.floor(Math.random() * this.thuds.length)];
        const [x, z] = this.behind(p, 14 + Math.random() * 10);
        if (b) this.audio.play3D(b, x, 1, z, { gain: 0.9, occlusion: 0.75, ref: 3, wet: 0.7 });
      } else if (roll < 0.52) {
        const b = this.scrapes[Math.floor(Math.random() * this.scrapes.length)];
        const [x, z] = this.behind(p, 18 + Math.random() * 8, 2.5);
        if (b) this.audio.play3D(b, x, 1, z, { gain: 0.6, occlusion: 0.8, ref: 3, wet: 0.8 });
      } else {
        // чужі кроки за спиною: йдуть, поки йде гравець; зупинився — ще два кроки й тиша
        this.follow = { left: 6 + Math.floor(Math.random() * 6), t: 0, x: 0, z: 0 };
        [this.follow.x, this.follow.z] = this.behind(p, 9 + Math.random() * 4, 0.6);
      }
    }
    if (this.follow.left > 0) {
      this.follow.t -= dt;
      const moving = Math.hypot(p.vx, p.vz) > 0.4;
      if (this.follow.t <= 0) {
        this.follow.t = 0.55 + Math.random() * 0.1;
        if (!moving) this.follow.left = Math.min(this.follow.left, 2);
        const b = this.steps[this.follow.left % this.steps.length];
        if (b) this.audio.play3D(b, this.follow.x, 0.05, this.follow.z, { gain: 0.55, occlusion: 0.45, ref: 2, wet: 0.5, rate: 0.9 });
        this.follow.left--;
      }
    }
    // дихання: після бігу й коли видихся
    this.breathT -= dt;
    if (this.breathT <= 0 && (p.exhausted || (p.running && p.stamina < 0.5))) {
      this.breathT = p.exhausted ? 1.0 : 1.3;
      const b = this.breaths[Math.floor(Math.random() * this.breaths.length)];
      if (b) this.audio.play2D(b, p.exhausted ? 0.55 : 0.3);
    }
  }
}
