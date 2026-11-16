# CLAUDE.md — «Закулисье» (нова гра з нуля, з 16.11.2026)

## Головне
- Власник (Назар) керує словами, код не пише й не читає. Claude — розробник і тестувальник: пише код, сам грає, дивиться скріншоти, виправляє.
- Спілкування — **українською**, просто, без жаргону; пояснювати, що бачить гравець. Звіти — зі скріншотами.
- **Гра — російською** (усі тексти). Вік 18+: справжній хоррор, без дитячих спрощень; на старті — екран «18+».
- Мета: якість і цікавість рівня **Escape the Backrooms**; плавно на ПК (Chrome, Safari, Firefox) і на **iPad/iPhone з iPadOS/iOS 27+** у Safari.
- **Стару гру не використовувати взагалі** (код, графіку, механіки, рівні, дизайн) — вона лише в історії git. Зі старої взято тільки сюжет → `docs/STORY.md`.
- **План і прогрес — `docs/PLAN.md`**. На початку сесії читати його й продовжувати з першого незробленого пункту; після кожної частини — оновити позначки й «Журнал сесій». Що блокує — у розділ «Потрібна допомога Назара», і працювати далі.
- Якість понад усе: нічого «як заглушка». Погано вийшло — переробити, перш ніж іти далі. Після кожної видимої зміни — скріншоти (Chromium + WebKit, для інтерфейсу ще iPhone/iPad) і чесна оцінка.
- Наприкінці всього плану — повна перевірка (етап 6 у PLAN.md) і `docs/QA-REPORT.md`.

## Основа
- Three.js **r187** `WebGPURenderer` (якщо WebGPU немає — сам WebGL 2), шейдери й ефекти на **TSL**, **TypeScript** (strict), **Vite 8**.
- Імпорт: `import * as THREE from 'three/webgpu'`, функції TSL — з `'three/tsl'`, аддони — `'three/addons/...'`. У `vite.config.ts` `three` → `three/webgpu`, щоб не було двох копій.
- Типи `@types/three` місцями відстають від r187 (напр. `getTextureNode()` у TRAANode/BloomNode) — обгортки в коді з коментарем.
- Фізика/колізії — Rapier (`@dimforge/rapier3d-compat`), навігація монстрів — `recast-navigation` (+ `@recast-navigation/three`). Онлайн (пізніше) — PeerJS.
- Нові бібліотеки — лише коли потрібні, з коротким поясненням власнику.
- **Рішення власника (16.11.2026):** Claude сам шукає й підключає репозиторії, бібліотеки, MCP-сервери й конектори, коли вони потрібні для задачі — лише якісні (активно підтримуються, нормальна ліцензія, багато користувачів). Не підключати те, що вимагає від власника багатьох дій (реєстрації, оплати, складних налаштувань); перевага — джерелам без ключів. Що підключено — коротко згадати у звіті й записати в цей файл.

## Структура
- `src/main.ts` — вхід. `src/core` (пристрій, цикл, збереження), `src/render` (рендерер, постобробка `post.ts`, профілі `quality.ts`, матеріали), `src/dev` (тестові сцени, не в грі).
- Профілі графіки: `low/medium/high/ultra`, «авто» за пристроєм (`autoQuality`) + `QualityGovernor` (м'яко підлаштовує лише роздільність рендера за часом кадру).
- Постобробка (`post.ts`): сцена з MRT (нормалі, швидкості) → GTAO → TRAA → Bloom → фінальний «об'єктив»: дисторсія, аберація, AgX, грейдинг, віньєтка, зерно; параметри — `look.*` (uniform).

## Рівні: як будуються (конвеєр)
1. **Планування** — `src/world/layout.ts` (`generateLayout({seed})`): сітка 1.2 м, стіни на ребрах, колони, лампи 1.2×0.6 через 2.4 м, зони (`rooms/hall/corridors/dark`), старт, вихід, сюжетні точки. Детерміноване; спільне для гри (колізії, предмети, navmesh) і Blender. Тести — `tests/unit/layout.test.ts`. Карта зверху: `npx tsx scripts/levels/map.ts <seed>` → `.shots/map-<seed>.png`.
2. **Експорт** — `npx tsx scripts/levels/export-layout.ts <seed> .assets-src/levels/level0-<seed>.json`.
3. **Blender: геометрія + запікання світла** — `blender -b -P scripts/blender/build_level.py -- --layout <json> --out .assets-src/levels/level0 [--chunks "1,1;2,1"] [--size 512] [--samples 128]`. Шматки 12×12 м, UV0 у метрах, UV1 — карта світла; 900 ламп як area-світло; ~2.3 хв на шматок (36 шматків ≈ 80 хв на 4 ядрах) — запускати у фоні, `nice`. Карта зберігає `sqrt(E/LMAX)`, LMAX = 4 (у грі `materials.ts` декодує й подає як irradiance).
4. **Публікація** — `python3 -I scripts/levels/publish-level.py .assets-src/levels/level0 public/assets/levels/level0` (gltfpack Meshopt без квантування + KTX2 UASTC для карт світла).
- Матеріали (`src/world/materials.ts`): `BakedMaterial` (перевизначає `setupLightMap` → `IrradianceNode`), процедурні візерунок шпалер / сітка стелі (зсув 0.3 по Z під лампи) / вологі плями; предмети без карти світла — `probeLit` + `probeAt` (освітленість від найближчих ламп).
- Лампи — один `InstancedMesh` (`lamps.ts`), стан і мерехтіння через instanced-атрибут. «Шов» — `seam.ts`. Предмети рівня 0 — `placeProps` у `level0.ts` (Poly Haven, CC0).
- Текстури рівня: `python3 -I scripts/assets/make-textures.py` (ambientCG → KTX2 у `public/assets/tex/level0`).

## Монстри (ШІ й моделі)
- ШІ — `src/ai/brain.ts` (зір зі світлом/ліхтариком/присідом, слух з приглушенням стінами, пам'ять, стани patrol → suspicious → investigate → chase → search → lost, правила `movesWhenUnseen`, `fearsLight`, `cutsOff`) + `src/ai/nav.ts` (recast navmesh з того ж планування). Тести — `tests/unit/ai.test.ts`.
- Моделі: генератор `blender -b -P scripts/blender/make_monster.py -- --preset watcher --out .assets-src/monsters/watcher.glb`. Встановлення в новому контейнері: аддон — `blender -b --command extension install-file -r user_default -e .assets-src/makehuman/mpfb.zip` (zip із `mpfb2/src/mpfb`, репозиторій makehumancommunity/mpfb2), ассети — розпакувати `makehuman_system_assets_cc0.zip` (files2.makehumancommunity.org/asset_packs/…, 281 МБ) у `~/.config/blender/4.5/extensions/.user/user_default/mpfb/data`.
- Тіла **MakeHuman/MPFB2** (CC0; аддон встановлюється в Blender з `.assets-src/makehuman/mpfb.zip`, приклад — `scripts/blender/mh_test.py`, скелет `game_engine` 53 кістки) + анімації **Quaternius UAL** (CC0, `.assets-src/packs/ual`), перенесення — `src/world/monsters/retarget.ts` (`MH_TO_UAL`).
- Джерела без ключів — таблиця в `docs/PLAN.md`.

## Команди
| Команда | Що робить |
|---|---|
| `npm run dev` | dev-сервер |
| `npm run check` | lint + typecheck + юніт-тести + build + smoke (Chromium WebGPU + WebKit WebGL2) |
| `npm run shot -- [--browser chromium,webkit,firefox\|all] [--device "iPhone 15 Pro landscape"] [--query "q=high"] [--webgl] [--eval js] [--prod] [--name x]` | скріншот + стан гри (`__zk.info()`) + помилки/попередження консолі (код 1, якщо є) |
| `npm run smoke` | зібрана гра в Chromium і WebKit без помилок |
| `?debug` в адресі | `window.__zk` (renderer, scene, camera, info()) ; `?webgl` — примусово WebGL 2; `?q=low\|medium\|high\|ultra` |

- Порт скріншотів — 5191 (**4190 WebKit блокує** як «небезпечний»).
- Chromium у контейнері запускається з програмним WebGPU (SwiftShader) — FPS не показовий, порівнювати відносно; WebKit у Playwright — без WebGPU (перевіряє запасний WebGL 2).
- Firefox у контейнері працює лише з віртуальним екраном і програмним OpenGL: `LIBGL_ALWAYS_SOFTWARE=1 xvfb-run -a -s "-screen 0 1280x720x24" npm run shot -- --browser firefox` (потрібні пакети `xvfb libgl1-mesa-dri`; браузер — `npx playwright install firefox`).

## Ассети й ліцензії
- Джерела: Poly Haven, ambientCG (CC0, без ключа), Sketchfab/Freesound/Meshy (ключі — лише зі змінних середовища або network secrets; **ніколи в коді/git**). Кожен ассет — у `public/assets/CREDITS.md` (fetch-скрипти дописують самі).
- Конвеєр: `npm run optimize-asset` (Blender → simplify → KTX2 → Meshopt → `public/assets/models`), `npm run asset-view`, `npm run fetch-model`, `npm run fetch-sound`, `scripts/blender/bake.py` (запікання світла), `npm run blender-test`.
- Інструменти середовища (Blender 4.5, KTX-Software, Meshy CLI, Spector MCP, `../refs`) ставить скрипт налаштування середовища `backrooms`.
- MCP: `context7` (документація — перевіряти API r187), `playwright`, `chrome-devtools` (профілювання), `spector` (аналіз кадру WebGL), `meshy`; плагін `parallax-threejs` (міст до сцени: `set_dev_port`, `http://localhost:9222/?debug`).
- Додано 16.11.2026 на прохання власника: плагін `claude-code-setup` (офіційний, проєктний — `.claude/settings.json`); `claude-mem` (пам'ять між сесіями, локально, провайдер — акаунт Claude, телеметрія вимкнена; веб-перегляд `http://127.0.0.1:37700`); скіл `task-observer` (`.claude/skills/task-observer`, хук `.claude/hooks/task-observer-start.sh`, журнал — `.task-observer/`, не в git); `godot-mcp` (MCP `godot`, Godot 4.5.1 у `/usr/local/bin/godot`; для цієї гри не потрібен); ACE-Step 1.5 (музика/ембієнт, Apache-2.0; ставиться на вимогу `bash scripts/audio/ace-step-install.sh` — ~16 ГБ; генерація `~/tools/ACE-Step-1.5/.venv/bin/python scripts/audio/ace_generate.py --caption … --duration 20 --out .assets-src/music`, CPU: 10 с звуку ≈ 1 хв). Не встановлено: UnrealClaude (потрібен Unreal Engine 5.7), Audio2Face-3D (потрібна відеокарта NVIDIA). claude-mem і Godot+godot-mcp ставить скрипт налаштування середовища.

## Правила
- Safari/iOS: звук лише після жесту; pointer lock на iOS немає; `dvh` і safe-area; перевіряти WebKit на кожну зміну рендера, звуку, керування, CSS.
- Консоль браузера: жодних помилок і попереджень (smoke падає на них).
- Збереження: ключ `localStorage` `zakulisye_v3`; формат версіонувати.
- Коміти англійською, атомарні, з поясненням «чому». Гілка сесії; у `main` — коли власник погодить (push у `main` публікує сайт).
- Не комітити `.shots/`, `dist/`, `node_modules/`, `.env`.

## Сервер (`server/`, хостинг Ample — акаунт власника)
- Залишився від старої гри (акаунти, хмарні сейви, звіти, push). Новою грою поки не використовується; `public/release.json` не видаляти — його читає задача сервера. Секрети (`ADMIN_KEY`, `VAPID_*`) — лише в Ample.

## Деплой
**Тестова версія (поки нова гра не в `main`)** — https://zakulisye.ample.run (статичний застосунок `zakulisye-preview`, Ample, акаунт власника). Оновлення: `npm run build`, `tar -czf <tmp>/preview.tar.gz -C dist .` (≤ 32 МБ), `ample_upload_create(archive, name=zakulisye-preview, deploy)` → `curl -T <tar> <upload_url>` → `ample_upload_get(wait)`.

Push у `main` → `.github/workflows/deploy.yml`: lint → typecheck → test → build (`BASE_PATH=/Backrooms/`) → smoke → GitHub Pages (https://chebuzar.github.io/Backrooms/).

## task-observer (скіл rebelytics, встановлено 16.11.2026)
```text
(task-observer activation block — template of v3.11.0)
Before the first tool call of any session, and before writing or
proposing a plan, invoke the task-observer skill AND run its Session
Start Protocol: loading the skill without running the protocol activates
nothing. Any turn that will involve a tool call counts; do not classify
the session as "too simple" from its opening message. A step you did not
run goes to session-starts.log; the reply carries it, in one line before
the answer, only when the user can act on it (a failed probe, a review or
staged update due, an activation gap). If the skill does not resolve on
this turn, tell
the user in your first reply, never only in a log; say which probe told
you so (the skill listing, or the skill directory on disk), re-check the listing on every later turn that makes a tool call,
and run the protocol the first time it resolves — a "not installed"
verdict holds for one turn. Listed on disk but refused by the Skill tool
("Unknown skill"): read its SKILL.md directly and run the protocol.

After completing each task, list the observation records written this
session in the same turn and append a one-line summary from that listing
to checkpoints.log (ids and titles, or "none logged" followed by one line
per user correction and per incident in the task, each with why it is not
an observation) — never from memory of writing them. The reply names only
what was logged, in one line; "none logged" stays in the file. This is the
backstop: it catches a session in which the skill never ran.

The task-observer workspace for this project is:
  /home/user/Backrooms/.task-observer
Every path the skill uses derives from that root, never from the current
working directory.

A subagent dispatched by a session that runs this protocol does not run
it and does not write to the log; it reports its findings to its caller.
```
