// Бібліотека рухів для монстрів: із Quaternius Universal Animation Library (CC0, безкоштовна версія,
// https://quaternius.itch.io/universal-animation-library) лишаємо скелет і кілька циклів ходи — без сітки манекена.
// Використання: node scripts/assets/make-ual-anims.mjs <AnimationLibrary_Godot_Standard.gltf> public/assets/anim/ual.glb
import { NodeIO } from '@gltf-transform/core';
import { dedup, prune, resample } from '@gltf-transform/functions';

const KEEP = ['Idle_Loop', 'Walk_Loop', 'Walk_Formal_Loop', 'Crouch_Fwd_Loop', 'Crouch_Idle_Loop', 'Jog_Fwd_Loop'];
const [src, out] = process.argv.slice(2);
if (!src || !out) { console.error('usage: make-ual-anims.mjs <in.gltf> <out.glb>'); process.exit(2); }

const io = new NodeIO();
const doc = await io.read(src);
const root = doc.getRoot();
for (const a of root.listAnimations()) {
  if (KEEP.includes(a.getName())) continue;
  for (const c of a.listChannels()) c.dispose();
  for (const s of a.listSamplers()) s.dispose();
  a.dispose();
}
// без сітки манекена: потрібні лише вузли скелета
for (const n of root.listNodes()) { if (n.getMesh()) n.setMesh(null); n.setSkin(null); }
for (const m of root.listMeshes()) m.dispose();
for (const s of root.listSkins()) s.dispose();
for (const t of root.listTextures()) t.dispose();
for (const m of root.listMaterials()) m.dispose();
await doc.transform(resample(), dedup(), prune({ keepLeaves: true }));
const left = root.listAnimations().map((a) => a.getName());
const miss = KEEP.filter((k) => !left.includes(k));
if (miss.length) { console.error('missing clips:', miss); process.exit(1); }
await io.write(out, doc);
console.log('wrote', out, left);
