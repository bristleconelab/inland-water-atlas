import { describe, expect, it } from 'vitest';
import { basinRings, basinWords } from '../src/basin';

describe('catchments', () => {
  it('decodes and closes rings', () => {
    const r = basinRings({ a: 1, lakes: 0, g: [[1000, 4000, 100, 0, 0, 100, -100, 0]] });
    expect(r[0]).toEqual([[10, 40], [11, 40], [11, 41], [10, 41], [10, 40]]);
  });
  it('says the area and the lakes in it', () => {
    expect(basinWords({ a: 559972, lakes: 1234, g: [] }, 'lake')).toBe('Its water gathers from 559,972 km² of land upstream (its catchment). 1,234 lakes of at least 10 hectares lie in it, this one included.');
    expect(basinWords({ a: 95894, lakes: 1, g: [] }, 'river')).toBe('Its water gathers from 95,894 km² of land upstream.');
  });
});
