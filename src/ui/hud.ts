// Ігровий інтерфейс: «REC» відеокамери з лічильником плівки, підказка дії, поточне завдання, субтитри,
// читання документів і записок, пролог (машинопис на чорному), фінальна картка рівня.
import type { Doc } from '../story/ru';
import { prologueTimeline } from './prologue-time';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);

export class HUD {
  private readonly el: HTMLElement;
  private readonly rec: HTMLElement;
  private readonly tc: HTMLElement;
  private readonly prompt: HTMLElement;
  private readonly obj: HTMLElement;
  private readonly sub: HTMLElement;
  private readonly dot: HTMLElement;
  private reader: HTMLElement | null = null;
  private onReaderClose: (() => void) | null = null;
  private objText = '';
  private subTimer = 0;

  constructor(root: HTMLElement) {
    const el = document.createElement('div');
    el.className = 'hud';
    el.innerHTML = `
      <div class="osd"><span class="rec"><i></i>REC</span><span class="tc">0:00:00</span><span class="sp">SP</span><span class="bat" hidden><b></b><b></b><b></b><b></b></span><span class="zoom"></span></div>
      <div class="slits" aria-hidden="true"></div>
      <div class="tutorial" aria-live="polite"></div>
      <div class="dosi" aria-hidden="true"><svg viewBox="0 0 120 78">
        <rect x="1" y="1" width="118" height="76" rx="7" class="case"/>
        <path d="M18 62 A44 44 0 0 1 102 62" class="arc"/>
        ${[0, 1, 2, 3, 4, 5].map((k) => { const a = (-60 + k * 24) * Math.PI / 180; const x1 = 60 + Math.sin(a) * 44, y1 = 66 - Math.cos(a) * 44, x2 = 60 + Math.sin(a) * 37, y2 = 66 - Math.cos(a) * 37;
          return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" class="tick"/><text x="${(60 + Math.sin(a) * 30).toFixed(1)}" y="${(69 - Math.cos(a) * 30).toFixed(1)}" class="num">${k}</text>`; }).join('')}
        <path d="M74 62 A44 44 0 0 1 102 62" class="red"/>
        <line x1="60" y1="66" x2="60" y2="24" class="needle"/><circle cx="60" cy="66" r="4" class="hub"/>
        <text x="8" y="14" class="lbl">ДП-5В</text><text x="112" y="14" class="lbl" text-anchor="end">мР/ч ×1</text>
      </svg></div>
      <div class="obj" aria-live="polite"></div>
      <div class="dot"></div>
      <div class="prompt"></div>
      <div class="subs" aria-live="polite"></div>`;
    root.appendChild(el);
    this.el = el;
    this.rec = el.querySelector('.rec') as HTMLElement;
    this.tc = el.querySelector('.tc') as HTMLElement;
    this.prompt = el.querySelector('.prompt') as HTMLElement;
    this.obj = el.querySelector('.obj') as HTMLElement;
    this.sub = el.querySelector('.subs') as HTMLElement;
    this.dot = el.querySelector('.dot') as HTMLElement;
  }

  show(on: boolean): void { this.el.classList.toggle('shown', on); }

  /** Зум камери: напис «ZOOM 2×» у рамці відеокамери. */
  setZoom(on: boolean, label: string): void {
    const z = this.el.querySelector('.zoom') as HTMLElement;
    z.textContent = label;
    z.classList.toggle('on', on);
  }

  /** У шафці: темрява з горизонтальними щілинами жалюзі, крізь які видно кімнату. */
  setHidden(on: boolean): void {
    (this.el.querySelector('.slits') as HTMLElement).classList.toggle('on', on);
  }

  /** Дозиметр ДП-5: показ шкали (null — сховати), стрілка 0..1. */
  setDosimeter(v: number | null): void {
    const el = this.el.querySelector('.dosi') as HTMLElement;
    el.classList.toggle('on', v !== null);
    if (v === null) return;
    const jitter = (Math.random() - 0.5) * 0.04 * Math.min(1, v * 4);
    (el.querySelector('.needle') as SVGElement).setAttribute('transform', `rotate(${(-60 + Math.max(0, Math.min(1, v + jitter)) * 120).toFixed(1)} 60 66)`);
  }

  /** Підказка навчання внизу екрана: клавіша (або іконка кнопки) + дія; null — сховати. */
  setTutorial(t: { key?: string; icon?: string; text: string } | null): void {
    const el = this.el.querySelector('.tutorial') as HTMLElement;
    if (!t) { el.classList.remove('on'); return; }
    el.innerHTML = `${t.icon ? `<span class="ti">${t.icon}</span>` : `<kbd>${esc(t.key ?? '')}</kbd>`}<span>${esc(t.text)}</span>`;
    el.classList.remove('on'); void el.offsetWidth; el.classList.add('on');
  }

  private batHold = 0;
  /** Підібрав батарейки: індикатор заряду видно ще кілька секунд. */
  flashBattery(v: number): void { this.batHold = 3; this.setBattery(v); }

  /** Батарея ліхтарика в рамці камери: 4 поділки; −1 — сховати (якщо щойно не підбирав батарейки). */
  setBattery(v: number, actual = v): void {
    const b = this.el.querySelector<HTMLElement>('.bat');
    if (!b) return;
    if (v < 0 && this.batHold > 0) v = actual;
    b.hidden = v < 0;
    if (v < 0) return;
    const n = Math.ceil(v * 4);
    b.querySelectorAll('b').forEach((x, i) => x.classList.toggle('on', i < n));
    b.classList.toggle('low', v < 0.15);
  }

  /** Лічильник плівки: години:хвилини:секунди запису. */
  setTime(sec: number): void {
    const s = Math.floor(sec), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    this.tc.textContent = `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}`;
    this.rec.classList.toggle('blink', Math.floor(sec * 1.2) % 2 === 0);
  }

  setPrompt(text: string | null, key: string): void {
    this.prompt.classList.toggle('on', !!text);
    this.dot.classList.toggle('on', !!text);
    if (text) this.prompt.innerHTML = `<kbd>${esc(key)}</kbd>${esc(text)}`;
  }

  setObjective(text: string): void {
    if (text === this.objText) return;
    this.objText = text;
    this.obj.classList.remove('on');
    void this.obj.offsetWidth; // перезапустити анімацію «дописування олівцем»
    this.obj.textContent = text;
    this.obj.classList.add('on');
  }

  subtitle(text: string, seconds = 4): void {
    this.sub.textContent = text;
    this.sub.classList.add('on');
    this.subTimer = seconds;
  }

  update(dt: number): void {
    this.batHold = Math.max(0, this.batHold - dt);
    if (this.subTimer > 0 && (this.subTimer -= dt) <= 0) this.sub.classList.remove('on');
  }

  get readerOpen(): boolean { return !!this.reader; }

  openDoc(d: Doc, onClose: () => void): void {
    if (this.reader) { this.reader.remove(); this.reader = null; this.onReaderClose = null; }
    const r = document.createElement('div');
    r.className = `reader ${d.kind}`;
    r.innerHTML = `<article class="sheet">
      <header><h2>${esc(d.title)}</h2><p class="meta">${esc(d.meta)}</p></header>
      <div class="body">${d.body.split('\n').map((l) => `<p>${esc(l)}</p>`).join('')}</div>
      ${d.sign ? `<p class="sign">${esc(d.sign)}</p>` : ''}
      <button class="line-btn close">Закрыть</button></article>`;
    this.el.parentElement?.appendChild(r);
    this.reader = r;
    requestAnimationFrame(() => r.classList.add('shown'));
    this.onReaderClose = onClose;
    const close = () => this.closeDoc();
    r.querySelector('.close')?.addEventListener('click', close);
    r.addEventListener('click', (e) => { if (e.target === r) close(); });
    (r.querySelector('.close') as HTMLElement).focus({ preventScroll: true });
  }

  closeDoc(): void {
    const r = this.reader;
    if (!r) return;
    this.reader = null;
    r.classList.remove('shown');
    setTimeout(() => r.remove(), 300);
    const cb = this.onReaderClose;
    this.onReaderClose = null;
    cb?.();
  }

  /**
   * Пролог: рядки друкуються по одному за розкладом від реального часу (prologue-time.ts) — ~45–50 с.
   * Будь-яке натискання прискорює (×6), повторне — пропускає.
   */
  prologue(lines: string[], onType: () => void): Promise<void> {
    return new Promise((done) => {
      const el = document.createElement('div');
      el.className = 'prologue';
      el.innerHTML = '<div class="pl-text"></div><p class="pl-skip">Нажмите, чтобы пропустить</p>';
      this.el.parentElement?.appendChild(el);
      requestAnimationFrame(() => el.classList.add('shown'));
      const box = el.querySelector('.pl-text') as HTMLElement;
      const plan = prologueTimeline(lines);
      const ps: HTMLElement[] = [];
      let t = 0, last = performance.now(), speed = 1, finished = false, raf = 0;
      const finish = () => {
        if (finished) return;
        finished = true; cancelAnimationFrame(raf);
        removeEventListener('keydown', onKey);
        el.classList.remove('shown');
        setTimeout(() => { el.remove(); done(); }, 900);
      };
      const tick = () => {
        const now = performance.now();
        t += Math.min(2, (now - last) / 1000) * speed; // реальний час: повільні кадри під час завантаження не розтягують пролог
        last = now;
        let typed = false;
        plan.lines.forEach((l, i) => {
          if (t < l.start) return;
          const line = lines[i] as string;
          let p = ps[i];
          if (!p) {
            p = document.createElement('p'); box.appendChild(p); ps[i] = p;
            if (ps.length > 5) ps[ps.length - 6]?.classList.add('gone');
          }
          const n = Math.min(line.length, Math.floor((t - l.start) / ((l.typeEnd - l.start) / Math.max(1, line.length))) + 1);
          if (p.textContent?.length !== n) { p.textContent = line.slice(0, n); if (line[n - 1] !== ' ') typed = true; }
        });
        if (typed) onType();
        if (t >= plan.total - 0.9) { finish(); return; }
        raf = requestAnimationFrame(tick);
      };
      const skip = () => { if (speed === 1) speed = 6; else finish(); };
      const onKey = (e: KeyboardEvent) => { if (e.key !== 'Tab') skip(); };
      el.addEventListener('pointerdown', skip);
      addEventListener('keydown', onKey);
      raf = requestAnimationFrame(tick);
    });
  }

  /** Заставка переходу: чорний екран, назва рівня друкується; work() виконується під нею (завантаження). */
  async titleCard(title: string, sub: string, work: () => Promise<void>): Promise<void> {
    const el = document.createElement('div');
    el.className = 'prologue title-card';
    el.innerHTML = `<div class="tc"><p class="tc-t">${esc(title)}</p><p class="tc-s">${esc(sub)}</p></div>`;
    this.el.parentElement?.appendChild(el);
    requestAnimationFrame(() => el.classList.add('shown'));
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    await Promise.all([work(), wait(3200)]);
    el.classList.remove('shown');
    await wait(900);
    el.remove();
  }

  /** Кінець рівня: картка поверх затемнення. */
  levelEnd(title: string, body: string, note: string, onDone: () => void): void {
    const el = document.createElement('div');
    el.className = 'reader doc end';
    el.innerHTML = `<article class="sheet"><header><h2>${esc(title)}</h2></header>
      <div class="body">${body.split('\n').map((l) => `<p>${esc(l)}</p>`).join('')}</div>
      <p class="sign">${esc(note)}</p><button class="line-btn close">В меню</button></article>`;
    this.el.parentElement?.appendChild(el);
    requestAnimationFrame(() => el.classList.add('shown'));
    el.querySelector('.close')?.addEventListener('click', () => { el.remove(); onDone(); });
    (el.querySelector('.close') as HTMLElement).focus({ preventScroll: true });
  }
}
