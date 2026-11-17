"""Ліхтарик упритул до стіни не має «вибілювати» кадр, а вдалині — світити як раніше.
  python3 -I scripts/qa/flash-check.py <тека кадрів baseline.mjs> [<еталон для порівняння дальніх кадрів>]
Кадри *-wall-flash: частка пересвічених пікселів (усі канали ≥ 245) у центральній третині ≤ 5 %.
Кадри *room3-flash (ліхтарик удалину): середня яскравість у межах ±12 % від еталону. Код 1 — якщо ні."""
import sys
from pathlib import Path
from PIL import Image, ImageStat

d = Path(sys.argv[1])
ref = Path(sys.argv[2]) if len(sys.argv) > 2 else None
bad = 0
for f in sorted(d.glob('L*-wall-flash.png')):
    im = Image.open(f).convert('RGB')
    w, h = im.size
    c = im.crop((w // 3, h // 3, 2 * w // 3, 2 * h // 3))
    px = list(c.get_flattened_data()) if hasattr(c, "get_flattened_data") else list(c.getdata())
    white = sum(1 for r, g, b in px if r >= 245 and g >= 245 and b >= 245) / len(px)
    ok = white <= 0.05
    bad += not ok
    print(f'{f.name:24s} пересвічено {white * 100:5.1f}%  {"ok" if ok else "ВИБІЛЮЄ"}')
if ref:
    for f in sorted(d.glob('L*room3-flash.png')):
        a = ImageStat.Stat(Image.open(ref / f.name).convert('L')).mean[0]
        b = ImageStat.Stat(Image.open(f).convert('L')).mean[0]
        ok = abs(b - a) <= a * 0.12
        bad += not ok
        print(f'{f.name:24s} яскравість {a:5.1f} -> {b:5.1f}  {"ok" if ok else "ІНАКШЕ"}')
sys.exit(1 if bad else 0)
