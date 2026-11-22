// «Прогрів» рівня: один-два кадри справжнім конвеєром (сцена з MRT → AO → TRAA → bloom, тінь ліхтарика), у яких
// видно ВСЕ: приховане (мисливці до появи, затягнутий Шов, калюжі), те, що видно лише крізь камеру чи «очима нервів»,
// і те, що зараз позаду гравця. three.js збирає шейдери й вантажить буфери/текстури на GPU при першому малюванні
// об'єкта — без прогріву це ривок посеред гри (перший погляд у новий бік, поява мисливця, камера до ока).
// compileAsync() тут не підходить: він збирає варіанти для екрана без MRT, а гра малює в MRT-буфер постобробки.
import type * as THREE from 'three/webgpu';

/** Скільки кадрів малювати: деякі вузли (TRAA, bloom) створюють свої ресурси лише на другому кадрі. */
const FRAMES = 2;

export function warmup(scene: THREE.Scene, camera: THREE.Camera, render: () => void): number {
  const t0 = performance.now();
  const hidden: THREE.Object3D[] = [];
  const culled: THREE.Object3D[] = [];
  scene.traverse((o) => {
    // джерела світла не чіпаємо: інший набір світла — це інші шейдери, а нам потрібні саме ігрові
    if ((o as THREE.Light).isLight) return;
    if (!o.visible) { hidden.push(o); o.visible = true; }
    if (o.frustumCulled) { culled.push(o); o.frustumCulled = false; }
  });
  const mask = camera.layers.mask;
  camera.layers.enableAll();
  try {
    for (let i = 0; i < FRAMES; i++) render();
  } finally {
    camera.layers.mask = mask;
    for (const o of hidden) o.visible = false;
    for (const o of culled) o.frustumCulled = true;
  }
  return performance.now() - t0;
}
