import { describe, it, expect } from 'vitest';
import { prologueTimeline } from '../../src/ui/prologue-time';
import { PROLOGUE } from '../../src/story/ru';

describe('prologue', () => {
  it('lasts about 45–50 s without skipping (was ~105 s in the playtest)', () => {
    const { total } = prologueTimeline(PROLOGUE);
    expect(total).toBeGreaterThanOrEqual(44);
    expect(total).toBeLessThanOrEqual(50);
  });
  it('lines follow each other without overlap', () => {
    const { lines } = prologueTimeline(PROLOGUE);
    for (let i = 1; i < lines.length; i++) expect(lines[i]!.start).toBeGreaterThanOrEqual(lines[i - 1]!.end);
  });
});
