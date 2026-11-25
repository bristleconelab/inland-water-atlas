import { describe, expect, it } from 'vitest';
import { levelChart, levelSummary, parseLevels, riverEnd, riverFacts, theRiver, type River } from '../src/river';

const base: River = { n: 'Test', km: 800, q: 1700, up: 96000, g: [[460, 4630, -10, -10]] };

describe('where a river ends', () => {
  it('names the river it joins and where the water goes after that', () => {
    expect(riverEnd({ ...base, into: 1, intoName: 'Danube', sea: 'Black Sea', dkm: 1800 }))
      .toBe('It flows into the Danube, and its water reaches the Black Sea, about 1,800 km further on.');
    expect(riverEnd({ ...base, into: 1, intoName: 'Amu Darya', endo: 1, sinkName: 'Aral Sea', dkm: 900 }))
      .toBe('It flows into the Amu Darya, and its water never reaches the sea: it ends in Aral Sea, in a basin with no outlet, about 900 km further on.');
  });
  it('says the sea for a river mouth, and is honest when the map stops short', () => {
    expect(riverEnd({ ...base, sea: 'Golfe du Lion', dkm: 0 })).toBe('It flows into Golfe du Lion.');
    expect(riverEnd({ ...base, sea: 'ARCTIC OCEAN', dkm: 0 })).toBe('It flows into the Arctic Ocean.');
    expect(riverEnd({ ...base, sea: null })).toContain('stops without reaching a named sea');
    expect(riverEnd({ ...base, endo: 1 })).toContain('basin with no outlet');
  });
  it('puts "the" before river names but not before Rio or Lake', () => {
    expect(theRiver('Volga')).toBe('the Volga');
    expect(theRiver('Rio Negro')).toBe('Rio Negro');
  });
});

describe('facts', () => {
  it('marks modelled numbers as modelled and satellite ones as seen', () => {
    const f = riverFacts({ ...base, w: 390, swot: [12, 3.4, 380] });
    expect(f.map((x) => x.kind)).toEqual(['model', 'model', 'model', 'seen']);
    expect(f[1].text).toContain('not a gauge');
    expect(f[3].text).toContain('12 stretches');
    expect(riverFacts(base)).toHaveLength(3);
    expect(riverFacts({ ...base, fromName: 'Panj' })[0].text).toContain('Above that it is called the Panj.');
  });
});

describe('SWOT water level', () => {
  const csv = [
    'reach_id,time_str,wse,reach_q,wse_units',
    '1,2023-08-02T04:35:41Z,15.38,1,m',
    '1,2023-07-31T15:17:44Z,15.33,1,m',
    '1,no_data,-999999999999.0,3,m',
    '1,2023-08-23T01:20:46Z,14.89,0,m',
    '1,2023-09-02T23:43:39Z,15.37,2,m', // degraded: dropped
    '1,2023-10-02T23:43:39Z,42.0,0,m',  // a bridge, not the water: dropped
    '1,2024-03-01T00:00:00Z,15.90,0,m',
    '1,2024-05-01T00:00:00Z,16.40,0,m',
    '1,2024-09-01T00:00:00Z,15.10,0,m',
  ].join('\n');
  it('keeps good measurements in date order', () => {
    const p = parseLevels(csv);
    expect(p.map((x) => x.h)).toEqual([15.33, 15.38, 14.89, 15.9, 16.4, 15.1]);
  });
  it('sums them up in words and draws one dot per measurement', () => {
    const p = parseLevels(csv);
    expect(levelSummary(p)).toMatch(/^Measured 6 times from Jul 2023 to Sep 2024\. The water level here typically moved over 1\.\d m/);
    expect(levelSummary(p.slice(0, 3))).toBeNull();
    expect(levelChart(p).match(/<circle/g)).toHaveLength(6);
  });
});
