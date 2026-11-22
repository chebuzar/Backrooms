// Відгуки гравців («Книга жалоб и предложений»): прийом, захист від спаму, статуси для гравця, читання для розробника.
// Клієнт — src/net/feedback.ts. Порядок розбору відгуків — docs/FEEDBACK.md.
//
// Захист від спаму без капчі і сторонніх сервісів:
//  1) доказ роботи: /feedback/challenge дає підписаний виклик, браузер шукає nonce (sha256 з N нульових бітів);
//     N росте сам, коли відгуків за годину забагато; кожен виклик — один раз і 30 хвилин;
//  2) ліміти: з однієї адреси 4 прийняті записи за 10 хв і 20 за добу, загалом — 300 за годину;
//  3) приманка (приховане поле), мінімальний час на бланку, розмір тексту, не більше 3 посилань, повтори — в один запис.
// IP не зберігається: лише sha256(ip + сіль) для лімітів і пошуку повторів.
import crypto from 'node:crypto';

export const KINDS = ['bug', 'idea', 'other'];
/** Внутрішні статуси (розробник) → що бачить гравець. */
export const STATUSES = { new: 'new', bug: 'accepted', idea: 'accepted', planned: 'accepted', fixed: 'fixed', done: 'fixed', declined: 'declined', duplicate: 'known', spam: 'declined' };
export const TEXT_MIN = 8, TEXT_MAX = 4000, CTX_MAX = 24000, SHOT_MAX = 400000;
const CHALLENGE_TTL = 30 * 60;

const SECRET = process.env.FEEDBACK_SECRET || crypto.randomBytes(32).toString('hex'); // без змінної — новий при перезапуску (виклики просто оновляться)
const SALT = process.env.FEEDBACK_SALT || SECRET;
const hmac = (s) => crypto.createHmac('sha256', SECRET).update(s).digest('base64url').slice(0, 22);
export const ipHash = (ip) => crypto.createHash('sha256').update(SALT + '|' + ip).digest('hex').slice(0, 32);

// ---------- доказ роботи ----------
export function leadingZeroBits(buf) {
  let n = 0;
  for (const b of buf) { if (b === 0) { n += 8; continue; } return n + Math.clz32(b) - 24; }
  return n;
}
export function makeChallenge(bits, now = Date.now()) {
  const body = `${Math.floor(now / 1000)}.${crypto.randomBytes(9).toString('base64url')}.${bits}`;
  return `${body}.${hmac(body)}`;
}
/** Перевірити виклик і nonce. Повертає null, якщо все добре, або причину. */
export function checkPow(challenge, nonce, used, now = Date.now()) {
  if (typeof challenge !== 'string' || typeof nonce !== 'string' || challenge.length > 120 || !/^[0-9a-z]{1,12}$/.test(nonce)) return 'pow';
  const parts = challenge.split('.');
  if (parts.length !== 4) return 'pow';
  const [ts, , bits, sig] = parts, body = parts.slice(0, 3).join('.');
  const want = Buffer.from(hmac(body)), got = Buffer.from(sig);
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return 'pow';
  const age = Math.floor(now / 1000) - Number(ts);
  if (!(age >= 0 && age <= CHALLENGE_TTL)) return 'expired';
  if (used.has(challenge)) return 'used';
  if (leadingZeroBits(crypto.createHash('sha256').update(`${challenge}:${nonce}`).digest()) < Number(bits)) return 'pow';
  used.set(challenge, now + CHALLENGE_TTL * 1000);
  return null;
}

// ---------- перевірка тексту ----------
// керівні символи, невидимі пробіли й символи зміни напрямку тексту (ними маскують спам)
// eslint-disable-next-line no-control-regex -- саме ці символи й треба вирізати
const INVISIBLE = new RegExp('[\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f\\u007f\\u200b-\\u200f\\u202a-\\u202e\\u2066-\\u2069]', 'g');
/** Прибрати керівні символи й зайві порожні рядки; повертає очищений текст або причину відмови. */
export function cleanText(raw) {
  if (typeof raw !== 'string') return { error: 'text' };
  const text = raw.normalize('NFC').replace(INVISIBLE, '')
    .replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{4,}/g, '\n\n\n').trim();
  const letters = text.replace(/\s+/g, '');
  if (letters.length < TEXT_MIN) return { error: 'short' };
  if (text.length > TEXT_MAX) return { error: 'long' };
  if ((text.match(/https?:\/\/|www\.|t\.me\//gi) || []).length > 3) return { error: 'links' };
  // «аааааа…» чи одна й та сама пара символів — не відгук
  if (new Set(letters.toLowerCase()).size < 4) return { error: 'junk' };
  return { text };
}
export const textKey = (text) => crypto.createHash('sha256').update(text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')).digest('hex').slice(0, 32);

function cleanShot(shot) {
  if (shot == null) return { buf: null };
  if (typeof shot !== 'string' || shot.length > SHOT_MAX * 1.4) return { error: 'shot' };
  const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(shot);
  if (!m) return { error: 'shot' };
  const buf = Buffer.from(m[1], 'base64');
  if (buf.length > SHOT_MAX || buf[0] !== 0xff || buf[1] !== 0xd8) return { error: 'shot' };
  return { buf };
}

// ---------- сховище: Postgres або пам'ять (локально й у тестах) ----------
export function pgStore(db) {
  return {
    async migrate() {
      await db.query(`create table if not exists feedback (
        id bigserial primary key, ticket text unique not null, kind text not null, text text not null, text_key text not null,
        ctx jsonb not null default '{}', shot bytea, ip_hash text not null, status text not null default 'new',
        note text, triage jsonb, dup_of bigint, created_at timestamptz default now(), updated_at timestamptz default now());
        create index if not exists feedback_status on feedback(status, id);
        create index if not exists feedback_key on feedback(text_key, created_at);`);
    },
    async recentByKey(key, sinceMs) { const r = await db.query('select id, ticket from feedback where text_key = $1 and created_at > now() - ($2::int * interval \'1 millisecond\') order by id limit 1', [key, sinceMs]); return r.rows[0] || null; },
    async countSince(sinceMs) { const r = await db.query('select count(*)::int n from feedback where created_at > now() - ($1::int * interval \'1 millisecond\')', [sinceMs]); return r.rows[0].n; },
    async insert(row) {
      const r = await db.query('insert into feedback(ticket, kind, text, text_key, ctx, shot, ip_hash) values ($1,$2,$3,$4,$5,$6,$7) returning id',
        [row.ticket, row.kind, row.text, row.text_key, row.ctx, row.shot, row.ip_hash]);
      return Number(r.rows[0].id);
    },
    async byTickets(tickets) { const r = await db.query('select ticket, status, note from feedback where ticket = any($1)', [tickets]); return r.rows; },
    async list({ status, after, limit }) {
      const r = await db.query(`select id, kind, text, ctx, status, note, triage, dup_of, created_at, updated_at, shot is not null as has_shot, ip_hash
        from feedback where ($1::text is null or status = $1) and id > $2 order by id limit $3`, [status, after, limit]);
      return r.rows.map((x) => ({ ...x, id: Number(x.id), dup_of: x.dup_of == null ? null : Number(x.dup_of) }));
    },
    async counts() { const r = await db.query('select status, count(*)::int n from feedback group by status'); return Object.fromEntries(r.rows.map((x) => [x.status, x.n])); },
    async shot(id) { const r = await db.query('select shot from feedback where id = $1', [id]); return r.rows[0]?.shot || null; },
    async update(id, f) {
      const r = await db.query(`update feedback set status = coalesce($2, status), note = case when $3::boolean then $4 else note end,
        triage = coalesce($5, triage), dup_of = coalesce($6, dup_of), updated_at = now() where id = $1 returning id`,
        [id, f.status ?? null, f.note !== undefined, f.note ?? null, f.triage ?? null, f.dup_of ?? null]);
      return r.rowCount > 0;
    }
  };
}

export function memoryStore() {
  const rows = [];
  const since = (ms) => Date.now() - ms;
  return {
    rows,
    async migrate() {},
    async recentByKey(key, ms) { return rows.find((r) => r.text_key === key && r.created > since(ms)) || null; },
    async countSince(ms) { return rows.filter((r) => r.created > since(ms)).length; },
    async insert(row) { const id = rows.length + 1; rows.push({ ...row, id, status: 'new', note: null, triage: null, dup_of: null, created: Date.now(), created_at: new Date().toISOString(), updated_at: new Date().toISOString() }); return id; },
    async byTickets(t) { return rows.filter((r) => t.includes(r.ticket)).map((r) => ({ ticket: r.ticket, status: r.status, note: r.note })); },
    async list({ status, after, limit }) {
      return rows.filter((r) => (!status || r.status === status) && r.id > after).slice(0, limit)
        .map((r) => { const { shot, text_key, created, ticket, ...rest } = r; void text_key; void created; void ticket; return { ...rest, has_shot: !!shot }; });
    },
    async counts() { const c = {}; for (const r of rows) c[r.status] = (c[r.status] || 0) + 1; return c; },
    async shot(id) { return rows.find((r) => r.id === id)?.shot || null; },
    async update(id, f) {
      const r = rows.find((x) => x.id === id); if (!r) return false;
      if (f.status) r.status = f.status; if (f.note !== undefined) r.note = f.note; if (f.triage) r.triage = f.triage; if (f.dup_of) r.dup_of = f.dup_of;
      r.updated_at = new Date().toISOString(); return true;
    }
  };
}

// ---------- маршрути ----------
/**
 * Обробник маршрутів /feedback/* і /admin/feedback*. Повертає false, якщо шлях не його.
 * h: { send(code, obj), body(req, limit), limited(key, max), ip, isAdmin(req) } — помічники server.mjs.
 */
export function feedbackRoutes(store) {
  const used = new Map(); // використані виклики → до коли пам'ятати
  setInterval(() => { const now = Date.now(); for (const [k, t] of used) if (t < now) used.delete(k); }, 60000).unref();
  // ліміти рахують лише прийняті записи: помилка в тексті чи «короткий» відгук не з'їдає квоту гравця
  const quota = new Map(); // ip_hash → часи прийнятих записів (мс)
  setInterval(() => { const old = Date.now() - 86400000; for (const [k, a] of quota) { const f = a.filter((t) => t > old); if (f.length) quota.set(k, f); else quota.delete(k); } }, 600000).unref();
  const overQuota = (ih) => { const a = quota.get(ih) || [], now = Date.now(); return a.filter((t) => t > now - 600000).length >= 4 || a.filter((t) => t > now - 86400000).length >= 20; };
  const spend = (ih) => { const a = quota.get(ih) || []; a.push(Date.now()); quota.set(ih, a); };
  let hourCount = 0, hourAt = 0;
  async function difficulty() {
    if (Date.now() - hourAt > 60000) { hourCount = await store.countSince(3600000); hourAt = Date.now(); }
    return 18 + (hourCount > 60 ? 2 : 0) + (hourCount > 150 ? 2 : 0); // ~0.2 с на телефоні; під навалою — у 4–16 разів довше
  }

  return async function route(req, res, p, url, h) {
    const { send } = h;
    if (p === '/feedback/challenge' && req.method === 'GET') {
      if (h.limited('fc:' + h.ip, 30)) return send(429, { error: 'slow down' }), true;
      const bits = await difficulty();
      return send(200, { challenge: makeChallenge(bits), bits, ttl: CHALLENGE_TTL }), true;
    }
    if (p === '/feedback' && req.method === 'POST') {
      const ih = ipHash(h.ip);
      if (h.limited('fp:' + ih, 20) || overQuota(ih)) return send(429, { error: 'slow down' }), true;
      if (hourCount >= 300 && Date.now() - hourAt < 60000) return send(429, { error: 'busy' }), true;
      const b = await h.body(req, 700000);
      // бот заповнив приманку або «написав» за пів секунди — вдати, що прийняли, і нічого не зберегти
      if (b.website || Number(b.ms) < 1500) return send(201, { ok: true, no: 0, ticket: crypto.randomBytes(12).toString('base64url') }), true;
      const bad = checkPow(b.challenge, b.nonce, used);
      if (bad) return send(400, { error: bad }), true;
      if (!KINDS.includes(b.kind)) return send(400, { error: 'kind' }), true;
      const t = cleanText(b.text);
      if (t.error) return send(400, { error: t.error }), true;
      const s = cleanShot(b.shot);
      if (s.error) return send(400, { error: s.error }), true;
      let ctx = b.ctx && typeof b.ctx === 'object' && !Array.isArray(b.ctx) ? b.ctx : {};
      if (JSON.stringify(ctx).length > CTX_MAX) ctx = { truncated: true, build: ctx.build, game: ctx.game, device: ctx.device };
      const key = textKey(t.text);
      const dup = await store.recentByKey(key, 86400000); // той самий текст за добу (подвійне натискання, повтор) — той самий запис
      if (dup) return send(200, { ok: true, no: dup.id, ticket: dup.ticket }), true;
      const ticket = crypto.randomBytes(12).toString('base64url');
      const id = await store.insert({ ticket, kind: b.kind, text: t.text, text_key: key, ctx, shot: s.buf, ip_hash: ih });
      spend(ih); hourCount++;
      console.log('feedback', id, b.kind, t.text.length, 'chars', s.buf ? 'shot' : '');
      return send(201, { ok: true, no: id, ticket }), true;
    }
    if (p === '/feedback/status' && req.method === 'GET') {
      if (h.limited('fs:' + h.ip, 30)) return send(429, { error: 'slow down' }), true;
      const tickets = String(url.searchParams.get('t') || '').split(',').filter((x) => /^[A-Za-z0-9_-]{16}$/.test(x)).slice(0, 30);
      const rows = tickets.length ? await store.byTickets(tickets) : [];
      return send(200, { rows: rows.map((r) => ({ ticket: r.ticket, status: STATUSES[r.status] || 'new', note: r.note || null })) }), true;
    }

    // ---------- розробник (ключ x-admin-key: ADMIN_KEY або FEEDBACK_KEY) ----------
    if (!p.startsWith('/admin/feedback')) return false;
    if (!h.isAdmin(req)) return send(403, { error: 'admin' }), true;
    if (p === '/admin/feedback' && req.method === 'GET') {
      const status = url.searchParams.get('status') || null, after = Math.max(0, Number(url.searchParams.get('after') || 0)), limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') || 50)));
      if (status && !(status in STATUSES)) return send(400, { error: 'status' }), true;
      return send(200, { counts: await store.counts(), rows: await store.list({ status, after, limit }) }), true;
    }
    const m = /^\/admin\/feedback\/(\d+)(\/shot)?$/.exec(p);
    if (m && m[2] && req.method === 'GET') {
      const shot = await store.shot(Number(m[1]));
      if (!shot) return send(404, { error: 'no shot' }), true;
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store', 'Content-Length': shot.length });
      res.end(shot);
      return true;
    }
    if (m && !m[2] && req.method === 'POST') {
      const b = await h.body(req, 20000);
      if (b.status !== undefined && !(b.status in STATUSES)) return send(400, { error: 'status' }), true;
      if (b.note !== undefined && b.note !== null && (typeof b.note !== 'string' || b.note.length > 300)) return send(400, { error: 'note' }), true;
      const ok = await store.update(Number(m[1]), { status: b.status, note: b.note, triage: b.triage && typeof b.triage === 'object' ? b.triage : undefined, dup_of: Number(b.dup_of) || undefined });
      return send(ok ? 200 : 404, ok ? { ok: true } : { error: 'not found' }), true;
    }
    return false;
  };
}
