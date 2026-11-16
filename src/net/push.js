// Уведомления о больших обновлениях (Web Push). Сервер шлёт их только когда меняется public/release.json —
// это делается лишь после завершения всего плана работ, не при каждом мелком обновлении.
import { SERVER } from './config.js';

const PK = 'zk_push';
const ua = navigator.userAgent;
const isIOS = /iP(hone|ad|od)/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
const standalone = () => (window.matchMedia && (matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches)) || navigator.standalone === true;
const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

// 'on' | 'off' | 'denied' | 'unsupported' | 'ios-install'
export function pushState() {
  if (isIOS && !standalone()) return 'ios-install';
  if (!supported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  let on = false; try { on = localStorage.getItem(PK) === '1'; } catch (e) { /* нет хранилища */ }
  return on && Notification.permission === 'granted' ? 'on' : 'off';
}
const u8 = (b64) => { const s = atob((b64 + '='.repeat((4 - b64.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(s, (c) => c.charCodeAt(0)); };

// вызывать прямо из нажатия (Safari разрешает запрос только по жесту)
export async function pushEnable(lang) {
  const st = pushState(); if (st === 'ios-install' || st === 'unsupported') return st;
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return 'denied';
  try {
    const reg = await navigator.serviceWorker.register('./sw.js');
    await navigator.serviceWorker.ready;
    const { key } = await (await fetch(SERVER + '/vapid')).json();
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: u8(key) });
    const r = await fetch(SERVER + '/push/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sub: sub.toJSON(), lang }) });
    if (!r.ok) return 'error';
    localStorage.setItem(PK, '1');
    return 'on';
  } catch (e) { return 'error'; }
}
export async function pushDisable() {
  try { localStorage.removeItem(PK); } catch (e) { /* нет хранилища */ }
  try {
    const reg = supported() && await navigator.serviceWorker.getRegistration();
    const sub = reg && await reg.pushManager.getSubscription();
    if (sub) { fetch(SERVER + '/push/unsubscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: sub.endpoint }) }); await sub.unsubscribe(); }
  } catch (e) { /* уже отписан */ }
  return 'off';
}
