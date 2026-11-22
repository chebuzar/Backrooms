// Рендерер: WebGPU, а якщо браузер його не має — WebGL 2 (той самий код шейдерів TSL).
import * as THREE from 'three/webgpu';

export type Backend = 'webgpu' | 'webgl2';

export interface RendererHandle {
  renderer: THREE.WebGPURenderer;
  backend: Backend;
  gpuName: string;
}

export async function createRenderer(canvas: HTMLCanvasElement, forceWebGL = false): Promise<RendererHandle> {
  // Без WebGPU одразу просимо WebGL 2 — тоді three.js не пише попередження в консоль.
  let webgpuOk = !forceWebGL && 'gpu' in navigator;
  // Назву відеокарти беремо з власного адаптера: three.js r187 не зберігає свій у backend, і без цього
  // програмний рендер (SwiftShader, коли Chrome не довіряє відеокарті) діставав «Ультра» замість «Низкого».
  let adapterName = '';
  if (webgpuOk) {
    try {
      const ad = await navigator.gpu.requestAdapter();
      webgpuOk = !!ad;
      const i = ad?.info as (GPUAdapterInfo & { isFallbackAdapter?: boolean }) | undefined;
      if (i) adapterName = [i.vendor, i.architecture, i.device, i.description, i.isFallbackAdapter ? 'software' : ''].filter(Boolean).join(' ');
    } catch { webgpuOk = false; }
  }
  const renderer = new THREE.WebGPURenderer({
    canvas,
    antialias: false, // згладжування робить TRAA у постобробці
    forceWebGL: !webgpuOk,
    powerPreference: 'high-performance'
  });
  await renderer.init();
  // тональна компресія й sRGB — у власному фінальному проході (post.ts)
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const backendObj = renderer.backend as unknown as { isWebGPUBackend?: boolean };
  const backend: Backend = backendObj.isWebGPUBackend ? 'webgpu' : 'webgl2';
  let gpuName = '';
  try {
    if (backend === 'webgpu') {
      gpuName = adapterName;
    } else {
      const gl = (renderer.backend as unknown as { gl?: WebGL2RenderingContext }).gl;
      if (gl) {
        // Firefox віддає справжню назву в RENDERER і застерігає від WEBGL_debug_renderer_info
        const plain = String(gl.getParameter(gl.RENDERER));
        if (/firefox/i.test(navigator.userAgent) || !/^WebKit WebGL$/i.test(plain)) gpuName = plain;
        else {
          const ext = gl.getExtension('WEBGL_debug_renderer_info');
          gpuName = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : plain;
        }
      }
    }
  } catch { /* назва відеокарти — лише підказка */ }
  return { renderer, backend, gpuName };
}
