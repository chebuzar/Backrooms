import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { leadingZeroBits, sha256Hex, sha256Words, solvePow } from '../../src/net/pow';
import { checkPow, cleanText, makeChallenge, textKey } from '../../server/feedback.mjs';

describe('sha256 (pow.ts)', () => {
  it('matches node:crypto on empty, short, block-edge and long inputs', () => {
    for (const s of ['', 'abc', 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(64), 'Закулисье — Объект 4-Б'.repeat(9)]) {
      expect(sha256Hex(s)).toBe(createHash('sha256').update(s).digest('hex'));
    }
  });
  it('counts leading zero bits', () => {
    expect(leadingZeroBits(new Uint32Array([0, 1, 0, 0, 0, 0, 0, 0]))).toBe(63);
    expect(leadingZeroBits(new Uint32Array([0x0fffffff, 0, 0, 0, 0, 0, 0, 0]))).toBe(4);
    expect(leadingZeroBits(sha256Words(new TextEncoder().encode('abc')))).toBe(0);
  });
});

describe('proof of work: client solves, server verifies', () => {
  it('accepts a solved challenge once and rejects reuse, forgery and expiry', async () => {
    const used = new Map<string, number>();
    const c = makeChallenge(12);
    const nonce = await solvePow(c, 12);
    expect(checkPow(c, nonce, used)).toBeNull();
    expect(checkPow(c, nonce, used)).toBe('used');
    const forged = c.replace(/\.12\./, '.4.');
    expect(checkPow(forged, nonce, new Map())).toBe('pow');
    const old = makeChallenge(12, Date.now() - 31 * 60 * 1000);
    expect(checkPow(old, '0', new Map())).toBe('expired');
    expect(checkPow(c, 'bad nonce!', new Map())).toBe('pow');
  });
  it('a wrong nonce does not pass', () => {
    const c = makeChallenge(20);
    let bad = 0;
    for (let n = 0; n < 50; n++) if (checkPow(c, n.toString(36), new Map()) === 'pow') bad++;
    expect(bad).toBeGreaterThanOrEqual(49); // 50 спроб проти 1/2^20 — майже напевно всі мимо
  });
});

describe('feedback text cleaning', () => {
  it('keeps a normal report and strips control characters', () => {
    expect(cleanText('  На уровне 2 провалился\u0000 сквозь пол  \r\n').text).toBe('На уровне 2 провалился сквозь пол');
    expect(cleanText('фона\u200bрик\u202e не горит').text).toBe('фонарик не горит');
  });
  it('rejects too short, junk and link spam', () => {
    expect(cleanText('баг').error).toBe('short');
    expect(cleanText('аааааааааааааа').error).toBe('junk');
    expect(cleanText('buy http://a.x http://b.x http://c.x http://d.x now').error).toBe('links');
    expect(cleanText(42).error).toBe('text');
  });
  it('treats the same text with other spacing/case as a repeat', () => {
    expect(textKey('Фонарик не включается!')).toBe(textKey('  фонарик   НЕ включается '));
  });
});
