import * as THREE from 'three';
import { S } from './level.js';
import { rng } from '../core/util.js';
import { canvas } from '../render/textures.js';

// Задания уровней, аномалии и меловые метки. Всё ставится по семени уровня,
// поэтому у всех игроков в коопе предметы стоят в одних и тех же местах.

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

// ---------- задания ----------
// У каждого уровня своё задание, связанное с сюжетом (goal — текст цели на карточке уровня)
const TASK_BY_LEVEL = [
  { kind: 'exit' },
  { kind: 'fuse', n: 3, goal: 'Найди 3 предохранителя для щитка базы «Глубина-1»' },
  { kind: 'code', n: 4, goal: 'Найди на стенах 4 цифры кода от ворот парковки' },
  { kind: 'key', chase: true, goal: 'Возьми ключ-карту — и беги к выходу. Он погонится за тобой' },
  { kind: 'valve', n: 3, goal: 'Перекрой 3 вентиля, пока вода не поднялась' },
  { kind: 'code', n: 4, goal: 'Собери код от шкафчика спасателя бассейна «Лазурный»' },
  { kind: 'ticket', n: 4, goal: 'Собери 4 билета на колесо обозрения' },
  { kind: 'key', goal: 'Найди пропуск сотрудника Объекта 4-Б' },
  { kind: 'key', chase: true, goal: 'Найди в архиве своё личное дело — и беги' },
  { kind: 'lever', n: 4, goal: 'Включи 4 рубильника, чтобы дать ток на последнюю дверь' }
];
function taskFor(lv, seed) {
  if (lv < TASK_BY_LEVEL.length) return TASK_BY_LEVEL[lv];
  const pool = [{ kind: 'fuse', n: 4 }, { kind: 'code', n: 4 }, { kind: 'key', chase: true }, { kind: 'valve', n: 4 }, { kind: 'lever', n: 4 }];
  return pool[(seed >>> 3) % pool.length];
}
const TASK_GOAL = {
  exit: 'Найди дверь «ВЫХОД»',
  key: 'Найди ключ-карту и открой выход',
  chase: 'Возьми ключ-карту — и беги к выходу. Он погонится за тобой',
  fuse: 'Собери предохранители и вставь их в щиток у выхода',
  code: 'Найди цифры кода на стенах и введи его у выхода',
  valve: 'Перекрой все вентили — тогда откроется выход',
  ticket: 'Собери билеты и покажи их у выхода',
  lever: 'Включи все рубильники, чтобы дать ток на дверь'
};

// ---------- аномалии ----------
const ANOMS = {
  phone: { name: 'Звонящий телефон', ic: '☎️', d: 'Таксофон на стене звонит, хотя провода нет. Тот, кто отвечает, знает, где выход.' },
  tv: { name: 'Телевизор', ic: '📺', d: 'Включён в пустой комнате. Помехи складываются в лицо, если долго смотреть.' },
  chair: { name: 'Стул', ic: '🪑', d: 'Стоит посреди комнаты лицом к стене. Пока ты не смотришь, он поворачивается к тебе.' },
  mannequin: { name: 'Манекен', ic: '🧍', d: 'Бледная фигура без лица. Подходит ближе, только когда ты отворачиваешься.' },
  hands: { name: 'Отпечатки ладоней', ic: '🖐', d: 'Десятки ладоней на одной стене. Все ведут вниз, будто кто-то сползал.' },
  door: { name: 'Дверь в стене', ic: '🚪', d: 'Нарисованная дверь. С той стороны кто-то стучит.' },
  bed: { name: 'Кровать', ic: '🛏', d: 'Аккуратно заправлена. Можно прилечь… но сон здесь громкий.' },
  clock: { name: 'Часы', ic: '🕰', d: 'Идут назад. Каждый тик чуть громче предыдущего.' }
};
const ANOM_KEYS = Object.keys(ANOMS);

// ---------- текстуры ----------
const texCache = {};
function ctex(key, w, h, draw) {
  if (texCache[key]) return texCache[key];
  const c = canvas(w, h), x = c.getContext('2d'); draw(x, w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  texCache[key] = t; return t;
}
function clueTex(pos, n, digit) {
  return ctex(`clue${pos}-${n}-${digit}`, 256, 256, (x, W) => {
    x.clearRect(0, 0, W, W);
    x.fillStyle = 'rgba(160,20,20,0.92)'; x.strokeStyle = 'rgba(160,20,20,0.92)'; x.lineWidth = 6;
    for (let i = 0; i < n; i++) { x.beginPath(); x.arc(W / 2 + (i - (n - 1) / 2) * 40, 44, 13, 0, 7); if (i === pos) x.fill(); else x.stroke(); }
    x.font = 'bold 150px Arial Black, Arial, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(String(digit), W / 2, 158);
    for (let k = 0; k < 6; k++) { x.fillRect(W / 2 - 30 + k * 13, 225, 4, 8 + Math.random() * 22); }
  });
}
function arrowTex() {
  return ctex('arrow', 128, 128, (x, W) => {
    x.clearRect(0, 0, W, W); x.strokeStyle = 'rgba(245,245,235,0.95)'; x.lineWidth = 11; x.lineCap = 'round'; x.lineJoin = 'round';
    x.beginPath(); x.moveTo(W / 2, W - 14); x.lineTo(W / 2, 22); x.moveTo(W / 2 - 34, 56); x.lineTo(W / 2, 20); x.lineTo(W / 2 + 34, 56); x.stroke();
  });
}
function ticketTex() {
  return ctex('ticket', 256, 128, (x, W, H) => {
    x.fillStyle = '#f2c94c'; x.fillRect(0, 0, W, H);
    x.fillStyle = '#c0392b'; x.fillRect(0, 0, W, 22); x.fillRect(0, H - 22, W, 22);
    x.fillStyle = '#5b1a12'; x.font = 'bold 44px Arial Black, Arial'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('★ БИЛЕТ ★', W / 2, H / 2 + 2);
    x.globalCompositeOperation = 'destination-out'; for (const s of [0, W]) { x.beginPath(); x.arc(s, H / 2, 18, 0, 7); x.fill(); }
  });
}
function handsTex() {
  return ctex('hands', 512, 512, (x, W) => {
    x.clearRect(0, 0, W, W);
    const r = rng(77);
    for (let k = 0; k < 34; k++) {
      const cx = r() * W, cy = 40 + r() * (W - 80) * (0.4 + r() * 0.6), s = 0.6 + r() * 0.5, a = (r() - 0.5) * 0.6;
      x.save(); x.translate(cx, cy); x.rotate(a); x.scale(s, s); x.fillStyle = `rgba(${40 + r() * 40},${14 + r() * 10},${10},${0.5 + r() * 0.35})`;
      x.beginPath(); x.ellipse(0, 18, 22, 26, 0, 0, 7); x.fill();
      for (let f = 0; f < 5; f++) { const fx = -20 + f * 10 + (f === 0 ? -8 : 0), fl = f === 0 ? 24 : 34 + (f === 2 ? 8 : 0); x.save(); x.translate(fx, f === 0 ? 14 : 0); x.rotate(f === 0 ? -0.7 : (f - 2) * 0.08); x.fillRect(-4.5, -fl, 9, fl); x.beginPath(); x.arc(0, -fl, 4.5, 0, 7); x.fill(); x.restore(); }
      // смазанный след вниз
      x.globalAlpha = 0.25; x.fillRect(-18, 30, 36, 30 + r() * 80); x.globalAlpha = 1;
      x.restore();
    }
  });
}
function clockTex() {
  return ctex('clock', 256, 256, (x, W) => {
    x.fillStyle = '#e8e2cf'; x.beginPath(); x.arc(W / 2, W / 2, W / 2 - 6, 0, 7); x.fill();
    x.strokeStyle = '#222'; x.lineWidth = 8; x.stroke();
    x.fillStyle = '#222'; x.font = 'bold 30px Georgia'; x.textAlign = 'center'; x.textBaseline = 'middle';
    for (let h = 1; h <= 12; h++) { const a = -h / 12 * Math.PI * 2 - Math.PI / 2; x.fillText(String(h), W / 2 + Math.cos(a) * 96, W / 2 + Math.sin(a) * 96); }
  });
}
let staticCanvas = null, staticTex = null;
function staticTexture() {
  if (staticTex) return staticTex;
  staticCanvas = canvas(96, 72); staticTex = new THREE.CanvasTexture(staticCanvas); staticTex.colorSpace = THREE.SRGBColorSpace;
  return staticTex;
}
function drawStatic(face) {
  if (!staticCanvas) return;
  const x = staticCanvas.getContext('2d'), id = x.createImageData(96, 72), d = id.data;
  for (let i = 0; i < 96 * 72; i++) {
    let v = Math.random() * 255;
    if (face) { const px = i % 96 - 48, py = ((i / 96) | 0) - 36; const e = (Math.hypot(px + 12, py + 6) < 6 || Math.hypot(px - 12, py + 6) < 6) ? 0 : (Math.abs(py - 14) < 3 && Math.abs(px) < 18 ? 0 : 1); v = e ? v * 0.8 + 50 : v * 0.15; }
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v; d[i * 4 + 3] = 255;
  }
  x.putImageData(id, 0, 0); staticTex.needsUpdate = true;
}

// ---------- расстановка ----------
// клетки пола у стены, далеко от старта, равномерно по карте
function spots(lvl, r, minDist = 7) {
  const L = lvl, sx = Math.floor(L.spawn.x / S), sz = Math.floor(L.spawn.z / S);
  const f = L.bfs(sx, sz), out = [];
  const dtx = Math.floor(L.door.x / S), dtz = Math.floor(L.door.z / S);
  for (const i of L.floorList) {
    if (f[i] < minDist) continue;
    const tx = i % L.mw, ty = (i / L.mw) | 0;
    if (Math.abs(tx - dtx) + Math.abs(ty - dtz) < 3) continue;
    if (L.lockers.some((l) => l.tx === tx && l.ty === ty)) continue;
    const walls = DIRS.filter(([a, b]) => L.tile(tx + a, ty + b) === 1);
    out.push({ tx, ty, d: f[i], walls });
  }
  for (let i = out.length - 1; i > 0; i--) { const j = (r() * (i + 1)) | 0; const t = out[i]; out[i] = out[j]; out[j] = t; }
  return out;
}
function pickSpread(cands, n, used, need = (c) => true, gap = 8) {
  const res = [];
  for (const c of cands) {
    if (res.length >= n) break;
    if (!need(c)) continue;
    if ([...used, ...res].some((u) => Math.abs(u.tx - c.tx) + Math.abs(u.ty - c.ty) < gap)) continue;
    res.push(c);
  }
  if (res.length < n && gap > 2) return res.concat(pickSpread(cands, n - res.length, [...used, ...res], need, gap - 3));
  return res;
}
// точка у стены: позиция и поворот (лицом в комнату)
function wallPos(c, r, off = 0.07) {
  const [a, b] = c.walls[(r() * c.walls.length) | 0];
  return { x: (c.tx + 0.5) * S + a * (S / 2 - off), z: (c.ty + 0.5) * S + b * (S / 2 - off), ry: Math.atan2(-a, -b), nx: -a, nz: -b };
}
const std = (o) => new THREE.MeshStandardMaterial(Object.assign({ roughness: 0.6 }, o));
function glowSprite(color, size, y, op = 0.45) {
  const t = ctex('glow', 64, 64, (x, W) => { const g = x.createRadialGradient(W / 2, W / 2, 0, W / 2, W / 2, W / 2); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, W, W); });
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: op }));
  s.scale.set(size, size, 1); s.position.y = y; return s;
}

function buildExtras(lvl, task, seed, lv) {
  const r = rng((seed ^ 0x51ed27) >>> 0);
  const root = lvl.root, used = [];
  const add = (o) => { root.add(o); return o; };
  // в открытом мире предметы задания — в 8–34 клетках пути от старта (16–70 м), иначе их не найти
  const all = spots(lvl, r), cands = task.near ? all.filter((c) => c.d <= 34) : all;
  const ex = { task, items: [], anoms: [], code: null, marks: [], markGroup: new THREE.Group(), staticT: 0 };
  add(ex.markGroup);
  const n = task.n || 0;

  if (task.kind === 'fuse' || task.kind === 'ticket') {
    for (const c of pickSpread(cands, n, used)) {
      used.push(c);
      const o = new THREE.Group(), x = (c.tx + 0.5) * S + (r() - 0.5) * 0.6, z = (c.ty + 0.5) * S + (r() - 0.5) * 0.6;
      if (task.kind === 'fuse') {
        const inner = new THREE.Group(); inner.rotation.z = Math.PI / 2; inner.position.y = 0.05; o.add(inner);
        inner.add(new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.14, 14), std({ color: 0xe8e0d0, transparent: true, opacity: 0.7 })));
        for (const s of [-1, 1]) { const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.038, 0.03, 14), std({ color: 0xc58a3a, metalness: 0.7, roughness: 0.3 })); cap.position.y = s * 0.075; inner.add(cap); }
        const wire = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.13, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 1.2, 0.3) })); inner.add(wire);
        o.add(glowSprite(0xff9a3c, 0.6, 0.06));
      } else {
        const t = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.15), std({ map: ticketTex(), side: THREE.DoubleSide, emissive: 0x553311, emissiveMap: ticketTex() }));
        t.position.y = 0.9; o.add(t); o.userData.spin = t;
        o.add(glowSprite(0xff7ab8, 0.8, 0.9, 0.5));
      }
      o.position.set(x, 0, z); add(o);
      ex.items.push({ type: task.kind, x, z, obj: o, taken: false });
    }
  }
  if (task.kind === 'valve' || task.kind === 'lever') {
    for (const c of pickSpread(cands, n, used, (c) => c.walls.length > 0)) {
      used.push(c);
      const w = wallPos(c, r), o = new THREE.Group(); o.position.set(w.x, 0, w.z); o.rotation.y = w.ry;
      const lampM = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.2, 0.1) });
      let part;
      if (task.kind === 'valve') {
        const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.7, 10), std({ color: 0x5a6a5e, metalness: 0.5 })); pipe.position.set(0, 1.35, 0.06); o.add(pipe);
        const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.22, 10), std({ color: 0x5a6a5e, metalness: 0.5 })); hub.rotation.x = Math.PI / 2; hub.position.set(0, 1.25, 0.16); o.add(hub);
        part = new THREE.Group(); part.position.set(0, 1.25, 0.27); o.add(part);
        const wm = std({ color: 0xb3241c, metalness: 0.3, roughness: 0.45 });
        part.add(new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.022, 8, 24), wm));
        for (let k = 0; k < 3; k++) { const sp = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.025, 0.025), wm); sp.rotation.z = k * Math.PI / 3; part.add(sp); }
      } else {
        const boxm = std({ color: 0x3d4440, metalness: 0.4 });
        const b = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.6, 0.16), boxm); b.position.set(0, 1.3, 0.08); o.add(b);
        const stripe = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.06), std({ color: 0xe8b500 })); stripe.position.set(0, 1.58, 0.161); o.add(stripe);
        part = new THREE.Group(); part.position.set(0, 1.3, 0.17); part.rotation.x = 0.7; o.add(part);
        const h = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.3, 8), std({ color: 0x222222 })); h.position.y = 0.15; part.add(h);
        const k = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), std({ color: 0xb3241c })); k.position.y = 0.31; part.add(k);
      }
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), lampM); lamp.position.set(0.28, 1.65, 0.1); o.add(lamp);
      o.add(Object.assign(glowSprite(0xff3322, 0.5, 1.65, 0.6), {}));
      add(o);
      ex.items.push({ type: task.kind, x: w.x + w.nx * 0.6, z: w.z + w.nz * 0.6, obj: o, part, lampM, glow: o.children[o.children.length - 1], keep: true, taken: false, wx: w.x, wz: w.z });
    }
  }
  if (task.kind === 'code') {
    const digits = []; for (let k = 0; k < n; k++) digits.push((r() * 10) | 0);
    ex.code = { digits, known: new Array(n).fill(false) };
    pickSpread(cands, n, used, (c) => c.walls.length > 0).forEach((c, k) => {
      used.push(c);
      const w = wallPos(c, r, 0.012);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), new THREE.MeshLambertMaterial({ map: clueTex(k, n, digits[k]), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, emissive: 0x220000 }));
      m.position.set(w.x, 1.35 + (r() - 0.5) * 0.4, w.z); m.rotation.y = w.ry; m.rotation.z = (r() - 0.5) * 0.25; add(m);
      ex.items.push({ type: 'clue', pos: k, digit: digits[k], x: w.x + w.nx * 1.2, z: w.z + w.nz * 1.2, wx: w.x, wz: w.z, obj: m, keep: true, taken: false });
    });
  }

  // аномалии: по две на уровень, разные
  const kinds = ANOM_KEYS.slice();
  for (let i = kinds.length - 1; i > 0; i--) { const j = (r() * (i + 1)) | 0; const t = kinds[i]; kinds[i] = kinds[j]; kinds[j] = t; }
  const wantA = 2 + (lv % 3 === 2 ? 1 : 0);
  const aspots = pickSpread(all.filter((c) => c.d > 5), wantA, used, (c) => c.walls.length > 0, 10);
  aspots.forEach((c, k) => {
    used.push(c);
    const kind = kinds[k];
    const a = { kind, x: (c.tx + 0.5) * S, z: (c.ty + 0.5) * S, found: false, used: false, t: r() * 5 };
    const w = wallPos(c, r, 0.02), o = new THREE.Group();
    if (kind === 'phone') {
      o.position.set(w.x, 0, w.z); o.rotation.y = w.ry;
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.55, 0.18), std({ color: 0x2b3a46, metalness: 0.4 })); b.position.set(0, 1.35, 0.09); o.add(b);
      const pad = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.18, 0.02), std({ color: 0x999999, metalness: 0.6 })); pad.position.set(0.02, 1.3, 0.19); o.add(pad);
      const hs = new THREE.Mesh(new THREE.CapsuleGeometry(0.03, 0.2, 4, 8), std({ color: 0x111111 })); hs.position.set(-0.12, 1.4, 0.2); o.add(hs); a.part = hs;
      a.ax = w.x + w.nx * 0.5; a.az = w.z + w.nz * 0.5;
    } else if (kind === 'tv') {
      o.position.set(a.x + w.nx * -0.2, 0, a.z + w.nz * -0.2); o.rotation.y = w.ry;
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.5, 0.45), std({ color: 0x3a3226, roughness: 0.8 })); b.position.y = 0.25; o.add(b);
      const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.36), new THREE.MeshBasicMaterial({ map: staticTexture(), color: new THREE.Color(1.6, 1.6, 1.7) })); scr.position.set(0, 0.27, 0.226); o.add(scr); a.screen = scr;
      a.light = new THREE.PointLight(0xbcd0ff, 1.2, 4, 1.6); a.light.position.set(0, 0.35, 0.6); o.add(a.light);
      a.ax = a.x; a.az = a.z;
    } else if (kind === 'chair') {
      o.position.set(a.x, 0, a.z); o.rotation.y = w.ry + Math.PI;
      const wm = std({ color: 0x6b4a2e, roughness: 0.8 });
      const seat = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.05, 0.45), wm); seat.position.y = 0.46; o.add(seat);
      for (const [lx, lz] of [[-0.19, -0.19], [0.19, -0.19], [-0.19, 0.19], [0.19, 0.19]]) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.46, 0.04), wm); l.position.set(lx, 0.23, lz); o.add(l); }
      const back = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.5, 0.04), wm); back.position.set(0, 0.74, -0.2); o.add(back);
      a.ax = a.x; a.az = a.z; a.face = w.ry + Math.PI;
    } else if (kind === 'mannequin') {
      o.position.set(a.x, 0, a.z);
      const sk = std({ color: 0xd9d2c6, roughness: 0.35 });
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.6, 4, 10), sk); body.position.y = 1.2; body.scale.z = 0.7; o.add(body);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 12), sk); head.scale.y = 1.25; head.position.y = 1.78; o.add(head);
      for (const s of [-1, 1]) {
        const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.04, 0.6, 4, 8), sk); arm.position.set(s * 0.22, 1.15, 0); arm.rotation.z = s * 0.08; o.add(arm);
        const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.75, 4, 8), sk); leg.position.set(s * 0.09, 0.45, 0); o.add(leg);
      }
      a.ax = a.x; a.az = a.z;
    } else if (kind === 'hands') {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 2.2), new THREE.MeshLambertMaterial({ map: handsTex(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
      m.position.set(w.x, 1.15, w.z); m.rotation.y = w.ry; o.add(m);
      a.ax = w.x + w.nx * 1.5; a.az = w.z + w.nz * 1.5;
    } else if (kind === 'door') {
      o.position.set(w.x, 0, w.z); o.rotation.y = w.ry;
      const fr = std({ color: 0x4a3626, roughness: 0.7 });
      const d = new THREE.Mesh(new THREE.BoxGeometry(0.9, 2.05, 0.06), std({ color: 0x7a5a3c, roughness: 0.7 })); d.position.set(0, 1.025, 0.03); o.add(d);
      for (const [fx, fy, fw, fh] of [[-0.48, 1.05, 0.06, 2.1], [0.48, 1.05, 0.06, 2.1], [0, 2.12, 1.02, 0.07]]) { const f = new THREE.Mesh(new THREE.BoxGeometry(fw, fh, 0.08), fr); f.position.set(fx, fy, 0.04); o.add(f); }
      const kn = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), std({ color: 0xc8a050, metalness: 0.8, roughness: 0.3 })); kn.position.set(0.34, 1.0, 0.08); o.add(kn);
      a.ax = w.x + w.nx * 0.6; a.az = w.z + w.nz * 0.6;
    } else if (kind === 'bed') {
      o.position.set(a.x - w.nx * 0.15, 0, a.z - w.nz * 0.15); o.rotation.y = w.ry;
      const fr = std({ color: 0x5b4636, roughness: 0.8 });
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.3, 1.9), fr); base.position.set(0, 0.2, 0.2); o.add(base);
      const mat = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.16, 1.82), std({ color: 0xd8d0c0, roughness: 0.95 })); mat.position.set(0, 0.42, 0.2); o.add(mat);
      const pil = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.1, 0.32), std({ color: 0xf0ece0, roughness: 0.95 })); pil.position.set(0, 0.55, -0.55); o.add(pil);
      const bl = new THREE.Mesh(new THREE.BoxGeometry(0.94, 0.04, 1.1), std({ color: 0x7a2630, roughness: 0.95 })); bl.position.set(0, 0.52, 0.55); o.add(bl);
      const hb = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.75, 0.06), fr); hb.position.set(0, 0.55, -0.78); o.add(hb);
      a.ax = a.x; a.az = a.z;
    } else if (kind === 'clock') {
      o.position.set(w.x, 0, w.z); o.rotation.y = w.ry;
      const face = new THREE.Mesh(new THREE.CircleGeometry(0.25, 32), new THREE.MeshLambertMaterial({ map: clockTex(), emissive: 0x222018 })); face.position.set(0, 1.8, 0.03); o.add(face);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.255, 0.025, 8, 32), std({ color: 0x3a2a1a })); rim.position.set(0, 1.8, 0.03); o.add(rim);
      const hm = new THREE.MeshBasicMaterial({ color: 0x111111 });
      const hh = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.13, 0.01), hm); hh.geometry.translate(0, 0.065, 0); hh.position.set(0, 1.8, 0.04); o.add(hh);
      const mh = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.2, 0.01), hm); mh.geometry.translate(0, 0.1, 0); mh.position.set(0, 1.8, 0.045); o.add(mh);
      a.hh = hh; a.mh = mh; a.ax = w.x + w.nx * 1.2; a.az = w.z + w.nz * 1.2;
    }
    a.obj = o; add(o);
    ex.anoms.push(a);
  });
  return ex;
}

// анимация заданий и аномалий: см — «смотрит ли игрок на точку»
function updateExtras(ex, dt, t, ctx) {
  for (const it of ex.items) {
    if (it.type === 'ticket' && !it.taken) { it.obj.userData.spin.rotation.y = t * 1.8; it.obj.userData.spin.position.y = 0.9 + Math.sin(t * 2.2) * 0.06; }
    if ((it.type === 'valve' || it.type === 'lever') && it.anim > 0) {
      it.anim = Math.max(0, it.anim - dt);
      if (it.type === 'valve') it.part.rotation.z += dt * 5;
      else it.part.rotation.x = 0.7 - (1 - it.anim / 1.2) * 1.4;
    }
  }
  ex.staticT -= dt;
  for (const a of ex.anoms) {
    a.t += dt;
    if (a.kind === 'tv' && !a.used && ex.staticT <= 0) { drawStatic(Math.sin(a.t * 0.7) > 0.93); a.light.intensity = 0.8 + Math.random() * 0.8; }
    if (a.kind === 'phone' && !a.used) a.part.position.y = 1.4 + (Math.sin(a.t * 40) > 0 && (a.t % 3) < 1.2 ? 0.006 : 0);
    if (a.kind === 'clock') { a.mh.rotation.z = a.t * 1.2; a.hh.rotation.z = a.t * 0.1; }
    if (a.kind === 'chair' && !ctx.sees(a.x, 0.6, a.z)) { a.obj.rotation.y = Math.atan2(ctx.px - a.x, ctx.pz - a.z); }
    if (a.kind === 'mannequin' && !a.used) {
      a.obj.rotation.y = Math.atan2(ctx.px - a.obj.position.x, ctx.pz - a.obj.position.z);
      const d = Math.hypot(ctx.px - a.obj.position.x, ctx.pz - a.obj.position.z);
      a.mt = (a.mt || 0) - dt;
      if (d > 3 && d < 16 && a.mt <= 0 && !ctx.sees(a.obj.position.x, 1.2, a.obj.position.z)) {
        a.mt = 1.5 + Math.random() * 2;
        const nx = a.obj.position.x + (ctx.px - a.obj.position.x) / d * 1.4, nz = a.obj.position.z + (ctx.pz - a.obj.position.z) / d * 1.4;
        if (ctx.walk(nx, nz)) { a.obj.position.x = nx; a.obj.position.z = nz; a.ax = nx; a.az = nz; }
      }
    }
  }
  if (ex.staticT <= 0) ex.staticT = 0.08;
}

// меловая стрелка на полу
let arrowMat = null;
function addMark(ex, x, z, yaw, y = 0.012) {
  if (!arrowMat) arrowMat = new THREE.MeshBasicMaterial({ map: arrowTex(), transparent: true, depthWrite: false, color: new THREE.Color(1.3, 1.3, 1.2), polygonOffset: true, polygonOffsetFactor: -3 });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(0.75, 0.75), arrowMat);
  m.rotation.x = -Math.PI / 2; m.rotation.z = yaw; m.position.set(x, y, z);
  ex.markGroup.add(m); ex.marks.push({ x, z, yaw, m });
  if (ex.marks.length > 40) { const o = ex.marks.shift(); ex.markGroup.remove(o.m); o.m.geometry.dispose(); }
}

export { TASK_BY_LEVEL, taskFor, TASK_GOAL, ANOMS, ANOM_KEYS, buildExtras, updateExtras, addMark };
