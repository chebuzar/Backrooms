// Знахідки рівня: записки людей попередніх експедицій і магнітофони з плівками Савельєва. Ставляться на шляху від старту
// до Шва (частка відстані — у story/ru.ts FINDINGS), за тією ж картою відстаней, що й решта сюжетних точок.
import * as THREE from 'three/webgpu';
import type { Assets } from '../assets/loader';
import type { Level } from './level0';
import { freeNear, lightProp } from './level0';
import { probeAt, probeLit } from './materials';

export interface Finding { id: string; kind: 'note' | 'tape'; x: number; y: number; z: number; obj: THREE.Object3D }

/** Клітинка на частці frac найкоротшого шляху від старту, не ближче 7 м до вже зайнятих точок. */
export function spotOnPath(lvl: Level, frac: number, taken: { x: number; z: number }[]): { x: number; z: number } {
  const L = lvl.layout;
  let far = 0;
  for (const v of L.dist) far = Math.max(far, v);
  const ok = (x: number, z: number) => taken.every((t) => Math.hypot(t.x - x, t.z - z) > 7);
  for (let spread = 0; spread < 40; spread++) {
    for (const target of [Math.floor(far * frac) + spread, Math.floor(far * frac) - spread]) {
      for (let c = 0; c < L.dist.length; c++) {
        if (L.dist[c] !== target) continue;
        const x = ((c % L.cols) + 0.5) * L.cell, z = (Math.floor(c / L.cols) + 0.5) * L.cell;
        if (ok(x, z)) return { x, z };
      }
    }
  }
  return { x: L.spawn.x, z: L.spawn.z };
}

export async function placeFindings(assets: Assets, lvl: Level, defs: { id: string; kind: 'note' | 'tape'; at: number }[]): Promise<Finding[]> {
  const taken = Object.values(lvl.spots).map((s) => ({ x: s.x, z: s.z }));
  const s = lvl.seam.group.position;
  taken.push({ x: s.x, z: s.z }, { x: lvl.layout.spawn.x, z: lvl.layout.spawn.z });
  const tape = defs.some((d) => d.kind === 'tape') ? await assets.model('assets/models/tape.glb') : null;
  const out: Finding[] = [];
  defs.forEach((d, k) => {
    const p = spotOnPath(lvl, d.at, taken);
    const [x, z] = freeNear(lvl.layout, p.x + 0.4, p.z - 0.3, 0.45);
    taken.push({ x, z });
    const E = probeAt(lvl.layout.lights, x, z);
    if (d.kind === 'note') {
      // аркуш на підлозі, як і перша записка рівня 0
      const paper = new THREE.Mesh(new THREE.PlaneGeometry(0.21, 0.297), probeLit(new THREE.MeshStandardMaterial({ color: 0xd6d0b8, roughness: 0.95 }), E));
      paper.rotation.set(-Math.PI / 2, 0, 0.4 + k * 1.3);
      paper.position.set(x, 0.004, z);
      paper.receiveShadow = true;
      lvl.scene.add(paper);
      out.push({ id: d.id, kind: 'note', x, y: 0.02, z, obj: paper });
    } else if (tape) {
      // магнітофон лежить на підлозі, касета поруч
      const o = tape.scene.clone(true);
      o.rotation.set(-Math.PI / 2, 0, 0.7 + k);
      o.position.set(x, 0.022, z);
      lightProp(o, E);
      lvl.scene.add(o);
      out.push({ id: d.id, kind: 'tape', x, y: 0.05, z, obj: o });
    }
  });
  return out;
}
