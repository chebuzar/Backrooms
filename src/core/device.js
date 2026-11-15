// Определение устройства: платформа (Apple / Android / прочее), форм-фактор и сила видеокарты (уровень 0–3).
// Сила — по базе реальных замеров detect-gpu (тысячи GPU); база лежит в сборке игры, внешних запросов нет.
// Отладка: ?apple / ?android — притвориться платформой, ?tier=0..3 — задать силу.
import { getGPUTier } from '@pmndrs/detect-gpu';

const BENCH = import.meta.glob('/node_modules/@pmndrs/detect-gpu/dist/benchmarks/*.json', { query: '?url', import: 'default', eager: true });
const benchUrl = (file) => { for (const k in BENCH) if (k.endsWith('/' + file)) return BENCH[k]; return null; };

const qs = new URLSearchParams(location.search);
const ua = navigator.userAgent || '';
const touch = navigator.maxTouchPoints || 0;
// iPadOS Safari представляется «Macintosh», но с сенсорным экраном
const iOS = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && touch > 1);
const mac = /Macintosh/.test(ua) && !iOS;
const android = /Android/i.test(ua);

export const platform = qs.has('android') ? 'android' : qs.has('apple') ? 'apple' : iOS || mac ? 'apple' : android ? 'android' : 'other';
export const isAndroid = platform === 'android';
export const isApple = platform === 'apple';
const tablet = /iPad/.test(ua) || (iOS && /Macintosh/.test(ua)) || (android && !/Mobile/.test(ua));
export const form = iOS || android ? (tablet ? 'tablet' : 'phone') : 'desktop';

// запасной вариант, если база не ответила: по имени видеочипа
function guessTier(gpu) {
  const g = (gpu || '').toLowerCase();
  if (/swiftshader|llvmpipe|software/.test(g)) return 0;
  if (isApple) return 2;
  if (isAndroid) {
    if (/adreno\D*(7[3-9]\d|8\d\d)|immortalis|xclipse|mali-g7[1-9]\d|mali-g9\d\d/.test(g)) return 3;
    if (/adreno\D*(6[4-9]\d|7[0-2]\d)|mali-g(6[18]|7[0-8]|5[27])/.test(g)) return 2;
    return 1;
  }
  return 2;
}

function rendererName(gl) {
  try { const e = gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER); } catch (e) { return ''; }
}

export const device = { platform, form, tier: 2, gpu: '', source: 'guess' };

export async function detectDevice(gl) {
  device.gpu = rendererName(gl);
  device.tier = guessTier(device.gpu);
  if (qs.has('tier')) { device.tier = Math.max(0, Math.min(3, Number(qs.get('tier')) | 0)); device.source = 'url'; return device; }
  try {
    const r = await Promise.race([
      getGPUTier({
        glContext: gl,
        override: {
          loadBenchmarks: async (file) => {
            const u = benchUrl(file); if (!u) throw new Error('no benchmark ' + file);
            const res = await fetch(u); if (!res.ok) throw new Error('benchmark ' + res.status);
            return res.json();
          }
        }
      }),
      new Promise((res) => setTimeout(() => res(null), 3000))
    ]);
    if (r && (r.type === 'BENCHMARK' || r.type === 'BLOCKLISTED')) {
      device.tier = r.tier; device.source = r.type.toLowerCase();
      if (r.gpu) device.gpu = r.gpu;
      if (r.device) device.model = r.device;
      if (r.fps) device.fps = Math.round(r.fps);
    }
  } catch (e) { /* остаётся оценка по имени видеочипа */ }
  return device;
}

// Профиль графики для «Авто»
export function autoProfile(d = device) {
  const t = d.tier;
  if (d.platform === 'android') return t >= 3 ? 'droidHigh' : t === 2 ? 'droid' : t === 1 ? 'droidLow' : 'low';
  // Apple: чипы A/M с общей быстрой памятью и дешёвым MSAA — на ступень выше
  if (d.platform === 'apple') return t >= 3 ? 'ultra' : t === 2 ? 'high' : t === 1 ? 'med' : 'low';
  return t >= 2 ? 'high' : t === 1 ? 'med' : 'low';
}
