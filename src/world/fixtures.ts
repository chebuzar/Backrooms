// Геометрія стельових світильників (справжні об'єми замість плоских світних прямокутників):
// • louvre — ЛПО 1.2×0.6 (НИИ): накладний емальований корпус, дві трубки ЛБ, решітка-«жалюзі» з пластин:
//   знизу під кутом пластини затуляють трубки, прямо знизу видно трубки між ними;
// • batten — ЛСП (база, парковка): вузький корпус-відбивач і голі трубки під ним;
// • globe — куля з молочного скла на штанзі (дитсадок);
// • square — квадратний молочний розсіювач у глибокій металевій рамці (басейн).
// Дві геометрії на стиль: body — корпус (освітлюється сценою), glow — те, що світиться само
// (атрибут lk: x — яскравість увімкненої лампи, y — яскравість вимкненої, у частках кольору лампи / сірого).
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export type FixtureStyle = 'louvre' | 'batten' | 'globe' | 'square';

/** Стиль за розмірами панелі планування (рівні задають лише розмір). */
export function styleFor(w: number, d: number): FixtureStyle {
  const lo = Math.min(w, d), hi = Math.max(w, d);
  if (lo <= 0.3) return 'batten';
  if (hi - lo < 0.05) return lo < 0.55 ? 'globe' : 'square';
  return 'louvre';
}

/** Атрибут яскравості: on/off для кожної вершини; fn може залежати від висоти вершини. */
function tag(g: THREE.BufferGeometry, fn: (y: number) => [number, number]): THREE.BufferGeometry {
  const ng = g.index ? g.toNonIndexed() : g;
  const pos = ng.getAttribute('position');
  const a = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) { const [on, off] = fn(pos.getY(i)); a[i * 2] = on; a[i * 2 + 1] = off; }
  ng.setAttribute('lk', new THREE.BufferAttribute(a, 2));
  for (const k of Object.keys(ng.attributes)) if (!['position', 'normal', 'uv', 'lk'].includes(k)) ng.deleteAttribute(k);
  return ng;
}
const box = (w: number, h: number, d: number, x = 0, y = 0, z = 0) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
const merge = (gs: THREE.BufferGeometry[]) => {
  const ng = gs.map((g) => (g.index ? g.toNonIndexed() : g));
  for (const g of ng) for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'lk'].includes(k)) g.deleteAttribute(k);
  const m = mergeGeometries(ng, false);
  if (!m) throw new Error('fixtures: merge failed');
  return m;
};
/** Трубка вздовж X. */
const tube = (len: number, r: number, y: number, z: number) => new THREE.CylinderGeometry(r, r, len, 12, 1, false).rotateZ(Math.PI / 2).translate(0, y, z);

export interface Fixture { body: THREE.BufferGeometry; glow: THREE.BufferGeometry }

/** w — уздовж X, d — уздовж Z (як у плані); стеля — y = 0, світильник звисає вниз. */
export function buildFixture(style: FixtureStyle, w: number, d: number): Fixture {
  if (style === 'louvre') {
    const H = 0.075, t = 0.012;
    // корпус: дно-кришка під стелею й чотири борти (емаль); усередині — відбивач, що світиться від трубок
    const body = merge([
      box(w, 0.01, d, 0, -0.005),
      box(w, H, t, 0, -H / 2, d / 2 - t / 2), box(w, H, t, 0, -H / 2, -d / 2 + t / 2),
      box(t, H, d, w / 2 - t / 2, -H / 2), box(t, H, d, -w / 2 + t / 2, -H / 2)
    ]);
    const inner = w - 2 * t, innerD = d - 2 * t;
    const parts: THREE.BufferGeometry[] = [];
    // відбивач: яскравіший над трубками
    parts.push(tag(box(inner, 0.004, innerD, 0, -0.012), () => [0.7, 0.26]));
    // дві трубки ЛБ-40 (Ø 26 мм) — найяскравіше місце
    for (const z of [-innerD * 0.24, innerD * 0.24]) {
      parts.push(tag(tube(inner - 0.04, 0.013, -0.034, z), () => [9.0, 0.55]));
      // патрони на кінцях трубок
      for (const x of [-(inner / 2 - 0.02), inner / 2 - 0.02]) parts.push(tag(box(0.03, 0.035, 0.04, x, -0.03, z), () => [0.5, 0.18]));
    }
    // решітка: поперечні пластини через 10 см, поздовжня планка й обідок; верх пластин освітлений трубками, низ — темніший
    const slatH = 0.04, sy = -H + slatH / 2 + 0.003;
    const lk = (y: number): [number, number] => { const k = THREE.MathUtils.clamp((y - (sy - slatH / 2)) / slatH, 0, 1); return [0.16 + 0.5 * k, 0.1 + 0.1 * k]; };
    const n = Math.max(4, Math.round(inner / 0.1));
    for (let i = 1; i < n; i++) parts.push(tag(box(0.004, slatH, innerD, -inner / 2 + (i * inner) / n, sy), lk));
    parts.push(tag(box(inner, slatH, 0.004, 0, sy, 0), lk));
    return { body, glow: merge(parts) };
  }
  if (style === 'batten') {
    // ЛСП: вузький корпус-відбивач (трапеція з бортами) на всю довжину, під ним одна-дві голі трубки
    const long = Math.max(w, d), wide = Math.min(w, d);
    const H = 0.06;
    const body = merge([
      box(long, 0.012, wide, 0, -0.006),
      box(long, H, 0.01, 0, -H / 2, wide / 2 - 0.005), box(long, H, 0.01, 0, -H / 2, -wide / 2 + 0.005),
      box(0.02, H, wide, long / 2 - 0.01, -H / 2), box(0.02, H, wide, -long / 2 + 0.01, -H / 2)
    ]);
    const tubes = wide > 0.18 ? [-wide * 0.22, wide * 0.22] : [0];
    const parts: THREE.BufferGeometry[] = [tag(box(long - 0.04, 0.004, wide - 0.02, 0, -0.014), () => [0.65, 0.25])];
    for (const z of tubes) {
      parts.push(tag(tube(long - 0.1, 0.013, -H - 0.006, z), () => [8.5, 0.5]));
      for (const x of [-(long / 2 - 0.05), long / 2 - 0.05]) parts.push(tag(box(0.035, 0.03, 0.035, x, -H + 0.004, z), () => [0.35, 0.15]));
    }
    const rot = (g: THREE.BufferGeometry) => (w >= d ? g : g.rotateY(Math.PI / 2));
    return { body: rot(body), glow: rot(merge(parts)) };
  }
  if (style === 'globe') {
    // куля молочного скла Ø ~0.3 м на штанзі 0.32 м: світліша знизу-всередині, темніший «пояс» на тримачі
    const R = Math.min(w, d) * 0.4, drop = 0.32;
    const body = merge([
      new THREE.CylinderGeometry(0.075, 0.075, 0.018, 20).translate(0, -0.009, 0),
      new THREE.CylinderGeometry(0.008, 0.008, drop, 8).translate(0, -drop / 2, 0),
      new THREE.CylinderGeometry(0.05, 0.065, 0.05, 20).translate(0, -drop - 0.02, 0)
    ]);
    const cy = -drop - 0.035 - R * 0.92;
    const glass = tag(new THREE.SphereGeometry(R, 28, 18, 0, Math.PI * 2, 0.35, Math.PI - 0.35).translate(0, cy, 0), (y) => {
      const k = THREE.MathUtils.clamp((cy + R - y) / (2 * R), 0, 1); // 0 угорі, 1 унизу
      return [1.6 + 3.2 * Math.sin(k * Math.PI * 0.85), 0.55];
    });
    return { body, glow: glass };
  }
  // square: глибока рамка й молочний розсіювач, трохи втоплений
  const H = 0.09, t = 0.02;
  const body = merge([
    box(w, 0.012, d, 0, -0.006),
    box(w, H, t, 0, -H / 2, d / 2 - t / 2), box(w, H, t, 0, -H / 2, -d / 2 + t / 2),
    box(t, H, d, w / 2 - t / 2, -H / 2), box(t, H, d, -w / 2 + t / 2, -H / 2)
  ]);
  // розсіювач: сітка вершин, яскравість спадає до країв (лампи всередині видно як світліші плями)
  const g = new THREE.PlaneGeometry(w - 2 * t, d - 2 * t, 12, 12).rotateX(Math.PI / 2).translate(0, -H + 0.022, 0);
  const ng = g.toNonIndexed();
  const p2 = ng.getAttribute('position');
  const a = new Float32Array(p2.count * 2);
  const hx = (w - 2 * t) / 2, hz = (d - 2 * t) / 2;
  for (let i = 0; i < p2.count; i++) {
    const ex = 1 - Math.abs(p2.getX(i)) / hx, ez = 1 - Math.abs(p2.getZ(i)) / hz;
    const k = Math.min(1, Math.sqrt(Math.max(0, ex * ez)) * 1.6);
    a[i * 2] = 1.2 + 4.2 * k; a[i * 2 + 1] = 0.5;
  }
  ng.setAttribute('lk', new THREE.BufferAttribute(a, 2));
  // розсіювач дивиться вниз (площина після rotateX(+90°) має нормаль донизу)
  return { body, glow: merge([ng]) };
}
