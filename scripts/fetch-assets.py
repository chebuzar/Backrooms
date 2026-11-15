"""Скачивает CC0-текстуры ambientCG, ужимает их для веба и кладёт в public/assets/tex/<id>/.

    python3 scripts/fetch-assets.py            # все из списка
    python3 scripts/fetch-assets.py Carpet011  # одну

Карты: c.jpg (цвет), n.jpg (нормали, OpenGL), r.jpg (шероховатость) — 1K для «Низкой» графики,
c2k.jpg / n2k.jpg — 2K для Full HD. Список и лицензии — public/assets/CREDITS.md.
Нужен Pillow (pip install pillow).
"""
import io, json, os, sys, urllib.request, zipfile
from PIL import Image

ROOT = os.path.join(os.path.dirname(__file__), '..', 'public', 'assets', 'tex')
# id: (размер цвета/нормалей, размер шероховатости)
TEX = {
    'Wallpaper001C': (1024, 512), 'Wallpaper001A': (1024, 512),
    'Carpet011': (1024, 512), 'Carpet012': (1024, 512), 'Carpet016': (1024, 512),
    'OfficeCeiling001': (1024, 512),
    'Concrete034': (1024, 512), 'Concrete031': (1024, 512), 'Concrete046': (1024, 512),
    'Asphalt031': (1024, 512), 'Tiles107': (1024, 512), 'Tiles132A': (1024, 512),
    'PaintedMetal012': (1024, 512), 'Wood066': (1024, 512),
}
UA = {'User-Agent': 'Mozilla/5.0 (asset fetch script)'}

def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=180) as r:
        return r.read()

def fetch(aid, size, rsize):
    out = os.path.join(ROOT, aid); os.makedirs(out, exist_ok=True)
    z = zipfile.ZipFile(io.BytesIO(get(f'https://ambientcg.com/get?file={aid}_2K-JPG.zip')))
    names = {n.rsplit('_', 1)[-1].lower(): n for n in z.namelist()}
    def save(key, fn, sz, q):
        n = names.get(key)
        if not n: print('  нет карты', key); return
        im = Image.open(io.BytesIO(z.read(n))).convert('RGB' if key != 'roughness.jpg' else 'L').resize((sz, sz), Image.LANCZOS)
        im.save(os.path.join(out, fn), quality=q, optimize=True, progressive=True)
    save('color.jpg', 'c.jpg', size, 82)
    save('normalgl.jpg', 'n.jpg', size, 88)
    save('color.jpg', 'c2k.jpg', 2048, 80)
    save('normalgl.jpg', 'n2k.jpg', 2048, 85)
    save('roughness.jpg', 'r.jpg', rsize, 80)
    kb = sum(os.path.getsize(os.path.join(out, f)) for f in os.listdir(out)) // 1024
    print(f'{aid}: {kb} KB')

def credits():
    lines = ['# Ассеты и лицензии', '', 'Все текстуры — **CC0 1.0** (общественное достояние), ambientCG.com. Атрибуция не обязательна, но указываем источник.', '']
    for aid in sorted(os.listdir(ROOT)):
        lines.append(f'- `{aid}` — https://ambientcg.com/view?id={aid}')
    lines += ['', '## 3D-модели', '',
              '**CC0 1.0**, Quaternius (quaternius.com). Сконвертированы из FBX в GLB скриптом `scripts/convert-models.mjs`.', '',
              '- `models/human.glb` — «Animated Man» (Animated Human.fbx): Idle, Walk, Run, Punch, Death',
              '- `models/zombie.glb` — «Animated Zombie» (ZombieSmooth.fbx): Idle, Walk, Run, Crawl, Bite']
    open(os.path.join(ROOT, '..', 'CREDITS.md'), 'w').write('\n'.join(lines) + '\n')

if __name__ == '__main__':
    ids = sys.argv[1:] or list(TEX)
    for aid in ids: fetch(aid, *TEX[aid])
    credits()
