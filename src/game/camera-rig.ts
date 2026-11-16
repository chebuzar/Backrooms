// Камера від першої особи: згладжування між кроками фізики, похитування від кроків,
// легкий нахил, «дихання» на місці. Усе в метрах і радіанах.
import type * as THREE from 'three/webgpu';
import type { Player } from './player';

export class CameraRig {
  private t = 0;
  /** Додаткові поштовхи камери (страх, удар): затухають самі. */
  shake = 0;

  constructor(private readonly camera: THREE.PerspectiveCamera) {
    camera.rotation.order = 'YXZ';
  }

  update(p: Player, alpha: number, dt: number): void {
    this.t += dt;
    const x = p.prev.x + (p.pos.x - p.prev.x) * alpha;
    const y = p.prev.y + (p.pos.y - p.prev.y) * alpha;
    const z = p.prev.z + (p.pos.z - p.prev.z) * alpha;
    const a = p.bobAmp, ph = p.bobPhase;
    const breathe = Math.sin(this.t * 1.7) * 0.006 * (1 - Math.min(1, a));
    const bobY = (Math.abs(Math.sin(ph)) - 0.5) * 0.045 * a + breathe;
    const bobX = Math.sin(ph) * 0.022 * a;
    const sin = Math.sin(p.yaw), cos = Math.cos(p.yaw);
    this.shake = Math.max(0, this.shake - dt * 1.8);
    const s = this.shake * this.shake;
    const n = (k: number) => Math.sin(this.t * k) * Math.sin(this.t * k * 1.31);
    this.camera.position.set(x + cos * bobX + n(37) * s * 0.03, y + p.eye + bobY + n(41) * s * 0.03, z - sin * bobX);
    this.camera.rotation.set(p.pitch + Math.sin(ph * 2) * 0.004 * a + n(29) * s * 0.02, p.yaw, Math.sin(ph) * 0.006 * a + n(23) * s * 0.03);
  }
}
