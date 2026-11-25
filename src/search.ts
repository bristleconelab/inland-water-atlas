// Name search over named lakes (pipeline/build_search.py) and named rivers (pipeline/build_rivers.py). Pure
// (test/search.test.ts).
export interface SearchIndex { n: string[]; id: number[]; x: number[]; y: number[]; a: number[]; t: number[] }
export interface RiverIndex { n: string[]; id: number[]; x: number[]; y: number[]; q: number[]; km: number[] }
export interface Hit { name: string; id: number; lon: number; lat: number; area: number; tier: number; starts: boolean }
export interface RiverHit { name: string; id: number; lon: number; lat: number; km: number; q: number; starts: boolean }

/** Lower case without accents, so "leman" finds "Léman". */
export function fold(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Indices of names starting with the query, then of names with a word starting with it; within each, in index order
 *  (the indexes are sorted biggest first). */
function match(names: string[], query: string, limit: number): [number, boolean][] {
  const q = fold(query.trim());
  if (q.length < 2) return [];
  const starts: number[] = [], words: number[] = [];
  for (let i = 0; i < names.length && starts.length < limit; i++) {
    const f = fold(names[i]);
    if (f.startsWith(q)) starts.push(i);
    else if (words.length < limit && f.includes(` ${q}`)) words.push(i);
  }
  return [...starts.map((i) => [i, true] as [number, boolean]), ...words.map((i) => [i, false] as [number, boolean])].slice(0, limit);
}

export function prefixSearch(ix: SearchIndex, query: string, limit = 8): Hit[] {
  return match(ix.n, query, limit).map(([i, starts]) => ({ name: ix.n[i], id: ix.id[i], lon: ix.x[i] / 100, lat: ix.y[i] / 100, area: ix.a[i], tier: ix.t[i], starts }));
}

export function riverSearch(ix: RiverIndex, query: string, limit = 8): RiverHit[] {
  return match(ix.n, query, limit).map(([i, starts]) => ({ name: ix.n[i], id: ix.id[i], lon: ix.x[i] / 100, lat: ix.y[i] / 100, km: ix.km[i], q: ix.q[i], starts }));
}

export type AnyHit = ({ kind: 'lake' } & Hit) | ({ kind: 'river' } & RiverHit);
/** Lakes and rivers in one list: names that start with the query first, then the bigger ones (a lake by its area in
 *  km², a river by ten times its length in km, so the Volga ranks with Baikal and the Rhône above Lake Geneva). */
export function mergeHits(lakes: Hit[], rivers: RiverHit[], limit = 8): AnyHit[] {
  const all: AnyHit[] = [...lakes.map((h) => ({ kind: 'lake' as const, ...h })), ...rivers.map((h) => ({ kind: 'river' as const, ...h }))];
  const size = (h: AnyHit) => (h.kind === 'lake' ? h.area : h.km * 10);
  return all.sort((a, b) => Number(b.starts) - Number(a.starts) || size(b) - size(a)).slice(0, limit);
}
