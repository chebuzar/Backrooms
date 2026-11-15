// Сканер на руке: рука в перчатке с круглым радаром на запястье, прикреплена к камере.
// Поднимается при сканировании; экран — canvas, перерисовывается каждый кадр, пока рука видна.
import * as THREE from 'three';
import { shaded } from './finds.js';

const RANGE = 16; // м — дальность сканера

export function makeWrist() {
  const root = new THREE.Group();     // крепится к камере
  const arm = new THREE.Group(); root.add(arm);
  const sleeve = shaded(new THREE.MeshLambertMaterial({ color: 0xd9d3c2 }));
  const ribs = shaded(new THREE.MeshLambertMaterial({ color: 0xb9b2a0 }));
  const glove = shaded(new THREE.MeshLambertMaterial({ color: 0xcfc8b6 }));
  const dark = shaded(new THREE.MeshLambertMaterial({ color: 0x3a3833 }));
  const metal = shaded(new THREE.MeshLambertMaterial({ color: 0x8d8a82 }));
  // предплечье вдоль оси X (к кисти — +X)
  const fore = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.1, 0.62, 18), sleeve);
  fore.rotation.z = Math.PI / 2; fore.position.x = -0.22; arm.add(fore);
  for (let k = 0; k < 6; k++) {
    const r = new THREE.Mesh(new THREE.TorusGeometry(0.094 + k * 0.002, 0.012, 6, 18), ribs);
    r.rotation.y = Math.PI / 2; r.position.x = -0.48 + k * 0.05; arm.add(r);
  }
  // манжета и кисть
  const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.092, 0.08, 18), metal); cuff.rotation.z = Math.PI / 2; cuff.position.x = 0.1; arm.add(cuff);
  const hand = new THREE.Group(); hand.position.x = 0.2; arm.add(hand);
  const palm = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.06, 0.13), glove); palm.position.x = 0.04; hand.add(palm);
  for (let f = 0; f < 4; f++) {
    const fg = new THREE.Mesh(new THREE.CapsuleGeometry(0.017, 0.08, 4, 8), f === 3 ? glove : glove);
    fg.rotation.z = Math.PI / 2 - 0.35; fg.position.set(0.15, -0.012, -0.045 + f * 0.03); hand.add(fg);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 6), dark); tip.position.set(0.2, -0.03, -0.045 + f * 0.03); hand.add(tip);
  }
  const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.019, 0.07, 4, 8), glove); thumb.rotation.set(0.9, 0, Math.PI / 2 - 0.2); thumb.position.set(0.06, 0.0, 0.08); hand.add(thumb);
  // прибор на запястье: корпус, болты, экран
  const dev = new THREE.Group(); dev.position.set(-0.16, 0.098, 0); arm.add(dev);
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.115, 0.04, 28), metal); dev.add(body);
  const bezel = new THREE.Mesh(new THREE.TorusGeometry(0.098, 0.012, 8, 28), ribs); bezel.rotation.x = Math.PI / 2; bezel.position.y = 0.022; dev.add(bezel);
  for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2, b = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.012, 8), dark); b.position.set(Math.cos(a) * 0.112, 0.02, Math.sin(a) * 0.112); dev.add(b); }
  const strap = new THREE.Mesh(new THREE.CylinderGeometry(0.103, 0.103, 0.09, 20, 1, true), dark); strap.rotation.z = Math.PI / 2; strap.position.set(-0.16, 0, 0); arm.add(strap);
  const cv = document.createElement('canvas'); cv.width = cv.height = 256;
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  const screen = new THREE.Mesh(new THREE.CircleGeometry(0.088, 40), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
  screen.rotation.set(-Math.PI / 2, 0, -Math.PI / 2 + 0.5); screen.position.y = 0.0235; dev.add(screen);
  // положение в кадре: предплечье входит снизу слева и уходит вправо-вдаль, экран прибора смотрит в глаза.
  // Базис: X — вдоль руки (к кисти), Y — нормаль экрана.
  const X = new THREE.Vector3(1, 0.2, -0.62).normalize();
  const Y = new THREE.Vector3(0.0, 0.55, 0.84); Y.sub(X.clone().multiplyScalar(Y.dot(X))).normalize();
  const Z = new THREE.Vector3().crossVectors(X, Y);
  arm.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, Z));
  const devLocal = new THREE.Vector3(-0.16, 0.12, 0).applyQuaternion(arm.quaternion);
  arm.position.set(-0.1, -0.135, -0.42).sub(devLocal);
  root.visible = false;
  return { root, arm, tex, cv, x: cv.getContext('2d'), raise: 0, sweep: 0, blips: new Map() };
}

// k — 0..1 насколько рука поднята; t — время
export function poseWrist(w, dt, want, t, bob = 0) {
  w.raise += ((want ? 1 : 0) - w.raise) * Math.min(1, dt * (want ? 7 : 5));
  const k = w.raise, e = k * k * (3 - 2 * k);
  w.root.visible = k > 0.01;
  w.root.position.set((1 - e) * 0.06, -(1 - e) * 0.3 + Math.sin(t * 1.3) * 0.003 + bob * 0.008, 0);
  w.root.rotation.set((1 - e) * -0.35, 0, Math.sin(t * 0.9) * 0.008);
}

// blips: [{x, z, kind}] — мировые координаты; px, pz, yaw — игрок
export function drawRadar(w, dt, t, px, pz, yaw, blips) {
  const x = w.x, C = 128, R = 120;
  w.sweep = (w.sweep + dt * 2.6) % (Math.PI * 2);
  x.setTransform(1, 0, 0, 1, 0, 0);
  const bg = x.createRadialGradient(C, C, 10, C, C, R); bg.addColorStop(0, '#0d3a22'); bg.addColorStop(1, '#03140b');
  x.fillStyle = '#020604'; x.fillRect(0, 0, 256, 256);
  x.fillStyle = bg; x.beginPath(); x.arc(C, C, R, 0, 7); x.fill();
  x.strokeStyle = 'rgba(90,255,150,0.28)'; x.lineWidth = 2;
  for (const rr of [R * 0.33, R * 0.66, R * 0.98]) { x.beginPath(); x.arc(C, C, rr, 0, 7); x.stroke(); }
  x.beginPath(); x.moveTo(C - R, C); x.lineTo(C + R, C); x.moveTo(C, C - R); x.lineTo(C, C + R); x.stroke();
  // луч развёртки с хвостом
  for (let i = 0; i < 18; i++) {
    const a0 = w.sweep - i * 0.05, a1 = a0 - 0.05;
    x.fillStyle = `rgba(110,255,160,${0.32 * (1 - i / 18)})`;
    x.beginPath(); x.moveTo(C, C); x.arc(C, C, R, a1, a0); x.closePath(); x.fill();
  }
  x.strokeStyle = 'rgba(180,255,200,0.9)'; x.lineWidth = 2.5; x.beginPath(); x.moveTo(C, C); x.lineTo(C + Math.cos(w.sweep) * R, C + Math.sin(w.sweep) * R); x.stroke();
  // отметки: вспыхивают, когда их задевает луч, потом гаснут
  const sy = Math.sin(yaw), cy = Math.cos(yaw);
  for (const b of blips) {
    const dx = b.x - px, dz = b.z - pz, d = Math.hypot(dx, dz); if (d > RANGE) continue;
    // в систему игрока: вперёд — вверх экрана
    const rx = dx * cy - dz * sy, rz = dx * sy + dz * cy;
    const bx = C + rx / RANGE * R, by = C + rz / RANGE * R;
    const ang = Math.atan2(by - C, bx - C), key = b.id;
    let diff = w.sweep - ang; diff = ((diff % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    if (diff < 0.12) w.blips.set(key, 1);
    const life = w.blips.get(key) || 0; if (life <= 0) continue;
    w.blips.set(key, life - dt * 0.45);
    const col = b.kind === 'ent' ? '255,70,60' : b.kind === 'find' ? '255,220,110' : b.kind === 'anom' ? '200,150,255' : '140,255,180';
    x.fillStyle = `rgba(${col},${Math.min(1, life * 1.3)})`;
    x.beginPath(); x.arc(bx, by, b.kind === 'ent' ? 9 : 6, 0, 7); x.fill();
    x.fillStyle = `rgba(${col},${life * 0.25})`; x.beginPath(); x.arc(bx, by, 16, 0, 7); x.fill();
  }
  // игрок в центре
  x.fillStyle = '#d8ffe4'; x.beginPath(); x.moveTo(C, C - 9); x.lineTo(C + 6, C + 7); x.lineTo(C, C + 3); x.lineTo(C - 6, C + 7); x.closePath(); x.fill();
  // шум и полосы, как у старого ЭЛТ
  x.fillStyle = 'rgba(0,0,0,0.18)'; for (let yy = 0; yy < 256; yy += 4) x.fillRect(0, yy, 256, 1.5);
  x.fillStyle = 'rgba(160,255,190,0.85)'; x.font = '600 15px monospace'; x.textAlign = 'center';
  // (подпись дальности убрана: экран повёрнут, текст читается боком)
  w.tex.needsUpdate = true;
}
export { RANGE as SCAN_RANGE };
