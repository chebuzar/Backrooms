// Перевірка MCP-серверів із .mcp.json справжнім викликом інструмента.
//   node scripts/mcp-check.mjs <сервер> [інструмент JSON-аргументи]...
// Без інструментів — лише список інструментів сервера.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';

const [name, ...calls] = process.argv.slice(2);
const cfg = JSON.parse(readFileSync(new URL('../.mcp.json', import.meta.url))).mcpServers[name];
if (!cfg) { console.error('немає сервера ' + name); process.exit(1); }
const env = { ...process.env };
for (const [k, v] of Object.entries(cfg.env || {})) env[k] = v.replace(/\$\{(\w+)(?::-([^}]*))?\}/g, (_, n, d) => process.env[n] ?? d ?? '');
const child = spawn(cfg.command, cfg.args, { env, stdio: ['pipe', 'pipe', 'pipe'] });
let buf = '', id = 0;
const waiting = new Map();
child.stdout.on('data', (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    try { const m = JSON.parse(line); if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); } } catch {}
  }
});
const rpc = (method, params) => new Promise((res, rej) => {
  const my = ++id;
  const t = setTimeout(() => rej(new Error('timeout ' + method)), 180000);
  waiting.set(my, (m) => { clearTimeout(t); res(m); });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: my, method, params }) + '\n');
});
let failed = false;
try {
  const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'mcp-check', version: '1' } });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  console.log(`[${name}] ${init.result.serverInfo.name} ${init.result.serverInfo.version}`);
  const tools = (await rpc('tools/list', {})).result.tools.map((t) => t.name);
  console.log(`[${name}] інструментів: ${tools.length}: ${tools.join(', ')}`);
  for (let k = 0; k < calls.length; k += 2) {
    const r = await rpc('tools/call', { name: calls[k], arguments: JSON.parse(calls[k + 1] || '{}') });
    const res = r.result || {};
    const text = (res.content || []).map((c) => c.type === 'text' ? c.text : `[${c.type}]`).join(' ').replace(/\s+/g, ' ');
    if (r.error || res.isError) failed = true;
    console.log(`[${name}] ${calls[k]} → ${r.error ? 'ПОМИЛКА ' + JSON.stringify(r.error) : (res.isError ? 'ПОМИЛКА ' : 'OK ') + text.slice(0, 600)}`);
  }
} catch (e) { failed = true; console.log(`[${name}] ПОМИЛКА ${e.message}`); }
child.kill();
process.exit(failed ? 1 : 0);
