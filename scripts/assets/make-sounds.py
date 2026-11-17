"""Звуки гри: справжні записи CC0 (+ власні ембієнт-треки ACE-Step) → AAC .m4a (грає всюди, включно з Safari/iOS) у public/assets/sfx.
   python3 -I scripts/assets/make-sounds.py      (потрібен ffmpeg)
Джерела (ASSETS.md): Kenney «RPG Audio» (CC0, OpenGameArt), «Horror Hit Soundpack 1» (CC0, OpenGameArt), ACE-Step 1.5 (наші треки).
Гучність вирівнюється (loudnorm), моно 48 кГц, ембієнт-треки — стерео з м'якими краями для петлі."""
import glob
import json
import os
import subprocess

OUT = 'public/assets/sfx'
os.makedirs(OUT, exist_ok=True)
K = '.assets-src/kenney/rpg'
HH = '.assets-src/packs/horror_hits/Horror Hit Soundpack 1/Sound/Pitches'
manifest = {}


def find(pattern):
    r = sorted(glob.glob(pattern, recursive=True))
    if not r:
        raise SystemExit(f'немає файлу: {pattern}')
    return r[0]


def conv(src, name, lufs=-20, stereo=False, fade=0.0, dur=None):
    dst = f'{OUT}/{name}.m4a'
    af = [f'loudnorm=I={lufs}:TP=-1.5:LRA=11']
    if fade:
        # для петлі: короткі м'які краї, щоб стик не клацав
        af.append(f'afade=t=in:d={fade}')
        if dur:
            af.append(f'afade=t=out:st={dur - fade}:d={fade}')
    cmd = ['ffmpeg', '-y', '-loglevel', 'error', '-i', src]
    if dur:
        cmd += ['-t', str(dur)]
    cmd += ['-af', ','.join(af), '-ar', '48000', '-ac', '2' if stereo else '1', '-c:a', 'aac', '-b:a', '128k' if stereo else '80k', dst]
    subprocess.run(cmd, check=True)
    manifest[name] = os.path.getsize(dst)


# кроки (по твердому — для бетону/лінолеуму; на килимі гра приглушує фільтром)
for i in range(10):
    conv(find(f'{K}/**/footstep0{i}.ogg'), f'step_{i}', -24)
# двері, рип, папір, клацання ліхтарика, тканина (присід/рух)
for n in ('doorOpen_1', 'doorOpen_2', 'doorClose_1', 'doorClose_2', 'doorClose_3', 'doorClose_4', 'creak1', 'creak2', 'creak3',
          'bookFlip1', 'bookFlip2', 'bookFlip3', 'metalClick', 'metalLatch', 'cloth1', 'cloth2', 'cloth3', 'cloth4'):
    conv(find(f'{K}/**/{n}.ogg'), n.lower(), -22)
# удари жаху (рідко, як «оплата» напруги): низькі й середні
for i, f in enumerate(sorted(glob.glob(f'{HH}/Very Bassy/*.wav'))[:4] + sorted(glob.glob(f'{HH}/Bassy/*.wav'))[:4] + sorted(glob.glob(f'{HH}/Mid/*.wav'))[:2]):
    conv(f, f'hit_{i}', -18)
# ембієнт-треки рівнів (ACE-Step, наші): тихий фон, петля
for lv in ('l0', 'l1', 'l2'):
    src = sorted(glob.glob(f'.assets-src/music/{lv}/*.wav'))
    if src:
        conv(src[0], f'amb_{lv}', -28, stereo=True, fade=1.5, dur=40)
json.dump(sorted(manifest), open(f'{OUT}/index.json', 'w'))
print(len(manifest), 'files,', sum(manifest.values()) // 1024, 'KB')
