"""Текстура сталевої шафки роздягальні («Глубина-1»): одна пластина справжньої CC0-текстури Poly Haven metal_plate_02,
перефарбована в радянську сіро-зелену емаль за яскравістю (подряпини — до сірого металу). Нормаль і шорсткість — той самий кроп.
  python3 -I scripts/assets/fetch-ph-textures.py metal_plate_02 && python3 -I scripts/assets/make-locker-tex.py
"""
import os
from PIL import Image, ImageOps, ImageStat

SRC = '.assets-src/polyhaven/tex/metal_plate_02/'
OUT = '.assets-src/models/locker_tex/'
BOX = (484, 905, 812, 1365)  # одна пластина між швами (2K)
PAINT = (0.34, 0.38, 0.33)
os.makedirs(OUT, exist_ok=True)
lum = ImageOps.grayscale(Image.open(SRC + 'diff.jpg').crop(BOX).resize((1024, 1024)))
mean = ImageStat.Stat(lum).mean[0] / 255
px = lum.load()
out = Image.new('RGB', (1024, 1024))
o = out.load()
for y in range(1024):
    for x in range(1024):
        v = 1 + (px[x, y] / 255 / mean - 1) * 0.4  # емаль рівна: варіація фактури приглушена
        k = max(0.0, min(1.0, (v - 1.18) / 0.2))
        o[x, y] = tuple(min(255, int(255 * (c * v * (1 - k) + 0.5 * v * k))) for c in PAINT)
out.save(OUT + 'diff.jpg', quality=92)
for n in ('nor_gl', 'rough'):
    Image.open(SRC + n + '.jpg').crop(BOX).resize((1024, 1024)).save(OUT + n + '.jpg', quality=95)
print('ok', OUT)
