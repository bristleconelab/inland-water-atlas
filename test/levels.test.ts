import { describe, expect, it } from 'vitest';
import { levelWords, levelYearsChart } from '../src/levels';
import { trend } from '../src/trend';

// a Caspian-like fall: about 6 cm a year with a little noise
const casp = { n: 'Caspian Sea', id: 270, y0: 1992, v: Array.from({ length: 34 }, (_, i) => +(0.1 - 0.063 * i + (i % 3 === 0 ? 0.05 : -0.03)).toFixed(2)), err: 0.05, passes: 1200 };
describe('altimetry levels', () => {
  it('says the net change and the trend in centimetres a decade', () => {
    const t = trend(casp.y0, casp.v)!;
    const w = levelWords(casp, t);
    expect(w).toMatch(/^From 1992 to 2025 its level fell by 2\.\d\d m\. Falling by about 6\d cm a decade/);
  });
  it('draws a dot per year with its value', () => {
    expect(levelYearsChart(casp).match(/<circle/g)).toHaveLength(34);
    expect(levelYearsChart(casp)).toContain('<title>1992: +');
  });
});
