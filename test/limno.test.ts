import { describe, expect, it } from 'vitest';
import { durationWords, indices, limnoWords } from '../src/limno';
import type { LakeProps } from '../src/lake';

const base: LakeProps = { id: 1, tier: 3, a: 31500 };
describe('lake-shape numbers', () => {
  it('Baikal-like: published mean 744 m and max 1642 m, area 31,500 km2', () => {
    const ix = indices({ ...base, wm: 744, wx: 1642 }, [2100, 3.3, 140000, 540000, 1900], null);
    expect(ix.dv).toBeCloseTo(1.359, 3);
    expect(ix.dvSrc).toBe('published mean and maximum depth');
    // z_r = 50 * 1642 * sqrt(pi) / sqrt(31500e6) = 0.8199 %
    expect(ix.zr).toBeCloseTo(0.8199, 3);
    expect(ix.dl).toBe(3.3);
    expect(ix.ratio).toBeCloseTo(17.14, 2);
  });
  it('falls back to the model, and to a published volume', () => {
    const s = { g: [1, 2, 20, 8] as [number, number, number, number] };
    expect(indices({ ...base, a: 10 }, null, s).dvSrc).toBe('GLOBathy model');
    expect(indices({ ...base, a: 10, wx: 30, d: 12, vs: 1 }, null, s)).toMatchObject({ dv: 1.2, dvSrc: 'published volume and maximum depth', zrSrc: 'published maximum depth' });
  });
  it('takes an unspecified published depth well over the mean as the maximum (Baikal)', () => {
    const ix = indices({ ...base, wu: 1642, d: 744, vs: 1 }, null, { g: [1, 1, 1642, 451] });
    expect(ix.dvSrc).toBe('published volume and published depth');
    expect(ix.dv).toBeCloseTo(1.359, 3);
    expect(ix.zrSrc).toBe('published maximum depth');
    expect(indices({ ...base, wu: 800, d: 744, vs: 1 }, null, { g: [1, 1, 1642, 451] }).dvSrc).toBe('GLOBathy model');
  });
  it('ignores unknown values and a mean deeper than the maximum', () => {
    const ix = indices({ ...base, wm: 50, wx: 20 }, [null, null, null, null, null], null);
    expect(ix.dv).toBeUndefined();
    expect(ix.tau).toBeUndefined();
    expect(ix.zr).toBeCloseTo(0.00999, 4);
  });
  it('words', () => {
    expect(durationWords(0.5)).toBe('less than a day');
    expect(durationWords(21)).toBe('about 3 weeks');
    expect(durationWords(140000)).toBe('about 383 years');
    expect(limnoWords({ tau: 3650, dv: 0.5, dvSrc: 'GLOBathy model', ratio: 1.5 })).toHaveLength(2);
  });
});
