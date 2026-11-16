// Аккаунт игрока: имя + пароль на сервере игры, облачное сохранение прогресса.
// Локальное сохранение (zakulisye_v2) остаётся главным: облако лишь копия, при входе они объединяются без потерь.
import { SERVER } from './config.js';

const AK = 'zk_acc';
let acc = (() => { try { const a = JSON.parse(localStorage.getItem(AK) || 'null'); return a && a.token ? a : null; } catch (e) { return null; } })();
const keep = () => { try { if (acc) localStorage.setItem(AK, JSON.stringify(acc)); else localStorage.removeItem(AK); } catch (e) { /* нет хранилища */ } };
export const account = () => acc;

// состояние синхронизации для меню: 'idle' | 'saving' | 'saved' | 'offline' | 'expired'
let state = 'idle'; const subs = new Set();
const setState = (s) => { state = s; subs.forEach((f) => f(s)); };
export const syncState = () => state;
export const onSync = (f) => subs.add(f);

async function api(path, { method = 'GET', body, auth = false, keepalive = false } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth && acc) headers.Authorization = 'Bearer ' + acc.token;
  try {
    const r = await fetch(SERVER + path, { method, headers, body: body ? JSON.stringify(body) : undefined, keepalive });
    let j = {}; try { j = await r.json(); } catch (e) { /* пустой ответ */ }
    return { ok: r.ok, status: r.status, j };
  } catch (e) { return { ok: false, status: 0, j: {} }; }
}
const errOf = (r) => (r.status === 0 ? 'net' : r.status === 429 ? 'slow' : r.j.error || 'net');

// kind: 'login' | 'register'
export async function auth(kind, name, password) {
  const r = await api('/auth/' + kind, { method: 'POST', body: { name: String(name).trim(), password } });
  if (!r.ok) return { ok: false, err: errOf(r) };
  acc = { name: r.j.name, token: r.j.token }; keep();
  return { ok: true };
}
export async function logout() {
  clearTimeout(timer); if (pending) await pushNow();
  if (acc) api('/auth/logout', { method: 'POST', auth: true });
  acc = null; keep(); setState('idle');
}
const expire = () => { acc = null; keep(); setState('expired'); };

// облачная копия: null — ещё нет; false — ошибка
export async function pull() {
  if (!acc) return false;
  const r = await api('/save', { auth: true });
  if (r.status === 401) { expire(); return false; }
  if (!r.ok) { setState('offline'); return false; }
  return (r.j.save && r.j.save.data) || null;
}
let timer = null, pending = null;
export async function pushNow(keepalive = false) {
  if (!acc || !pending) return;
  const data = pending; pending = null; setState('saving');
  const r = await api('/save', { method: 'PUT', body: { data }, auth: true, keepalive });
  if (r.status === 401) return expire();
  if (!r.ok) { pending = pending || data; setState('offline'); return; }
  setState('saved');
}
// после каждого сохранения игры: отправить через 4 с тишины (чтобы не слать на каждую записку)
export function pushLater(save) {
  if (!acc) return;
  pending = JSON.parse(JSON.stringify(save)); clearTimeout(timer);
  timer = setTimeout(() => pushNow(), 4000);
}
addEventListener('pagehide', () => { if (pending) { clearTimeout(timer); pushNow(true); } });
addEventListener('online', () => { if (pending) pushNow(); });

// объединение без потерь: всё найденное — из обоих, уровни — наибольшие, настройки — с этого устройства
const LISTS = ['notes', 'ach', 'anom', 'docs', 'finds'];
export function mergeSave(local, cloud) {
  if (!cloud || typeof cloud !== 'object') return local;
  const out = Object.assign({}, cloud, local);
  for (const k of LISTS) out[k] = [...new Set([...(Array.isArray(cloud[k]) ? cloud[k] : []), ...(Array.isArray(local[k]) ? local[k] : [])])];
  out.max = Math.max(local.max ?? -1, cloud.max ?? -1);
  out.cont = Math.max(local.cont || 0, cloud.cont || 0);
  for (const k of ['tut', 'toolsTip', 'scanTip', 'nvTip']) out[k] = !!(local[k] || cloud[k]) || undefined;
  out.set = local.set || cloud.set;
  return out;
}
