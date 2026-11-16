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
  await document.fonts.ready;
  if (import.meta.env.DEV || q.has('debug')) {
    Object.assign(window, {
      scene: game.scene, renderer: gfx.renderer, camera: game.camera,
      __zk: {
        get ready() { return game.mode !== 'boot' && !!game.level; }, game,
        /** Одразу в гру без прологу (для автотестів). */
        play: () => { document.querySelector<HTMLButtonElement>('.age [data-go]')?.click(); setTimeout(() => game.play(), 300); },
        look: (yaw: number, pitch = 0) => { game.player.yaw = yaw; game.player.pitch = pitch; },
        /** Поставити гравця в точку й повернути камеру (для повторюваних скріншотів). */
        tp: (x: number, z: number, yaw = 0, pitch = 0) => { game.player.teleport(x, 0, z, yaw); game.player.pitch = pitch; },
        info: () => ({ backend: gfx.backend, quality: game.profile.name, mode: game.mode, draw: gfx.renderer.info.render.drawCalls,
          pos: game.player ? [game.player.pos.x, game.player.pos.y, game.player.pos.z].map((v) => +v.toFixed(2)) : null })
      }
    });
  }
  if (q.has('debug') && !q.has('nodbg')) void import('./dev/debug').then(({ DebugPanel }) => new DebugPanel(game));
  if (q.has('bench')) void startBench(game);
  await game.run();
}

/** ?bench: дочекатися рівня, пропустити екран «18+» і запустити тест швидкодії. */
async function startBench(game: Game): Promise<void> {
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  while (game.mode === 'boot' || !game.level) await wait(200);
  document.querySelector<HTMLButtonElement>('.age [data-go]')?.click();
  await wait(1200);
  const { runBench } = await import('./dev/bench');
  const list = (new URLSearchParams(location.search).get('bench') ?? '').split(',').filter((x): x is QualityName => x in PROFILES);
  await runBench(game, list.length ? list : undefined);
}
boot().catch((e) => { console.error(e); document.body.insertAdjacentHTML('beforeend', `<pre style="color:#f66;position:fixed;top:0">${String(e)}</pre>`); });
