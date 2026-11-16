import './styles/main.css';
import { createRenderer } from './render/renderer';
import { PROFILES, autoQuality, type QualityName } from './render/quality';
import { detectDevice } from './core/device';
import { Game } from './game/game';

async function boot(): Promise<void> {
  const canvas = document.getElementById('view') as HTMLCanvasElement;
  const q = new URLSearchParams(location.search);
  const gfx = await createRenderer(canvas, q.has('webgl'));
  const device = detectDevice(gfx.gpuName);
  const qName = (q.get('q') as QualityName | null) ?? autoQuality(device, gfx.backend === 'webgpu');
  const profile = PROFILES[qName] ?? PROFILES.high;
  const game = new Game(gfx, device, profile);
  await game.init();
  game.start();
  if (import.meta.env.DEV || q.has('debug')) {
    Object.assign(window, {
      scene: game.scene, renderer: gfx.renderer, camera: game.camera,
      __zk: {
        ready: true, game,
        info: () => ({ backend: gfx.backend, quality: profile.name, gpu: gfx.gpuName, draw: gfx.renderer.info.render.drawCalls,
          pos: [game.player.pos.x, game.player.pos.y, game.player.pos.z].map((v) => +v.toFixed(2)), grounded: game.player.grounded })
      }
    });
  }
}
boot().catch((e) => { console.error(e); document.body.insertAdjacentHTML('beforeend', `<pre style="color:#f66;position:fixed;top:0">${String(e)}</pre>`); });
