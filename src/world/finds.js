// Дивні знахідки: большие сюрреалистичные сцены в открытом мире.
// Модели собираются из примитивов Three.js и текстур, нарисованных на canvas.
// Расстановка (клетки и расчистка места) — в genGrid (level.js); здесь — модели, анимация, поиск пути процессии.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { S } from './level.js';
import { canvas } from '../render/textures.js';
import { rng } from '../core/util.js';
import { makeCivilian, humanReady } from './monster-models.js';

// kind → радиус расчистки в клетках и награда рассудком при находке
const FIND_KINDS = {
  lunar: { clear: 2, san: 15 },
  astronaut: { clear: 1, san: 15 },
  procession: { clear: 1, san: 10 },
  carousel: { clear: 2, san: 15 },
  seats: { clear: 2, san: 15 },
  soda: { clear: 1, san: 35 }
};
const FIND_IDS = Object.keys(FIND_KINDS);

// ---------- текстуры
function texOf(c, repeat = false) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  return t;
}
function foilTex(r) {
  const c = canvas(256, 256), x = c.getContext('2d');
  x.fillStyle = '#b8862e'; x.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 260; i++) {
    const px = r() * 256, py = r() * 256, w = 10 + r() * 50, h = 6 + r() * 30, l = 120 + r() * 120;
    x.fillStyle = `rgba(${l + 60},${l * 0.78 | 0},${l * 0.3 | 0},${0.25 + r() * 0.4})`;
    x.beginPath(); x.moveTo(px, py); x.lineTo(px + w, py + r() * h); x.lineTo(px + r() * w, py + h); x.closePath(); x.fill();
  }
  for (let i = 0; i < 60; i++) { x.strokeStyle = `rgba(60,36,8,${0.2 + r() * 0.3})`; x.beginPath(); x.moveTo(r() * 256, r() * 256); x.lineTo(r() * 256, r() * 256); x.stroke(); }
  return texOf(c, true);
}
function flagTex() {
  const c = canvas(380, 200), x = c.getContext('2d');
  for (let i = 0; i < 13; i++) { x.fillStyle = i % 2 ? '#f2efe6' : '#b0283a'; x.fillRect(0, i * 200 / 13, 380, 200 / 13 + 1); }
  x.fillStyle = '#2c3b6e'; x.fillRect(0, 0, 152, 108);
  x.fillStyle = '#f2efe6';
  for (let row = 0; row < 9; row++) for (let col = 0; col < (row % 2 ? 5 : 6); col++) {
    const cx = 13 + col * 25 + (row % 2 ? 12 : 0), cy = 7 + row * 11.4;
    x.beginPath(); x.arc(cx, cy, 2.6, 0, Math.PI * 2); x.fill();
  }
  return texOf(c);
}
function paperTex(r) {
  const c = canvas(256, 320), x = c.getContext('2d');
  x.fillStyle = '#e7e1cf'; x.fillRect(0, 0, 256, 320);
  x.fillStyle = '#222'; x.font = 'bold 30px serif'; x.fillText('THE DAILY', 34, 40);
  x.fillRect(14, 50, 228, 3);
  for (let col = 0; col < 3; col++) for (let ln = 0; ln < 22; ln++) {
    if (r() < 0.08) continue;
    x.fillStyle = `rgba(30,30,30,${0.45 + r() * 0.3})`; x.fillRect(14 + col * 78, 64 + ln * 11, 64 - r() * 16, 4);
  }
  x.fillStyle = '#7a7568'; x.fillRect(96, 120, 64, 48);
  return texOf(c);
}
function screenTex() {
  const c = canvas(256, 144), x = c.getContext('2d');
  const g = x.createRadialGradient(128, 72, 10, 128, 72, 150); g.addColorStop(0, '#f6f4ea'); g.addColorStop(1, '#a9a69b');
  x.fillStyle = g; x.fillRect(0, 0, 256, 144);
  x.fillStyle = 'rgba(0,0,0,.55)'; x.font = '16px monospace'; x.fillText('PLEASE REMAIN SEATED', 30, 78);
  return texOf(c);
}
function sodaTex(r) {
  const c = canvas(128, 256), x = c.getContext('2d');
  x.fillStyle = '#0b0b0b'; x.fillRect(0, 0, 128, 256);
  const cols = ['#d33', '#3a6', '#f8c030', '#36c', '#e70', '#c3c'];
  for (let row = 0; row < 6; row++) for (let col = 0; col < 4; col++) {
    const px = 10 + col * 28, py = 46 + row * 30, cc = cols[(r() * cols.length) | 0];
    x.fillStyle = cc; x.fillRect(px + 6, py, 12, 22); x.fillRect(px + 9, py - 5, 6, 6);
    x.fillStyle = 'rgba(255,255,255,.4)'; x.fillRect(px + 8, py + 2, 2, 18);
  }
  x.fillStyle = '#fff'; x.font = 'bold 26px sans-serif'; x.fillText('SODA', 30, 32);
  return texOf(c);
}

// ---------- помощники геометрии
const M = (geo, mat) => new THREE.Mesh(geo, mat);
const at = (o, x, y, z, rx = 0, ry = 0, rz = 0) => { o.position.set(x, y, z); o.rotation.set(rx, ry, rz); return o; };
// Освещение уровня «запечено» в стены, а находкам нужен объём: сверху светлее, снизу темнее.
function shaded(m) {
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWN;')
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n\tvWN = normalize(mat3(modelMatrix) * objectNormal);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWN;')
      .replace('#include <lights_fragment_maps>', '#include <lights_fragment_maps>\n\tirradiance *= 0.42 + 0.78 * max(dot(normalize(vWN), normalize(vec3(0.35, 1.0, 0.25))), 0.0) + 0.12 * max(dot(normalize(vWN), normalize(vec3(-0.6, 0.2, -0.5))), 0.0);');
  };
  m.customProgramCacheKey = () => 'zk-find';
  return m;
}
const lam = (color, extra = {}) => shaded(new THREE.MeshLambertMaterial(Object.assign({ color }, extra)));
// труба между двумя точками
function rod(a, b, rad, mat) {
  const d = new THREE.Vector3().subVectors(b, a), len = d.length();
  const m = M(new THREE.CylinderGeometry(rad, rad, len, 6), mat);
  m.position.copy(a).addScaledVector(d, 0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  return m;
}

// ---------- модели
function lunar(r, mats) {
  const g = new THREE.Group(), foil = lam(0xffffff, { map: mats.foil }), grey = lam(0x9a9a96), dark = lam(0x1c1c1c), silver = lam(0xc9c9c4);
  const desc = at(M(new THREE.CylinderGeometry(1.35, 1.35, 1.0, 8), foil), 0, 1.35, 0); desc.rotation.y = Math.PI / 8; g.add(desc);
  g.add(at(M(new THREE.CylinderGeometry(0.42, 0.62, 0.5, 12), dark), 0, 0.62, 0));
  // взлётная ступень: угловатая кабина
  g.add(at(M(new THREE.BoxGeometry(2.0, 1.15, 1.6), grey), 0, 2.45, 0));
  g.add(at(M(new THREE.CylinderGeometry(0.85, 0.85, 1.0, 8), silver), 0, 2.5, -0.35, 0, 0, Math.PI / 2));
  g.add(at(M(new THREE.BoxGeometry(1.2, 0.8, 0.5), lam(0x7a7a75)), 0.3, 2.5, 0.85));
  for (const s of [-1, 1]) g.add(at(M(new THREE.PlaneGeometry(0.42, 0.36), dark), s * 0.42, 2.72, 1.105, 0, 0, s * 0.3));
  g.add(at(M(new THREE.BoxGeometry(0.7, 0.85, 0.08), lam(0x3a3a38)), 0, 1.35, 1.32));
  // антенны
  g.add(rod(new THREE.Vector3(-0.6, 3.0, -0.2), new THREE.Vector3(-0.9, 3.7, -0.4), 0.025, silver));
  const dish = at(M(new THREE.ConeGeometry(0.32, 0.14, 16, 1, true), lam(0xdedad0, { side: THREE.DoubleSide })), -0.9, 3.75, -0.4, -0.5, 0, 0.3); g.add(dish);
  g.add(rod(new THREE.Vector3(0.7, 3.0, 0.2), new THREE.Vector3(0.75, 3.55, 0.25), 0.015, silver));
  // ноги и опоры
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + k * Math.PI / 2, cx = Math.cos(a), cz = Math.sin(a);
    const top = new THREE.Vector3(cx * 1.15, 1.55, cz * 1.15), foot = new THREE.Vector3(cx * 2.25, 0.12, cz * 2.25);
    g.add(rod(top, foot, 0.07, foil));
    g.add(rod(new THREE.Vector3(cx * 1.2, 0.95, cz * 1.2), new THREE.Vector3(cx * 1.85, 0.45, cz * 1.85), 0.035, silver));
    g.add(at(M(new THREE.CylinderGeometry(0.36, 0.42, 0.08, 14), foil), foot.x, 0.05, foot.z));
  }
  // лестница на передней ноге
  const lad = new THREE.Group(), front = Math.PI / 4;
  for (const s of [-1, 1]) lad.add(rod(new THREE.Vector3(s * 0.22, 0.2, 0), new THREE.Vector3(s * 0.22, 1.45, -0.6), 0.025, silver));
  for (let k = 0; k < 7; k++) { const t = k / 6; lad.add(rod(new THREE.Vector3(-0.22, 0.2 + t * 1.25, -t * 0.6), new THREE.Vector3(0.22, 0.2 + t * 1.25, -t * 0.6), 0.018, silver)); }
  lad.position.set(Math.cos(front) * 2.0, 0, Math.sin(front) * 2.0); lad.rotation.y = -front - Math.PI / 2; g.add(lad);
  // флаг
  const fx = -2.6, fz = 1.4;
  g.add(rod(new THREE.Vector3(fx, 0, fz), new THREE.Vector3(fx, 2.5, fz), 0.022, silver));
  g.add(rod(new THREE.Vector3(fx, 2.45, fz), new THREE.Vector3(fx + 1.25, 2.45, fz), 0.015, silver));
  const fl = at(M(new THREE.PlaneGeometry(1.25, 0.72, 8, 1), lam(0xffffff, { map: mats.flag, side: THREE.DoubleSide })), fx + 0.625, 2.08, fz);
  const p = fl.geometry.attributes.position; for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin(p.getX(i) * 4) * 0.04);
  fl.geometry.computeVertexNormals(); g.add(fl);
  // следы ботинок вокруг
  const step = new THREE.CircleGeometry(0.12, 8); step.rotateX(-Math.PI / 2); step.scale(0.7, 1, 1.3);
  const steps = [];
  for (let k = 0; k < 18; k++) { const s = step.clone(); s.translate(-2.4 + k * 0.28 + (k % 2) * 0.05, 0.008, 2.0 + Math.sin(k) * 0.4 + (k % 2 ? 0.18 : 0)); steps.push(s); }
  g.add(M(mergeGeometries(steps), lam(0x6a6455, { transparent: true, opacity: 0.6, depthWrite: false })));
  return { group: g, radius: 2.6, height: 3.8, colliders: [[0, 0, 1.5], [fx, fz, 0.2]] };
}

function suitParts(mats) {
  return { white: lam(0xe9e6de), grey: lam(0xb7b4ac), visor: new THREE.MeshPhongMaterial({ color: 0x6a4e14, emissive: 0x241604, shininess: 90, specular: 0xffe6a0 }), pack: lam(0xd8d4c8) };
}
function astronaut(r, mats) {
  const g = new THREE.Group(), m = suitParts(mats);
  const torso = at(M(new THREE.CapsuleGeometry(0.28, 0.42, 6, 12), m.white), 0, 0.72, 0, -0.25); g.add(torso);
  g.add(at(M(new THREE.BoxGeometry(0.5, 0.6, 0.28), m.pack), 0, 0.82, -0.32, -0.25));
  const head = new THREE.Group(); head.position.set(0, 1.22, 0.02); g.add(head);
  head.add(M(new THREE.SphereGeometry(0.26, 20, 14), m.white));
  head.add(at(M(new THREE.SphereGeometry(0.21, 20, 12, -Math.PI * 0.42, Math.PI * 0.84, Math.PI * 0.28, Math.PI * 0.4), m.visor), 0, 0, 0.07));
  // ноги согнуты, колени к груди
  for (const s of [-1, 1]) {
    g.add(rod(new THREE.Vector3(s * 0.14, 0.42, 0.05), new THREE.Vector3(s * 0.17, 0.72, 0.5), 0.12, m.white));
    g.add(rod(new THREE.Vector3(s * 0.17, 0.72, 0.5), new THREE.Vector3(s * 0.16, 0.12, 0.62), 0.11, m.white));
    g.add(at(M(new THREE.BoxGeometry(0.2, 0.14, 0.32), m.grey), s * 0.16, 0.07, 0.7));
    // руки обхватывают колени
    g.add(rod(new THREE.Vector3(s * 0.33, 0.98, 0.0), new THREE.Vector3(s * 0.3, 0.72, 0.42), 0.09, m.white));
    g.add(rod(new THREE.Vector3(s * 0.3, 0.72, 0.42), new THREE.Vector3(s * 0.08, 0.78, 0.6), 0.085, m.white));
    g.add(at(M(new THREE.SphereGeometry(0.09, 10, 8), m.grey), s * 0.06, 0.78, 0.62));
  }
  g.add(at(M(new THREE.BoxGeometry(0.26, 0.16, 0.08), m.grey), 0, 0.86, 0.26, -0.25));
  return { group: g, head, radius: 0.8, colliders: [[0, 0.15, 0.55]] };
}

function walker(mats, r) {
  const g = new THREE.Group(), suit = lam(0xb9ab8c), dark = lam(0x2a2622), skin = lam(0xc9a58a), paper = lam(0xffffff, { map: mats.paper, side: THREE.DoubleSide }), bag = lam(0x4a2f1c);
  const hips = new THREE.Group(); hips.position.y = 0.95; g.add(hips);
  const legs = [];
  for (const s of [-1, 1]) {
    const leg = new THREE.Group(); leg.position.set(s * 0.11, 0, 0); hips.add(leg);
    leg.add(at(M(new THREE.BoxGeometry(0.15, 0.9, 0.17), suit), 0, -0.45, 0));
    leg.add(at(M(new THREE.BoxGeometry(0.14, 0.08, 0.28), dark), 0, -0.93, 0.05));
    legs.push(leg);
  }
  hips.add(at(M(new THREE.BoxGeometry(0.44, 0.62, 0.24), suit), 0, 0.33, 0));
  hips.add(at(M(new THREE.BoxGeometry(0.1, 0.3, 0.02), lam(0x5a1e1e)), 0, 0.42, 0.125));
  hips.add(at(M(new THREE.SphereGeometry(0.12, 12, 10), skin), 0, 0.78, 0.0));
  // газета перед лицом в обеих руках
  const np = at(M(new THREE.PlaneGeometry(0.62, 0.46, 3, 1), paper), 0, 0.8, 0.3, -0.08); const p = np.geometry.attributes.position;
  for (let i = 0; i < p.count; i++) p.setZ(i, -Math.abs(p.getX(i)) * 0.25);
  np.geometry.computeVertexNormals(); hips.add(np);
  for (const s of [-1, 1]) hips.add(rod(new THREE.Vector3(s * 0.25, 0.6, 0), new THREE.Vector3(s * 0.26, 0.74, 0.28), 0.05, suit));
  hips.add(at(M(new THREE.BoxGeometry(0.42, 0.3, 0.1), bag), 0.32, -0.05, 0.05));
  hips.add(rod(new THREE.Vector3(0.24, 0.55, 0), new THREE.Vector3(0.32, 0.12, 0.05), 0.045, suit));
  return { g, legs, hips, ph: r() * 6 };
}
function procession(r, mats) {
  const g = new THREE.Group(), people = [];
  // реалистичные люди (скелетная модель); если модель не загрузилась — прежние фигуры
  if (humanReady()) {
    const paper = lam(0xffffff, { map: mats.paper, side: THREE.DoubleSide }), hat = lam(0x1a1918);
    for (let k = 0; k < 6; k++) {
      const c = makeCivilian({ h: 1.9, wrap: shaded, paper, hat });
      g.add(c.g); people.push({ g: c.g, civ: c });
    }
    return { group: g, people, radius: 0.6, colliders: [] };
  }
  for (let k = 0; k < 6; k++) { const w = walker(mats, r); g.add(w.g); people.push(w); }
  return { group: g, people, radius: 0.6, colliders: [] };
}

function carousel(r, mats) {
  const g = new THREE.Group(), rot = new THREE.Group(); g.add(rot);
  const red = lam(0xb8303a), cream = lam(0xf1e6c8), gold = lam(0xc9a040), wood = lam(0x6b4a2c);
  g.add(at(M(new THREE.CylinderGeometry(2.7, 2.8, 0.3, 32), wood), 0, 0.15, 0));
  rot.add(at(M(new THREE.CylinderGeometry(2.6, 2.6, 0.08, 32), cream), 0, 0.34, 0));
  rot.add(at(M(new THREE.CylinderGeometry(0.22, 0.22, 3.2, 12), gold), 0, 1.9, 0));
  const roofC = canvas(256, 32), rx = roofC.getContext('2d');
  for (let i = 0; i < 16; i++) { rx.fillStyle = i % 2 ? '#b8303a' : '#f1e6c8'; rx.fillRect(i * 16, 0, 16, 32); }
  rot.add(at(M(new THREE.ConeGeometry(2.9, 1.1, 16, 1, true), lam(0xffffff, { map: texOf(roofC), side: THREE.DoubleSide })), 0, 3.85, 0));
  rot.add(at(M(new THREE.CylinderGeometry(2.9, 2.9, 0.25, 16, 1, true), red), 0, 3.2, 0));
  const horses = [];
  for (let k = 0; k < 6; k++) {
    const a = k / 6 * Math.PI * 2, h = new THREE.Group();
    h.position.set(Math.cos(a) * 1.9, 0, Math.sin(a) * 1.9); h.rotation.y = -a;
    h.add(at(M(new THREE.CylinderGeometry(0.035, 0.035, 2.9, 6), gold), 0, 1.85, 0));
    const body = new THREE.Group(); h.add(body);
    const col = k % 2 ? cream : lam(0x2f2a28);
    body.add(at(M(new THREE.CapsuleGeometry(0.2, 0.6, 4, 10), col), 0, 1.15, 0, 0, 0, Math.PI / 2));
    body.add(at(M(new THREE.CapsuleGeometry(0.1, 0.3, 4, 8), col), 0.42, 1.42, 0, 0, 0, -0.6));
    body.add(at(M(new THREE.BoxGeometry(0.32, 0.16, 0.16), col), 0.6, 1.58, 0, 0, 0, -0.3));
    body.add(at(M(new THREE.BoxGeometry(0.3, 0.06, 0.34), red), 0, 1.36, 0));
    for (const [lx, lz] of [[0.25, 0.1], [0.25, -0.1], [-0.25, 0.1], [-0.25, -0.1]]) body.add(at(M(new THREE.CylinderGeometry(0.04, 0.03, 0.5, 6), col), lx, 0.82, lz, 0, 0, lx > 0 ? -0.4 : 0.4));
    rot.add(h); horses.push({ body, ph: k * 1.1 });
  }
  return { group: g, rot, horses, radius: 2.9, height: 4.45, colliders: [[0, 0, 2.9]] };
}

function seats(r, mats) {
  const g = new THREE.Group(), fab = lam(0x2c3f6e), head = lam(0xe8e4da), frame = lam(0x5b5b58);
  const parts = { fab: [], head: [], frame: [] };
  const box = (arr, w, h, d, x, y, z, rx = 0) => { const b = new THREE.BoxGeometry(w, h, d); if (rx) b.rotateX(rx); b.translate(x, y, z); arr.push(b); };
  for (let row = 0; row < 5; row++) for (const side of [-1, 1]) for (let s = 0; s < 3; s++) {
    if (r() < 0.06) continue;
    const x = side * (0.9 + s * 0.52), z = -1.6 + row * 0.95;
    box(parts.fab, 0.48, 0.14, 0.46, x, 0.46, z);
    box(parts.fab, 0.48, 0.66, 0.12, x, 0.84, z + 0.24, -0.16);
    box(parts.head, 0.36, 0.18, 0.04, x, 1.12, z + 0.27, -0.16);
    box(parts.frame, 0.06, 0.4, 0.4, x - 0.25, 0.22, z);
  }
  g.add(M(mergeGeometries(parts.fab), fab), M(mergeGeometries(parts.head), head), M(mergeGeometries(parts.frame), frame));
  const scr = at(M(new THREE.PlaneGeometry(2.6, 1.46), new THREE.MeshBasicMaterial({ map: mats.screen, color: 0xcfcfc8 })), 0, 1.6, -2.7); scr.rotation.y = 0; g.add(scr);
  g.add(at(M(new THREE.BoxGeometry(2.8, 1.62, 0.06), frame), 0, 1.6, -2.75));
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: mats.glow, color: 0xfff8e0, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending }));
  glow.position.set(0, 1.6, -2.55); glow.scale.set(4.5, 3, 1); g.add(glow);
  return { group: g, radius: 3, colliders: [[-1.4, 0.3, 1.0], [1.4, 0.3, 1.0], [0, -2.7, 0.4]] };
}

function soda(r, mats) {
  const g = new THREE.Group();
  g.add(at(M(new THREE.BoxGeometry(1.0, 1.95, 0.8), lam(0xa8202a)), 0, 0.975, 0));
  g.add(at(M(new THREE.PlaneGeometry(0.62, 1.4), new THREE.MeshBasicMaterial({ map: mats.soda, color: 0xffffff })), -0.12, 1.15, 0.405));
  g.add(at(M(new THREE.BoxGeometry(0.2, 0.5, 0.04), lam(0x222222)), 0.36, 1.2, 0.41));
  g.add(at(M(new THREE.BoxGeometry(0.62, 0.18, 0.06), lam(0x111111)), -0.12, 0.28, 0.42));
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: mats.glow, color: 0xffe0c0, transparent: true, opacity: 0.4, depthWrite: false, blending: THREE.AdditiveBlending }));
  glow.position.set(-0.12, 1.15, 0.7); glow.scale.set(2.2, 2.6, 1); g.add(glow);
  return { group: g, radius: 0.7, colliders: [[0, 0, 0.6]] };
}

const BUILD = { lunar, astronaut, procession, carousel, seats, soda };

// ---------- путь процессии: туда-обратно между двумя дальними клетками зоны
function patrolPath(lvl, f, r) {
  const z = f.zone, cands = [];
  for (let k = 0; k < 400 && cands.length < 40; k++) {
    const tx = z.x0 + 1 + ((r() * (z.x1 - z.x0 - 1)) | 0), ty = z.y0 + 1 + ((r() * (z.y1 - z.y0 - 1)) | 0);
    if (lvl.tile(tx, ty) === 0) cands.push([tx, ty]);
  }
  let a = [f.tx, f.ty], b = null, bd = -1;
  const field = lvl.bfs(a[0], a[1]);
  for (const c of cands) { const d = field[c[1] * lvl.mw + c[0]]; if (d > bd && d < 40) { bd = d; b = c; } }
  if (!b) return null;
  // спуск по полю расстояний от b к a
  const fb = lvl.bfs(b[0], b[1]), path = [];
  let cx = a[0], cy = a[1];
  for (let guard = 0; guard < 200; guard++) {
    path.push([(cx + 0.5) * S, (cy + 0.5) * S]);
    if (cx === b[0] && cy === b[1]) break;
    let best = fb[cy * lvl.mw + cx], nx = cx, ny = cy;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const v = fb[(cy + dy) * lvl.mw + cx + dx]; if (v >= 0 && v < best) { best = v; nx = cx + dx; ny = cy + dy; } }
    if (nx === cx && ny === cy) break;
    cx = nx; cy = ny;
  }
  // длины отрезков
  const L = [0]; for (let i = 1; i < path.length; i++) L.push(L[i - 1] + Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]));
  return path.length > 4 ? { pts: path, L, total: L[L.length - 1] } : null;
}
function along(p, s) {
  // s — расстояние вдоль «туда-обратно» пути
  const T = p.total, m = ((s % (2 * T)) + 2 * T) % (2 * T), d = m <= T ? m : 2 * T - m, back = m > T;
  let i = 1; while (i < p.L.length - 1 && p.L[i] < d) i++;
  const a = p.pts[i - 1], b = p.pts[i], k = (d - p.L[i - 1]) / Math.max(1e-6, p.L[i] - p.L[i - 1]);
  const x = a[0] + (b[0] - a[0]) * k, z = a[1] + (b[1] - a[1]) * k;
  let yaw = Math.atan2(b[0] - a[0], b[1] - a[1]); if (back) yaw += Math.PI;
  return [x, z, yaw];
}

// ---------- сборка всех находок уровня
function buildFinds(lvl, list, seed, glowTex) {
  if (!list || !list.length) { const e = []; e.textures = []; return e; }
  const r = rng((seed ^ 0x5f3759df) >>> 0);
  const mats = { foil: foilTex(r), flag: flagTex(), paper: paperTex(r), screen: screenTex(), soda: sodaTex(r), glow: glowTex };
  const out = [];
  out.textures = ['foil', 'flag', 'paper', 'screen', 'soda'].map((k) => mats[k]);
  for (const f of list) {
    const b = BUILD[f.kind](r, mats);
    // высокие модели ужимаются под потолок уровня (карусель и модуль в 2,7-метровых комнатах)
    if (b.height && lvl.HH && b.height > lvl.HH - 0.12) {
      const k = (lvl.HH - 0.12) / b.height; b.group.scale.setScalar(k); b.radius *= k;
      b.colliders = b.colliders.map(([cx, cz, cr]) => [cx * k, cz * k, cr * k]);
    }
    const x = (f.tx + 0.5) * S, z = (f.ty + 0.5) * S;
    b.group.position.set(x, 0, z); b.group.rotation.y = f.yaw || 0;
    lvl.root.add(b.group);
    const c = Math.cos(f.yaw || 0), s = Math.sin(f.yaw || 0);
    for (const [lx, lz, rad] of b.colliders) {
      const wx = x + lx * c + lz * s, wz = z - lx * s + lz * c;
      lvl.colliders.push({ x0: wx - rad, x1: wx + rad, z0: wz - rad, z1: wz + rad });
    }
    const it = Object.assign({ kind: f.kind, x, z, found: false, t: 0 }, b);
    if (f.kind === 'procession') { it.path = patrolPath(lvl, Object.assign({ zone: f.zone }, f), r); it.s = 0; if (!it.path) b.group.visible = false; }
    out.push(it);
  }
  return out;
}

const tmpV = new THREE.Vector3();
function updateFinds(finds, dt, t, pl) {
  for (const f of finds) {
    f.t += dt;
    if (f.kind === 'carousel') {
      f.rot.rotation.y += dt * 0.35;
      for (const h of f.horses) h.body.position.y = Math.sin(t * 1.6 + h.ph) * 0.18;
    } else if (f.kind === 'astronaut') {
      // голова медленно поворачивается к игроку, если тот рядом
      const d = Math.hypot(pl.x - f.x, pl.z - f.z);
      f.head.getWorldPosition(tmpV);
      const want = d < 9 ? Math.atan2(pl.x - tmpV.x, pl.z - tmpV.z) - f.group.rotation.y : 0;
      let dy = want - f.head.rotation.y; while (dy > Math.PI) dy -= Math.PI * 2; while (dy < -Math.PI) dy += Math.PI * 2;
      f.head.rotation.y += Math.max(-1, Math.min(1, dy)) * dt * 0.6;
      f.head.rotation.y = Math.max(-1.3, Math.min(1.3, f.head.rotation.y));
    } else if (f.kind === 'procession' && f.path) {
      f.s += dt * 0.75;
      f.people.forEach((w, k) => {
        const [x, z, yaw] = along(f.path, f.s - k * 1.35);
        w.g.position.set(x - f.x, 0, z - f.z);
        // группа повёрнута вместе с f.group — компенсируем поворот
        w.g.rotation.y = yaw - f.group.rotation.y;
        if (w.civ) { w.civ.update(dt, 0.75, f.s / 0.75); return; }
        const ph = f.s * 4.2 + w.ph * 0;
        w.legs[0].rotation.x = Math.sin(ph - k) * 0.4; w.legs[1].rotation.x = -Math.sin(ph - k) * 0.4;
        w.hips.position.y = 0.95 + Math.abs(Math.cos(ph - k)) * 0.03;
      });
      if (f.group.rotation.y) { f.group.rotation.y = 0; }
    }
  }
}
// ближайшая к игроку точка находки (для процессии — ближайший человек)
function findPoint(f) {
  if (f.kind === 'procession' && f.people) {
    const w = f.people[0].g.position; return [f.x + w.x, f.z + w.z];
  }
  return [f.x, f.z];
}

export { FIND_KINDS, FIND_IDS, buildFinds, updateFinds, findPoint, shaded };
