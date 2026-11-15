// Шафки для схованки. Три моделі, у кожного рівня свій набір, а в межах рівня — різні кольори, знос,
// розмір ряду, відчинені дверцята, відсутні таблички:
//  school   — металеві шкільні шафки рядом по 1–3, жалюзі вгорі й унизу, номери;
//  wardrobe — дерев'яна шафа з двома дверцятами з жалюзі, карнизом і ніжками;
//  cabinet  — промислова двостулкова металева шафа з перфорацією й засувом.
// Зсередини гравець дивиться крізь справжні щілини дверцят. Фарба/дерево — фото-текстури CC0.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { shaded } from './finds.js';
import { canvas } from '../render/textures.js';

const SCHOOL = { w: 0.44, d: 0.52, h: 1.86, base: 0.09 };
const BIG = { w: 0.92, d: 0.58, h: 1.96, base: 0.1 };
const T = 0.014;
// набор шкафчиков и палитра по теме уровня (id % 10)
const THEME = [
  { styles: ['wardrobe', 'school'], paint: [0x6f7d5a, 0x5f7a72, 0x7d7458], wood: [0xf2c890, 0xdcae78] },
  { styles: ['cabinet', 'school'], paint: [0x5c6c66, 0x6b6f72, 0x4f5d58], wood: [0xc89868] },
  { styles: ['cabinet', 'cabinet', 'school'], paint: [0x4d6278, 0x8a6a2a, 0x5a6268], wood: [0xc89868] },
  { styles: ['school'], paint: [0xc23a32, 0x2f62c0, 0xd8b030, 0x3a9a50], wood: [0xf2c890] },
  { styles: ['school', 'wardrobe'], paint: [0x5d6c4c, 0x4f6a5a, 0x6a6a48], wood: [0xb08860, 0x9a7a58] },
  { styles: ['school'], paint: [0x8fb4c4, 0xd8dcd6, 0x7aa0b0], wood: [0xf2c890] },
  { styles: ['wardrobe', 'school'], paint: [0xb83630, 0xd4b040, 0x3050a0], wood: [0xd85048, 0xd0a070] },
  { styles: ['cabinet', 'school'], paint: [0xbab3a0, 0x9aa0a4, 0xc8c0aa], wood: [0xe0b888] },
  { styles: ['cabinet'], paint: [0x41543f, 0x5a5e5c, 0x4c4434], wood: [0xb08860] },
  { styles: ['wardrobe'], paint: [0x5a4434], wood: [0xb07850, 0xc08a60, 0x9a6a48] }
];

const box = (w, h, d, x, y, z, rx = 0) => { const g = new THREE.BoxGeometry(w, h, d); if (rx) g.rotateX(rx); g.translate(x, y, z); return g; };
// тёмная внутренность: спинка, бока, верх, низ — без передней стенки (иначе щелей не видно)
function liner(w, h, d, x, y0) {
  const p = [], mk = (pw, ph, rx, ry, px, py, pz) => { const g = new THREE.PlaneGeometry(pw, ph); if (rx) g.rotateX(rx); if (ry) g.rotateY(ry); g.translate(px, py, pz); p.push(g); };
  mk(w, h, 0, 0, x, y0 + h / 2, -d / 2);
  mk(d, h, 0, Math.PI / 2, x - w / 2, y0 + h / 2, 0); mk(d, h, 0, -Math.PI / 2, x + w / 2, y0 + h / 2, 0);
  mk(w, d, Math.PI / 2, 0, x, y0 + h, 0); mk(w, d, -Math.PI / 2, 0, x, y0, 0);
  return p;
}
function dent(g, seed, k = 0.006) {
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) if (p.getZ(i) > 0) p.setZ(i, p.getZ(i) - Math.max(0, Math.sin(p.getX(i) * 31 + seed) * Math.cos(p.getY(i) * 17 + seed * 2)) * k);
  g.computeVertexNormals(); return g;
}
function numberTex(n) {
  const c = canvas(64, 32), x = c.getContext('2d');
  x.fillStyle = '#d8d2bc'; x.fillRect(0, 0, 64, 32); x.strokeStyle = '#5a5444'; x.lineWidth = 2; x.strokeRect(1, 1, 62, 30);
  x.fillStyle = '#1b1912'; x.font = 'bold 20px monospace'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(String(n).padStart(3, '0'), 32, 17);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
// ламели в проёме [a..b] по высоте, ширина w, центр cx
function louvers(out, cx, w, a, b, step = 0.03, ang = -0.75) {
  for (let y = a + 0.012; y < b - 0.01; y += step) { const s = new THREE.BoxGeometry(w, step * 0.85, 0.004); s.rotateX(ang); s.translate(cx, y + 0.012, 0.002); out.push(s); }
}

// ---- дверцята. Петля в x=0, фасад +z. side=+1 — открывается влево (петля слева), -1 — вправо.
function schoolDoor(dw, dh, seed) {
  const th = 0.016, paint = [], inner = [], vents = [[dh - 0.4, dh - 0.11], [0.16, 0.38]], mx = 0.06;
  const bands = [[0, vents[1][0]], [vents[1][1], vents[0][0]], [vents[0][1], dh]];
  for (const [a, b] of bands) paint.push(dent(box(dw, b - a, th, dw / 2, a + (b - a) / 2, 0), seed));
  for (const [a, b] of vents) { paint.push(box(mx, b - a, th, mx / 2, (a + b) / 2, 0), box(mx, b - a, th, dw - mx / 2, (a + b) / 2, 0)); louvers(paint, dw / 2, dw - 2 * mx + 0.004, a, b); }
  const ia = vents[1][1] + 0.04, ib = vents[0][0] - 0.04;
  inner.push(box(dw - 0.04, ib - ia, 0.004, dw / 2, (ia + ib) / 2, -th / 2 - 0.004));
  return { paint, inner, th, handleY: dh * 0.52, handleX: dw - 0.045 };
}
function wardrobeDoor(dw, dh) {
  // рама + верхняя половина — жалюзи, нижняя — филёнка
  const th = 0.022, paint = [], inner = [], f = 0.07, mid = dh * 0.47;
  paint.push(box(f, dh, th, f / 2, dh / 2, 0), box(f, dh, th, dw - f / 2, dh / 2, 0));
  paint.push(box(dw - 2 * f, f, th, dw / 2, f / 2, 0), box(dw - 2 * f, f, th, dw / 2, dh - f / 2, 0), box(dw - 2 * f, f * 0.8, th, dw / 2, mid, 0));
  louvers(paint, dw / 2, dw - 2 * f + 0.004, mid + f * 0.4, dh - f, 0.034, -0.6);
  paint.push(box(dw - 2 * f - 0.02, mid - f - 0.02, th * 0.6, dw / 2, (f + mid) / 2, -0.003));
  paint.push(box(dw - 2 * f - 0.08, mid - f - 0.1, 0.012, dw / 2, (f + mid) / 2, th / 2));       // филёнка выпуклая
  return { paint, inner, th, handleY: mid + 0.08, handleX: dw - 0.05, knob: true };
}
function cabinetDoor(dw, dh, seed) {
  // гладкая створка с полем перфорации (щели-«кирпичики») вверху и ребром внизу
  const th = 0.018, paint = [], inner = [], a = dh - 0.55, b = dh - 0.12, mx = 0.07;
  paint.push(dent(box(dw, a, th, dw / 2, a / 2, 0), seed, 0.008), box(dw, dh - b, th, dw / 2, (b + dh) / 2, 0));
  paint.push(box(mx, b - a, th, mx / 2, (a + b) / 2, 0), box(mx, b - a, th, dw - mx / 2, (a + b) / 2, 0));
  const cols = 5, cw = (dw - 2 * mx) / cols;
  for (let y = a, row = 0; y < b - 0.001; y += 0.03, row++) {
    paint.push(box(dw - 2 * mx, 0.012, th, dw / 2, y + 0.006, 0)); // перемычки
    for (let c = 0; c <= cols; c++) { const x = mx + c * cw + (row % 2 ? cw / 2 : 0); if (x > mx && x < dw - mx) paint.push(box(0.012, 0.03, th, x, y + 0.015, 0)); }
  }
  paint.push(box(dw * 0.7, 0.03, 0.01, dw / 2, a * 0.35, th / 2)); // ребро
  return { paint, inner, th, handleY: dh * 0.5, handleX: dw - 0.04, bar: true };
}

export function buildLockers(root, spots, opts) {
  const { sets = {}, themeId = 0, r = Math.random } = opts;
  const TH = THEME[themeId % THEME.length];
  const matCache = new Map();
  const paintMat = (hex, wood, wear) => {
    const k = (wood ? 'w' : 'p') + hex + ':' + wear;
    if (matCache.has(k)) return matCache.get(k);
    const s = wood ? sets.wood : sets.metal;
    let m;
    if (s && s.c) {
      for (const tx of [s.c, s.n, s.r]) if (tx) tx.repeat.set(1, 1);
      m = new THREE.MeshStandardMaterial({ map: s.c, normalMap: s.n || null, roughnessMap: s.r || null, roughness: 1, metalness: wood ? 0 : 0.35, color: new THREE.Color(hex) });
      // меньше износа — текстура смешивается с ровной краской
      // износ — параметр (uniform), а не число в шейдере: одна программа на все шкафчики
      m.userData.uWear = { value: wear };
      m.onBeforeCompile = (sh) => {
        sh.uniforms.uWear = m.userData.uWear;
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uWear;')
          .replace('#include <map_fragment>', '#include <map_fragment>\n\tdiffuseColor.rgb = mix(diffuse * 0.82, diffuseColor.rgb, uWear);');
      };
      m.customProgramCacheKey = () => 'zk-lock';
    } else m = new THREE.MeshStandardMaterial({ color: hex, roughness: wood ? 0.7 : 0.55, metalness: wood ? 0 : 0.35 });
    if (!(s && s.c)) shaded(m);
    matCache.set(k, m); return m;
  };
  // материал дверцы: те же краска/дерево, но поверхности, повёрнутые внутрь шкафа, тёмные —
  // изнутри свет виден только сквозь щели (uFwd — направление «наружу» в мире)
  const doorMat = (base, fx, fz) => {
    const m = base.clone();
    const prev = base.onBeforeCompile, wearU = base.userData.uWear;
    m.onBeforeCompile = (sh, rr) => {
      if (prev) prev(sh, rr);
      if (wearU) sh.uniforms.uWear = wearU;
      sh.uniforms.uFwd = { value: new THREE.Vector3(fx, 0, fz) };
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWNd;')
        .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n\tvWNd = normalize(mat3(modelMatrix) * objectNormal);');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vWNd;\nuniform vec3 uFwd;')
        .replace('#include <map_fragment>', '#include <map_fragment>\n\tdiffuseColor.rgb *= 1.0 - 0.92 * clamp(-dot(normalize(vWNd), uFwd) * 3.0, 0.0, 1.0);');
    };
    m.customProgramCacheKey = () => (base.customProgramCacheKey ? base.customProgramCacheKey() : 'b') + '-door';
    return m;
  };
  const mDark = new THREE.MeshLambertMaterial({ color: 0x0b0a08, side: THREE.DoubleSide });
  const mSteel = shaded(new THREE.MeshStandardMaterial({ color: 0xb9b8b2, roughness: 0.35, metalness: 0.85 }));
  const mBrass = shaded(new THREE.MeshStandardMaterial({ color: 0xb08a40, roughness: 0.3, metalness: 0.8 }));
  const mBase = new THREE.MeshLambertMaterial({ color: 0x1c1b18 });
  const groups = new Map(), steel = [], brass = [], dark = [], base = [], out = [];
  const push = (m, g) => { if (!groups.has(m)) groups.set(m, []); groups.get(m).push(g); };
  let num = 100 + ((r() * 300) | 0);
  const up = new THREE.Vector3(0, 1, 0);
  for (const sp of spots) {
    const style = TH.styles[(r() * TH.styles.length) | 0], wood = style === 'wardrobe';
    const pal = wood ? TH.wood : TH.paint;
    const hex = new THREE.Color(pal[(r() * pal.length) | 0]).offsetHSL((r() - 0.5) * 0.02, (r() - 0.5) * 0.08, (r() - 0.5) * 0.06).getHex();
    const wear = wood ? 0.75 + r() * 0.25 : 0.35 + r() * 0.6; // 1 — максимум потёртостей
    const mP = paintMat(hex, wood, wear);
    const D = style === 'school' ? SCHOOL : BIG, n = style === 'school' ? sp.n : 1, total = n * D.w;
    const yaw = Math.atan2(sp.fx, sp.fz), q = new THREE.Quaternion().setFromAxisAngle(up, yaw);
    const cx = sp.x + sp.fx * D.d / 2, cz = sp.z + sp.fz * D.d / 2;
    const M4 = new THREE.Matrix4().compose(new THREE.Vector3(cx, 0, cz), q, new THREE.Vector3(1, 1, 1));
    const add = (list, g) => list.push(g.applyMatrix4(M4));
    const x0 = -total / 2, H = D.h, B = D.base;
    // корпус
    if (style === 'school') {
      for (let k = 0; k <= n; k++) push(mP, box(T, H - B, D.d, x0 + k * D.w, B + (H - B) / 2, 0).applyMatrix4(M4));
      push(mP, box(total + T, T, D.d, 0, H - T / 2, 0).applyMatrix4(M4)); push(mP, box(total + 0.03, 0.02, D.d + 0.02, 0, H + 0.01, 0.005).applyMatrix4(M4));
      push(mP, box(total + T, T, D.d, 0, B + T / 2, 0).applyMatrix4(M4));
      add(base, box(total - 0.02, B, D.d - 0.06, 0, B / 2, -0.02));
    } else if (style === 'wardrobe') {
      for (const s of [-1, 1]) push(mP, box(0.03, H - B, D.d, s * (total / 2 - 0.015), B + (H - B) / 2, 0).applyMatrix4(M4));
      push(mP, box(total, 0.03, D.d, 0, H - 0.015, 0).applyMatrix4(M4)); push(mP, box(total, 0.03, D.d, 0, B + 0.015, 0).applyMatrix4(M4));
      push(mP, box(total + 0.08, 0.05, D.d + 0.05, 0, H + 0.025, 0.012).applyMatrix4(M4)); push(mP, box(total + 0.05, 0.04, D.d + 0.03, 0, H - 0.01, 0.008).applyMatrix4(M4)); // карниз
      push(mP, box(total + 0.02, 0.05, D.d + 0.01, 0, B - 0.02, 0.003).applyMatrix4(M4));
      for (const [lx, lz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) push(mP, box(0.06, B - 0.04, 0.06, lx * (total / 2 - 0.05), (B - 0.04) / 2, lz * (D.d / 2 - 0.05)).applyMatrix4(M4)); // ножки
    } else {
      for (const s of [-1, 1]) push(mP, box(T * 1.4, H - B, D.d, s * (total / 2 - T * 0.7), B + (H - B) / 2, 0).applyMatrix4(M4));
      push(mP, box(total, T * 1.4, D.d, 0, H - T * 0.7, 0).applyMatrix4(M4)); push(mP, box(total, T * 1.4, D.d, 0, B + T * 0.7, 0).applyMatrix4(M4));
      add(base, box(total - 0.04, B, D.d - 0.06, 0, B / 2, -0.02));
      add(steel, box(0.02, 0.12, 0.02, 0, H - 0.08, D.d / 2 + 0.01)); // табличка-петля сверху
    }
    // задняя стенка + тёмная внутренность + полка
    for (let k = 0; k < n; k++) {
      const xi = x0 + k * D.w + D.w / 2, iw = D.w - T * 2;
      add(dark, box(iw, H - B, T, xi, B + (H - B) / 2, -D.d / 2 + T / 2));
      for (const g of liner(iw, H - B - T * 2, D.d - T * 2, xi, B + T)) add(dark, g);
      add(dark, box(iw, 0.012, D.d - 0.08, xi, H - 0.36, -0.03));
      if (style === 'wardrobe') add(brass, box(iw - 0.04, 0.016, 0.016, xi, H - 0.42, 0)); // штанга с плечиками
      else add(steel, box(0.12, 0.012, 0.012, xi, H - 0.5, -D.d / 2 + 0.04));
    }
    // дверцята: у school — по одной на секцию; у wardrobe и cabinet — две створки на одну секцию
    const leaves = [];
    for (let k = 0; k < n; k++) {
      const sx0 = x0 + k * D.w;
      if (style === 'school') leaves.push({ k, x: sx0 + 0.015, w: D.w - 0.03, side: 1 });
      else { const hw = (D.w - 0.03) / 2; leaves.push({ k, x: sx0 + 0.015, w: hw, side: 1 }, { k, x: sx0 + D.w - 0.015, w: hw, side: -1 }); }
    }
    const ajar = r() < 0.15 ? (r() * 0.4 + 0.15) : 0; // иногда дверца приоткрыта
    const sections = [];
    for (const lf of leaves) {
      const dh = H - B - 0.05, seed = r() * 10;
      const dg = style === 'school' ? schoolDoor(lf.w, dh, seed) : style === 'wardrobe' ? wardrobeDoor(lf.w, dh) : cabinetDoor(lf.w, dh, seed);
      const door = new THREE.Group();
      door.add(new THREE.Mesh(mergeGeometries(dg.paint), doorMat(mP, sp.fx, sp.fz)));
      if (dg.inner.length) door.add(new THREE.Mesh(mergeGeometries(dg.inner), mDark));
      const hx = dg.handleX, hm = wood ? mBrass : mSteel;
      if (dg.knob) { const kn = new THREE.Mesh(new THREE.SphereGeometry(0.02, 10, 8), hm); kn.position.set(hx, dg.handleY, 0.025); door.add(kn); }
      else if (dg.bar) door.add(new THREE.Mesh(mergeGeometries([box(0.02, 0.22, 0.02, hx, dg.handleY, 0.022), box(0.04, 0.03, 0.03, hx, dg.handleY + 0.12, 0.018)]), hm));
      else {
        door.add(new THREE.Mesh(mergeGeometries([box(0.022, 0.14, 0.022, hx, dg.handleY, 0.02), box(0.035, 0.03, 0.03, hx, dg.handleY - 0.07, 0.02)]), hm));
        const hasp = new THREE.Mesh(new THREE.TorusGeometry(0.014, 0.004, 6, 12), hm); hasp.position.set(hx, dg.handleY - 0.12, 0.03); door.add(hasp);
        if (r() < 0.85) { const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.09, 0.045), new THREE.MeshLambertMaterial({ map: numberTex(num++) })); plate.position.set(lf.w / 2, dh - 0.07, dg.th / 2 + 0.001); door.add(plate); }
      }
      for (const hy of [0.25, dh - 0.25]) { const hinge = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.07, 8), mSteel); hinge.position.set(-0.002, hy, 0.004); door.add(hinge); }
      if (lf.side < 0) door.scale.x = -1; // зеркальная створка, петля справа
      const pivot = new THREE.Group(); pivot.position.set(lf.x, B + 0.025, D.d / 2 + dg.th / 2); pivot.add(door);
      pivot.userData.side = lf.side;
      const holder = new THREE.Group(); holder.position.set(cx, 0, cz); holder.quaternion.copy(q); holder.add(pivot); root.add(holder);
      (sections[lf.k] = sections[lf.k] || []).push(pivot);
    }
    const sx = Math.cos(yaw), sz = -Math.sin(yaw);
    sections.forEach((doors, k) => {
      const cxl = x0 + k * D.w + D.w / 2;
      const lk = { tx: sp.tx, ty: sp.ty, x: cx + sx * cxl, z: cz + sz * cxl, fx: sp.fx, fz: sp.fz, doors, open: 0, want: 0, rest: 0, style };
      if (ajar && k === 0) { lk.rest = ajar; lk.open = lk.want = ajar; setDoors(lk); }
      out.push(lk);
    });
  }
  for (const [m, list] of groups) root.add(new THREE.Mesh(mergeGeometries(list), m));
  for (const [list, m] of [[steel, mSteel], [brass, mBrass], [dark, mDark], [base, mBase]]) if (list.length) root.add(new THREE.Mesh(mergeGeometries(list), m));
  return out;
}

function setDoors(lk) {
  const e = lk.open * lk.open * (3 - 2 * lk.open);
  for (const d of lk.doors) d.rotation.y = -e * 1.7 * d.userData.side;
}
// анимация дверцят: want 0..1 (1 — открыта), плавно; rest — «приоткрыта» по умолчанию
export function updateLockers(list, dt) {
  for (const lk of list) {
    if (Math.abs(lk.want - lk.open) < 0.001) continue;
    lk.open += Math.sign(lk.want - lk.open) * Math.min(Math.abs(lk.want - lk.open), dt * 4.5);
    setDoors(lk);
  }
}
export const LOCKER_W = SCHOOL.w, LOCKER_DEP = BIG.d, LOCKER_BIG_W = BIG.w;
