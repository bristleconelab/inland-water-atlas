// Name search over the named lakes (pipeline/build_search.py). Pure (test/search.test.ts).
export interface SearchIndex { n: string[]; id: number[]; x: number[]; y: number[]; a: number[]; t: number[] }
export interface Hit { name: string; id: number; lon: number; lat: number; area: number; tier: number }

/** Lower case without accents, so "leman" finds "Léman". */
export function fold(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

/** Names starting with the query come first, then names with a word starting with it; within each, biggest first
 *  (the index is sorted by area). */
export function prefixSearch(ix: SearchIndex, query: string, limit = 8): Hit[] {
  const q = fold(query.trim());
  if (q.length < 2) return [];
  const starts: number[] = [], words: number[] = [];
  for (let i = 0; i < ix.n.length && starts.length < limit; i++) {
    const f = fold(ix.n[i]);
    if (f.startsWith(q)) starts.push(i);
    else if (words.length < limit && f.includes(` ${q}`)) words.push(i);
  }
  return [...starts, ...words].slice(0, limit).map((i) => ({ name: ix.n[i], id: ix.id[i], lon: ix.x[i] / 100, lat: ix.y[i] / 100, area: ix.a[i], tier: ix.t[i] }));
}
