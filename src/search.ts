// Name search over named lakes (pipeline/build_search.py) and named rivers (pipeline/build_rivers.py). Pure
// (test/search.test.ts).
/** an/ai: names in other languages (Wikidata labels, pipeline/build_search.py) and the row each one names. */
export interface SearchIndex { n: string[]; id: number[]; x: number[]; y: number[]; a: number[]; t: number[]; c?: string[]; an?: string[]; ai?: number[] }
export interface RiverIndex { n: string[]; id: number[]; x: number[]; y: number[]; q: number[]; km: number[]; to?: string[]; an?: string[]; ai?: number[] }
export interface Hit { name: string; id: number; lon: number; lat: number; area: number; tier: number; starts: boolean; country?: string; main?: string }
export interface RiverHit { name: string; id: number; lon: number; lat: number; km: number; q: number; starts: boolean; to?: string; main?: string }

/** Lower case without accents, so "leman" finds "Léman"; every apostrophe as ' (Uzbek writes Issiqkoʻl, Issiqko'l
 *  and Issiqko’l), ё as е. */
export function fold(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[ʻʼ’‘`´]/g, "'").replace(/ё/g, 'е');
}

const foldedNames = new WeakMap<string[], string[]>();
/** The names folded once per index: folding 135,000 names on every key press froze the page for a moment. */
function folded(names: string[]): string[] {
  let f = foldedNames.get(names);
  if (!f) { f = names.map(fold); foldedNames.set(names, f); }
  return f;
}

/** Indices of names starting with the query, then of names with a word starting with it; within each, in index order
 *  (the indexes are sorted biggest first). */
function match(names: string[], query: string, limit: number, ids?: number[]): [number, boolean][] {
  const q = fold(query.trim());
  if (q.length < 2) return [];
  const fn = folded(names);
  const starts: number[] = [], words: number[] = [], seen = new Set<number>();
  for (let i = 0; i < fn.length && starts.length < limit; i++) {
    if (ids) { if (seen.has(ids[i])) continue; } // a river listed under two names (Chirchik, Chirchiq) shows once
    const f = fn[i];
    if (f.startsWith(q)) { starts.push(i); if (ids) seen.add(ids[i]); }
    else if (words.length < limit && f.includes(` ${q}`)) { words.push(i); if (ids) seen.add(ids[i]); }
  }
  return [...starts.map((i) => [i, true] as [number, boolean]), ...words.map((i) => [i, false] as [number, boolean])].slice(0, limit);
}

/** Rows matching by their own name or by a name in another language: [row, starts, the other name], names that
 *  start with the query first, then by row (biggest first), each lake or river once. */
function matchRows(ix: { n: string[]; id: number[]; an?: string[]; ai?: number[] }, query: string, limit: number): [number, boolean, string?][] {
  const own: [number, boolean, string?][] = match(ix.n, query, limit, ix.id);
  const other: [number, boolean, string?][] = ix.an && ix.ai ? match(ix.an, query, limit).map(([j, st]) => [ix.ai![j], st, ix.an![j]]) : [];
  const seen = new Set<number>(), out: [number, boolean, string?][] = [];
  for (const h of [...own, ...other].sort((a, b) => Number(b[1]) - Number(a[1]) || a[0] - b[0] || Number(!!a[2]) - Number(!!b[2]))) {
    if (seen.has(ix.id[h[0]])) continue;
    seen.add(ix.id[h[0]]); out.push(h);
  }
  return out.slice(0, limit);
}

export function prefixSearch(ix: SearchIndex, query: string, limit = 8): Hit[] {
  return matchRows(ix, query, limit).map(([i, starts, other]) => ({ name: other ?? ix.n[i], id: ix.id[i], lon: ix.x[i] / 100, lat: ix.y[i] / 100, area: ix.a[i], tier: ix.t[i], starts, country: ix.c?.[i] || undefined, main: other ? ix.n[i] : undefined }));
}

export function riverSearch(ix: RiverIndex, query: string, limit = 8): RiverHit[] {
  return matchRows(ix, query, limit).map(([i, starts, other]) => ({ name: other ?? ix.n[i], id: ix.id[i], lon: ix.x[i] / 100, lat: ix.y[i] / 100, km: ix.km[i], q: ix.q[i], starts, to: ix.to?.[i] || undefined, main: other ? ix.n[i] : undefined }));
}

export type AnyHit = ({ kind: 'lake' } & Hit) | ({ kind: 'river' } & RiverHit);
/** Lakes and rivers in one list: names that start with the query first, then the bigger ones (a lake by its area in
 *  km², a river by ten times its length in km, so the Volga ranks with Baikal and the Rhône above Lake Geneva). */
export function mergeHits(lakes: Hit[], rivers: RiverHit[], limit = 8): AnyHit[] {
  const all: AnyHit[] = [...lakes.map((h) => ({ kind: 'lake' as const, ...h })), ...rivers.map((h) => ({ kind: 'river' as const, ...h }))];
  const size = (h: AnyHit) => (h.kind === 'lake' ? h.area : h.km * 10);
  return all.sort((a, b) => Number(b.starts) - Number(a.starts) || size(b) - size(a)).slice(0, limit);
}
