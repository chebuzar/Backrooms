"""Текстури рівня 0 зі СПРАВЖНІХ CC0-текстур (обробка, не генерація) → KTX2 у public/assets/tex/level0.
   python3 -I scripts/assets/make-level0-textures.py        (потрібні toktx, Pillow, numpy)

Джерела (див. ASSETS.md):
- шпалери: ShareTextures wallpaper_10 (блідий дамаск) — перефарбовано у вицвілий гірчичний; рельєф і шорсткість паперу — ambientCG Wallpaper001A;
  другий варіант зони — ShareTextures wallpaper_26 (приглушений); пошкоджений шар — ambientCG Wallpaper001C;
- стеля: ambientCG OfficeCeiling001 (акустичні плити 0.6 м, 6×6 на текстуру);
- килим: ambientCG Carpet011 (ворс), тон зміщено до брудно-гірчичного;
- декалі: ambientCG Leaking001/004–009 (колір + прозорість) → атлас «множення» 4×2.
"""
import os
import subprocess
import tempfile

import numpy as np
from PIL import Image

A = '.assets-src/ambientcg'
S = '.assets-src/sharetextures'
OUT = 'public/assets/tex/level0'
os.makedirs(OUT, exist_ok=True)


def load(path, size=2048, mode='RGB'):
    im = Image.open(path).convert(mode)
    if im.size != (size, size):
        im = im.resize((size, size), Image.LANCZOS)
    return np.asarray(im).astype(np.float32) / 255.0


def lum(a):
    return a[..., 0] * 0.2126 + a[..., 1] * 0.7152 + a[..., 2] * 0.0722


def norm01(x, lo=1, hi=99):
    a, b = np.percentile(x, lo), np.percentile(x, hi)
    return np.clip((x - a) / max(1e-6, b - a), 0, 1)


def srgb(*c):
    return np.array(c, np.float32)


def recolor_damask(diffuse, bg, ink, paper, contrast):
    """Візерунок зі справжньої текстури: світле тло → bg, малюнок → ink; папір додає дрібну нерівність."""
    t = norm01(lum(diffuse))  # 1 — тло, 0 — малюнок
    t = 1 - (1 - t) * contrast
    col = ink[None, None, :] * (1 - t[..., None]) + bg[None, None, :] * t[..., None]
    p = lum(paper)
    col *= (1.0 + 0.05 * (p - p.mean()) / max(1e-6, p.std()))[..., None]
    return np.clip(col, 0, 1)


def blend_normals(a, b, k=1.0):
    """Whiteout-змішування нормалей (обидві у форматі OpenGL, 0..1)."""
    n1 = a * 2 - 1
    n2 = b * 2 - 1
    n2[..., :2] *= k
    n = np.stack([n1[..., 0] + n2[..., 0], n1[..., 1] + n2[..., 1], n1[..., 2] * n2[..., 2]], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True) + 1e-6
    return n * 0.5 + 0.5


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
    im = Image.fromarray((np.clip(arr, 0, 1) * 255 + 0.5).astype(np.uint8))
    if size and im.size[0] != size:
        im = im.resize((size, size * im.size[1] // im.size[0]), Image.LANCZOS)
    with tempfile.TemporaryDirectory() as td:
        png = os.path.join(td, 'in.png')
        im.save(png)
        encode(png, name, enc, srgb_space)


paper_c = load(f'{A}/Wallpaper001A/Wallpaper001A_2K-JPG_Color.jpg')
paper_n = load(f'{A}/Wallpaper001A/Wallpaper001A_2K-JPG_NormalGL.jpg')
paper_r = load(f'{A}/Wallpaper001A/Wallpaper001A_2K-JPG_Roughness.jpg', mode='L')

# --- шпалери (основні): вицвілий гірчичний дамаск, малюнок ледь темніший за тло
w10 = load(f'{S}/wallpaper_10/wallpaper_10-2K/2K-walllpaper_10-diffuse.jpg')
save('wall_c', recolor_damask(w10, srgb(0.80, 0.69, 0.40), srgb(0.68, 0.56, 0.29), paper_c, 0.8), 'uastc', True, 1024)
w10n = load(f'{S}/wallpaper_10/wallpaper_10-2K/2K-walllpaper_10-normal.jpg')
save('wall_n', blend_normals(w10n, paper_n, 0.8), 'uastc', False, 1024)
save('wall_r', np.repeat((0.55 + 0.4 * paper_r)[..., None], 3, -1), 'etc1s', False, 1024)

# --- шпалери другої зони: насиченіший візерунок, але приглушений (не «новий»)
w26 = load(f'{S}/wallpaper_26/wallpaper_26-2K/2K-walllpaper_26-diffuse.jpg')
save('wall2_c', recolor_damask(w26, srgb(0.77, 0.64, 0.34), srgb(0.64, 0.52, 0.25), paper_c, 0.5), 'uastc', True, 1024)

# --- пошкоджений шар (обдерті, перекриті шматки паперу)
dmg = load(f'{A}/Wallpaper001C/Wallpaper001C_2K-JPG_Color.jpg')
save('dmg_c', np.clip(dmg * srgb(0.98, 0.9, 0.7), 0, 1), 'etc1s', True, 1024)

# --- стеля: акустичні плити, трохи пожовклі від років під люмінесцентним світлом
ceil = load(f'{A}/OfficeCeiling001/OfficeCeiling001_2K-JPG_Color.jpg')
ceil_ao0 = load(f'{A}/OfficeCeiling001/OfficeCeiling001_2K-JPG_AmbientOcclusion.jpg', mode='L')
# шви між плитами (з карти AO самої текстури) — темніші й сіріші, щоб сітка профілів читалась, як на фото
groove = np.clip((1 - ceil_ao0) * 5.0, 0, 1)[..., None]
ceil = ceil * (1 - 0.5 * groove) + srgb(0.42, 0.41, 0.38) * 0.5 * groove
save('ceil_c', np.clip(ceil * srgb(0.93, 0.9, 0.8), 0, 1), 'uastc', True, 1024)
save('ceil_n', load(f'{A}/OfficeCeiling001/OfficeCeiling001_2K-JPG_NormalGL.jpg'), 'uastc', False, 1024)
ceil_ao = load(f'{A}/OfficeCeiling001/OfficeCeiling001_2K-JPG_AmbientOcclusion.jpg', mode='L')
ceil_r = load(f'{A}/OfficeCeiling001/OfficeCeiling001_2K-JPG_Roughness.jpg', mode='L')
save('ceil_ar', np.stack([ceil_ao, ceil_r, np.zeros_like(ceil_r)], -1), 'etc1s', False, 1024)

# --- килим: ворс Carpet011, тон — брудна гірчиця з коричневим (вологий старий килим)
car = load(f'{A}/Carpet011/Carpet011_2K-JPG_Color.jpg')
lc = lum(car)
tone = srgb(0.52, 0.42, 0.22)
car2 = np.clip(tone[None, None, :] * (0.55 + 0.9 * (lc / max(1e-6, lc.mean())))[..., None] * 0.62 + car * 0.38, 0, 1)
save('carpet_c', car2, 'uastc', True, 1024)
save('carpet_n', load(f'{A}/Carpet011/Carpet011_2K-JPG_NormalGL.jpg'), 'uastc', False, 1024)
save('carpet_r', np.repeat(load(f'{A}/Carpet011/Carpet011_2K-JPG_Roughness.jpg', mode='L')[..., None], 3, -1), 'etc1s', False, 1024)

# --- атлас декалей підтьоків 4×2 (по 512²): RGB — множник кольору поверхні (1 = без змін)
names = ['Leaking001', 'Leaking004', 'Leaking005', 'Leaking006', 'Leaking007', 'Leaking008', 'Leaking009', 'Leaking001']
atlas = np.ones((1024, 2048, 3), np.float32)
for i, n in enumerate(names):
    c = load(f'{A}/{n}/{n}_2K-JPG_Color.jpg', 512)
    o = load(f'{A}/{n}/{n}_2K-JPG_Opacity.jpg', 512, 'L')
    if i == 7:  # восьма — віддзеркалена перша, щоб не повторювалась
        c, o = c[:, ::-1], o[:, ::-1]
    stain = np.clip(0.35 + 0.65 * c / max(1e-6, lum(c).mean() * 2.2), 0, 1) * srgb(0.82, 0.72, 0.52)
    y, x = (i // 4) * 512, (i % 4) * 512
    atlas[y:y + 512, x:x + 512] = 1 - o[..., None] * (1 - stain) * 0.85
with tempfile.TemporaryDirectory() as td:
    png = os.path.join(td, 'decals.png')
    Image.fromarray((atlas * 255 + 0.5).astype(np.uint8)).save(png)
    encode(png, 'decals', 'uastc', True)

# --- двері: стара фарбована фанера (ambientCG PaintedWood004) — перефарбовано у вицвілу кремову, облуплення лишаються
pw = load(f'{A}/PaintedWood004/PaintedWood004_1K-JPG_Color.jpg', 1024)
paint_mask = norm01(pw[..., 1] - pw[..., 0])  # світло-зелена фарба vs коричневе дерево під нею
door = srgb(0.70, 0.66, 0.56)[None, None, :] * paint_mask[..., None] * (0.92 + 0.16 * norm01(lum(pw)))[..., None] \
    + srgb(0.36, 0.27, 0.18)[None, None, :] * (1 - paint_mask[..., None])
save('door_c', door, 'etc1s', True, 1024)
save('door_n', load(f'{A}/PaintedWood004/PaintedWood004_1K-JPG_NormalGL.jpg', 1024), 'etc1s', False, 512)
