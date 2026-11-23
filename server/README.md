# Сервер гри (Ample)

Один файл `server.mjs` (+ `feedback.mjs`), Node 22+, `pg`, `web-push`, керована Postgres від Ample.
Адреса: https://2x34tgfzwyad.ample.run (`/health` → `{"ok":true}`).

## Змінні (лише в Ample, ніколи в git)
| Змінна | Що |
|---|---|
| `DATABASE_URL` | Postgres (дає Ample) |
| `ADMIN_KEY` | повний доступ розробника |
| `FEEDBACK_KEY_SHA256` | sha256 (hex) ключа для відгуків; сам ключ — лише в мережевому секреті середовища Claude (див. `docs/FEEDBACK.md`) |
| `FEEDBACK_KEY` | (необов'язково) той самий ключ відкритим текстом |
| `FEEDBACK_SECRET` | підпис викликів доказу роботи; без нього — випадковий при кожному запуску (просто оновлюються виклики) |
| `FEEDBACK_SALT` | сіль для хешу IP (за замовчуванням = `FEEDBACK_SECRET`) |
| `VAPID_PUBLIC`, `VAPID_PRIVATE`, `AMPLE_JOB_TOKEN` | push-сповіщення про релізи (стара гра) |

## Викласти нову версію (Claude, конектор Ample)
1. Архів лише цієї теки: `tar -czf - -C server --exclude node_modules . | curl -T - <upload_url>` (url — з `ample_upload_create` у workspace сервера гри).
2. `ample_deploy` того самого застосунку: build `npm install --omit=dev`, start `node server.mjs`, public; змінні вище — лишити наявні,
   додати `FEEDBACK_KEY` (довгий випадковий рядок, задає Назар, див. нижче) і `FEEDBACK_SECRET` (`openssl rand -hex 32`).
3. Перевірити: `curl https://2x34tgfzwyad.ample.run/feedback/challenge` → `{"challenge":…,"bits":18}`;
   `npm run feedback -- stats` (з ключем) → `{}` або лічильники.
4. Таблиця `feedback` створюється сама при старті.

## Ключ для Claude (робить Назар, один раз)
Один і той самий довгий пароль (30+ випадкових символів) у двох місцях:
1. Ample → застосунок сервера гри → змінні середовища → `FEEDBACK_KEY`.
2. claude.ai → проєкт → Project settings → Cloud environment → середовище `backrooms` (шестерня) → Network secrets →
   хост `2x34tgfzwyad.ample.run`, значення — той самий пароль (або змінна середовища `ZK_FEEDBACK_KEY`).

Локально без бази: `PORT=8792 FEEDBACK_KEY=k node server/server.mjs` — відгуки в пам'яті.
