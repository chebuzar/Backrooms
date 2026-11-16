// Декалі «слідів часу»: підтьоки води під решітками й від стелі, бруд біля підлоги, плями на килимі й стелі.
// Справжні CC0-текстури (атлас ambientCG Leaking, 4×2) на плоских квадратах біля поверхонь — усі грані рівня осьові, тож
// проєкція не потрібна. Змішування «множенням»: декаль лише темнить уже освітлену поверхню, тому світло й тіні — від стіни,
// і пляма не виглядає «приклеєною». Один меш на рівень (один виклик малювання).
import * as THREE from 'three/webgpu';
import { texture, uv, vec4, mix, smoothstep, positionView, float, attribute, output } from 'three/tsl';
import { rng } from '../core/rng';
import type { Layout } from './layout';
import type { Decor } from './decor';

/**
 * MRT декалі: у головному проході сцени пише колір і «1» у нормалі/швидкості (множення лишає їх без змін).
 * У будь-якому іншому рендер-таргеті без цих імен стандартний MRTNode дає порожню структуру (помилка WGSL у WebGPU) —
 * тоді лишаємо лише основний вихід кольору.
 */
class DecalMRT extends THREE.MRTNode {
  override setup(builder: THREE.NodeBuilder): THREE.Node | null {
    const rt = builder.renderer.getRenderTarget() as { textures?: { name: string }[] } | null;
    const names = rt?.textures?.map((t) => t.name) ?? [];
    if (!names.some((n) => n in this.outputNodes)) {
      const out = (this.outputNodes as Record<string, THREE.Node>).output as THREE.Node;
      (this as unknown as { members: THREE.Node[] }).members = [out];
      return THREE.OutputStructNode.prototype.setup.call(this, builder) as THREE.Node | null;
    }
    return super.setup(builder) as THREE.Node | null;
  }
}

type Quad = { c: [number, number, number]; u: [number, number, number]; v: [number, number, number]; cell: number; flip: boolean };

/** Розставити декалі детерміновано з планування й деталей будівлі. */
function placeDecals(l: Layout, decor: Decor[]): Quad[] {
  const r = rng(l.seed ^ 0xdeca1);
  const H = l.height, out: Quad[] = [];
  const inWall = (x: number, z: number, m: number) => l.walls.some((w) => Math.abs(x - w.x) < w.w / 2 + m && Math.abs(z - w.z) < w.d / 2 + m);
  const OFF = 0.004;
  /** Квадрат на вертикальній грані: центр, нормаль (nx, nz), ширина, висота. */
  // клітинки атласу: 0,1,2,7 — підтьоки згори; 4,5,6 — сирість знизу; 3 — калюжа/пляма з центру
  const TOP = [0, 1, 2, 7], BOTTOM = [4, 5, 6];
  const pick = (a: number[]) => a[Math.floor(r() * a.length)] as number;
  const onWall = (x: number, y: number, z: number, nx: number, nz: number, w: number, h: number, cells: number[]) => {
    out.push({
      c: [x + nx * OFF, y, z + nz * OFF], u: [nz * w / 2, 0, -nx * w / 2], v: [0, -h / 2, 0],
      cell: pick(cells), flip: r() < 0.5
    });
  };
  // під решітками — довгий підтьок униз
  for (const d of decor) {
    if (d.t !== 'vent' || d.y < 1.5) continue;
    const nx = Math.sin(d.yaw), nz = Math.cos(d.yaw);
    const h = 0.9 + r() * 0.8;
    onWall(d.x, d.y - d.w * 0.25 - h / 2, d.z, nx, nz, d.w * (1.1 + r() * 0.6), h, TOP);
  }
  // підтьоки від стелі й бруд біля підлоги на видимих гранях стін
  for (const w of l.walls) {
    if (w.kind !== 'wall') continue;
    const horiz = w.w >= w.d, len = horiz ? w.w : w.d;
    for (const side of [1, -1]) {
      const nx = horiz ? 0 : side, nz = horiz ? side : 0;
      for (let a = -len / 2 + 0.5; a < len / 2 - 0.5; a += 1.6) {
        const px = horiz ? w.x + a : w.x + nx * w.w / 2, pz = horiz ? w.z + nz * w.d / 2 : w.z + a;
        if (inWall(px + nx * 0.3, pz + nz * 0.3, 0.05)) continue;
        const roll = r();
        if (roll < 0.09) { const h = 0.7 + r() * 1.1; onWall(px, H - h / 2 - 0.02, pz, nx, nz, 0.6 + r() * 0.9, h, TOP); }
        else if (roll < 0.15) { const h = 0.35 + r() * 0.35; onWall(px, h / 2 + 0.06, pz, nx, nz, 0.7 + r() * 0.8, h, BOTTOM); }
      }
    }
  }
  // плями на килимі (вологі) і на стелі (протікання)
  const W = l.cols * l.cell, D = l.rows * l.cell;
  for (let i = 0; i < l.cols * l.rows * 0.035; i++) {
    const x = r() * W, z = r() * D, s = 0.7 + r() * 1.3;
    if (inWall(x, z, s * 0.45)) continue;
    const ceil = r() < 0.35;
    const ang = r() * Math.PI * 2, ca = Math.cos(ang) * s / 2, sa = Math.sin(ang) * s / 2;
    out.push({ c: [x, ceil ? H - OFF : OFF, z], u: [ca, 0, sa], v: [-sa * (ceil ? -1 : 1), 0, ca * (ceil ? -1 : 1)], cell: 3, flip: r() < 0.5 });
  }
  return out;
}

export function buildDecals(l: Layout, decor: Decor[], atlas: THREE.Texture): THREE.Mesh {
  const quads = placeDecals(l, decor);
  const pos = new Float32Array(quads.length * 12), uvs = new Float32Array(quads.length * 8), nrm = new Float32Array(quads.length * 12);
  const loc = new Float32Array(quads.length * 8); // локальні 0..1 — для м'якого згасання до країв
  const idx: number[] = [];
  quads.forEach((q, i) => {
    const corners: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    const u0 = (q.cell % 4) / 4, v0 = Math.floor(q.cell / 4) / 2;
    // нормаль = u × v (для освітлення не потрібна, лише для повноти атрибутів)
    const n = new THREE.Vector3(...q.u).cross(new THREE.Vector3(...q.v)).normalize();
    corners.forEach(([a, b], k) => {
      for (let j = 0; j < 3; j++) pos[i * 12 + k * 3 + j] = (q.c[j] as number) + (q.u[j] as number) * a + (q.v[j] as number) * b;
      const fu = q.flip ? 1 - (a + 1) / 2 : (a + 1) / 2;
      uvs[i * 8 + k * 2] = u0 + fu * 0.25;
      uvs[i * 8 + k * 2 + 1] = v0 + ((b + 1) / 2) * 0.5;
      loc[i * 8 + k * 2] = (a + 1) / 2; loc[i * 8 + k * 2 + 1] = (b + 1) / 2;
      nrm[i * 12 + k * 3] = n.x; nrm[i * 12 + k * 3 + 1] = n.y; nrm[i * 12 + k * 3 + 2] = n.z;
    });
    const o = i * 4;
    idx.push(o, o + 1, o + 2, o, o + 2, o + 3);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setAttribute('local', new THREE.BufferAttribute(loc, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();

  const m = new THREE.MeshBasicNodeMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    blending: THREE.MultiplyBlending, premultipliedAlpha: true,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4
  });
  m.fog = false;
  // далеко плями зливаються з туманом — плавно згасають
  const fade = smoothstep(16.0, 30.0, positionView.z.negate());
  // м'які краї: жодної прямокутної межі плями (і захист від сусідніх клітинок атласу на дальніх mip-рівнях)
  const lc = attribute<'vec2'>('local', 'vec2');
  const edge = smoothstep(0.0, 0.22, lc.x).mul(smoothstep(1.0, 0.78, lc.x)).mul(smoothstep(0.0, 0.18, lc.y)).mul(smoothstep(1.0, 0.82, lc.y));
  m.colorNode = vec4(mix(float(1), texture(atlas, uv()).rgb, edge.mul(fade.oneMinus())), 1);
  // у буфери нормалей і швидкостей пишемо 1 — множення залишає їх без змін (AO й TRAA не бачать декалей)
  m.mrtNode = new DecalMRT({ output, normal: vec4(1), velocity: vec4(1) }) as unknown as typeof m.mrtNode;
  const mesh = new THREE.Mesh(g, m);
  mesh.renderOrder = 2;
  mesh.frustumCulled = false;
  return mesh;
}
