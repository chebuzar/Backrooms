// Ядро гри: фіксований крок фізики (60 Гц), рендер із частотою екрана, камера згладжується між кроками.
import * as THREE from 'three/webgpu';
import type { RendererHandle } from '../render/renderer';
import { PostPipeline, look } from '../render/post';
import { QualityGovernor, type QualityProfile } from '../render/quality';
import type { DeviceInfo } from '../core/device';
import { Physics } from '../physics/physics';
import { Player } from './player';
import { CameraRig } from './camera-rig';
import { Input } from '../input/input';
import { buildTestScene } from '../dev/testScene';

const STEP = 1 / 60;

export class Game {
  readonly camera = new THREE.PerspectiveCamera(72, 16 / 9, 0.05, 150);
  scene = new THREE.Scene();
  readonly post: PostPipeline;
  readonly governor = new QualityGovernor();
  readonly input: Input;
  readonly rig: CameraRig;
  player!: Player;
  physics!: Physics;
  private acc = 0;
  private last = performance.now();
  private time = 0;
  private levelUpdate: (t: number) => void = () => {};
  paused = false;

  constructor(readonly gfx: RendererHandle, readonly device: DeviceInfo, public profile: QualityProfile) {
    const canvas = gfx.renderer.domElement;
    this.post = new PostPipeline(gfx.renderer, this.scene, this.camera);
    this.input = new Input(canvas, document.getElementById('ui') as HTMLElement, { sensitivity: 1, invertY: false, crouchToggle: false });
    this.rig = new CameraRig(this.camera);
    canvas.addEventListener('click', () => this.input.lockPointer());
    addEventListener('resize', () => this.resize());
  }

  async init(): Promise<void> {
    this.physics = await Physics.create();
    const lvl = buildTestScene(this.physics);
    this.setScene(lvl.scene);
    this.levelUpdate = lvl.update;
    this.player = new Player(this.physics, ...lvl.spawn);
    this.input.touch?.show(true);
    this.resize();
  }

  private setScene(s: THREE.Scene): void {
    this.scene = s;
    this.post.scene = s;
    this.post.apply(this.profile);
  }

  resize(): void {
    const w = innerWidth, h = innerHeight;
    const r = this.gfx.renderer;
    r.setPixelRatio(Math.min(this.device.dpr, this.profile.maxPixelRatio) * this.governor.scale);
    r.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    look.aspect.value = w / h;
  }

  frame(): void {
    const now = performance.now();
    const dtMs = Math.min(100, now - this.last);
    this.last = now;
    const dt = dtMs / 1000;
    if (this.governor.update(dtMs)) this.resize();
    this.input.poll(dt);
    const [lx, ly] = this.input.takeLook();
    if (!this.paused) {
      this.player.look(lx, ly);
      this.acc += dt;
      const m = { x: this.input.move.x, y: this.input.move.y, run: this.input.run, crouch: this.input.crouch };
      while (this.acc >= STEP) {
        this.player.update(STEP, m);
        this.physics.step();
        this.acc -= STEP;
      }
      this.time += dt;
      this.levelUpdate(this.time);
    }
    this.rig.update(this.player, this.acc / STEP, dt);
    this.post.render();
  }

  start(): void {
    this.gfx.renderer.setAnimationLoop(() => this.frame());
  }
}
