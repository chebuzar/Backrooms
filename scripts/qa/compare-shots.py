"""Порівняння кадрів «до/після» (правило «нічого не погіршити»).

  python3 -I scripts/qa/compare-shots.py <тека A> [<тека B>] [--sheet out.png] [--only L0]
Одна тека — лише аркуш кадрів. Дві — для кожного однойменного кадру: середня різниця (0..255), частка пікселів
з різницею > 24, яскравість A/B; аркуш: рядок = кадр, ліворуч A, праворуч B. Код 1, якщо кадр «поплив» сильно
(середня різниця > 12 або змінилось > 25 % пікселів) — тоді дивитися очима.
"""
import sys
from pathlib import Path
from PIL import Image, ImageChops, ImageDraw, ImageStat

args = sys.argv[1:]
sheet = None
only = ''
if '--sheet' in args:
    i = args.index('--sheet'); sheet = args[i + 1]; del args[i:i + 2]
if '--only' in args:
    i = args.index('--only'); only = args[i + 1]; del args[i:i + 2]
A = Path(args[0])
B = Path(args[1]) if len(args) > 1 else None
names = sorted(p.name for p in A.glob('*.png') if p.name.startswith(only))
W, H = 480, 270
rows = []
bad = 0
for n in names:
    a = Image.open(A / n).convert('RGB')
    if B is None:
        rows.append((n, a, None, ''))
        continue
    if not (B / n).exists():
        print(f'{n}: немає в B'); continue
    b = Image.open(B / n).convert('RGB').resize(a.size)
    d = ImageChops.difference(a, b).convert('L')
    mean = ImageStat.Stat(d).mean[0]
    hist = d.histogram()
    changed = sum(hist[25:]) / max(1, sum(hist))
    la, lb = ImageStat.Stat(a.convert('L')).mean[0], ImageStat.Stat(b.convert('L')).mean[0]
    flag = mean > 12 or changed > 0.25
    bad += flag
    note = f'diff {mean:5.1f}  changed {changed * 100:4.1f}%  luma {la:5.1f} -> {lb:5.1f}' + ('  <<< ДИВИТИСЯ' if flag else '')
    print(f'{n:32s} {note}')
    rows.append((n, a, b, note))

if sheet and rows:
    cols = 2 if B else 4
    if B:
        img = Image.new('RGB', (W * 2, (H + 18) * len(rows)), (16, 16, 16))
        for r, (n, a, b, note) in enumerate(rows):
            y = r * (H + 18)
            img.paste(a.resize((W, H)), (0, y + 18)); img.paste(b.resize((W, H)), (W, y + 18))
            ImageDraw.Draw(img).text((4, y + 3), f'{n}  {note}', fill=(230, 230, 200))
    else:
        nr = (len(rows) + cols - 1) // cols
        img = Image.new('RGB', (W * cols, (H + 18) * nr), (16, 16, 16))
        for k, (n, a, _, _) in enumerate(rows):
            x, y = (k % cols) * W, (k // cols) * (H + 18)
            img.paste(a.resize((W, H)), (x, y + 18))
            ImageDraw.Draw(img).text((x + 4, y + 3), n, fill=(230, 230, 200))
    Path(sheet).parent.mkdir(parents=True, exist_ok=True)
    img.save(sheet)
    print('аркуш:', sheet)
sys.exit(1 if bad else 0)
