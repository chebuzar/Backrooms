// Мисливці рівнів 1–2 на спільному «мозку» (src/ai/brain.ts) і навігації recast:
// • «Наблюдатель» (база «Глубина-1») — рухається лише тоді, коли його не видно: відвернувся чи світло на ньому згасло —
//   і він уже ближче, в іншій позі. Тримай його в промені ліхтарика.
// • «Слепой» (парковка) — без очей, полює на звук: біг і двері чути далеко, присід — майже ні. Ходить згорбившись,
//   смикано, прислухається з задертою головою.
// Перед появою — напруга: лампи довкола нього блимають; зблизька — схоплює (onCatch).
import * as THREE from 'three/webgpu';
import { Brain, type Traits, type PlayerView } from '../../ai/brain';
import type { NavLike, V3 } from '../../ai/nav';
import type { Physics } from '../../physics/physics';
import type { Lamps } from '../lamps';
import type { Doors } from '../doors';
import { probeLit } from '../materials';

export type StalkerKind = 'watcher' | 'blind';

export const TRAITS: Record<StalkerKind, Traits> = {
  watcher: { sightRange: 34, fovHalf: 1.2, hearing: 0.5, walkSpeed: 3.0, runSpeed: 3.4, searchTime: 30, alertness: 0.9, movesWhenUnseen: true, cutsOff: true },
  blind: { sightRange: 0, fovHalf: 0, hearing: 1.5, walkSpeed: 0.95, runSpeed: 3.9, searchTime: 22, alertness: 0 }
};

type Pose = Record<string, [number, number, number]>;

/** Пози «Наблюдателя»: щоразу, як на нього глянеш, — інша (руки, нахил голови). Зсуви від пози спокою, рад. */
const ARMS_DOWN: Pose = { upperarm_l: [0, 0, -0.78], upperarm_r: [0, 0, 0.78] };
const WATCHER_POSES: Pose[] = [
  // руки звисають, голова схилена набік
  { ...ARMS_DOWN, neck_01: [0.3, 0, 0.6], head: [0.2, 0, 0.45] },
  // одна рука тягнеться до гравця
  { ...ARMS_DOWN, upperarm_r: [-1.1, 0, 0.9], lowerarm_r: [0, 0, 0.2], neck_01: [0.15, 0, -0.35] },
  // зігнувся вперед, руки до колін, голова задерта — дивиться знизу
  { ...ARMS_DOWN, spine_01: [0.3, 0, 0], spine_02: [0.45, 0, 0], neck_01: [-0.6, 0, 0], head: [-0.35, 0, 0] },
  // голова майже лежить на плечі, плечі підняті
  { upperarm_l: [0, 0, -0.85], upperarm_r: [0, 0, 0.85], lowerarm_l: [-0.6, 0, 0], lowerarm_r: [-0.6, 0, 0], neck_01: [0.1, 0, 0.9] },
  // обидві руки підняті до обличчя
  { upperarm_l: [-1.3, 0, -0.6], upperarm_r: [-1.3, 0, 0.6], lowerarm_l: [0, 0, -1.6], lowerarm_r: [0, 0, 1.6], neck_01: [0.3, 0, 0] }
];

export interface StalkerEvents {
  onCatch?(s: Stalker): void;
  /** «Наблюдатель» помітно наблизився, поки гравець не дивився (для різкого звуку). */
  onCloser?(s: Stalker, by: number): void;
}

export class Stalker {
  readonly root = new THREE.Group();
  readonly brain: Brain;
  readonly pos: V3;
  private path: V3[] = [];
  private repath = 0;
  private readonly bones = new Map<string, { b: THREE.Bone; rest: THREE.Euler }>();
  private gait = 0;
  private yaw = 0;
  private flickT = 0;
  private flickOn = false;
  private seenAt: V3 | null = null;
  private wasSeen = true;
  private catchCd = 0;
  /** Швидкість в останньому кадрі, м/с. */
  speedNow = 0;
  private stepT = 0;
  /** Крок (для звуку): позиція й гучність 0..1. */
  onStep: ((x: number, z: number, loud: number) => void) | null = null;

  constructor(readonly kind: StalkerKind, model: THREE.Object3D, private readonly nav: NavLike, physics: Physics,
    private readonly lamps: Lamps, private readonly doors: Doors, private readonly home: V3, private readonly ev: StalkerEvents = {}) {
    this.pos = { ...home };
    this.root.add(model);
    model.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (m.isMesh) {
        const src = m.material as THREE.MeshStandardMaterial;
        const mat = probeLit(src, 0.55);
        const n = src.name.toLowerCase(), c = (r: number, g: number, b: number) => new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace);
        // мертва шкіра: знекровлена, сірувато-воскова, волога; очі «Наблюдателя» — суцільно чорні; роба — брудна, темна
        if (n.includes('body')) { mat.color = kind === 'blind' ? c(0.62, 0.6, 0.56) : c(0.4, 0.38, 0.36); mat.roughness = 0.48; }
        else if (n.includes('worksuit')) { mat.map = null; mat.color = c(0.09, 0.095, 0.085); mat.roughness = 0.9; } // роба, чорна від бруду й часу
        else if (n.includes('low-poly') || n.includes('eye')) { mat.color = c(0.01, 0.01, 0.01); mat.roughness = 0.15; }
        m.material = mat;
        m.castShadow = true;
        m.frustumCulled = false;
      }
      const b = o as THREE.Bone;
      if (b.isBone) this.bones.set(b.name, { b, rest: b.rotation.clone() });
    });
    const senses = { los: (a: V3, b: V3) => physics.lineOfSight(a.x, a.y, a.z, b.x, b.y, b.z) };
    this.brain = new Brain(TRAITS[kind], nav, senses, this.pos);
    this.applyPose(kind === 'watcher' ? WATCHER_POSES[0] as Pose : {});
    this.place();
  }

  /** Повернути на «домашню» точку (після того, як гравця схопили). */
  reset(): void {
    Object.assign(this.pos, this.home);
    this.path = [];
    this.brain.state = 'patrol';
    Object.assign(this.brain.mem, { last: null, confidence: 0, age: 0, suspicion: 0 });
    this.catchCd = 4;
    this.seenAt = null;
    this.lamps.dimAround(this.pos.x, this.pos.z, 6, 1);
    this.place();
  }

  hear(x: number, y: number, z: number, loudness: number): void {
    this.brain.hear({ x, y, z, loudness, t: 0 });
  }

  private applyPose(p: Pose): void {
    for (const { b, rest } of this.bones.values()) b.rotation.copy(rest);
    for (const [name, [x, y, z]] of Object.entries(p)) {
      const e = this.bones.get(name);
      if (e) e.b.rotation.set(e.rest.x + x, e.rest.y + y, e.rest.z + z);
    }
  }

  private place(): void {
    this.root.position.set(this.pos.x, this.root.position.y, this.pos.z);
    this.root.rotation.y = this.yaw;
  }

  private turnTo(x: number, z: number, rate: number): void {
    const want = Math.atan2(x - this.pos.x, z - this.pos.z);
    this.yaw += Math.atan2(Math.sin(want - this.yaw), Math.cos(want - this.yaw)) * Math.min(1, rate);
  }

  update(dt: number, p: PlayerView): void {
    this.catchCd = Math.max(0, this.catchCd - dt);
    const eye = { x: this.pos.x, y: this.kind === 'watcher' ? 2.0 : 1.5, z: this.pos.z };
    const intent = this.brain.update(dt, p, eye);
    let moved = 0;
    if (intent.target && intent.speed > 0) {
      this.repath -= dt;
      if (this.repath <= 0 || !this.path.length) {
        this.path = this.nav.path(this.pos, intent.target);
        this.repath = 0.45;
      }
      let step = intent.speed * dt;
      while (step > 0 && this.path.length) {
        const n = this.path[0] as V3;
        const dx = n.x - this.pos.x, dz = n.z - this.pos.z, d = Math.hypot(dx, dz);
        if (d <= step) { this.pos.x = n.x; this.pos.z = n.z; step -= d; moved += d; this.path.shift(); continue; }
        this.pos.x += (dx / d) * step; this.pos.z += (dz / d) * step; moved += step;
        this.turnTo(n.x, n.z, dt * 8);
        step = 0;
      }
    } else if (intent.lookAt) {
      this.turnTo(intent.lookAt.x, intent.lookAt.z, dt * (this.kind === 'watcher' ? 20 : 2));
    }
    this.speedNow = dt > 0 ? moved / dt : 0;
    this.place();
    this.openDoorsNear();
    if (this.kind === 'watcher') this.watcherLook(p); else this.blindGait(dt);
    this.tension(dt, p);
    const d = Math.hypot(p.x - this.pos.x, p.z - this.pos.z);
    const can = this.kind === 'watcher' ? !p.looksAtMe : intent.attack || this.brain.state === 'chase' || this.brain.state === 'investigate';
    if (this.catchCd <= 0 && d < 1.05 && can) {
      this.catchCd = 6;
      this.ev.onCatch?.(this);
    }
  }

  /** «Наблюдатель»: поки його бачать — нерухомий; щойно перестали — нова поза; знову побачили ближче — сигнал. */
  private watcherLook(p: PlayerView): void {
    const seen = p.looksAtMe;
    if (!seen && this.wasSeen) {
      this.seenAt = { ...this.pos };
      this.applyPose(WATCHER_POSES[Math.floor(Math.random() * WATCHER_POSES.length)] as Pose);
    }
    if (seen && !this.wasSeen && this.seenAt) {
      const by = Math.hypot(this.seenAt.x - this.pos.x, this.seenAt.z - this.pos.z);
      if (by > 2.5) this.ev.onCloser?.(this, by);
    }
    // голова повернута до гравця — навіть коли тіло стоїть боком
    const h = this.bones.get('head');
    if (h) {
      const want = Math.atan2(p.x - this.pos.x, p.z - this.pos.z) - this.yaw;
      h.b.rotation.y = h.rest.y + Math.max(-1.1, Math.min(1.1, Math.atan2(Math.sin(want), Math.cos(want))));
    }
    this.wasSeen = seen;
  }

  /** «Слепой»: згорблений, голова задерта (слухає), смикана хода з довгими руками, що звисають. */
  private blindGait(dt: number): void {
    const v = this.speedNow;
    const rate = 1.6 + v * 2.2;
    this.gait += dt * rate;
    const a = Math.min(1, v / 1.2), s = Math.sin(this.gait), c = Math.cos(this.gait);
    const twitch = Math.sin(this.gait * 7.3) > 0.93 ? 0.25 : 0;
    const listen = this.brain.state === 'suspicious' ? 0.5 : 0;
    this.applyPose({
      spine_01: [0.3, 0, 0], spine_02: [0.4, 0, s * 0.06 * a], spine_03: [0.2, 0, 0],
      neck_01: [-0.5 - listen, twitch, 0], head: [-0.4 - listen * 0.6, Math.sin(this.gait * 0.37) * 0.45, 0.2 + twitch * 0.6],
      upperarm_l: [0.25 - s * 0.3 * a, 0, -0.8], upperarm_r: [0.25 + s * 0.3 * a, 0, 0.8],
      lowerarm_l: [0, 0, -0.2], lowerarm_r: [0, 0, 0.2],
      thigh_l: [0.35 + s * 0.5 * a, 0, 0], thigh_r: [0.35 - s * 0.5 * a, 0, 0],
      calf_l: [-0.6 - Math.max(0, c) * 0.7 * a, 0, 0], calf_r: [-0.6 - Math.max(0, -c) * 0.7 * a, 0, 0]
    });
    this.root.position.y = -0.12 - Math.abs(s) * 0.04 * a;
    this.stepT += dt;
    if (a > 0.2 && this.stepT > Math.PI / rate) { this.stepT = 0; this.onStep?.(this.pos.x, this.pos.z, 0.3 + a * 0.7); }
  }

  /** Двері на шляху відчиняє сам (з рипом — гравець чує, що хтось іде). */
  private openDoorsNear(): void {
    for (const d of this.doors.list) {
      if (d.target > 0.1) continue;
      const hp = d.pivot.position;
      if (Math.hypot(hp.x - this.pos.x, hp.z - this.pos.z) < 1.3) this.doors.toggle(d);
    }
  }

  /** Напруга: що ближче й активніший, то частіше блимають лампи довкола нього. */
  private tension(dt: number, p: PlayerView): void {
    const d = Math.hypot(p.x - this.pos.x, p.z - this.pos.z);
    const hunting = this.brain.state === 'chase' || this.brain.state === 'investigate' || this.brain.state === 'search';
    const k = (hunting ? 1 : 0.35) * Math.max(0, 1 - d / 26);
    this.flickT -= dt;
    if (this.flickT > 0) return;
    if (this.flickOn) { this.lamps.dimAround(this.pos.x, this.pos.z, 4.5, 1); this.flickOn = false; this.flickT = 0.2 + Math.random() * (2.5 - 2 * k); return; }
    if (Math.random() < k) { this.lamps.dimAround(this.pos.x, this.pos.z, 4.5, Math.random() * 0.35); this.flickOn = true; this.flickT = 0.05 + Math.random() * 0.18; }
    else this.flickT = 0.3;
  }
}
