// Взаємодія: предмет «підсвічується» підказкою, коли гравець дивиться на нього зблизька й між ними немає стіни.
// Щоб не «цілитися пікселем»: допуск ~25° від центру погляду, дальність рахується вздовж підлоги (низький ящик
// чи стіл не «далі», ніж на рівні очей), а високі предмети (двері) ловляться будь-де по висоті полотна.
import type * as THREE from 'three/webgpu';
import type { Physics } from '../physics/physics';

export interface Interactable {
  id: string;
  x: number; y: number; z: number;
  /** Наскільки близько треба підійти (м, уздовж підлоги). */
  reach: number;
  /** Високий предмет (полотно дверей): вертикальний відрізок y ± halfHeight — ціль у ньому найближча до погляду. */
  halfHeight?: number;
  prompt: string;
  enabled: boolean;
  use(): void;
}

/** cos 25°: наскільки далеко від центру погляду ще «бачимо» предмет. */
const MIN_COS = 0.906;
/** Скільки різниці висот «безкоштовно» (предмет на підлозі чи столі не вважається далеким). */
const FREE_DY = 0.9;

export class Interactions {
  readonly items: Interactable[] = [];
  current: Interactable | null = null;

  constructor(private readonly physics: Physics) {}

  add(i: Interactable): Interactable { this.items.push(i); return i; }
  remove(id: string): void { const k = this.items.findIndex((i) => i.id === id); if (k >= 0) this.items.splice(k, 1); }

  /** Знайти предмет під поглядом. */
  update(camera: THREE.PerspectiveCamera, dirX: number, dirY: number, dirZ: number): Interactable | null {
    const p = camera.position;
    const hd2 = dirX * dirX + dirZ * dirZ;
    let best: Interactable | null = null, bestScore = MIN_COS;
    for (const it of this.items) {
      if (!it.enabled) continue;
      const dx = it.x - p.x, dz = it.z - p.z;
      let ty = it.y;
      if (it.halfHeight && hd2 > 1e-6) {
        // точка на вертикалі предмета, найближча до променя погляду
        const t = Math.max(0, (dx * dirX + dz * dirZ) / hd2);
        ty = Math.min(it.y + it.halfHeight, Math.max(it.y - it.halfHeight, p.y + dirY * t));
      }
      const dy = ty - p.y;
      const reachD = Math.hypot(dx, dz, Math.max(0, Math.abs(dy) - FREE_DY));
      if (reachD > it.reach) continue;
      const d = Math.hypot(dx, dy, dz);
      if (d < 1e-3) continue;
      // що ближче, то більший допустимий кут
      const score = (dx * dirX + dy * dirY + dz * dirZ) / d + Math.max(0, 0.6 - d) * 0.08;
      if (score > bestScore && this.physics.lineOfSight(p.x, p.y, p.z, it.x, ty, it.z)) { best = it; bestScore = score; }
    }
    this.current = best;
    return best;
  }
}
