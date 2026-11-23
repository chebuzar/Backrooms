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
