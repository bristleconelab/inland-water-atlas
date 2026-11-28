import { describe, expect, it } from 'vitest';
import { LEGEND, modeNote, trendColor } from '../src/modes';

describe('map views', () => {
  it('colours trends by direction and size, and only clear ones', () => {
    expect(trendColor([-15, 0.001, 1])).toBe('#d1495b');
    expect(trendColor([-4, 0.01, 1])).toBe('#f4a261');
    expect(trendColor([12, 0.001, 2])).toBe('#1e6fd9');
    expect(trendColor([-20, 0.2, 0])).toBe('#9aa5ad'); // big but not clear: no colour
  });
  it('legend colours match the trend colours', () => {
    const cols = LEGEND.trend.map((r) => r[0]);
    for (const c of [trendColor([-15, 0, 1]), trendColor([-1, 0, 1]), trendColor([1, 0, 2]), trendColor([15, 0, 2]), trendColor([0, 1, 0])]) expect(cols).toContain(c);
  });
  it('notes give the counts', () => {
    expect(modeNote('trend', { falling: 1290, rising: 2748, flat: 13464 })).toContain('1,290 clearly falling');
    expect(modeNote('endo', { endo: 38698 })).toContain('38,698 lakes');
  });
});
