import * as THREE from 'three';
import { angleDiff } from '../core/util.js';
import { S } from './level.js';
import { fbm, canvas } from '../render/textures.js';
import { rng } from '../core/util.js';

// Монстры: анатомическая модель из примитивов, текстура кожи, анимация и поведение по типу.

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const texCache = new Map();

// кожа: пятна, вены, поры; у марионетки — дерево с краской
function skinTexture(L) {
  const key = (L.puppet ? 'p' : L.suit ? 's' : 'k') + L.skin.join(',') + (L.wet ? 'w' : '');
  if (texCache.has(key)) return texCache.get(key);
  const W = 256, r = rng(L.skin[0] * 7 + L.skin[1] * 13 + 3);
  const n = fbm(W, W, r, [[4, 0.4], [16, 0.3], [64, 0.2], [128, 0.1]]);
  const c = canvas(W, W), x = c.getContext('2d'), id = x.createImageData(W, W), d = id.data;
  const [R, G, B] = L.skin;
  for (let i = 0; i < W * W; i++) {
    let f = 0.82 + (n[i] - 0.5) * (L.puppet ? 0.25 : 0.6) + (r() - 0.5) * 0.08;
    if (L.puppet) { const y = (i / W) | 0; f *= 0.93 + 0.07 * Math.sin(y * 0.35 + n[i] * 12); }
    d[i * 4] = R * f; d[i * 4 + 1] = G * f; d[i * 4 + 2] = B * f; d[i * 4 + 3] = 255;
  }
  x.putImageData(id, 0, 0);
  if (!L.puppet && !L.suit) {
    x.lineCap = 'round';
    for (let k = 0; k < 22; k++) {
      let px = r() * W, py = r() * W, a = r() * 6.28;
      x.strokeStyle = `rgba(${60 + r() * 40},${20 + r() * 20},${50 + r() * 30},${0.18 + r() * 0.2})`; x.lineWidth = 0.6 + r() * 1.4;
      x.beginPath(); x.moveTo(px, py);
      for (let s = 0; s < 12; s++) { a += (r() - 0.5) * 1.1; px += Math.cos(a) * 7; py += Math.sin(a) * 7; x.lineTo(px, py); }
      x.stroke();
    }
    for (let k = 0; k < 120; k++) { x.fillStyle = `rgba(40,20,20,${(r() * 0.25).toFixed(2)})`; x.beginPath(); x.arc(r() * W, r() * W, 0.5 + r() * 2.2, 0, 7); x.fill(); }
  }
  if (L.suit) { x.fillStyle = 'rgba(20,20,26,0.75)'; x.fillRect(0, W * 0.25, W, W * 0.75); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping;
  texCache.set(key, t);
  return t;
}

function makeEntityMesh(look = {}) {
  const L = Object.assign({ skin: [150, 138, 128], height: 1, thin: 1, eyes: 'glow', mouth: 'jaw', posture: 'hunch' }, look);
  const group = new THREE.Group();
  const body = new THREE.Group(); body.scale.setScalar(L.height); group.add(body);
  const mats = [];
  let mat;
  if (L.shadow) mat = new THREE.MeshStandardMaterial({ color: 0x030303, roughness: 1, transparent: true, opacity: 1 });
  else {
    const t = skinTexture(L);
    mat = new THREE.MeshStandardMaterial({ map: t, bumpMap: t, bumpScale: 4, roughness: L.wet ? 0.22 : (L.puppet ? 0.55 : 0.8), metalness: L.wet ? 0.08 : 0 });
  }
  mats.push(mat);
  const dark = new THREE.MeshStandardMaterial({ color: 0x0b0606, roughness: 0.9 }); mats.push(dark);
  const glow = new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 5.6, 4.6) }); mats.push(glow);
  const tooth = new THREE.MeshStandardMaterial({ color: 0xd8cfb4, roughness: 0.5 }); mats.push(tooth);
  const T = L.thin;
  const limb = (r1, r2, h, seg = 10) => { const g = new THREE.CylinderGeometry(r1 * T, r2 * T, h, seg); g.translate(0, -h / 2, 0); return new THREE.Mesh(g, mat); };
  const joint = (r) => new THREE.Mesh(new THREE.SphereGeometry(r * T, 10, 8), mat);

  const hips = new THREE.Group(); hips.position.y = 1.12; body.add(hips);
  const pelvis = new THREE.Mesh(new THREE.SphereGeometry(0.13, 14, 10), mat); pelvis.scale.set(1.25 * T, 0.7, 0.9 * T); hips.add(pelvis);
  const spine = new THREE.Group(); hips.add(spine);
  // грудная клетка: профиль вращения + рёбра + позвонки
  const prof = [[0.1, 0], [0.13, 0.08], [0.15, 0.25], [0.19, 0.46], [0.2, 0.6], [0.18, 0.72], [0.13, 0.83], [0.07, 0.88]].map(([a, b]) => new THREE.Vector2(a * T, b));
  const torso = new THREE.Mesh(new THREE.LatheGeometry(prof, 20), mat); torso.scale.z = 0.66; spine.add(torso);
  for (let k = 0; k < 5; k++) {
    const rib = new THREE.Mesh(new THREE.TorusGeometry(0.195 * T - k * 0.006, 0.011, 6, 18, Math.PI * 1.15), mat);
    rib.rotation.x = Math.PI / 2; rib.rotation.z = Math.PI * 0.92; rib.scale.y = 0.68; rib.position.y = 0.42 + k * 0.065; spine.add(rib);
  }
  for (let k = 0; k < 9; k++) { const v = new THREE.Mesh(new THREE.SphereGeometry(0.022, 6, 5), mat); v.position.set(0, 0.06 + k * 0.095, -0.12 * T); spine.add(v); }
  const chest = new THREE.Group(); chest.position.y = 0.84; spine.add(chest);
  const sh = new THREE.Mesh(new THREE.CapsuleGeometry(0.055 * T, 0.36, 4, 10), mat); sh.rotation.z = Math.PI / 2; chest.add(sh);
  const ng = new THREE.CylinderGeometry(0.028 * T, 0.042 * T, 0.28, 8); ng.translate(0, 0.14, 0); chest.add(new THREE.Mesh(ng, mat));
  const head = new THREE.Group(); head.position.y = 0.29; chest.add(head);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.14, 26, 20), mat); skull.scale.set(0.9, 1.28, 1.02); skull.position.y = 0.18; head.add(skull);
  const brow = new THREE.Mesh(new THREE.CapsuleGeometry(0.025, 0.13, 4, 8), mat); brow.rotation.z = Math.PI / 2; brow.position.set(0, 0.24, 0.115); head.add(brow);
  const cheekG = new THREE.SphereGeometry(0.035, 8, 6);
  for (const s of [-1, 1]) { const ck = new THREE.Mesh(cheekG, mat); ck.position.set(s * 0.075, 0.16, 0.1); head.add(ck); }
  // глаза
  const eyes = [];
  const socketG = new THREE.SphereGeometry(0.034, 12, 10), pupilG = new THREE.SphereGeometry(0.012, 8, 6);
  const addEye = (x, y, z, s = 1, lit = true) => {
    const so = new THREE.Mesh(socketG, dark); so.scale.setScalar(s); so.position.set(x, y, z); head.add(so);
    if (lit) { const p = new THREE.Mesh(pupilG, glow); p.scale.setScalar(s); p.position.set(x, y, z + 0.024 * s); head.add(p); eyes.push(p); }
  };
  if (L.eyes === 'glow') { addEye(-0.052, 0.205, 0.105); addEye(0.052, 0.205, 0.105); }
  else if (L.eyes === 'hollow') { addEye(-0.055, 0.205, 0.1, 1.25); addEye(0.055, 0.205, 0.1, 1.25); eyes.forEach((e) => e.scale.setScalar(0.5)); }
  else if (L.eyes === 'many') { for (const [ex, ey, s] of [[-0.06, 0.22, 1], [0.06, 0.22, 1], [-0.03, 0.27, 0.7], [0.03, 0.27, 0.7], [-0.08, 0.16, 0.6], [0.08, 0.16, 0.6]]) addEye(ex, ey, 0.1, s); }
  else if (L.eyes === 'painted') {
    const ring = new THREE.MeshBasicMaterial({ color: 0x111111 }); mats.push(ring);
    for (const s of [-1, 1]) { const e = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.007, 6, 16), ring); e.position.set(s * 0.055, 0.21, 0.122); head.add(e); const p = new THREE.Mesh(pupilG, glow); p.position.set(s * 0.055, 0.21, 0.13); head.add(p); eyes.push(p); }
    const blush = new THREE.MeshBasicMaterial({ color: 0xc8343c }); mats.push(blush);
    for (const s of [-1, 1]) { const b = new THREE.Mesh(new THREE.CircleGeometry(0.022, 12), blush); b.position.set(s * 0.085, 0.15, 0.118); b.rotation.y = s * 0.5; head.add(b); }
  } else if (L.eyes === 'none') {
    for (const s of [-1, 1]) { const st = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.006, 0.01), dark); st.position.set(s * 0.052, 0.205, 0.124); st.rotation.z = s * 0.15; head.add(st); for (let k = -1; k <= 1; k++) { const sc = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.026, 0.008), dark); sc.position.set(s * 0.052 + k * 0.018, 0.205, 0.126); head.add(sc); } }
  }
  // рот
  const jaw = new THREE.Group(); jaw.position.set(0, 0.12, 0.02); head.add(jaw);
  if (L.mouth === 'jaw') {
    const jg = new THREE.SphereGeometry(0.1, 16, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2); const jm = new THREE.Mesh(jg, mat); jm.scale.set(0.82, 0.9, 0.95); jaw.add(jm);
    const inside = new THREE.Mesh(new THREE.CircleGeometry(0.06, 14), dark); inside.position.set(0, -0.01, 0.07); jaw.add(inside);
    for (let k = -3; k <= 3; k++) { const tt = new THREE.Mesh(new THREE.ConeGeometry(0.008, 0.03, 5), tooth); tt.position.set(k * 0.015, 0.0, 0.078 - Math.abs(k) * 0.005); tt.rotation.x = Math.PI; jaw.add(tt); }
  } else if (L.mouth === 'grin') {
    const gm = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.012, 6, 30, Math.PI * 0.85), dark); gm.position.set(0, 0.02, 0.1); gm.rotation.z = -Math.PI * 0.925; gm.scale.set(1, 0.55, 1); jaw.add(gm);
    for (let k = -6; k <= 6; k++) { const a = -Math.PI / 2 + k * 0.105; const tt = new THREE.Mesh(new THREE.BoxGeometry(0.011, 0.02, 0.008), tooth); tt.position.set(Math.cos(a) * 0.082, 0.02 + Math.sin(a) * 0.045, 0.108); tt.rotation.z = a + Math.PI / 2; jaw.add(tt); }
  } else if (L.mouth === 'painted') {
    const red = new THREE.MeshBasicMaterial({ color: 0xa01820 }); mats.push(red);
    const gm = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.008, 6, 24, Math.PI * 0.7), red); gm.position.set(0, 0.03, 0.104); gm.rotation.z = -Math.PI * 0.85; gm.scale.set(1, 0.6, 1); jaw.add(gm);
  }
  // руки: плечо, локоть, предплечье, кисть с фалангами
  const arms = [], legs = [], wrists = [];
  for (const s of [-1, 1]) {
    const shp = new THREE.Group(); shp.position.set(s * 0.24, 0, 0); chest.add(shp);
    shp.add(joint(0.045)); shp.add(limb(0.036, 0.028, 0.72));
    const el = new THREE.Group(); el.position.y = -0.72; shp.add(el);
    el.add(joint(0.032)); el.add(limb(0.03, 0.02, 0.8));
    const hand = new THREE.Group(); hand.position.y = -0.8; el.add(hand); wrists.push(hand);
    const palm = new THREE.Mesh(new THREE.BoxGeometry(0.06 * T, 0.08, 0.025), mat); palm.position.y = -0.04; hand.add(palm);
    for (let f = 0; f < 4; f++) {
      const fg = new THREE.Group(); fg.position.set((f - 1.5) * 0.016, -0.08, 0); fg.rotation.z = (f - 1.5) * 0.08; hand.add(fg);
      fg.add(limb(0.008, 0.006, 0.13, 5));
      const f2 = new THREE.Group(); f2.position.y = -0.13; f2.rotation.x = -0.35; fg.add(f2); f2.add(limb(0.006, 0.003, 0.12, 5));
    }
    shp.rotation.z = s * 0.1;
    arms.push({ sh: shp, el, s });
    const hp = new THREE.Group(); hp.position.set(s * 0.1, -0.02, 0); hips.add(hp);
    hp.add(limb(0.06, 0.042, 0.56));
    const kn = new THREE.Group(); kn.position.y = -0.56; hp.add(kn);
    kn.add(joint(0.045)); kn.add(limb(0.045, 0.03, 0.54));
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.07 * T, 0.035, 0.22), mat); foot.position.set(0, -0.55, 0.06); kn.add(foot);
    legs.push({ hp, kn, s });
  }
  // нити марионетки
  if (L.puppet) {
    const lm = new THREE.LineBasicMaterial({ color: 0xdedede, transparent: true, opacity: 0.55 }); mats.push(lm);
    for (const w of [...wrists, head]) {
      const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 30, 0)]);
      const ln = new THREE.Line(g, lm); ln.userData.string = true; w.add(ln);
    }
  }
  // склеиваем неподвижные части в один меш на материал: ~70 → ~25 вызовов отрисовки (важно для iPad)
  const keep = new Set([group, body, hips, spine, chest, head, jaw, ...arms.flatMap((A) => [A.sh, A.el]), ...legs.flatMap((G) => [G.hp, G.kn])]);
  bake(group, keep);
  group.traverse((o) => { o.frustumCulled = false; });
  return { group, body, hips, spine, chest, head, jaw, arms, legs, eyes, mat, look: L, mats };
}

function mergeGeo(list) {
  let nv = 0, ni = 0;
  for (const g of list) { nv += g.attributes.position.count; ni += g.index ? g.index.count : g.attributes.position.count; }
  const P = new Float32Array(nv * 3), N = new Float32Array(nv * 3), UV = new Float32Array(nv * 2), I = new Uint32Array(ni);
  let ov = 0, oi = 0;
  for (const g of list) {
    const c = g.attributes.position.count;
    P.set(g.attributes.position.array, ov * 3);
    if (g.attributes.normal) N.set(g.attributes.normal.array, ov * 3);
    if (g.attributes.uv) UV.set(g.attributes.uv.array, ov * 2);
    if (g.index) { const a = g.index.array; for (let k = 0; k < a.length; k++) I[oi + k] = a[k] + ov; oi += a.length; }
    else { for (let k = 0; k < c; k++) I[oi + k] = ov + k; oi += c; }
    ov += c;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(P, 3)); out.setAttribute('normal', new THREE.BufferAttribute(N, 3)); out.setAttribute('uv', new THREE.BufferAttribute(UV, 2));
  out.setIndex(new THREE.BufferAttribute(I, 1));
  return out;
}
// поднимает неподвижные подгруппы в ближайший «живой» узел и склеивает меши с общим материалом
function bake(node, keep) {
  for (const ch of [...node.children]) bake(ch, keep);
  // распускаем неподвижные группы (кроме нитей марионетки и живых узлов)
  for (const ch of [...node.children]) {
    if (keep.has(ch) || ch.isMesh || ch.isLine) continue;
    ch.updateMatrix();
    for (const g of [...ch.children]) { g.updateMatrix(); g.matrix.premultiply(ch.matrix); g.matrix.decompose(g.position, g.quaternion, g.scale); node.add(g); }
    node.remove(ch);
  }
  const by = new Map();
  for (const ch of node.children) {
    if (!ch.isMesh || ch.children.length || keep.has(ch) || ch.material === undefined) continue;
    if (!by.has(ch.material)) by.set(ch.material, []);
    by.get(ch.material).push(ch);
  }
  for (const [m, list] of by) {
    if (list.length < 2) continue;
    const geos = list.map((ms) => { ms.updateMatrix(); const g = ms.geometry.clone(); g.applyMatrix4(ms.matrix); return g; });
    const merged = new THREE.Mesh(mergeGeo(geos), m);
    geos.forEach((g) => g.dispose()); list.forEach((ms) => { ms.geometry.dispose(); node.remove(ms); });
    node.add(merged);
  }
}

class Entity {
  constructor(lvl, mesh, hooks = {}, def = null) {
    this.lvl = lvl; this.m = mesh; this.hooks = hooks;
    this.def = def; this.ai = (def && def.ai) || { stare: 0.15 };
    this.state = 'dormant'; this.timer = 30;
    this.x = 0; this.z = 0; this.y = 0; this.yaw = 0; this.speed = 0; this.ph = 0;
    this.field = null; this.fieldT = 0; this.wp = null; this.mem = 0; this.unseen = 0; this.dist = 99;
    this.tw = 0; this.twT = 1; this.frozen = false; this.t = 0;
    this.turnT = 0; this.lastDir = 0; this.blinkT = 3; this.fleeT = 0; this.lit = false;
    // память: где видел игрока в последний раз; сколько ещё обыскивать то место
    this.lastX = 0; this.lastZ = 0; this.searchT = 0; this.stunT = 0;
    mesh.group.visible = false;
  }
  get active() { return this.state !== 'dormant'; }

  spawn(px, pz) {
    const L = this.lvl, f = L.bfs(Math.floor(px / S), Math.floor(pz / S));
    const c = []; let far = -1, fi = -1;
    for (let i = 0; i < f.length; i++) {
      const v = f[i]; if (v < 0) continue;
      if (v > far) { far = v; fi = i; }
      if (v >= 14) { const x = (i % L.mw + 0.5) * S, z = (((i / L.mw) | 0) + 0.5) * S; if (!L.los(px, pz, x, z)) c.push(i); }
    }
    const i = c.length ? c[(Math.random() * c.length) | 0] : fi;
    if (i < 0) return;
    this.place(i); this.state = 'roam'; this.pickRoam(px, pz);
    this.m.group.visible = true;
    this.hooks.wake && this.hooks.wake();
  }
  place(i) { const L = this.lvl; this.x = (i % L.mw + 0.5) * S; this.z = (((i / L.mw) | 0) + 0.5) * S; this.wp = null; }
  setTarget(tx, ty) { this.field = this.lvl.bfs(tx, ty); this.wp = null; }
  pickRoam(px, pz) {
    const L = this.lvl, near = Math.random() < 0.25;
    for (let k = 0; k < 50; k++) {
      const i = L.floorList[(Math.random() * L.floorList.length) | 0];
      const x = (i % L.mw + 0.5) * S, z = (((i / L.mw) | 0) + 0.5) * S;
      const dE = Math.hypot(x - this.x, z - this.z), dP = Math.hypot(x - px, z - pz);
      if (near ? (dP > 10 && dP < 26) : (dE > 12 && dE < 44)) { this.setTarget(i % L.mw, (i / L.mw) | 0); return; }
    }
    const i = L.floorList[(Math.random() * L.floorList.length) | 0];
    this.setTarget(i % L.mw, (i / L.mw) | 0);
  }
  // обыск: случайная клетка в радиусе ~5 клеток от места, где видел игрока
  searchNear() {
    const L = this.lvl, cx = Math.floor(this.lastX / S), cz = Math.floor(this.lastZ / S);
    for (let k = 0; k < 30; k++) {
      const tx = cx + ((Math.random() * 11) | 0) - 5, tz = cz + ((Math.random() * 11) | 0) - 5;
      const t = L.tile(tx, tz); if (t === 0 || t === 6) { this.setTarget(tx, tz); return; }
    }
    this.state = 'roam'; this.pickRoam(this.lastX, this.lastZ);
  }
  relocate(px, pz, yaw) {
    const L = this.lvl, f = L.bfs(Math.floor(px / S), Math.floor(pz / S));
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw), c = [];
    for (let i = 0; i < f.length; i++) {
      const v = f[i]; if (v < 9 || v > 14) continue;
      const x = (i % L.mw + 0.5) * S, z = (((i / L.mw) | 0) + 0.5) * S;
      if ((x - px) * fx + (z - pz) * fz < 0 && !L.los(px, pz, x, z)) c.push(i);
    }
    if (c.length) { this.place(c[(Math.random() * c.length) | 0]); this.state = 'roam'; this.searchT = 0; this.pickRoam(px, pz); }
  }
  // мгновенно поставить в точку (засада)
  appear(x, z, faceX, faceZ) {
    this.x = x; this.z = z; this.wp = null; this.state = 'chase'; this.mem = 4; this.unseen = 0;
    this.yaw = Math.atan2(faceX - x, faceZ - z); this.m.group.visible = true;
  }
  next() {
    const L = this.lvl;
    if (!this.field) return [this.x, this.z];
    if (this.wp && Math.hypot(this.wp[0] - this.x, this.wp[1] - this.z) > 0.08) return this.wp;
    const ci = L.idx(this.x, this.z), tx = ci % L.mw, ty = (ci / L.mw) | 0, cur = this.field[ci];
    let best = cur < 0 ? 1e9 : cur, bx = -1, by = -1;
    for (const [ox, oy] of DIRS) { const v = this.field[(ty + oy) * L.mw + tx + ox]; if (v >= 0 && v < best) { best = v; bx = tx + ox; by = ty + oy; } }
    if (bx < 0) { this.wp = [(tx + 0.5) * S, (ty + 0.5) * S]; return this.wp; }
    let nx = bx, ny = by, b2 = best;
    for (const [ox, oy] of DIRS) { const v = this.field[(by + oy) * L.mw + bx + ox]; if (v >= 0 && v < b2) { b2 = v; nx = bx + ox; ny = by + oy; } }
    if ((nx !== bx || ny !== by) && L.losWide(this.x, this.z, (nx + 0.5) * S, (ny + 0.5) * S)) this.wp = [(nx + 0.5) * S, (ny + 0.5) * S];
    else this.wp = [(bx + 0.5) * S, (by + 0.5) * S];
    return this.wp;
  }

  // o.targets: [{id, x, z, yaw, safe, noise, dead}] — первый всегда свой игрок.
  // o: stared, lit (луч фонаря на нём), black, music (шарманка играет), mul, moving (игрок идёт)
  update(dt, o) {
    this.t += dt;
    const T = o.targets, me = T[0], ai = this.ai;
    if (this.state === 'dormant') { this.timer -= dt; if (this.timer <= 0) this.spawn(me.x, me.z); return null; }
    const L = this.lvl;
    // оглушён ЭМИ: стоит и дёргается
    if (this.stunT > 0) {
      this.stunT -= dt; this.speed = 0; this.frozen = true;
      this.anim(dt, o); this.m.head.rotation.z = Math.sin(this.t * 50) * 0.4;
      this.m.group.position.set(this.x, this.y, this.z);
      return null;
    }
    let best = null, bestD = 1e9, seen = null, seenD = 1e9, heard = null;
    for (const p of T) {
      if (p.safe || p.dead) continue;
      const d = Math.hypot(p.x - this.x, p.z - this.z);
      if (d < bestD) { bestD = d; best = p; }
      if (!ai.blind && d < 26 && d < seenD && L.los(this.x, this.z, p.x, p.z)) { seenD = d; seen = p; }
      const hr = p.noise * (ai.hear || 1);
      if (hr > 0 && d < hr && (!heard || d < heard.d)) heard = { p, d };
    }
    // слепой «видит» только вплотную
    if (ai.blind && best && bestD < 2.2) { seen = best; seenD = bestD; }
    this.dist = Math.hypot(me.x - this.x, me.z - this.z);
    const tgt = seen || best || me;
    const dx = tgt.x - this.x, dz = tgt.z - this.z, dist = Math.hypot(dx, dz);
    const ptx = Math.floor(tgt.x / S), ptz = Math.floor(tgt.z / S);
    if (seen) {
      if (this.state !== 'chase') this.hooks.spot && this.hooks.spot();
      this.state = 'chase'; this.mem = 2.2; this.unseen = 0;
      this.lastX = seen.x; this.lastZ = seen.z;
    } else {
      this.unseen += dt;
      // потерял из виду: ещё ~2 с «чует», куда ты свернул, потом идёт туда, где видел в последний раз, и обыскивает
      if (this.state === 'chase') {
        this.mem -= dt;
        if (this.mem > 0 && best) { this.lastX = best.x; this.lastZ = best.z; }
        else { this.state = 'hunt'; this.searchT = 12; this.setTarget(Math.floor(this.lastX / S), Math.floor(this.lastZ / S)); }
      }
      if (heard && this.state !== 'chase' && (this.state !== 'hunt' || Math.random() < dt * 1.5)) {
        this.state = 'hunt'; this.searchT = Math.max(this.searchT, 8);
        this.lastX = heard.p.x; this.lastZ = heard.p.z; this.setTarget(Math.floor(heard.p.x / S), Math.floor(heard.p.z / S));
      }
      if (this.state === 'hunt') { this.searchT -= dt; if (this.searchT <= 0) { this.state = 'roam'; this.pickRoam(me.x, me.z); } }
    }
    if (o.force && !seen && best) { if (this.state !== 'chase') { this.state = 'chase'; this.field = null; } this.mem = 2.2; this.unseen = 0; }
    // давно не встречались: переносится поближе, но просто бродит, а не идёт к игроку
    if (!seen && this.state === 'roam' && this.unseen > 40 && bestD > 40 && best) { this.relocate(best.x, best.z, best.yaw); this.unseen = 0; }
    // скорость по типу
    let sp = this.state === 'chase' ? 3.25 : this.state === 'hunt' ? 2.4 : 1.35;
    sp *= o.mul * (ai.speed || 1) * (ai.fast || 1);
    if (ai.blind && this.state === 'hunt') sp *= 1.25;
    if (ai.water) sp *= L.tile(Math.floor(this.x / S), Math.floor(this.z / S)) === 6 ? ai.water : ai.dry;
    if (ai.shadow) sp *= o.black ? 2.1 : 0.55;
    if (o.black) sp += 0.9;
    if (ai.music) sp *= o.music ? 0.04 : 1.45;
    if (ai.straight) { this.turnT -= dt; sp *= this.turnT > 0 ? ai.turn : ai.straight; }
    this.frozen = !!o.stared && (ai.stare ?? 0.15) < 0.5;
    if (o.stared) sp *= ai.stare ?? 0.15;
    if (ai.music && o.music) this.frozen = true;
    // боится света: отступает
    this.lit = !!o.lit;
    if (ai.fear && o.lit && dist < 15) { this.fleeT = 2.2; }
    if (this.fleeT > 0) {
      this.fleeT -= dt;
      const f = L.bfs(Math.floor(tgt.x / S), Math.floor(tgt.z / S)), ci = L.idx(this.x, this.z), tx_ = ci % L.mw, ty_ = (ci / L.mw) | 0;
      let bv = f[ci], bj = -1; for (const [ox, oy] of DIRS) { const v = f[(ty_ + oy) * L.mw + tx_ + ox]; if (v > bv) { bv = v; bj = (ty_ + oy) * L.mw + tx_ + ox; } }
      if (bj >= 0) { this.wp = [(bj % L.mw + 0.5) * S, (((bj / L.mw) | 0) + 0.5) * S]; }
      sp = 3.0; this.state = 'hunt';
    }
    // Улыбака: телепортируется рывками, пока на него не смотрят
    if (ai.blink && !o.stared) {
      this.blinkT -= dt;
      if (this.blinkT <= 0) {
        this.blinkT = 1.6 + Math.random() * 2.4;
        if (this.state === 'roam' || !this.field) { this.field = L.bfs(ptx, ptz); }
        else if (this.state === 'chase' || this.state === 'hunt') { this.field = L.bfs(ptx, ptz); this.state = 'hunt'; }
        this.wp = null;
        const steps = dist < 6 ? 1 : 2 + ((Math.random() * 2) | 0);
        for (let k = 0; k < steps; k++) { const w = this.next(); this.x = w[0]; this.z = w[1]; this.wp = null; }
        this.yaw = Math.atan2(tgt.x - this.x, tgt.z - this.z);
        this.hooks.blink && this.hooks.blink(this.x, this.z);
      }
      sp = dist < 3.5 ? 2.6 : 0.25;
    }
    this.speed = sp;
    let tx, tz;
    if (this.fleeT > 0 && this.wp) { [tx, tz] = this.wp; }
    else if (this.state === 'chase') {
      if (seen && dist < 6) { tx = tgt.x; tz = tgt.z; this.wp = null; }
      else {
        this.fieldT -= dt;
        if (this.fieldT <= 0 || !this.field || this.fieldFor !== tgt.id) { this.field = L.bfs(ptx, ptz); this.fieldT = 0.35; this.wp = null; this.fieldFor = tgt.id; }
        [tx, tz] = this.next();
      }
    } else {
      const ci = L.idx(this.x, this.z);
      if (!this.field || this.field[ci] === 0) {
        if (this.state === 'hunt' && this.searchT > 0) this.searchNear();
        else { this.state = 'roam'; this.pickRoam(me.x, me.z); }
      }
      else if (this.field[ci] < 0) { this.relocate(me.x, me.z, me.yaw); }
      [tx, tz] = this.next();
    }
    const mx = tx - this.x, mz = tz - this.z, ml = Math.hypot(mx, mz);
    if (ml > 0.001) {
      const st = Math.min(ml, sp * dt);
      this.x += mx / ml * st; this.z += mz / ml * st;
      const dir = Math.atan2(mx, mz);
      if (ai.straight && Math.abs(angleDiff(this.lastDir, dir)) > 0.6) this.turnT = 0.55;
      this.lastDir = dir;
      if (dist > 4 && !o.stared) this.yaw += angleDiff(this.yaw, dir) * Math.min(1, dt * 6);
    }
    if (dist <= 4 || o.stared) this.yaw += angleDiff(this.yaw, Math.atan2(dx, dz)) * Math.min(1, dt * 8);
    this.anim(dt, o);
    this.y += (L.groundY(this.x, this.z) - this.y) * Math.min(1, dt * 5);
    this.m.group.position.set(this.x, this.y, this.z);
    this.m.group.rotation.y = this.yaw;
    for (const p of T) if (!p.safe && !p.dead && Math.hypot(p.x - this.x, p.z - this.z) < 0.85) return { kill: p.id };
    return null;
  }
  pack() { return [Math.round(this.x * 100) / 100, Math.round(this.z * 100) / 100, Math.round(this.yaw * 100) / 100, ['dormant', 'roam', 'hunt', 'chase'].indexOf(this.state), Math.round(this.speed * 10) / 10, this.frozen ? 1 : 0]; }
  remote(dt, e, px, pz) {
    this.t += dt;
    if (e) {
      const st = ['dormant', 'roam', 'hunt', 'chase'][e[3]] || 'dormant';
      if (st !== 'dormant' && this.state === 'dormant') { this.x = e[0]; this.z = e[1]; this.hooks.wake && this.hooks.wake(); }
      if (st === 'chase' && this.state !== 'chase') this.hooks.spot && this.hooks.spot();
      this.state = st; this.speed = e[4]; this.frozen = !!e[5];
      const k = Math.min(1, dt * 10);
      if (Math.hypot(e[0] - this.x, e[1] - this.z) > 3) { this.x = e[0]; this.z = e[1]; }
      this.x += (e[0] - this.x) * k; this.z += (e[1] - this.z) * k; this.yaw += angleDiff(this.yaw, e[2]) * k;
    }
    this.m.group.visible = this.state !== 'dormant';
    this.dist = this.state === 'dormant' ? 99 : Math.hypot(px - this.x, pz - this.z);
    if (this.state === 'dormant') return;
    this.anim(dt, {});
    this.y += (this.lvl.groundY(this.x, this.z) - this.y) * Math.min(1, dt * 5);
    this.m.group.position.set(this.x, this.y, this.z);
    this.m.group.rotation.y = this.yaw;
  }

  anim(dt, o = {}) {
    const m = this.m, L = m.look, moving = this.speed > 0.3 && !this.frozen;
    const prev = Math.sin(this.ph);
    if (!this.frozen) this.ph += dt * this.speed * (L.posture === 'crawl' ? 3.2 : 2.3);
    const s = Math.sin(this.ph);
    if (moving && (prev < 0) !== (s < 0) && !(this.ai.mimic && o.moving)) this.hooks.step && this.hooks.step(this.x, this.z, this.speed);
    const a = moving ? Math.min(1, this.speed / 2) : 0;
    if (L.posture === 'crawl') {
      m.hips.position.y = 0.62 + Math.abs(s) * 0.03 * a;
      m.spine.rotation.x = 1.3; m.head.rotation.x = -1.15;
      for (const A of m.arms) { const ph = this.ph + (A.s > 0 ? 0 : Math.PI); A.sh.rotation.x = -1.05 + Math.sin(ph) * 0.5 * a; A.el.rotation.x = -0.5 + Math.max(0, Math.cos(ph)) * 0.6 * a; A.sh.rotation.z = A.s * 0.25; }
      for (const G of m.legs) { const ph = this.ph + (G.s > 0 ? Math.PI : 0); G.hp.rotation.x = -0.9 - Math.sin(ph) * 0.4 * a; G.kn.rotation.x = 1.5 + Math.max(0, Math.cos(ph)) * 0.4 * a; }
    } else {
      for (const G of m.legs) { const ph = this.ph + (G.s > 0 ? Math.PI : 0); G.hp.rotation.x = -Math.sin(ph) * 0.55 * a; G.kn.rotation.x = Math.max(0, Math.cos(ph)) * 0.9 * a + 0.06; }
      for (const A of m.arms) { const ph = this.ph + (A.s > 0 ? 0 : Math.PI); A.sh.rotation.x = -Math.sin(ph) * 0.3 * a + Math.sin(this.t * 1.7 + A.s) * 0.05; A.el.rotation.x = -0.25 - 0.2 * a; A.sh.rotation.z = A.s * 0.1; }
      m.hips.position.y = 1.12 + Math.abs(s) * 0.04 * a;
      m.spine.rotation.x = (L.posture === 'hunch' ? 0.24 : 0.06) + (this.state === 'chase' ? 0.15 : 0);
      if (L.puppet) { // рывки марионетки
        const j = Math.sin(this.t * 7) > 0.6 ? 0.35 : 0;
        m.arms[0].sh.rotation.z = -0.3 - j; m.arms[1].sh.rotation.z = 0.3 + j * 0.6; m.head.rotation.x = this.frozen ? 0.5 : -0.1;
      }
    }
    this.twT -= dt;
    if (this.twT <= 0) { this.twT = 0.4 + Math.random() * 2.2; this.tw = (Math.random() - 0.5) * 1.1; }
    const tgt = this.frozen ? 0.45 : this.tw;
    m.head.rotation.z += (tgt - m.head.rotation.z) * Math.min(1, dt * (this.frozen ? 2 : 22));
    if (L.posture !== 'crawl' && !L.puppet) m.head.rotation.x = -0.15;
    const open = this.state === 'chase' ? 0.35 + Math.sin(this.t * 9) * 0.08 : 0.08;
    m.jaw.rotation.x += (open - m.jaw.rotation.x) * Math.min(1, dt * 6);
    m.group.scale.x = Math.random() < 0.025 ? 1.12 : 1;
  }
  setVisibility(op) {
    const mm = this.m.mat;
    if (!this.m.look.shadow) return;
    mm.opacity = op; mm.depthWrite = op > 0.9; mm.needsUpdate = false;
  }
  scarePose(t) {
    const m = this.m;
    m.spine.rotation.x = 0.45; m.hips.position.y = 1.12;
    for (const A of m.arms) { A.sh.rotation.x = -1.35 + Math.sin(t * 30) * 0.05; A.sh.rotation.z = A.s * 0.35; A.el.rotation.x = -0.35; }
    for (const G of m.legs) { G.hp.rotation.x = 0; G.kn.rotation.x = 0.1; }
    m.head.rotation.z = Math.sin(t * 47) * 0.25; m.head.rotation.x = 0.1;
    m.jaw.rotation.x = 0.55 + Math.sin(t * 40) * 0.1;
    m.group.scale.x = 1;
  }
}

function disposeMesh(group) {
  const mats = new Set();
  group.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) mats.add(o.material); });
  mats.forEach((m) => { if (m.map && texCache.size > 30) m.map.dispose(); m.dispose(); });
}

export { makeEntityMesh, Entity, disposeMesh };
