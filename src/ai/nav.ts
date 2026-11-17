// Навігація монстрів: navmesh (recast) з планування рівня. Монстри ходять лише там, де пройде тіло,
// обходять стіни й колони, шукають шлях і випадкові точки для патрулю/пошуку.
import { init, NavMeshQuery, type NavMesh } from 'recast-navigation';
import { generateSoloNavMesh } from 'recast-navigation/generators';
import type { Layout } from '../world/layout';

export interface V3 { x: number; y: number; z: number }

/** Те, що потрібно ШІ від навігації (у тестах — підміна). */
export interface NavLike {
  path(from: V3, to: V3): V3[];
  closest(p: V3): V3;
  randomAround(p: V3, radius: number): V3;
  /** Довжина шляху (для оцінки «чутності крізь стіни»). */
  pathLength(from: V3, to: V3): number;
}

let ready: Promise<void> | null = null;

export class Nav implements NavLike {
  private constructor(readonly navMesh: NavMesh, private readonly query: NavMeshQuery) {}

  /** Побудувати navmesh: підлога + стіни-перешкоди. agentRadius — «товщина» монстра. */
  static async fromLayout(l: Layout, agentRadius = 0.35, agentHeight = 1.9): Promise<Nav> {
    ready ??= init();
    await ready;
    const pos: number[] = [], idx: number[] = [];
    const quad = (a: number[], b: number[], c: number[], d: number[]) => {
      const i = pos.length / 3;
      pos.push(...a, ...b, ...c, ...d);
      idx.push(i, i + 1, i + 2, i, i + 2, i + 3);
    };
    const W = l.cols * l.cell, D = l.rows * l.cell, H = l.height;
    quad([0, 0, 0], [0, 0, D], [W, 0, D], [W, 0, 0]);
    for (const w of l.walls) {
      const x0 = w.x - w.w / 2, x1 = w.x + w.w / 2, z0 = w.z - w.d / 2, z1 = w.z + w.d / 2;
      quad([x0, H, z0], [x0, H, z1], [x1, H, z1], [x1, H, z0]);
      quad([x0, 0, z1], [x1, 0, z1], [x1, H, z1], [x0, H, z1]);
      quad([x1, 0, z0], [x0, 0, z0], [x0, H, z0], [x1, H, z0]);
      quad([x0, 0, z0], [x0, 0, z1], [x0, H, z1], [x0, H, z0]);
      quad([x1, 0, z1], [x1, 0, z0], [x1, H, z0], [x1, H, z1]);
    }
    const cs = 0.1, ch = 0.1;
    const res = generateSoloNavMesh(pos, idx, {
      cs, ch,
      walkableRadius: Math.ceil(agentRadius / cs),
      walkableHeight: Math.ceil(agentHeight / ch),
      walkableClimb: Math.ceil(0.3 / ch),
      walkableSlopeAngle: 45,
      maxEdgeLen: 12 / cs,
      maxSimplificationError: 1.3,
      minRegionArea: 8,
      mergeRegionArea: 20,
      maxVertsPerPoly: 6,
      detailSampleDist: 6,
      detailSampleMaxError: 1
    });
    if (!res.success || !res.navMesh) throw new Error('navmesh: ' + (res.error ?? 'failed'));
    return new Nav(res.navMesh, new NavMeshQuery(res.navMesh));
  }

  /** Звільнити пам'ять WASM (navmesh і запити) — при переході на інший рівень. */
  destroy(): void {
    this.query.destroy();
    this.navMesh.destroy();
  }

  path(from: V3, to: V3): V3[] {
    const r = this.query.computePath(from, to, { halfExtents: { x: 1, y: 2, z: 1 } });
    return r.success ? r.path.map((p) => ({ x: p.x, y: p.y, z: p.z })) : [];
  }

  pathLength(from: V3, to: V3): number {
    const p = this.path(from, to);
    if (p.length < 2) return Infinity;
    let L = Math.hypot((p[0] as V3).x - from.x, (p[0] as V3).z - from.z);
    for (let i = 1; i < p.length; i++) L += Math.hypot((p[i] as V3).x - (p[i - 1] as V3).x, (p[i] as V3).z - (p[i - 1] as V3).z);
    return L;
  }

  closest(p: V3): V3 {
    const r = this.query.findClosestPoint(p, { halfExtents: { x: 2, y: 3, z: 2 } });
    return r.success ? { x: r.point.x, y: r.point.y, z: r.point.z } : p;
  }

  randomAround(p: V3, radius: number): V3 {
    const r = this.query.findRandomPointAroundCircle(p, radius, { halfExtents: { x: 2, y: 3, z: 2 } });
    return r.success ? { x: r.randomPoint.x, y: r.randomPoint.y, z: r.randomPoint.z } : p;
  }
}
