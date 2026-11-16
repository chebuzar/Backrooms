// Екрани інтерфейсу: «18+», головне меню (бланк справи), налаштування, «Об игре», пауза.
// Звичайні <button> і <input>: працюють мишею, дотиком, клавіатурою (стрілки/Enter/Esc) і геймпадом.
import { T } from '../i18n/ru';
import type { Settings } from '../core/save';

type Handler = () => void;

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);

export class UI {
  private readonly root: HTMLElement;
  private readonly screens = new Map<string, HTMLElement>();
  private stack: string[] = [];
  onBack: (() => void) | null = null;

  constructor(root: HTMLElement) {
    this.root = root;
    // фільтр «гумового штампа»: нерівний край і пропуски фарби
    root.insertAdjacentHTML('beforeend', `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><filter id="grunge">
      <feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="7" result="n"/>
      <feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -2.4 1.75" result="m"/>
      <feComposite in="SourceGraphic" in2="m" operator="in" result="c"/>
      <feTurbulence type="fractalNoise" baseFrequency=".04" numOctaves="2" seed="3" result="w"/>
      <feDisplacementMap in="c" in2="w" scale="2.2"/></filter></svg>`);
    addEventListener('keydown', (e) => this.onKey(e));
  }

  get top(): string | null { return this.stack[this.stack.length - 1] ?? null; }
  get open(): boolean { return this.stack.length > 0; }

  private make(name: string, cls: string, html: string): HTMLElement {
    this.screens.get(name)?.remove();
    const el = document.createElement('section');
    el.className = `screen ${cls}`;
    el.innerHTML = html;
    el.setAttribute('role', 'dialog');
    this.root.appendChild(el);
    this.screens.set(name, el);
    requestAnimationFrame(() => el.classList.add('shown'));
    this.stack = this.stack.filter((s) => s !== name);
    this.stack.push(name);
    return el;
  }

  close(name: string): void {
    const el = this.screens.get(name);
    if (!el) return;
    el.classList.remove('shown');
    setTimeout(() => el.remove(), 450);
    this.screens.delete(name);
    this.stack = this.stack.filter((s) => s !== name);
    this.focusFirst();
  }

  closeAll(): void { for (const n of [...this.stack]) this.close(n); }

  private focusFirst(): void {
    const top = this.top ? this.screens.get(this.top) : null;
    const f = top?.querySelector<HTMLElement>('[autofocus], button:not([disabled]), input');
    f?.focus({ preventScroll: true });
  }

  private bind(el: HTMLElement, map: Record<string, Handler>): void {
    for (const [sel, fn] of Object.entries(map)) el.querySelector(sel)?.addEventListener('click', fn);
  }

  /** Попередження 18+: щоразу на старті. Перший раз — підтвердження віку. */
  age(confirmedBefore: boolean): Promise<void> {
    return new Promise((done) => {
      const a = T.age;
      const el = this.make('age', 'age', `<div class="age-inner">
        <div class="stamp-big" aria-label="18+">${a.stamp}</div>
        <h1>${a.title}</h1>
        <p class="typed">${a.body}</p>
        <p class="typed hint">${a.hint}</p>
        <div class="act"><button class="line-btn sel" data-go autofocus style="color:#efe9d9">${confirmedBefore ? a.again : a.confirm}</button></div>
      </div>`);
      const go = el.querySelector('[data-go]') as HTMLButtonElement;
      (go.style as CSSStyleDeclaration).setProperty('--ink', '#efe9d9');
      go.addEventListener('click', () => { this.close('age'); done(); });
      setTimeout(() => this.focusFirst(), 50);
    });
  }

  menu(o: { canContinue: boolean; onContinue: Handler; onStart: Handler; onSettings: Handler; onAbout: Handler }): void {
    const m = T.menu;
    const el = this.make('menu', 'dossier-wrap', `<div class="dossier" aria-label="${m.title}">
      <div class="head"><div>${m.object}<br>${m.caseNo}</div><div class="stamp">${m.secret}</div></div>
      <h1>${m.title}</h1>
      <p class="sub">${m.subtitle}</p>
      <nav class="menu">
        ${o.canContinue ? `<button class="line-btn" data-c autofocus>${m.cont}</button>` : ''}
        <button class="line-btn" data-s ${o.canContinue ? '' : 'autofocus'}>${o.canContinue ? m.restart : m.start}</button>
        <button class="line-btn minor" data-o>${m.settings}</button>
        <button class="line-btn minor" data-a>${m.about}</button>
      </nav>
      <div class="foot"><span>Арх. № 4-Б/87-07</span><span class="pencil">${m.note}</span></div>
    </div>`);
    this.bind(el, { '[data-c]': o.onContinue, '[data-s]': o.onStart, '[data-o]': o.onSettings, '[data-a]': o.onAbout });
    setTimeout(() => this.focusFirst(), 60);
  }

  settings(s: Settings, deviceLine: string, onChange: (s: Settings) => void, onDone: Handler): void {
    const t = T.settings;
    const seg = (key: keyof Settings, opts: [string, string][]) => `<div class="seg" data-key="${key}">${opts
      .map(([v, l]) => `<button type="button" data-v="${v}" aria-pressed="${String(s[key]) === v}">${l}</button>`).join('')}</div>`;
    const onOff = (key: keyof Settings) => seg(key, [['true', t.on], ['false', t.off]]);
    const range = (key: keyof Settings, min: number, max: number, step: number) =>
      `<input class="pencil-range" type="range" data-key="${key}" min="${min}" max="${max}" step="${step}" value="${s[key] as number}">`;
    const el = this.make('settings', 'dossier-wrap', `<div class="dossier wide" aria-label="${t.title}">
      <div class="head"><div>${T.menu.object}<br>${t.title}</div><div class="pencil">заполнить разборчиво</div></div>
      <div class="form">
        <h2>${t.sections.video}</h2>
        <label>${t.quality}</label>${seg('quality', (['auto', 'low', 'medium', 'high', 'ultra'] as const).map((q) => [q, t.qualities[q]]))}
        <label>${t.brightness}</label>${range('brightness', 0.6, 1.6, 0.05)}
        <label>${t.fov}</label>${range('fov', 60, 90, 1)}
        <label>${t.fpsLimit}</label>${seg('fpsLimit', (['30', '60', 'off'] as const).map((v) => [v, t.fpsOpts[v]]))}
        <h2>${t.sections.audio}</h2>
        <label>${t.master}</label>${range('masterVolume', 0, 1, 0.05)}
        <label>${t.music}</label>${range('musicVolume', 0, 1, 0.05)}
        <label>${t.sfx}</label>${range('sfxVolume', 0, 1, 0.05)}
        <label>${t.subtitles}</label>${onOff('subtitles')}
        <h2>${t.sections.controls}</h2>
        <label>${t.sensitivity}</label>${range('sensitivity', 0.2, 3, 0.05)}
        <label>${t.invertY}</label>${onOff('invertY')}
        <label>${t.crouchToggle}</label>${onOff('crouchToggle')}
      </div>
      <p class="dev-line">${esc(deviceLine)}</p>
      <nav class="menu" style="margin-top:1em"><button class="line-btn" data-done>${t.back}</button></nav>
    </div>`);
    el.querySelectorAll<HTMLElement>('.seg').forEach((g) => g.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button'); if (!b) return;
      const key = g.dataset.key as keyof Settings, v = b.dataset.v as string;
      (s as unknown as Record<string, unknown>)[key] = v === 'true' ? true : v === 'false' ? false : v;
      g.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      onChange(s);
    }));
    el.querySelectorAll<HTMLInputElement>('input[type=range]').forEach((r) => r.addEventListener('input', () => {
      (s as unknown as Record<string, unknown>)[r.dataset.key as string] = Number(r.value);
      onChange(s);
    }));
    this.bind(el, { '[data-done]': () => { this.close('settings'); onDone(); } });
    setTimeout(() => this.focusFirst(), 60);
  }

  about(onDone: Handler): void {
    const a = T.about;
    const el = this.make('about', 'dossier-wrap', `<div class="dossier">
      <div class="head"><div>${T.menu.object}</div><div class="stamp">${T.menu.secret}</div></div>
      <h1 style="font-size:calc(var(--u)*1.5)">${a.title}</h1>
      <p class="sub" style="max-width:44ch">${a.body}</p>
      <nav class="menu"><a class="line-btn minor" href="assets/CREDITS.md" target="_blank" rel="noopener">${a.credits}</a>
      <button class="line-btn" data-b autofocus>${a.back}</button></nav></div>`);
    this.bind(el, { '[data-b]': () => { this.close('about'); onDone(); } });
    setTimeout(() => this.focusFirst(), 60);
  }

  pause(o: { onResume: Handler; onSettings: Handler; onMenu: Handler }): void {
    const p = T.pause;
    const el = this.make('pause', 'pause', `<div class="dossier">
      <div class="head"><div>${T.menu.caseNo}</div><div class="pencil">${p.title.toLowerCase()}</div></div>
      <nav class="menu">
        <button class="line-btn" data-r autofocus>${p.resume}</button>
        <button class="line-btn minor" data-s>${p.settings}</button>
        <button class="line-btn minor" data-m>${p.toMenu}</button>
      </nav></div>`);
    this.bind(el, { '[data-r]': o.onResume, '[data-s]': o.onSettings, '[data-m]': o.onMenu });
    setTimeout(() => this.focusFirst(), 60);
  }

  /** Стрілки переміщують фокус між кнопками верхнього екрана; Esc — назад. */
  private onKey(e: KeyboardEvent): void {
    if (!this.top) return;
    const el = this.screens.get(this.top);
    if (!el) return;
    const items = Array.from(el.querySelectorAll<HTMLElement>('button:not([disabled]), input, a.line-btn'));
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = items.length;
      const next = items[(i + (e.key === 'ArrowDown' ? 1 : -1) + n) % n];
      next?.focus();
    } else if (e.key === 'Escape' && this.onBack) {
      e.preventDefault();
      this.onBack();
    }
  }
}
