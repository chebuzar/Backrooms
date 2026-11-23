"""Звуки смерті й монстрів (18+): справжні записи CC0 з OpenGameArt → AAC .m4a у public/assets/sfx (доповнює index.json).
   python3 -I scripts/assets/make-dread-sounds.py        (потрібні ffmpeg, numpy, py7zr; завантажує пакети сам)

Пакети (усі CC0 1.0, OpenGameArt — сторінки й ліцензії перевірені 23.11.2026, див. ASSETS.md):
  80-cc0-creature-sfx              — крики, гарчання, «їсть»
  8-wet-squish-slurp-impacts       — мокрі удари (Independent.nu Ljudbank)
  2-wooden-squish-splatter-seqs    — хрускіт кісток (Independent.nu Ljudbank)
  ripping-into-meat                — роздирання м'яса
  monster-snarls, 16-monster-growls, ghost-breath — голоси монстрів
Скример — не один запис, а шари (гарчання + крик зі зниженим тоном + удар), стиснуті й підсилені: різкий, щільний,
без «мультяшності» окремого крику. Гучність вирівнюється (loudnorm), моно 48 кГц.
"""
import glob
import json
import os
import subprocess
import urllib.request
import zipfile

import numpy as np

SRC = '.assets-src/packs/oga-dread'
OUT = 'public/assets/sfx'
B = 'https://opengameart.org/sites/default/files/'
FILES = ['80-CC0-creature-SFX_0.zip', 'independent_nu_ljudbank-wet_squish_slurp_impacts.7z', 'independent_nu_ljudbank-extreme_splatter.7z',
         'rippingintomeat_0.mp3', 'monster-snarl-attack.ogg', 'monster-snarl-5.ogg', 'monster-snarls_0.ogg', 'monsters-snarls-3_0.ogg',
         'monster_-_starninjas.zip', 'ghostbreath.flac', 'squishsplat_impact.mp3']
os.makedirs(SRC, exist_ok=True)
os.makedirs(OUT, exist_ok=True)
made = {}


def fetch():
    for f in FILES:
        dst = f'{SRC}/{f}'
        if not os.path.exists(dst):
            req = urllib.request.Request(B + f, headers={'User-Agent': 'zakulisye-asset-fetch'})
            with urllib.request.urlopen(req) as r, open(dst, 'wb') as o:
                o.write(r.read())
        if f.endswith('.zip') and not os.path.isdir(dst + '.d'):
            with zipfile.ZipFile(dst) as z:
                z.extractall(dst + '.d')
        if f.endswith('.7z') and not os.path.isdir(dst + '.d'):
            import py7zr
            with py7zr.SevenZipFile(dst) as z:
                z.extractall(dst + '.d')


def find(pattern):
    r = sorted(glob.glob(f'{SRC}/{pattern}', recursive=True))
    if not r:
        raise SystemExit(f'немає файлу: {pattern}')
    return r[0]


def pcm(src):
    """Моно 48 кГц float32 — для пошуку найгучніших місць."""
    raw = subprocess.run(['ffmpeg', '-loglevel', 'error', '-i', src, '-ac', '1', '-ar', '48000', '-f', 'f32le', '-'], check=True, capture_output=True).stdout
    return np.frombuffer(raw, dtype=np.float32)


def loudest(src, dur, count=1, gap=None):
    """Початки `count` найгучніших вікон довжиною dur (с), що не перекриваються."""
    x = pcm(src)
    w = int(dur * 48000)
    if len(x) <= w:
        return [0.0]
    e = np.convolve(x * x, np.ones(w // 8), mode='valid')[::480]  # енергія з кроком 10 мс
    starts, used = [], np.zeros_like(e, dtype=bool)
    span = int((gap or dur) * 100)
    for _ in range(count):
        e2 = np.where(used, -1, e)
        k = int(np.argmax(e2))
        if e2[k] <= 0:
            break
        t = max(0.0, k / 100 - dur * 0.15)  # трохи до піку, щоб атака не обрізалась
        starts.append(min(t, len(x) / 48000 - dur))
        used[max(0, k - span):k + span] = True
    return starts


def conv(src, name, lufs=-18, start=0.0, dur=None, af_extra=()):
    dst = f'{OUT}/{name}.m4a'
    af = list(af_extra)
    if dur:
        af.append(f'afade=t=out:st={max(0.0, dur - 0.08)}:d=0.08')
    af.append(f'loudnorm=I={lufs}:TP=-1.0:LRA=11')
    cmd = ['ffmpeg', '-y', '-loglevel', 'error', '-ss', f'{start:.3f}', '-i', src]
    if dur:
        cmd += ['-t', str(dur)]
    cmd += ['-af', ','.join(af), '-ar', '48000', '-ac', '1', '-c:a', 'aac', '-b:a', '96k', dst]
    subprocess.run(cmd, check=True)
    made[name] = os.path.getsize(dst)


def layer(name, parts, lufs=-12, dur=1.6):
    """Змішати кілька записів (src, початок, гучність, зміна тону) в один щільний звук."""
    cmd = ['ffmpeg', '-y', '-loglevel', 'error']
    for src, st, _, _ in parts:
        cmd += ['-ss', f'{st:.3f}', '-t', str(dur), '-i', src]
    chains = []
    for i, (_, _, gain, rate) in enumerate(parts):
        pitch = f'asetrate={int(48000 * rate)},aresample=48000,' if rate != 1 else ''
        chains.append(f'[{i}:a]aformat=channel_layouts=mono,aresample=48000,{pitch}volume={gain}[a{i}]')
    mix = ''.join(f'[a{i}]' for i in range(len(parts)))
    # стиснути й наситити: крик «ріже» і не губиться під ударом
    flt = ';'.join(chains) + f';{mix}amix=inputs={len(parts)}:normalize=0,acompressor=threshold=-18dB:ratio=6:attack=2:release=120,' \
        f'asoftclip=type=tanh,afade=t=out:st={dur - 0.25}:d=0.25,loudnorm=I={lufs}:TP=-0.5:LRA=7'
    cmd += ['-filter_complex', flt, '-ar', '48000', '-ac', '1', '-c:a', 'aac', '-b:a', '128k', f'{OUT}/{name}.m4a']
    subprocess.run(cmd, check=True)
    made[name] = os.path.getsize(f'{OUT}/{name}.m4a')


fetch()
cre = f'{SRC}/80-CC0-creature-SFX_0.zip.d'
attack = find('monster-snarl-attack.ogg')
hits = sorted(glob.glob(f'{SRC}/**/squishsplat_impact.mp3', recursive=True))
a_starts = loudest(attack, 1.6, 3, gap=2.0)
screams = [find('80-CC0-creature-SFX_0.zip.d/**/scream_01.ogg'), find('80-CC0-creature-SFX_0.zip.d/**/scream_02.ogg'), find('80-CC0-creature-SFX_0.zip.d/**/roar_02.ogg')]
# скример: гарчання впритул + крик на пів тону–тон нижче + мокрий удар на початку
for i, (st, sc) in enumerate(zip(a_starts, screams)):
    layer(f'scare_{i}', [(attack, st, 1.0, 1.0), (sc, 0.0, 0.8, 0.84 + i * 0.05), (hits[0], 0.0, 0.9, 0.7)])
# мокрі удари (м'ясо, кров)
for i, f in enumerate(sorted(glob.glob(f'{SRC}/**/impsplat/*.flac', recursive=True))):
    conv(f, f'gore_{i}', -16)
# хрускіт кісток: найгучніші шматки «екстремальних» послідовностей
k = 0
for f in sorted(glob.glob(f'{SRC}/**/extreme_splatter/*.flac', recursive=True)):
    for st in loudest(f, 1.4, 3, gap=1.6):
        conv(f, f'crunch_{k}', -16, st, 1.4)
        k += 1
# роздирання
rip = find('rippingintomeat_0.mp3')
for i, st in enumerate(loudest(rip, 2.2, 3, gap=3.0)):
    conv(rip, f'rip_{i}', -17, st, 2.2)
# «їсть» — знижений тон, повільніше: щось велике над тобою
for i in range(1, 5):
    conv(find(f'80-CC0-creature-SFX_0.zip.d/**/eat_0{i}.ogg'), f'feed_{i - 1}', -18, af_extra=('asetrate=36000,aresample=48000',))
# голоси монстрів (для «свого звуку» кожного): гарчання, подих
for i, n in enumerate(['monster-snarl-5.ogg', 'monster-snarls_0.ogg', 'monsters-snarls-3_0.ogg']):
    f = find(n)
    conv(f, f'snarl_{i}', -20, loudest(f, 2.5)[0], 2.5)
breath = find('ghostbreath.flac')
conv(breath, 'breath_0', -22)
for i, n in enumerate([1, 5, 9, 13]):
    conv(find(f'monster_-_starninjas.zip.d/**/monster.{n}.ogg'), f'growl_{i}', -20, af_extra=('asetrate=40000,aresample=48000',))

idx_path = f'{OUT}/index.json'
idx = set(json.load(open(idx_path))) if os.path.exists(idx_path) else set()
json.dump(sorted(idx | set(made)), open(idx_path, 'w'))
print(len(made), 'files,', sum(made.values()) // 1024, 'KB')
