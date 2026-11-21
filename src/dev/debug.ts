// Debug-панель (лише з ?debug): живі показники кадру й перемикачі кожного ефекту окремо.
// Відкривається клавішею ` (Ё) або кнопкою «DBG» (для iPad без клавіатури). У звичайній грі не завантажується.
import GUI from 'lil-gui';
import * as THREE from 'three/webgpu';
import type { Game } from '../game/game';
import { PROFILES, type QualityName, type QualityProfile } from '../render/quality';
import { look } from '../render/post';
import { bakeLevel } from '../world/materials';

/** Значення ефектів «камери» за замовчуванням — щоб перемикач повертав саме їх. */
const LOOK_DEFAULTS = {
  grain: look.grain.value, vignette: look.vignette.value, aberration: look.aberration.value
};

export class DebugPanel {
  private readonly gui: GUI;
  private readonly stats: HTMLDivElement;
  private frames = 0;
  private acc = 0;
  private maxMs = 0;
  private fogDensity = 0;
  readonly fx = {
    preset: 'auto' as QualityName | 'auto', ao: true, traa: true, bloom: true,
    grain: true, vignette: true, aberration: true,
    fog: true, lightmaps: true, flashlightShadow: true, autoScale: false, fpsCap: '60'
  };

  constructor(private readonly game: Game) {
    game.autoScale = false; // у debug роздільність не «гуляє», щоб заміри були чесні
    this.stats = document.createElement('div');
    this.stats.className = 'dbg-stats';
    this.stats.style.cssText = 'position:fixed;left:8px;top:calc(8px + env(safe-area-inset-top));z-index:60;font:12px/1.35 ui-monospace,Menlo,monospace;'
      + 'color:#d8f5c8;background:rgba(0,0,0,.62);padding:6px 8px;border-radius:6px;pointer-events:none;white-space:pre';
    document.body.appendChild(this.stats);

    const gui = new GUI({ title: 'Debug (` / DBG)', width: 280 });
    gui.domElement.style.zIndex = '61';
    gui.hide();
    this.gui = gui;
    const btn = document.createElement('button');
    btn.textContent = 'DBG';
    btn.className = 'dbg-btn';
    btn.style.cssText = 'position:fixed;left:8px;top:calc(84px + env(safe-area-inset-top));z-index:62;font:12px ui-monospace,monospace;'
      + 'padding:6px 9px;border-radius:6px;border:1px solid #6a6;background:rgba(0,0,0,.6);color:#cfc';
    btn.addEventListener('click', () => this.toggle());
    document.body.appendChild(btn);
    addEventListener('keydown', (e) => { if (e.code === 'Backquote') this.toggle(); });

    const fx = this.fx;
    const repost = () => this.applyPost();
    const q = gui.addFolder('Якість');
    q.add(fx, 'preset', ['auto', 'low', 'medium', 'high', 'ultra']).name('Пресет').onChange(repost);
    q.add(fx, 'fpsCap', ['30', '60', 'off']).name('Обмеження FPS').onChange((v: string) => { game.fpsCap = v === 'off' ? 0 : Number(v); });
    q.add(fx, 'autoScale').name('Авто-роздільність').onChange((v: boolean) => { game.autoScale = v; if (!v) { game.governor.scale = 1; game.resize(); } });
    const p = gui.addFolder('Постобробка');
    p.add(fx, 'ao').name('AO (тіні в кутах)').onChange(repost);
    p.add(fx, 'traa').name('TRAA (згладжування)').onChange(repost);
    p.add(fx, 'bloom').name('Bloom').onChange(repost);
    p.add(look.exposure, 'value', 0.5, 4, 0.01).name('Експозиція');
    p.add(look.bloomStrength, 'value', 0, 1.5, 0.01).name('Сила bloom');
    for (const k of ['grain', 'vignette', 'aberration'] as const) {
      p.add(fx, k).name({ grain: 'Зерно', vignette: 'Віньєтка', aberration: 'Аберація' }[k])
        .onChange((v: boolean) => { look[k].value = v ? LOOK_DEFAULTS[k] : 0; });
    }
    const w = gui.addFolder('Світ');
    w.add(fx, 'fog').name('Туман').onChange((v: boolean) => {
      const f = game.scene.fog as THREE.FogExp2 | null;
      if (f) { if (!v) { this.fogDensity = f.density; f.density = 0; } else f.density = this.fogDensity || f.density; }
    });
    w.add(fx, 'lightmaps').name('Запечене світло').onChange((v: boolean) => { bakeLevel.value = v ? 1 : 0; });
    w.add(fx, 'flashlightShadow').name('Тінь ліхтарика').onChange((v: boolean) => {
      const fl = game.level?.flashlight; if (fl) { fl.castShadow = v; fl.shadow.needsUpdate = true; }
    });

    game.onFrame = (dt) => this.tick(dt);
  }

  toggle(): void { if (this.gui._hidden) this.gui.show(); else this.gui.hide(); }

  private applyPost(): void {
    const g = this.game, f = this.fx;
    const base: QualityProfile = f.preset === 'auto' ? g.profile : PROFILES[f.preset];
    const prof: QualityProfile = { ...base, ao: f.ao ? base.ao || 0.5 : 0, traa: f.traa, bloom: f.bloom ? base.bloom || 0.5 : 0 };
    g.profile = prof;
    g.post.apply(prof);
    g.resize();
  }

  private tick(dtMs: number): void {
    this.frames++; this.acc += dtMs; this.maxMs = Math.max(this.maxMs, dtMs);
    if (this.acc < 500) return;
    const r = this.game.gfx.renderer, info = r.info.render;
    const size = r.getDrawingBufferSize(new THREE.Vector2());
    const fps = (this.frames * 1000) / this.acc;
    this.stats.textContent = [
      `${fps.toFixed(0)} FPS   ${(this.acc / this.frames).toFixed(1)} мс (макс ${this.maxMs.toFixed(1)})`,
      `draw ${info.drawCalls}   трикут. ${(info.triangles / 1000).toFixed(0)} тис.`,
      `${this.game.gfx.backend.toUpperCase()}   ${this.game.profile.name}   ${size.x}×${size.y} (×${r.getPixelRatio().toFixed(2)})`,
      this.game.gfx.gpuName ? this.game.gfx.gpuName.slice(0, 42) : ''
    ].filter(Boolean).join('\n');
    this.frames = 0; this.acc = 0; this.maxMs = 0;
  }
}
