const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const easeOut = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);

function rng(seed) {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function angleDiff(a, b) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

const pick = (arr) => arr[(Math.random() * arr.length) | 0];

const KEY = 'zakulisye_v2';
const store = {
  load() { try { return JSON.parse(localStorage.getItem(KEY) || 'null') || {}; } catch (e) { return {}; } },
  save(o) { try { localStorage.setItem(KEY, JSON.stringify(o)); } catch (e) { /* хранилище недоступно */ } }
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const frames = (n = 1) => new Promise((r) => { const f = () => (--n <= 0 ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });

export { clamp, lerp, smooth, easeOut, rng, angleDiff, pick, store, sleep, frames };
