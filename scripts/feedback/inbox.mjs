// Скринька відгуків гравців — для Claude (розбір за docs/FEEDBACK.md).
//   npm run feedback -- list [--status new|bug|idea|…|all] [--after ID] [--limit N]   нові записи + знімки в .shots/feedback/
//   npm run feedback -- show ID                                                         один запис з усіма відомостями
//   npm run feedback -- set ID STATUS [--note "відповідь гравцю"] [--why "…"] [--issue N] [--pr N] [--dup ID]
//   npm run feedback -- stats
// Сервер — ZK_SERVER (типово сервер гри на Ample). Ключ — ZK_FEEDBACK_KEY (= FEEDBACK_KEY на сервері);
// якщо його немає в змінних, запит іде без заголовка — його додає мережевий секрет середовища (див. docs/FEEDBACK.md).
import { mkdirSync, writeFileSync } from 'node:fs';

const SERVER = (process.env.ZK_SERVER || 'https://2x34tgfzwyad.ample.run').replace(/\/$/, '');
const KEY = process.env.ZK_FEEDBACK_KEY || '';
const STATUSES = ['new', 'bug', 'idea', 'planned', 'fixed', 'done', 'declined', 'duplicate', 'spam'];
const [cmd = 'list', ...rest] = process.argv.slice(2);
const opt = (name, def = null) => { const i = rest.indexOf('--' + name); return i >= 0 ? rest[i + 1] : def; };
const OUT = '.shots/feedback';

async function api(path, init = {}) {
  const headers = { 'Content-Type': 'application/json', ...(KEY ? { 'x-admin-key': KEY } : {}) };
  const r = await fetch(SERVER + path, { ...init, headers });
  if (r.status === 403) throw new Error(`403: немає доступу. Потрібен ключ: ZK_FEEDBACK_KEY або мережевий секрет для ${new URL(SERVER).host} (docs/FEEDBACK.md)`);
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r;
}

function summary(r) {
  const c = r.ctx || {}, g = c.game || {}, d = c.device || {};
  const ua = String(d.ua || '');
  const browser = /Firefox\/\d+/.exec(ua)?.[0] || /Edg\/\d+/.exec(ua)?.[0] || /Chrome\/\d+/.exec(ua)?.[0] || (/Safari/.test(ua) ? 'Safari ' + (/Version\/([\d.]+)/.exec(ua)?.[1] || '') : ua.slice(0, 40));
  const os = /iPhone|iPad|Macintosh|Windows|Android|Linux/.exec(ua)?.[0] || '?';
  return [
    `#${r.id} [${r.kind}] ${r.status}${r.dup_of ? ' → #' + r.dup_of : ''}  ${String(r.created_at).slice(0, 16).replace('T', ' ')} UTC  ${r.has_shot ? '📷 ' + OUT + '/' + r.id + '.jpg' : ''}`,
    `  збірка ${String(c.build?.commit || '?').slice(0, 8)} (${c.site || '?'})  рівень ${g.level ? `${g.level.id} seed ${g.level.seed}` : '—'}  місце ${JSON.stringify(g.pos)}  режим ${g.mode}`,
    `  ${os}, ${browser}, ${g.render?.backend || '?'} «${g.render?.gpu || ''}», якість ${g.quality?.profile}/${g.quality?.setting}, fps ${c.fps ? c.fps.avg + ' (1%: ' + c.fps.low + ')' : '—'}, екран ${JSON.stringify(d.view)}×${d.dpr}`,
    ...(c.errors?.length ? [`  помилки консолі (${c.errors.length}): ` + c.errors.slice(-3).map((e) => `[${e.kind} ${e.t}s] ${e.msg.split('\n')[0].slice(0, 160)}`).join(' | ')] : []),
    ...String(r.text).split('\n').map((l) => '  > ' + l),
    ...(r.note ? [`  відповідь гравцю: ${r.note}`] : []),
    ...(r.triage ? [`  розбір: ${JSON.stringify(r.triage)}`] : [])
  ].join('\n');
}

async function list() {
  const status = opt('status', 'new'), after = opt('after', '0'), limit = opt('limit', '100');
  const q = new URLSearchParams({ after, limit, ...(status !== 'all' ? { status } : {}) });
  const data = await (await api('/admin/feedback?' + q)).json();
  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}/inbox.json`, JSON.stringify(data, null, 1));
  for (const r of data.rows) if (r.has_shot) writeFileSync(`${OUT}/${r.id}.jpg`, Buffer.from(await (await api(`/admin/feedback/${r.id}/shot`)).arrayBuffer()));
  console.log(`Сервер ${SERVER}. Усього за статусами: ${JSON.stringify(data.counts)}. Показано (${status}): ${data.rows.length}. Повні дані — ${OUT}/inbox.json\n`);
  for (const r of data.rows) console.log(summary(r) + '\n');
}

async function show(id) {
  const data = await (await api(`/admin/feedback?status=&after=${Number(id) - 1}&limit=1`)).json();
  const r = data.rows.find((x) => x.id === Number(id));
  if (!r) throw new Error('немає запису #' + id);
  if (r.has_shot) { mkdirSync(OUT, { recursive: true }); writeFileSync(`${OUT}/${r.id}.jpg`, Buffer.from(await (await api(`/admin/feedback/${r.id}/shot`)).arrayBuffer())); }
  console.log(summary(r));
  console.log(JSON.stringify(r.ctx, null, 1));
}

async function set(id, status) {
  if (!STATUSES.includes(status)) throw new Error('статус: ' + STATUSES.join(' | '));
  const triage = { by: 'claude', at: new Date().toISOString(), ...(opt('why') ? { why: opt('why') } : {}), ...(opt('issue') ? { issue: Number(opt('issue')) } : {}), ...(opt('pr') ? { pr: Number(opt('pr')) } : {}) };
  const note = opt('note');
  await api(`/admin/feedback/${Number(id)}`, { method: 'POST', body: JSON.stringify({ status, triage, ...(note !== null ? { note } : {}), ...(opt('dup') ? { dup_of: Number(opt('dup')) } : {}) }) });
  console.log(`#${id} → ${status}${note ? ` (гравцю: «${note}»)` : ''}`);
}

try {
  if (cmd === 'list') await list();
  else if (cmd === 'show') await show(rest[0]);
  else if (cmd === 'set') await set(rest[0], rest[1]);
  else if (cmd === 'stats') console.log(JSON.stringify((await (await api('/admin/feedback?limit=1')).json()).counts));
  else { console.log('команди: list | show ID | set ID STATUS | stats'); process.exitCode = 2; }
} catch (e) { console.error(String(e.message || e)); process.exitCode = 1; }
