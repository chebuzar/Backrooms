// Круглая мини-карта в углу экрана: только исследованные клетки, повёрнута по взгляду игрока,
// «N» на ободке показывает север, красный пунктир — пройденный путь.
const S = 2;

export function createMinimap(el) {
  const c = el.querySelector('canvas');
  return { el, c, x: c.getContext('2d'), t: 0, trail: [], lastX: null, lastZ: null };
}

// запомнить путь: точка каждые ~1.6 м, не больше 90 точек
export function trackTrail(m, x, z) {
  if (m.lastX === null || Math.hypot(x - m.lastX, z - m.lastZ) > 1.6) {
    m.trail.push([x, z]); if (m.trail.length > 90) m.trail.shift();
    m.lastX = x; m.lastZ = z;
  }
}
export function resetMinimap(m) { m.trail.length = 0; m.lastX = m.lastZ = null; }

// o: { lvl, seen, px, pz, yaw, finds, doorSeen, solid(t) }
export function drawMinimap(m, o) {
  const dpr = Math.min(2, window.devicePixelRatio || 1), css = m.el.clientWidth || 150;
  const W = Math.round(css * dpr);
  if (m.c.width !== W) { m.c.width = W; m.c.height = W; }
  const x = m.x, R = W / 2, cells = 11, k = R / cells; // пикселей на клетку
  const { lvl: L, seen, px, pz, yaw } = o;
  x.setTransform(1, 0, 0, 1, 0, 0);
  x.clearRect(0, 0, W, W);
  x.save();
  x.beginPath(); x.arc(R, R, R - 1, 0, Math.PI * 2); x.clip();
  x.fillStyle = 'rgba(14,12,7,0.82)'; x.fillRect(0, 0, W, W);
  // поворот: взгляд игрока — вверх
  const th = yaw;
  x.translate(R, R); x.rotate(th);
  const cx = px / S, cz = pz / S, tx0 = Math.floor(cx), tz0 = Math.floor(cz), rr = cells + 2;
  // пол исследованных клеток
  for (let dz = -rr; dz <= rr; dz++) for (let dx = -rr; dx <= rr; dx++) {
    const tx = tx0 + dx, tz = tz0 + dz;
    if (tx < 0 || tz < 0 || tx >= L.mw || tz >= L.mh) continue;
    const i = tz * L.mw + tx; if (!seen[i]) continue;
    const t = L.tile(tx, tz); if (t !== 0 && t !== 6 && t !== 4) continue;
    x.fillStyle = t === 6 ? 'rgba(70,130,170,0.85)' : 'rgba(92,82,52,0.9)';
    x.fillRect((tx - cx) * k, (tz - cz) * k, k + 0.6, k + 0.6);
  }
  // стены: светлые линии на границе исследованного пола и стены
  x.strokeStyle = 'rgba(236,224,180,0.9)'; x.lineWidth = Math.max(1.2, k * 0.14); x.beginPath();
  for (let dz = -rr; dz <= rr; dz++) for (let dx = -rr; dx <= rr; dx++) {
    const tx = tx0 + dx, tz = tz0 + dz;
    if (tx < 0 || tz < 0 || tx >= L.mw || tz >= L.mh || !seen[tz * L.mw + tx] || o.solid(L.tile(tx, tz))) continue;
    const X = (tx - cx) * k, Z = (tz - cz) * k;
    if (o.solid(L.tile(tx + 1, tz))) { x.moveTo(X + k, Z); x.lineTo(X + k, Z + k); }
    if (o.solid(L.tile(tx - 1, tz))) { x.moveTo(X, Z); x.lineTo(X, Z + k); }
    if (o.solid(L.tile(tx, tz + 1))) { x.moveTo(X, Z + k); x.lineTo(X + k, Z + k); }
    if (o.solid(L.tile(tx, tz - 1))) { x.moveTo(X, Z); x.lineTo(X + k, Z); }
  }
  x.stroke();
  // путь
  x.fillStyle = 'rgba(255,90,70,0.85)';
  for (const [wx, wz] of m.trail) { x.beginPath(); x.arc((wx / S - cx) * k, (wz / S - cz) * k, Math.max(1.4, k * 0.1), 0, 7); x.fill(); }
  // выход (если видел) и найденные находки
  if (o.doorSeen) { x.fillStyle = '#35e07a'; x.fillRect((L.door.x / S - cx) * k - k * 0.45, (L.door.z / S - cz) * k - k * 0.45, k * 0.9, k * 0.9); }
  for (const f of o.finds || []) {
    if (!f.found) continue;
    const X = (f.x / S - cx) * k, Z = (f.z / S - cz) * k;
    x.fillStyle = '#ffd86a'; x.beginPath(); x.arc(X, Z, Math.max(2.5, k * 0.28), 0, 7); x.fill();
  }
  x.restore();
  // игрок — стрелка в центре (всегда вверх)
  x.fillStyle = '#f4ecd2'; x.beginPath();
  x.moveTo(R, R - k * 0.9); x.lineTo(R + k * 0.55, R + k * 0.6); x.lineTo(R, R + k * 0.3); x.lineTo(R - k * 0.55, R + k * 0.6); x.closePath(); x.fill();
  // ободок и «N»
  x.strokeStyle = 'rgba(240,232,200,0.45)'; x.lineWidth = dpr * 1.5; x.beginPath(); x.arc(R, R, R - dpr, 0, Math.PI * 2); x.stroke();
  const na = th - Math.PI / 2; // направление «вверх по карте» (−z) после поворота
  const nx = R + Math.cos(na) * (R - 11 * dpr), ny = R + Math.sin(na) * (R - 11 * dpr);
  x.fillStyle = 'rgba(14,12,7,0.9)'; x.beginPath(); x.arc(nx, ny, 8 * dpr, 0, 7); x.fill();
  x.fillStyle = '#f4ecd2'; x.font = `600 ${10 * dpr}px "IBM Plex Mono", monospace`; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText('N', nx, ny + dpr * 0.5);
}
