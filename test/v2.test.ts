import { describe, expect, it } from 'vitest';
import { decodePath, flowSentence, seaName, sparkline, volumeLabel, waterSummary } from '../src/v2';

describe('paths', () => {
  it('decodes delta-coded 0.01 degree steps', () => {
    expect(decodePath([7575, 4660, 10, -5, 3, 0])).toEqual([[75.75, 46.6], [75.85, 46.55], [75.88, 46.55]]);
    expect(decodePath([])).toEqual([]);
  });
});

describe('flow sentences', () => {
  it('names the sea or the inland lake the water ends in', () => {
    expect(flowSentence({ p: [], km: 2410, endo: 0, sea: 'ARCTIC OCEAN' })).toBe('Its water flows about 2,410 km down rivers to the Arctic Ocean.');
    expect(flowSentence({ p: [], km: 1210, endo: 1, sinkName: 'Aral Sea' })).toContain('ends in Aral Sea');
    expect(flowSentence({ p: [], km: 0, endo: 1, sinkName: 'Balkhash' }, 'Balkhash')).toContain('bottom of a basin with no outlet');
    expect(seaName('Gulf of Mexico')).toBe('the Gulf of Mexico');
    expect(seaName('Great Australian Bight')).toBe('the Great Australian Bight');
    expect(seaName('Golfe du Lion')).toBe('Golfe du Lion');
    // Lake Chany: a closed basin whose outlet HydroRIVERS does not mark as inland and that is far from any sea
    expect(flowSentence({ p: [], km: 0, endo: 0, sea: null })).toContain('No mapped river leaves this lake');
  });
});

describe('water over time', () => {
  // Aral-like decline: first five years ~100, last five ~20
  const aral = { y0: 1984, v: [100, 98, null, 102, 99, 101, 90, 80, 60, 40, 30, 22, 20, 19, 21, 20] };
  it('compares the first and last five years with data', () => {
    const s = waterSummary(aral)!;
    expect(s.from).toEqual([1984, 1989]); expect(s.to).toEqual([1995, 1999]);
    expect(s.words).toBe('80 % less water in 1995–1999 than in 1984–1989.');
  });
  it('says "about as much" for small changes and refuses short records', () => {
    expect(waterSummary({ y0: 2000, v: [10, 10.2, 9.9, 10.1, 10, 10.3, 9.8, 10, 10.1, 10.2] })!.words).toMatch(/^About as much/);
    expect(waterSummary({ y0: 2000, v: [1, 2, 3] })).toBeNull();
    expect(waterSummary({ y0: 2000, v: [0, 0, 0, 0, 0, 0, 0, 0] })).toBeNull();
  });
  it('uses words, not absurd percentages, when one end is nearly empty', () => {
    const reservoir = { y0: 1984, v: [0.01, 0.02, 0.01, 0.03, 0.02, 5, 40, 80, 90, 95, 92, 94, 96] };
    expect(waterSummary(reservoir)!.words).toMatch(/^Almost empty in 1984–1988/);
    const dried = { y0: 1984, v: [50, 55, 52, 49, 51, 30, 10, 1, 0.5, 0.3, 0.4, 0.2] };
    expect(waterSummary(dried)!.words).toMatch(/^Almost no water left/);
    expect(waterSummary({ y0: 2000, v: [10, 10, 10, 10, 10, 15, 25, 30, 31, 29, 30] })!.words).toBe('3 times as much water in 2006–2010 as in 2000–2004.');
  });
  it('does not read a trend into a lake that fills in wet years and dries in between', () => {
    // Narran-like: floods in some years, almost dry in others, no steady direction
    const episodic = { y0: 1987, v: [80, 10, 75, 6, 70, 5, 90, 8, 4, 60, 7, 3, 85, 6, 5, 70, 4, 6] };
    expect(waterSummary(episodic)!.words).toMatch(/^Its water comes and goes/);
    // the same with dry years at exactly zero, as the deseasonalised GloLakes values give them
    expect(waterSummary({ y0: 1987, v: [30, 32, 0, 0, 0, 0, 25, 28, 0, 0, 0, 0, 34, 0, 0, 0, 0, 20, 0, 0] })!.words).toMatch(/^Its water comes and goes/);
    // a steady decline with big swings is still a decline
    const aral = { y0: 1984, v: [100, 98, null, 102, 99, 101, 90, 80, 60, 40, 30, 22, 20, 19, 21, 20] };
    expect(waterSummary(aral)!.words).toMatch(/% less water/);
  });
  it('draws a path with gaps', () => {
    const svg = sparkline({ y0: 2000, v: [1, null, 3, 4] });
    expect(svg.match(/M/g)).toHaveLength(2);
  });
  it('starts the volume scale at zero and labels it', () => {
    const svg = sparkline({ y0: 2000, v: [1500, 1480, 1490] });
    expect(svg).toContain('>0<');
    expect(svg).toContain('1.5 km³');
    expect(volumeLabel(12.34)).toBe('12 million m³');
  });
});

describe('the Caspian', () => {
  it('is said to have no outlet, for lakes and rivers that end in it', () => {
    expect(flowSentence({ p: [], km: 3000, endo: 0, sea: 'Caspian Sea' })).toBe('Its water flows about 3,000 km down rivers to the Caspian Sea, a lake with no outlet: the water never reaches the ocean.');
    expect(flowSentence({ p: [], km: 300, endo: 0, sea: 'Black Sea' })).toBe('Its water flows about 300 km down rivers to the Black Sea.');
  });
});
