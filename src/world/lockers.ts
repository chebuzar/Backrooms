// Шафки роздягальні на базі «Глубина-1» (рівень 1): пара сталевих шафок біля стіни на шляху до Шва.
// У ліву можна сховатися (E): гравець дивиться крізь жалюзі; мисливець не бачить і не чує схованого —
// якщо не бачив, як той ховався.
import * as THREE from 'three/webgpu';
import type { Assets } from '../assets/loader';
import type { Physics } from '../physics/physics';
import { G } from '../physics/physics';
import type { Level } from './level0';
import { lightProp, seamPlacement } from './level0';
import { probeAt } from './materials';
import { spotOnPath } from './findings';

export interface Locker {
  id: string;
  /** Центр пари шафок на підлозі й поворот (нормаль стіни, куди дивляться дверцята). */
  x: number; z: number; yaw: number;
  /** Точка очей усередині лівої шафки (за жалюзі) і ціль погляду для «Спрятаться» (центр дверцят). */
  eye: THREE.Vector3;
  door: THREE.Vector3;
}

const W = 1.0, D = 0.53, H = 1.85;

export async function placeLockers(assets: Assets, physics: Physics, lvl: Level, fracs: number[]): Promise<Locker[]> {
  const gl = await assets.model('assets/models/locker.glb');
  const L = lvl.layout;
  const taken = Object.values(lvl.spots).map((s) => ({ x: s.x, z: s.z }));
  taken.push({ x: L.spawn.x, z: L.spawn.z }, { x: lvl.seam.group.position.x, z: lvl.seam.group.position.z });
  const avoid = lvl.doors.list.map((d) => ({ t: 'door' as const, x: d.cx, y: 0, z: d.cz, yaw: 0, w: d.width + 0.6 }));
  // чи вільне місце під шафки (окрім стіни, до якої вони притулені)
  const fits = (cx: number, cz: number, yaw: number) => {
    const ux = Math.cos(yaw), uz = -Math.sin(yaw), nx = Math.sin(yaw), nz = Math.cos(yaw);
    for (const a of [-0.5, 0, 0.5]) for (const b of [0.05, 0.27, 0.5]) {
      const px = cx + ux * a * W + nx * (b - D / 2), pz = cz + uz * a * W + nz * (b - D / 2);
      if (L.walls.some((w) => Math.abs(px - w.x) < w.w / 2 + 0.02 && Math.abs(pz - w.z) < w.d / 2 + 0.02)) return false;
    }
    return true;
  };
  const out: Locker[] = [];
  for (const [k, f0] of fracs.entries()) {
    for (let tries = 0; tries < 30; tries++) {
      const p = spotOnPath(lvl, Math.min(0.95, f0 + tries * 0.012), taken);
      const s = seamPlacement(L, p.x, p.z, avoid);
      const nx = Math.sin(s.yaw), nz = Math.cos(s.yaw);
      const cx = s.x + nx * (D / 2 + 0.005), cz = s.z + nz * (D / 2 + 0.005);
      if (!fits(cx, cz, s.yaw)) continue;
      if (probeAt(L.lights, cx, cz) < 0.45) continue; // у світлі: шафку видно здалеку, з неї видно кімнату
      taken.push({ x: cx, z: cz });
      const o = gl.scene.clone(true);
      o.position.set(cx, 0, cz);
      o.rotation.y = s.yaw;
      lightProp(o, probeAt(L.lights, cx, cz));
      lvl.scene.add(o);
      physics.addBox(cx, H / 2, cz, W / 2, H / 2, D / 2, s.yaw, G.PROP);
      const local = (lx: number, ly: number, lz: number) => new THREE.Vector3(lx, ly, lz).applyAxisAngle(new THREE.Vector3(0, 1, 0), s.yaw).add(new THREE.Vector3(cx, 0, cz));
      out.push({ id: `locker${k}`, x: cx, z: cz, yaw: s.yaw, eye: local(-0.25, 1.56, 0.12), door: local(-0.25, 1.1, D / 2 + 0.01) });
      break;
    }
  }
  physics.step();
  return out;
}
