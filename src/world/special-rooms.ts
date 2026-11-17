// Особливі кімнати рівня 0 (Д7): стільці, складені вежею до стелі; телефон на столі, що дзвонить; кімната,
// де на стінах — почерк самого гравця (сюжет: Закулисье пам'ятає його найкраще). Ставляться на шляху до Шва.
import * as THREE from 'three/webgpu';
import type { Assets } from '../assets/loader';
import type { Physics } from '../physics/physics';
import { G } from '../physics/physics';
import type { Level } from './level0';
import { freeNear, lightProp, seamPlacement } from './level0';
import { probeAt, probeLit } from './materials';
import { spotOnPath } from './findings';
import { decorate } from './decor';

export interface Special { id: 'chairs' | 'phone' | 'writing'; x: number; y: number; z: number; /** Для напису — куди дивиться стіна. */ yaw?: number }

const WRITING = [
  ['Я БЫЛ ЗДЕСЬ', 1.0], ['я был здесь', 0.6], ['Я БЫЛ ЗДЕСЬ', 0.8],
  ['смена 25.04 — 01:23', 0.55], ['АЗ-5 нажал не я', 0.7], ['не оборачивайся', 0.5], ['я помню этот гул', 0.55]
] as const;

/** Напис почерком (шрифт-рукопис гри) олівцем-графітом на прозорому тлі — декаль на стіні. */
function writingTexture(lines: (readonly [string, number])[]): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 512;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  g.clearRect(0, 0, c.width, c.height);
  lines.forEach(([text, size], i) => {
    g.save();
    g.translate(60 + (i * 97) % 300, 110 + i * (380 / lines.length));
    g.rotate(((i * 37) % 9 - 4) * 0.02);
    g.font = `${Math.round(96 * size)}px Neucha, cursive`;
    g.fillStyle = 'rgba(28, 24, 20, 0.82)';
    g.fillText(text, 0, 0);
    g.restore();
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export async function placeSpecialRooms(assets: Assets, physics: Physics, lvl: Level, taken: { x: number; z: number }[]): Promise<Special[]> {
  const L = lvl.layout, H = L.height, out: Special[] = [];
  const avoid = lvl.doors.list.map((d) => ({ t: 'door' as const, x: d.cx, y: 0, z: d.cz, yaw: 0, w: d.width + 0.6 }));
  const busy = [...taken, ...Object.values(lvl.spots).map((s) => ({ x: s.x, z: s.z }))];

  // 1) стільці — вежа до стелі посеред кімнати
  {
    const p = spotOnPath(lvl, 0.4, busy);
    const [x, z] = freeNear(L, p.x, p.z, 0.9);
    busy.push({ x, z });
    const chair = (await assets.model('assets/models/chair.glb')).scene;
    const E = probeAt(L.lights, x, z);
    let y = 0;
    for (let k = 0; y < H - 0.5; k++) {
      const o = chair.clone(true);
      const flip = k % 2 === 1;
      o.rotation.set(flip ? Math.PI : 0, k * 1.13, (k % 3 - 1) * 0.06);
      o.position.set(x + Math.sin(k * 2.1) * 0.06, flip ? y + 0.86 : y, z + Math.cos(k * 1.7) * 0.06);
      lightProp(o, E);
      lvl.scene.add(o);
      y += 0.62;
    }
    physics.addBox(x, H / 2, z, 0.3, H / 2, 0.3, 0, G.PROP);
    out.push({ id: 'chairs', x, y: 1.3, z });
  }

  // 2) телефон на столі в порожній кімнаті — дзвонить, поки не знімеш трубку
  {
    const p = spotOnPath(lvl, 0.62, busy);
    const [x, z] = freeNear(L, p.x, p.z, 1.0);
    busy.push({ x, z });
    const desk = (await assets.model('assets/models/desk.glb')).scene.clone(true);
    desk.position.set(x, 0, z); desk.rotation.y = 0.35;
    const E = probeAt(L.lights, x, z);
    lightProp(desk, E);
    lvl.scene.add(desk);
    desk.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(desk);
    const c = bb.getCenter(new THREE.Vector3()), s = bb.getSize(new THREE.Vector3());
    physics.addBox(c.x, c.y, c.z, s.x / 2 - 0.02, s.y / 2, s.z / 2 - 0.02, 0, G.PROP);
    const phone = (await assets.model('assets/models/phone.glb')).scene.clone(true);
    phone.position.set(x + 0.15, bb.max.y + 0.001, z - 0.05); phone.rotation.y = 0.35 + 0.4;
    lightProp(phone, E);
    lvl.scene.add(phone);
    out.push({ id: 'phone', x: phone.position.x, y: bb.max.y + 0.08, z: phone.position.z });
  }

  // 3) кімната з почерком гравця: написи на 3–4 стінах навколо
  {
    // шрифт-рукопис завантажується лише тоді, коли його вперше просять — без цього canvas малює звичайним шрифтом
    try { await document.fonts.load('96px Neucha', 'Я был здесь'); } catch { /* є запасний шрифт */ }
    // напис 1.7 м завширшки: не ближче 1.2 м до дверей (не налазить на раму)
    // усі прорізи (і порожні рами без полотна) — з планування рівня
    const avoidWide = decorate(L).filter((d) => d.t === 'door' || d.t === 'panel').map((d) => ({ ...d, w: d.w + 2.2 }));
    const faces: { x: number; z: number; yaw: number }[] = [];
    // увесь напис (1.7 м) має лягти на вільний відрізок стіни: зсунути від країв, відкинути, якщо заважає сусідня стіна
    const fitOnWall = (f: { x: number; z: number; yaw: number }) => {
      const ux = Math.cos(f.yaw), uz = -Math.sin(f.yaw), nx = Math.sin(f.yaw), nz = Math.cos(f.yaw);
      const base = L.walls.find((w) => Math.abs(f.x - nx * 0.05 - w.x) <= w.w / 2 + 0.01 && Math.abs(f.z - nz * 0.05 - w.z) <= w.d / 2 + 0.01);
      if (!base) return null;
      const along = Math.abs(ux) > 0.5 ? [base.x - base.w / 2 + 0.95, base.x + base.w / 2 - 0.95] : [base.z - base.d / 2 + 0.95, base.z + base.d / 2 - 0.95];
      if ((along[0] as number) > (along[1] as number)) return null;
      const g = { ...f };
      if (Math.abs(ux) > 0.5) g.x = Math.min(along[1] as number, Math.max(along[0] as number, f.x)); else g.z = Math.min(along[1] as number, Math.max(along[0] as number, f.z));
      // перед написом (до 0.8 м) — жодної стіни чи колони: інакше його частина ховається в ніші
      for (const depth of [0.12, 0.4, 0.8]) for (let t = -0.95; t <= 0.95; t += 0.1) {
        const px = g.x + ux * t + nx * depth, pz = g.z + uz * t + nz * depth;
        if (L.walls.some((w) => w !== base && Math.abs(px - w.x) < w.w / 2 + 0.02 && Math.abs(pz - w.z) < w.d / 2 + 0.02)) return null;
      }
      return g;
    };
    // місце на шляху, де навколо знайдеться хоча б дві довгі вільні стіни
    let p = spotOnPath(lvl, 0.82, busy);
    for (const frac of [0.82, 0.78, 0.86, 0.74, 0.9, 0.7, 0.66]) {
      p = spotOnPath(lvl, frac, busy);
      faces.length = 0;
      for (let k = 0; k < 12; k++) for (const r of [2.0, 3.2]) {
        const a = (k / 12) * Math.PI * 2;
        const f = fitOnWall(seamPlacement(L, p.x + Math.cos(a) * r, p.z + Math.sin(a) * r, avoidWide));
        if (f && Math.hypot(f.x - p.x, f.z - p.z) < 5 && !faces.some((q) => Math.hypot(q.x - f.x, q.z - f.z) < 1.8)) faces.push(f);
      }
      if (faces.length >= 2) break;
    }
    busy.push(p);
    faces.slice(0, 4).forEach((f, i) => {
      const lines = WRITING.filter((_, k) => (k + i) % 2 === 0 || k === 0).slice(0, 4 - (i % 2));
      const m = probeLit(new THREE.MeshStandardMaterial({ map: writingTexture(lines), transparent: true, roughness: 0.9, depthWrite: false }), probeAt(L.lights, f.x, f.z));
      m.polygonOffset = true; m.polygonOffsetFactor = -2;
      const q = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.85), m);
      q.position.set(f.x + Math.sin(f.yaw) * 0.006, 1.45 - (i % 2) * 0.25, f.z + Math.cos(f.yaw) * 0.006);
      q.rotation.y = f.yaw;
      lvl.scene.add(q);
      if (i === 0) out.push({ id: 'writing', x: q.position.x, y: q.position.y, z: q.position.z, yaw: f.yaw });
    });
  }
  return out;
}
