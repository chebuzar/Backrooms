import { describe, expect, it } from 'vitest';
import { BUDGET_MS, choose, deviceCap, deviceKey, effectivePreset, runCalibration, type DeviceSignals } from '../../src/render/autotune';
import { PresetGovernor, autoQuality, type QualityName } from '../../src/render/quality';

const dev = (o: Partial<DeviceSignals> = {}): DeviceSignals => ({ platform: 'other', form: 'desktop', touch: false, dpr: 1, cores: 8, gpu: 'NVIDIA GeForce RTX 3060', software: false, memory: 8, ...o });

describe('deviceCap — межі за пристроєм', () => {
  it('ПК без обмежень — до «Ультра»', () => expect(deviceCap(dev())).toBe('ultra'));
  it('програмний рендер — лише «Низкое»', () => expect(deviceCap(dev({ software: true }))).toBe('low'));
  it('телефон і планшет — не вище «Высокого» (нагрів)', () => {
    expect(deviceCap(dev({ platform: 'apple', form: 'tablet', touch: true, gpu: 'Apple GPU' }))).toBe('high');
    expect(deviceCap(dev({ platform: 'android', form: 'phone', touch: true, gpu: 'Adreno (TM) 740' }))).toBe('high');
  });
  it('мало пам\'яті чи ядер — нижче', () => {
    expect(deviceCap(dev({ memory: 2 }))).toBe('low');
    expect(deviceCap(dev({ memory: 3 }))).toBe('medium');
    expect(deviceCap(dev({ cores: 4 }))).toBe('medium');
    expect(deviceCap(dev({ cores: 2 }))).toBe('low');
  });
  it('Safari: кількість ядер не враховується (вона урізана)', () => expect(deviceCap(dev({ platform: 'apple', cores: 2, gpu: 'Apple M2' }))).toBe('ultra'));
  it('слабкі відеокарти — до «Среднего»', () => {
    for (const gpu of ['ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11)', 'Mali-G52', 'Adreno (TM) 506', 'PowerVR Rogue GE8320']) expect(deviceCap(dev({ gpu }))).toBe('medium');
    expect(deviceCap(dev({ gpu: 'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics)' }))).toBe('ultra');
  });
});

describe('choose — найвищий пресет у бюджеті 60 FPS', () => {
  it('бере найвищий, що вкладається', () => expect(choose({ ultra: 15, high: 9, medium: 6 }, 'ultra')).toBe('high'));
  it('не вище межі', () => expect(choose({ ultra: 3, high: 2 }, 'high')).toBe('high'));
  it('нічого не вкладається — «Низкое»', () => expect(choose({ medium: 40, low: 30 }, 'ultra')).toBe('low'));
});

describe('runCalibration — порядок замірів', () => {
  const run = async (cost: Partial<Record<QualityName, number>>, cap: QualityName) => {
    const asked: QualityName[] = [];
    const r = await runCalibration(cap, (q) => { asked.push(q); return Promise.resolve(cost[q] ?? 99); });
    return { ...r, asked };
  };
  it('потужний ПК: «Высокое» вкладається → пробує «Ультра»', async () => {
    const r = await run({ high: 5, ultra: 8 }, 'ultra');
    expect(r.asked).toEqual(['high', 'ultra']);
    expect(r.preset).toBe('ultra');
  });
  it('слабкий: «Высокое» ні → вниз до першого, що вкладається', async () => {
    const r = await run({ high: 30, medium: 18, low: 9 }, 'ultra');
    expect(r.asked).toEqual(['high', 'medium', 'low']);
    expect(r.preset).toBe('low');
  });
  it('межа «Среднее» — починає з неї', async () => {
    const r = await run({ medium: 6 }, 'medium');
    expect(r.asked).toEqual(['medium']);
    expect(r.preset).toBe('medium');
  });
  it('бюджет — 80 % кадру 60 FPS', () => expect(BUDGET_MS).toBeCloseTo(13.33, 1));
});

describe('effectivePreset — вивчене під час гри', () => {
  const c = { key: 'k', preset: 'ultra' as const, ms: {}, at: 0 };
  it('без зниження — результат тесту', () => expect(effectivePreset({ ...c, learned: null })).toBe('ultra'));
  it('гра знизила — нижчий, поки свіже', () => expect(effectivePreset({ ...c, learned: { preset: 'medium', at: 1000 } }, 2000)).toBe('medium'));
  it('за 10 днів — знову тест', () => expect(effectivePreset({ ...c, learned: { preset: 'medium', at: 0 } }, 11 * 864e5)).toBe('ultra'));
});

describe('deviceKey', () => {
  it('інший GPU чи екран — інший відбиток; поворот екрана — той самий', () => {
    const a = deviceKey(dev(), 'webgpu', { width: 1920, height: 1080 });
    expect(deviceKey(dev(), 'webgpu', { width: 1080, height: 1920 })).toBe(a);
    expect(deviceKey(dev({ gpu: 'AMD Radeon' }), 'webgpu', { width: 1920, height: 1080 })).not.toBe(a);
    expect(deviceKey(dev(), 'webgl2', { width: 1920, height: 1080 })).not.toBe(a);
  });
});

describe('autoQuality — здогад до тесту', () => {
  it('не вище межі пристрою', () => expect(autoQuality(dev({ memory: 2 }), true)).toBe('low'));
  it('планшет Apple — «Среднее», поки тест не скаже інше', () => expect(autoQuality(dev({ platform: 'apple', form: 'tablet', gpu: 'Apple GPU' }), true)).toBe('medium'));
});

describe('PresetGovernor', () => {
  const feed = (g: PresetGovernor, ms: number, seconds: number, limit = 20) => {
    let fired = 0;
    for (let t = 0; t < seconds * 1000; t += ms) if (g.update(ms, limit)) fired++;
    return fired;
  };
  it('стабільно повільно — знижує', () => { const g = new PresetGovernor(); g.reset(); expect(feed(g, 28, 8)).toBeGreaterThan(0); });
  it('рівно 60 FPS — не чіпає', () => { const g = new PresetGovernor(); expect(feed(g, 16.7, 20)).toBe(0); });
  it('поодинокі ривки не знижують якість', () => {
    const g = new PresetGovernor();
    let fired = 0;
    for (let i = 0; i < 1200; i++) if (g.update(i % 40 === 0 ? 250 : 16.7, 20)) fired++;
    expect(fired).toBe(0);
  });
  it('після зниження — пауза, а не одразу ще крок', () => { const g = new PresetGovernor(); expect(feed(g, 30, 9)).toBe(1); });
});
