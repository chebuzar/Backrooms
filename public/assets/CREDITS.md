# Ассети й ліцензії

Усі сторонні ассети гри з автором, джерелом і ліцензією. Скрипти `fetch-model` / `fetch-sound` дописують рядки самі.

## Code

- **three.js** — MIT. https://github.com/mrdoob/three.js
- **Rapier** (`@dimforge/rapier3d-compat`) — Apache-2.0. https://github.com/dimforge/rapier
- **recast-navigation-js** — MIT. https://github.com/isaac-mason/recast-navigation-js
- **Basis Universal transcoder** (`public/libs/basis/`) — Apache-2.0, Binomial LLC. https://github.com/BinomialLLC/basis_universal
- **meshoptimizer decoder** — MIT, Arseny Kapoulkine. https://github.com/zeux/meshoptimizer

## Завантажені моделі (fetch-model)

- `models/desk.glb` — «Metal Office Desk» — Ulan Cabanilla, **CC0 1.0**, Poly Haven: https://polyhaven.com/a/metal_office_desk
- `models/clipboard.glb` — «Clipboard» — ProgrammerOnCoffee, **CC0 1.0**, Poly Haven: https://polyhaven.com/a/clipboard
- `models/chair.glb` — «School Chair 01» — Ethan Place, **CC0 1.0**, Poly Haven: https://polyhaven.com/a/SchoolChair_01
- `models/box.glb` — «Cardboard Box 01» — Rahul Chaudhary, **CC0 1.0**, Poly Haven: https://polyhaven.com/a/cardboard_box_01
- `models/wetsign.glb` — «Wet Floor Sign 01» — Fran Calvente, **CC0 1.0**, Poly Haven: https://polyhaven.com/a/WetFloorSign_01
- `models/ammo.glb` — «Ammo Box» — DanKit, **CC0 1.0**, Poly Haven: https://polyhaven.com/a/ammo_box
- `models/cigs.glb` — «Cigarette Pack» — Ulrich Büch, **CC0 1.0**, Poly Haven: https://polyhaven.com/a/cigarette_pack
- `models/battery.glb` — батарейки 3336Л, власна модель (`scripts/blender/make_battery.py`); текстура — кроп «Metal Plate 02» (Rob Tuytel, **CC0 1.0**, Poly Haven: https://polyhaven.com/a/metal_plate_02), перефарбований (`scripts/assets/make-battery-tex.py`)
- `models/tape.glb` — «Portable Cassette Player» — Mateusz Sadek, **CC0 1.0**, Poly Haven: https://polyhaven.com/a/portable_cassette_player
- `models/phone.glb` — радянський дисковий телефон, власна модель (`scripts/blender/make_phone.py`), однотонні матеріали
- `models/locker.glb` — сталеві шафки роздягальні, власна модель (`scripts/blender/make_locker.py`); текстура — кроп «Metal Plate 02» (Rob Tuytel, **CC0 1.0**, Poly Haven), перефарбований (`scripts/assets/make-locker-tex.py`)

## Текстури Poly Haven

- `tex/painted_concrete` — «Painted Concrete» — Dario Barresi, Dimitrios Savva, **CC0 1.0**, Poly Haven: https://polyhaven.com/a/painted_concrete
- `tex/painted_plaster_wall` — «Painted Plaster Wall» — Amal Kumar, **CC0 1.0**, Poly Haven: https://polyhaven.com/a/painted_plaster_wall
- `tex/concrete_wall_008` — «Concrete Wall 008» — Dario Barresi, Charlotte Baglioni, **CC0 1.0**, Poly Haven: https://polyhaven.com/a/concrete_wall_008
- `tex/blue_plaster_weathered` — «Blue Plaster Weathered» — Amal Kumar, **CC0 1.0**, Poly Haven: https://polyhaven.com/a/blue_plaster_weathered
- `tex/garage_floor` — «Garage Floor» — Jenelle van Heerden, **CC0 1.0**, Poly Haven: https://polyhaven.com/a/garage_floor
- `tex/rough_concrete` — «Rough Concrete» — Dimitrios Savva, **CC0 1.0**, Poly Haven: https://polyhaven.com/a/rough_concrete
- `tex/ceiling_interior` — «Ceiling Interior» — Dimitrios Savva, **CC0 1.0**, Poly Haven: https://polyhaven.com/a/ceiling_interior
- `tex/dirty_carpet` — «Dirty Carpet» — Rohit Seervi, **CC0 1.0**, Poly Haven: https://polyhaven.com/a/dirty_carpet

## Текстури рівня 0 (обробка справжніх текстур скриптом `scripts/assets/make-level0-textures.py`)

- `tex/level0/wall_c` — ShareTextures «Wallpaper 10», **CC0**: https://www.sharetextures.com/textures/wall/wallpaper-10 (перефарбовано)
- `tex/level0/wall_n`, `wall_r`, `dmg_c`, `mold` — ambientCG Wallpaper001A, Wallpaper001C, Wallpaper002C, **CC0**: https://ambientcg.com
- `tex/level0/ceil_*` — ambientCG OfficeCeiling001, **CC0**: https://ambientcg.com/view?id=OfficeCeiling001
- `tex/level0/paint_*` — ambientCG PaintedPlaster017, **CC0**: https://ambientcg.com/view?id=PaintedPlaster017
- `tex/level0/peel_*` — ambientCG Plaster007, **CC0**: https://ambientcg.com/view?id=Plaster007
- `tex/level0/parquet_*` — ambientCG WoodFloor034, **CC0**: https://ambientcg.com/view?id=WoodFloor034
- `tex/level0/decals` — ambientCG Leaking001, Leaking004–009, **CC0**: https://ambientcg.com

## Звуки (`public/assets/sfx`, скрипт `scripts/assets/make-sounds.py`)

- `step_*`, `dooropen_*`, `doorclose_*`, `creak*`, `bookflip*`, `metalclick`, `metallatch`, `cloth*` — Kenney «RPG Audio», **CC0**: https://opengameart.org/content/rpg-sound-pack (kenney.nl)
- `hit_*` — «Horror Hit Soundpack 1», **CC0**, OpenGameArt
- `amb_l0`, `amb_l1`, `amb_l2` — згенеровано нами моделлю ACE-Step 1.5 (Apache-2.0)
- гул ламп, гул Шва — синтез у грі (`src/audio/synth.ts`)

## Монстри
- `models/figure.glb`, `models/watcher.glb`, `models/blind.glb` — тіла MakeHuman/MPFB2 (системні ассети, **CC0**: шкіра old_caucasian_male, роба male_worksuit01, очі low-poly), зібрані нашим скриптом `scripts/blender/make_monster.py` (пресети figure / watcher / blind); протигаз фигуры — Poly Haven «Old Gas Mask», **CC0**
- клацання «Слепого» й серцебиття небезпеки — синтез у грі (`src/audio/synth.ts`)
- `tex/metal_plate_02` — «Metal Plate 02» — Rob Tuytel, **CC0 1.0**, Poly Haven: https://polyhaven.com/a/metal_plate_02
- `tex/linoleum_brown` — «Linoleum Brown» — Rob Tuytel, **CC0 1.0**, Poly Haven: https://polyhaven.com/a/linoleum_brown
