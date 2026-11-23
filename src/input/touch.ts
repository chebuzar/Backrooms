// Сенсорне керування (iPad/iPhone, горизонтально): ліва половина — «плаваючий» стік руху,
// права — огляд пальцем (стік до краю — біг); праворуч чотири кнопки: дія, ліхтарик, присід, камера; вгорі дрібні: годинник, блокнот, ДП-5, пауза.
import type { Input } from './input';

/** Значки кнопок: тонкі лінійні позначки, як гравіювання на радянському приладі (без «веселих» фігурок і емодзі).
 *  Лінії малює <g> у svg(); суцільні частини — з fill="currentColor". */
export const ICONS = {
  // бег: подвійний шеврон уперед
  run: '<path d="M6 13.5 12 7.5l6 6M6 19l6-6 6 6"/>',
  // присесть: шеврон униз над рискою підлоги
  crouch: '<path d="M6 6.5l6 6 6-6M4.5 18.5h15"/>',
  // действие: кнопка-контакт — кільце з точкою
  use: '<circle cx="12" cy="12" r="7.6"/><circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none"/>',
  // фонарик: корпус з відбивачем і кнопкою
  light: '<path d="M6.5 3.5h11L15 9.5v11H9v-11Z"/><path d="M9 9.5h6M12 12.5v2.5"/>',
  // камера: корпус, об'єктив і точка запису
  camera: '<path d="M3 7.5h11.5v9H3Z"/><path d="M14.5 10.6 20.5 7.5v9l-6-3.1"/><circle cx="6" cy="10.2" r="1.1" fill="currentColor" stroke="none"/>',
  pause: '<path d="M9 5.5v13M15 5.5v13" stroke-width="2.2"/>',
  // блокнот: обкладинка з пружиною
  book: '<path d="M6.5 3.5h12v17h-12Z"/><path d="M4.5 7h3M4.5 12h3M4.5 17h3M10 8h6M10 11h4"/>',
  // годинник на руці: корпус і ремінець
  watch: '<path d="M8.5 2.5h7l1 4h-9ZM8.5 21.5h7l1-4h-9Z"/><rect x="6.5" y="6.5" width="11" height="11" rx="1.5"/><path d="M12 9.5V12l2 1.5"/>',
  // знак радіації: дозиметр ДП-5
  dosi: '<path fill="currentColor" stroke="none" d="M12 10.3a1.7 1.7 0 1 1 0 3.4 1.7 1.7 0 0 1 0-3.4Zm-1.6-1.1L7.6 4.4A8.6 8.6 0 0 0 3.4 12h5.5a3.1 3.1 0 0 1 1.5-2.8Zm3.2 0A3.1 3.1 0 0 1 15.1 12h5.5a8.6 8.6 0 0 0-4.2-7.6Zm1.5 4.2L12 18.2l-3.1-4.8-2.8 4.8a8.6 8.6 0 0 0 11.8 0Z"/>',
  // для екрана «Управление»: стік (ліва половина) і огляд (права)
  stick: '<circle cx="12" cy="12" r="8.5"/><path d="M12 12l3.2-3.2"/><circle cx="15.8" cy="8.2" r="2.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/>',
  look: '<path d="M3.5 12h17M6.5 9l-3 3 3 3M17.5 9l3 3-3 3M12 6.5v11"/>'
};

/** Підписи під значками кнопок (машинопис, як таблички на пульті). */
const CAPS = { use: 'ДЕЙСТВ.', light: 'СВЕТ', run: 'БЕГ', crouch: 'ПРИСЕСТЬ', camera: 'КАМЕРА', dosimeter: 'ДП-5', zoom: '×2' } as const;

/** Елементи інтерфейсу, яким дотик має дістатися як звичайне натискання/прокрутка. */
const UI_SELECTOR = '.reader, .screen, .prologue, .loadline, button, a, input, select, label';
const onUI = (t: EventTarget | null) => t instanceof Element && !!t.closest(UI_SELECTOR);

export const svg = (p: string) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="square" stroke-linejoin="miter">${p}</g></svg>`;
const cap = (a: keyof typeof CAPS) => `<b class="cap">${CAPS[a]}</b>`;

export class TouchControls {
  active = false;
  stickX = 0;
  stickY = 0;
  run = false;
  /** Палець відтягнуто далеко за кільце стіка вперед — біг. */
  edgeRun = false;
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
        <button class="tb tb-use" data-a="use" aria-label="Действие">${svg(ICONS.use)}${cap('use')}</button>
        <button class="tb tb-light" data-a="light" aria-label="Фонарик">${svg(ICONS.light)}${cap('light')}</button>
        <button class="tb tb-crouch" data-a="crouch" aria-label="Присесть">${svg(ICONS.crouch)}${cap('crouch')}</button>
        <button class="tb tb-cam" data-a="camera" aria-label="Камера">${svg(ICONS.camera)}${cap('camera')}</button>
        <button class="tb tb-zoom" data-a="zoom" aria-label="Приближение">${cap('zoom')}</button>
      </div>
      <div class="ttop">
        <button class="tb tb-watch" data-a="watch" aria-label="Часы">${svg(ICONS.watch)}</button>
        <button class="tb tb-book" data-a="journal" aria-label="Блокнот">${svg(ICONS.book)}</button>
        <button class="tb tb-dosi" data-a="dosimeter" aria-label="Дозиметр">${svg(ICONS.dosi)}</button>
        <button class="tb tb-pause" data-a="pause" aria-label="Пауза">${svg(ICONS.pause)}</button>
      </div>`;
    uiRoot.appendChild(r);
    this.root = r;
    this.base = r.querySelector('.stick') as HTMLDivElement;
    this.knob = r.querySelector('.knob') as HTMLDivElement;

    const btn = (sel: string) => r.querySelector(sel) as HTMLButtonElement;
    const tap = (b: HTMLButtonElement, fn: () => void) => b.addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); fn(); b.classList.add('on'); setTimeout(() => b.classList.remove('on'), 140); }, { passive: false });
    tap(btn('.tb-crouch'), () => { this.crouch = !this.crouch; btn('.tb-crouch').classList.toggle('latched', this.crouch); });
    tap(btn('.tb-use'), () => this.input.press('interact'));
    tap(btn('.tb-light'), () => this.input.press('flashlight'));
    tap(btn('.tb-cam'), () => this.input.press('camera'));
    tap(btn('.tb-dosi'), () => this.input.press('dosimeter'));
    tap(btn('.tb-zoom'), () => this.input.press('zoom'));
    tap(btn('.tb-watch'), () => this.input.press('watch'));
    tap(btn('.tb-book'), () => this.input.press('journal'));
    tap(btn('.tb-pause'), () => this.input.press('pause'));

    const opts = { passive: false } as AddEventListenerOptions;
    addEventListener('touchstart', (e) => this.onStart(e), opts);
    addEventListener('touchmove', (e) => this.onMove(e), opts);
    addEventListener('touchend', (e) => this.onEnd(e), opts);
    addEventListener('touchcancel', (e) => this.onEnd(e), opts);
  }

  /** Підсвітити кнопку-перемикач (ліхтарик, дозиметр). */
  setLatched(name: string, on: boolean): void { this.root.querySelector(`.tb-${name}`)?.classList.toggle('latched', on); }

  /** Камера піднята: з'являється кнопка «×2». */
  setCamera(on: boolean): void { this.root.classList.toggle('cam', on); this.setLatched('cam', on); }

  /** Показати/сховати кнопки (у меню вони не потрібні). */
  show(on: boolean): void { this.root.classList.toggle('shown', on); }

  private onStart(e: TouchEvent): void {
    this.active = true;
    // будь-який дотик — гравець на сенсорному екрані: підказки показують кнопку, а не клавішу «E»
    this.input.lastDevice = 'touch';
    if (!this.root.classList.contains('shown')) return;
    // дотик по інтерфейсу (записка, меню, кнопки) не наш: інакше preventDefault «з'їдає» натискання «Закрыть»
    if (onUI(e.target)) return;
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
        // біг — лише свідомо: палець далеко за кільцем стіка і вперед (з запасом, щоб не «перемикалось» туди-сюди).
        // Раніше вистачало дотягнути стік до краю — на iPad гравець бігав щоразу, коли просто йшов уперед.
        const fwd = d > 0 && -dy / d > 0.8;
        this.edgeRun = fwd && (this.edgeRun ? d > R * 1.25 : d > R * 1.55);
        const m = Math.min(1, d / R);
        const curve = m < 0.12 ? 0 : (m - 0.12) / 0.88;
        this.stickX = d ? (dx / Math.min(d, R)) * curve : 0;
        this.stickY = d ? (-dy / Math.min(d, R)) * curve : 0;
      } else if (t.identifier === this.lookId) {
        const k = 0.0042 * this.input.settings.sensitivity;
        this.input.touchLookX += (t.clientX - this.lx) * k;
        this.input.touchLookY += (t.clientY - this.ly) * k * (this.input.settings.invertY ? -1 : 1);
        this.lx = t.clientX; this.ly = t.clientY;
      }
    }
    // гасимо прокрутку/масштаб лише для пальців стіка й огляду — записка має прокручуватися
    if (this.stickId !== null || this.lookId !== null) e.preventDefault();
  }

  private onEnd(e: TouchEvent): void {
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier === this.stickId) {
        this.stickId = null; this.stickX = this.stickY = 0; this.edgeRun = false;
        this.base.classList.remove('on');
      } else if (t.identifier === this.lookId) this.lookId = null;
    }
  }
}
