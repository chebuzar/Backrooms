# Тестовий сайт zakulisye.ample.run

Зібрана гра (~70 МБ) більша за ліміт завантаження Ample (32 МБ на архів, 16 МБ на файл), тому на Ample
викладається лише ця обгортка: під час збірки `build.mjs` завантажує код гри з публічного репозиторію
на коміті з `commit.txt`, збирає (`npm ci` + `vite build`) у `site/`, а `serve.mjs` роздає її.
Перевірка: `https://zakulisye.ample.run/build.txt` — коміт, що зараз на сайті.

Оновити (з кореня репозиторію, коміт уже на GitHub):
1. `git rev-parse HEAD > scripts/preview-site/commit.txt`
2. `ample_upload_create(archive, workspace=<ws>)` → `tar -czf - -C scripts/preview-site . | curl -T - <upload_url>`
3. `ample_deploy(workspace_id=<ws>, name=zakulisye-preview, build_command="npm run build", start="node serve.mjs", public)`
