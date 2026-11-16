// Керування: клавіатура+миша, геймпад, сенсорний екран — усе зводиться до одних «дій».
import { TouchControls } from './touch';

export type Action = 'interact' | 'flashlight' | 'pause' | 'camera' | 'journal';

export interface InputSettings {
  sensitivity: number; // 0.2..3
  invertY: boolean;
  crouchToggle: boolean;
}

export class Input {
  readonly move = { x: 0, y: 0 };
  lookX = 0; // рад за кадр
  lookY = 0;
  run = false;
  crouch = false;
  private keys = new Set<string>();
  private pressed = new Set<Action>();
  private crouchLatched = false;
  private padPrev: boolean[] = [];
  readonly touch: TouchControls | null;
  enabled = true;
  lastDevice: 'keyboard' | 'gamepad' | 'touch' = 'keyboard';

  constructor(private readonly canvas: HTMLCanvasElement, uiRoot: HTMLElement, public settings: InputSettings) {
    addEventListener('keydown', (e) => this.onKey(e, true));
    addEventListener('keyup', (e) => this.onKey(e, false));
    addEventListener('blur', () => { this.keys.clear(); this.run = false; });
    addEventListener('mousemove', (e) => {
      if (!this.enabled || document.pointerLockElement !== this.canvas) return;
      const k = 0.0021 * this.settings.sensitivity;
      this.lookX += e.movementX * k;
      this.lookY += e.movementY * k * (this.settings.invertY ? -1 : 1);
    });
    const touchCapable = navigator.maxTouchPoints > 0 || 'ontouchstart' in window;
    this.touch = touchCapable ? new TouchControls(uiRoot, this) : null;
  }

  /** Захопити мишу (лише на ПК; на iOS pointer lock немає). */
  lockPointer(): void {
    if (this.touch?.active) return;
    const r = this.canvas.requestPointerLock?.() as unknown;
    if (r instanceof Promise) r.catch(() => {});
  }

  get pointerLocked(): boolean { return document.pointerLockElement === this.canvas; }

  private onKey(e: KeyboardEvent, down: boolean): void {
    this.lastDevice = 'keyboard';
    if (down && !e.repeat) {
      const a = ({ KeyE: 'interact', KeyF: 'flashlight', Escape: 'pause', KeyP: 'pause', KeyV: 'camera', Tab: 'journal', KeyJ: 'journal' } as Record<string, Action>)[e.code];
      if (a) { this.pressed.add(a); if (e.code === 'Tab') e.preventDefault(); }
      if ((e.code === 'KeyC' || e.code === 'ControlLeft') && this.settings.crouchToggle) this.crouchLatched = !this.crouchLatched;
    }
    if (down) this.keys.add(e.code); else this.keys.delete(e.code);
  }

  /** Дія, що натиснута з минулого кадру (одноразово). */
  consume(a: Action): boolean {
    const had = this.pressed.has(a);
    this.pressed.delete(a);
    return had;
  }

  press(a: Action): void { this.pressed.add(a); }

  /** Зібрати стан на початку кадру. */
  poll(dt: number): void {
    const k = this.keys;
    let x = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    let y = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    let run = k.has('ShiftLeft') || k.has('ShiftRight');
    let crouch = this.settings.crouchToggle ? this.crouchLatched : k.has('KeyC') || k.has('ControlLeft');

    // геймпад (стандартна розкладка)
    const pads = navigator.getGamepads?.() ?? [];
    for (const p of pads) {
      if (!p || p.mapping !== 'standard') continue;
      const dz = (v: number) => (Math.abs(v) < 0.15 ? 0 : (v - Math.sign(v) * 0.15) / 0.85);
      const lx = dz(p.axes[0] ?? 0), ly = dz(p.axes[1] ?? 0), rx = dz(p.axes[2] ?? 0), ry = dz(p.axes[3] ?? 0);
      const b = p.buttons.map((bt) => bt.pressed);
      if (lx || ly || rx || ry || b.some(Boolean)) this.lastDevice = 'gamepad';
      if (lx || ly) { x = lx; y = -ly; }
      const rate = 2.8 * this.settings.sensitivity * dt;
      this.lookX += Math.sign(rx) * rx * rx * rate;
      this.lookY += Math.sign(ry) * ry * ry * rate * (this.settings.invertY ? -1 : 1);
      if (b[10] || b[7]) run = true;
      const edge = (i: number) => !!b[i] && !this.padPrev[i];
      if (edge(0)) this.pressed.add('interact');
      if (edge(3)) this.pressed.add('flashlight');
      if (edge(9)) this.pressed.add('pause');
      if (edge(8)) this.pressed.add('journal');
      if (edge(2)) this.pressed.add('camera');
      if (edge(1)) this.crouchLatched = !this.crouchLatched;
      if (b[1] !== undefined) crouch = crouch || this.crouchLatched;
      this.padPrev = b;
    }

    // сенсорне керування
    if (this.touch?.active) {
      const t = this.touch;
      if (t.stickX || t.stickY) { x = t.stickX; y = t.stickY; this.lastDevice = 'touch'; }
      // як у мобільних іграх: стік до краю вперед — біг (кнопка бігу теж працює)
      run = run || t.run || (t.stickY > 0.93 && Math.hypot(t.stickX, t.stickY) > 0.97);
      crouch = crouch || t.crouch;
    }

    if (!this.enabled) { x = y = 0; run = false; }
    this.move.x = x; this.move.y = y;
    this.run = run; this.crouch = crouch;
  }

  /** Забрати накопичений поворот погляду. */
  takeLook(): [number, number] {
    const r: [number, number] = [this.lookX, this.lookY];
    this.lookX = 0; this.lookY = 0;
    return this.enabled ? r : [0, 0];
  }
}
