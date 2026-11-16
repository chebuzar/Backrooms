// «Каждый игрок — тестировщик»: анонимные отчёты о работе игры и сообщения об ошибках.
// Без личных данных: только устройство (платформа, видеочип), настройки графики, скорость кадров, рывки,
// ошибки страницы, где в игре это случилось. Игрок может выключить отправку в настройках.
// Пока сервер не настроен (REPORT_URL пуст), отчёты копятся локально (до 30) и уйдут, когда он появится.

const CFG = {
  url: (import.meta.env && import.meta.env.VITE_REPORT_URL) || '',     // адрес приёмника отчётов
  key: (import.meta.env && import.meta.env.VITE_REPORT_KEY) || ''      // публичный ключ (если нужен)
};
const QKEY = 'zk_reports_q';
const VERSION = (import.meta.env && import.meta.env.VITE_BUILD) || 'dev';

// ---------- кольцевой буфер ошибок страницы (для отчётов) ----------
const errors = [];
const pushErr = (m) => { errors.push(String(m).slice(0, 300)); if (errors.length > 12) errors.shift(); };
addEventListener('error', (e) => pushErr((e.message || 'error') + (e.filename ? ' @' + e.filename.split('/').pop() + ':' + e.lineno : '')));
addEventListener('unhandledrejection', (e) => pushErr('promise: ' + ((e.reason && (e.reason.message || e.reason)) || '?')));
export const recentErrors = () => errors.slice();

// ---------- статистика кадров за сессию уровня ----------
// гистограмма времени кадра (мс) — дёшево, без хранения каждого кадра
const BINS = [8, 12, 17, 20, 25, 33, 50, 100, 200, 1e9];
let fs = null;
export function frameStatsReset(ctx) { fs = { t0: performance.now(), n: 0, sum: 0, hist: new Array(BINS.length).fill(0), spikes: [], ctx }; }
export function frameStat(ms, where) {
  if (!fs) return;
  fs.n++; fs.sum += ms; let i = 0; while (ms > BINS[i]) i++; fs.hist[i]++;
  if (ms > 80 && fs.spikes.length < 20) fs.spikes.push([Math.round(ms), where]);
}
function frameSummary() {
  if (!fs || !fs.n) return null;
  let acc = 0, p95 = 0; const need = fs.n * 0.95;
  for (let i = 0; i < BINS.length; i++) { acc += fs.hist[i]; if (acc >= need) { p95 = BINS[i]; break; } }
  return { frames: fs.n, avgMs: +(fs.sum / fs.n).toFixed(1), fps: +(1000 * fs.n / fs.sum).toFixed(1), p95Ms: p95, hist: fs.hist, spikes: fs.spikes, secs: Math.round((performance.now() - fs.t0) / 1000) };
}

// ---------- отправка с очередью ----------
function loadQ() { try { return JSON.parse(localStorage.getItem(QKEY) || '[]'); } catch (e) { return []; } }
function saveQ(q) { try { localStorage.setItem(QKEY, JSON.stringify(q.slice(-30))); } catch (e) { /* место кончилось */ } }
export const reportsConfigured = () => !!CFG.url;
async function post(item) {
  if (!CFG.url) return false;
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (CFG.key) { headers.apikey = CFG.key; headers.Authorization = 'Bearer ' + CFG.key; }
    const r = await fetch(CFG.url.replace(/\/$/, '') + '/' + item.kind, { method: 'POST', headers, body: JSON.stringify({ data: item }), keepalive: true });
    return r.ok;
  } catch (e) { return false; }
}
export async function flush() {
  if (!CFG.url) return;
  const q = loadQ(); if (!q.length) return;
  const left = [];
  for (const it of q) if (!(await post(it))) left.push(it);
  saveQ(left);
}
function enqueue(item) { const q = loadQ(); q.push(item); saveQ(q); flush(); }
export const queuedCount = () => loadQ().length;

// контекст, который прикладывается к любому отчёту
function base(kind, ctx) {
  return Object.assign({ kind, v: VERSION, at: new Date().toISOString(), ua: navigator.userAgent.slice(0, 160), lang: navigator.language, scr: [screen.width, screen.height, devicePixelRatio] }, ctx);
}
// итог уровня/сессии: скорость, рывки, ошибки (если игрок не выключил)
export function sendPerf(ctx, allowed) {
  const f = frameSummary(); if (!f || !allowed) return;
  enqueue(base('perf', Object.assign({ frames: f, errors: recentErrors() }, ctx)));
  fs = null;
}
// сообщение игрока об ошибке (отправляется всегда — игрок сам нажал)
export function sendBug(text, ctx, shot) {
  enqueue(base('bugs', Object.assign({ text: String(text || '').slice(0, 2000), errors: recentErrors(), frames: frameSummary(), shot }, ctx)));
}
addEventListener('online', () => flush());
setTimeout(() => flush(), 4000);
