// Речі задач рівнів: печатка, запобіжник, ключ, щит, генератор (запасний), дитячі малюнки й стенд, задвижка, пульт насосної.
// Дрібні предмети — прості форми з матеріалами під запечене освітлення (probeLit); малюнки й написи — canvas один раз.
import * as THREE from 'three/webgpu';
import { probeLit } from './materials';

export const mat = (color: number, E: number, o: Partial<THREE.MeshStandardMaterialParameters> = {}) => probeLit(new THREE.MeshStandardMaterial({ color, roughness: 0.7, ...o }), E);

/** Печатка на штемпельній подушці: дерев'яна ручка, гумова основа, синя подушка. */
export function stampMesh(E: number): THREE.Group {
  const g = new THREE.Group();
  const pad = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.018, 0.08), mat(0x1d2c5e, E, { roughness: 0.9 }));
  pad.position.y = 0.009;
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.014, 20), mat(0x24221f, E));
  base.position.set(0.1, 0.007, 0);
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.016, 0.07, 14), mat(0x6b4426, E, { roughness: 0.45 }));
  handle.position.set(0.1, 0.05, 0);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.018, 14, 10), mat(0x6b4426, E, { roughness: 0.45 }));
  knob.position.set(0.1, 0.09, 0);
  g.add(pad, base, handle, knob);
  return g;
}

/** Плавкий запобіжник ПК-45: порцеляновий циліндр з латунними ковпачками. */
export function fuseMesh(E: number): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.07, 16), mat(0xe8e3d6, E, { roughness: 0.3 }));
  const capM = mat(0xb08d4a, E, { roughness: 0.3, metalness: 0.9 });
  for (const s of [-1, 1]) { const c = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.014, 16), capM); c.position.y = s * 0.04; g.add(c); }
  g.add(body);
  g.rotation.z = Math.PI / 2;
  return g;
}

/** Ключ на кільці з картонною біркою. */
export function keyMesh(E: number): THREE.Group {
  const g = new THREE.Group();
  const metal = mat(0x8e877a, E, { roughness: 0.35, metalness: 0.9 });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.018, 0.0025, 8, 20), metal);
  ring.rotation.x = Math.PI / 2;
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.003, 0.012), metal);
  blade.position.x = 0.045;
  const tag = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.002, 0.028), mat(0xc9b98f, E, { roughness: 0.95 }));
  tag.position.set(-0.04, 0, 0.01); tag.rotation.y = 0.4;
  g.add(ring, blade, tag);
  g.position.y = 0.003;
  return g;
}

/** Щит живлення: сіро-зелена шафа на стіні з трьома гніздами й сигнальною лампою. */
export function shieldMesh(E: number, lamp: THREE.MeshStandardMaterial): THREE.Group {
  const g = new THREE.Group();
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.7, 0.18), mat(0x56604f, E, { roughness: 0.55, metalness: 0.3 }));
  box.position.z = 0.09;
  const l = new THREE.Mesh(new THREE.SphereGeometry(0.025, 14, 10), lamp);
  l.position.set(0.17, 0.27, 0.185);
  g.add(box, l);
  for (let i = 0; i < 3; i++) {
    const sock = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.03, 14), mat(0x1c1c1a, E));
    sock.rotation.x = Math.PI / 2; sock.position.set(-0.12 + i * 0.12, -0.05, 0.19);
    g.add(sock);
  }
  return g;
}

/** Дизель-генератор: оливкова рама, бак, глушник. */
export function generatorMesh(E: number): THREE.Group {
  const g = new THREE.Group();
  const olive = mat(0x4b5235, E, { roughness: 0.6, metalness: 0.35 });
  const dark = mat(0x222320, E, { roughness: 0.5, metalness: 0.5 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.75, 0.7), olive); body.position.y = 0.48;
  const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 1.1, 18), olive); tank.rotation.z = Math.PI / 2; tank.position.set(0, 1.0, 0);
  const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.6, 12), dark); pipe.position.set(0.5, 1.1, -0.2);
  const skid = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.1, 0.8), dark); skid.position.y = 0.05;
  g.add(body, tank, pipe, skid);
  return g;
}

const HAND = 'Neucha, cursive';
const SANS = '"PT Sans Narrow", "Arial Narrow", sans-serif';

/** Дитячий малюнок кольоровими олівцями (A4 альбомний лист): коридор із лампами, людина в касці з камерою. */
function drawingCanvas(i: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 362;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  g.fillStyle = '#ece4cf'; g.fillRect(0, 0, 512, 362);
  let s = 77 + i * 31;
  const r = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  // штрих олівця: кілька тремтячих проходів
  const stroke = (pts: [number, number][], col: string, w: number, n = 3) => {
    g.strokeStyle = col; g.lineCap = 'round'; g.lineJoin = 'round';
    for (let k = 0; k < n; k++) {
      g.lineWidth = w * (0.6 + r() * 0.6); g.globalAlpha = 0.45 + r() * 0.35;
      g.beginPath();
      pts.forEach(([x, y], j) => { const jx = x + (r() - 0.5) * 4, jy = y + (r() - 0.5) * 4; if (j) g.lineTo(jx, jy); else g.moveTo(jx, jy); });
      g.stroke();
    }
    g.globalAlpha = 1;
  };
  const scribble = (x0: number, y0: number, x1: number, y1: number, col: string, step = 7) => {
    for (let y = y0; y < y1; y += step) stroke([[x0 + r() * 6, y], [x1 - r() * 6, y + step * 0.6]], col, 4, 1);
  };
  // підлога й стеля коридору в перспективі, лампи
  stroke([[0, 300], [512, 300]], '#7a4a22', 5);
  stroke([[0, 70], [512, 70]], '#555', 3);
  for (let k = 0; k < 4; k++) { const x = 60 + k * 120; scribble(x, 72, x + 50, 86, '#e6c22a', 5); }
  if (i === 2) scribble(0, 90, 512, 300, '#c8282a', 11); // «усё червоне»
  // людина в касці з камерою
  const px = i === 1 ? 300 : 170, py = 300;
  if (i === 1) {
    // лежить
    stroke([[px - 90, py - 14], [px + 40, py - 14]], '#2b4f9a', 9);
    stroke([[px + 40, py - 14], [px + 70, py - 20]], '#d9a07a', 14);
    scribble(px + 58, py - 44, px + 92, py - 26, '#e0c020', 6);
    // над ним — висока біла фігура з широкою усмішкою
    stroke([[px - 10, py - 30], [px - 10, py - 220]], '#bbb', 26);
    stroke([[px - 30, py - 245], [px + 10, py - 245]], '#ddd', 40);
    stroke([[px - 38, py - 238], [px - 22, py - 226], [px - 2, py - 224], [px + 14, py - 228], [px + 22, py - 240]], '#a01818', 4);
    stroke([[px - 60, py - 190], [px - 10, py - 200], [px + 40, py - 150]], '#bbb', 8);
  } else {
    stroke([[px, py], [px - 18, py - 60]], '#2b4f9a', 7); stroke([[px, py], [px + 18, py - 60]], '#2b4f9a', 7);
    scribble(px - 24, py - 140, px + 24, py - 60, '#2b4f9a', 6);
    stroke([[px, py - 160], [px, py - 140]], '#d9a07a', 8);
    g.beginPath(); g.strokeStyle = '#d9a07a'; g.lineWidth = 5; g.arc(px, py - 165, 18, 0, Math.PI * 2); g.stroke();
    scribble(px - 22, py - 192, px + 22, py - 176, '#e0c020', 5); // каска
    stroke([[px + 24, py - 120], [px + 60, py - 130]], '#2b4f9a', 6);
    scribble(px + 56, py - 146, px + 92, py - 122, '#333', 5); // камера
    if (i === 2) for (let k = 0; k < 5; k++) { const x = 290 + k * 34; stroke([[x, 220], [x + 20, 220]], k % 2 ? '#2aa040' : '#e0c020', 9); }
  }
  // підпис
  g.fillStyle = '#3b3fa0'; g.globalAlpha = 0.8;
  g.font = `34px ${HAND}`;
  g.fillText(['ДЯДЯ', 'ДЯДЯ СПИТ', 'ПАПА НА РАБОТЕ'][i % 3] as string, 24, 44);
  g.globalAlpha = 1;
  return c;
}

const drawTex: THREE.CanvasTexture[] = [];
function drawingTexture(i: number): THREE.CanvasTexture {
  let t = drawTex[i];
  if (!t) { t = new THREE.CanvasTexture(drawingCanvas(i)); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; drawTex[i] = t; }
  return t;
}

/** Малюнок, приколотий до стіни кнопкою (лицем уздовж +Z локально). */
export function drawingMesh(E: number, i: number): THREE.Group {
  const g = new THREE.Group();
  const sheet = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.212), mat(0xffffff, E, { map: drawingTexture(i), roughness: 0.9, side: THREE.DoubleSide }));
  sheet.rotation.z = (i - 1) * 0.06;
  const pin = new THREE.Mesh(new THREE.SphereGeometry(0.008, 8, 6), mat(0xc02020, E, { roughness: 0.4 }));
  pin.position.set(0, 0.09, 0.006);
  g.add(sheet, pin);
  return g;
}

/** Стенд «Наши рисунки»: фанера з рамкою, заголовок, три місця для малюнків. Повертає групу й точки місць. */
export function boardMesh(E: number): { obj: THREE.Group; slots: THREE.Vector3[] } {
  const g = new THREE.Group();
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 640;
  const x = c.getContext('2d') as CanvasRenderingContext2D;
  x.fillStyle = '#b98d57'; x.fillRect(0, 0, 1024, 640);
  x.fillStyle = '#6a3f1e'; x.fillRect(0, 0, 1024, 26); x.fillRect(0, 614, 1024, 26); x.fillRect(0, 0, 26, 640); x.fillRect(998, 0, 26, 640);
  x.fillStyle = '#c23a2a'; x.font = `bold 92px ${SANS}`; x.textAlign = 'center';
  x.fillText('НАШИ РИСУНКИ', 512, 130);
  x.fillStyle = '#2d5d9a'; x.font = `40px ${HAND}`;
  x.fillText('группа № 7 «Солнышко»', 512, 190);
  for (let k = 0; k < 3; k++) { x.strokeStyle = 'rgba(80,50,20,0.5)'; x.lineWidth = 4; x.strokeRect(80 + k * 300, 250, 260, 190); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  const board = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.875, 0.03), [mat(0x6a3f1e, E), mat(0x6a3f1e, E), mat(0x6a3f1e, E), mat(0x6a3f1e, E), mat(0xffffff, E, { map: t, roughness: 0.85 }), mat(0x6a3f1e, E)]);
  board.position.z = 0.015;
  g.add(board);
  const slots = [0, 1, 2].map((k) => new THREE.Vector3(-0.47 + k * 0.47, -0.08, 0.034));
  return { obj: g, slots };
}

/** Задвижка: труба з фланцем і червоним маховиком на стіні (крутиться). */
export function valveMesh(E: number): { obj: THREE.Group; wheel: THREE.Object3D } {
  const g = new THREE.Group();
  const steel = mat(0x50544f, E, { roughness: 0.55, metalness: 0.6 });
  const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 2.2, 18), steel);
  pipe.position.set(0, 0, 0.12);
  const flange = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.08, 20), steel);
  flange.position.set(0, 0, 0.12);
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.22, 10), steel);
  stem.rotation.x = Math.PI / 2; stem.position.set(0, 0, 0.26);
  const wheel = new THREE.Group();
  const red = mat(0x9a1c14, E, { roughness: 0.5, metalness: 0.4 });
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.016, 10, 28), red);
  wheel.add(rim);
  for (let k = 0; k < 3; k++) { const sp = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.018, 0.018), red); sp.rotation.z = (k * Math.PI) / 3; wheel.add(sp); }
  wheel.position.set(0, 0, 0.37);
  g.add(pipe, flange, stem, wheel);
  return { obj: g, wheel };
}

/** Пульт насосної: сіра шафа з манометром, сигнальною лампою й чорним рубильником. */
export function pumpPanelMesh(E: number, lamp: THREE.MeshStandardMaterial): { obj: THREE.Group; lever: THREE.Object3D } {
  const g = new THREE.Group();
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.0, 0.3), mat(0x6d7468, E, { roughness: 0.55, metalness: 0.3 }));
  box.position.set(0, 0, 0.15);
  const gauge = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.03, 24), mat(0xe6e0cc, E, { roughness: 0.3 }));
  gauge.rotation.x = Math.PI / 2; gauge.position.set(-0.15, 0.25, 0.31);
  const needle = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.065, 0.004), mat(0x101010, E));
  needle.position.set(-0.15, 0.27, 0.33); needle.rotation.z = 0.9;
  const l = new THREE.Mesh(new THREE.SphereGeometry(0.03, 14, 10), lamp);
  l.position.set(0.18, 0.3, 0.31);
  const lever = new THREE.Group();
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.28, 0.035), mat(0x151515, E, { roughness: 0.4 }));
  arm.position.y = 0.14;
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 8), mat(0x151515, E, { roughness: 0.3 }));
  knob.position.y = 0.28;
  lever.add(arm, knob);
  lever.position.set(0.12, -0.15, 0.33); lever.rotation.x = 0.7;
  g.add(box, gauge, needle, l, lever);
  return { obj: g, lever };
}
