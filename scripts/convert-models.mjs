// Конвертация FBX → GLB прямо в браузере (FBXLoader + GLTFExporter из three), без Blender.
//   node scripts/convert-models.mjs <in.fbx> <out.glb> [--info]
// Печатает кости, анимации и число треугольников.
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const vite = await import('vite');
const [inp, out] = process.argv.slice(2);
const server = await vite.createServer({ server: { port: 5185, strictPort: false, host: '127.0.0.1' }, logLevel: 'error' });
await server.listen();
const b = await chromium.launch(); const p = await b.newPage();
await p.goto(server.resolvedUrls.local[0] + '?debug=1');
await p.waitForFunction(() => window.__zk, null, { timeout: 60000 });
const res = await p.evaluate(async (b64) => {
  const THREE = window.__zk.THREE;
  const { FBXLoader } = await import('/node_modules/three/examples/jsm/loaders/FBXLoader.js');
  const { GLTFExporter } = await import('/node_modules/three/examples/jsm/exporters/GLTFExporter.js');
  const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer;
  const obj = new FBXLoader().parse(bin, '');
  const bones = [], meshes = []; let tris = 0;
  obj.traverse((o) => { if (o.isBone) bones.push(o.name); if (o.isMesh) { meshes.push(o.name + (o.isSkinnedMesh ? '(skinned)' : '') + ':' + (Array.isArray(o.material) ? o.material.map((m) => m.name).join('|') : o.material.name)); tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; } });
  const box = new THREE.Box3().setFromObject(obj), size = box.getSize(new THREE.Vector3());
  const anims = obj.animations.map((a) => a.name + ':' + a.duration.toFixed(2));
  const glb = await new GLTFExporter().parseAsync(obj, { binary: true, animations: obj.animations });
  let s = ''; const u8 = new Uint8Array(glb); for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return { bones, meshes, tris, size: [size.x, size.y, size.z].map((v) => +v.toFixed(2)), anims, glb: btoa(s) };
}, readFileSync(inp).toString('base64'));
console.log('size', res.size, 'tris', res.tris, '\nmeshes', res.meshes.join(', '), '\nanims', res.anims.join(', '), '\nbones', res.bones.length, res.bones.join(' '));
if (out) { writeFileSync(out, Buffer.from(res.glb, 'base64')); console.log('wrote', out, Buffer.from(res.glb, 'base64').length); }
await b.close(); await server.close(); process.exit(0);
