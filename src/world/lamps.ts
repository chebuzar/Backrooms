// Стельові світильники ЛПО 1.2×0.6 м (радянські люмінесцентні): дві трубки ЛБ за решіткою-«жалюзі», емальована рамка.
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
  /** Рівень лампи без сюжетних втручань (увімк. 1 / вимк. 0 / мерехтіння). */
  private readonly base: Float32Array;
  /** Сюжетні/монстрові множники яскравості окремих ламп (наприклад, гаснуть біля Фигуры). */
  private readonly ovr = new Map<number, number>();
  private readonly attr: THREE.InstancedBufferAttribute;
  private readonly flicker: { i: number; phase: number; rate: number; base: number }[] = [];
  /** Загальна яскравість ламп (сюжетні затемнення). */
  readonly master = uniform(1.0);

  constructor(readonly panels: LightPanel[], ceilingY: number, look: { color?: [number, number, number] } = {}) {
    const n = panels.length;
    this.level = new Float32Array(n);
    this.base = new Float32Array(n);
    this.attr = new THREE.InstancedBufferAttribute(this.level, 1);
    const pw = panels[0]?.w ?? 1.2, pd = panels[0]?.d ?? 0.6;
    const geo = new THREE.BoxGeometry(pw - 0.04, 0.02, pd - 0.04);
    geo.translate(0, -0.01, 0);
    const mat = new THREE.MeshBasicNodeMaterial();
    const lv = instancedBufferAttribute(this.attr) as unknown as THREE.Node<'float'>;
    // розсіювач: рівне світіння + дві яскравіші смуги трубок уздовж довгої сторони, темніший край
    const u = uv();
    const tubes = max(smoothstep(0.14, 0.0, abs(u.y.sub(0.33))), smoothstep(0.14, 0.0, abs(u.y.sub(0.67))));
    const edge = smoothstep(0.0, 0.06, u.x).mul(smoothstep(1.0, 0.94, u.x)).mul(smoothstep(0.0, 0.1, u.y)).mul(smoothstep(1.0, 0.9, u.y));
    // решітка-«жалюзі» ЛПО: поперечні пластини через 12 см і поздовжня планка посередині (затінюють трубки)
    const cell = u.x.mul(10).fract();
    const louver = smoothstep(0.0, 0.1, cell).mul(smoothstep(1.0, 0.9, cell)).mul(smoothstep(0.02, 0.06, abs(u.y.sub(0.5))));
    const glow = float(0.35).add(tubes.mul(0.95)).mul(edge.mul(0.7).add(0.3)).mul(mix(float(0.22), float(1), louver));
    const lc = look.color ?? [0.95, 0.97, 0.86];
    const warm = vec3(lc[0], lc[1], lc[2]);
    // вимкнена лампа — сірий пластик із жовтим нальотом
    mat.colorNode = mix(vec3(0.16, 0.15, 0.12), warm.mul(glow).mul(7.0), lv.mul(this.master));
    this.mesh = new THREE.InstancedMesh(geo, mat, n);
    // рамка тонша й вища за розсіювач: знизу видно світну панель в алюмінієвому обідку
    const frameGeo = new THREE.BoxGeometry(pw + 0.04, 0.012, pd + 0.04);
    frameGeo.translate(0, -0.006, 0);
    const frameMat = probeLit(new THREE.MeshStandardMaterial({ color: 0xd4d2c6, roughness: 0.4, metalness: 0.1 }), 1.6); // біла емаль
    this.frame = new THREE.InstancedMesh(frameGeo, frameMat, n);
    const m = new THREE.Matrix4();
    const r = rng(0x1a3e);
    panels.forEach((p, i) => {
      m.makeTranslation(p.x, ceilingY - 0.002, p.z);
      this.mesh.setMatrixAt(i, m);
      m.makeTranslation(p.x, ceilingY, p.z);
      this.frame.setMatrixAt(i, m);
      this.level[i] = this.base[i] = p.state === 'off' ? 0 : 1;
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
      this.base[f.i] = Math.max(0, Math.min(1, f.base * dip * (0.95 + s * 0.03)));
      this.level[f.i] = this.base[f.i] as number;
    }
    for (const [i, m] of this.ovr) this.level[i] = (this.base[i] as number) * m;
    this.attr.needsUpdate = true;
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

  /** Лампа перегоріла назавжди (лопнула): більше не світить і не мерехтить. */
  kill(i: number): void {
    this.base[i] = 0; this.level[i] = 0;
    this.ovr.delete(i);
    const k = this.flicker.findIndex((f) => f.i === i);
    if (k >= 0) this.flicker.splice(k, 1);
    this.attr.needsUpdate = true;
  }

  /** Приглушити (mul < 1) або повернути (mul = 1) лампи в радіусі r від точки. */
  dimAround(x: number, z: number, r: number, mul: number): void {
    this.panels.forEach((p, i) => {
      if ((p.x - x) ** 2 + (p.z - z) ** 2 > r * r) return;
      if (mul >= 0.999) { this.ovr.delete(i); this.level[i] = this.base[i] as number; } else this.ovr.set(i, mul);
    });
  }

  /** Рівень лампи під час запікання (Blender): on — 1, flicker — 0.75, off — 0. */
  private baked(i: number): number { const s = this.panels[i]?.state; return s === 'on' ? 1 : s === 'flicker' ? 0.75 : 0; }

  /** Заповнити слоти «живого згасання» лампами біля точки, що зараз світять слабше, ніж запечено. */
  fillDeficits(x: number, z: number, out: THREE.Vector4[]): void {
    const cand: [number, number, number][] = [];
    this.panels.forEach((p, i) => {
      const def = this.baked(i) - (this.level[i] ?? 0) * this.master.value;
      if (def <= 0.02) return;
      const d = (p.x - x) ** 2 + (p.z - z) ** 2;
      if (d < 26 * 26) cand.push([d, i, def]);
    });
    cand.sort((a, b) => a[0] - b[0]);
    out.forEach((v, k) => {
      const c = cand[k];
      if (!c) { v.set(0, 0, 0, 0); return; }
      const p = this.panels[c[1]] as LightPanel;
      v.set(p.x, p.z, Math.min(1, c[2]), 0);
    });
  }
}
