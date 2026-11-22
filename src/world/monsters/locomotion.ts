// Справжня хода монстрів: цикли руху Quaternius UAL (CC0), перенесені на тіла MakeHuman, + процедурний шар поверх.
// Перенесення — власне, у світових поворотах з вирівнюванням кісток: UAL у T-позі, MakeHuman — в A-позі
// (і в кожного монстра свої пропорції), тому SkeletonUtils.retargetClip дає вивернуті руки. Для кожної кістки
// A = поворот, що зводить напрям кістки джерела в спокої до напряму кістки цілі; тоді
//   T(t) = S(t) · S0⁻¹ · A⁻¹ · T0   (S — світовий поворот кістки джерела, T — цілі, 0 — поза спокою).
// Таз переноситься з масштабом за висотою стегна. Кліпи «на місці»: природну швидкість ходи міряємо за ступнями,
// щоб ноги не ковзали підлогою (темп = швидкість / довжина кроку).
import * as THREE from 'three/webgpu';
import { MH_TO_UAL } from './retarget';

export type Pose = Record<string, [number, number, number]>;

/** Кістка-«наступник» для напряму (для кінцевих — напрям батька). */
const NEXT: Record<string, string> = {
  pelvis: 'spine_01', spine_01: 'spine_02', spine_02: 'spine_03', spine_03: 'neck_01', neck_01: 'head'
};
for (const s of ['l', 'r']) {
  Object.assign(NEXT, {
    [`clavicle_${s}`]: `upperarm_${s}`, [`upperarm_${s}`]: `lowerarm_${s}`, [`lowerarm_${s}`]: `hand_${s}`, [`hand_${s}`]: `middle_01_${s}`,
    [`thigh_${s}`]: `calf_${s}`, [`calf_${s}`]: `foot_${s}`, [`foot_${s}`]: `ball_${s}`
  });
  for (const f of ['index', 'middle', 'pinky', 'ring', 'thumb']) { NEXT[`${f}_01_${s}`] = `${f}_02_${s}`; NEXT[`${f}_02_${s}`] = `${f}_03_${s}`; }
}

const wq = (o: THREE.Object3D) => o.getWorldQuaternion(new THREE.Quaternion());
const wp = (o: THREE.Object3D) => o.getWorldPosition(new THREE.Vector3());

/** Кістки моделі за назвами (у порядку ієрархії: батьки раніше за дітей). */
function bonesOf(root: THREE.Object3D): Map<string, THREE.Object3D> {
  const m = new Map<string, THREE.Object3D>();
  root.traverse((o) => { if ((o as THREE.Bone).isBone || o.name.startsWith('DEF-') || o.name === 'root') if (o.name && !m.has(o.name)) m.set(o.name, o); });
  return m;
}

export interface Retargeted { clip: THREE.AnimationClip; /** Метрів за повний цикл (0 — на місці). */ stride: number }

/**
 * Перенести кліп UAL на модель MakeHuman. target — корінь моделі в позі спокою (ще без анімації),
 * source — сцена UAL (кістки DEF-…).
 */
export function retargetUAL2(target: THREE.Object3D, source: THREE.Object3D, clip: THREE.AnimationClip, fps = 30): Retargeted {
  const T = bonesOf(target), S = bonesOf(source);
  // джерело — у власну позу спокою (попереднє перенесення лишає його в останньому кадрі)
  let rest = sourceRest.get(source);
  if (!rest) { rest = new Map([...S.values()].map((o) => [o, { q: o.quaternion.clone(), p: o.position.clone() }])); sourceRest.set(source, rest); }
  for (const [o, r] of rest) { o.quaternion.copy(r.q); o.position.copy(r.p); }
  target.updateMatrixWorld(true);
  const srcMixer = new THREE.AnimationMixer(source);
  source.updateMatrixWorld(true);
  // поза спокою джерела — його власна (вузли без анімації)
  const S0 = new Map<string, THREE.Quaternion>(), T0 = new Map<string, THREE.Quaternion>(), A = new Map<string, THREE.Quaternion>();
  const pairs: { t: THREE.Object3D; s: THREE.Object3D; name: string }[] = [];
  for (const [name, t] of T) {
    const s = S.get(MH_TO_UAL[name] ?? '');
    if (!s) continue;
    pairs.push({ t, s, name });
    S0.set(name, wq(s)); T0.set(name, wq(t));
  }
  // вирівнювання напрямів (для кінцевих кісток — як у батька)
  for (const { t, s, name } of pairs) {
    const nx = NEXT[name];
    const tn = nx ? T.get(nx) : undefined, sn = nx ? S.get(MH_TO_UAL[nx] ?? '') : undefined;
    if (tn && sn && name !== 'pelvis') {
      const dt = wp(tn).sub(wp(t)).normalize(), ds = wp(sn).sub(wp(s)).normalize();
      A.set(name, new THREE.Quaternion().setFromUnitVectors(ds, dt));
    } else {
      let p = t.parent, a: THREE.Quaternion | undefined;
      while (p && !a) { a = A.get(p.name); p = p.parent; }
      A.set(name, a ? a.clone() : new THREE.Quaternion());
    }
  }
  const pelvisT = T.get('pelvis'), hipsS = S.get('DEF-hips');
  const hipT0 = pelvisT ? wp(pelvisT) : new THREE.Vector3(), hipS0 = hipsS ? wp(hipsS) : new THREE.Vector3();
  const scale = hipS0.y > 0.01 ? hipT0.y / hipS0.y : 1;

  const n = Math.max(2, Math.round(clip.duration * fps) + 1);
  const times = new Float32Array(n);
  const qv = new Map<string, Float32Array>(), pv = new Float32Array(n * 3);
  for (const { name } of pairs) qv.set(name, new Float32Array(n * 4));
  // останній кадр = тривалість кліпу: без LoopOnce міксер загорнув би його в нуль
  const act = srcMixer.clipAction(clip).setLoop(THREE.LoopOnce, 1); act.clampWhenFinished = true; act.play();
  const world = new Map<THREE.Object3D, THREE.Quaternion>();
  const q = new THREE.Quaternion(), inv = new THREE.Quaternion();
  const footZ: number[] = [];
  const pairOf = new Map(pairs.map((p) => [p.t, p]));
  // світові повороти предків скелета (нерухомі)
  const restWorld = (o: THREE.Object3D | null): THREE.Quaternion => (o ? wq(o) : new THREE.Quaternion());
  for (let f = 0; f < n; f++) {
    const time = (f / (n - 1)) * clip.duration;
    times[f] = time;
    srcMixer.setTime(time);
    source.updateMatrixWorld(true);
    world.clear();
    for (const [, t] of T) {
      const pr = pairOf.get(t);
      const parentW = (t.parent && world.get(t.parent)) ?? restWorld(t.parent);
      let w: THREE.Quaternion;
      if (pr) {
        w = wq(pr.s).multiply(inv.copy(S0.get(pr.name) as THREE.Quaternion).invert())
          .multiply(q.copy(A.get(pr.name) as THREE.Quaternion).invert()).multiply(T0.get(pr.name) as THREE.Quaternion);
        const local = parentW.clone().invert().multiply(w);
        (qv.get(pr.name) as Float32Array).set([local.x, local.y, local.z, local.w], f * 4);
      } else w = parentW.clone().multiply(t.quaternion);
      world.set(t, w);
    }
    if (pelvisT && hipsS) {
      const d = wp(hipsS).sub(hipS0).multiplyScalar(scale);
      const pw = hipT0.clone().add(d);
      const local = (pelvisT.parent as THREE.Object3D).worldToLocal(pw);
      pv.set([local.x, local.y, local.z], f * 3);
    }
    const fl = S.get('DEF-foot.L');
    if (fl) footZ.push(wp(fl).z * scale);
  }
  act.stop(); srcMixer.uncacheRoot(source);
  for (const [o, r] of rest) { o.quaternion.copy(r.q); o.position.copy(r.p); }
  const tracks: THREE.KeyframeTrack[] = [];
  for (const [name, v] of qv) tracks.push(new THREE.QuaternionKeyframeTrack(`${name}.quaternion`, times, v));
  if (pelvisT) tracks.push(new THREE.VectorKeyframeTrack('pelvis.position', times, pv));
  const range = footZ.length ? Math.max(...footZ) - Math.min(...footZ) : 0;
  return { clip: new THREE.AnimationClip(clip.name, clip.duration, tracks), stride: range * 2 };
}

const sourceRest = new WeakMap<THREE.Object3D, Map<THREE.Object3D, { q: THREE.Quaternion; p: THREE.Vector3 }>>();
/** Уже перенесені кліпи: ключ — модель (файл) + кліп; кліп прив'язується за назвами кісток, тож годиться для кожної копії. */
const cache = new Map<string, Retargeted>();

/** Набір кліпів одного монстра: спокій, повільна хода, швидка (необов'язкова). */
export interface GaitClips { idle: string; walk: string; run?: string }

const tmpE = new THREE.Euler(), tmpQ = new THREE.Quaternion();

/**
 * Хода: міксер з трьома діями (спокій / хода / біг), темп за швидкістю (ступні не ковзають), фаза ходи й бігу
 * спільна. Поверх — процедурний шар: add — поворот додається до анімації, set — кістка ставиться з пози спокою
 * (як було: руки за спиною, затуляє обличчя тощо), w — вага шару.
 */
export class Locomotion {
  /** Лише для перевірки (?debug): без процедурного шару — чиста перенесена анімація. */
  static bare = false;
  private readonly mixer: THREE.AnimationMixer;
  private readonly idle: THREE.AnimationAction;
  private readonly walk: THREE.AnimationAction;
  private readonly run: THREE.AnimationAction | null;
  private readonly walkStride: number;
  private readonly runStride: number;
  private readonly bones = new Map<string, { b: THREE.Object3D; rest: THREE.Euler }>();
  private phase = 0;
  /** Значення кісток від міксера до шару: міксер пише кістку лише коли значення змінилось, тож шар треба знімати. */
  private readonly base = new Map<THREE.Object3D, THREE.Quaternion>();
  private wMove = 0;
  private wRun = 0;
  /** Фаза кроку 0..1 (для звуку: крок — при переході через 0 і 0.5). */
  get stepPhase(): number { return this.phase; }

  constructor(readonly model: THREE.Object3D, ual: { scene: THREE.Object3D; animations: THREE.AnimationClip[] }, set: GaitClips, key: string) {
    for (const [name, b] of bonesOf(model)) this.bones.set(name, { b, rest: b.rotation.clone() });
    const get = (n: string) => {
      const k = `${key}|${n}`;
      let r = cache.get(k);
      if (!r) {
        const c = ual.animations.find((a) => a.name === n);
        if (!c) throw new Error(`UAL clip missing: ${n}`);
        r = retargetUAL2(model, ual.scene, c);
        cache.set(k, r);
      }
      return r;
    };
    this.mixer = new THREE.AnimationMixer(model);
    const mk = (r: Retargeted) => { const a = this.mixer.clipAction(r.clip); a.play(); a.setEffectiveWeight(0); return a; };
    const i = get(set.idle), w = get(set.walk), r = set.run ? get(set.run) : null;
    this.idle = mk(i); this.walk = mk(w); this.run = r ? mk(r) : null;
    this.walkStride = Math.max(0.4, w.stride); this.runStride = r ? Math.max(0.6, r.stride) : this.walkStride;
    // фаза ходи й бігу задається вручну (спільна), спокій іде своїм часом
    this.walk.timeScale = 0; if (this.run) this.run.timeScale = 0;
    this.idle.setEffectiveWeight(1);
    this.idle.time = Math.random() * i.clip.duration;
  }

  /**
   * speed — м/с; runK 0..1 — частка бігу; rate — множник темпу (повільніше / нервовіше);
   * overlay — процедурний шар (w — вага пози set; add — завжди повністю).
   */
  update(dt: number, speed: number, runK: number, overlay: { add?: Pose; set?: Pose; w?: number } = {}, rate = 1): void {
    const moveWant = THREE.MathUtils.smoothstep(speed, 0.05, 0.4);
    this.wMove += (moveWant - this.wMove) * Math.min(1, dt * 6);
    this.wRun += ((this.run ? runK : 0) - this.wRun) * Math.min(1, dt * 3);
    const stride = THREE.MathUtils.lerp(this.walkStride, this.runStride, this.wRun);
    this.phase = (this.phase + (dt * Math.max(speed, 0.15) * rate) / stride) % 1;
    this.walk.time = this.phase * this.walk.getClip().duration;
    if (this.run) this.run.time = this.phase * this.run.getClip().duration;
    this.idle.setEffectiveWeight(1 - this.wMove);
    this.walk.setEffectiveWeight(this.wMove * (1 - this.wRun));
    this.run?.setEffectiveWeight(this.wMove * this.wRun);
    this.idle.timeScale = rate;
    for (const [b, q] of this.base) b.quaternion.copy(q);
    this.mixer.update(dt);
    if (Locomotion.bare) return;
    for (const name of [...Object.keys(overlay.set ?? {}), ...Object.keys(overlay.add ?? {})]) {
      const e = this.bones.get(name);
      if (!e) continue;
      const q = this.base.get(e.b);
      if (q) q.copy(e.b.quaternion); else this.base.set(e.b, e.b.quaternion.clone());
    }
    const k = overlay.w ?? 1;
    if (overlay.set) for (const [name, [x, y, z]] of Object.entries(overlay.set)) {
      const e = this.bones.get(name);
      if (!e) continue;
      tmpQ.setFromEuler(tmpE.set(e.rest.x + x, e.rest.y + y, e.rest.z + z, e.rest.order));
      e.b.quaternion.slerp(tmpQ, k);
    }
    if (overlay.add) for (const [name, [x, y, z]] of Object.entries(overlay.add)) {
      const e = this.bones.get(name);
      if (e) e.b.quaternion.multiply(tmpQ.setFromEuler(tmpE.set(x, y, z)));
    }
  }

  dispose(): void { this.mixer.stopAllAction(); this.mixer.uncacheRoot(this.model); }
}
