// Повний екран: Safari на iPad і Mac (зі старим префіксом webkit), Chrome, Firefox. На iPhone Safari повний екран
// дозволено лише відео — там (і у веб-додатку з головного екрана, який і так на весь екран) кнопку не показуємо.
import { isStandalone } from './webapp';

interface FsDoc { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => Promise<void> | void; webkitFullscreenEnabled?: boolean }
interface FsEl { webkitRequestFullscreen?: (o?: FullscreenOptions) => Promise<void> | void }

export function canFullscreen(): boolean {
  if (isStandalone()) return false;
  const d = document as Document & FsDoc;
  return !!(d.fullscreenEnabled || d.webkitFullscreenEnabled);
}

export function isFullscreen(): boolean {
  const d = document as Document & FsDoc;
  return !!(d.fullscreenElement ?? d.webkitFullscreenElement);
}

/** Увімкнути/вимкнути (лише з жесту гравця — інакше браузер відмовить). */
export async function toggleFullscreen(): Promise<void> {
  const d = document as Document & FsDoc, el = document.documentElement as HTMLElement & FsEl;
  try {
    if (isFullscreen()) await (d.exitFullscreen ? d.exitFullscreen() : d.webkitExitFullscreen?.());
    else await (el.requestFullscreen ? el.requestFullscreen({ navigationUI: 'hide' }) : el.webkitRequestFullscreen?.());
  } catch { /* браузер відмовив (не з жесту, заборонено політикою) — лишаємось як є */ }
}

/** Зміна стану (зокрема вихід свайпом / Esc). */
export function onFullscreenChange(f: () => void): void {
  document.addEventListener('fullscreenchange', f);
  document.addEventListener('webkitfullscreenchange', f);
}
