import './styles/main.css';
import './styles/ui.css';
import '@fontsource/anonymous-pro/cyrillic-400.css';
import '@fontsource/anonymous-pro/cyrillic-700.css';
import '@fontsource/anonymous-pro/latin-400.css';
import '@fontsource/anonymous-pro/latin-700.css';
import '@fontsource/neucha/cyrillic-400.css';
import { createRenderer } from './render/renderer';
import { PROFILES, type QualityName } from './render/quality';
import { detectDevice } from './core/device';
import { Game } from './game/game';

async function boot(): Promise<void> {
  const canvas = document.getElementById('view') as HTMLCanvasElement;
  const q = new URLSearchParams(location.search);
  const gfx = await createRenderer(canvas, q.has('webgl'));
  const device = detectDevice(gfx.gpuName);
  const forced = q.get('q') as QualityName | null;
  const game = new Game(gfx, device, forced && PROFILES[forced] ? PROFILES[forced] : null);
  await game.init();
  await document.fonts.ready;
  if (import.meta.env.DEV || q.has('debug')) {
    Object.assign(window, {
      scene: game.scene, renderer: gfx.renderer, camera: game.camera,
      __zk: {
        ready: true, game,
        info: () => ({ backend: gfx.backend, quality: game.profile.name, mode: game.mode, draw: gfx.renderer.info.render.drawCalls,
          pos: [game.player.pos.x, game.player.pos.y, game.player.pos.z].map((v) => +v.toFixed(2)) })
      }
    });
  }
  void game.run();
}
boot().catch((e) => { console.error(e); document.body.insertAdjacentHTML('beforeend', `<pre style="color:#f66;position:fixed;top:0">${String(e)}</pre>`); });
