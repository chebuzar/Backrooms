// Гра як веб-додаток («На экран „Домой“»): чи запущена так, на якій платформі, і системна кнопка встановлення (Android/Chrome).
// Більшість грає саме так (Назар, 23.11): без панелей браузера, на весь екран.

/** Запущено з головного екрана (iOS — navigator.standalone, решта — display-mode з маніфесту). */
export function isStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true || ['fullscreen', 'standalone', 'minimal-ui'].some((m) => matchMedia(`(display-mode: ${m})`).matches);
}

/** iOS/iPadOS (iPad з iPadOS 13+ видає себе за Mac, але має сенсорний екран), Android чи інше. */
export function platform(): 'ios' | 'android' | 'other' {
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'ios';
  if (/Android/.test(ua)) return 'android';
  return 'other';
}

interface InstallPrompt extends Event { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> }
let deferred: InstallPrompt | null = null;
const listeners = new Set<() => void>();
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault(); // свою кнопку покажемо в памятці, а не системну смугу знизу
  deferred = e as InstallPrompt;
  for (const f of listeners) f();
});
window.addEventListener('appinstalled', () => { deferred = null; for (const f of listeners) f(); });

/** Чи можна встановити кнопкою (Chrome/Edge/Android). */
export function canInstall(): boolean { return !!deferred; }
export function onInstallChange(f: () => void): () => void { listeners.add(f); return () => listeners.delete(f); }
export async function install(): Promise<boolean> {
  const d = deferred;
  if (!d) return false;
  deferred = null;
  await d.prompt();
  return (await d.userChoice).outcome === 'accepted';
}
