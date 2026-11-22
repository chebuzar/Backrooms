// «Книга жалоб и предложений»: гравець пише про неполадку, пропозицію чи враження.
// Бланк у стилі решти інтерфейсу (справа Об'єкта 4-Б): вид запису, текст олівцем по лінійках,
// знімок екрана, приколотий до бланка, і червоний штамп «Принято» з номером запису.
import '../styles/feedback.css';
import '@fontsource/neucha/latin-400.css'; // латиниця «олівцем» (назви клавіш, слова латиницею в тексті гравця)
import { T } from '../i18n/ru';
import type { UI } from './screens';
import {
  TEXT_MAX, TEXT_MIN, cancelPrepare, collectContext, feedbackServer, flushOutbox, myEntries, prepare, queuedCount, refreshStatuses, sendFeedback,
  type FeedbackKind, type MyEntry
} from '../net/feedback';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);

// чернетка живе, поки відкрита гра: закрив форму випадково — текст не пропав
const draft: { kind: FeedbackKind; text: string } = { kind: 'bug', text: '' };

// ---------- знімок екрана ----------
// Полотно читаємо одразу після того, як гра намалювала кадр (Game.frame → frameRendered): у WebGPU і WebGL
// без preserveDrawingBuffer поза цією миттю полотно вже порожнє. Якщо гра не малює (зупинена) — у найближчому кадрі.
let waiters: ((canvas: HTMLCanvasElement) => void)[] = [];

/** Викликає гра відразу після рендеру кадру. Нічого не робить, поки знімок не просили. */
export function frameRendered(canvas: HTMLCanvasElement): void {
  if (!waiters.length) return;
  const w = waiters; waiters = [];
  for (const f of w) f(canvas);
}

function grab(canvas: HTMLCanvasElement, maxW: number): string | null {
  const w = Math.min(maxW, canvas.width), h = Math.round((w * canvas.height) / Math.max(1, canvas.width));
  if (!w || !h) return null;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  if (!g) return null;
  g.drawImage(canvas, 0, 0, w, h);
  return c.toDataURL('image/jpeg', 0.72);
}

/** Знімок того, що бачить гравець (JPEG, до maxW пікселів завширшки), або null. */
export function captureView(canvas: HTMLCanvasElement, maxW = 960): Promise<string | null> {
  return new Promise((done) => {
    let finished = false;
    const finish = (cv: HTMLCanvasElement) => { if (finished) return; finished = true; try { done(grab(cv, maxW)); } catch { done(null); } };
    waiters.push(finish);
    setTimeout(() => { waiters = waiters.filter((f) => f !== finish); requestAnimationFrame(() => finish(canvas)); }, 600);
  });
}

function entryRow(m: MyEntry): string {
  const f = T.feedback, st = m.status ?? 'new';
  const date = new Date(m.at).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' });
  return `<li class="fb-entry st-${st}"><span class="no">№ ${m.no}</span><span class="what">${esc(f.kinds[m.kind])} · ${date}<br><q>${esc(m.excerpt)}${m.excerpt.length >= 80 ? '…' : ''}</q>
    ${m.note ? `<span class="answer">${esc(m.note)}</span>` : ''}</span><span class="st">${esc(f.statuses[st])}</span></li>`;
}

function renderMine(el: HTMLElement): void {
  const box = el.querySelector('.fb-mine');
  if (!box) return;
  const list = myEntries(), waiting = queuedCount(), f = T.feedback;
  box.innerHTML = list.length || waiting ? `<h2>${f.mine}${waiting ? ` <span class="pencil">${f.waiting(waiting)}</span>` : ''}</h2><ul>${list.slice(0, 8).map(entryRow).join('')}</ul>` : '';
}

export interface FeedbackOptions {
  canvas: HTMLCanvasElement;
  /** Знімок за замовчуванням: так — із гри (пауза), ні — з меню. */
  shotByDefault: boolean;
  onClose: () => void;
}

/** Відкрити бланк поверх поточного екрана. Esc або «Отмена» — назад, чернетка зберігається. */
export function openFeedback(ui: UI, o: FeedbackOptions): void {
  const f = T.feedback;
  const prevBack = ui.onBack;
  const opened = performance.now();
  let shot: string | null = null, attach = o.shotByDefault, busy = false, sent = false;
  prepare(); // доказ роботи рахується, поки гравець пише

  const kinds = (['bug', 'idea', 'other'] as const).map((k) => `<button type="button" data-k="${k}" aria-pressed="${draft.kind === k}">${f.kinds[k]}</button>`).join('');
  const el = ui.make('feedback', 'dossier-wrap feedback-screen', `<div class="dossier fb" aria-label="${f.title}">
    <div class="head"><div>${f.org}</div><div class="pencil">${f.form}</div></div>
    <h1>${f.title}</h1>
    <p class="sub">${f.intro}</p>
    <div class="fb-cols">
      <form class="fb-form" novalidate>
        <input class="fb-hp" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
        <div class="fb-row"><span class="lbl">${f.kind}</span><div class="seg" role="radiogroup">${kinds}</div></div>
        <label class="lbl" for="fb-text">${f.text}</label>
        <textarea id="fb-text" class="fb-text" rows="5" maxlength="${TEXT_MAX}" spellcheck="true" placeholder="${esc(f.hints[draft.kind])}">${esc(draft.text)}</textarea>
        <p class="fb-attached">${f.attached}</p>
        <p class="fb-msg" role="status" aria-live="polite"></p>
        <nav class="menu fb-act"><button type="submit" class="line-btn" data-send>${f.send}</button><button type="button" class="line-btn minor" data-cancel>${f.cancel}</button></nav>
        <div class="fb-stamp" aria-hidden="true"><b>${f.stamp}</b><span></span></div>
      </form>
      <aside class="fb-side">
        <div class="fb-shot-row">
          <figure class="fb-shot" hidden><img alt=""><figcaption>${f.shot}</figcaption></figure>
          <div class="fb-shot-ctl" hidden><span class="lbl">${f.shot}</span><div class="seg">
            <button type="button" data-shot="1" aria-pressed="${attach}">${f.shotOn}</button><button type="button" data-shot="0" aria-pressed="${!attach}">${f.shotOff}</button></div></div>
        </div>
        <section class="fb-mine"></section>
      </aside>
    </div>
  </div>`);

  const text = el.querySelector('.fb-text') as HTMLTextAreaElement;
  const msg = el.querySelector('.fb-msg') as HTMLElement;
  const send = el.querySelector('[data-send]') as HTMLButtonElement;
  const fig = el.querySelector('.fb-shot') as HTMLElement;
  const shotCtl = el.querySelector('.fb-shot-ctl') as HTMLElement;
  const say = (t: string, cls = '') => { msg.textContent = t; msg.className = `fb-msg ${cls}`; };
  if (!feedbackServer()) say(f.disabled, 'warn');

  const close = () => {
    if (busy) return;
    cancelPrepare();
    ui.onBack = prevBack;
    ui.close('feedback');
    o.onClose();
  };
  ui.onBack = close;

  // вид запису
  el.querySelector('.seg[role=radiogroup]')?.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-k]');
    if (!b) return;
    draft.kind = b.dataset.k as FeedbackKind;
    el.querySelectorAll('[data-k]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    text.placeholder = f.hints[draft.kind];
  });
  text.addEventListener('input', () => { draft.text = text.value; if (msg.classList.contains('err')) say(''); });

  // знімок: показати приколотим до бланка; натиск на фото чи перемикач — прикласти / ні
  const setAttach = (v: boolean) => {
    attach = v;
    fig.classList.toggle('off', !v);
    shotCtl.querySelectorAll('[data-shot]').forEach((x) => x.setAttribute('aria-pressed', String((x as HTMLElement).dataset.shot === (v ? '1' : '0'))));
  };
  void captureView(o.canvas).then((d) => {
    if (!d || !el.isConnected) return;
    shot = d;
    (fig.querySelector('img') as HTMLImageElement).src = d;
    fig.hidden = false; shotCtl.hidden = false;
    setAttach(attach);
  });
  fig.addEventListener('click', () => setAttach(!attach));
  shotCtl.addEventListener('click', (e) => { const b = (e.target as HTMLElement).closest<HTMLElement>('[data-shot]'); if (b) setAttach(b.dataset.shot === '1'); });

  el.querySelector('[data-cancel]')?.addEventListener('click', close);
  el.querySelector('form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    if (sent) { close(); return; }
    if (busy) return;
    const body = text.value.trim();
    if (body.replace(/\s+/g, '').length < TEXT_MIN) { say(f.short, 'err'); text.focus(); return; }
    if ((el.querySelector('.fb-hp') as HTMLInputElement).value) return; // приманка для ботів
    busy = true; send.disabled = true; say(f.sending);
    void sendFeedback({ kind: draft.kind, text: body, shot: attach ? shot : null, ctx: collectContext() }, performance.now() - opened).then((r) => {
      busy = false; send.disabled = false;
      if (r.ok) {
        sent = true;
        draft.text = '';
        const stamp = el.querySelector('.fb-stamp') as HTMLElement;
        (stamp.querySelector('span') as HTMLElement).textContent = `№ ${r.no}`;
        stamp.classList.add('on');
        el.querySelector('.fb-form')?.classList.add('sent');
        text.readOnly = true;
        say(f.ok(r.no), 'ok');
        send.textContent = f.done;
        (el.querySelector('[data-cancel]') as HTMLElement).hidden = true;
        send.focus();
        renderMine(el);
        void flushOutbox().then((n) => { if (n) renderMine(el); });
      } else {
        say(r.reason === 'queued' ? f.queued : r.reason === 'rate' ? f.rate : r.reason === 'disabled' ? f.disabled : f.rejected, r.reason === 'queued' ? 'warn' : 'err');
        if (r.reason === 'queued') { sent = true; draft.text = ''; send.textContent = f.done; (el.querySelector('[data-cancel]') as HTMLElement).hidden = true; renderMine(el); }
      }
    });
  });

  renderMine(el);
  void refreshStatuses().then(() => { if (el.isConnected) renderMine(el); });
  setTimeout(() => (draft.text ? send : text).focus({ preventScroll: true }), 80);
}
