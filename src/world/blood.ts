// Калюжа крові на підлозі (смерть Оператора і його тіла з минулих спроб). Форма — справжня CC0-пляма (атлас ambientCG
// Leaking, клітинка «калюжа з центру»), не намальована кодом: та сама маска дає нерівний край, що розтікається.
// Матеріал — мокрий (низька шорсткість): ліхтарик дає на ній відблиск. Один спільний матеріал на всі калюжі
// (один шейдер — прогрівається разом із рівнем, без ривка в момент смерті).
import * as THREE from 'three/webgpu';
import { texture, uv, vec2, vec3, float, smoothstep, dot, attribute } from 'three/tsl';

const cache = new WeakMap<THREE.Texture, THREE.MeshStandardNodeMaterial>();

function bloodMaterial(atlas: THREE.Texture): THREE.MeshStandardNodeMaterial {
  let m = cache.get(atlas);
  if (m) return m;
  m = new THREE.MeshStandardNodeMaterial({ transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 });
  // клітинка 3 атласу (калюжа): темніше в текстурі — більше рідини
  const t = texture(atlas, uv().mul(vec2(0.25, 0.5)).add(vec2(0.75, 0))).rgb;
  const wet = float(1).sub(dot(t, vec3(0.333, 0.333, 0.333)));
  const lc = attribute<'vec2'>('local', 'vec2');
  const r = lc.sub(0.5).length().mul(2);
  // маска × радіальний спад: краї нерівні (з текстури), центр — суцільний
  const k = wet.mul(1.6).add(float(1).sub(r).mul(0.9)).sub(0.75);
  m.opacityNode = smoothstep(0.0, 0.18, k).mul(0.96);
  // темна венозна кров, що вже трохи згорнулася по краях
  m.colorNode = vec3(0.16, 0.012, 0.01).mul(smoothstep(-0.1, 0.6, k).mul(0.45).add(0.55));
  m.roughnessNode = float(0.12).add(smoothstep(0.5, 0.0, k).mul(0.35));
  m.metalnessNode = float(0);
  cache.set(atlas, m);
  return m;
}

/** Калюжа діаметром `size` м у точці (x, z). Масштаб (scale) — для розтікання. */
export function makeBloodPool(atlas: THREE.Texture, x: number, z: number, size: number, seed = 0): THREE.Mesh {
  const g = new THREE.PlaneGeometry(1, 1);
  g.rotateX(-Math.PI / 2);
  const p = g.getAttribute('uv') as THREE.BufferAttribute;
  g.setAttribute('local', new THREE.BufferAttribute(new Float32Array(p.array), 2));
  const m = new THREE.Mesh(g, bloodMaterial(atlas));
  m.position.set(x, 0.006, z);
  m.rotation.y = seed * 2.399;
  m.scale.setScalar(size);
  m.receiveShadow = true;
  m.renderOrder = 3;
  m.name = 'blood';
  return m;
}

/**
 * Бризки крові (сцена смерті): краплі летять балістично й лягають плямками на підлогу. Один InstancedMesh, один
 * простий матеріал — додається в сцену прихованим разом із рівнем (прогрівається, без ривка в момент смерті).
 */
export class BloodSpray {
  readonly mesh: THREE.InstancedMesh;
  private readonly p: Float32Array;
  private readonly v: Float32Array;
  private readonly r: Float32Array;
  private readonly live: Uint8Array;
  private next = 0;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly s = new THREE.Vector3();
  private readonly pos = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();
  private readonly y = new THREE.Vector3(0, 1, 0);

  constructor(readonly count = 96) {
    const mat = new THREE.MeshStandardNodeMaterial({ color: new THREE.Color().setRGB(0.17, 0.008, 0.006, THREE.SRGBColorSpace), roughness: 0.25, metalness: 0 });
    this.mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), mat, count);
    this.mesh.frustumCulled = false;
    this.mesh.name = 'blood-spray';
    this.p = new Float32Array(count * 3); this.v = new Float32Array(count * 3); this.r = new Float32Array(count);
    this.live = new Uint8Array(count);
    this.clear();
  }

  clear(): void {
    this.m.makeScale(0, 0, 0);
    for (let i = 0; i < this.count; i++) { this.mesh.setMatrixAt(i, this.m); this.live[i] = 0; }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** Бризок з точки (x, y, z): n крапель, віялом угору й у бік `toward` (одиничний), швидкість ~speed м/с. */
  burst(x: number, y: number, z: number, toward: THREE.Vector3, n: number, speed: number): void {
    for (let k = 0; k < n; k++) {
      const i = this.next; this.next = (this.next + 1) % this.count;
      const a = Math.random() * Math.PI * 2, sp = speed * (0.35 + Math.random() * 0.75);
      this.dir.set(Math.cos(a) * 0.3, 1.0 + Math.random() * 0.6, Math.sin(a) * 0.3).addScaledVector(toward, 0.25 + Math.random() * 0.4).normalize();
      this.p.set([x + (Math.random() - 0.5) * 0.06, y, z + (Math.random() - 0.5) * 0.06], i * 3);
      this.v.set([this.dir.x * sp, this.dir.y * sp, this.dir.z * sp], i * 3);
      this.r[i] = 0.0025 + Math.random() * Math.random() * 0.006;
      this.live[i] = 1;
    }
  }

  /** Крок польоту; eye — де очі: крапля, що влучила в обличчя, зникає. Повертає, скільки влучило в очі. */
  update(dt: number, eye?: THREE.Vector3): number {
    let hit = 0;
    for (let i = 0; i < this.count; i++) {
      if (!this.live[i] || this.live[i] === 3) continue;
      const o = i * 3, r = this.r[i] as number;
      if (this.live[i] === 1) {
        (this.v[o + 1] as number) -= 9.8 * dt;
        for (let a = 0; a < 3; a++) this.p[o + a] = (this.p[o + a] as number) + (this.v[o + a] as number) * dt;
        this.pos.set(this.p[o] as number, this.p[o + 1] as number, this.p[o + 2] as number);
        if (this.pos.y <= 0.004) { this.pos.y = 0.004; this.p[o + 1] = 0.004; this.live[i] = 2; } // упала — плямка
        else if (eye && this.pos.distanceToSquared(eye) < 0.12 * 0.12) {
          hit++; this.live[i] = 3; this.mesh.setMatrixAt(i, this.m.makeScale(0, 0, 0)); continue;
        } else {
          // летить — витягнута вздовж руху
          this.dir.set(this.v[o] as number, this.v[o + 1] as number, this.v[o + 2] as number);
          const sp = this.dir.length();
          this.q.setFromUnitVectors(this.y, this.dir.multiplyScalar(1 / Math.max(1e-4, sp)));
          // витягнута на шлях за кадр (≈ як змазана в русі), а не кулька
          this.s.set(r, r + Math.min(0.05, sp / 60 * 0.6), r);
          this.mesh.setMatrixAt(i, this.m.compose(this.pos, this.q, this.s));
          continue;
        }
      }
      this.pos.set(this.p[o] as number, this.p[o + 1] as number, this.p[o + 2] as number);
      this.q.identity();
      this.s.set(r * 2.2, r * 0.15, r * 2.2);
      this.mesh.setMatrixAt(i, this.m.compose(this.pos, this.q, this.s));
      this.live[i] = 3; // більше не рахуємо
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    return hit;
  }
}
