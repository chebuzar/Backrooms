// Батарейки для ліхтарика: 2–3 на рівень, поруч із сюжетними точками (документ, записка, Шов, розлом) — гравець
// знаходить їх, коли йде туди, куди й так веде історія. Підібрані (id у збереженні) більше не з'являються.
import * as THREE from 'three/webgpu';
import type { Assets } from '../assets/loader';
import type { Level } from './level0';
import { freeNear, lightProp } from './level0';
import { probeAt } from './materials';

export interface Pickup { id: string; x: number; y: number; z: number; obj: THREE.Object3D }

/** Точки рівня, біля яких лежать батарейки (детерміновано з планування). */
export function batterySpots(lvl: Level): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [];
  const doc = Object.values(lvl.spots).find((s) => s.id !== 'note1');
  if (doc) out.push({ x: doc.x + 0.9, z: doc.z - 0.7 });
  const note = lvl.spots.note1;
  if (note) out.push({ x: note.x - 0.8, z: note.z + 0.6 });
  // перед Швом далі: остання знахідка перед переходом
  const s = lvl.seam.group;
  out.push({ x: s.position.x + Math.sin(s.rotation.y) * 1.6 + Math.cos(s.rotation.y) * 0.9, z: s.position.z + Math.cos(s.rotation.y) * 1.6 - Math.sin(s.rotation.y) * 0.9 });
  // прихований розлом у темряві — нагорода тому, хто дійшов із ліхтариком
  if (lvl.rift) { const r = lvl.rift.group; out.push({ x: r.position.x + Math.sin(r.rotation.y) * 1.3, z: r.position.z + Math.cos(r.rotation.y) * 1.3 }); }
  return out.slice(0, 3);
}

export async function placeBatteries(assets: Assets, lvl: Level, taken: readonly string[]): Promise<Pickup[]> {
  const gl = await assets.model('assets/models/battery.glb');
  const out: Pickup[] = [];
  batterySpots(lvl).forEach((p, k) => {
    const id = `bat${lvl.id}-${k}`;
    if (taken.includes(id)) return;
    const [x, z] = freeNear(lvl.layout, p.x, p.z, 0.35);
    const o = gl.scene.clone(true);
    o.position.set(x, 0.002, z);
    o.rotation.y = (k * 2.3 + lvl.id) % 6.28;
    lightProp(o, probeAt(lvl.layout.lights, x, z));
    lvl.scene.add(o);
    out.push({ id, x, y: 0.05, z, obj: o });
  });
  return out;
}
