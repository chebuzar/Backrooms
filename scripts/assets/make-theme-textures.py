"""Текстури рівнів 1–2 (справжні CC0 Poly Haven, 2K JPG) → KTX2 у public/assets/tex/level1|level2.
   python3 -I scripts/assets/make-theme-textures.py     (спершу: python3 -I scripts/assets/fetch-ph-textures.py <id>...)
   --only level1:floor — лише одна поверхня.
Назви файлів однакові для всіх тем: wall_*, low_* (нижня фарбована смуга), floor_*, ceil_* (c — колір, n — нормаль, r — шорсткість)."""
import os
import subprocess
import tempfile

from PIL import Image

PH = '.assets-src/polyhaven/tex'
SETS = {
    'level1': {'wall': 'painted_plaster_wall', 'low': 'painted_concrete', 'floor': 'linoleum_brown', 'ceil': 'concrete_wall_008'},  # 17.11: підлога — потертий коричневий лінолеум (було old_linoleum_flooring_01, оранжева клітинка)
    'level2': {'wall': 'concrete_wall_008', 'low': 'blue_plaster_weathered', 'floor': 'garage_floor', 'ceil': 'rough_concrete'},
}
MAPS = {'c': ('diff', True, 1024, 'etc1s'), 'n': ('nor_gl', False, 1024, 'uastc'), 'r': ('rough', False, 512, 'etc1s')}

import sys
# --only level1:floor — перегенерувати лише одну поверхню (решта файлів лишається байт-у-байт)
ONLY = sys.argv[sys.argv.index('--only') + 1] if '--only' in sys.argv else None
for lv, parts in SETS.items():
    out = f'public/assets/tex/{lv}'
    os.makedirs(out, exist_ok=True)
    for part, asset in parts.items():
        if ONLY and ONLY != f'{lv}:{part}':
            continue
        for suffix, (src, srgb, size, enc) in MAPS.items():
            dst = f'{out}/{part}_{suffix}.ktx2'
            with tempfile.TemporaryDirectory() as td:
                png = os.path.join(td, 'in.png')
                Image.open(f'{PH}/{asset}/{src}.jpg').convert('RGB').resize((size, size), Image.LANCZOS).save(png)
                cmd = ['toktx', '--t2', '--genmipmap', '--assign_oetf', 'srgb' if srgb else 'linear']
                cmd += ['--encode', 'etc1s', '--clevel', '4', '--qlevel', '255'] if enc == 'etc1s' else \
                    ['--encode', 'uastc', '--uastc_quality', '2', '--uastc_rdo_l', '1.2', '--zcmp', '18']
                subprocess.run(cmd + [dst, png], check=True)
            print(dst, os.path.getsize(dst) // 1024, 'KB')
