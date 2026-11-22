// Фінал за останнім Швом: епілог друкарською машинкою → вибір (піти чи лишитися) → кінцівка → ім'я Оператора, підсумок, титри.
import type { HUD } from '../ui/hud';
import { finaleChoice, finaleCredits } from '../ui/finale';
import { FINALE, FINDINGS } from '../story/ru';
import { THEMED } from '../world/level-themed';
import type { Progress } from '../core/save';

/** Усі записи, які можна знайти за гру (документи на столах, записки, плівки). */
export function allRecords(): string[] {
  const ids = new Set<string>(['order7', 'instr', 'note1']);
  for (const list of Object.values(FINDINGS)) for (const f of list) ids.add(f.id);
  for (const t of Object.values(THEMED)) ids.add(t.doc);
  return [...ids];
}

export function recordsFound(p: Progress): { found: number; total: number } {
  const all = allRecords(), have = new Set([...p.docs, ...p.notes, ...p.tapes]);
  return { found: all.filter((id) => have.has(id)).length, total: all.length };
}

/** Показати фінал; повертає вибір гравця. typeSound — клацання машинки на кожну літеру. */
export async function runFinale(hud: HUD, root: HTMLElement, p: Progress, typeSound: () => void): Promise<'leave' | 'stay'> {
  await hud.prologue(FINALE.intro, typeSound);
  const pick = await finaleChoice(root, FINALE.choiceTitle, [FINALE.leave, FINALE.stay]);
  const ending = pick === 0 ? 'leave' : 'stay';
  await hud.prologue(ending === 'leave' ? FINALE.leaveText : FINALE.stayText, typeSound);
  const { found, total } = recordsFound(p);
  if (!p.endings.includes(ending)) p.endings.push(ending);
  const stats = FINALE.stats(Math.max(1, Math.round(p.playSeconds / 60)), p.deaths, found, total);
  await finaleCredits(root, found >= total ? FINALE.nameAll : FINALE.nameNone, stats, FINALE.credits);
  return ending;
}
