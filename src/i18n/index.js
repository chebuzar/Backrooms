// Локализация: t(key, vars) и разметка data-i18n в index.html.
//
// Атрибуты в HTML:
//   data-i18n="key"        — textContent
//   data-i18n-html="key"   — innerHTML (для строк с <b>, <kbd>, <br>; только доверенные строки из локалей)
//   data-i18n-attr="attr:key;attr2:key2" — атрибуты (aria-label, placeholder, content…)
//
// Язык: ?lang=xx в адресе > сохранённый выбор > язык браузера > русский.
// Пока игровые строки в JS не перенесены в словари, выбор языка в интерфейсе скрыт
// (I18N_READY = false), а остальные языки доступны только через ?lang= для проверки.
import ru from './locales/ru.js';
import uk from './locales/uk.js';
import en from './locales/en.js';

export const LOCALES = { ru, uk, en };
export const LANG_NAMES = { ru: 'Русский', uk: 'Українська', en: 'English' };
export const DEFAULT_LANG = 'ru';
export const I18N_READY = false;
const KEY = 'zakulisye_lang';

function detect() {
  try {
    const q = new URLSearchParams(location.search).get('lang');
    if (q && LOCALES[q]) return q;
  } catch (e) { /* ignore */ }
  if (!I18N_READY) return DEFAULT_LANG;
  try {
    const s = localStorage.getItem(KEY);
    if (s && LOCALES[s]) return s;
  } catch (e) { /* ignore */ }
  for (const l of navigator.languages || [navigator.language || '']) {
    const c = String(l).slice(0, 2).toLowerCase();
    if (LOCALES[c]) return c;
  }
  return DEFAULT_LANG;
}

let lang = detect();
export const getLang = () => lang;

export function t(key, vars) {
  let s = LOCALES[lang][key];
  if (s === undefined) s = LOCALES[DEFAULT_LANG][key];
  if (s === undefined) { if (import.meta.env.DEV) console.warn('[i18n] нет ключа', key); return key; }
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? vars[k] : m));
  return s;
}

export function applyI18n(root = document) {
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll('[data-i18n-html]')) el.innerHTML = t(el.dataset.i18nHtml);
  for (const el of root.querySelectorAll('[data-i18n-attr]')) {
    for (const pair of el.dataset.i18nAttr.split(';')) {
      const [attr, key] = pair.split(':').map((x) => x.trim());
      if (attr && key) el.setAttribute(attr, t(key));
    }
  }
  if (root === document) {
    document.documentElement.lang = lang;
    document.title = t('meta.title');
  }
}

export function setLang(l) {
  if (!LOCALES[l] || l === lang) return;
  lang = l;
  try { localStorage.setItem(KEY, l); } catch (e) { /* ignore */ }
  applyI18n();
  window.dispatchEvent(new CustomEvent('langchange', { detail: l }));
}
