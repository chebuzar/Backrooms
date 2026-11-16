// Сенсорне керування (iPad/iPhone, горизонтально): ліва половина — «плаваючий» стік руху,
// права — огляд пальцем; кнопки праворуч: біг (утримання), присід, дія, ліхтарик, камера; пауза вгорі.
import type { Input } from './input';

const ICONS = {
  run: '<path d="M13.5 5.5a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6ZM9.8 8.9 7 22h2.1l1.8-8 2.1 2v6h2v-7.5l-2.1-2.1.6-3A7.3 7.3 0 0 0 19 12v-2a5.5 5.5 0 0 1-4.7-2.6l-1-1.6A2.1 2.1 0 0 0 11.5 5c-.3 0-.5 0-.8.1L5 7.4V12h2V8.7l2.8-1.1Z"/>',
  crouch: '<path d="M12 5.2a1.9 1.9 0 1 0 0-3.8 1.9 1.9 0 0 0 0 3.8ZM6 21h2.2l1.4-5H13l1.6 5h2.2l-2-6.4a2 2 0 0 0-1.9-1.4h-1.6l.9-3.1 1.6 1.5H17v-2h-2.2l-2.7-2.6A2 2 0 0 0 8.9 8l-1.7 5.7a2 2 0 0 0 .4 1.8Z"/>',
  use: '<path d="M9 11.2V5.5a1.5 1.5 0 1 1 3 0V11l5 1.1a2 2 0 0 1 1.6 2.2l-.6 5A2 2 0 0 1 16 21h-5.3a2 2 0 0 1-1.6-.8l-3.5-4.5 1.4-1.4L9 15.3Z"/>',
  light: '<path d="M7 2h10v4l-2 4v11a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1V10L7 6Zm4 11v3h2v-3Z"/>',
  camera: '<path d="M4 6h11a2 2 0 0 1 2 2v1.6l4-2.6v10l-4-2.6V16a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z"/>',
  pause: '<path d="M7 5h3.5v14H7zm6.5 0H17v14h-3.5z"/>'
};

const svg = (p: string) => `<svg viewBox="0 0 24 24" aria-hidden="true">${p}</svg>`;

export class TouchControls {
  active = false;
  stickX = 0;
  stickY = 0;
  run = false;
  crouch = false;
  private readonly root: HTMLDivElement;
  private stickId: number | null = null;
  private lookId: number | null = null;
  private sx = 0;
  private sy = 0;
  private lx = 0;
  private ly = 0;
  private readonly base: HTMLDivElement;
  private readonly knob: HTMLDivElement;

  constructor(uiRoot: HTMLElement, private readonly input: Input) {
    const r = document.createElement('div');
    r.className = 'touch';
    r.innerHTML = `
      <div class="stick"><div class="knob"></div></div>
      <div class="tbtns">
        <button class="tb tb-use" data-a="use" aria-label="Действие">${svg(ICONS.use)}</button>
        <button class="tb tb-light" data-a="light" aria-label="Фонарик">${svg(ICONS.light)}</button>
        <button class="tb tb-run" data-a="run" aria-label="Бег">${svg(ICONS.run)}</button>
        <button class="tb tb-crouch" data-a="crouch" aria-label="Присесть">${svg(ICONS.crouch)}</button>
        <button class="tb tb-cam" data-a="camera" aria-label="Камера">${svg(ICONS.camera)}</button>
      </div>
      <button class="tb tb-pause" data-a="pause" aria-label="Пауза">${svg(ICONS.pause)}</button>`;
    uiRoot.appendChild(r);
    this.root = r;
    this.base = r.querySelector('.stick') as HTMLDivElement;
    this.knob = r.querySelector('.knob') as HTMLDivElement;

    const btn = (sel: string) => r.querySelector(sel) as HTMLButtonElement;
    const hold = (b: HTMLButtonElement, on: (v: boolean) => void) => {
      b.addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); on(true); b.classList.add('on'); }, { passive: false });
      const off = (e: Event) => { e.preventDefault(); on(false); b.classList.remove('on'); };
      b.addEventListener('touchend', off, { passive: false });
      b.addEventListener('touchcancel', off, { passive: false });
    };
    const tap = (b: HTMLButtonElement, fn: () => void) => b.addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); fn(); b.classList.add('on'); setTimeout(() => b.classList.remove('on'), 140); }, { passive: false });
    hold(btn('.tb-run'), (v) => { this.run = v; });
    tap(btn('.tb-crouch'), () => { this.crouch = !this.crouch; btn('.tb-crouch').classList.toggle('latched', this.crouch); });
    tap(btn('.tb-use'), () => this.input.press('interact'));
    tap(btn('.tb-light'), () => this.input.press('flashlight'));
    tap(btn('.tb-cam'), () => this.input.press('camera'));
    tap(btn('.tb-pause'), () => this.input.press('pause'));

    const opts = { passive: false } as AddEventListenerOptions;
    addEventListener('touchstart', (e) => this.onStart(e), opts);
    addEventListener('touchmove', (e) => this.onMove(e), opts);
    addEventListener('touchend', (e) => this.onEnd(e), opts);
    addEventListener('touchcancel', (e) => this.onEnd(e), opts);
  }

  /** Показати/сховати кнопки (у меню вони не потрібні). */
  show(on: boolean): void { this.root.classList.toggle('shown', on); }

  private onStart(e: TouchEvent): void {
    this.active = true;
    if (!this.root.classList.contains('shown')) return;
    for (const t of Array.from(e.changedTouches)) {
      if (t.clientX < innerWidth * 0.42 && this.stickId === null) {
        this.stickId = t.identifier; this.sx = t.clientX; this.sy = t.clientY;
        this.base.style.transform = `translate(${t.clientX}px, ${t.clientY}px)`;
        this.base.classList.add('on');
        this.knob.style.transform = 'translate(0px, 0px)';
      } else if (this.lookId === null) {
        this.lookId = t.identifier; this.lx = t.clientX; this.ly = t.clientY;
      }
    }
    e.preventDefault();
  }

  private onMove(e: TouchEvent): void {
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier === this.stickId) {
        const R = 56;
        let dx = t.clientX - this.sx, dy = t.clientY - this.sy;
        const d = Math.hypot(dx, dy);
        if (d > R) { dx *= R / d; dy *= R / d; }
        this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
        const m = Math.min(1, d / R);
        const curve = m < 0.12 ? 0 : (m - 0.12) / 0.88;
        this.stickX = d ? (dx / Math.min(d, R)) * curve : 0;
        this.stickY = d ? (-dy / Math.min(d, R)) * curve : 0;
      } else if (t.identifier === this.lookId) {
        const k = 0.0042 * this.input.settings.sensitivity;
        this.input.lookX += (t.clientX - this.lx) * k;
        this.input.lookY += (t.clientY - this.ly) * k * (this.input.settings.invertY ? -1 : 1);
        this.lx = t.clientX; this.ly = t.clientY;
      }
    }
    e.preventDefault();
  }

  private onEnd(e: TouchEvent): void {
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier === this.stickId) {
        this.stickId = null; this.stickX = this.stickY = 0;
        this.base.classList.remove('on');
      } else if (t.identifier === this.lookId) this.lookId = null;
    }
  }
}
