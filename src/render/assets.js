// Загрузка фото-текстур (CC0, public/assets/tex/<id>/{c,n,r}.jpg) с кэшем.
import * as THREE from 'three';

const BASE = (import.meta.env && import.meta.env.BASE_URL ? import.meta.env.BASE_URL : './') + 'assets/tex/';
const loader = new THREE.TextureLoader();
const cache = new Map();
let aniso = 8, hi = true;
export const setAniso = (a) => { aniso = a; };
// Full HD: 2K-карты цвета и нормалей; на «Низкой» графике — 1K
export const setTexHi = (v) => { if (hi !== v) { hi = v; cache.clear(); } };

function load(url, srgb) {
  return new Promise((res) => {
    loader.load(url, (t) => {
      t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = aniso;
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      res(t);
    }, undefined, () => res(null));
  });
}
// набор карт материала; null, если не загрузился (тогда остаётся текстура, нарисованная кодом)
export function texSet(id) {
  if (!id) return Promise.resolve(null);
  if (!cache.has(id)) {
    const s = hi ? '2k' : '';
    cache.set(id, Promise.all([load(BASE + id + '/c' + s + '.jpg', true), load(BASE + id + '/n' + s + '.jpg'), load(BASE + id + '/r.jpg')])
      .then(([c, n, r]) => (c ? { id, c, n, r } : null)));
  }
  return cache.get(id);
}
// все поверхности темы: { wall, floor, ceil } → наборы карт + настройки
export async function themeTex(th) {
  const P = th.pbr; if (!P) return null;
  const out = {};
  await Promise.all(['wall', 'floor', 'ceil', 'pool'].map(async (k) => {
    if (!P[k]) return;
    const s = await texSet(P[k].id);
    if (s) out[k] = Object.assign({}, P[k], s);
  }));
  return out;
}
