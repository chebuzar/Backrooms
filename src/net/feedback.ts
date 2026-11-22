// Відгуки гравців («Книга жалоб и предложений»): збір відомостей про гру й пристрій, захист від спаму
// (доказ роботи), надсилання на сервер гри, черга без зв'язку й статуси власних записів.
// Сервер — server/feedback.mjs. Що з відгуками робить розробник — docs/FEEDBACK.md.
import { BUILD } from '../build-info';
import { recentErrors } from '../core/errlog';
import { solvePow } from './pow';

export type FeedbackKind = 'bug' | 'idea' | 'other';
export type PublicStatus = 'new' | 'accepted' | 'fixed' | 'declined' | 'known';

export interface FeedbackDraft { kind: FeedbackKind; text: string; shot: string | null; ctx: Record<string, unknown> }
interface Queued extends FeedbackDraft { at: number }
export interface MyEntry { ticket: string; no: number; at: number; kind: FeedbackKind; excerpt: string; status?: PublicStatus; note?: string }

const DEFAULT_SERVER = 'https://2x34tgfzwyad.ample.run';
const KEY = 'zakulisye_feedback_v1';
export const TEXT_MIN = 8;
export const TEXT_MAX = 4000;

/**
 * Адреса сервера. Автотести й dev-сервер не пишуть у справжню базу; для них — ?server=http://localhost:NNNN
 * (лише localhost: чуже посилання не перенаправить відгуки гравця на сторонній сервер).
 */
export function feedbackServer(): string {
  const o = new URLSearchParams(location.search).get('server');
  if (o && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o)) return o;
  if (import.meta.env.DEV || navigator.webdriver) return '';
  return String(import.meta.env.VITE_SERVER_URL || DEFAULT_SERVER).replace(/\/$/, '');
}

// ---------- відомості для відтворення бага ----------
let gameContext: () => Record<string, unknown> = () => ({});
/** Гра реєструє, що про неї знати: рівень, місце, якість, рендер. */
export function setFeedbackContext(fn: () => Record<string, unknown>): void { gameContext = fn; }

let fpsSamples: number[] = [];
let lastT = 0;
function fpsTick(t: number): void {
  if (lastT) { fpsSamples.push(t - lastT); if (fpsSamples.length > 240) fpsSamples = fpsSamples.slice(-120); }
  lastT = t;
  requestAnimationFrame(fpsTick);
}
requestAnimationFrame(fpsTick);

function fps(): { avg: number; low: number } | null {
  const s = fpsSamples.slice(-120);
  if (s.length < 10) return null;
  const sorted = [...s].sort((a, b) => a - b), mean = s.reduce((a, b) => a + b, 0) / s.length;
  return { avg: Math.round(1000 / mean), low: Math.round(1000 / (sorted[Math.floor(sorted.length * 0.95)] as number)) };
}

/** Усе, що не пише гравець, але без чого баг не відтворити. Нічого особистого: ні імені, ні адреси. */
export function collectContext(): Record<string, unknown> {
  let game: Record<string, unknown> = {};
  try { game = gameContext(); } catch (e) { game = { error: String(e) }; }
  const nav = navigator as Navigator & { deviceMemory?: number };
  return {
    build: BUILD,
    site: location.host + location.pathname,
    query: location.search.slice(0, 200),
    game,
    fps: fps(),
    device: {
      ua: navigator.userAgent.slice(0, 300),
      lang: navigator.language,
      screen: [screen.width, screen.height],
      view: [innerWidth, innerHeight],
      dpr: devicePixelRatio,
      touch: navigator.maxTouchPoints,
      cores: navigator.hardwareConcurrency ?? null,
      mem: nav.deviceMemory ?? null
    },
    errors: recentErrors(),
    uptime: Math.round(performance.now() / 1000)
  };
}

// ---------- сховище: черга без зв'язку і власні записи ----------
interface Box { outbox: Queued[]; mine: MyEntry[] }
function load(): Box {
  try {
    const o = JSON.parse(localStorage.getItem(KEY) || '{}') as Partial<Box>;
    return { outbox: Array.isArray(o.outbox) ? o.outbox.slice(-5) : [], mine: Array.isArray(o.mine) ? o.mine.slice(-30) : [] };
  } catch { return { outbox: [], mine: [] }; }
}
function store(b: Box): void {
  try { localStorage.setItem(KEY, JSON.stringify(b)); } catch {
    // місця мало — без знімків екрана в черзі
    try { localStorage.setItem(KEY, JSON.stringify({ ...b, outbox: b.outbox.map((q) => ({ ...q, shot: null })) })); } catch {}
  }
}
export function myEntries(): MyEntry[] { return load().mine.slice().reverse(); }
export function queuedCount(): number { return load().outbox.length; }

// ---------- захист від спаму: виклик сервера + доказ роботи, підготовлені заздалегідь ----------
interface Token { challenge: string; nonce: string; until: number }
let prepared: Promise<Token> | null = null;
let preparedAbort: AbortController | null = null;

async function makeToken(server: string, signal: AbortSignal): Promise<Token> {
  const r = await fetch(server + '/feedback/challenge', { signal, cache: 'no-store' });
  if (!r.ok) throw new Error('challenge ' + r.status);
  const c = await r.json() as { challenge: string; bits: number; ttl: number };
  const nonce = await solvePow(c.challenge, c.bits, signal);
  return { challenge: c.challenge, nonce, until: Date.now() + Math.max(0, c.ttl * 1000 - 60000) };
}

/** Почати готувати доказ роботи, щойно гравець відкрив форму (поки він пише). */
export function prepare(): void {
  const server = feedbackServer();
  if (!server || prepared) return;
  preparedAbort = new AbortController();
  prepared = makeToken(server, preparedAbort.signal);
  prepared.catch(() => { prepared = null; });
}
export function cancelPrepare(): void { preparedAbort?.abort(); prepared = null; preparedAbort = null; }

async function token(server: string): Promise<Token> {
  if (prepared) {
    try { const t = await prepared; prepared = null; if (t.until > Date.now()) return t; } catch { prepared = null; }
  }
  return makeToken(server, new AbortController().signal);
}

// ---------- надсилання ----------
export type SendResult = { ok: true; no: number } | { ok: false; reason: 'offline' | 'queued' | 'rate' | 'rejected' | 'disabled'; message?: string };

async function post(server: string, d: FeedbackDraft, openedMs: number): Promise<Response> {
  const t = await token(server);
  return fetch(server + '/feedback', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: d.kind, text: d.text, ctx: d.ctx, shot: d.shot, challenge: t.challenge, nonce: t.nonce, ms: Math.round(openedMs), website: '' })
  });
}

function remember(b: Box, d: FeedbackDraft, res: { no: number; ticket: string }): void {
  b.mine.push({ ticket: res.ticket, no: res.no, at: Date.now(), kind: d.kind, excerpt: d.text.slice(0, 80), status: 'new' });
  b.mine = b.mine.slice(-30);
}

/** Надіслати запис. Без зв'язку — у чергу (відправиться пізніше сам). */
export async function sendFeedback(d: FeedbackDraft, openedMs: number): Promise<SendResult> {
  const server = feedbackServer();
  if (!server) return { ok: false, reason: 'disabled' };
  let r: Response;
  try { r = await post(server, d, openedMs); } catch {
    const b = load(); b.outbox.push({ ...d, at: Date.now() }); b.outbox = b.outbox.slice(-5); store(b);
    return { ok: false, reason: 'queued' };
  }
  if (r.status === 429) return { ok: false, reason: 'rate' };
  const res = await r.json().catch(() => ({})) as { no?: number; ticket?: string; error?: string };
  if (!r.ok || typeof res.no !== 'number' || typeof res.ticket !== 'string') return { ok: false, reason: 'rejected', message: res.error };
  const b = load(); remember(b, d, { no: res.no, ticket: res.ticket }); store(b);
  return { ok: true, no: res.no };
}

/** Дослати чергу (на старті гри й після вдалого надсилання). Повертає, скільки пішло. */
export async function flushOutbox(): Promise<number> {
  const server = feedbackServer();
  if (!server) return 0;
  let b = load(), sent = 0;
  while (b.outbox.length) {
    const q = b.outbox[0] as Queued;
    let r: Response;
    try { r = await post(server, q, 30000); } catch { break; }
    b = load(); b.outbox.shift();
    if (r.ok) {
      const res = await r.json().catch(() => ({})) as { no?: number; ticket?: string };
      if (typeof res.no === 'number' && typeof res.ticket === 'string') { remember(b, q, { no: res.no, ticket: res.ticket }); sent++; }
    } else if (r.status === 429) { b.outbox.unshift(q); store(b); break; }
    store(b);
  }
  return sent;
}

/** Що розробник вирішив за записами цього гравця (статус і коротка відповідь). */
export async function refreshStatuses(): Promise<MyEntry[]> {
  const server = feedbackServer(), b = load();
  if (!server || !b.mine.length) return myEntries();
  try {
    const r = await fetch(server + '/feedback/status?t=' + b.mine.map((m) => m.ticket).join(','), { cache: 'no-store' });
    if (r.ok) {
      const rows = (await r.json() as { rows: { ticket: string; status: PublicStatus; note: string | null }[] }).rows;
      const fresh = load();
      for (const m of fresh.mine) { const x = rows.find((y) => y.ticket === m.ticket); if (x) { m.status = x.status; m.note = x.note ?? undefined; } }
      store(fresh);
    }
  } catch {}
  return myEntries();
}
