"""Текстура корпусу батарейки 3336Л: одна пластина справжньої CC0-текстури Poly Haven metal_plate_02 (без швів між
пластинами), перефарбована в радянську червону фарбу за яскравістю (подряпини — до сірого металу). Нормаль і шорсткість — той самий кроп.
  python3 -I scripts/assets/fetch-ph-textures.py metal_plate_02 && python3 -I scripts/assets/make-battery-tex.py
"""
import os
from PIL import Image, ImageOps, ImageStat

SRC = '.assets-src/polyhaven/tex/metal_plate_02/'
OUT = '.assets-src/models/battery_tex/'
BOX = (484, 905, 812, 1365)  # одна пластина між швами (2K)
PAINT = (0.40, 0.09, 0.06)
os.makedirs(OUT, exist_ok=True)
lum = ImageOps.grayscale(Image.open(SRC + 'diff.jpg').crop(BOX).resize((512, 512)))
mean = ImageStat.Stat(lum).mean[0] / 255
px = lum.load()
out = Image.new('RGB', (512, 512))
o = out.load()
for y in range(512):
    for x in range(512):
        v = px[x, y] / 255 / mean
        k = max(0.0, min(1.0, (v - 1.35) / 0.5))  # світлі подряпини — голий метал
        o[x, y] = tuple(min(255, int(255 * (c * v * (1 - k) + 0.55 * v * k))) for c in PAINT)
out.save(OUT + 'diff.jpg', quality=92)
for n in ('nor_gl', 'rough'):
    Image.open(SRC + n + '.jpg').crop(BOX).resize((512, 512)).save(OUT + n + '.jpg', quality=95)
print('ok', OUT)
