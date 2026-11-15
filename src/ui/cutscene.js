// Кат-сцена предыстории: пять нарисованных сцен (canvas 2D) в стиле видеокассеты + субтитры + звук.
// Сцены: 0 — ЧАЭС ночью и взрыв, 1 — руины и «Шов», 2 — за Швом, 3 — Объект 4-Б, 4 — видоискатель камеры.
// playCutscene(host, lines, hooks) → Promise; касание/клик/клавиша пропускают.

const SCENE_OF_LINE = [0, 0, 1, 1, 2, 3, 3, 4, 4];

function rnd(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

export function playCutscene(host, lines, hooks = {}) {
  const cv = document.createElement('canvas'); cv.className = 'cut';
  host.prepend(cv);
  const x = cv.getContext('2d');
  let W = 0, H = 0, DPR = 1;
  const fit = () => { DPR = Math.min(2, window.devicePixelRatio || 1); W = cv.width = Math.round(innerWidth * DPR); H = cv.height = Math.round(innerHeight * DPR); };
  fit(); addEventListener('resize', fit);
  // заранее: шум плёнки (4 кадра) и звёзды
  const noise = [0, 1, 2, 3].map(() => { const c = document.createElement('canvas'); c.width = 160; c.height = 90; const g = c.getContext('2d'), d = g.createImageData(160, 90); for (let i = 0; i < d.data.length; i += 4) { const v = Math.random() * 255; d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255; } g.putImageData(d, 0, 0); return c; });
  const R = rnd(7), stars = Array.from({ length: 90 }, () => [R(), R() * 0.55, R() * 1.2 + 0.3]);
  const smoke = [], dust = Array.from({ length: 60 }, () => [R(), R(), R() * 0.5 + 0.2]);

  const caption = host.querySelector('#proLines');
  let scene = 0, sceneT = 0, boomT = -1, last = performance.now(), raf = 0, done = false, skip = false;

  // ---------- сцены ----------
  function plant(t) {
    const g = x.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#04060c'); g.addColorStop(0.7, '#111725'); g.addColorStop(1, '#0a0b0e'); x.fillStyle = g; x.fillRect(0, 0, W, H);
    for (const [sx, sy, sr] of stars) { x.fillStyle = `rgba(220,225,255,${0.35 + 0.3 * Math.sin(t * 2 + sx * 40)})`; x.fillRect(sx * W, sy * H, sr * DPR, sr * DPR); }
    const gy = H * 0.74, s = Math.min(W, H * 1.7) / 1000, cx = W * 0.5;
    // зарево над блоком 4 после взрыва
    if (boomT >= 0) {
      const k = Math.min(1, boomT / 0.6), rg = x.createRadialGradient(cx + 120 * s, gy - 160 * s, 10, cx + 120 * s, gy - 160 * s, 520 * s);
      rg.addColorStop(0, `rgba(255,170,90,${0.75 * k})`); rg.addColorStop(0.4, `rgba(200,80,40,${0.35 * k})`); rg.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = rg; x.fillRect(0, 0, W, H);
      if (smoke.length < 140 && Math.random() < 0.7) smoke.push([cx + (110 + Math.random() * 40) * s, gy - 170 * s, (20 + Math.random() * 30) * s, Math.random() * 0.4 + 0.3]);
    }
    for (const p of smoke) { p[1] -= 22 * s * p[3]; p[0] += 6 * s * p[3]; p[2] += 0.5 * s; x.fillStyle = 'rgba(70,64,62,0.08)'; x.beginPath(); x.arc(p[0], p[1], p[2], 0, 7); x.fill(); }
    // здания: турбинный зал, реакторные блоки
    x.fillStyle = '#07080a';
    x.fillRect(cx - 470 * s, gy - 90 * s, 600 * s, 90 * s);
    x.fillRect(cx - 200 * s, gy - 185 * s, 380 * s, 185 * s);
    x.fillRect(cx + 40 * s, gy - 230 * s, 150 * s, 230 * s);
    if (boomT >= 0) { x.fillStyle = '#04050a'; x.beginPath(); x.moveTo(cx + 60 * s, gy - 230 * s); x.lineTo(cx + 110 * s, gy - 175 * s); x.lineTo(cx + 140 * s, gy - 240 * s); x.lineTo(cx + 190 * s, gy - 200 * s); x.lineTo(cx + 190 * s, gy - 260 * s); x.lineTo(cx + 60 * s, gy - 260 * s); x.fill(); }
    // окна
    for (let i = 0; i < 22; i++) { x.fillStyle = `rgba(255,214,120,${0.25 + 0.4 * ((i * 7) % 5) / 5})`; x.fillRect(cx - 450 * s + i * 26 * s, gy - 60 * s, 8 * s, 6 * s); }
    // вентиляционная труба в красно-белую полоску с решёткой
    const tx = cx - 30 * s, tb = gy - 185 * s, th = 330 * s;
    for (let i = 0; i < 10; i++) { const y0 = tb - th * (i + 1) / 10, w0 = (26 - i * 1.2) * s; x.fillStyle = i % 2 ? '#3a3638' : '#5a1a1a'; x.fillRect(tx - w0 / 2, y0, w0, th / 10 + 1); }
    x.strokeStyle = 'rgba(30,30,34,0.9)'; x.lineWidth = 2 * s;
    for (let i = 0; i < 7; i++) { const y0 = tb - th * i / 7; x.beginPath(); x.moveTo(tx - 46 * s, y0); x.lineTo(tx + 46 * s, y0 - th / 7); x.moveTo(tx + 46 * s, y0); x.lineTo(tx - 46 * s, y0 - th / 7); x.stroke(); }
    x.fillStyle = `rgba(255,40,30,${0.5 + 0.5 * Math.sin(t * 3)})`; x.fillRect(tx - 3 * s, tb - th - 8 * s, 6 * s, 6 * s);
    x.fillStyle = '#050506'; x.fillRect(0, gy, W, H - gy);
    // вспышка
    if (boomT >= 0 && boomT < 1.4) { x.fillStyle = `rgba(255,245,225,${Math.max(0, 1 - boomT / 1.2)})`; x.fillRect(0, 0, W, H); }
  }
  function seam(t) {
    x.fillStyle = '#17150f'; x.fillRect(0, 0, W, H);
    const cx = W / 2, cy = H * 0.44, bw = W * 0.34, bh = H * 0.5;
    // комната в перспективе
    x.fillStyle = '#2b2820'; x.fillRect(cx - bw / 2, cy - bh / 2, bw, bh);
    x.strokeStyle = '#3a362c'; x.lineWidth = 2 * DPR;
    for (const [ax, ay, bx, by] of [[0, 0, cx - bw / 2, cy - bh / 2], [W, 0, cx + bw / 2, cy - bh / 2], [0, H, cx - bw / 2, cy + bh / 2], [W, H, cx + bw / 2, cy + bh / 2]]) { x.beginPath(); x.moveTo(ax, ay); x.lineTo(bx, by); x.stroke(); }
    // шов: неровная щель с жёлтым светом
    const pulse = 0.75 + 0.25 * Math.sin(t * 2.3), sx = cx + bw * 0.12;
    const glow = x.createRadialGradient(sx, cy, 4, sx, cy, bh * 0.9); glow.addColorStop(0, `rgba(255,220,110,${0.45 * pulse})`); glow.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = glow; x.fillRect(0, 0, W, H);
    x.strokeStyle = `rgba(255,236,160,${0.95 * pulse})`; x.lineWidth = 3 * DPR; x.beginPath();
    for (let i = 0; i <= 14; i++) { const yy = cy - bh * 0.42 + bh * 0.84 * i / 14; x.lineTo(sx + Math.sin(i * 2.7) * bw * 0.02, yy); } x.stroke();
    // обломки
    x.fillStyle = '#0b0b0a'; for (let i = 0; i < 9; i++) { const bx = (i * 0.11 + 0.03) * W, by = H * (0.8 + (i % 3) * 0.05); x.beginPath(); x.moveTo(bx, H); x.lineTo(bx + 40 * DPR, by); x.lineTo(bx + 110 * DPR, by + 30 * DPR); x.lineTo(bx + 140 * DPR, H); x.fill(); }
    // луч фонаря, медленно ищет и находит шов
    const fx = cx + Math.sin(Math.min(t, 4) * 0.6 - 1.2) * bw * 0.6 + bw * 0.12 * Math.min(1, t / 4), fy = cy + Math.cos(t * 0.8) * 20 * DPR;
    const fl = x.createRadialGradient(fx, fy, 4, fx, fy, bh * 0.35); fl.addColorStop(0, 'rgba(240,235,210,0.42)'); fl.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = fl; x.fillRect(0, 0, W, H);
    for (const d of dust) { const px = (d[0] * W + t * 8 * d[2] * DPR) % W, py = (d[1] * H + Math.sin(t + d[0] * 9) * 6) % H; x.fillStyle = `rgba(255,240,200,${0.15 * d[2]})`; x.fillRect(px, py, 2 * DPR, 2 * DPR); }
  }
  function yellow(t) {
    // коридор в перспективе: точка схода в центре, камера медленно идёт вперёд
    const cx = W / 2, cy = H * 0.47, fw = W * 0.08, fh = H * 0.1;
    const P = (z) => { const k = 1 / z; return { l: cx - (W / 2) * k - fw / 2 * (1 - k), r: cx + (W / 2) * k + fw / 2 * (1 - k), t: cy - (H * 0.47) * k - fh / 2 * (1 - k), b: cy + (H * 0.53) * k + fh / 2 * (1 - k) }; };
    const n = P(1), f = P(40);
    const quad = (pts, fill) => { x.fillStyle = fill; x.beginPath(); x.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 2) x.lineTo(pts[i], pts[i + 1]); x.closePath(); x.fill(); };
    const wg = (x0, x1) => { const g = x.createLinearGradient(x0, 0, x1, 0); g.addColorStop(0, '#c9ae55'); g.addColorStop(1, '#5a4c22'); return g; };
    quad([n.l, n.t, n.r, n.t, f.r, f.t, f.l, f.t], (() => { const g = x.createLinearGradient(0, n.t, 0, f.t); g.addColorStop(0, '#e6dfc4'); g.addColorStop(1, '#6e6a58'); return g; })());
    quad([n.l, n.b, n.r, n.b, f.r, f.b, f.l, f.b], (() => { const g = x.createLinearGradient(0, n.b, 0, f.b); g.addColorStop(0, '#7a6326'); g.addColorStop(1, '#3a301a'); return g; })());
    quad([n.l, n.t, f.l, f.t, f.l, f.b, n.l, n.b], wg(n.l, f.l));
    quad([n.r, n.t, f.r, f.t, f.r, f.b, n.r, n.b], wg(n.r, f.r));
    x.fillStyle = '#1a1609'; x.fillRect(f.l, f.t, f.r - f.l, f.b - f.t);
    // лампы-панели на потолке, плывут навстречу
    const off = (t * 0.9) % 2;
    for (let z = 22; z >= 1.2; z -= 2) {
      const zz = z - off; if (zz < 1.05) continue;
      const a = P(zz), b = P(zz + 0.7), w0 = (a.r - a.l) * 0.16, w1 = (b.r - b.l) * 0.16;
      const al = Math.min(1, 3 / zz);
      x.fillStyle = `rgba(255,252,236,${0.95 * al + 0.05})`;
      x.beginPath(); x.moveTo(cx - w0, a.t + 1); x.lineTo(cx + w0, a.t + 1); x.lineTo(cx + w1, b.t + 1); x.lineTo(cx - w1, b.t + 1); x.fill();
      const gl = x.createRadialGradient(cx, a.t, 2, cx, a.t, (a.r - a.l) * 0.35); gl.addColorStop(0, `rgba(255,240,180,${0.18 * al})`); gl.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = gl; x.fillRect(a.l, a.t, a.r - a.l, (a.b - a.t) * 0.7);
    }
  }
  function object(t) {
    x.fillStyle = '#2a2b2e'; x.fillRect(0, 0, W, H);
    const cx = W / 2, dw = Math.min(W * 0.3, H * 0.42), dh = dw * 1.15, dy = H * 0.16;
    x.fillStyle = '#3e4043'; x.fillRect(cx - dw * 0.62, dy - dh * 0.08, dw * 1.24, dh * 1.1);
    const g = x.createLinearGradient(cx - dw / 2, 0, cx + dw / 2, 0); g.addColorStop(0, '#6a6e6a'); g.addColorStop(1, '#4c504c'); x.fillStyle = g; x.fillRect(cx - dw / 2, dy, dw, dh);
    x.strokeStyle = '#1a1b1b'; x.lineWidth = 4 * DPR; x.strokeRect(cx - dw / 2, dy, dw, dh); x.beginPath(); x.moveTo(cx, dy); x.lineTo(cx, dy + dh); x.stroke();
    for (const k of [0.2, 0.5, 0.8]) { x.fillStyle = '#7c807b'; x.fillRect(cx - dw / 2 + 8 * DPR, dy + dh * k, dw - 16 * DPR, 6 * DPR); }
    x.fillStyle = '#d8c79a'; x.font = `900 ${dw * 0.11}px Impact, sans-serif`; x.textAlign = 'center'; x.fillText('ОБЪЕКТ 4-Б', cx, dy + dh * 0.36);
    // табличка ПЗРО со знаком радиации
    // табличка на стене справа от двери (не под субтитрами)
    const pw = dw * 0.8, px = cx + dw * 0.68, py = dy + dh * 0.32, sc = px + pw / 2;
    x.fillStyle = '#d9b52a'; x.fillRect(px, py, pw, H * 0.12); x.fillStyle = '#111'; x.font = `bold ${H * 0.019}px sans-serif`;
    x.fillText('ПУНКТ ЗАХОРОНЕНИЯ', sc + pw * 0.1, py + H * 0.05); x.fillText('РАДИОАКТИВНЫХ', sc + pw * 0.1, py + H * 0.078); x.fillText('ОТХОДОВ', sc + pw * 0.1, py + H * 0.104);
    const rx = px + H * 0.06, ry = py + H * 0.06, rr = H * 0.042;
    for (let k = 0; k < 3; k++) { const a0 = -Math.PI / 2 + k * 2 * Math.PI / 3 - Math.PI / 6; x.beginPath(); x.moveTo(rx, ry); x.arc(rx, ry, rr, a0, a0 + Math.PI / 3); x.closePath(); x.fill(); }
    // мигающая красная лампа
    const on = Math.sin(t * 5) > 0; const lg = x.createRadialGradient(cx, dy - dh * 0.14, 2, cx, dy - dh * 0.14, dw * 0.8);
    lg.addColorStop(0, on ? 'rgba(255,40,30,0.55)' : 'rgba(255,40,30,0.06)'); lg.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = lg; x.fillRect(0, 0, W, H);
    x.fillStyle = on ? '#ff3a2a' : '#5a1410'; x.beginPath(); x.arc(cx, dy - dh * 0.14, dw * 0.035, 0, 7); x.fill();
  }
  function camera(t) {
    // лестница вниз, к жёлтому свету
    x.fillStyle = '#16140f'; x.fillRect(0, 0, W, H);
    const cx = W / 2, pan = Math.min(1, t / 6);
    const lg = x.createRadialGradient(cx, H * (0.75 - pan * 0.1), 4, cx, H * 0.75, H * 0.5); lg.addColorStop(0, 'rgba(255,214,110,0.55)'); lg.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = lg; x.fillRect(0, 0, W, H);
    for (let i = 0; i < 12; i++) { const k = i / 12, y = H * (0.35 + k * 0.6) - pan * H * 0.08, w = W * (0.18 + k * 0.7); x.fillStyle = `rgba(${40 + i * 6},${36 + i * 5},${28 + i * 3},1)`; x.fillRect(cx - w / 2, y, w, H * 0.05 * (0.3 + k)); }
    // видоискатель
    x.strokeStyle = 'rgba(240,240,230,0.85)'; x.lineWidth = 3 * DPR; const m = 40 * DPR, L = 50 * DPR;
    for (const [ax, ay, sx, sy] of [[m, m, 1, 1], [W - m, m, -1, 1], [m, H - m, 1, -1], [W - m, H - m, -1, -1]]) { x.beginPath(); x.moveTo(ax, ay + sy * L); x.lineTo(ax, ay); x.lineTo(ax + sx * L, ay); x.stroke(); }
    x.font = `${22 * DPR}px "IBM Plex Mono", monospace`; x.textAlign = 'left';
    if (Math.sin(t * 4) > 0) { x.fillStyle = '#ff2a20'; x.beginPath(); x.arc(m + 20 * DPR, m + 40 * DPR, 9 * DPR, 0, 7); x.fill(); }
    x.fillStyle = '#f2efe4'; x.fillText('REC', m + 38 * DPR, m + 48 * DPR);
    x.textAlign = 'right'; x.fillText('14.03.1987  03:' + String(14 + Math.floor(t / 60)).padStart(2, '0') + ':' + String(Math.floor(t) % 60).padStart(2, '0'), W - m - 10 * DPR, H - m - 16 * DPR);
    x.fillText('▮▮▮▯', W - m - 10 * DPR, m + 48 * DPR);
  }
  const SCENES = [plant, seam, yellow, object, camera];

  // ---------- кадр ----------
  function frame(now) {
    if (done) return;
    raf = requestAnimationFrame(frame);
    // реальное время (до 0,25 с): на медленном устройстве сцены не «застревают» в затемнении
    const dt = Math.min(0.25, (now - last) / 1000); last = now; sceneT += dt; if (boomT >= 0) boomT += dt;
    x.save();
    if (boomT >= 0 && boomT < 1.2) x.translate((Math.random() - 0.5) * 18 * DPR * (1.2 - boomT), (Math.random() - 0.5) * 18 * DPR * (1.2 - boomT));
    SCENES[scene](sceneT);
    x.restore();
    // плёнка: зерно, строки, виньетка, проявление сцены
    x.globalAlpha = 0.07; x.drawImage(noise[(now / 60 | 0) % 4], 0, 0, W, H); x.globalAlpha = 1;
    x.fillStyle = 'rgba(0,0,0,0.12)'; for (let y = 0; y < H; y += 4 * DPR) x.fillRect(0, y, W, DPR);
    const vg = x.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.95); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.55)'); x.fillStyle = vg; x.fillRect(0, 0, W, H);
    if (sceneT < 0.8) { x.fillStyle = `rgba(0,0,0,${1 - sceneT / 0.8})`; x.fillRect(0, 0, W, H); }
  }
  raf = requestAnimationFrame(frame);

  const stop = () => { skip = true; };
  host.addEventListener('pointerdown', stop); addEventListener('keydown', stop);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  return (async () => {
    let geigerT = 0;
    const geiger = setInterval(() => { if (scene === 0 && boomT >= 0) hooks.geiger && hooks.geiger(); else if (scene === 1 && sceneT < 3) { if (++geigerT % 3 === 0) hooks.geiger && hooks.geiger(); } }, 90);
    for (let i = 0; i < lines.length && !skip; i++) {
      const sc = SCENE_OF_LINE[Math.min(i, SCENE_OF_LINE.length - 1)];
      if (sc !== scene) { scene = sc; sceneT = 0; hooks.scene && hooks.scene(sc); }
      if (i === 1) { boomT = 0; hooks.boom && hooks.boom(); }
      caption.textContent = ''; const p = document.createElement('p'); p.textContent = lines[i]; caption.appendChild(p);
      await sleep(40); p.classList.add('on');
      const n = 18 + Math.round(lines[i].length / 4); for (let k = 0; k < n && !skip; k++) await sleep(100);
    }
    clearInterval(geiger);
    done = true; cancelAnimationFrame(raf);
    host.removeEventListener('pointerdown', stop); removeEventListener('keydown', stop); removeEventListener('resize', fit);
    cv.remove(); caption.textContent = '';
    return skip;
  })();
}
