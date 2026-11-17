// Двері в рамах кіту: фарбована фанера на завісах, відчиняються/зачиняються (E), з тілом для зіткнень і рипом.
// Частина зачинена, частина прочинена — у Закулиссі двері ніхто не зачиняв роками (або хтось щойно відчинив).
import * as THREE from 'three/webgpu';
import type RAPIER from '@dimforge/rapier3d-compat';
import { rng } from '../core/rng';
import { G, type Physics } from '../physics/physics';
import type { Layout } from './layout';
import type { Decor } from './decor';
import { DOOR_H } from './decor';
import { probeAt, probeLit } from './materials';

export interface Door {
  id: string;
  pivot: THREE.Object3D;
  collider: RAPIER.Collider;
  /** Кут зараз і цільовий (рад, 0 — зачинено). */
  angle: number;
  target: number;
  /** Знак відчинення (у який бік) і довжина полотна. */
  dir: number;
  width: number;
  baseYaw: number;
  /** Точки взаємодії з обох боків прорізу. */
  sides: [number, number, number][];
}

export class Doors {
  readonly group = new THREE.Group();
  readonly list: Door[] = [];
  /** Викликається, коли двері рушили (для звуку): позиція й швидкість. */
  onMove: ((d: Door, opening: boolean) => void) | null = null;
  /** Полотно стало в раму (глухий стук). */
  onShut: ((d: Door) => void) | null = null;

  constructor(l: Layout, decor: Decor[], private readonly physics: Physics, tex: { door_c: THREE.Texture; door_n: THREE.Texture }) {
    const r = rng(l.seed ^ 0xd00f);
    // стара фарбована фанера (справжня текстура ambientCG, перефарбована у вицвілий кремовий)
    const paint = new THREE.MeshStandardMaterial({ map: tex.door_c, normalMap: tex.door_n, roughness: 0.66 });
    const metal = new THREE.MeshStandardMaterial({ color: 0x8a8578, roughness: 0.35, metalness: 0.8 });
    decor.filter((d) => d.t === 'door').forEach((d, k) => {
      if (r() > 0.55) return; // решта прорізів — порожні рами
      const w = d.w - 0.02, horiz = Math.abs(Math.sin(d.yaw)) < 0.5;
      const hingeNeg = r() < 0.5;
      const baseYaw = horiz ? (hingeNeg ? 0 : Math.PI) : (hingeNeg ? -Math.PI / 2 : Math.PI / 2);
      const hx = horiz ? d.x + (hingeNeg ? -1 : 1) * d.w / 2 : d.x, hz = horiz ? d.z : d.z + (hingeNeg ? -1 : 1) * d.w / 2;
      const pivot = new THREE.Object3D();
      pivot.position.set(hx, 0, hz);
      const E = probeAt(l.lights, d.x, d.z);
      const geo = new THREE.BoxGeometry(w, DOOR_H - 0.03, 0.04);
      const uvA = geo.attributes.uv as THREE.BufferAttribute;
      for (let i = 0; i < uvA.count; i++) uvA.setY(i, uvA.getY(i) * 2); // полотно 1×2 м: текстура без розтягування
      const leaf = new THREE.Mesh(geo, probeLit(paint, E));
      leaf.position.set(w / 2, (DOOR_H - 0.03) / 2 + 0.01, 0);
      leaf.castShadow = true; leaf.receiveShadow = true;
      const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.12, 12), probeLit(metal, E));
      knob.rotation.x = Math.PI / 2;
      knob.position.set(w - 0.08, 1.0, 0);
      pivot.add(leaf, knob);
      this.group.add(pivot);
      const roll = r();
      const angle = roll < 0.45 ? 0 : roll < 0.8 ? 0.25 + r() * 0.5 : 1.45;
      const dir = r() < 0.5 ? 1 : -1;
      const collider = physics.addBox(0, 0, 0, w / 2, (DOOR_H - 0.03) / 2, 0.02, 0, G.DOOR);
      const nx = horiz ? 0 : 1, nz = horiz ? 1 : 0;
      const door: Door = {
        id: `door${k}`, pivot, collider, angle, target: angle, dir, width: w, baseYaw,
        sides: [[d.x + nx * 0.22, 1.05, d.z + nz * 0.22], [d.x - nx * 0.22, 1.05, d.z - nz * 0.22]]
      };
      this.apply(door);
      this.list.push(door);
    });
  }

  /** Відчинити/зачинити. */
  toggle(d: Door): void {
    d.target = d.target > 0.1 ? 0 : 1.5;
    this.onMove?.(d, d.target > 0);
  }

  private apply(d: Door): void {
    const yaw = d.baseYaw + d.angle * d.dir;
    d.pivot.rotation.y = yaw;
    // центр полотна у світі: від завіси вздовж локальної X на половину ширини
    const cx = d.pivot.position.x + Math.cos(yaw) * d.width / 2, cz = d.pivot.position.z - Math.sin(yaw) * d.width / 2;
    d.collider.setTranslation({ x: cx, y: (DOOR_H - 0.03) / 2 + 0.01, z: cz });
    const s = Math.sin(yaw / 2), c = Math.cos(yaw / 2);
    d.collider.setRotation({ x: 0, y: s, z: 0, w: c });
  }

  update(dt: number): void {
    for (const d of this.list) {
      if (Math.abs(d.target - d.angle) < 1e-3) continue;
      // важке полотно: розгін і гальмування, без стрибків
      const step = (d.target - d.angle) * Math.min(1, dt * 3.2);
      d.angle += Math.sign(step) * Math.min(Math.abs(step), dt * 1.9);
      if (d.target === 0 && d.angle < 0.02) { d.angle = 0; this.onShut?.(d); }
      this.apply(d);
    }
  }
}
