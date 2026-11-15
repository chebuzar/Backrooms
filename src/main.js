// Точка входа: шрифты, стили, локализация, проверка WebGL, затем сама игра.
import '@fontsource/caveat/600.css';
import '@fontsource/caveat/700.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/600.css';
import '@fontsource/rubik-glitch/400.css';
import '@fontsource/rubik-mono-one/400.css';
import './styles/main.css';
import { applyI18n, t } from './i18n/index.js';

window.__zkT = t;
applyI18n();

function hasWebGL() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGL2RenderingContext && c.getContext('webgl2')) || !!c.getContext('webgl');
  } catch (e) {
    return false;
  }
}

if (!hasWebGL()) {
  window.__zkFail(t('load.noWebgl'));
} else {
  import('./game.js').catch((e) => {
    console.error(e);
    window.__zkFail(t('load.startError', { msg: e.message }));
  });
}
