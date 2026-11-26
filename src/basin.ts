// Where a lake's or river's water comes from: its upstream catchment (pipeline/build_basins.py, HydroBASINS level 8).
import { decodePath } from './v2';

export interface Basin { a: number; lakes: number; g: number[][] }

export function basinRings(b: Basin): [number, number][][] {
  return b.g.map(decodePath).filter((r) => r.length >= 4).map((r) => {
    const [x0, y0] = r[0], [x1, y1] = r[r.length - 1];
    return x0 === x1 && y0 === y1 ? r : [...r, r[0]]; // close each ring
  });
}

export function basinWords(b: Basin, kind: 'lake' | 'river'): string {
  const area = b.a >= 1000 ? `${Math.round(b.a).toLocaleString('en-US')} km²` : `${b.a.toLocaleString('en-US', { maximumFractionDigits: 0 })} km²`;
  const lakes = b.lakes > 1 ? ` ${b.lakes.toLocaleString('en-US')} lakes of at least 10 hectares lie in it${kind === 'lake' ? ', this one included' : ''}.` : '';
  return `Its water gathers from ${area} of land upstream${kind === 'lake' ? ' (its catchment)' : ''}.${lakes}`;
}

const VERSION = '2026-11-26';
const cache = new Map<string, Promise<Record<string, Basin>>>();
export async function basinOf(base: string, kind: 'L' | 'R', id: number, shards = 128): Promise<Basin | null> {
  const url = `${base}v2/basin/${String(id % shards).padStart(3, '0')}.json?v=${VERSION}`;
  let p = cache.get(url);
  if (!p) { p = fetch(url).then((r) => (r.ok ? r.json() : {})).catch(() => ({})); cache.set(url, p); }
  return (await p)[`${kind}${id}`] ?? null;
}
