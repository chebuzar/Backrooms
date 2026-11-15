// Мелкие детали на стенах: розетки, выключатели, вентрешётки, электрощиты, пожарные кнопки, огнетушители,
// листки бумаги, трафаретные номера. Делают пустые стены «настоящими».
// Каждая деталь — экземпляр InstancedMesh (одна отрисовка на вид), свет — запечённый, как у стены под ней (ibake).
import * as THREE from 'three';

const cv = (w, h, draw) => { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); return c; };
const rr = (x, a, b, w, h, r) => { x.beginPath(); x.roundRect(a, b, w, h, r); x.fill(); };

const DRAW = {
  outlet: (x, w, h) => {
    x.fillStyle = '#e9e4d6'; rr(x, 2, 2, w - 4, h - 4, 10); x.strokeStyle = 'rgba(0,0,0,.25)'; x.lineWidth = 3; x.stroke();
    x.fillStyle = '#d8d2c2'; rr(x, 14, 22, w - 28, h - 44, 8);
    for (const cy of [h * 0.36, h * 0.64]) { x.fillStyle = '#1d1a16'; x.fillRect(w * 0.36, cy - 7, 6, 14); x.fillRect(w * 0.58, cy - 7, 6, 14); }
    x.fillStyle = '#888'; x.beginPath(); x.arc(w / 2, h / 2, 4, 0, 7); x.fill();
  },
  switch: (x, w, h) => {
    x.fillStyle = '#ebe6d8'; rr(x, 2, 2, w - 4, h - 4, 10); x.strokeStyle = 'rgba(0,0,0,.25)'; x.lineWidth = 3; x.stroke();
    x.fillStyle = '#cfc8b6'; rr(x, w * 0.36, h * 0.3, w * 0.28, h * 0.4, 5); x.fillStyle = '#f6f2e8'; rr(x, w * 0.39, h * 0.32, w * 0.22, h * 0.18, 4);
  },
  vent: (x, w, h) => {
    x.fillStyle = '#9a9890'; x.fillRect(0, 0, w, h); x.fillStyle = '#2a2824';
    for (let i = 0; i < 11; i++) x.fillRect(10, 12 + i * (h - 24) / 11, w - 20, (h - 24) / 22);
    x.strokeStyle = '#6a6860'; x.lineWidth = 6; x.strokeRect(3, 3, w - 6, h - 6);
    x.fillStyle = 'rgba(40,30,15,.35)'; x.fillRect(0, h * 0.8, w, h * 0.2);
  },
  panel: (x, w, h) => {
    const g = x.createLinearGradient(0, 0, w, h); g.addColorStop(0, '#a3a69e'); g.addColorStop(1, '#7e817a'); x.fillStyle = g; x.fillRect(0, 0, w, h);
    x.strokeStyle = '#55584f'; x.lineWidth = 4; x.strokeRect(8, 8, w - 16, h - 16); x.fillStyle = '#e8c21a'; x.beginPath(); x.moveTo(w / 2, h * 0.18); x.lineTo(w * 0.66, h * 0.42); x.lineTo(w * 0.34, h * 0.42); x.fill();
    x.fillStyle = '#111'; x.font = `bold ${w * 0.18}px sans-serif`; x.textAlign = 'center'; x.fillText('⚡', w / 2, h * 0.4);
    x.fillStyle = '#ddd'; x.fillRect(w * 0.2, h * 0.55, w * 0.6, h * 0.1); x.fillStyle = '#444'; x.fillRect(w * 0.82, h * 0.45, 6, h * 0.16);
    x.fillStyle = 'rgba(90,50,20,.4)'; for (let i = 0; i < 6; i++) x.fillRect(Math.random() * w, h * 0.7 + Math.random() * h * 0.25, 3, 10 + Math.random() * 20);
  },
  alarm: (x, w, h) => {
    x.fillStyle = '#b8141a'; rr(x, 2, 2, w - 4, h - 4, 8); x.fillStyle = '#e8e2d6'; x.fillRect(w * 0.18, h * 0.12, w * 0.64, h * 0.22);
    x.fillStyle = '#b8141a'; x.font = `bold ${h * 0.14}px sans-serif`; x.textAlign = 'center'; x.fillText('FIRE', w / 2, h * 0.29);
    x.fillStyle = '#7d0c10'; rr(x, w * 0.28, h * 0.46, w * 0.44, h * 0.36, 6); x.fillStyle = '#f2ece0'; x.fillRect(w * 0.36, h * 0.56, w * 0.28, h * 0.12);
  },
  paper: (x, w, h) => {
    x.fillStyle = '#eeeadf'; x.fillRect(0, 0, w, h); x.fillStyle = 'rgba(120,100,60,.25)'; x.fillRect(0, h * 0.75, w, h * 0.25);
    x.fillStyle = '#2b2a28'; x.font = `bold ${w * 0.1}px monospace`; x.fillText('ВНИМАНИЕ', w * 0.1, h * 0.14);
    for (let i = 0; i < 12; i++) x.fillRect(w * 0.1, h * (0.22 + i * 0.055), w * (0.5 + 0.3 * ((i * 7) % 5) / 5), 3);
    x.fillStyle = '#9a1b1b'; x.fillRect(w * 0.1, h * 0.9, w * 0.35, 4);
    x.fillStyle = '#c8b46a'; x.fillRect(w * 0.42, 0, w * 0.16, h * 0.04);
  },
  stencil: (x, w, h) => {
    x.clearRect(0, 0, w, h); x.fillStyle = 'rgba(232,200,40,.9)'; x.fillRect(0, h * 0.78, w, h * 0.06);
    x.fillStyle = 'rgba(20,18,16,.85)'; x.font = `900 ${h * 0.5}px Impact, sans-serif`; x.textAlign = 'center'; x.fillText('B2', w / 2, h * 0.6);
  }
};
const KIND = {
  outlet: { w: 0.08, h: 0.12, d: 0.012, y: 0.32, tex: [64, 96] },
  switch: { w: 0.085, h: 0.12, d: 0.014, y: 1.18, tex: [64, 96] },
  vent: { w: 0.5, h: 0.26, d: 0.02, y: -0.32, tex: [256, 128] },
  panel: { w: 0.42, h: 0.56, d: 0.12, y: 1.45, tex: [128, 160] },
  alarm: { w: 0.11, h: 0.15, d: 0.035, y: 1.35, tex: [64, 88] },
  paper: { w: 0.21, h: 0.297, d: 0.002, y: 1.45, tex: [128, 180], tilt: 0.08 },
  stencil: { w: 0.9, h: 0.6, d: 0.002, y: 1.6, tex: [256, 170], transparent: true }
};
// набор деталей по темам: вид → вероятность на одну грань стены (2 м)
export const DETAIL_SETS = {
  yellow: { outlet: 0.22, switch: 0.05, vent: 0.08, paper: 0.025 },
  concrete: { panel: 0.05, vent: 0.07, alarm: 0.03, ext: 0.025 },
  parking: { stencil: 0.06, panel: 0.03, ext: 0.03 },
  damp: { outlet: 0.15, vent: 0.1, paper: 0.03 },
  pool: { vent: 0.06 },
  office: { outlet: 0.25, switch: 0.07, paper: 0.06, alarm: 0.025, ext: 0.03 },
  warehouse: { stencil: 0.05, panel: 0.05, alarm: 0.03, ext: 0.04 },
  dark: { outlet: 0.15, vent: 0.08, paper: 0.05, alarm: 0.02 }
};

function instMat(map, uBake, uAmbK, transparent) {
  const m = new THREE.MeshLambertMaterial({ map, transparent: !!transparent, alphaTest: transparent ? 0.05 : 0, depthWrite: !transparent });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uBake = uBake; sh.uniforms.uAmbK = uAmbK;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 ibake;\nvarying vec3 vBake;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvBake = ibake;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBake;\nuniform float uBake;\nuniform float uAmbK;')
      .replace('#include <lights_fragment_maps>', '#include <lights_fragment_maps>\n\tirradiance = irradiance * uAmbK + vBake * uBake;');
  };
  m.customProgramCacheKey = () => 'zk-ibake';
  return m;
}

// faces: [{ o, u, n, bake(x, y, z, n, out) }], hh — высота потолка
export function buildDetails(faces, set, r, hh, uBake, uAmbK, avoid = () => false) {
  const group = new THREE.Group(), out = [0, 0, 0], items = {};
  group.userData.textures = [];
  if (!set) return group;
  for (const f of faces) {
    let used = 0;
    for (const k in set) {
      if (r() >= set[k] || used >= 2) continue;
      const fr = 0.18 + r() * 0.64;
      const x = f.o[0] + f.u[0] * fr, z = f.o[2] + f.u[2] * fr;
      if (avoid(x, z)) continue;
      used++;
      (items[k] = items[k] || []).push({ x, z, y0: f.o[1], n: f.n, bake: f.bake, rot: (r() - 0.5) });
    }
  }
  const dummy = new THREE.Object3D();
  const textures = [];
  for (const k in items) {
    const list = items[k];
    let geo, mat;
    if (k === 'ext') {
      // огнетушитель: красный баллон + чёрный шланг-головка
      const body = new THREE.CylinderGeometry(0.075, 0.075, 0.5, 10); body.translate(0, 0.25, 0);
      const top = new THREE.CylinderGeometry(0.03, 0.05, 0.1, 8); top.translate(0, 0.55, 0);
      geo = mergeTwo(body, top);
      mat = instMat(null, uBake, uAmbK); mat.color.set(0xb01a14);
    } else {
      const K = KIND[k];
      const t = new THREE.CanvasTexture(cv(K.tex[0], K.tex[1], (x, w, h) => DRAW[k](x, w, h)));
      t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; textures.push(t);
      geo = new THREE.BoxGeometry(K.w, K.h, K.d);
      mat = instMat(t, uBake, uAmbK, K.transparent);
    }
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    const ib = new Float32Array(list.length * 3);
    list.forEach((it, i) => {
      const K = KIND[k] || { d: 0.15, y: 0.12 };
      const yy = k === 'ext' ? it.y0 + 0.12 : it.y0 + (K.y < 0 ? hh + K.y : K.y);
      const off = k === 'ext' ? 0.09 : K.d / 2 + 0.004;
      dummy.position.set(it.x + it.n[0] * off, yy, it.z + it.n[2] * off);
      dummy.rotation.set(0, Math.atan2(it.n[0], it.n[2]), K.tilt ? it.rot * K.tilt * 2 : 0);
      dummy.updateMatrix(); im.setMatrixAt(i, dummy.matrix);
      it.bake(dummy.position.x, yy, dummy.position.z, it.n, out);
      ib[i * 3] = out[0]; ib[i * 3 + 1] = out[1]; ib[i * 3 + 2] = out[2];
    });
    geo.setAttribute('ibake', new THREE.InstancedBufferAttribute(ib, 3));
    im.computeBoundingSphere();
    group.add(im);
  }
  group.userData.textures.push(...textures);
  return group;
}

function mergeTwo(a, b) {
  const g = new THREE.BufferGeometry(), A = a.toNonIndexed(), B = b.toNonIndexed();
  for (const name of ['position', 'normal', 'uv']) {
    const x = A.getAttribute(name), y = B.getAttribute(name), arr = new Float32Array(x.array.length + y.array.length);
    arr.set(x.array); arr.set(y.array, x.array.length); g.setAttribute(name, new THREE.BufferAttribute(arr, x.itemSize));
  }
  return g;
}
