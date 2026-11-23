// Сервер игры «Закулисье»: отзывы игроков («Книга жалоб и предложений», server/feedback.mjs), аккаунты (имя + пароль),
// облачные сохранения, отчёты, уведомления о больших обновлениях. Postgres (DATABASE_URL), без фреймворков.
// Без DATABASE_URL (локально, автотесты) отзывы хранятся в памяти, остальное отвечает 503.
import http from 'node:http';
import crypto from 'node:crypto';
import pg from 'pg';
import webpush from 'web-push';
import { feedbackRoutes, memoryStore, pgStore } from './feedback.mjs';

const PORT = Number(process.env.PORT || 8080);
const RELEASE_URL = process.env.RELEASE_URL || 'https://raw.githubusercontent.com/chebuzar/Backrooms/main/public/release.json';
const ORIGINS = [/^https:\/\/chebuzar\.github\.io$/, /^https:\/\/zakulisye\.ample\.run$/, /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/];
// ключи сравниваются «очищенными»: без пробелов/переводов строки по краям, без кавычек и без «Bearer » — частые следы вставки
const cleanKey = (k) => String(k || '').trim().replace(/^Bearer\s+/i, '').replace(/^(["'])(.*)\1$/, '$2').trim();
const ADMIN = cleanKey(process.env.ADMIN_KEY);
const FEEDBACK_KEY = cleanKey(process.env.FEEDBACK_KEY); // лише читать и разбирать отзывы (ключ для Claude), без прав ADMIN_KEY
// …или только sha256 этого ключа (hex): так сам ключ живёт лишь в сетевом секрете среды Claude, а на сервере — его хеш.
// Хеш берётся из строки журнала «admin denied … sha256 …» после первого запроса с новым ключом (docs/FEEDBACK.md).
const FEEDBACK_KEY_SHA256 = /^[0-9a-f]{64}$/i.test(String(process.env.FEEDBACK_KEY_SHA256 || '').trim()) ? process.env.FEEDBACK_KEY_SHA256.trim().toLowerCase() : '';
const MIN_HASHED_KEY = 24; // короче — не ключ, а случайность; такие не принимаются по хешу и не пишутся в журнал целиком
const db = !process.env.DATABASE_URL ? null : new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 5, ssl: process.env.DATABASE_URL && /sslmode=require|ssl=true/.test(process.env.DATABASE_URL) ? { rejectUnauthorized: false } : undefined });
if (process.env.VAPID_PUBLIC && process.env.VAPID_PRIVATE) webpush.setVapidDetails('https://chebuzar.github.io/Backrooms/', process.env.VAPID_PUBLIC, process.env.VAPID_PRIVATE);

async function migrate() {
  if (!db) return;
  await feedbackStore.migrate();
  await db.query(`
    create table if not exists accounts (id bigserial primary key, name text unique not null, name_lc text unique not null, pass text not null, created_at timestamptz default now());
    create table if not exists sessions (token_hash text primary key, account_id bigint references accounts(id) on delete cascade, created_at timestamptz default now());
    create table if not exists saves (account_id bigint primary key references accounts(id) on delete cascade, data jsonb not null, updated_at timestamptz default now());
    create table if not exists reports (id bigserial primary key, kind text not null, data jsonb not null, created_at timestamptz default now());
    create table if not exists push_subs (endpoint text primary key, sub jsonb not null, lang text, created_at timestamptz default now());
    create table if not exists meta (k text primary key, v text);
  `);
}

// ---------- помощники ----------
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const hashPass = (p) => new Promise((res, rej) => { const salt = crypto.randomBytes(16); crypto.scrypt(p, salt, 32, { N: 16384, r: 8, p: 1 }, (e, k) => (e ? rej(e) : res('s1$' + salt.toString('base64') + '$' + k.toString('base64')))); });
const checkPass = (p, stored) => new Promise((res) => { const [, s, k] = String(stored).split('$'); if (!s || !k) return res(false); crypto.scrypt(p, Buffer.from(s, 'base64'), 32, { N: 16384, r: 8, p: 1 }, (e, d) => res(!e && crypto.timingSafeEqual(d, Buffer.from(k, 'base64')))); });
const NAME = /^[\p{L}\p{N}_ .-]{3,20}$/u;
const hits = new Map(); // простое ограничение частоты: ключ → [начало окна, число, окно]
function limited(key, max, win = 60000) {
  const now = Date.now(), h = hits.get(key);
  if (!h || now - h[0] > win) { hits.set(key, [now, 1, win]); return false; }
  return ++h[1] > max;
}
setInterval(() => { const now = Date.now(); for (const [k, h] of hits) if (now - h[0] > h[2]) hits.delete(k); }, 60000).unref();
const safeEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
// ключ — в x-admin-key или «Authorization: Bearer …» (так его подставляют сетевые секреты среды Claude)
// Отпечаток ключа для журнала: длина + 4 hex sha256 (16 бит — по нему ключ не восстановить), чтобы сверить,
// тот ли ключ пришёл, не показывая сам ключ. В журнал — не чаще раза в 10 с.
const keyPrint = (k) => (k ? `len ${k.length} fp ${crypto.createHash('sha256').update(k).digest('hex').slice(0, 4)}` : 'нет');
let deniedLogAt = 0;
const isAdmin = (req) => {
  const raw = req.headers['x-admin-key'] || req.headers.authorization || '';
  const k = cleanKey(raw);
  const ok = !!k && ((!!ADMIN && safeEq(k, ADMIN)) || (!!FEEDBACK_KEY && safeEq(k, FEEDBACK_KEY)) ||
    (!!FEEDBACK_KEY_SHA256 && k.length >= MIN_HASHED_KEY && safeEq(sha(k), FEEDBACK_KEY_SHA256)));
  if (!ok && Date.now() - deniedLogAt > 10000) {
    deniedLogAt = Date.now();
    const via = req.headers['x-admin-key'] ? 'x-admin-key' : req.headers.authorization ? 'authorization' : 'без ключа';
    console.log(`admin denied: ${via} ${keyPrint(k)}${raw.length !== k.length ? ` (до очистки len ${raw.length})` : ''}; ожидается FEEDBACK_KEY ${keyPrint(FEEDBACK_KEY)}${k.length >= MIN_HASHED_KEY ? ` · sha256 ${sha(k)}` : ''}`);
  }
  return ok;
};
const feedbackStore = db ? pgStore(db) : memoryStore();
const feedback = feedbackRoutes(feedbackStore);

function send(res, code, obj, origin) {
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
  if (origin) Object.assign(headers, { 'Access-Control-Allow-Origin': origin, Vary: 'Origin', 'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey, x-admin-key', 'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS', 'Access-Control-Max-Age': '86400' });
  res.writeHead(code, headers); res.end(obj === undefined ? '' : JSON.stringify(obj));
}
function body(req, limit) {
  return new Promise((res, rej) => {
    let n = 0; const chunks = [];
    req.on('data', (c) => { n += c.length; if (n > limit) { rej(Object.assign(new Error('too big'), { code: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { res(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (e) { rej(Object.assign(new Error('bad json'), { code: 400 })); } });
    req.on('error', rej);
  });
}
async function accountOf(req) {
  const m = /^Bearer (.{20,200})$/.exec(req.headers.authorization || ''); if (!m) return null;
  const r = await db.query('select a.id, a.name from sessions s join accounts a on a.id = s.account_id where s.token_hash = $1', [sha(m[1])]);
  return r.rows[0] || null;
}
async function newSession(id) { const t = crypto.randomBytes(32).toString('base64url'); await db.query('insert into sessions(token_hash, account_id) values ($1, $2)', [sha(t), id]); return t; }

// ---------- маршруты ----------
async function route(req, res, origin) {
  const url = new URL(req.url, 'http://x'), p = url.pathname, ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  if (req.method === 'OPTIONS') return send(res, 204, undefined, origin);
  if (p === '/' || p === '/health') return send(res, 200, { ok: true, service: 'zakulisye' }, origin);
  if (p === '/vapid') return send(res, 200, { key: process.env.VAPID_PUBLIC || null }, origin);

  // отзывы игроков: /feedback, /feedback/challenge, /feedback/status, /admin/feedback…
  if (p.startsWith('/feedback') || p.startsWith('/admin/feedback')) {
    const handled = await feedback(req, res, p, url, { send: (code, obj) => send(res, code, obj, origin), body, limited, ip, isAdmin });
    if (handled !== false) return;
  }
  if (!db) return send(res, 503, { error: 'no database' }, origin);

  // отчёты игроков и сообщения об ошибках (без входа)
  if ((p === '/perf' || p === '/bugs') && req.method === 'POST') {
    if (limited('r:' + ip, p === '/bugs' ? 10 : 30)) return send(res, 429, { error: 'slow down' }, origin);
    const b = await body(req, p === '/bugs' ? 400000 : 60000);
    if (!b || typeof b.data !== 'object') return send(res, 400, { error: 'data' }, origin);
    await db.query('insert into reports(kind, data) values ($1, $2)', [p.slice(1), b.data]);
    return send(res, 201, { ok: true }, origin);
  }

  // аккаунты
  if ((p === '/auth/register' || p === '/auth/login') && req.method === 'POST') {
    if (limited('a:' + ip, 12)) return send(res, 429, { error: 'slow down' }, origin);
    const b = await body(req, 4000), name = String(b.name || '').trim(), pass = String(b.password || '');
    if (!NAME.test(name)) return send(res, 400, { error: 'name' }, origin);
    if (pass.length < 6 || pass.length > 200) return send(res, 400, { error: 'password' }, origin);
    if (p === '/auth/register') {
      const h = await hashPass(pass);
      try {
        const r = await db.query('insert into accounts(name, name_lc, pass) values ($1, $2, $3) returning id', [name, name.toLowerCase(), h]);
        return send(res, 201, { token: await newSession(r.rows[0].id), name }, origin);
      } catch (e) { if (e.code === '23505') return send(res, 409, { error: 'taken' }, origin); throw e; }
    }
    const r = await db.query('select id, name, pass from accounts where name_lc = $1', [name.toLowerCase()]);
    if (!r.rows[0] || !(await checkPass(pass, r.rows[0].pass))) return send(res, 401, { error: 'wrong' }, origin);
    return send(res, 200, { token: await newSession(r.rows[0].id), name: r.rows[0].name }, origin);
  }
  if (p === '/auth/logout' && req.method === 'POST') {
    const m = /^Bearer (.+)$/.exec(req.headers.authorization || ''); if (m) await db.query('delete from sessions where token_hash = $1', [sha(m[1])]);
    return send(res, 200, { ok: true }, origin);
  }

  // облачное сохранение
  if (p === '/save') {
    const acc = await accountOf(req); if (!acc) return send(res, 401, { error: 'login' }, origin);
    if (req.method === 'GET') { const r = await db.query('select data, updated_at from saves where account_id = $1', [acc.id]); return send(res, 200, { name: acc.name, save: r.rows[0] || null }, origin); }
    if (req.method === 'PUT') {
      if (limited('s:' + acc.id, 30)) return send(res, 429, { error: 'slow down' }, origin);
      const b = await body(req, 300000); if (!b || typeof b.data !== 'object') return send(res, 400, { error: 'data' }, origin);
      await db.query('insert into saves(account_id, data, updated_at) values ($1, $2, now()) on conflict (account_id) do update set data = excluded.data, updated_at = now()', [acc.id, b.data]);
      return send(res, 200, { ok: true }, origin);
    }
  }

  // подписка на уведомления о больших обновлениях
  if (p === '/push/subscribe' && req.method === 'POST') {
    if (limited('p:' + ip, 10)) return send(res, 429, { error: 'slow down' }, origin);
    const b = await body(req, 8000), s = b.sub;
    if (!s || typeof s.endpoint !== 'string' || !/^https:\/\//.test(s.endpoint)) return send(res, 400, { error: 'sub' }, origin);
    await db.query('insert into push_subs(endpoint, sub, lang) values ($1, $2, $3) on conflict (endpoint) do update set sub = excluded.sub, lang = excluded.lang', [s.endpoint, s, String(b.lang || '').slice(0, 5)]);
    return send(res, 201, { ok: true }, origin);
  }
  if (p === '/push/unsubscribe' && req.method === 'POST') { const b = await body(req, 8000); await db.query('delete from push_subs where endpoint = $1', [String(b.endpoint || '')]); return send(res, 200, { ok: true }, origin); }

  // для разработчика: прочитать отчёты
  if (p === '/admin/reports' && req.method === 'GET') {
    if (!ADMIN || req.headers['x-admin-key'] !== ADMIN) return send(res, 403, { error: 'admin' }, origin);
    const kind = url.searchParams.get('kind'), lim = Math.min(500, Number(url.searchParams.get('limit') || 100));
    const r = kind ? await db.query('select id, kind, data, created_at from reports where kind = $1 order by id desc limit $2', [kind, lim]) : await db.query('select id, kind, data, created_at from reports order by id desc limit $1', [lim]);
    const c = await db.query('select kind, count(*)::int n from reports group by kind'), a = await db.query('select count(*)::int n from accounts'), s = await db.query('select count(*)::int n from push_subs');
    return send(res, 200, { counts: c.rows, accounts: a.rows[0].n, pushSubs: s.rows[0].n, rows: r.rows }, origin);
  }
  if (p === '/admin/delete' && req.method === 'POST') { // убрать тестовые записи: {account} или {report}
    if (!ADMIN || req.headers['x-admin-key'] !== ADMIN) return send(res, 403, { error: 'admin' }, origin);
    const b = await body(req, 4000);
    if (b.account) await db.query('delete from accounts where name_lc = $1', [String(b.account).toLowerCase()]);
    if (b.report) await db.query('delete from reports where id = $1', [Number(b.report)]);
    return send(res, 200, { ok: true }, origin);
  }
  // плановая задача Ample (каждые 10 минут, даже когда сервер спит): проверить релиз
  if (p === '/tasks/release' && req.method === 'POST') {
    const tok = process.env.AMPLE_JOB_TOKEN;
    if (!tok || req.headers['ample-job-token'] !== tok) return send(res, 403, { error: 'job' }, origin);
    return send(res, 200, { result: await checkRelease() }, origin);
  }
  return send(res, 404, { error: 'not found' }, origin);
}

// ---------- уведомления: только большой релиз ----------
// В репозитории игры лежит public/release.json {id, title, body}. Его меняют лишь когда весь план работ сделан.
// Сервер раз в 10 минут проверяет файл; новый id → одно уведомление всем подписчикам (id запоминается в базе).
async function checkRelease() {
  if (!process.env.VAPID_PUBLIC) return 'no vapid';
  try {
    const r = await fetch(RELEASE_URL + '?t=' + Date.now(), { headers: { 'Cache-Control': 'no-cache' } }); if (!r.ok) return 'no file ' + r.status;
    const rel = await r.json(); if (!rel || !rel.id) return 'no id';
    const last = await db.query("select v from meta where k = 'release'");
    if (!last.rows[0]) { await db.query("insert into meta(k, v) values ('release', $1)", [String(rel.id)]); return 'first ' + rel.id; } // первый запуск: не рассылать старое
    if (last.rows[0].v === String(rel.id)) return 'same ' + rel.id;
    // защита от двойной рассылки, если две проверки идут одновременно
    const upd = await db.query("update meta set v = $1 where k = 'release' and v = $2", [String(rel.id), last.rows[0].v]);
    if (!upd.rowCount) return 'raced';
    const subs = await db.query('select endpoint, sub, lang from push_subs');
    for (const row of subs.rows) {
      const L = rel[row.lang] || rel.ru || rel;
      const payload = JSON.stringify({ title: L.title || rel.title || 'Закулисье', body: L.body || rel.body || '', url: rel.url || 'https://chebuzar.github.io/Backrooms/' });
      try { await webpush.sendNotification(row.sub, payload, { TTL: 86400 }); } catch (e) { if (e.statusCode === 404 || e.statusCode === 410) await db.query('delete from push_subs where endpoint = $1', [row.endpoint]); }
    }
    console.log('release push sent', rel.id, subs.rows.length);
    return 'sent ' + rel.id + ' to ' + subs.rows.length;
  } catch (e) { console.warn('release check', e.message); return 'error ' + e.message; }
}

http.createServer(async (req, res) => {
  const o = req.headers.origin, origin = o && ORIGINS.some((re) => re.test(o)) ? o : null;
  try { await route(req, res, origin); } catch (e) { console.error(e); send(res, e.code === 413 ? 413 : e.code === 400 ? 400 : 500, { error: e.code === 413 ? 'too big' : 'server' }, origin); }
}).listen(PORT, async () => {
  console.log('listening', PORT, '· FEEDBACK_KEY', keyPrint(FEEDBACK_KEY), '· FEEDBACK_KEY_SHA256', FEEDBACK_KEY_SHA256 ? FEEDBACK_KEY_SHA256.slice(0, 4) + '…' : 'нет');
  for (let i = 0; i < 10; i++) { try { await migrate(); break; } catch (e) { console.warn('db not ready', e.message); await new Promise((r) => setTimeout(r, 3000)); } }
  if (db) { checkRelease(); setInterval(checkRelease, 10 * 60 * 1000); }
});
