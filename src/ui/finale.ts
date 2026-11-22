// Фінал: вибір за Швом (два варіанти, клавіші 1/2 або дотик) і титри з ім'ям Оператора та підсумком проходження.
import { esc } from './esc';

/** Чорний екран із питанням і двома відповідями. Повертає 0 або 1. */
export function finaleChoice(root: HTMLElement, title: string, options: [string, string]): Promise<0 | 1> {
  return new Promise((done) => {
    const el = document.createElement('div');
    el.className = 'prologue finale-choice';
    el.innerHTML = `<div class="fc"><p class="fc-t">${esc(title)}</p>
      <nav class="menu">${options.map((o, i) => `<button class="line-btn" data-i="${i}"><span class="fc-k">${i + 1}</span>${esc(o)}</button>`).join('')}</nav></div>`;
    root.appendChild(el);
    requestAnimationFrame(() => el.classList.add('shown'));
    let picked = false;
    const pick = (i: 0 | 1) => {
      if (picked) return;
      picked = true;
      removeEventListener('keydown', onKey);
      el.classList.remove('shown');
      setTimeout(() => { el.remove(); done(i); }, 900);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === '1') pick(0); else if (e.key === '2') pick(1); };
    // пауза перед вибором: випадковий клік, що лишився від гри, не вибирає замість гравця
    setTimeout(() => {
      el.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.addEventListener('click', () => pick(Number(b.dataset.i) as 0 | 1)));
      addEventListener('keydown', onKey);
      el.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
    }, 1200);
  });
}

/** Титри: ім'я (або «не вспомнил»), підсумок, автори. Кнопка «В меню» з'являється, коли титри дійшли до кінця. */
export function finaleCredits(root: HTMLElement, name: string, stats: string, credits: string[]): Promise<void> {
  return new Promise((done) => {
    const el = document.createElement('div');
    el.className = 'prologue finale-credits';
    const [head, ...rest] = credits;
    el.innerHTML = `<div class="cr"><p class="cr-name">${esc(name)}</p><p class="cr-stats">${esc(stats)}</p>
      <p class="cr-head">${esc(head ?? '')}</p>${rest.map((l) => `<p class="cr-line">${esc(l)}</p>`).join('')}
      <button class="line-btn cr-close">В меню</button></div>`;
    root.appendChild(el);
    requestAnimationFrame(() => el.classList.add('shown'));
    const btn = el.querySelector('.cr-close') as HTMLButtonElement;
    const lines = [...el.querySelectorAll<HTMLElement>('.cr > *')];
    // рядки проявляються по черзі, як у кінці плівки
    lines.forEach((p, i) => setTimeout(() => p.classList.add('in'), 900 + i * (i < 2 ? 2600 : 1300)));
    setTimeout(() => btn.focus({ preventScroll: true }), 900 + lines.length * 1300 + 2600);
    btn.addEventListener('click', () => {
      el.classList.remove('shown');
      setTimeout(() => { el.remove(); done(); }, 900);
    });
  });
}
