import * as THREE from 'three';
import { clamp } from '../core/util.js';

// Все текстуры рисуются кодом: шум + рисование на canvas.

function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

// Бесшовный фрактальный шум (value noise) по горизонтали и вертикали.
function fbm(w, h, r, octs) {
  const out = new Float32Array(w * h);
  let tot = 0;
  for (const [c, amp] of octs) {
    tot += amp;
    const cx = c, cy = Math.max(1, Math.round(c * h / w));
    const L = new Float32Array(cx * cy);
    for (let i = 0; i < L.length; i++) L[i] = r();
    const kx = cx / w, ky = cy / h;
    for (let y = 0; y < h; y++) {
      const gy = y * ky, y0 = gy | 0, fy = gy - y0, sy = fy * fy * (3 - 2 * fy);
      const r0 = (y0 % cy) * cx, r1 = ((y0 + 1) % cy) * cx, o = y * w;
      for (let x = 0; x < w; x++) {
        const gx = x * kx, x0 = gx | 0, fx = gx - x0, sx = fx * fx * (3 - 2 * fx);
        const c0 = x0 % cx, c1 = (x0 + 1) % cx;
        const a = L[r0 + c0] + (L[r0 + c1] - L[r0 + c0]) * sx;
        const b = L[r1 + c0] + (L[r1 + c1] - L[r1 + c0]) * sx;
        out[o + x] += (a + (b - a) * sy) * amp;
      }
    }
  }
  for (let i = 0; i < out.length; i++) out[i] /= tot;
  return out;
}

const PX = [0, 0, 0, 255];
function paint(w, h, fn) {
  const c = canvas(w, h), ctx = c.getContext('2d'), id = ctx.createImageData(w, h), d = id.data;
  let i = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++, i++) {
    PX[3] = 255; fn(x, y, i, PX);
    const j = i * 4; d[j] = PX[0]; d[j + 1] = PX[1]; d[j + 2] = PX[2]; d[j + 3] = PX[3];
  }
  ctx.putImageData(id, 0, 0);
  return c;
}

function toTex(c, o = {}) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = o.repeat === false ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
  t.wrapT = (o.repeat === false || o.clampT) ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
  t.anisotropy = o.aniso || 4;
  return t;
}

function heartPath(x, cx, cy, s) {
  x.beginPath();
  x.moveTo(cx, cy + s * 0.9);
  x.bezierCurveTo(cx - s * 1.25, cy + s * 0.05, cx - s * 0.95, cy - s * 0.95, cx, cy - s * 0.38);
  x.bezierCurveTo(cx + s * 0.95, cy - s * 0.95, cx + s * 1.25, cy + s * 0.05, cx, cy + s * 0.9);
  x.closePath();
}

// Масштаб текстур: 1 = 512 px на клетку 2 м, 2 = 1024 px (чётче). Узоры задаются в «512-пространстве».
let K = 2;
function setTexScale(k) { K = k; }
function texScale() { return K; }

// ---------- стены ----------
function wallCanvas(th, r) {
  if (th.wall === 'smiles') return smilesWallCanvas(th, r);
  if (th.wall === 'circus') return circusWallCanvas(th, r);
  const W = 512 * K, H = 640 * K, [R, G, B] = th.wallCol, style = th.wall, gr = th.grime ?? 1;
  const paper = style === 'wallpaper' || style === 'damp' || style === 'dark';
  const n = fbm(W, H, r, [[4, 0.4], [16, 0.25], [64, 0.2], [256, 0.1], [512, 0.05]]);
  const st = fbm(W, H, r, [[3, 0.55], [8, 0.45]]);
  const n2 = (style === 'damp' || style === 'dark') ? fbm(W, H, r, [[6, 0.5], [24, 0.5]]) : null;
  const c = paint(W, H, (x, y, i, p) => {
    const X = x / K, Y = y / K, yb = y / H;
    let f;
    if (style === 'concrete') {
      f = 0.84 + (n[i] - 0.5) * 0.7 + (r() - 0.5) * 0.05;
      if ((Y % 160) < 2) f *= 0.78;
      const hx = (X % 128) - 64, hy = (Y % 160) - 80;
      if (hx * hx + hy * hy < 30) f *= 0.35;
    } else if (style === 'office') {
      f = 0.97 + (n[i] - 0.5) * 0.14 + (r() - 0.5) * 0.03;
    } else if (style === 'tiles') {
      const lx = X % 64, ly = Y % 64, tid = (((X / 64) | 0) * 7 + ((Y / 64) | 0) * 13) % 5;
      f = 0.95 + tid * 0.012 + (n[i] - 0.5) * 0.08;
      if (lx < 2.5 || ly < 2.5) f *= 0.78; else if (lx < 4 || ly < 4) f *= 1.03;
    } else {
      // обои: полосы шириной 64 (в 512-пространстве), бумага с волокном
      f = 0.94 + (n[i] - 0.5) * 0.32 * gr + (r() - 0.5) * 0.04;
      const sx = X % 64;
      if (sx < 1.5) f *= 0.86; else if (sx < 3) f *= 1.05; else if (sx >= 31 && sx < 33) f *= 0.96;
    }
    let a = R * f, b = G * f, cc = B * f;
    const thr = style === 'dark' ? 0.45 : (style === 'office' || style === 'tiles') ? 0.72 : 0.56;
    const s_ = clamp((st[i] - thr + Math.max(0, yb - 0.6) * 0.45 + Math.max(0, 0.12 - yb) * 0.6) * 3.2, 0, 1);
    if (s_ > 0) { const k = s_ * (style === 'office' ? 0.18 : 0.38) * gr; a = a * (1 - k) + 95 * k; b = b * (1 - k) + 72 * k; cc = cc * (1 - k) + 34 * k; }
    if (n2) {
      const m = clamp((n2[i] - 0.6) * 3.5, 0, 1);
      if (style === 'damp') { const k = m * (0.25 + 0.55 * yb); a *= 1 - k * 0.5; b *= 1 - k * 0.32; cc *= 1 - k * 0.48; }
      else if (m > 0.5) { const pl = 0.72 + (n[i] - 0.5) * 0.3; a = 150 * pl; b = 146 * pl; cc = 136 * pl; }
      else if (m > 0.35) { a *= 0.6; b *= 0.6; cc *= 0.6; }
    }
    const dirt = clamp((yb - 0.8) * 3, 0, 1) * 0.25;
    a *= 1 - dirt; b *= 1 - dirt; cc *= 1 - dirt;
    if (style !== 'concrete' && style !== 'tiles' && yb > 0.945) {
      if (style === 'office') { const w = 0.9 + (n[i] - 0.5) * 0.15; a = 78 * w; b = 80 * w; cc = 84 * w; }
      else { const w = 0.72 + (n[i] - 0.5) * 0.5 + (r() - 0.5) * 0.06; a = 86 * w; b = 64 * w; cc = 40 * w; }
      if (yb < 0.951) { a *= 1.45; b *= 1.45; cc *= 1.45; }
    }
    p[0] = a; p[1] = b; p[2] = cc;
  });
  const x = c.getContext('2d');
  x.setTransform(K, 0, 0, K, 0, 0);
  if (paper) {
    // узор как на старых обоях: колонки «ёлочек» в светлых полосах
    x.lineCap = 'round'; x.lineJoin = 'round';
    const ink = style === 'dark' ? 'rgba(60,30,10,0.32)' : style === 'damp' ? 'rgba(70,90,70,0.3)' : 'rgba(150,170,178,0.6)';
    x.strokeStyle = ink; x.lineWidth = 2.2;
    for (let col = 0; col < 8; col++) {
      const cx = col * 64 + 17;
      for (let row = 0; row * 22 < 640 * 0.935; row++) {
        const cy = row * 22 + 12;
        x.beginPath(); x.moveTo(cx - 7, cy + 5); x.lineTo(cx, cy - 3); x.lineTo(cx + 7, cy + 5); x.stroke();
      }
      x.strokeStyle = style === 'wallpaper' ? 'rgba(255,255,235,0.35)' : 'rgba(255,255,255,0.12)'; x.lineWidth = 1.2;
      x.beginPath(); x.moveTo(cx + 15, 0); x.lineTo(cx + 15, 640 * 0.94); x.stroke();
      x.strokeStyle = ink; x.lineWidth = 2.2;
    }
  }
  if (style === 'concrete' || style === 'damp') {
    for (let k = 0; k < 26; k++) {
      const px = 8 + r() * 496, y0 = r() * 256, len = 640 * (0.2 + r() * 0.5), w = 2 + r() * 5;
      const g = x.createLinearGradient(0, y0, 0, y0 + len);
      g.addColorStop(0, 'rgba(30,26,14,0.3)'); g.addColorStop(1, 'rgba(30,26,14,0)');
      x.fillStyle = g; x.fillRect(px, y0, w, len);
    }
  }
  if (style === 'office') {
    x.globalAlpha = 0.12; x.fillStyle = '#222';
    for (let k = 0; k < 10; k++) { x.beginPath(); x.ellipse(20 + r() * 472, 640 * (0.82 + r() * 0.1), 6 + r() * 20, 1 + r() * 2.5, 0, 0, 7); x.fill(); }
  }
  x.globalAlpha = 1; x.setTransform(1, 0, 0, 1, 0, 0);
  return c;
}

// ---------- пол ----------
function floorCanvas(th, r) {
  if (th.floor === 'playmat') return playmatCanvas(r);
  if (th.floor === 'checker') return checkerCanvas(r);
  const W = 512 * K, [R, G, B] = th.floorCol, st = th.floor, wet = st === 'wetcarpet', gr = th.grime ?? 1;
  const n = fbm(W, W, r, [[4, 0.3], [16, 0.2], [64, 0.2], [256, 0.15], [512, 0.15]]);
  const dm = fbm(W, W, r, [[3, 0.6], [6, 0.4]]);
  const carpet = !(st === 'office' || st === 'concrete' || st === 'parking' || st === 'pooltiles' || st === 'poolbottom');
  const c = paint(W, W, (x, y, i, p) => {
    const X = x / K, Y = y / K;
    let f;
    if (st === 'office') {
      const tx = (X / 256) | 0, ty = (Y / 256) | 0, lx = X % 256, ly = Y % 256;
      f = 0.9 + (n[i] - 0.5) * 0.3 + (((tx + ty) & 1) ? 0.05 * Math.sin(X * 1.7) : 0.05 * Math.sin(Y * 1.7)) + (r() - 0.5) * 0.12;
      if (lx < 2 || ly < 2) f *= 0.7;
    } else if (st === 'concrete' || st === 'parking') {
      f = 0.86 + (n[i] - 0.5) * 0.65 + (r() - 0.5) * 0.07;
    } else if (st === 'pooltiles' || st === 'poolbottom') {
      const lx = X % 64, ly = Y % 64;
      f = 0.95 + (n[i] - 0.5) * 0.1 + ((((X / 64) | 0) + ((Y / 64) | 0)) % 3) * 0.015;
      if (lx < 2.5 || ly < 2.5) f *= 0.8;
    } else {
      // ковролин: петли ворса + пятна
      const loop = ((x + (y & 1)) & 1) ? 1.04 : 0.96;
      f = (0.86 + (n[i] - 0.5) * 0.5 * gr + (r() - 0.5) * 0.3) * loop;
    }
    let a = R * f, b = G * f, cc = B * f;
    const d = clamp((dm[i] - (wet ? 0.47 : 0.6)) * 5, 0, 1);
    if (d > 0) { const k = d * (wet ? 0.5 : (st === 'pooltiles' ? 0.1 : 0.3 * gr)); a *= 1 - k; b *= 1 - k * 0.85; cc *= 1 - k * 0.9; }
    if (carpet && r() < 0.012) { a *= 0.7; b *= 0.7; cc *= 0.7; }
    p[0] = a; p[1] = b; p[2] = cc;
  });
  const x = c.getContext('2d'); x.setTransform(K, 0, 0, K, 0, 0);
  if (st === 'parking') {
    x.fillStyle = 'rgba(230,226,210,0.85)'; x.fillRect(0, 0, 12, 512);
    x.fillStyle = 'rgba(20,20,20,0.35)';
    for (let k = 0; k < 4; k++) { x.beginPath(); x.ellipse(80 + r() * 350, 80 + r() * 350, 20 + r() * 50, 10 + r() * 30, r() * 3, 0, 7); x.fill(); }
  }
  if (st === 'concrete') {
    x.strokeStyle = 'rgba(18,18,16,0.55)';
    for (let k = 0; k < 7; k++) {
      let px = r() * 512, py = r() * 512, ang = r() * 6.28;
      x.lineWidth = 0.8 + r() * 1.4; x.beginPath(); x.moveTo(px, py);
      for (let s_ = 0; s_ < 26; s_++) { ang += (r() - 0.5) * 0.9; px += Math.cos(ang) * 9; py += Math.sin(ang) * 9; x.lineTo(px, py); }
      x.stroke();
    }
  }
  x.setTransform(1, 0, 0, 1, 0, 0);
  return c;
}

// ---------- потолок ----------
function ceilCanvas(th, r) {
  const W = 256 * K, [R, G, B] = th.ceilCol;
  const n = fbm(W, W, r, [[4, 0.5], [32, 0.3], [128, 0.2]]);
  if (th.ceil === 'concrete') {
    return paint(W, W, (x, y, i, p) => { const f = 0.8 + (n[i] - 0.5) * 0.6 + (r() - 0.5) * 0.08; p[0] = R * f; p[1] = G * f; p[2] = B * f; });
  }
  const T = W / 3, st = fbm(W, W, r, [[3, 1]]), gr = th.grime ?? 1;
  return paint(W, W, (x, y, i, p) => {
    let f = 0.93 + (n[i] - 0.5) * 0.14;
    if (r() < 0.06) f *= 0.72;            // поры потолочной плитки
    const lx = x % T, ly = y % T, e = 1.6 * K;
    if (lx < e || ly < e) f *= 0.55; else if (lx < e * 2 || ly < e * 2) f *= 1.06;
    let a = R * f, b = G * f, cc = B * f;
    const s_ = st[i];
    if (gr > 0.5) { if (s_ > 0.7 && s_ < 0.73) { a *= 0.8; b *= 0.72; cc *= 0.55; } else if (s_ >= 0.73) { a *= 0.97; b *= 0.93; cc *= 0.8; } }
    p[0] = a; p[1] = b; p[2] = cc;
  });
}
function lampCanvas() {
  const c = canvas(256, 256), x = c.getContext('2d');
  x.fillStyle = '#8a877c'; x.fillRect(0, 0, 256, 256);
  x.fillStyle = '#fffaf0'; x.fillRect(10, 10, 236, 236);
  x.strokeStyle = 'rgba(190,180,160,0.45)'; x.lineWidth = 1;
  for (let i = 10; i <= 246; i += 8) { x.beginPath(); x.moveTo(i, 10); x.lineTo(i, 246); x.stroke(); x.beginPath(); x.moveTo(10, i); x.lineTo(246, i); x.stroke(); }
  return c;
}

// ---------- дверь и табличка ----------
function doorCanvas(th, r) {
  const W = 512, H = 640, c = wallCanvas(th, r), x = c.getContext('2d');
  x.setTransform(K, 0, 0, K, 0, 0);
  const dw = W * 0.46, dx = (W - dw) / 2, dh = H * 0.78, dy = H - dh;
  x.fillStyle = '#26251f'; x.fillRect(dx - 14, dy - 14, dw + 28, dh + 14);
  const g = x.createLinearGradient(dx, 0, dx + dw, 0);
  g.addColorStop(0, '#4b584e'); g.addColorStop(0.5, '#5c6a5f'); g.addColorStop(1, '#455148');
  x.fillStyle = g; x.fillRect(dx, dy, dw, dh);
  for (let k = 0; k < 1600; k++) { x.fillStyle = `rgba(20,20,10,${(r() * 0.16).toFixed(3)})`; x.fillRect(dx + r() * dw, dy + r() * dh, 1 + r() * 3, 1 + r() * 3); }
  x.strokeStyle = 'rgba(0,0,0,0.35)'; x.lineWidth = 3;
  x.strokeRect(dx + 20, dy + 24, dw - 40, dh * 0.36);
  x.strokeRect(dx + 20, dy + dh * 0.5, dw - 40, dh * 0.44);
  x.fillStyle = '#a3a8a2'; x.fillRect(dx + 16, dy + dh * 0.45, dw - 32, 12);
  x.fillStyle = '#6b706b'; x.fillRect(dx + 16, dy + dh * 0.45 + 10, dw - 32, 4);
  x.fillStyle = 'rgba(170,175,170,0.45)'; x.fillRect(dx + 6, dy + dh - 46, dw - 12, 40);
  x.fillStyle = '#2f302b'; for (const hy of [0.12, 0.5, 0.86]) x.fillRect(dx - 4, dy + dh * hy, 8, 26);
  x.setTransform(1, 0, 0, 1, 0, 0);
  return c;
}

function signCanvas() {
  const c = canvas(256, 80), x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 0, 80); g.addColorStop(0, '#16b052'); g.addColorStop(1, '#0a7535');
  x.fillStyle = g; x.fillRect(0, 0, 256, 80);
  x.strokeStyle = '#e9fff0'; x.lineWidth = 4; x.strokeRect(5, 5, 246, 70);
  x.fillStyle = '#f4fff6'; x.strokeStyle = '#f4fff6'; x.lineCap = 'round';
  x.beginPath(); x.arc(42, 21, 7, 0, 7); x.fill();
  x.lineWidth = 6; x.beginPath();
  x.moveTo(39, 30); x.lineTo(34, 47); x.lineTo(24, 62);
  x.moveTo(34, 47); x.lineTo(46, 57); x.lineTo(48, 67);
  x.moveTo(38, 33); x.lineTo(27, 41); x.moveTo(38, 33); x.lineTo(50, 39);
  x.stroke();
  x.font = '600 34px "IBM Plex Mono", monospace'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText('ВЫХОД', 152, 42);
  return c;
}

// ---------- тайная комната ----------
function heartDecalCanvas() {
  const c = canvas(128, 128), x = c.getContext('2d');
  x.lineJoin = 'round'; x.lineCap = 'round';
  heartPath(x, 64, 62, 40); x.fillStyle = 'rgba(176,18,36,0.22)'; x.fill();
  x.strokeStyle = '#a3121f'; x.lineWidth = 7; heartPath(x, 64, 62, 40); x.stroke();
  x.lineWidth = 3; x.strokeStyle = 'rgba(163,18,31,0.6)'; heartPath(x, 66, 64, 38); x.stroke();
  return c;
}

function roomWallCanvas(r) {
  const W = 512, H = 640, n = fbm(W, H, r, [[8, 0.5], [64, 0.5]]);
  const c = paint(W, H, (x, y, i, p) => {
    const yb = y / H, f = 0.95 + (n[i] - 0.5) * 0.12;
    if (yb > 0.945) { p[0] = 246; p[1] = 238; p[2] = 232; return; }
    p[0] = 242 * f; p[1] = 212 * f; p[2] = 214 * f;
  });
  const x = c.getContext('2d'); x.fillStyle = 'rgba(214,110,140,0.55)';
  for (let row = 0; row * 48 < H * 0.92; row++) for (let col = 0; col < 10; col++) {
    heartPath(x, col * 51.2 + (row & 1 ? 25.6 : 0) + 12, row * 48 + 24, 7); x.fill();
  }
  return c;
}

function roomFloorCanvas(r) {
  const W = 256, n = fbm(W, W, r, [[8, 0.4], [64, 0.3], [256, 0.3]]);
  return paint(W, W, (x, y, i, p) => { const f = 0.86 + (n[i] - 0.5) * 0.4 + (r() - 0.5) * 0.18; p[0] = 196 * f; p[1] = 118 * f; p[2] = 138 * f; });
}

function heartTextCanvas() {
  const c = canvas(512, 256), x = c.getContext('2d');
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.font = '700 172px Caveat, "Segoe Print", cursive';
  x.shadowColor = 'rgba(255,80,130,0.95)'; x.shadowBlur = 28; x.fillStyle = '#fff4f8';
  x.fillText('Уля', 256, 136);
  x.shadowBlur = 0; x.fillText('Уля', 256, 136);
  return c;
}

// ---------- предметы ----------
function paperCanvas(r) {
  const W = 256, H = 340, n = fbm(W, H, r, [[4, 0.5], [32, 0.5]]);
  const c = paint(W, H, (x, y, i, p) => { const f = 0.92 + (n[i] - 0.5) * 0.18; p[0] = 234 * f; p[1] = 224 * f; p[2] = 198 * f; });
  const x = c.getContext('2d');
  x.strokeStyle = 'rgba(70,90,150,0.3)'; x.lineWidth = 1;
  for (let y = 40; y < H - 14; y += 18) { x.beginPath(); x.moveTo(12, y); x.lineTo(W - 12, y); x.stroke(); }
  x.strokeStyle = 'rgba(30,26,40,0.75)'; x.lineWidth = 1.6;
  for (let y = 36; y < H - 30; y += 18) {
    let px = 18 + r() * 10; const end = W - 20 - r() * 60;
    x.beginPath(); x.moveTo(px, y);
    while (px < end) { px += 3 + r() * 4; x.lineTo(px, y - 2 - r() * 6); px += 2 + r() * 3; x.lineTo(px, y); if (r() < 0.12) { px += 8; x.moveTo(px, y); } }
    x.stroke();
  }
  x.strokeStyle = 'rgba(120,80,30,0.25)'; x.lineWidth = 6; x.beginPath(); x.arc(W * 0.75, H * 0.78, 34, 0.3, 5.6); x.stroke();
  return c;
}

function keycardCanvas() {
  const c = canvas(256, 160), x = c.getContext('2d');
  x.fillStyle = '#eef0f2'; x.fillRect(0, 0, 256, 160);
  x.fillStyle = '#e8590c'; x.fillRect(0, 0, 256, 34);
  x.fillStyle = '#fff'; x.font = '600 20px "IBM Plex Mono", monospace'; x.textBaseline = 'middle'; x.fillText('ДОСТУП', 14, 18);
  x.fillStyle = '#c9a227'; x.fillRect(18, 56, 46, 36); x.strokeStyle = '#8a6d12'; x.lineWidth = 2; x.strokeRect(18, 56, 46, 36);
  x.beginPath(); x.moveTo(18, 74); x.lineTo(64, 74); x.moveTo(41, 56); x.lineTo(41, 92); x.stroke();
  x.fillStyle = '#333'; x.font = '600 15px "IBM Plex Mono", monospace'; x.fillText('ЗОНА: ВЫХОД', 82, 66); x.fillText('№ 0451', 82, 88);
  for (let i = 0; i < 40; i++) { x.fillStyle = i % 3 ? '#222' : '#eef0f2'; x.fillRect(18 + i * 5.5, 116, (i * 7) % 3 + 1.5, 28); }
  return c;
}

function glowCanvas() {
  const c = canvas(128, 128), x = c.getContext('2d');
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.25, 'rgba(255,255,255,0.5)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  return c;
}

function screenCanvas() {
  const c = canvas(256, 160), x = c.getContext('2d');
  x.fillStyle = '#071226'; x.fillRect(0, 0, 256, 160);
  x.fillStyle = '#7fd0ff'; x.font = '600 17px "IBM Plex Mono", monospace'; x.textAlign = 'center';
  x.fillText('ВЫ ОСТАЁТЕСЬ', 128, 70); x.fillText('НА СВЯЗИ', 128, 94);
  x.fillStyle = 'rgba(255,255,255,0.05)'; for (let y = 0; y < 160; y += 3) x.fillRect(0, y, 256, 1);
  return c;
}

// ---------- новые уровни ----------
function poolBottomCanvas(r) {
  const W = 256, n = fbm(W, W, r, [[4, 0.5], [32, 0.5]]);
  return paint(W, W, (x, y, i, p) => {
    const lx = x & 31, ly = y & 31; let f = 0.92 + (n[i] - 0.5) * 0.14;
    if (lx < 2 || ly < 2) f *= 0.8;
    p[0] = 120 * f; p[1] = 196 * f; p[2] = 214 * f;
  });
}
function waveNormalCanvas(r) {
  const W = 256, h = fbm(W, W, r, [[4, 0.5], [8, 0.3], [16, 0.2]]);
  return paint(W, W, (x, y, i, p) => {
    const hx = h[y * W + ((x + 1) % W)] - h[y * W + ((x + W - 1) % W)];
    const hy = h[((y + 1) % W) * W + x] - h[((y + W - 1) % W) * W + x];
    p[0] = 128 - hx * 1400; p[1] = 128 - hy * 1400; p[2] = 255;
  });
}
function pillarCanvas(r) {
  const W = 128, H = 512, n = fbm(W, H, r, [[4, 0.5], [32, 0.5]]);
  return paint(W, H, (x, y, i, p) => {
    const yb = y / H; let f = 0.82 + (n[i] - 0.5) * 0.5;
    if (yb > 0.72) { const s = ((x + y) >> 4) & 1; if (s) { p[0] = 214 * f; p[1] = 170 * f; p[2] = 30 * f; } else { p[0] = 30 * f; p[1] = 30 * f; p[2] = 28 * f; } return; }
    p[0] = 140 * f; p[1] = 140 * f; p[2] = 136 * f;
  });
}
function lockerCanvas(r) {
  const c = canvas(128, 256), x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 128, 0); g.addColorStop(0, '#4f5d55'); g.addColorStop(0.5, '#5f6e65'); g.addColorStop(1, '#4a564f');
  x.fillStyle = g; x.fillRect(0, 0, 128, 256);
  x.strokeStyle = 'rgba(0,0,0,0.45)'; x.lineWidth = 3; x.strokeRect(6, 6, 116, 244);
  x.fillStyle = '#11140f';
  for (let k = 0; k < 6; k++) { x.fillRect(30, 24 + k * 9, 68, 4); x.fillRect(30, 196 + k * 8, 68, 3); }
  x.fillStyle = '#b9bdb6'; x.fillRect(98, 116, 8, 26);
  for (let k = 0; k < 500; k++) { x.fillStyle = `rgba(30,20,10,${(r() * 0.2).toFixed(3)})`; x.fillRect(r() * 128, r() * 256, 1 + r() * 3, 1 + r() * 4); }
  return c;
}
function boxCanvas(r) {
  const c = canvas(256, 256), x = c.getContext('2d');
  x.fillStyle = '#a77c4a'; x.fillRect(0, 0, 256, 256);
  for (let k = 0; k < 2500; k++) { x.fillStyle = `rgba(${r() < 0.5 ? '70,45,20' : '200,160,110'},${(r() * 0.12).toFixed(3)})`; x.fillRect(r() * 256, r() * 256, 2, 2); }
  x.fillStyle = 'rgba(214,190,140,0.75)'; x.fillRect(110, 0, 36, 256);
  x.fillStyle = 'rgba(40,30,20,0.75)'; x.font = '600 22px "IBM Plex Mono", monospace'; x.fillText('ХРУПКОЕ', 18, 60); x.fillText('↑ ↑', 180, 220);
  x.strokeStyle = 'rgba(60,40,20,0.5)'; x.lineWidth = 3; x.strokeRect(2, 2, 252, 252);
  return c;
}

// ---------- Улыбки ----------
const SMILE_COLS = ['#ffd23a', '#ff8fb1', '#7cc6ff', '#9be27a', '#ffb35c', '#c9a0ff'];
function crayonSmile(x, cx, cy, rad, col, r, creepy = false) {
  x.save(); x.lineWidth = Math.max(2, rad * 0.09); x.lineCap = 'round'; x.lineJoin = 'round';
  x.beginPath();
  for (let a = 0; a <= Math.PI * 2 + 0.01; a += 0.25) { const rr = rad * (1 + (r() - 0.5) * 0.07); x.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); }
  x.closePath(); x.fillStyle = col; x.globalAlpha = 0.88; x.fill(); x.globalAlpha = 1; x.strokeStyle = '#2a2010'; x.stroke();
  x.fillStyle = '#1d160a'; x.strokeStyle = '#1d160a';
  if (creepy) {
    for (const s of [-1, 1]) { const ex = cx + s * rad * 0.33, ey = cy - rad * 0.2; x.beginPath(); for (let k = 0; k < 7; k++) { x.lineTo(ex + (r() - 0.5) * rad * 0.3, ey + (r() - 0.5) * rad * 0.3); } x.stroke(); }
    x.beginPath(); x.arc(cx, cy - rad * 0.05, rad * 0.62, 0.05 * Math.PI, 0.95 * Math.PI); x.stroke();
    x.lineWidth = Math.max(1, rad * 0.04);
    for (let k = -4; k <= 4; k++) { const a = Math.PI / 2 + k * 0.17; x.beginPath(); x.moveTo(cx + Math.cos(a) * rad * 0.48, cy - rad * 0.05 + Math.sin(a) * rad * 0.48); x.lineTo(cx + Math.cos(a) * rad * 0.62, cy - rad * 0.05 + Math.sin(a) * rad * 0.62); x.stroke(); }
  } else {
    for (const s of [-1, 1]) { x.beginPath(); x.ellipse(cx + s * rad * 0.32, cy - rad * 0.22, rad * 0.09, rad * 0.16, 0, 0, 7); x.fill(); }
    x.beginPath(); x.arc(cx, cy + rad * 0.02, rad * 0.55, 0.16 * Math.PI, 0.84 * Math.PI); x.stroke();
  }
  x.restore();
}
function star(x, cx, cy, R, rr = 0.45) {
  x.beginPath();
  for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + k * Math.PI / 5, q = k % 2 ? R * rr : R; x.lineTo(cx + Math.cos(a) * q, cy + Math.sin(a) * q); }
  x.closePath();
}
function smilesWallCanvas(th, r) {
  const W = 512 * K, H = 640 * K, [R, G, B] = th.wallCol, n = fbm(W, H, r, [[4, 0.5], [32, 0.3], [128, 0.2]]);
  const c = paint(W, H, (x, y, i, p) => {
    const yb = y / H, f = 0.93 + (n[i] - 0.5) * 0.18 - Math.max(0, yb - 0.8) * 0.3 + (r() - 0.5) * 0.04;
    if (yb > 0.945) { p[0] = 236; p[1] = 236; p[2] = 230; if (yb < 0.952) { p[0] = p[1] = p[2] = 255; } return; }
    p[0] = R * f; p[1] = G * f; p[2] = B * f;
  });
  const x = c.getContext('2d'); x.setTransform(K, 0, 0, K, 0, 0);
  const placed = [];
  { const W = 512, H = 640;
  for (let k = 0; k < 60 && placed.length < 13; k++) {
    const rad = 16 + r() * 34, cx = rad + 6 + r() * (W - 2 * rad - 12), cy = H * 0.08 + rad + r() * (H * 0.78 - 2 * rad);
    if (placed.some(([px, py, pr]) => Math.hypot(px - cx, py - cy) < pr + rad + 6)) continue;
    placed.push([cx, cy, rad]);
    crayonSmile(x, cx, cy, rad, SMILE_COLS[(r() * SMILE_COLS.length) | 0], r, r() < 0.14);
  }
  x.lineCap = 'round';
  for (let k = 0; k < 7; k++) {
    const cx = 20 + r() * (W - 40), cy = H * 0.1 + r() * H * 0.75, s = 6 + r() * 8;
    x.globalAlpha = 0.8;
    if (r() < 0.5) { heartPath(x, cx, cy, s); x.fillStyle = '#ff5c86'; x.fill(); } else { star(x, cx, cy, s); x.fillStyle = '#5aa8ff'; x.fill(); }
  }
  x.globalAlpha = 0.35; x.strokeStyle = '#6a4f2a'; x.lineWidth = 2;
  for (let k = 0; k < 5; k++) { let px = 20 + r() * (W - 40), py = H * 0.75 + r() * H * 0.15; x.beginPath(); x.moveTo(px, py); for (let s = 0; s < 14; s++) { px += (r() - 0.5) * 24; py += (r() - 0.5) * 10; x.lineTo(clamp(px, 4, W - 4), py); } x.stroke(); }
  }
  x.globalAlpha = 1; x.setTransform(1, 0, 0, 1, 0, 0);
  return c;
}
function playmatCanvas(r) {
  const W = 512 * K, n = fbm(W, W, r, [[8, 0.5], [128, 0.5]]);
  const COLS = [[232, 72, 63], [61, 127, 224], [63, 191, 98], [242, 194, 48]];
  const c = paint(W, W, (x, y, i, p) => {
    const X = x / K, Y = y / K, mx = (X / 256) | 0, my = (Y / 256) | 0, lx = X % 256, ly = Y % 256;
    const col = COLS[(mx * 3 + my * 2 + ((mx + my) & 1)) % 4], f = 0.9 + (n[i] - 0.5) * 0.14 + (r() - 0.5) * 0.06;
    let e = 1; if (lx < 3 || ly < 3) e = 0.72;
    const tooth = (lx < 14 && (((ly / 32) | 0) & 1)) || (ly < 14 && (((lx / 32) | 0) & 1)); if (tooth && (lx < 3 || ly < 3 || lx < 14 || ly < 14)) e *= 0.96;
    p[0] = col[0] * f * e; p[1] = col[1] * f * e; p[2] = col[2] * f * e;
  });
  return c;
}
function padCanvas(r) {
  const W = 256, n = fbm(W, W, r, [[8, 0.6], [64, 0.4]]);
  return paint(W, W, (x, y, i, p) => { const ly = y & 63, f = 0.88 + (n[i] - 0.5) * 0.15 - (ly < 3 ? 0.25 : 0); p[0] = 60 * f; p[1] = 110 * f; p[2] = 200 * f; });
}
function posterCanvas(kind, r) {
  const c = canvas(256, 340), x = c.getContext('2d');
  const bg = ['#fff3c4', '#ffe0ec', '#dff1ff', '#e9ffe0'][kind % 4];
  x.fillStyle = bg; x.fillRect(0, 0, 256, 340);
  x.strokeStyle = '#2a2010'; x.lineWidth = 6; x.strokeRect(8, 8, 240, 324);
  crayonSmile(x, 128, 140, 78, SMILE_COLS[kind % SMILE_COLS.length], r, kind === 3);
  x.fillStyle = '#2a2010'; x.textAlign = 'center'; x.font = '700 30px "Rubik Mono One", "Arial Black", sans-serif';
  const T = [['УЛЫБАЙСЯ!', ''], ['ТЫ ДОМА', ':)'], ['ВСЁ', 'ХОРОШО'], ['НЕ ПЕРЕСТАВАЙ', 'УЛЫБАТЬСЯ']][kind % 4];
  x.font = (T[0].length > 10 ? '700 20px' : '700 30px') + ' "Rubik Mono One", "Arial Black", sans-serif';
  x.fillText(T[0], 128, 262); x.fillText(T[1], 128, 300);
  for (let k = 0; k < 300; k++) { x.fillStyle = `rgba(80,60,30,${(r() * 0.08).toFixed(3)})`; x.fillRect(r() * 256, r() * 340, 2, 2); }
  return c;
}
function neonSmileCanvas() {
  const c = canvas(256, 256), x = c.getContext('2d');
  x.fillStyle = '#0d0b10'; x.fillRect(0, 0, 256, 256);
  x.strokeStyle = '#fff2a0'; x.lineWidth = 9; x.lineCap = 'round'; x.shadowColor = '#ffd23a'; x.shadowBlur = 18;
  for (let k = 0; k < 2; k++) {
    x.beginPath(); x.arc(128, 128, 92, 0, 7); x.stroke();
    x.beginPath(); x.moveTo(94, 92); x.lineTo(94, 118); x.moveTo(162, 92); x.lineTo(162, 118); x.stroke();
    x.beginPath(); x.arc(128, 132, 54, 0.18 * Math.PI, 0.82 * Math.PI); x.stroke();
  }
  return c;
}

// ---------- Пиксельный цирк ----------
function circusWallCanvas(th, r) {
  const W = 512 * K, H = 640 * K, n = fbm(W, H, r, [[4, 0.5], [32, 0.3], [128, 0.2]]);
  const c = paint(W, H, (x, y, i, p) => {
    const X = x / K, Y = y / K, yb = y / H, f = 0.9 + (n[i] - 0.5) * 0.2 + (r() - 0.5) * 0.04;
    if (yb < 0.05 || yb > 0.9) {
      const d = Math.abs(((X + (yb < 0.05 ? 0 : 16)) % 32) - 16) + Math.abs(((Y % 32)) - 16) < 9;
      const g = d ? 1.1 : 0.85; p[0] = 214 * f * g; p[1] = 164 * f * g; p[2] = 52 * f * g; return;
    }
    const red = (((X / 32) | 0) & 1) === 0;
    if (red) { p[0] = 196 * f; p[1] = 28 * f; p[2] = 40 * f; } else { p[0] = 244 * f; p[1] = 234 * f; p[2] = 210 * f; }
    if (yb > 0.86) { p[0] *= 0.8; p[1] *= 0.8; p[2] *= 0.8; }
  });
  const x = c.getContext('2d'); x.setTransform(K, 0, 0, K, 0, 0);
  for (let k = 0; k < 5; k++) { star(x, 30 + r() * 452, 640 * 0.12 + r() * 640 * 0.6, 8 + r() * 10); x.fillStyle = 'rgba(255,214,80,0.85)'; x.fill(); }
  x.setTransform(1, 0, 0, 1, 0, 0);
  return c;
}
function checkerCanvas(r) {
  const W = 512 * K, n = fbm(W, W, r, [[8, 0.5], [64, 0.3], [256, 0.2]]);
  return paint(W, W, (x, y, i, p) => {
    const dark = ((((x / K) >> 7) + ((y / K) >> 7)) & 1) === 0, f = 0.9 + (n[i] - 0.5) * 0.18 + (r() - 0.5) * 0.04;
    if (dark) { p[0] = 30 * f; p[1] = 26 * f; p[2] = 40 * f; } else { p[0] = 238 * f; p[1] = 228 * f; p[2] = 206 * f; }
  });
}
function tentCanvas() {
  const c = canvas(512, 256), x = c.getContext('2d');
  for (let k = 0; k < 16; k++) { x.fillStyle = k % 2 ? '#f2e6cc' : '#c41e2e'; x.fillRect(k * 32, 0, 32, 256); }
  x.fillStyle = '#d6a434'; x.fillRect(0, 236, 512, 20);
  for (let k = 0; k < 16; k++) { x.beginPath(); x.arc(k * 32 + 16, 236, 16, 0, Math.PI); x.fillStyle = k % 2 ? '#c41e2e' : '#f2e6cc'; x.fill(); }
  return c;
}
function gridCanvas() {
  const c = canvas(256, 256), x = c.getContext('2d');
  x.fillStyle = '#000'; x.fillRect(0, 0, 256, 256);
  x.strokeStyle = '#7a3cff'; x.lineWidth = 3; x.strokeRect(1.5, 1.5, 253, 253);
  x.strokeStyle = 'rgba(60,230,255,0.55)'; x.lineWidth = 1; x.beginPath(); x.moveTo(128, 0); x.lineTo(128, 256); x.moveTo(0, 128); x.lineTo(256, 128); x.stroke();
  return c;
}
function ringCanvas(r) {
  const W = 512, c = canvas(W, W), x = c.getContext('2d');
  x.beginPath(); x.arc(256, 256, 250, 0, 7); x.fillStyle = '#b3884f'; x.fill();
  for (let k = 0; k < 6000; k++) { const a = r() * 6.28, d = Math.sqrt(r()) * 240; x.fillStyle = r() < 0.5 ? 'rgba(90,60,30,0.25)' : 'rgba(230,200,140,0.25)'; x.fillRect(256 + Math.cos(a) * d, 256 + Math.sin(a) * d, 2, 2); }
  x.lineWidth = 18; x.strokeStyle = '#c41e2e'; x.beginPath(); x.arc(256, 256, 238, 0, 7); x.stroke();
  x.lineWidth = 6; x.strokeStyle = '#f0d070'; x.beginPath(); x.arc(256, 256, 222, 0, 7); x.stroke();
  star(x, 256, 256, 60); x.fillStyle = 'rgba(245,235,210,0.85)'; x.fill();
  return c;
}
function drumCanvas() {
  const c = canvas(512, 128), x = c.getContext('2d');
  x.fillStyle = '#2d58c8'; x.fillRect(0, 0, 512, 128);
  x.fillStyle = '#d6a434'; x.fillRect(0, 0, 512, 14); x.fillRect(0, 114, 512, 14);
  x.fillStyle = '#c41e2e'; x.fillRect(0, 14, 512, 8); x.fillRect(0, 106, 512, 8);
  for (let k = 0; k < 8; k++) { star(x, 32 + k * 64, 64, 18); x.fillStyle = '#ffe07a'; x.fill(); }
  return c;
}
function marqueeCanvas(text) {
  const c = canvas(512, 256), x = c.getContext('2d');
  x.fillStyle = '#3a0712'; x.fillRect(0, 0, 512, 256);
  x.strokeStyle = '#d6a434'; x.lineWidth = 14; x.strokeRect(10, 10, 492, 236);
  x.fillStyle = '#fff3c8';
  for (let k = 0; k < 18; k++) { x.beginPath(); x.arc(28 + k * 27, 26, 7, 0, 7); x.fill(); x.beginPath(); x.arc(28 + k * 27, 230, 7, 0, 7); x.fill(); }
  for (let k = 1; k < 8; k++) { x.beginPath(); x.arc(26, 26 + k * 25.5, 7, 0, 7); x.fill(); x.beginPath(); x.arc(486, 26 + k * 25.5, 7, 0, 7); x.fill(); }
  x.textAlign = 'center'; x.textBaseline = 'middle'; x.font = '700 150px Caveat, "Segoe Print", cursive';
  x.shadowColor = '#ff7aa8'; x.shadowBlur = 24; x.fillStyle = '#ffe9f1'; x.fillText(text, 256, 134); x.shadowBlur = 0; x.fillText(text, 256, 134);
  return c;
}

// ---------- тайные комнаты по темам ----------
function secretWallCanvas(kind, r) {
  if (kind === 'love') return roomWallCanvas(r);
  const W = 512, H = 640, n = fbm(W, H, r, [[8, 0.5], [64, 0.5]]);
  if (kind === 'circus') {
    const c = paint(W, H, (x, y, i, p) => {
      const f = 0.94 + (n[i] - 0.5) * 0.1, pink = ((x >> 5) & 1) === 0;
      if (pink) { p[0] = 255 * f; p[1] = 150 * f; p[2] = 184 * f; } else { p[0] = 255 * f; p[1] = 240 * f; p[2] = 244 * f; }
    });
    const x = c.getContext('2d'); x.fillStyle = 'rgba(214,40,90,0.6)';
    for (let k = 0; k < 12; k++) { heartPath(x, 30 + r() * (W - 60), 40 + r() * (H - 80), 9); x.fill(); }
    return c;
  }
  const c = paint(W, H, (x, y, i, p) => { const f = 0.95 + (n[i] - 0.5) * 0.12; p[0] = 255 * f; p[1] = 236 * f; p[2] = 196 * f; });
  const x = c.getContext('2d');
  for (let k = 0; k < 16; k++) {
    const cx = 40 + r() * (W - 80), cy = 50 + r() * (H - 100);
    if (r() < 0.5) crayonSmile(x, cx, cy, 14 + r() * 18, SMILE_COLS[(r() * 6) | 0], r, false);
    else { heartPath(x, cx, cy, 10 + r() * 10); x.fillStyle = '#ff5c86'; x.fill(); }
  }
  return c;
}
function smileHeartFaceCanvas() {
  const c = canvas(512, 512), x = c.getContext('2d');
  x.strokeStyle = '#3a0a14'; x.fillStyle = '#3a0a14'; x.lineCap = 'round'; x.lineWidth = 16;
  for (const s of [-1, 1]) { x.beginPath(); x.ellipse(256 + s * 72, 170, 20, 34, 0, 0, 7); x.fill(); }
  x.beginPath(); x.arc(256, 190, 110, 0.18 * Math.PI, 0.82 * Math.PI); x.stroke();
  x.fillStyle = 'rgba(255,120,150,0.55)'; for (const s of [-1, 1]) { x.beginPath(); x.ellipse(256 + s * 128, 230, 30, 18, 0, 0, 7); x.fill(); }
  x.textAlign = 'center'; x.textBaseline = 'middle'; x.font = '700 120px Caveat, "Segoe Print", cursive';
  x.shadowColor = 'rgba(255,255,255,0.9)'; x.shadowBlur = 14; x.fillStyle = '#fff6fa'; x.fillText('Уля', 256, 400); x.shadowBlur = 0; x.fillText('Уля', 256, 400);
  return c;
}

export { canvas, fbm, toTex, setTexScale, texScale, wallCanvas, floorCanvas, ceilCanvas, lampCanvas, doorCanvas, signCanvas, heartDecalCanvas, roomWallCanvas, roomFloorCanvas, heartTextCanvas, paperCanvas, keycardCanvas, glowCanvas, screenCanvas, poolBottomCanvas, waveNormalCanvas, pillarCanvas, lockerCanvas, boxCanvas, crayonSmile, smilesWallCanvas, playmatCanvas, padCanvas, posterCanvas, neonSmileCanvas, circusWallCanvas, checkerCanvas, tentCanvas, gridCanvas, ringCanvas, drumCanvas, marqueeCanvas, secretWallCanvas, smileHeartFaceCanvas };
