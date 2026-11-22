// Тестовий сайт: гра (публічний репозиторій chebuzar/Backrooms) на точному коміті, зібрана тут же.
// Ample обмежує завантаження до 32 МБ, а зібрана гра — ~70 МБ, тому код береться з GitHub під час збірки.
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, rmSync, renameSync } from 'node:fs';
// коміт гри — у commit.txt (його пише той, хто викладає обгортку: git rev-parse HEAD > commit.txt)
const SHA = readFileSync('commit.txt', 'utf8').trim();
const run = (c, cwd) => execSync(c, { stdio: 'inherit', cwd, env: { ...process.env, BUILD_COMMIT: SHA } }); // коміт — у відгуки гравців
const res = await fetch(`https://codeload.github.com/chebuzar/Backrooms/tar.gz/${SHA}`);
if (!res.ok) throw new Error('download ' + res.status);
writeFileSync('src.tgz', Buffer.from(await res.arrayBuffer()));
rmSync('src', { recursive: true, force: true });
run('mkdir -p src && tar xzf src.tgz -C src --strip-components=1 && rm src.tgz');
run('npm ci --no-audit --no-fund', 'src');
run('npx vite build', 'src');
rmSync('site', { recursive: true, force: true });
renameSync('src/dist', 'site');
rmSync('src', { recursive: true, force: true });
writeFileSync('site/build.txt', SHA + '\n');
