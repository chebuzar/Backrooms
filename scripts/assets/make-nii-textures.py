"""Текстури рівня 0 «Бесконечный НИИ» зі СПРАВЖНІХ CC0-текстур (обробка, не генерація) → KTX2 у public/assets/tex/level0.
   python3 -I scripts/assets/make-nii-textures.py        (потрібні toktx, Pillow, numpy; джерела качає сам у .assets-src/ambientcg)

Джерела (див. ASSETS.md):
- олійна фарба й побілка стін: ambientCG PaintedPlaster017 — знебарвлено (колір фарби задає шейдер за зоною);
- облуплена фарба й штукатурка під нею: ambientCG Plaster007;
- паркет «ялинкою» в кабінетах і залах: ambientCG WoodFloor034 — затемнено, вицвіло, як старий лакований дуб.
Шпалери кабінетів (wall_c/wall_n/wall_r) і плити «Акмигран» на стелі (ceil_*) — з make-level0-textures.py (перефарбовуються в шейдері).
"""
import os
import subprocess
import sys
import tempfile
import urllib.request
import zipfile

import numpy as np
from PIL import Image

A = '.assets-src/ambientcg'
OUT = 'public/assets/tex/level0'
os.makedirs(OUT, exist_ok=True)


def fetch(asset):
    d = f'{A}/{asset}'
    if os.path.isdir(d):
        return
    os.makedirs(d, exist_ok=True)
    with tempfile.TemporaryDirectory() as td:
        z = os.path.join(td, 'a.zip')
        urllib.request.urlretrieve(f'https://ambientcg.com/get?file={asset}_2K-JPG.zip', z)
        with zipfile.ZipFile(z) as zf:
            for n in zf.namelist():
                if n.endswith('.jpg') and '/' not in n:
                    zf.extract(n, d)


def load(path, size=1024, mode='RGB'):
    im = Image.open(path).convert(mode)
    if im.size != (size, size):
        im = im.resize((size, size), Image.LANCZOS)
    return np.asarray(im).astype(np.float32) / 255.0


def lum(a):
    return a[..., 0] * 0.2126 + a[..., 1] * 0.7152 + a[..., 2] * 0.0722


def encode(png, name, enc, srgb_space):
    dst = f'{OUT}/{name}.ktx2'
    cmd = ['toktx', '--t2', '--genmipmap', '--assign_oetf', 'srgb' if srgb_space else 'linear']
    if enc == 'etc1s':
        cmd += ['--encode', 'etc1s', '--clevel', '4', '--qlevel', '255']
    else:
        cmd += ['--encode', 'uastc', '--uastc_quality', '2', '--uastc_rdo_l', '1.2', '--zcmp', '18']
    subprocess.run(cmd + [dst, png], check=True)
    print(f'{dst}: {os.path.getsize(dst) // 1024} KB')


def save(name, arr, enc, srgb_space, size=None):
    if arr.ndim == 2:
        arr = np.repeat(arr[..., None], 3, -1)
    im = Image.fromarray((np.clip(arr, 0, 1) * 255 + 0.5).astype(np.uint8))
    if size and im.size[0] != size:
        im = im.resize((size, size), Image.LANCZOS)
    with tempfile.TemporaryDirectory() as td:
        png = os.path.join(td, 'in.png')
        im.save(png)
        encode(png, name, enc, srgb_space)


for a in ['PaintedPlaster017', 'Plaster007', 'WoodFloor034']:
    fetch(a)
only = sys.argv[1:]

# --- фарба/побілка: лише світлота й дрібна фактура (колір — у шейдері); середнє ≈ 0.5, щоб множення на колір фарби давало сам колір
if not only or 'paint' in only:
    p = f'{A}/PaintedPlaster017/PaintedPlaster017_2K-JPG'
    c = lum(load(f'{p}_Color.jpg'))
    c = 0.5 + (c - c.mean()) * 1.6
    save('paint_c', c, 'etc1s', True)
    save('paint_n', load(f'{p}_NormalGL.jpg'), 'uastc', False)
    save('paint_r', load(f'{p}_Roughness.jpg', mode='L'), 'etc1s', False, 512)

# --- облуплена фарба: колір штукатурки під фарбою + маска «відпало» (G-канал = 1 там, де фарби немає)
if not only or 'peel' in only:
    p = f'{A}/Plaster007/Plaster007_2K-JPG'
    c = load(f'{p}_Color.jpg')
    l = lum(c)
    # світлі гладкі ділянки текстури — уцілілий шар; темніші й шорсткі — відкрита штукатурка
    rough = load(f'{p}_Roughness.jpg', mode='L')
    holes = np.clip((0.78 - l) * 4.0 + (rough - 0.6) * 1.5, 0, 1)
    under = np.clip(c * np.array([0.92, 0.86, 0.74], np.float32) * 0.85, 0, 1)
    save('peel_c', np.dstack([under[..., 0], under[..., 1], under[..., 2]]), 'etc1s', True)
    save('peel_m', np.dstack([holes, holes, holes]), 'etc1s', False, 512)

# --- паркет «ялинкою»: старий лакований дуб, потемнілий і вицвілий
if not only or 'parquet' in only:
    p = f'{A}/WoodFloor034/WoodFloor034_2K-JPG'
    c = load(f'{p}_Color.jpg')
    l = lum(c)
    tone = np.array([0.42, 0.27, 0.15], np.float32)
    c2 = np.clip(tone[None, None, :] * (0.45 + 1.1 * l / max(1e-6, l.mean()))[..., None] * 0.7 + c * 0.3, 0, 1)
    save('parquet_c', c2, 'uastc', True)
    save('parquet_n', load(f'{p}_NormalGL.jpg'), 'uastc', False)
    save('parquet_r', load(f'{p}_Roughness.jpg', mode='L'), 'etc1s', False, 512)
