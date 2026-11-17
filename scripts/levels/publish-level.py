"""Запечений рівень → гра: GLB шматків стискаються gltfpack (Meshopt), карти світла → KTX2 (UASTC, лінійні).
   python3 -I scripts/levels/publish-level.py .assets-src/levels/level0 public/assets/levels/level0"""
import json, os, shutil, subprocess, sys
src, dst = sys.argv[1], sys.argv[2]
man = json.load(open(os.path.join(src, 'manifest.json')))
if os.path.isdir(dst): shutil.rmtree(dst)
os.makedirs(dst)
gltfpack = os.path.join('node_modules', '.bin', 'gltfpack')
for c in man['chunks']:
    g_in, g_out = os.path.join(src, c['glb']), os.path.join(dst, c['glb'])
    # -noq: без квантування (UV у метрах виходять за 0..1, точність потрібна для карти світла); -cc: Meshopt
    # -kv: зберегти UV0/UV1, хоча матеріали-заглушки їх не використовують (інакше зникають розгортки)
    subprocess.run([gltfpack, '-i', g_in, '-o', g_out, '-cc', '-noq', '-kv', '-km', '-kn'], check=True, stdout=subprocess.DEVNULL)
    lm_out = c['lm'].replace('.png', '.ktx2')
    subprocess.run(['toktx', '--t2', '--genmipmap', '--assign_oetf', 'linear', '--encode', 'uastc', '--uastc_quality', '2', '--uastc_rdo_l', '2.0', '--zcmp', '18',
                    os.path.join(dst, lm_out), os.path.join(src, c['lm'])], check=True)
    c['lm'] = lm_out
json.dump(man, open(os.path.join(dst, 'manifest.json'), 'w'))
total = sum(os.path.getsize(os.path.join(dst, f)) for f in os.listdir(dst))
print(f"published {len(man['chunks'])} chunks, {total // 1024} KB")
