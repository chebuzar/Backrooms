"""CC0-текстури ambientCG → KTX2 у public/assets/tex/<набір>/.
   python3 -I scripts/assets/make-textures.py   (потрібні toktx і Pillow)
Колір — ETC1S (sRGB), нормалі й шорсткість — UASTC (лінійні). Розмір підібраний під iPhone/iPad."""
import os, subprocess, sys, tempfile
from PIL import Image

SRC = '.assets-src/ambientcg'
OUT = 'public/assets/tex/level0'
os.makedirs(OUT, exist_ok=True)
# (вихідна назва, ассет, карта, розмір, кодування, srgb)
JOBS = [
  ('carpet_c', 'Fabric025', 'Color', 2048, 'etc1s', True),
  ('carpet_n', 'Fabric025', 'NormalGL', 1024, 'uastc', False),
  ('carpet_r', 'Fabric025', 'Roughness', 1024, 'etc1s', False),
  ('wall_c', 'Wallpaper002A', 'Color', 1024, 'etc1s', True),
  ('wall_n', 'Wallpaper002A', 'NormalGL', 1024, 'uastc', False),
  ('wall_r', 'Wallpaper002A', 'Roughness', 1024, 'etc1s', False),
  ('mold', 'Wallpaper002C', 'Color', 1024, 'etc1s', True),
  ('ceil_c', 'OfficeCeiling006', 'Color', 2048, 'etc1s', True),
  ('ceil_n', 'OfficeCeiling006', 'NormalGL', 1024, 'uastc', False),
  ('lamp_c', 'OfficeCeiling004', 'Color', 1024, 'etc1s', True),
]
for name, asset, kind, size, enc, srgb in JOBS:
    src = f'{SRC}/{asset}/{asset}_2K-JPG_{kind}.jpg'
    dst = f'{OUT}/{name}.ktx2'
    with tempfile.TemporaryDirectory() as td:
        png = os.path.join(td, 'in.png')
        im = Image.open(src).convert('RGB')
        if im.size[0] != size: im = im.resize((size, size), Image.LANCZOS)
        im.save(png)
        cmd = ['toktx', '--t2', '--genmipmap', '--assign_oetf', 'srgb' if srgb else 'linear']
        cmd += ['--encode', 'etc1s', '--clevel', '4', '--qlevel', '255'] if enc == 'etc1s' else ['--encode', 'uastc', '--uastc_quality', '2', '--zcmp', '18']
        subprocess.run(cmd + [dst, png], check=True)
    print(f'{dst}: {os.path.getsize(dst) // 1024} KB')
