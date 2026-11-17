import { describe, it, expect } from 'vitest';
import { Tutorial, type Tip } from '../../src/game/tutorial';

const tips: Tip[] = [{ id: 'light', key: 'F', text: 'фонарик' }, { id: 'run', key: 'Shift', text: 'бег' }];
describe('controls tutorial', () => {
  it('shows tips one by one: next after the action is tried (but not before 2.5 s) or after 7 s', () => {
    const shown: (string | null)[] = [];
    const t = new Tutorial(tips, (x) => shown.push(x?.id ?? null));
    t.start();
    expect(shown).toEqual(['light']);
    t.update(1, () => true); // зарано, навіть якщо вже натиснув
    expect(t.current).toBe('light');
    t.update(2, () => true);
    expect(t.current).toBe('run');
    for (let k = 0; k < 8; k++) t.update(1, () => false); // не пробує — підказка однаково йде через 7 с
    expect(t.active).toBe(false);
    expect(shown).toEqual(['light', 'run', null]);
  });
});
