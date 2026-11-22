// Журнал помилок сторінки: останні помилки й попередження консолі, необроблені винятки.
// Нічого не надсилає сам — лише додається до відгуку гравця, щоб баг можна було відтворити.
export interface LoggedError { t: number; kind: 'error' | 'warn' | 'uncaught' | 'rejection'; msg: string }

const MAX = 30;
const items: LoggedError[] = [];
const t0 = performance.now();
let installed = false;

function text(args: unknown[]): string {
  return args.map((a) => a instanceof Error ? `${a.name}: ${a.message}${a.stack ? '\n' + a.stack.split('\n').slice(1, 6).join('\n') : ''}`
    : typeof a === 'string' ? a : (() => { try { return JSON.stringify(a); } catch { return String(a); } })()).join(' ').slice(0, 1200);
}

function push(kind: LoggedError['kind'], msg: string): void {
  const last = items[items.length - 1];
  if (last && last.msg === msg && last.kind === kind) return; // та сама помилка щокадру — один запис
  items.push({ t: Math.round((performance.now() - t0) / 100) / 10, kind, msg });
  if (items.length > MAX) items.shift();
}

/** Підключається сам при першому імпорті (main.ts імпортує цей модуль першим). Оригінальні console.* працюють як і раніше. */
export function installErrorLog(): void {
  if (installed) return;
  installed = true;
  for (const kind of ['error', 'warn'] as const) {
    const orig = console[kind].bind(console);
    console[kind] = (...args: unknown[]) => { push(kind, text(args)); orig(...args); };
  }
  addEventListener('error', (e) => push('uncaught', text([e.error ?? e.message, `@ ${e.filename}:${e.lineno}:${e.colno}`])));
  addEventListener('unhandledrejection', (e) => push('rejection', text([e.reason])));
}

/** Копія журналу (від старого до нового); час — секунди від запуску сторінки. */
export function recentErrors(): LoggedError[] { return items.map((x) => ({ ...x })); }

installErrorLog();
