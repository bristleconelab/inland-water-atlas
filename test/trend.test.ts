import { describe, expect, it } from 'vitest';
import { normCdf, trend, trendWords, pettitt } from '../src/trend';

describe('trend statistics', () => {
  it('has a correct normal CDF', () => {
    expect(normCdf(0)).toBeCloseTo(0.5, 6);
    expect(normCdf(1.959964)).toBeCloseTo(0.975, 5);
    expect(normCdf(-2.575829)).toBeCloseTo(0.005, 5);
  });
  it('finds the slope of a straight line and calls it significant', () => {
    const t = trend(2000, Array.from({ length: 20 }, (_, i) => 100 - 2 * i))!;
    expect(t.slope).toBeCloseTo(-2, 9);
    expect(t.lo).toBeCloseTo(-2, 9); expect(t.hi).toBeCloseTo(-2, 9);
    expect(t.p).toBeLessThan(0.001);
    expect(trendWords(t, 2000, 2019)).toMatch(/^Falling by about/);
  });
  it('matches scipy on a noisy series (plain Mann-Kendall, no autocorrelation found)', () => {
    // scipy 1.x: theilslopes -> slope -0.18333, 95 % interval -0.21111 to -0.13636; kendalltau tau -0.7714, p 1.0e-5
    const v = [12.1, 11.8, 12.5, 11.9, 11.2, 11.6, 10.9, 11.3, 10.4, 10.8, 10.1, 10.6, 9.7, 10.2, 9.9];
    const t = trend(1990, v)!;
    expect(t.slope).toBeCloseTo(-0.18333, 4);
    expect(t.lo).toBeCloseTo(-0.21111, 4);
    expect(t.hi).toBeCloseTo(-0.13636, 4);
    expect(t.tau).toBeCloseTo(-0.7714, 4);
    expect(t.p).toBeLessThan(0.001);
  });
  it('does not call noise a trend', () => {
    const v = [10, 12, 9, 11, 10, 13, 9, 11, 12, 10, 9, 12, 11, 10];
    const t = trend(2000, v)!;
    expect(t.p).toBeGreaterThan(0.05);
    expect(trendWords(t, 2000, 2013)).toMatch(/^No clear trend/);
  });
  it('needs ten years', () => {
    expect(trend(2000, [1, 2, 3, 4, 5, 6, 7, 8, 9])).toBeNull();
    expect(trend(2000, [1, null, 3, 4, 5, 6, 7, 8, 9, 10, 11])).not.toBeNull();
  });
});

describe('pettitt', () => {
  it('finds a reservoir filling and matches the textbook double sum (K = 49, p = 0.01489)', () => {
    const s = pettitt(2000, [10, 11, 9, 10, 12, 11, 10, 30, 31, 29, 32, 30, 31, 33]);
    expect(s).not.toBeNull();
    expect(s!.year).toBe(2007);
    expect(s!.p).toBeCloseTo(0.014893, 5);
    expect(s!.before).toBe(10);
    expect(s!.after).toBe(31);
  });
  it('stays quiet on noise and on short records', () => {
    expect(pettitt(2000, [5, 6, 5, 7, 6, 5, 6, 7, 5, 6, 6, 5])).toBeNull();
    expect(pettitt(2000, [1, 1, 1, 9, 9, 9])).toBeNull();
  });
  it('skips missing years', () => {
    const s = pettitt(2000, [10, null, 11, 9, 10, 12, 11, 10, 30, 31, 29, 32, 30, 31, 33]);
    expect(s!.year).toBe(2008);
  });
});
