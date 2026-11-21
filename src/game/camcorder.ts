// Відеокамера «Электроника» як предмет у руках (V): піднята до ока — видошукач з REC, лічильник касети, заряд,
// приближення ×2 (Z / колесо). Крізь камеру видно приховане: шар LAYER_CAM (сліди, силуети) вмикається лише в ній,
// а галюцинації (шар LAYER_EYE) камера не бачить — так гравець перевіряє, чи справжнє те, що він бачить.
import type * as THREE from 'three/webgpu';

/** Видно лише крізь камеру. */
export const LAYER_CAM = 1;
/** Видно лише оком (галюцинації). */
export const LAYER_EYE = 2;

export class Camcorder {
  up = false;
  /** Плавний підйом 0..1. */
  k = 0;
  zoom = false;
  zoomK = 0;
  /** Заряд 0..1 (≈ 6 хв запису). */
  charge = 1;
  /** Лічильник касети, с. */
  tape = 0;
  private static readonly DRAIN = 1 / 360;

  toggle(): boolean {
    if (!this.up && this.charge <= 0) return false;
    this.up = !this.up;
    if (!this.up) this.zoom = false;
    return true;
  }

  lower(): void { this.up = false; this.zoom = false; }

  toggleZoom(): boolean {
    if (!this.up) return false;
    this.zoom = !this.zoom;
    return true;
  }

  /** Крок часу; повертає true, якщо камера щойно розрядилася. */
  update(dt: number, playing: boolean): boolean {
    const tgt = this.up ? 1 : 0;
    this.k += (tgt - this.k) * Math.min(1, dt * 9);
    if (Math.abs(tgt - this.k) < 1e-3) this.k = tgt;
    const zt = this.zoom && this.up ? 1 : 0;
    this.zoomK += (zt - this.zoomK) * Math.min(1, dt * 10);
    if (Math.abs(zt - this.zoomK) < 1e-3) this.zoomK = zt;
    if (!this.up || !playing) return false;
    this.tape += dt;
    const was = this.charge;
    this.charge = Math.max(0, this.charge - dt * Camcorder.DRAIN);
    if (was > 0 && this.charge <= 0) { this.lower(); return true; }
    return false;
  }

  /** Що бачить кадр: око чи камера. */
  applyLayers(cam: THREE.Camera): void {
    const seeCam = this.k > 0.5;
    if (seeCam) { cam.layers.enable(LAYER_CAM); cam.layers.disable(LAYER_EYE); }
    else { cam.layers.disable(LAYER_CAM); cam.layers.enable(LAYER_EYE); }
  }
}
