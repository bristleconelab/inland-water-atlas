import { describe, expect, it } from 'vitest';
import { fold, prefixSearch, type SearchIndex } from '../src/search';

const ix: SearchIndex = {
  n: ['Caspian Sea', 'Superior', 'Lago Titicaca', 'Lac Léman', 'Little Superior Pond'],
  id: [1, 5, 9, 12, 900], x: [5000, -8800, -6950, 650, -7000], y: [4200, 4750, -1580, 4640, 4400], a: [377001.9, 81843.9, 7000, 580, 0.3], t: [3, 3, 3, 3, 1],
};

describe('search', () => {
  it('folds accents and case', () => { expect(fold('Lac Léman')).toBe('lac leman'); });
  it('ranks names that start with the query before names with a word that does', () => {
    expect(prefixSearch(ix, 'sup').map((h) => h.id)).toEqual([5, 900]);
    expect(prefixSearch(ix, 'titic')[0]).toMatchObject({ id: 9, lon: -69.5, lat: -15.8 });
    expect(prefixSearch(ix, 'leman')[0].id).toBe(12);
    expect(prefixSearch(ix, 'x')).toEqual([]);
  });
});
