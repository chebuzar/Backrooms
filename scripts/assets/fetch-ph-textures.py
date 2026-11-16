"""Текстури Poly Haven (CC0) → .assets-src/polyhaven/tex/<id>/ (2K JPG: колір, нормаль GL, шорсткість) + рядок у CREDITS.md.
   python3 -I scripts/assets/fetch-ph-textures.py painted_concrete old_linoleum_flooring_01 ..."""
import json, os, sys, urllib.request

OUT = '.assets-src/polyhaven/tex'
CREDITS = 'public/assets/CREDITS.md'
MAPS = {'Diffuse': 'diff', 'nor_gl': 'nor_gl', 'Rough': 'rough'}


def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'zakulisye-assets'})) as r:
        return r.read()


for aid in sys.argv[1:]:
    info = json.loads(get(f'https://api.polyhaven.com/info/{aid}'))
    files = json.loads(get(f'https://api.polyhaven.com/files/{aid}'))
    d = os.path.join(OUT, aid)
    os.makedirs(d, exist_ok=True)
    for key, short in MAPS.items():
        dst = os.path.join(d, f'{short}.jpg')
        if not os.path.exists(dst):
            open(dst, 'wb').write(get(files[key]['2k']['jpg']['url']))
    authors = ', '.join(info.get('authors', {}).keys())
    line = f"- `tex/{aid}` — «{info['name']}» — {authors}, **CC0 1.0**, Poly Haven: https://polyhaven.com/a/{aid}\n"
    cur = open(CREDITS).read()
    if f'polyhaven.com/a/{aid}' not in cur:
        if '## Текстури Poly Haven' not in cur:
            cur += '\n## Текстури Poly Haven\n\n'
        open(CREDITS, 'w').write(cur + line)
    print(aid, 'ok', authors)
