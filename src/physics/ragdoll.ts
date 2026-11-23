// Тіла (ragdoll): мертве тіло Оператора — не застигла поза, а 11 справжніх тіл Rapier (таз, груди, голова, плечі,
// передпліччя, стегна, гомілки), з'єднаних суглобами. Лягає на підлогу як важке безвольне тіло: обвисає з меблів,
// руки падають, голова завалюється; штовхнеш ногою чи влучиш кинутою річчю — зрушить.
// «М'язи» — слабкі мотори суглобів до пози, в якій тіло створили: кінцівки не вигинаються навиворіт і не теліпаються,
// як ганчірка, але й не тримають позу проти ваги.
// Кістки скелета (MakeHuman, `game_engine`) читають положення тіл щокадру, поки щось рухається; заснуло — нуль витрат.
import * as THREE from 'three/webgpu';
import type RAPIER from '@dimforge/rapier3d-compat';
import { G, groups, type Physics } from './physics';

/** Сегмент: кістка, де закінчується (кістка або продовження), батьківський сегмент, радіус (м, на зріст 1.8 м), маса (кг). */
interface Seg { bone: string; end: string; extend?: number; parent: string | null; r: number; mass: number }
const SEGS: Seg[] = [
  { bone: 'pelvis', end: 'spine_02', parent: null, r: 0.13, mass: 12 },
  { bone: 'spine_02', end: 'neck_01', parent: 'pelvis', r: 0.14, mass: 20 },
  { bone: 'neck_01', end: 'head', extend: 2.2, parent: 'spine_02', r: 0.1, mass: 5 },
  { bone: 'upperarm_l', end: 'lowerarm_l', parent: 'spine_02', r: 0.05, mass: 2.5 },
  { bone: 'upperarm_r', end: 'lowerarm_r', parent: 'spine_02', r: 0.05, mass: 2.5 },
  { bone: 'lowerarm_l', end: 'hand_l', extend: 1.35, parent: 'upperarm_l', r: 0.042, mass: 2 },
  { bone: 'lowerarm_r', end: 'hand_r', extend: 1.35, parent: 'upperarm_r', r: 0.042, mass: 2 },
  { bone: 'thigh_l', end: 'calf_l', parent: 'pelvis', r: 0.075, mass: 8 },
  { bone: 'thigh_r', end: 'calf_r', parent: 'pelvis', r: 0.075, mass: 8 },
  { bone: 'calf_l', end: 'foot_l', parent: 'thigh_l', r: 0.055, mass: 4.5 },
  { bone: 'calf_r', end: 'foot_r', parent: 'thigh_r', r: 0.055, mass: 4.5 }
];

interface Part { bone: THREE.Bone; body: RAPIER.RigidBody; q0: THREE.Quaternion; p0: THREE.Vector3; c0: THREE.Vector3 }

/** Одне тіло: частини (у порядку від тазу до кінцівок) і чи воно ще рухається. */
export class Ragdoll {
  readonly parts: Part[] = [];
  private readonly joints: RAPIER.ImpulseJoint[] = [];
  private readonly q = new THREE.Quaternion();
  private readonly qp = new THREE.Quaternion();
  private readonly v = new THREE.Vector3();
  private readonly t = new THREE.Vector3();
  private readonly qb = new THREE.Quaternion();
  private awake = true;

  constructor(private readonly physics: Physics, root: THREE.Object3D) {
    const R = physics.R, w = physics.world, bones = new Map<string, THREE.Bone>();
    root.updateMatrixWorld(true);
    root.traverse((o) => { if ((o as THREE.Bone).isBone) bones.set(o.name, o as THREE.Bone); });
    const k = scaleOf(bones);
    const byName = new Map<string, Part>();
    const a = new THREE.Vector3(), b = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    for (const s of SEGS) {
      const bone = bones.get(s.bone), end = bones.get(s.end);
      if (!bone || !end) continue;
      bone.getWorldPosition(a); end.getWorldPosition(b);
      if (s.extend) b.sub(a).multiplyScalar(s.extend).add(a);
      const len = a.distanceTo(b), r = s.r * k, mid = a.clone().add(b).multiplyScalar(0.5);
      // усі тіла — з однаковим (нульовим) поворотом: тоді «поза створення» = нуль кожного суглоба, і мотори тримають саме її
      const body = w.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(mid.x, mid.y, mid.z)
        .setLinearDamping(0.4).setAngularDamping(2.2).setCanSleep(true).setCcdEnabled(s.mass > 6));
      const dir = b.clone().sub(a).normalize(), qc = new THREE.Quaternion().setFromUnitVectors(up, dir);
      w.createCollider(R.ColliderDesc.capsule(Math.max(0.01, len / 2 - r), r).setRotation({ x: qc.x, y: qc.y, z: qc.z, w: qc.w })
        .setMass(s.mass).setFriction(1.1).setRestitution(0.02)
        .setCollisionGroups(groups(G.RAG, G.STATIC | G.DOOR | G.PROP | G.PLAYER)), body);
      const part: Part = { bone, body, q0: bone.getWorldQuaternion(new THREE.Quaternion()), p0: bone.getWorldPosition(new THREE.Vector3()), c0: mid };
      this.parts.push(part);
      byName.set(s.bone, part);
      const par = s.parent ? byName.get(s.parent) : null;
      if (!par) continue;
      // суглоб — у початку кістки (плече, лікоть, кульшовий, коліно, шия, поперек)
      const j = w.createImpulseJoint(R.JointData.spherical(
        { x: a.x - par.c0.x, y: a.y - par.c0.y, z: a.z - par.c0.z }, { x: a.x - mid.x, y: a.y - mid.y, z: a.z - mid.z }), par.body, body, true);
      j.setContactsEnabled(false);
      // createImpulseJoint повертає загальну обгортку без моторів (rapier3d-compat 0.21) — беремо сферичну над тим самим суглобом
      const raw = j as unknown as { rawSet: ConstructorParameters<typeof R.SphericalImpulseJoint>[0]; bodySet: ConstructorParameters<typeof R.SphericalImpulseJoint>[1] };
      const sph = new R.SphericalImpulseJoint(raw.rawSet, raw.bodySet, j.handle);
      // «м'язи» (мотор за прискоренням): тулуб і шия тримають форму, кінцівки — ледь (вага їх опускає)
      const stiff = s.bone.startsWith('spine') || s.bone.startsWith('neck') ? 40 : 14, damp = 4;
      for (const ax of [3, 4, 5] as RAPIER.JointAxis[]) sph.configureMotorPosition(ax, 0, stiff, damp);
      this.joints.push(j);
    }
  }

  /** Чи ще рухається хоч одна частина. */
  get moving(): boolean { return this.parts.some((p) => !p.body.isSleeping()); }

  /** Кістки — за тілами (таз — ще й положення). */
  sync(force = false): void {
    const mv = this.moving;
    if (!mv && !this.awake && !force) return;
    this.awake = mv;
    for (const [i, p] of this.parts.entries()) {
      const r = p.body.rotation(), t = p.body.translation();
      this.q.set(r.x, r.y, r.z, r.w);
      const parent = p.bone.parent as THREE.Object3D;
      parent.updateWorldMatrix(true, false);
      parent.getWorldQuaternion(this.qp);
      // світовий поворот кістки = поворот тіла × її поворот у мить створення (тіла створено з нульовим поворотом)
      p.bone.quaternion.copy(this.qp.invert().multiply(this.qb.copy(this.q).multiply(p.q0)));
      if (i === 0) {
        // таз несе весь скелет: його точка теж за тілом
        this.v.copy(p.p0).sub(p.c0).applyQuaternion(this.q).add(this.t.set(t.x, t.y, t.z));
        p.bone.position.copy(parent.worldToLocal(this.v));
      }
      p.bone.updateMatrixWorld(true);
    }
  }

  dispose(): void {
    const w = this.physics.world;
    for (const p of this.parts) if (w.getRigidBody(p.body.handle)) w.removeRigidBody(p.body);
    this.parts.length = 0;
  }
}

/** Масштаб тіла: зріст від стоп до голови в метрах ÷ 1.8 (тіла бувають зменшені). */
function scaleOf(bones: Map<string, THREE.Bone>): number {
  const h = bones.get('head'), f = bones.get('foot_l');
  if (!h || !f) return 1;
  const a = h.getWorldPosition(new THREE.Vector3()), b = f.getWorldPosition(new THREE.Vector3());
  return Math.max(0.4, Math.min(1.4, a.distanceTo(b) / 1.62));
}

/** Усі тіла рівня. */
export class Corpses {
  private list: Ragdoll[] = [];
  constructor(private readonly physics: Physics) {}

  /** Нове тіло з моделі (уже в сцені, у своїй позі). */
  add(root: THREE.Object3D): Ragdoll {
    const r = new Ragdoll(this.physics, root);
    this.list.push(r);
    return r;
  }

  /** Дати тілам лягти до старту рівня (n кроків фізики), щоб гравець не бачив, як вони падають. */
  settle(n = 90): void {
    if (!this.list.length) return;
    for (let i = 0; i < n; i++) this.physics.world.step();
    for (const r of this.list) r.sync(true);
  }

  sync(): void { for (const r of this.list) r.sync(); }

  get count(): number { return this.list.length; }
  get all(): readonly Ragdoll[] { return this.list; }
  get moving(): number { return this.list.filter((r) => r.moving).length; }

  clear(): void { for (const r of this.list) r.dispose(); this.list = []; }
}
