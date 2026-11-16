import './styles/main.css';
import { createRenderer } from './render/renderer';
import { PostPipeline, look } from './render/post';
import { PROFILES, autoQuality, type QualityName } from './render/quality';
import { detectDevice } from './core/device';
import { buildTestScene } from './dev/testScene';

async function boot(): Promise<void> {
  const canvas = document.getElementById('view') as HTMLCanvasElement;
  const q = new URLSearchParams(location.search);
  const { renderer, backend, gpuName } = await createRenderer(canvas, q.has('webgl'));
  const device = detectDevice(gpuName);
  const qName = (q.get('q') as QualityName | null) ?? autoQuality(device, backend === 'webgpu');
  const profile = PROFILES[qName] ?? PROFILES.high;
  const { scene, camera, update } = buildTestScene();
  const post = new PostPipeline(renderer, scene, camera);
  post.apply(profile);
  const resize = () => {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setPixelRatio(Math.min(device.dpr, profile.maxPixelRatio));
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    look.aspect.value = w / h;
  };
  addEventListener('resize', resize); resize();
  const t0 = performance.now();
  renderer.setAnimationLoop(() => { update((performance.now() - t0) / 1000); post.render(); });
  Object.assign(window, { __zk: { ready: true, renderer, scene, camera, backend, device, profile, info: () => ({ backend, quality: profile.name, gpu: gpuName, draw: renderer.info.render.drawCalls }) } });
}
boot().catch((e) => { console.error(e); document.body.insertAdjacentHTML('beforeend', `<pre style="color:#f66;position:fixed;top:0">${String(e)}</pre>`); });
