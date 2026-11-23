"""Звуки речей, що падають і б'ються (фізика): справжні записи CC0 з OpenGameArt → AAC .m4a у public/assets/sfx.
   python3 -I scripts/assets/make-prop-sounds.py      (потрібен ffmpeg; завантажує пакети сам)
Пакети (CC0 1.0, OpenGameArt, перевірено 23.11.2026):
  wood-and-metal-sound-effects-volume-2 (Ogrebane) — удари дерева й металу
  75-cc0-breaking-falling-hit-sfx (rubberduck)      — падіння дерев'яних і металевих речей
"""
import glob
import json
import os
import subprocess
import urllib.request
import zipfile

SRC = '.assets-src/packs/oga-props'
OUT = 'public/assets/sfx'
B = 'https://opengameart.org/sites/default/files/'
os.makedirs(SRC, exist_ok=True)
made = {}
for f in ['wood_and_metal_vol.2_0.zip', 'sfx_breaking_and_falling.zip']:
    dst = f'{SRC}/{f}'
    if not os.path.exists(dst):
        req = urllib.request.Request(B + f, headers={'User-Agent': 'zakulisye-asset-fetch'})
        with urllib.request.urlopen(req) as r, open(dst, 'wb') as o:
            o.write(r.read())
    if not os.path.isdir(dst + '.d'):
        with zipfile.ZipFile(dst) as z:
            z.extractall(dst + '.d')


def files(pattern):
    return sorted(f for f in glob.glob(f'{SRC}/**/{pattern}', recursive=True) if not os.path.basename(f).startswith('._'))


def conv(src, name, lufs, dur):
    dst = f'{OUT}/{name}.m4a'
    # тишу на початку — геть (удар має звучати в мить зіткнення), хвіст — коротко згасає
    af = f'silenceremove=start_periods=1:start_threshold=-45dB,afade=t=out:st={dur - 0.12}:d=0.12,loudnorm=I={lufs}:TP=-1.0:LRA=11'
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', src, '-t', str(dur), '-af', af, '-ar', '48000', '-ac', '1', '-c:a', 'aac', '-b:a', '96k', dst], check=True)
    made[name] = os.path.getsize(dst)


for i, f in enumerate(files('wood*.aif')[:8] + files('bfh1_wood_hit_*.ogg')):
    conv(f, f'knock_wood_{i}', -20, 0.9)
for i, f in enumerate(files('metal*.aif')[:6] + files('bfh1_metal_hit_*.ogg')[:4]):
    conv(f, f'knock_metal_{i}', -21, 1.0)
for i, f in enumerate(files('bfh1_wood_falling_*.ogg') + files('bfh1_falling_0[1-4].ogg')):
    conv(f, f'topple_{i}', -18, 1.6)
# скло (фізика 23.11): лампа/плафон б'ється на друзки; дзенькіт уламків; глухий удар паперу, книг, м'яких речей
for i, f in enumerate(files('bfh1_glass_breaking_*.ogg')):
    conv(f, f'glass_break_{i}', -17, 1.8)
for i, f in enumerate(files('bfh1_glass_hit_*.ogg') + files('bfh1_glass_falling_*.ogg')):
    conv(f, f'glass_hit_{i}', -22, 1.0)
for i, f in enumerate(files('bfh1_hit_*.ogg')[:8]):
    conv(f, f'knock_soft_{i}', -24, 0.7)

idx_path = f'{OUT}/index.json'
idx = set(json.load(open(idx_path))) if os.path.exists(idx_path) else set()
json.dump(sorted(idx | set(made)), open(idx_path, 'w'))
print(len(made), 'files,', sum(made.values()) // 1024, 'KB')
