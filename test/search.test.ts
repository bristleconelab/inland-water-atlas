import { describe, expect, it } from 'vitest';
import { fold, mergeHits, prefixSearch, riverSearch, type RiverIndex, type SearchIndex } from '../src/search';

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

describe('lakes and rivers together', () => {
  const rivers: RiverIndex = { n: ['Volga', 'Rhône', 'Superior River'], id: [1, 2, 3], x: [4500, 460, -8600], y: [5600, 4500, 4700], q: [8000, 1700, 20], km: [3500, 800, 60] };
  it('finds rivers by name and ranks them with lakes', () => {
    expect(riverSearch(rivers, 'rhone')[0]).toMatchObject({ id: 2, lon: 4.6, lat: 45 });
    const m = mergeHits(prefixSearch(ix, 'sup'), riverSearch(rivers, 'sup'));
    expect(m.map((h) => `${h.kind}:${h.id}`)).toEqual(['lake:5', 'river:3', 'lake:900']);
    expect(mergeHits(prefixSearch(ix, 'lem'), riverSearch(rivers, 'rh'))[0].kind).toBe('river');
  });
});

describe('names that repeat', () => {
  it('lists a river under two names only once, and tells lakes of one name apart by country', () => {
    const rv: RiverIndex = { n: ['Chirchik', 'Chirchiq'], id: [7, 7], x: [6950, 6950], y: [4130, 4130], q: [220, 220], km: [174, 174] };
    expect(riverSearch(rv, 'chirch').map((h) => h.id)).toEqual([7]);
    const lk: SearchIndex = { ...ix, c: ['Kazakhstan', 'United States', 'Peru', 'Switzerland', 'Canada'] };
    expect(prefixSearch(lk, 'sup')[0].country).toBe('United States');
  });
});
