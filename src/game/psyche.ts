// Психологічний шар: нерви Оператора і все, що від них стається.
// • Галюцинації (LAYER_EYE): людина в кінці коридору, яку видно лише очима — камера показує порожнечу.
// • Справжні люди (шар камери): ті, що стоять лицем до стіни, — видно лише крізь камеру; побачив — нерви.
// • Тиша: гул ламп і фон стихають на кілька секунд, лишається серце; кінчається одним звуком поруч.
// • Кімнати змінюються: двері за спиною тихо стають інакше, ніж були.
// • Годинник бреше, кадр темнішає по краях (look.dread).
import * as THREE from 'three/webgpu';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import type { Level } from '../world/level0';
import { probeAt } from '../world/materials';
import { LAYER_EYE } from './camcorder';
import { stepNerves, dreadOf, watchLies, NERVES } from './nerves';

export interface PsycheCtx {
  x: number; z: number; yaw: number;
  camera: THREE.Camera;
  /** Камера піднята (кадр крізь видошукач). */
  camUp: boolean;
  flashlight: boolean;
  danger: number;
  hidden: boolean;
  playing: boolean;
  /** Відстань до перешкоди по горизонталі від точки в напрямку (для місця галюцинації). */
  ray: (x: number, z: number, dx: number, dz: number, max: number) => number;
}

export interface PsycheEvents {
  /** Тиша закінчилась: один звук поруч (x, z). */
  silenceEnd?: (x: number, z: number) => void;
  /** Галюцинація зникла на очах. */
  ghostGone?: (seen: boolean) => void;
  /** Побачив крізь камеру людину лицем до стіни. */
  sawStill?: () => void;
}

const rnd = Math.random;

export class Psyche {
  nerves = 0;
  /** 0..1: наскільки зараз тиша (множник для гулу й фону: 1 − silence). */
  silence = 0;
  events: PsycheEvents = {};
  private lvl: Level | null = null;
  private figure: THREE.Object3D | null = null;
  private ghost: { o: THREE.Object3D; age: number; seen: boolean; away: number } | null = null;
  private ghostCd = 50;
  /** Сюжетна галюцинація: з'явиться незалежно від нервів. */
  private ghostForced = false;
  private silenceCd = 80;
  private silenceT = 0;
  private silenceHold = 0;
  private doorCd = 35;
  private lightT = 0;
  private light = 1;
  private stills: { p: THREE.Vector3; seen: boolean }[] = [];
  private readonly frustum = new THREE.Frustum();
  private readonly m = new THREE.Matrix4();
  private readonly v = new THREE.Vector3();

  attach(lvl: Level, figure: THREE.Object3D | null, unseen: THREE.Object3D | null): void {
    this.lvl = lvl;
    this.figure = figure;
    this.ghost = null;
    this.silence = 0; this.silenceT = 0;
    this.ghostForced = false;
    this.ghostCd = 45 + rnd() * 30; this.silenceCd = 70 + rnd() * 50; this.doorCd = 30 + rnd() * 20;
    this.stills = [];
    // прихований зразок «людини вдалині»: прогрів рівня збирає його шейдер заздалегідь, і перша поява — без ривка
    if (figure) { const proto = makeGhost(figure); proto.visible = false; proto.position.set(0, -20, 0); lvl.scene.add(proto); }
    unseen?.traverse((o) => {
      if (o.parent === unseen && !(o as THREE.InstancedMesh).isInstancedMesh) this.stills.push({ p: o.position.clone().setY(1.2), seen: false });
    });
  }

  /** Перша зустріч: людина вдалині з'явиться через delay секунд (коли попереду буде довгий прохід). */
  scriptGhost(delay: number): void { if (!this.ghost) { this.ghostForced = true; this.ghostCd = delay; } }

  /** Смерть: нерви не обнуляються. */
  afterDeath(): void { this.nerves = Math.max(this.nerves, NERVES.afterDeath); this.removeGhost(); }

  shock(k: number): void { this.nerves = Math.min(1, this.nerves + k); }

  get dread(): number { return dreadOf(this.nerves); }

  lies(): boolean { return watchLies(this.nerves, rnd()); }

  private inView(cam: THREE.Camera, p: THREE.Vector3): boolean {
    this.m.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.m);
    return this.frustum.containsPoint(p);
  }

  update(dt: number, c: PsycheCtx): void {
    const lvl = this.lvl;
    if (!lvl || !c.playing) return;
    if ((this.lightT -= dt) <= 0) { this.lightT = 0.4; this.light = probeAt(lvl.layout.lights, c.x, c.z); }
    this.nerves = stepNerves(this.nerves, dt, { light: this.light, flashlight: c.flashlight, danger: c.danger, hidden: c.hidden });
    this.updateGhost(dt, c, lvl);
    this.updateSilence(dt, c);
    this.updateDoors(dt, c, lvl);
    // справжні люди крізь камеру: перший погляд на кожного — удар по нервах
    if (c.camUp) for (const s of this.stills) {
      if (s.seen || Math.hypot(s.p.x - c.x, s.p.z - c.z) > 12 || !this.inView(c.camera, s.p)) continue;
      if (c.ray(c.x, c.z, s.p.x - c.x, s.p.z - c.z, 12) + 0.6 < Math.hypot(s.p.x - c.x, s.p.z - c.z)) continue;
      s.seen = true;
      this.shock(0.12);
      this.events.sawStill?.();
    }
  }

  // --- галюцинація: людина вдалині, лише для очей
  private updateGhost(dt: number, c: PsycheCtx, lvl: Level): void {
    const g = this.ghost;
    if (g) {
      g.age += dt;
      const d = Math.hypot(g.o.position.x - c.x, g.o.position.z - c.z);
      const vis = !c.camUp && this.inView(c.camera, this.v.copy(g.o.position).setY(1.3));
      if (vis) { g.seen = true; g.away = 0; } else g.away += dt;
      // зникає: підійшов ближче, підняв камеру (у кадрі її нема), відвернувся, або просто час
      if (d < 5.5 || c.camUp || (g.seen && g.away > 1.2) || g.age > 16) {
        const seenGone = vis || c.camUp;
        this.removeGhost();
        this.events.ghostGone?.(seenGone && g.seen);
        if (seenGone && g.seen) this.shock(0.05);
      }
      return;
    }
    if (!this.figure || (this.nerves < 0.35 && !this.ghostForced) || c.camUp || c.hidden) return;
    this.ghostCd -= dt * (this.ghostForced ? 1 : 0.6 + this.nerves);
    if (this.ghostCd > 0) return;
    this.ghostCd = 55 + rnd() * 50;
    // точка попереду, у полі зору, 7–15 м, на прямій видимості
    const fx = -Math.sin(c.yaw), fz = -Math.cos(c.yaw);
    const far = c.ray(c.x, c.z, fx, fz, 16) - 0.7;
    if (far < 7) { this.ghostCd = this.ghostForced ? 1.5 : 8; return; }
    this.ghostForced = false;
    const d = Math.min(far, 9 + rnd() * 6);
    const x = c.x + fx * d, z = c.z + fz * d;
    const o = makeGhost(this.figure);
    o.position.set(x, 0, z);
    o.rotation.y = Math.atan2(c.x - x, c.z - z);
    lvl.scene.add(o);
    this.ghost = { o, age: 0, seen: false, away: 0 };
  }

  private removeGhost(): void {
    const g = this.ghost;
    if (!g) return;
    g.o.removeFromParent();
    g.o.traverse((n) => { const mm = n as THREE.Mesh; if (mm.isMesh) (mm.material as THREE.Material).dispose(); });
    this.ghost = null;
  }

  // --- тиша: усе стихає, лишається серце; закінчується одним звуком поруч
  private updateSilence(dt: number, c: PsycheCtx): void {
    if (this.silenceT > 0) {
      this.silenceT -= dt;
      this.silence = Math.min(1, this.silence + dt / 1.6);
      if (this.silenceT <= 0) {
        const a = c.yaw + Math.PI + (rnd() - 0.5) * 1.2;
        this.events.silenceEnd?.(c.x - Math.sin(a) * 4, c.z - Math.cos(a) * 4);
        this.shock(0.06);
      }
      return;
    }
    this.silence = Math.max(0, this.silence - dt / 0.6);
    if (this.nerves < 0.22 || c.danger > 0.3) return;
    this.silenceCd -= dt * (0.5 + this.nerves);
    if (this.silenceCd > 0) return;
    this.silenceCd = 100 + rnd() * 80;
    this.silenceHold = 7 + rnd() * 5;
    this.silenceT = this.silenceHold;
  }

  // --- кімнати змінюються: двері за спиною тихо стають інакше
  private updateDoors(dt: number, c: PsycheCtx, lvl: Level): void {
    if (this.nerves < 0.18) return;
    this.doorCd -= dt;
    if (this.doorCd > 0) return;
    this.doorCd = 35 + rnd() * 35;
    const fx = -Math.sin(c.yaw), fz = -Math.cos(c.yaw);
    const cand = lvl.doors.list.filter((d) => {
      const dx = d.cx - c.x, dz = d.cz - c.z, dist = Math.hypot(dx, dz);
      return dist > 4 && dist < 16 && (dx * fx + dz * fz) / dist < -0.2 && Math.abs(d.target - d.angle) < 1e-3;
    });
    const d = cand[Math.floor(rnd() * cand.length)];
    if (!d) return;
    lvl.doors.setSilently(d, d.angle > 0.1 ? 0 : 0.9 + rnd() * 0.5);
  }

  /** Скільки людей лицем до стіни на рівні (для перевірок). */
  get stillCount(): number { return this.stills.length; }
  /** Галюцинація зараз стоїть (для перевірок). */
  get ghostAt(): THREE.Vector3 | null { return this.ghost?.o.position ?? null; }
}

/** «Людина вдалині»: темний силует фігури з розведеними руками, видно лише оком (не крізь камеру). */
function makeGhost(figure: THREE.Object3D): THREE.Object3D {
  const o = cloneSkinned(figure);
  o.scale.setScalar(0.8);
  const dark = new THREE.MeshStandardNodeMaterial({ color: 0x0b0b0a, roughness: 1 });
  o.traverse((n) => {
    const mm = n as THREE.Mesh;
    if (mm.isMesh) { mm.material = dark; mm.frustumCulled = false; mm.layers.set(LAYER_EYE); mm.castShadow = false; }
    const b = n as THREE.Bone;
    if (b.isBone) {
      if (b.name === 'upperarm_l') { b.rotation.y += 1.25; b.rotation.z -= 1.25; }
      if (b.name === 'upperarm_r') { b.rotation.y -= 1.25; b.rotation.z += 1.25; }
    }
  });
  return o;
}
