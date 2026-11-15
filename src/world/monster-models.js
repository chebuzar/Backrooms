// Готові анімовані моделі монстрів (CC0, Quaternius) з «моторошною» переробкою під кожен рівень:
// згладжене тіло, розтягнуті кістки, своя шкіра, світні очі й деталі з decorate() (entity.js).
// Інтерфейс збігається з makeEntityMesh (group, head, jaw, arms, legs, eyes, mat, look, mats) + mixer/update/scare.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as skClone } from 'three/addons/utils/SkeletonUtils.js';
import { decorate, skinTexture } from './entity.js';

const BASE = (import.meta.env && import.meta.env.BASE_URL ? import.meta.env.BASE_URL : './') + 'assets/models/';
const SRC = {}; // name → { scene, clips: {idle, walk, run, crawl, scare} }
let loading = null;

// какой скелет и анимации у какого монстра
const RIG = {
  watcher: { base: 'zombie', walk: 'walk', run: 'run', scale: { arm: 1.35, neck: 1.5, spine: 1 }, h: 2.15, wSpeed: 0.9 },
  blind: { base: 'zombie', walk: 'walk', run: 'run', scale: { arm: 1.15, neck: 1.2, spine: 1 }, h: 1.9, wSpeed: 1 },
  crawler: { base: 'zombie', walk: 'crawl', run: 'crawl', scale: { arm: 1.3, neck: 1.1, spine: 1 }, h: 1.75, wSpeed: 1.6, rSpeed: 2.6 },
  grinner: { base: 'human', walk: 'walk', run: 'run', scale: { arm: 1.25, neck: 1.0, spine: 1 }, h: 2.1, wSpeed: 0.8 },
  drowned: { base: 'zombie', walk: 'walk', run: 'run', scale: { arm: 1.1, neck: 1.1, spine: 1 }, h: 1.85, wSpeed: 0.75 },
  swimmer: { base: 'human', walk: 'walk', run: 'run', scale: { arm: 1.4, neck: 1.25, spine: 1 }, h: 2.0, wSpeed: 0.9 },
  puppet: { base: 'human', walk: 'walk', run: 'run', scale: { arm: 1.15, neck: 1.2, spine: 1 }, h: 1.95, wSpeed: 0.85 },
  mimic: { base: 'human', walk: 'walk', run: 'run', scale: { arm: 1.3, neck: 1.2, spine: 1 }, h: 1.95, wSpeed: 0.9 },
  stalker: { base: 'zombie', walk: 'walk', run: 'run', scale: { arm: 1.3, neck: 1.25, spine: 1.0 }, h: 2.35, wSpeed: 1.1 },
  shadow: { base: 'human', walk: 'walk', run: 'run', scale: { arm: 1.45, neck: 1.4, spine: 1 }, h: 2.2, wSpeed: 0.9 }
};
const CLIPS = {
  human: { idle: 'Idle', walk: 'Walk', run: 'Run', scare: 'Punch' },
  zombie: { idle: 'ZombieIdle', walk: 'ZombieWalk', run: 'ZombieRun', crawl: 'ZombieCrawl', scare: 'ZombieBite' }
};

// Гладкие нормали: модели низкополигональные с «гранями»; усредняем нормали по совпадающим позициям.
function smoothNormals(geo) {
  const pos = geo.attributes.position, nor = geo.attributes.normal; if (!nor) return;
  const key = (i) => `${Math.round(pos.getX(i) * 100)},${Math.round(pos.getY(i) * 100)},${Math.round(pos.getZ(i) * 100)}`;
  const acc = new Map();
  for (let i = 0; i < pos.count; i++) { const k = key(i); const a = acc.get(k) || [0, 0, 0]; a[0] += nor.getX(i); a[1] += nor.getY(i); a[2] += nor.getZ(i); acc.set(k, a); }
  for (let i = 0; i < pos.count; i++) { const a = acc.get(key(i)), l = Math.hypot(a[0], a[1], a[2]) || 1; nor.setXYZ(i, a[0] / l, a[1] / l, a[2] / l); }
  nor.needsUpdate = true;
}

function prep(gltf, name) {
  const clips = {};
  for (const [k, n] of Object.entries(CLIPS[name])) {
    const c = gltf.animations.find((a) => a.name.endsWith('|' + n) || a.name === n);
    if (!c) continue;
    const cl = c.clone();
    // масштаб костей задаём сами — убираем ключи масштаба; позиции — только у Hips
    cl.tracks = cl.tracks.filter((t) => !t.name.endsWith('.scale') && (!t.name.endsWith('.position') || /Hips\.position$/.test(t.name)));
    clips[k] = cl;
  }
  gltf.scene.traverse((o) => { if (o.isSkinnedMesh) { o.geometry = o.geometry.clone(); smoothNormals(o.geometry); } });
  gltf.scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(gltf.scene, true);
  SRC[name] = { scene: gltf.scene, clips, h: (box.max.y - box.min.y) || 1, y0: box.min.y };
}

// загрузить обе модели (один раз); ошибки не ломают игру — останутся процедурные монстры
export function preloadMonsters() {
  if (!loading) {
    const L = new GLTFLoader();
    loading = Promise.all(['human', 'zombie'].map((n) => L.loadAsync(BASE + n + '.glb').then((g) => prep(g, n)).catch((e) => console.warn('[monsters]', n, e && e.message))));
  }
  return loading;
}
export const monstersReady = () => !!(SRC.human && SRC.zombie);

const bone = (root, name) => { let b = null; root.traverse((o) => { if (!b && o.isBone && o.name === name) b = o; }); return b; };

export function makeMonsterMesh(look = {}) {
  const k = look.kind, R = RIG[k];
  if (!R || !SRC[R.base]) return null;
  const src = SRC[R.base], L = Object.assign({ skin: [150, 138, 128], height: 1, eyes: 'glow', mouth: 'jaw', posture: 'hunch' }, look);
  const model = skClone(src.scene);
  const group = new THREE.Group(); group.add(model);
  // размер: модели в сантиметрах — приводим к нужному росту
  const s = R.h / src.h;
  model.scale.setScalar(s); model.position.y = -src.y0 * s;
  // кожа: своя для каждого вида
  const mats = [];
  let mat;
  if (L.shadow) mat = new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 1, transparent: true, opacity: 1 });
  else {
    const t = skinTexture(L);
    mat = new THREE.MeshStandardMaterial({ map: t, color: 0xffffff, roughness: L.wet ? 0.25 : 0.75, metalness: L.wet ? 0.1 : 0, bumpMap: t, bumpScale: 2.5 });
  }
  mats.push(mat);
  model.traverse((o) => { if (o.isSkinnedMesh) { o.material = mat; o.frustumCulled = false; o.castShadow = false; } });
  // пропорции: длинные руки и шея, худое тело
  const sc = R.scale;
  for (const n of ['LeftArm', 'RightArm', 'LeftForeArm', 'RightForeArm']) { const b = bone(model, n); if (b) b.scale.set(1, sc.arm, 1); }
  for (const n of ['LeftHand', 'RightHand']) { const b = bone(model, n); if (b) b.scale.setScalar(1 / sc.arm); }
  const neck = bone(model, 'Neck'); if (neck) neck.scale.set(1, sc.neck, 1);
  const head = bone(model, 'Head'); if (head) head.scale.set(1, 1 / sc.neck, 1);
  for (const n of ['Spine', 'Spine1', 'Spine2']) { const b = bone(model, n); if (b) b.scale.set(sc.spine, 1, sc.spine); }
  const sp2 = bone(model, 'Spine2'); for (const n of ['Neck', 'LeftShoulder', 'RightShoulder']) { const b = bone(model, n); if (b && sp2) b.scale.multiply(new THREE.Vector3(1 / sc.spine, 1, 1 / sc.spine)); }
  // точки крепления деталей: в метрах и с осями модели (Y вверх, Z вперёд), независимо от осей и масштаба кости
  model.updateMatrixWorld(true);
  const gq = new THREE.Quaternion(), gs = new THREE.Vector3(), gp = new THREE.Vector3(), mq = new THREE.Quaternion();
  group.getWorldQuaternion(mq);
  const mk = (b) => {
    const g = new THREE.Group(); if (!b) return g;
    b.matrixWorld.decompose(gp, gq, gs);
    b.add(g); g.scale.set(1 / gs.x, 1 / gs.y, 1 / gs.z); g.quaternion.copy(gq.clone().invert().multiply(mq));
    return g;
  };
  const headA = mk(head); headA.position.y = 0; // у основания черепа
  const chestA = mk(bone(model, 'Spine2')), spineA = mk(bone(model, 'Spine1')), hipsA = mk(bone(model, 'Hips'));
  const wrists = [mk(bone(model, 'LeftHand')), mk(bone(model, 'RightHand'))];
  const jaw = new THREE.Group(); jaw.position.set(0, 0.12, 0.02); headA.add(jaw);
  const dark = new THREE.MeshStandardMaterial({ color: 0x0b0606, roughness: 0.9 }); mats.push(dark);
  const glow = new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 5.6, 4.6) }); mats.push(glow);
  const tooth = new THREE.MeshStandardMaterial({ color: 0xd8cfb4, roughness: 0.5 }); mats.push(tooth);
  const eyes = [];
  // глаза (лицо модели закрыто нашей кожей): светящиеся, пустые или много
  const eyeG = new THREE.SphereGeometry(0.03, 12, 8);
  const addEye = (x, y, sz = 1, m = glow) => { const e = new THREE.Mesh(eyeG, m); e.scale.set(sz, sz * 0.8, sz * 0.5); e.position.set(x, y, 0.105); headA.add(e); if (m === glow) eyes.push(e); };
  if (L.eyes === 'glow') { addEye(-0.045, 0.13); addEye(0.045, 0.13); }
  else if (L.eyes === 'hollow') { addEye(-0.045, 0.13, 1.3, dark); addEye(0.045, 0.13, 1.3, dark); }
  else if (L.eyes === 'many') { for (const [x, y, z] of [[-0.05, 0.14, 1], [0.05, 0.14, 1], [-0.025, 0.19, 0.7], [0.025, 0.19, 0.7], [-0.07, 0.09, 0.6], [0.07, 0.09, 0.6]]) addEye(x, y, z); }
  // детали вида (смайл-голова, монитор, шапочка, волосы, рога…)
  decorate(L, { head: headA, chest: chestA, spine: spineA, hips: hipsA, jaw, eyes, mat, dark, glow, tooth, mats, wrists });
  // нити марионетки
  if (L.puppet) {
    const lm = new THREE.LineBasicMaterial({ color: 0xdedede, transparent: true, opacity: 0.55 }); mats.push(lm);
    for (const w of [...wrists, headA]) { const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 30, 0)]); w.add(new THREE.Line(g, lm)); }
  }
  // анимации
  const mixer = new THREE.AnimationMixer(model), act = {};
  for (const [n, c] of Object.entries(src.clips)) act[n] = mixer.clipAction(c);
  const want = { idle: 'idle', walk: R.walk, run: R.run, scare: 'scare' };
  let cur = null;
  const play = (name, fade = 0.25) => {
    const a = act[want[name]] || act.idle; if (!a || a === cur) return;
    a.reset().setEffectiveWeight(1).fadeIn(fade).play(); if (cur) cur.fadeOut(fade); cur = a;
  };
  play('idle', 0);
  let acc = 0;
  const m = {
    group, head: headA, jaw, chest: chestA, spine: spineA, hips: hipsA, arms: [], legs: [], eyes, mat, look: L, mats, mixer, glb: true, headBone: head,
    // speed — скорость монстра, м/с; frozen — замер под взглядом
    // hold — «стоп-кадр»: позу не обновляем, время копим (покадровое движение, пока Он не гонится)
    update(dt, speed, frozen, hold) {
      acc += dt; if (hold) return;
      dt = acc; acc = 0;
      if (frozen) { mixer.timeScale = 0; }
      else if (speed < 0.3) { play('idle'); mixer.timeScale = 1; }
      else if (speed < 2.2) { play('walk'); mixer.timeScale = (R.wSpeed || 1) * speed / 1.3; }
      else { play('run'); mixer.timeScale = (R.rSpeed || 1) * speed / 3.6; }
      mixer.update(dt);
    },
    scare(dt) { play('scare', 0.08); mixer.timeScale = 1.6; mixer.update(dt); }
  };
  return m;
}

// ---------- обычный человек (для находки «Процессия») ----------
// Та же модель Quaternius (CC0), но в костюме: цвета по костям (кожа головы и кистей, волосы, костюм, тёмные туфли).
// Левая рука неподвижно держит газету у лица (поза — CCD-IK по позиции газеты), правая идёт с портфелем.
let CIVIL = null;
function civilGeometry() {
  if (CIVIL) return CIVIL;
  let sm = null; SRC.human.scene.traverse((o) => { if (!sm && o.isSkinnedMesh) sm = o; });
  const geo = sm.geometry.clone(), names = sm.skeleton.bones.map((b) => b.name);
  const pos = geo.attributes.position, si = geo.attributes.skinIndex, sw = geo.attributes.skinWeight, n = pos.count;
  // высота головы в позе привязки — для волос (верх и затылок)
  let hy0 = Infinity, hy1 = -Infinity, hz0 = Infinity, hz1 = -Infinity;
  const dom = new Array(n);
  for (let i = 0; i < n; i++) {
    let best = 0, bw = -1; for (let k = 0; k < 4; k++) { const w = sw.getComponent(i, k); if (w > bw) { bw = w; best = si.getComponent(i, k); } }
    dom[i] = names[best] || '';
    if (/^Head/.test(dom[i])) { const y = pos.getY(i), z = pos.getZ(i); hy0 = Math.min(hy0, y); hy1 = Math.max(hy1, y); hz0 = Math.min(hz0, z); hz1 = Math.max(hz1, z); }
  }
  const col = new Float32Array(n * 3), C = new THREE.Color();
  for (let i = 0; i < n; i++) {
    const b = dom[i];
    if (/^Head/.test(b)) {
      const ty = (pos.getY(i) - hy0) / (hy1 - hy0 || 1), tz = (pos.getZ(i) - hz0) / (hz1 - hz0 || 1);
      C.set(ty > 0.8 || (ty > 0.45 && tz > 0.7) ? 0x2c2018 : 0xdcb79c);            // волосы (макушка, затылок) / лицо
    } else if (/Hand/.test(b)) C.set(0xdcb79c);                                      // кисти
    else if (/Foot|Toe/.test(b)) C.set(0x17120e);                                     // туфли
    else if (b === 'Neck') C.set(0xe8e2d4);                                           // воротник рубашки
    else C.set(0xffffff);                                                             // костюм (цвет — у материала)
    col[i * 3] = C.r; col[i * 3 + 1] = C.g; col[i * 3 + 2] = C.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  CIVIL = geo; return geo;
}
export const humanReady = () => !!SRC.human;
// opts: { h — рост, suit — цвет костюма, wrap(mat) — обёртка освещения, paper — материал газеты, bag — материал портфеля }
export function makeCivilian(opts = {}) {
  if (!SRC.human) return null;
  const src = SRC.human, model = skClone(src.scene), group = new THREE.Group(); group.add(model);
  const s = (opts.h || 1.78) / src.h; model.scale.setScalar(s); model.position.y = -src.y0 * s;
  // процессия идёт в сторону −Z своей группы — разворачиваем модель лицом туда
  model.rotation.y = Math.PI;
  // тело: костюм + рубашка/кожа/волосы/туфли из цветов вершин; нижняя часть тела — тот же костюм
  const suitM = (opts.wrap || ((m) => m))(new THREE.MeshLambertMaterial({ color: opts.suit ?? 0xb9ab8c, vertexColors: true }));
  model.traverse((o) => { if (o.isSkinnedMesh) { o.geometry = civilGeometry(); o.material = suitM; o.frustumCulled = false; } });
  model.updateMatrixWorld(true);
  const B = (n) => bone(model, n);
  // газета — у лица, крепится к голове (точка крепления в метрах, оси модели)
  const mq = new THREE.Quaternion(), gp = new THREE.Vector3(), gq = new THREE.Quaternion(), gs = new THREE.Vector3();
  group.getWorldQuaternion(mq);
  const anchor = (b) => { const g = new THREE.Group(); if (!b) return g; b.matrixWorld.decompose(gp, gq, gs); b.add(g); g.scale.set(1 / gs.x, 1 / gs.y, 1 / gs.z); g.quaternion.copy(gq.clone().invert().multiply(mq)); return g; };
  const handR = anchor(B('RightHand'));
  const paper = new THREE.Mesh(new THREE.PlaneGeometry(0.58, 0.42, 4, 1), opts.paper);
  { const p = paper.geometry.attributes.position; for (let i = 0; i < p.count; i++) p.setZ(i, -Math.abs(p.getX(i)) * 0.22); paper.geometry.computeVertexNormals(); }
  // газета держится ровно перед лицом (на высоте глаз), не качается вместе с костями
  const H = opts.h || 1.78; paper.position.set(-0.02, H * 0.9, -0.34); paper.rotation.set(0.08, Math.PI, 0); group.add(paper);
  // портфель в правой руке
  const bag = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.3, 0.4), opts.bag); bag.position.set(0, -0.2, 0); handR.add(bag);
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.012, 6, 12, Math.PI), opts.bag); handle.rotation.set(0, Math.PI / 2, 0); handle.position.set(0, -0.04, 0); handR.add(handle);
  // левая рука: CCD-IK — кисть к нижнему левому углу газеты
  model.updateMatrixWorld(true);
  const chain = [B('LeftForeArm'), B('LeftArm')], hand = B('LeftHand');
  const target = new THREE.Vector3(); paper.localToWorld(target.set(0.24, -0.17, -0.03));
  if (hand && chain[0] && chain[1]) {
    const hp = new THREE.Vector3(), bp = new THREE.Vector3(), a = new THREE.Vector3(), c = new THREE.Vector3(), q = new THREE.Quaternion(), pq = new THREE.Quaternion();
    for (let it = 0; it < 12; it++) for (const b of chain) {
      b.updateMatrixWorld(true); hand.getWorldPosition(hp); b.getWorldPosition(bp);
      a.subVectors(hp, bp).normalize(); c.subVectors(target, bp).normalize();
      q.setFromUnitVectors(a, c); b.parent.getWorldQuaternion(pq);
      // поворот в мировых → в локальные кости
      const wq = b.getWorldQuaternion(new THREE.Quaternion()); wq.premultiply(q);
      b.quaternion.copy(pq.invert().multiply(wq));
    }
  }
  const armRot = ['LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand'].map((n) => { const b = B(n); return b && [b, b.quaternion.clone()]; }).filter(Boolean);
  // анимация ходьбы без левой руки (её держим в позе чтения)
  const walk = src.clips.walk.clone(); walk.tracks = walk.tracks.filter((t) => !/(LeftShoulder|LeftArm|LeftForeArm|LeftHand)/.test(t.name));
  const mixer = new THREE.AnimationMixer(model); const act = mixer.clipAction(walk); act.play();
  return {
    g: group, mats: [suitM],
    // speed — м/с; поза левой руки возвращается после шага анимации
    update(dt, speed) { mixer.timeScale = speed / 1.3; mixer.update(dt); for (const [b, q0] of armRot) b.quaternion.copy(q0); }
  };
}
