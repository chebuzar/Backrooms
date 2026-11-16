// Стельові світильники «армстронг» 1.2×0.6 м: розсіювач із двома лампами-трубками всередині, алюмінієва рамка.
// Усі лампи рівня — один InstancedMesh (один виклик малювання). Яскравість кожної — атрибут інстанса:
// мерехтливі оновлюються щокадру, вимкнені темні.
import * as THREE from 'three/webgpu';
import { instancedBufferAttribute, uv, vec3, float, smoothstep, abs, max, uniform, mix } from 'three/tsl';
import type { LightPanel } from './layout';
import { rng } from '../core/rng';
import { probeLit } from './materials';

export class Lamps {
  readonly mesh: THREE.InstancedMesh;
  readonly frame: THREE.InstancedMesh;
  private readonly level: Float32Array;
  private readonly attr: THREE.InstancedBufferAttribute;
  private readonly flicker: { i: number; phase: number; rate: number; base: number }[] = [];
  /** Загальна яскравість ламп (сюжетні затемнення). */
  readonly master = uniform(1.0);

  constructor(readonly panels: LightPanel[], ceilingY: number) {
    const n = panels.length;
    this.level = new Float32Array(n);
    this.attr = new THREE.InstancedBufferAttribute(this.level, 1);
    const geo = new THREE.BoxGeometry(1.16, 0.02, 0.56);
    geo.translate(0, -0.01, 0);
    const mat = new THREE.MeshBasicNodeMaterial();
    const lv = instancedBufferAttribute(this.attr) as unknown as THREE.Node<'float'>;
    // розсіювач: рівне світіння + дві яскравіші смуги трубок уздовж довгої сторони, темніший край
    const u = uv();
    const tubes = max(smoothstep(0.14, 0.0, abs(u.y.sub(0.33))), smoothstep(0.14, 0.0, abs(u.y.sub(0.67))));
    const edge = smoothstep(0.0, 0.06, u.x).mul(smoothstep(1.0, 0.94, u.x)).mul(smoothstep(0.0, 0.1, u.y)).mul(smoothstep(1.0, 0.9, u.y));
    const glow = float(0.55).add(tubes.mul(0.75)).mul(edge.mul(0.7).add(0.3));
    const warm = vec3(1.0, 0.94, 0.78);
    // вимкнена лампа — сірий пластик із жовтим нальотом
    mat.colorNode = mix(vec3(0.16, 0.15, 0.12), warm.mul(glow).mul(7.0), lv.mul(this.master));
    this.mesh = new THREE.InstancedMesh(geo, mat, n);
    // рамка тонша й вища за розсіювач: знизу видно світну панель в алюмінієвому обідку
    const frameGeo = new THREE.BoxGeometry(1.24, 0.012, 0.64);
    frameGeo.translate(0, -0.006, 0);
    const frameMat = probeLit(new THREE.MeshStandardMaterial({ color: 0xc9c5b8, roughness: 0.45, metalness: 0.2 }), 1.6);
    this.frame = new THREE.InstancedMesh(frameGeo, frameMat, n);
    const m = new THREE.Matrix4();
    const r = rng(0x1a3e);
    panels.forEach((p, i) => {
      m.makeTranslation(p.x, ceilingY - 0.002, p.z);
      this.mesh.setMatrixAt(i, m);
      m.makeTranslation(p.x, ceilingY, p.z);
      this.frame.setMatrixAt(i, m);
      this.level[i] = p.state === 'off' ? 0 : 1;
      if (p.state === 'flicker') this.flicker.push({ i, phase: r() * 100, rate: 0.6 + r() * 2.2, base: 0.85 + r() * 0.15 });
    });
    this.mesh.frustumCulled = false; // розкидані по всьому рівню — межі рахує сам three (одна велика коробка)
    this.frame.frustumCulled = false;
  }

  /** Мерехтіння: рідкісні «провали» й тремтіння, як у старих дроселів. */
  update(t: number): void {
    for (const f of this.flicker) {
      const s = Math.sin(t * f.rate * 7.3 + f.phase) + Math.sin(t * f.rate * 17.1 + f.phase * 1.7);
      const dip = Math.sin(t * f.rate + f.phase) > 0.82 ? (Math.sin(t * 61 + f.phase) > 0 ? 0.08 : 0.5) : 1;
      this.level[f.i] = Math.max(0, Math.min(1, f.base * dip * (0.95 + s * 0.03)));
    }
    if (this.flicker.length) this.attr.needsUpdate = true;
  }

  /** Індекси ламп, що зараз світять, найближчі до точки (для живого світла й гулу). */
  nearest(x: number, z: number, count: number, maxDist = 14): number[] {
    const best: [number, number][] = [];
    this.panels.forEach((p, i) => {
      if ((this.level[i] ?? 0) <= 0.01) return;
      const d = (p.x - x) ** 2 + (p.z - z) ** 2;
      if (d < maxDist * maxDist) best.push([d, i]);
    });
    best.sort((a, b) => a[0] - b[0]);
    return best.slice(0, count).map((b) => b[1]);
  }

  levelOf(i: number): number { return this.level[i] ?? 0; }
}
