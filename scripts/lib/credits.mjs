// Запис автора й ліцензії в public/assets/CREDITS.md (для fetch-model / fetch-sound).
// Рядок для того самого файлу замінюється, а не дублюється.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const CREDITS = fileURLToPath(new URL('../../public/assets/CREDITS.md', import.meta.url));

export function addCredit(section, file, line) {
  const entry = `- \`${file}\` — ${line}`;
  const lines = readFileSync(CREDITS, 'utf8').replace(/\s*$/, '').split('\n')
    .filter((l) => !l.startsWith(`- \`${file}\` — `));
  const head = `## ${section}`;
  let i = lines.indexOf(head);
  if (i < 0) { lines.push('', head, ''); i = lines.length - 2; }
  let j = i + 1;
  while (j < lines.length && !lines[j].startsWith('## ')) j++;
  while (j > i + 1 && lines[j - 1] === '') j--; // after the last entry of the section
  if (j === i + 1) { lines.splice(j, 0, ''); j++; }
  lines.splice(j, 0, entry);
  writeFileSync(CREDITS, lines.join('\n').replace(/\n{3,}/g, '\n\n') + '\n');
  return entry;
}

// Ключ API: зі змінної середовища; якщо її немає — заглушка, яку замінює мережевий шлюз
// хмарного середовища Claude (ключ збережений там як network secret і в код не потрапляє).
export const apiKey = (name) => process.env[name] || 'proxy-injected';

// Загальний User-Agent без особистих даних.
export const UA = 'asset-fetch-script/1.0';
