// Вода басейну: чаші (темна вода з відбиттям залу, брижі) і мілкі калюжі на підлозі. Насос зливає: рівень у чашах
// опускається до дна, калюжі зникають. Відбиття — одне на всі поверхні (одна площина, ReflectorNode), лише на
// пресетах «Высокое/Ультра»; на слабших — дешеве «відбиття» стелі: промінь, відбитий від брижів, перетинає площину стелі,
// і там, де над водою справді горить плафон (сітка ламп рівня), у воді тремтить світла пляма (без додаткового проходу сцени).
import * as THREE from 'three/webgpu';
import { texture, vec2, vec3, float, mix, positionWorld, cameraPosition, normalize, dot, time, reflector, Fn, normalMap, uniform, reflect, fract, floor, max, smoothstep } from 'three/tsl';
import type { Layout } from './layout';

export class Water {
  /** Справжнє дзеркальне відбиття (додатковий прохід сцени); вимкнено — див. конструктор. */
  static MIRROR = false;
  readonly group = new THREE.Group();
  private readonly pools: { mesh: THREE.Mesh; depth: number }[] = [];
  private readonly puddles: THREE.Mesh[] = [];
  private reflect: ReturnType<typeof reflector> | null = null;
  private readonly fade = uniform(1);
  /** Поточна частка злитої води (0 — повно, 1 — сухо). */
  drain = 0;

  constructor(private readonly layout: Layout, ripple: THREE.Texture, fogColor: THREE.Color, reflections: boolean) {
    if (!layout.pools.length && !layout.puddles.length) return;
    ripple.wrapS = ripple.wrapT = THREE.RepeatWrapping;
    // брижі: дві текстури, що повільно пливуть назустріч (шум цвілі як карта висот)
    const p = positionWorld.xz;
    const h = (o: THREE.Node<'vec2'>) => texture(ripple, p.mul(0.18).add(o)).r.add(texture(ripple, p.mul(0.31).sub(o.mul(1.3))).r);
    const t = time.mul(0.012);
    const e = 0.02;
    const h0 = h(vec2(t, t.mul(0.7)));
    const nrm = Fn(() => {
      const hx = h(vec2(t.add(e), t.mul(0.7))).sub(h0), hz = h(vec2(t, t.mul(0.7).add(e))).sub(h0);
      return normalize(vec3(hx.mul(-1.2), float(1), hz.mul(-1.2)));
    })();
    const view = normalize(cameraPosition.sub(positionWorld));
    const fres = float(0.04).add(float(0.96).mul(float(1).sub(dot(view, vec3(0, 1, 0)).max(0)).pow(5)));
    const fog = vec3(fogColor.r, fogColor.g, fogColor.b);
    // справжнє дзеркало (ReflectorNode) у WebKit/WebGL 2 дає чорну воду — лишаємо його вимкненим, модель стелі всюди
    if (reflections && Water.MIRROR) {
      const r = reflector({ resolutionScale: 0.35 });
      r.target.rotateX(-Math.PI / 2);
      this.group.add(r.target);
      r.uvNode = r.uvNode!.add(nrm.xz.mul(0.035));
      this.reflect = r;
    }
    const make = (opacity: number) => {
      const m = new THREE.MeshStandardNodeMaterial({ transparent: opacity < 1, depthWrite: opacity >= 1 });
      // сама вода майже чорна, зеленкувата; на неї лягає відбиття (або серпанок під кутом)
      m.colorNode = vec3(0.012, 0.03, 0.03);
      m.roughness = 0.06;
      m.metalness = 0;
      m.normalNode = normalMap(vec3(nrm.x.mul(0.5).add(0.5), nrm.z.mul(0.5).add(0.5), 1) as never, vec2(0.6));
      const refl = this.reflect ? (this.reflect as unknown as THREE.Node<'vec3'>).rgb : this.fakeCeiling(nrm, fog);
      m.emissiveNode = mix(fog.mul(0.05), refl, fres.mul(0.85).add(0.1)).mul(this.fade);
      if (opacity < 1) m.opacityNode = float(opacity).mul(this.fade).mul(fres.mul(0.5).add(0.6)).min(1);
      return m;
    };
    const deep = make(1), shallow = make(0.82);
    for (const q of layout.pools) {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(q.w, q.d), deep);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(q.x, -0.32, q.z);
      mesh.renderOrder = 1;
      this.group.add(mesh);
      this.pools.push({ mesh, depth: q.depth });
    }
    for (const q of layout.puddles) {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(q.w, q.d), shallow);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(q.x, 0.025, q.z);
      mesh.renderOrder = 2;
      this.group.add(mesh);
      this.puddles.push(mesh);
    }
  }

  /** Відбиття стелі без проходу сцени: плафони, що світять, як розмиті брижами плями на темній стелі. */
  private fakeCeiling(nrm: THREE.Node<'vec3'>, fog: THREE.Node<'vec3'>): THREE.Node<'vec3'> {
    const L = this.layout.lights;
    // крок сітки ламп: найменша відстань між сусідами в ряду
    let period = Infinity;
    for (const a of L) for (const b of L) { const d = Math.abs(a.x - b.x); if (a !== b && Math.abs(a.z - b.z) < 0.01 && d > 0.5) period = Math.min(period, d); }
    if (!Number.isFinite(period) || !L.length) return fog.mul(0.6);
    const nx = Math.ceil((this.layout.cols * this.layout.cell) / period), nz = Math.ceil((this.layout.rows * this.layout.cell) / period);
    const data = new Uint8Array(nx * nz * 4);
    for (const l of L) {
      const ix = Math.floor(l.x / period), iz = Math.floor(l.z / period);
      if (ix < 0 || iz < 0 || ix >= nx || iz >= nz) continue;
      const v = l.state === 'on' ? 255 : l.state === 'flicker' ? 110 : 0;
      data.set([v, v, v, 255], (iz * nx + ix) * 4);
    }
    const on = new THREE.DataTexture(data, nx, nz, THREE.RGBAFormat);
    on.magFilter = on.minFilter = THREE.NearestFilter;
    on.generateMipmaps = false;
    on.needsUpdate = true;
    const half = (L[0]?.w ?? 0.7) / 2;
    const vdir = normalize(positionWorld.sub(cameraPosition));
    // для відбиття брижі м'якші (дрібний шум текстури розсипав би пляму на іскри)
    const r = reflect(vdir, normalize(vec3(nrm.x.mul(0.08), float(1), nrm.z.mul(0.08))));
    const t = float(this.layout.height).sub(positionWorld.y).div(r.y.max(0.05));
    const q = positionWorld.xz.add(r.xz.mul(t)).div(period);
    const loc = fract(q).sub(0.5).abs().mul(period);
    const rect = float(1).sub(smoothstep(half - 0.1, half + 0.35, max(loc.x, loc.y)));
    const lit = texture(on, floor(q).add(0.5).div(vec2(nx, nz))).r;
    const glint = rect.mul(lit).mul(smoothstep(0.03, 0.2, r.y));
    return mix(fog.mul(0.45), vec3(0.85, 0.95, 1.0).mul(2.2), glint);
  }

  /** Чи стоїть точка в мілкій воді (кроки хлюпають, «Утопленник» швидкий). */
  wetAt(x: number, z: number): boolean {
    if (this.drain > 0.6) return false;
    return this.layout.puddles.some((q) => Math.abs(x - q.x) < q.w / 2 && Math.abs(z - q.z) < q.d / 2);
  }

  /** Найближча до точки чаша (для «Утопленника»): центр і відстань до краю. */
  nearestPool(x: number, z: number): { x: number; z: number; w: number; d: number } | null {
    let best: { x: number; z: number; w: number; d: number } | null = null, bd = Infinity;
    for (const q of this.layout.pools) { const d = Math.hypot(q.x - x, q.z - z); if (d < bd) { bd = d; best = q; } }
    return best;
  }

  update(drain: number): void {
    this.drain = drain;
    for (const p of this.pools) p.mesh.position.y = -0.32 - drain * (p.depth - 0.42);
    // калюжі стікають у трапи раніше, ніж спорожніють чаші
    const k = Math.max(0, 1 - drain * 1.6);
    this.fade.value = 1;
    for (const m of this.puddles) { m.visible = k > 0.01; m.scale.setScalar(0.4 + 0.6 * k); }
    if (this.reflect) this.reflect.target.position.y = this.pools[0]?.mesh.position.y ?? 0.025;
  }
}
