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

## Структура
- `src/main.ts` — вхід. `src/core` (пристрій, цикл, збереження), `src/render` (рендерер, постобробка `post.ts`, профілі `quality.ts`, матеріали), `src/dev` (тестові сцени, не в грі).
- Профілі графіки: `low/medium/high/ultra`, «авто» за пристроєм (`autoQuality`) + `QualityGovernor` (м'яко підлаштовує лише роздільність рендера за часом кадру).
- Постобробка (`post.ts`): сцена з MRT (нормалі, швидкості) → GTAO → TRAA → Bloom → фінальний «об'єктив»: дисторсія, аберація, AgX, грейдинг, віньєтка, зерно; параметри — `look.*` (uniform).

## Команди
| Команда | Що робить |
|---|---|
| `npm run dev` | dev-сервер |
| `npm run check` | lint + typecheck + юніт-тести + build + smoke (Chromium WebGPU + WebKit WebGL2) |
| `npm run shot -- [--browser chromium,webkit,firefox\|all] [--device "iPhone 15 Pro landscape"] [--query "q=high"] [--webgl] [--eval js] [--prod] [--name x]` | скріншот + стан гри (`__zk.info()`) + помилки/попередження консолі (код 1, якщо є) |
| `npm run smoke` | зібрана гра в Chromium і WebKit без помилок |
| `?debug` в адресі | `window.__zk` (renderer, scene, camera, info()) ; `?webgl` — примусово WebGL 2; `?q=low\|medium\|high\|ultra` |

- Порт скріншотів — 5191 (**4190 WebKit блокує** як «небезпечний»).
- Chromium у контейнері запускається з програмним WebGPU (SwiftShader) — FPS не показовий, порівнювати відносно; WebKit у Playwright — без WebGPU (перевіряє запасний WebGL 2). Firefox: `npx playwright install firefox`, якщо немає.

## Ассети й ліцензії
- Джерела: Poly Haven, ambientCG (CC0, без ключа), Sketchfab/Freesound/Meshy (ключі — лише зі змінних середовища або network secrets; **ніколи в коді/git**). Кожен ассет — у `public/assets/CREDITS.md` (fetch-скрипти дописують самі).
- Конвеєр: `npm run optimize-asset` (Blender → simplify → KTX2 → Meshopt → `public/assets/models`), `npm run asset-view`, `npm run fetch-model`, `npm run fetch-sound`, `scripts/blender/bake.py` (запікання світла), `npm run blender-test`.
- Інструменти середовища (Blender 4.5, KTX-Software, Meshy CLI, Spector MCP, `../refs`) ставить скрипт налаштування середовища `backrooms`.
- MCP: `context7` (документація — перевіряти API r187), `playwright`, `chrome-devtools` (профілювання), `spector` (аналіз кадру WebGL), `meshy`; плагін `parallax-threejs` (міст до сцени: `set_dev_port`, `http://localhost:9222/?debug`).

## Правила
- Safari/iOS: звук лише після жесту; pointer lock на iOS немає; `dvh` і safe-area; перевіряти WebKit на кожну зміну рендера, звуку, керування, CSS.
- Консоль браузера: жодних помилок і попереджень (smoke падає на них).
- Збереження: ключ `localStorage` `zakulisye_v3`; формат версіонувати.
- Коміти англійською, атомарні, з поясненням «чому». Гілка сесії; у `main` — коли власник погодить (push у `main` публікує сайт).
- Не комітити `.shots/`, `dist/`, `node_modules/`, `.env`.

## Сервер (`server/`, хостинг Ample — акаунт власника)
- Залишився від старої гри (акаунти, хмарні сейви, звіти, push). Новою грою поки не використовується; `public/release.json` не видаляти — його читає задача сервера. Секрети (`ADMIN_KEY`, `VAPID_*`) — лише в Ample.

## Деплой
Push у `main` → `.github/workflows/deploy.yml`: lint → typecheck → test → build (`BASE_PATH=/Backrooms/`) → smoke → GitHub Pages (https://chebuzar.github.io/Backrooms/).
