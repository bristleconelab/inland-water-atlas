import { describe, expect, it } from 'vitest';
import { addItem, compareChart, normalise } from '../src/compare';

const w = (y0: number, v: (number | null)[]) => ({ y0, v });
describe('compare', () => {
  it('scales a series to its median', () => {
    expect(normalise(w(2000, [50, 100, null, 150])).map((p) => p.pct)).toEqual([50, 100, null, 150]);
  });
  it('keeps four lakes, each once, newest last', () => {
    let l = [] as ReturnType<typeof addItem>;
    for (const id of [1, 2, 3, 2, 4, 5]) l = addItem(l, { id, name: `L${id}`, w: w(2000, [1, 2]) });
    expect(l.map((x) => x.id)).toEqual([3, 2, 4, 5]);
  });
  it('draws one line per lake', () => {
    const svg = compareChart([{ id: 1, name: 'A', w: w(1990, [1, 2, 3]) }, { id: 2, name: 'B<', w: w(2000, [5, 5, 6]) }]);
    expect(svg.match(/<path/g)).toHaveLength(2);
    expect(svg).toContain('<title>B</title>');
  });
});
