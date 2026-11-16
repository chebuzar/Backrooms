// Ігровий інтерфейс: «REC» відеокамери з лічильником плівки, підказка дії, поточне завдання, субтитри,
// читання документів і записок, пролог (машинопис на чорному), фінальна картка рівня.
import type { Doc } from '../story/ru';

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
      <div class="osd"><span class="rec"><i></i>REC</span><span class="tc">0:00:00</span><span class="sp">SP</span><span class="bat" hidden><b></b><b></b><b></b><b></b></span></div>
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

  /** Батарея ліхтарика в рамці камери: 4 поділки; −1 — сховати. */
  setBattery(v: number): void {
    const b = this.el.querySelector<HTMLElement>('.bat');
    if (!b) return;
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

  /** Пролог: рядки друкуються по одному. Будь-яке натискання прискорює, повторне — пропускає. */
  prologue(lines: string[], onType: () => void): Promise<void> {
    return new Promise((done) => {
      const el = document.createElement('div');
      el.className = 'prologue';
      el.innerHTML = '<div class="pl-text"></div><p class="pl-skip">Нажмите, чтобы пропустить</p>';
      this.el.parentElement?.appendChild(el);
      requestAnimationFrame(() => el.classList.add('shown'));
      const box = el.querySelector('.pl-text') as HTMLElement;
      let li = 0, ci = 0, fast = false, finished = false, timer = 0;
      const finish = () => {
        if (finished) return;
        finished = true; clearTimeout(timer);
        el.classList.remove('shown');
        setTimeout(() => { el.remove(); done(); }, 900);
      };
      const tick = () => {
        if (li >= lines.length) { timer = window.setTimeout(finish, 1800); return; }
        const line = lines[li] as string;
        if (ci === 0) { const p = document.createElement('p'); box.appendChild(p); }
        const p = box.lastElementChild as HTMLElement;
        p.textContent = line.slice(0, ++ci);
        if (line[ci - 1] !== ' ') onType();
        if (ci >= line.length) {
          li++; ci = 0;
          if (box.children.length > 4) box.firstElementChild?.classList.add('gone');
          timer = window.setTimeout(tick, fast ? 250 : 1100);
        } else timer = window.setTimeout(tick, fast ? 12 : 38 + Math.random() * 40);
      };
      const skip = () => { if (!fast) fast = true; else finish(); };
      el.addEventListener('pointerdown', skip);
      addEventListener('keydown', function k(e) { if (finished) { removeEventListener('keydown', k); return; } if (e.key !== 'Tab') skip(); });
      timer = window.setTimeout(tick, 900);
    });
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
