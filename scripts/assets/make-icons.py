"""Іконки веб-додатка з кадру гри (.assets-src/icon/face.png ← node scripts/assets/icon-shot.mjs).
   python3 -I scripts/assets/make-icons.py  → public/icons/*.png
Звичайна іконка — обличчя впритул; «maskable» (Android обрізає колом/скругленням) — ширший кадр, обличчя в безпечній зоні 80 %.
"""
import os

from PIL import Image

src = Image.open('.assets-src/icon/face.png').convert('RGB')
W, H = src.size
os.makedirs('public/icons', exist_ok=True)


def crop(cx, cy, side):
    x0, y0 = int(cx * W - side / 2), int(cy * H - side / 2)
    x0, y0 = max(0, min(W - side, x0)), max(0, min(H - side, y0))
    return src.crop((x0, y0, x0 + side, y0 + side))


tight = crop(0.47, 0.55, int(H * 0.75))
wide = crop(0.47, 0.5, int(H * 0.97))
for name, img, size in [('icon-192', tight, 192), ('icon-512', tight, 512), ('apple-touch-icon', tight, 180), ('icon-maskable-512', wide, 512), ('favicon-32', tight, 32)]:
    img.resize((size, size), Image.LANCZOS).save(f'public/icons/{name}.png', optimize=True)
    print(name, os.path.getsize(f'public/icons/{name}.png') // 1024, 'KB')
