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
  const m = {
    group, head: headA, jaw, chest: chestA, spine: spineA, hips: hipsA, arms: [], legs: [], eyes, mat, look: L, mats, mixer, glb: true, headBone: head,
    // speed — скорость монстра, м/с; frozen — замер под взглядом
    update(dt, speed, frozen) {
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
