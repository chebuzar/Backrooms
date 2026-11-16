// Взаємодія: предмет «підсвічується» підказкою, коли гравець дивиться на нього зблизька й між ними немає стіни.
import type * as THREE from 'three/webgpu';
import type { Physics } from '../physics/physics';

export interface Interactable {
  id: string;
  x: number; y: number; z: number;
  /** Наскільки близько треба підійти (м). */
  reach: number;
  prompt: string;
  enabled: boolean;
  use(): void;
}

export class Interactions {
  readonly items: Interactable[] = [];
  current: Interactable | null = null;

  constructor(private readonly physics: Physics) {}

  add(i: Interactable): Interactable { this.items.push(i); return i; }
  remove(id: string): void { const k = this.items.findIndex((i) => i.id === id); if (k >= 0) this.items.splice(k, 1); }

  /** Знайти предмет під поглядом. */
  update(camera: THREE.PerspectiveCamera, dirX: number, dirY: number, dirZ: number): Interactable | null {
    const p = camera.position;
    let best: Interactable | null = null, bestScore = 0.965; // ≈ 15° від центру погляду
    for (const it of this.items) {
      if (!it.enabled) continue;
      const dx = it.x - p.x, dy = it.y - p.y, dz = it.z - p.z;
      const d = Math.hypot(dx, dy, dz);
      if (d > it.reach || d < 1e-3) continue;
      // що ближче, то більший допустимий кут
      const score = (dx * dirX + dy * dirY + dz * dirZ) / d + Math.max(0, 0.6 - d) * 0.08;
      if (score > bestScore && this.physics.lineOfSight(p.x, p.y, p.z, it.x, it.y, it.z)) { best = it; bestScore = score; }
    }
    this.current = best;
    return best;
  }
}
