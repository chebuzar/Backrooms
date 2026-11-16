import { describe, it, expect } from 'vitest';
import { parseSave, Store, DEFAULT_SETTINGS } from '../../src/core/save';

describe('save file', () => {
  it('returns defaults for empty or broken data', () => {
    for (const raw of [null, '', '{', '"x"', '[]']) {
      const s = parseSave(raw);
      expect(s.settings).toEqual(DEFAULT_SETTINGS);
      expect(s.progress.docs).toEqual([]);
      expect(s.ageConfirmed).toBe(false);
    }
  });

  it('clamps out-of-range values and drops wrong types', () => {
    const s = parseSave(JSON.stringify({ settings: { brightness: 9, masterVolume: -1, quality: 'mega', invertY: 'yes', fov: 75 }, progress: { docs: ['a', 1, 'b'], deaths: 'x' } }));
    expect(s.settings.brightness).toBe(1.6);
    expect(s.settings.masterVolume).toBe(0);
    expect(s.settings.quality).toBe('auto');
    expect(s.settings.invertY).toBe(false);
    expect(s.settings.fov).toBe(75);
    expect(s.progress.docs).toEqual(['a', 'b']);
    expect(s.progress.deaths).toBe(0);
  });

  it('round-trips through storage', () => {
    const mem = new Map<string, string>();
    const st = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
    const a = new Store(st);
    a.data.ageConfirmed = true;
    a.settings.sensitivity = 1.7;
    a.progress.docs.push('order7');
    a.progress.checkpoint = { level: 2, spawn: 'garage' };
    a.save();
    const b = new Store(st);
    expect(b.data.ageConfirmed).toBe(true);
    expect(b.settings.sensitivity).toBe(1.7);
    expect(b.progress.docs).toEqual(['order7']);
    expect(b.progress.checkpoint).toEqual({ level: 2, spawn: 'garage' });
  });
});
