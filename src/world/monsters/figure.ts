// «Фигура» (рівень 0) — Лисицин у прогумованому костюмі Л-1 і протигазі ГП-5, ~2.35 м. Не нападає: лише присутність.
// Правила: з'являється вдалині (кінець коридору чи залу), коли лампи довкола неї на мить блимають; стоїть нерухомо, лише
// ледь повертає голову за гравцем. Довго дивишся на неї чи підходиш ближче — лампи довкола гаснуть, і коли світло
// повертається, її вже немає. Довгі паузи між появами: напруга важливіша за скример (GDD).
import * as THREE from 'three/webgpu';
import type { Physics } from '../../physics/physics';
import type { Layout } from '../layout';
import type { Lamps } from '../lamps';
import { probeAt, probeLit } from '../materials';

type State = 'idle' | 'blink-in' | 'shown' | 'vanish';
export interface FigureEvents { onAppear?(x: number, z: number): void; onVanish?(x: number, z: number, seen: boolean): void }

export class Figure {
  readonly root = new THREE.Group();
  private state: State = 'idle';
  private t = 0;
  /** Секунди до наступної спроби з'явитися. */
  cooldown = 70;
  private seen = 0;
  private shownFor = 0;
  appearances = 0;
  private head: THREE.Bone | null = null;
  private readonly tmp = new THREE.Vector3();

  constructor(model: THREE.Object3D, private readonly l: Layout, private readonly physics: Physics, private readonly lamps: Lamps,
    private readonly ev: FigureEvents = {}) {
    this.root.add(model);
    this.root.visible = false;
    model.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (m.isMesh) {
        m.material = probeLit(m.material as THREE.Material, 0.9);
        m.castShadow = true;
        m.frustumCulled = false;
      }
      const b = o as THREE.Bone;
      if (b.isBone) {
        if (b.name === 'head') this.head = b;
        // з A-пози: руки опущені вздовж тіла — неприродно довгі, пальці майже біля колін
        if (b.name === 'upperarm_l') b.rotation.y += 1.2;
        if (b.name === 'upperarm_r') b.rotation.y -= 1.2;
        if (b.name === 'neck_01') b.rotation.x += 0.18; // голова трохи вперед і вниз — «прислухається»
      }
    });
  }

  get visible(): boolean { return this.root.visible; }

  private free(x: number, z: number, m: number): boolean {
    if (x < m || z < m || x > this.l.cols * this.l.cell - m || z > this.l.rows * this.l.cell - m) return false;
    return !this.l.walls.some((w) => Math.abs(x - w.x) < w.w / 2 + m && Math.abs(z - w.z) < w.d / 2 + m);
  }

  /** Знайти місце вдалині в полі зору: вільно, видно від очей, освітлено (силует), 9–19 м. */
  private findSpot(cam: THREE.Camera): [number, number] | null {
    const p = cam.position, f = this.tmp.set(0, 0, -1).applyQuaternion(cam.quaternion);
    const yaw0 = Math.atan2(f.x, f.z);
    let best: [number, number] | null = null, bestScore = -1;
    for (let k = 0; k < 40; k++) {
      const a = yaw0 + (Math.random() - 0.5) * 0.9, d = 9 + Math.random() * 10;
      const x = p.x + Math.sin(a) * d, z = p.z + Math.cos(a) * d;
      if (!this.free(x, z, 0.45)) continue;
      if (!this.physics.lineOfSight(p.x, p.y, p.z, x, 1.9, z)) continue;
      const lit = probeAt(this.l.lights, x, z);
      const score = d * 0.05 + lit;
      if (lit > 0.45 && score > bestScore) { best = [x, z]; bestScore = score; }
    }
    return best;
  }

  update(dt: number, cam: THREE.PerspectiveCamera, active: boolean): void {
    this.t += dt;
    const r = this.root.position;
    if (this.state === 'idle') {
      if (!active || this.appearances >= 6) return;
      this.cooldown -= dt;
      if (this.cooldown > 0) return;
      const spot = this.findSpot(cam);
      if (!spot) { this.cooldown = 4; return; }
      r.set(spot[0], 0, spot[1]);
      this.root.rotation.y = Math.atan2(cam.position.x - spot[0], cam.position.z - spot[1]);
      this.lamps.dimAround(spot[0], spot[1], 3.2, 0.04); // мить темряви — і вона вже там
      this.state = 'blink-in'; this.t = 0; this.seen = 0; this.shownFor = 0;
      return;
    }
    if (this.state === 'blink-in') {
      if (this.t > 0.22) {
        this.root.visible = true;
        this.lamps.dimAround(r.x, r.z, 3.2, 0.55); // довкола неї світло лишається тьмяним, нерівним
        this.state = 'shown'; this.t = 0;
        this.appearances++;
        this.ev.onAppear?.(r.x, r.z);
      }
      return;
    }
    if (this.state === 'shown') {
      this.shownFor += dt;
      const p = cam.position, dx = r.x - p.x, dz = r.z - p.z, dist = Math.hypot(dx, dz);
      const f = this.tmp.set(0, 0, -1).applyQuaternion(cam.quaternion);
      const look = (f.x * dx + f.z * dz) / Math.max(1e-3, dist * Math.hypot(f.x, f.z));
      const visible = look > Math.cos(0.32) && this.physics.lineOfSight(p.x, p.y, p.z, r.x, 1.9, r.z);
      if (visible) this.seen += dt;
      // голова повільно повертається слідом за гравцем (тіло нерухоме)
      if (this.head) {
        const want = Math.atan2(p.x - r.x, p.z - r.z) - this.root.rotation.y;
        this.head.rotation.y += (Math.atan2(Math.sin(want), Math.cos(want)) * 0.8 - this.head.rotation.y) * Math.min(1, dt * 0.6);
      }
      if (this.seen > 1.6 || dist < 7.5 || (this.shownFor > 30 && !visible)) {
        this.lamps.dimAround(r.x, r.z, 3.6, 0.0);
        this.state = 'vanish'; this.t = 0;
        this.ev.onVanish?.(r.x, r.z, this.seen > 0.3);
      }
      return;
    }
    if (this.state === 'vanish' && this.t > 0.5) {
      this.root.visible = false;
      this.lamps.dimAround(r.x, r.z, 3.6, 1);
      this.state = 'idle';
      this.cooldown = 80 + Math.random() * 90;
    }
  }
}
