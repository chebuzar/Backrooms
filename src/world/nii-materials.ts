// Матеріали рівня 0 «Бесконечный НИИ» на TSL — оздоблення за ПРИМІЩЕННЯМ, як у справжньому інституті:
// коридори — зелена олійна панель до 1.6 м і побілка, лінолеум; кабінети — пофарбовані світлі стіни (два відтінки), паркет;
// кабінет директора — шпалери; лабораторія й санвузол — білий кахель 15×15; креслярські — блакитно-сіра панель, паркет;
// архів і склад — сіро-бежева фарба, лінолеум; актова зала й вестибюль — охриста панель; темне крило — облуплена фарба.
// Код оздоблення кожної клітинки — карта планування (DataTexture з кодами, не «намальована» поверхня); стіна бере код
// клітинки, в яку дивиться. Фактура — лише справжні CC0-текстури (UV0 у метрах), освітлення — запечена карта (UV1).
import * as THREE from 'three/webgpu';
import {
  texture, uv, uniformArray, vec2, vec3, float, mix, smoothstep, clamp, floor, int, dot, step,
  positionWorld, normalMap, normalWorld, Fn, luminance
} from 'three/tsl';
import type { Layout, RoomKind } from './layout';
import { BakedMaterial, decodeLightmap, type Level0Textures } from './materials';

type Tex = THREE.Texture;
type F = THREE.Node<'float'>;
type V4 = THREE.Node<'vec4'>;

/** Реальні розміри однієї текстури, м: шпалери, фарба, паркет, лінолеум, кахель (плитка 15 см), метлахська плитка. */
const WALL_M = 1.06, PAINT_M = 1.5, PARQ_M = 1.6, LINO_M = 2.0, TILE_M = 0.75, WCF_M = 2.26;

/** Тип стіни: фарба (панель + побілка), кахель знизу, шпалери. Тип підлоги: паркет, лінолеум, плитка. */
const enum Wall { Paint = 0, Tile = 1, Paper = 2 }
const enum Floor { Parquet = 0, Lino = 1, Tiles = 2 }

interface Finish {
  /** Колір нижньої панелі (sRGB) і її висота, м (0 — уся стіна одного кольору). */
  panel: [number, number, number]; h: number;
  /** Колір верху стіни (побілка чи фарба). */
  top: [number, number, number];
  wall: Wall; floor: Floor;
  /** Облуплена фарба (0..1), вологі підтьоки (0..1). */
  peel: number; wet: number;
}

/** Оздоблення за кодом: 0 — коридор, далі — за призначенням приміщення. */
const FIN: Finish[] = [
  /* 0 коридор */ { panel: [0.34, 0.45, 0.37], h: 1.6, top: [0.82, 0.8, 0.72], wall: Wall.Paint, floor: Floor.Lino, peel: 0.35, wet: 0.45 },
  /* 1 кабінет */ { panel: [0.6, 0.68, 0.63], h: 1.5, top: [0.8, 0.8, 0.74], wall: Wall.Paint, floor: Floor.Parquet, peel: 0.15, wet: 0.25 },
  /* 2 кабінет б */ { panel: [0.74, 0.66, 0.5], h: 1.5, top: [0.82, 0.79, 0.7], wall: Wall.Paint, floor: Floor.Parquet, peel: 0.15, wet: 0.25 },
  /* 3 директор */ { panel: [0.62, 0.6, 0.48], h: 0, top: [0.62, 0.6, 0.48], wall: Wall.Paper, floor: Floor.Parquet, peel: 0, wet: 0.15 },
  /* 4 лабораторія */ { panel: [0.9, 0.9, 0.86], h: 1.65, top: [0.78, 0.8, 0.78], wall: Wall.Tile, floor: Floor.Lino, peel: 0.1, wet: 0.2 },
  /* 5 креслярська */ { panel: [0.5, 0.6, 0.65], h: 1.45, top: [0.83, 0.82, 0.76], wall: Wall.Paint, floor: Floor.Parquet, peel: 0.15, wet: 0.2 },
  /* 6 архів/склад */ { panel: [0.52, 0.49, 0.42], h: 1.5, top: [0.74, 0.72, 0.66], wall: Wall.Paint, floor: Floor.Lino, peel: 0.45, wet: 0.5 },
  /* 7 актова/вестибюль */ { panel: [0.56, 0.42, 0.25], h: 1.6, top: [0.84, 0.81, 0.71], wall: Wall.Paint, floor: Floor.Parquet, peel: 0.2, wet: 0.3 },
  /* 8 санвузол */ { panel: [0.9, 0.9, 0.86], h: 1.8, top: [0.66, 0.7, 0.62], wall: Wall.Tile, floor: Floor.Tiles, peel: 0.4, wet: 0.8 },
  /* 9 сходи */ { panel: [0.3, 0.4, 0.33], h: 1.5, top: [0.76, 0.75, 0.68], wall: Wall.Paint, floor: Floor.Lino, peel: 0.5, wet: 0.6 },
  /* 10 темне крило */ { panel: [0.31, 0.37, 0.31], h: 1.45, top: [0.7, 0.7, 0.64], wall: Wall.Paint, floor: Floor.Lino, peel: 1, wet: 0.85 }
];
const KIND_CODE: Partial<Record<RoomKind, number>> = {
  office: 1, director: 3, lab: 4, drafting: 5, archive: 6, store: 6, assembly: 7, lobby: 7, wc: 8, stairs: 9, dark: 10
};

/** Карта оздоблення: код кожної клітинки планування (0 — коридор); сусідні кабінети чергують два відтінки. */
function finishMap(L: Layout): THREE.DataTexture {
  const data = new Uint8Array(L.cols * L.rows * 4);
  L.rooms.forEach((q, i) => {
    let code = KIND_CODE[q.kind] ?? 1;
    if (code === 1 && i % 2 === 1) code = 2;
    for (let y = q.y0; y < q.y1; y++) for (let x = q.x0; x < q.x1; x++) data[(y * L.cols + x) * 4] = code;
  });
  const t = new THREE.DataTexture(data, L.cols, L.rows, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.magFilter = t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

const lin = (c: [number, number, number]) => { const k = new THREE.Color().setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace); return new THREE.Vector4(k.r, k.g, k.b, 0); };

export function makeNiiMaterials(t: Level0Textures, L: Layout) {
  const fmap = finishMap(L);
  const W = L.cols * L.cell, D = L.rows * L.cell;
  const panelT = uniformArray(FIN.map((f) => lin(f.panel).setW(f.h)), 'vec4');
  const topT = uniformArray(FIN.map((f) => lin(f.top).setW(f.wall)), 'vec4');
  const miscT = uniformArray(FIN.map((f) => new THREE.Vector4(f.floor, f.peel, f.wet, 0)), 'vec4');
  const el = (a: ReturnType<typeof uniformArray>, i: F) => a.element(int(i)) as unknown as V4; // типи @types/three не знають swizzle елемента

  /** Код оздоблення в точці; для стін — у клітинці, куди дивиться грань (зсув уздовж нормалі). */
  const codeAt = (push: number) => {
    const p = positionWorld.xz.add(normalWorld.xz.mul(push));
    return floor(texture(fmap, vec2(p.x.div(W), p.y.div(D))).r.mul(255).add(0.5)) as F;
  };
  const is = (v: F, k: number) => float(1).sub(step(0.5, v.sub(k).abs()));
  const maskAt = (p: THREE.Node<'vec2'>, k: number, off: number) => texture(t.mold, p.mul(k).add(off)).r;
  const gp = vec2(positionWorld.x.add(positionWorld.z), positionWorld.y);

  // ---- стіни ----
  const wallUV = uv(0).div(WALL_M), paintUV = uv(0).div(PAINT_M), tileUV = uv(0).div(TILE_M);
  const wallSet = Fn(() => {
    const c = codeAt(0.3), h = positionWorld.y;
    const P = el(panelT, c), T = el(topT, c), M = el(miscT, c);
    const kind = T.w, ph = P.w;
    const isPanel = float(1).sub(smoothstep(ph.sub(0.004), ph.add(0.004), h));
    // фарба: панель знизу (олійна, лисніє) і побілка/фарба зверху, між ними — тонка темна смуга, як проводили маляри
    const pc = texture(t.paint_c, paintUV).r.mul(2.0);
    let col = mix(T.xyz, P.xyz, isPanel).mul(pc);
    const line = smoothstep(ph.sub(0.006), ph, h).mul(float(1).sub(smoothstep(ph.add(0.016), ph.add(0.022), h))).mul(step(0.1, ph));
    col = mix(col, col.mul(0.45), line);
    // кахель до висоти панелі (лабораторія, санвузол): справжня плитка, зверху — фарба
    const isTile = is(kind, Wall.Tile).mul(isPanel);
    col = mix(col, texture(t.tile_c, tileUV).rgb.mul(P.xyz.div(0.82)), isTile);
    // шпалери (кабінет директора): справжня текстура, приглушена до вицвілої казенної
    const wp = texture(t.wall_c, wallUV).rgb;
    const paper = T.xyz.mul(mix(float(0.62), dot(wp, vec3(0.299, 0.587, 0.114)), 0.45).mul(1.5));
    col = mix(col, paper, is(kind, Wall.Paper));
    // облуплена фарба (справжня штукатурка під нею): плямами, де фарба, а не кахель
    const peelZone = smoothstep(0.55, 0.8, maskAt(gp, 0.07, 0.61)).mul(M.y).mul(float(1).sub(isTile)).mul(float(1).sub(is(kind, Wall.Paper)));
    const holes = texture(t.peel_m, paintUV.mul(0.8)).r;
    const peeled = smoothstep(0.45, 0.6, holes.mul(peelZone)).mul(0.95);
    col = mix(col, texture(t.peel_c, paintUV.mul(0.8)).rgb, peeled);
    // підтьоки й волога — справжня текстура цвілі, темніше донизу; затерто біля підлоги; кіптява під стелею
    const wet = smoothstep(0.5, 0.82, maskAt(gp, 0.11, 0.0).oneMinus()).mul(M.z);
    col = mix(col, col.mul(vec3(0.62, 0.57, 0.45)), wet.mul(0.5));
    col = col.mul(float(1).sub(float(1).sub(smoothstep(0.0, 0.35, h)).mul(0.22)));
    col = mix(col, col.mul(vec3(0.84, 0.8, 0.7)), smoothstep(2.2, 3.0, h).mul(0.4));
    // шорсткість: олійна панель лисніє, побілка матова, кахель — глазур
    const pr = texture(t.paint_r, paintUV).r;
    let rough = mix(pr.mul(0.15).add(0.84), pr.mul(0.2).add(0.32), isPanel);
    rough = mix(rough, texture(t.tile_r, tileUV).r, isTile);
    rough = mix(rough, texture(t.wall_r, wallUV).r, is(kind, Wall.Paper));
    rough = mix(rough, float(0.9), peeled);
    const nrm = mix(mix(texture(t.paint_n, paintUV).rgb, texture(t.tile_n, tileUV).rgb, isTile), texture(t.wall_n, wallUV).rgb, is(kind, Wall.Paper));
    return { col, rough, nrm };
  });

  // ---- підлога: паркет «ялинкою», лінолеум, метлахська плитка ----
  const pUV = positionWorld.xz.div(PARQ_M), lUV = positionWorld.xz.div(LINO_M), fUV = positionWorld.xz.div(WCF_M);
  const floorSet = Fn(() => {
    const c = codeAt(0), M = el(miscT, c), kind = M.x;
    const pq = texture(t.parquet_c, pUV).rgb;
    const parq = mix(vec3(luminance(pq)), pq, 0.62).mul(vec3(0.66, 0.58, 0.52));
    const lino = texture(t.lino_c, lUV).rgb.mul(vec3(0.95, 0.9, 0.85));
    const isL = is(kind, Floor.Lino), isT = is(kind, Floor.Tiles);
    let col = mix(mix(parq, lino, isL), texture(t.wcf_c, fUV).rgb, isT);
    // затерті доріжки (світліше, без лаку) і вологі темні плями
    const worn = smoothstep(0.55, 0.85, maskAt(positionWorld.xz, 0.03, 0.27));
    col = mix(col, col.mul(vec3(1.18, 1.12, 1.02)).add(0.02), worn.mul(0.35));
    const damp = smoothstep(0.42, 0.78, texture(t.mold, positionWorld.xz.mul(0.045)).r.oneMinus()).mul(M.z.mul(0.8).add(0.2));
    col = mix(col, col.mul(vec3(0.52, 0.47, 0.4)), damp.mul(0.65));
    const rough = mix(mix(mix(texture(t.parquet_r, pUV).r.mul(0.3).add(0.36), texture(t.lino_r, lUV).r.mul(0.3).add(0.42), isL),
      texture(t.wcf_r, fUV).r, isT), float(0.2), damp);
    const nrm = mix(mix(texture(t.parquet_n, pUV).rgb, texture(t.lino_n, lUV).rgb, isL), texture(t.wcf_n, fUV).rgb, isT);
    return { col, rough, nrm };
  });

  // ---- стеля: побілене перекриття (справжня фактура фарби), жовті кільця від протікань, темніше в сирих приміщеннях ----
  const cUV = positionWorld.xz.div(PAINT_M);
  const ceilColor = Fn(() => {
    const M = el(miscT, codeAt(0));
    const pc = texture(t.paint_c, cUV).r.mul(0.5).add(0.5);
    let c = vec3(0.84, 0.83, 0.78).mul(pc);
    const leak = texture(t.mold, positionWorld.xz.mul(0.06).add(0.31)).r.oneMinus();
    const ring = smoothstep(0.6, 0.7, leak).mul(float(1).sub(smoothstep(0.7, 0.82, leak)));
    c = mix(c, c.mul(vec3(0.66, 0.58, 0.44)), clamp(ring.mul(0.7).add(smoothstep(0.68, 0.9, leak).mul(0.3)), 0, 1).mul(M.z.mul(0.7).add(0.3)));
    return c;
  });

  return (lm: Tex) => {
    // запечене світло ламп ЛБ — злегка холодніше (денне світло трубок), без жовтизни
    const lmNode = decodeLightmap(lm).mul(vec3(0.96, 1.0, 1.04)) as THREE.Node<'vec3'>;
    const ws = wallSet();
    const wall = new BakedMaterial();
    wall.colorNode = ws.col;
    wall.normalNode = normalMap(ws.nrm, vec2(0.8));
    wall.roughnessNode = ws.rough;
    wall.metalness = 0;
    wall.lmNode = lmNode;

    const fs = floorSet();
    const floorM = new BakedMaterial();
    floorM.colorNode = fs.col;
    floorM.normalNode = normalMap(fs.nrm, vec2(0.9));
    floorM.roughnessNode = fs.rough;
    floorM.metalness = 0;
    floorM.lmNode = lmNode;

    const ceil = new BakedMaterial();
    ceil.colorNode = ceilColor();
    ceil.normalNode = normalMap(texture(t.paint_n, cUV), vec2(0.5));
    ceil.roughness = 0.92;
    ceil.metalness = 0;
    ceil.lmNode = lmNode;

    const kit = (c: [number, number, number], rough: number, metal = 0) => {
      const m = new BakedMaterial();
      m.color = new THREE.Color().setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace); m.roughness = rough; m.metalness = metal; m.lmNode = lmNode;
      return m;
    };
    return {
      wall, floor: floorM, ceil, wallLow: wall,
      base: kit([0.2, 0.14, 0.09], 0.45), // дерев'яний плінтус, темна фарба
      tbar: kit([0.74, 0.74, 0.7], 0.5, 0.2), plenum: kit([0.025, 0.022, 0.02], 0.95),
      plastic: kit([0.74, 0.72, 0.64], 0.42), metal: kit([0.4, 0.43, 0.4], 0.5, 0.35), frame: kit([0.36, 0.25, 0.15], 0.5)
    } as Record<string, THREE.MeshStandardNodeMaterial>;
  };
}
