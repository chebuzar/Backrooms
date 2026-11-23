// Двері в рамах кіту: фарбована фанера на завісах, відчиняються/зачиняються (E), з тілом для зіткнень і рипом.
// Усі полотна рівня — один InstancedMesh, усі ручки — другий (2 виклики малювання замість ~2 на кожні двері);
// освітленість кожних дверей — атрибут екземпляра.
// Частина зачинена, частина прочинена — у Закулиссі двері ніхто не зачиняв роками (або хтось щойно відчинив).
import * as THREE from 'three/webgpu';
import { instancedBufferAttribute } from 'three/tsl';
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
  /** Точки з обох боків прорізу (центр прорізу ± 0.22 м). */
  sides: [number, number, number][];
  /** Центр полотна зараз (рухається разом із ним) — ціль погляду для «Открыть/Закрыть». */
  cx: number;
  cz: number;
  /** Номер екземпляра в InstancedMesh полотен/ручок. */
  index: number;
}

/** Як рука веде двері: обережно (присівши — повільно, ледь чутно), звичайно, різко (на бігу — грюкає). */
export type DoorForce = 'quiet' | 'normal' | 'slam';

export class Doors {
  readonly group = new THREE.Group();
  readonly list: Door[] = [];
  /** Викликається, коли двері рушили (для звуку): куди й з якою силою (тихо — присівши, різко — на бігу). */
  onMove: ((d: Door, opening: boolean, force: DoorForce) => void) | null = null;
  /** Полотно стало в раму (глухий стук; обережно — ледь клацнуло, різко — грюкнуло). */
  onShut: ((d: Door, force: DoorForce) => void) | null = null;
  /** Двері вибили (удар, полотно відлітає до стіни). */
  onBash: ((d: Door, by: 'monster' | 'player') => void) | null = null;
  /** Двері, що зараз відлітають після удару (швидкий рух). */
  private readonly fast = new Set<Door>();
  /** Двері, які ведуть обережно (повільно, без рипу). */
  private readonly slow = new Set<Door>();

  /** Полотна й ручки всіх дверей (по екземпляру на двері). */
  private leaves: THREE.InstancedMesh | null = null;
  private knobs: THREE.InstancedMesh | null = null;
  private readonly tmp = new THREE.Matrix4();
  private readonly leafLocal = new THREE.Matrix4();
  private readonly knobLocal = new THREE.Matrix4();

  constructor(l: Layout, decor: Decor[], private readonly physics: Physics, tex: { door_c: THREE.Texture; door_n: THREE.Texture }, look: { color?: number; roughness?: number } = {}) {
    const r = rng(l.seed ^ 0xd00f);
    // стара фарбована фанера (справжня текстура ambientCG, перефарбована у вицвілий кремовий)
    const paint = new THREE.MeshStandardMaterial({ map: tex.door_c, normalMap: tex.door_n, color: look.color ?? 0xffffff, roughness: look.roughness ?? 0.66 });
    const metal = new THREE.MeshStandardMaterial({ color: 0x8a8578, roughness: 0.35, metalness: 0.8 });
    const all: { d: Decor; k: number; w: number; E: number; hingeNeg: boolean; roll: number; extra: number; dir: number }[] = [];
    decor.filter((d) => d.t === 'door').forEach((d, k) => {
      if (r() > 0.55) return; // решта прорізів — порожні рами
      const hingeNeg = r() < 0.5;
      const roll = r();
      const extra = roll >= 0.45 && roll < 0.8 ? r() : 0;
      const dir = r() < 0.5 ? 1 : -1;
      all.push({ d, k, w: d.w - 0.02, E: probeAt(l.lights, d.x, d.z), hingeNeg, roll, extra, dir });
    });
    const n = all.length;
    if (!n) return;
    const w = all[0]!.w; // усі прорізи в одну клітинку — однакові
    const geo = new THREE.BoxGeometry(w, DOOR_H - 0.03, 0.04);
    const uvA = geo.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uvA.count; i++) uvA.setY(i, uvA.getY(i) * 2); // полотно 1×2 м: текстура без розтягування
    const Es = new THREE.InstancedBufferAttribute(new Float32Array(all.map((a) => a.E)), 1);
    const E = instancedBufferAttribute(Es) as unknown as THREE.Node<'float'>;
    this.leaves = new THREE.InstancedMesh(geo, probeLit(paint, E), n);
    this.knobs = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.025, 0.025, 0.12, 12), probeLit(metal, E), n);
    this.leafLocal.makeTranslation(w / 2, (DOOR_H - 0.03) / 2 + 0.01, 0);
    this.knobLocal.makeTranslation(w - 0.08, 1.0, 0).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2));
    for (const m of [this.leaves, this.knobs]) {
      m.castShadow = true; m.receiveShadow = true;
      m.frustumCulled = false; // двері розкидані по всьому рівню: два виклики на всі
      this.group.add(m);
    }
    all.forEach((a, i) => {
      const { d } = a;
      const horiz = Math.abs(Math.sin(d.yaw)) < 0.5;
      const baseYaw = horiz ? (a.hingeNeg ? 0 : Math.PI) : (a.hingeNeg ? -Math.PI / 2 : Math.PI / 2);
      const hx = horiz ? d.x + (a.hingeNeg ? -1 : 1) * d.w / 2 : d.x, hz = horiz ? d.z : d.z + (a.hingeNeg ? -1 : 1) * d.w / 2;
      const pivot = new THREE.Object3D();
      pivot.position.set(hx, 0, hz);
      const angle = a.roll < 0.45 ? 0 : a.roll < 0.8 ? 0.25 + a.extra * 0.5 : 1.45;
      const collider = physics.addBox(0, 0, 0, a.w / 2, (DOOR_H - 0.03) / 2, 0.02, 0, G.DOOR);
      const nx = horiz ? 0 : 1, nz = horiz ? 1 : 0;
      const door: Door = {
        id: `door${a.k}`, pivot, collider, angle, target: angle, dir: a.dir, width: a.w, baseYaw, cx: d.x, cz: d.z, index: i,
        sides: [[d.x + nx * 0.22, 1.05, d.z + nz * 0.22], [d.x - nx * 0.22, 1.05, d.z - nz * 0.22]]
      };
      this.apply(door);
      this.list.push(door);
    });
  }

  /** Вибити зачинені двері: різкий удар, полотно влітає в стіну (без рипу — грюкіт). Гравець — плечем на бігу. */
  bash(d: Door, by: 'monster' | 'player' = 'monster'): void {
    if (d.target > 0.1) return;
    d.target = by === 'player' ? 1.45 : 1.6;
    this.fast.add(d);
    this.onBash?.(d, by);
  }

  /** Зачинити різко (протяг/«хтось»): полотно грюкає об раму. */
  slamShut(d: Door): void {
    if (d.target <= 0.1) return;
    d.target = 0;
    this.fast.add(d);
    this.onMove?.(d, false, 'slam');
  }

  /** Тихо поставити полотно в інше положення (поки ніхто не дивиться): без рипу й руху. */
  setSilently(d: Door, angle: number): void {
    d.angle = angle; d.target = angle;
    this.fast.delete(d);
    this.apply(d);
  }

  /** Відчинити/зачинити рукою з різною силою. */
  toggle(d: Door, force: DoorForce = 'normal'): void {
    d.target = d.target > 0.1 ? 0 : force === 'slam' ? 1.6 : 1.5;
    this.fast.delete(d); this.slow.delete(d);
    if (force === 'slam') this.fast.add(d);
    if (force === 'quiet') this.slow.add(d);
    this.onMove?.(d, d.target > 0, force);
  }

  private apply(d: Door): void {
    const yaw = d.baseYaw + d.angle * d.dir;
    d.pivot.rotation.y = yaw;
    // центр полотна у світі: від завіси вздовж локальної X на половину ширини
    const cx = d.pivot.position.x + Math.cos(yaw) * d.width / 2, cz = d.pivot.position.z - Math.sin(yaw) * d.width / 2;
    d.cx = cx; d.cz = cz;
    d.collider.setTranslation({ x: cx, y: (DOOR_H - 0.03) / 2 + 0.01, z: cz });
    const s = Math.sin(yaw / 2), c = Math.cos(yaw / 2);
    d.collider.setRotation({ x: 0, y: s, z: 0, w: c });
    if (this.leaves && this.knobs) {
      d.pivot.updateMatrix();
      this.leaves.setMatrixAt(d.index, this.tmp.multiplyMatrices(d.pivot.matrix, this.leafLocal));
      this.knobs.setMatrixAt(d.index, this.tmp.multiplyMatrices(d.pivot.matrix, this.knobLocal));
      this.leaves.instanceMatrix.needsUpdate = true;
      this.knobs.instanceMatrix.needsUpdate = true;
    }
  }

  update(dt: number): void {
    for (const d of this.list) {
      if (Math.abs(d.target - d.angle) < 1e-3) continue;
      // важке полотно: розгін і гальмування, без стрибків
      const fast = this.fast.has(d), slow = this.slow.has(d);
      const step = (d.target - d.angle) * Math.min(1, dt * (fast ? 14 : slow ? 1.6 : 3.2));
      d.angle += Math.sign(step) * Math.min(Math.abs(step), dt * (fast ? 9 : slow ? 0.7 : 1.9));
      if (fast && Math.abs(d.target - d.angle) < 0.02) this.fast.delete(d);
      if (slow && Math.abs(d.target - d.angle) < 0.01) this.slow.delete(d);
      if (d.target === 0 && d.angle < 0.02) { d.angle = 0; this.slow.delete(d); this.onShut?.(d, slow ? 'quiet' : fast ? 'slam' : 'normal'); }
      this.apply(d);
    }
  }
}
