// Кров на самих мисливцях (18+): рот і підборіддя в крові, що стекла смугами на шию й груди; руки до ліктя в крові.
// Форма смуг — справжні CC0-підтьоки (атлас ambientCG Leaking, той самий, що на стінах і під тілами), не намальована
// кодом. Де саме кров — рахується один раз на процесорі для кожної вершини (поза прив'язки, до скінінгу) і лягає в
// атрибути сітки: кров «приклеєна» до тіла й рухається з ним, а шейдер лише читає атрибут і текстуру (позиції в моделях
// квантовані цілими числами — математику над ними краще не робити в шейдері).
// Опорні точки (маківка, перед обличчя, кінчики рук) беруться з самої сітки тіла: моделі MakeHuman різного зросту
// (Наблюдатель — 2.8 м, Утопленник — 1.8 м) у T-позі, зріст уздовж +Y, обличчя в +Z. Одяг ділить ту саму систему координат.
import * as THREE from 'three/webgpu';
import { texture, attribute, vec2, vec3, float, max, min, mix, smoothstep, dot, materialColor, materialRoughness } from 'three/tsl';
import type { StalkerKind } from './stalker';

/** Скільки крові: «Улыбчивая» — рот, «Утопленник» — вода змила майже все. */
const AMOUNT: Record<StalkerKind, { mouth: number; hands: number }> = {
  watcher: { mouth: 1, hands: 1 },
  blind: { mouth: 1, hands: 0.85 },
  smiler: { mouth: 1.1, hands: 0.6 },
  drowned: { mouth: 0.5, hands: 0.4 }
};

/** Опорні точки тіла в одиницях сітки (позиції квантовані — одиниці не метри; s — скільки метрів в одиниці). */
export interface GoreRef { axisX: number; topY: number; faceZ: number; headD: number; reach: number; s: number }

/** Знайти опорні точки за вершинами сітки тіла. */
export function goreRef(body: THREE.Mesh): GoreRef {
  const a = body.geometry.getAttribute('position');
  const s = body.scale.x || 1;
  let ti = 0;
  for (let i = 1; i < a.count; i++) if (a.getY(i) > a.getY(ti)) ti = i;
  const topY = a.getY(ti), axisX = a.getX(ti), headBand = 0.25 / s;
  let zMin = Infinity, zMax = -Infinity, reach = 0;
  for (let i = 0; i < a.count; i++) {
    if (a.getY(i) > topY - headBand) { zMin = Math.min(zMin, a.getZ(i)); zMax = Math.max(zMax, a.getZ(i)); }
    reach = Math.max(reach, Math.abs(a.getX(i) - axisX));
  }
  return { axisX, topY, faceZ: zMax, headD: (zMax - zMin) * s, reach: reach * s, s };
}

const ss = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/**
 * Де кров на вершині: goreK = (губи, смуги з рота, руки, суцільно на кистях), goreP = (X, Y, Z) у метрах для текстури.
 * Чиста функція (без сцени) — перевіряється в Node.
 */
export function goreAttributes(g: THREE.BufferGeometry, ref: GoreRef, kind: StalkerKind): void {
  const p = g.getAttribute('position'), n = g.getAttribute('normal') as THREE.BufferAttribute | undefined;
  const K = new Float32Array(p.count * 4), P = new Float32Array(p.count * 3);
  const D = Math.max(0.18, ref.headD), a = AMOUNT[kind], s = ref.s;
  const mouthY = D * 0.76, chinY = D;
  for (let i = 0; i < p.count; i++) {
    const X = (p.getX(i) - ref.axisX) * s, Y = (ref.topY - p.getY(i)) * s, F = (ref.faceZ - p.getZ(i)) * s;
    const front = ss(-0.15, 0.4, n ? n.getZ(i) : 1);
    const lips = (1 - ss(D * 0.07, D * 0.2, Math.hypot(X * 1.1, Y - mouthY - D * 0.08))) * (1 - ss(D * 0.2, D * 0.45, F));
    const w = D * 0.16 + Math.max(0, Y - chinY) * 0.38;
    const column = (1 - ss(w * 0.5, w, Math.abs(X))) * ss(mouthY, mouthY + 0.02, Y) * (1 - ss(chinY + 0.12, chinY + 0.5, Y));
    const side = Math.abs(X) / ref.reach;
    K[i * 4] = lips * front * a.mouth;
    K[i * 4 + 1] = column * front * a.mouth;
    K[i * 4 + 2] = ss(0.66, 0.84, side) * a.hands;
    K[i * 4 + 3] = ss(0.84, 0.93, side) * a.hands;
    P[i * 3] = X; P[i * 3 + 1] = Y; P[i * 3 + 2] = p.getZ(i) * s;
  }
  g.setAttribute('goreK', new THREE.BufferAttribute(K, 4));
  g.setAttribute('goreP', new THREE.BufferAttribute(P, 3));
}

/** Шейдер крові для матеріалу сітки з атрибутами goreK/goreP. atlas — підтьоки 4×2 (RGB: 1 — чисто, темніше — підтік). */
export function stainWithBlood(mat: THREE.MeshStandardNodeMaterial, atlas: THREE.Texture, cloth: boolean): void {
  const K = attribute<'vec4'>('goreK', 'vec4'), P = attribute<'vec3'>('goreP', 'vec3');
  const X = P.x, Y = P.y;
  // підтік: клітинка атласу; темніше в текстурі — більше крові
  const cell = (i: number, u: THREE.Node<'float'>, v: THREE.Node<'float'>) => {
    const t = texture(atlas, vec2(u.fract().mul(0.25).add((i % 4) * 0.25), v.fract().mul(0.5).add(Math.floor(i / 4) * 0.5))).rgb;
    return smoothstep(0.06, 0.5, float(1).sub(dot(t, vec3(0.333, 0.333, 0.333))));
  };
  // не суцільна «помада»: плями й підтьоки навколо рота; смуги донизу по шиї й грудях
  const mouth = K.x.mul(cell(2, X.mul(5.0).add(0.4), Y.mul(4.0)).mul(0.55).add(0.45));
  const drips = max(cell(1, X.mul(2.4).add(0.5), Y.mul(1.6)), cell(4, X.mul(2.0).add(0.3), Y.mul(1.3).add(0.2)).mul(0.85));
  const face = max(mouth, K.y.mul(drips).mul(1.25));
  const hands = K.z.mul(max(cell(6, X.mul(3.0), Y.mul(2.6).add(P.z.mul(3.0))), K.w.mul(0.85)));
  const k = min(float(1), cloth ? face.mul(0.9) : max(face, hands)).toVar();
  // кров: свіжа — темно-червона й мокра, по краях засохла — бура й матова
  const blood = mix(vec3(0.06, 0.018, 0.012), vec3(0.13, 0.01, 0.007), smoothstep(0.35, 0.9, k));
  mat.colorNode = mix(materialColor, blood, k.mul(0.93));
  mat.roughnessNode = mix(materialRoughness, float(cloth ? 0.5 : 0.32), smoothstep(0.4, 0.95, k));
}
