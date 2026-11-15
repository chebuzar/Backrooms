# Закулисье · Backrooms

Хорор від першої особи про нескінченні жовті кімнати. Працює просто в браузері: Chrome, Safari (macOS та iOS), Edge, Firefox, на комп'ютері й телефоні.

Моделі, текстури, світло й звук генеруються кодом (Three.js + WebAudio), тому кожен лабіринт новий. Кооп до 4 гравців із голосовим чатом через WebRTC (PeerJS).

**Грати:** https://chebuzar.github.io/Backrooms/ (після першого деплою)

## Швидкий старт

Потрібен Node.js 20+ (див. `.nvmrc`).

```bash
npm install
npm run dev        # локальний сервер з гарячим перезавантаженням
```

Відкрий адресу, яку покаже Vite. Щоб перевірити з телефона в тій самій Wi-Fi мережі, використай адресу `Network:`.

| Команда | Що робить |
|---|---|
| `npm run dev` | сервер розробки |
| `npm run build` | збірка в `dist/` |
| `npm run preview` | локальний перегляд зібраної версії |
| `npm run lint` | ESLint |
| `npm run smoke` | браузерний smoke-тест зібраної версії (Playwright: Chromium + WebKit/Safari) |
| `npm run shot -- --level 3` | скріншот сцени гри в Chromium/WebKit, на комп'ютері чи телефоні (див. `CLAUDE.md`) |
| `npm run check` | lint + build + smoke |

## Структура

```
index.html              розмітка інтерфейсу (тексти через data-i18n)
public/                 іконки, маніфест (копіюються як є)
src/
  main.js               точка входу: шрифти, стилі, мова, перевірка WebGL
  game.js               ігровий цикл, гравець, HUD, меню, керування, кооп
  core/util.js          rng, математика, збереження в localStorage
  data/game-data.js     рівні, складність, записки, досягнення, монстри
  render/textures.js    процедурні текстури (canvas)
  world/level.js        генерація лабіринту і побудова геометрії рівня
  world/entity.js       монстри: модель, анімація, ШІ
  world/extras.js       завдання, аномалії, підказки
  audio/sound.js        звук і музика (WebAudio)
  net/net.js            онлайн: PeerJS / BroadcastChannel
  i18n/                 локалізація: t(), applyI18n(), словники ru / uk / en
  styles/main.css       стилі
scripts/smoke.mjs       smoke-тест
scripts/shot.mjs        скріншоти для перевірки (QA)
```

## Мови

Вихідна мова — російська (`src/i18n/locales/ru.js`). Також є українська та англійська.

- Мова інтерфейсу меню та підказок уже береться зі словників.
- Ігрові рядки всередині JS (назви рівнів, записки, завдання, повідомлення) поки що російською. Поки їх не перенесено, перемикач мови прихований (`I18N_READY = false` в `src/i18n/index.js`).
- Перевірити переклад можна через `?lang=uk` або `?lang=en` в адресі.

## Деплой

Кожен push у `main` запускає `.github/workflows/deploy.yml`: lint → збірка → smoke-тест → публікація на GitHub Pages. Pull request проходить ту саму перевірку без публікації.

Один раз у налаштуваннях репозиторію: **Settings → Pages → Build and deployment → Source: GitHub Actions**.

## Онлайн

- На сайті: WebRTC через публічний сервер PeerJS і їхній TURN. Для стабільної гри в різних мережах краще мати власний TURN (наприклад, coturn або платний сервіс).
- Дві вкладки на одному комп'ютері: додай `#localnet` до адреси.
