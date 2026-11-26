import { describe, expect, it } from 'vitest';
import { errorColor, modelCurve, observed, shapeChart, shapeWords, type Shape } from '../src/shape';

// a cone-like lake: A = 2 * h^1 km2, 10 m deep at most
const cone: Shape = { g: [2, 1, 10, 3.3], o: [0, 2000, 50, 1900, 120, 1760] };

describe('lake bed shape', () => {
  it('runs the model curve from the surface to the bottom', () => {
    const c = modelCurve(cone, 10);
    expect(c[0]).toEqual([0, 20]);              // at the surface: h = 10 m, A = 20 km2
    expect(c[10][0]).toBeCloseTo(10, 9);        // at the bottom
    expect(c[10][1]).toBeCloseTo(0, 9);
  });
  it('reads the observed levels as metres and km2', () => {
    expect(observed(cone)).toEqual([[0, 20], [0.5, 19], [1.2, 17.6]]);
  });
  it('says how far the model is from a published maximum depth', () => {
    expect(shapeWords(cone)[0]).toContain('10 m deep at most');
    expect(shapeWords(cone)[1]).toContain('top 1.2 m');
    expect(shapeWords(cone, 9)[2]).toContain('within a quarter');
    expect(shapeWords(cone, 40)[2]).toContain('4.0 times shallower');
    expect(shapeWords(cone, 2)[2]).toContain('5.0 times deeper');
    expect(shapeWords(cone, 10, true)[2]).toContain('agree by construction');
    expect(shapeWords({ g: [2, 1, 10, 3], o: [0, 100, 1, 99, 2, 98] }).length).toBe(1); // a 2 cm band says nothing
  });
  it('draws the model as a line and each observation as a dot with a tooltip', () => {
    const svg = shapeChart(cone);
    expect(svg.match(/<circle/g)).toHaveLength(3);
    expect(svg).toContain('<title>GLOBathy model</title>');
  });
  it('colours too deep red, too shallow blue, right grey', () => {
    expect(errorColor(10, 10)).toBe('rgb(236 236 228)');
    expect(errorColor(40, 10)).toBe('rgb(226 74 51)');
    expect(errorColor(2.5, 10)).toBe('rgb(58 120 230)');
  });
});
