// Standard lake-shape numbers (Hutchinson 1957; Håkanson 2004) for one lake, from HydroLAKES attributes
// (pipeline/build_extra.py, v2/limno) and the depths in the tiles and in GLOBathy. Pure parts in test/limno.test.ts.
import type { LakeProps } from './lake';
import type { Shape } from './shape';

/** [shore km, shoreline development, residence time days, catchment km2, mean outflow m3/s]; null = not known. */
export type Limno = [number | null, number | null, number | null, number | null, number | null];
/** Bump when pipeline/build_extra.py output is republished (the tile site caches files for a week). */
export const EXTRA_VERSION = '2026-11-28';

export interface Indices {
  dv?: number; dvSrc?: string;    // volume development 3 * mean / max
  zr?: number; zrSrc?: string;    // relative depth, % (50 * zmax * sqrt(pi) / sqrt(area))
  dl?: number;                    // shoreline development (HydroLAKES Shore_dev)
  tau?: number;                   // residence time, days (HydroLAKES Res_time: volume / mean outflow, both modelled for most lakes)
  ratio?: number;                 // catchment area / lake area
}

/** The indices, each from the best depths at hand: published mean and maximum, else a published volume's mean depth
 *  with a published maximum, else GLOBathy's model. */
export function indices(p: LakeProps, l: Limno | null, s: Shape | null): Indices {
  const out: Indices = {};
  let mean: number | undefined, max: number | undefined, src: string | undefined;
  if (p.wm && p.wx) { mean = p.wm; max = p.wx; src = 'published mean and maximum depth'; }
  else if (p.wx && p.d && (p.vs === 1 || p.vs === 2)) { mean = p.d; max = p.wx; src = 'published volume and maximum depth'; }
  // a published depth without "mean" or "maximum" that is well over the mean from a published volume is the maximum
  // (Baikal: 1,642 m, against 744 m from its volume)
  else if (p.wu && p.d && (p.vs === 1 || p.vs === 2) && p.wu >= 1.2 * p.d) { mean = p.d; max = p.wu; src = 'published volume and published depth'; }
  else if (s && s.g[2] > 0 && s.g[3] > 0) { mean = s.g[3]; max = s.g[2]; src = 'GLOBathy model'; }
  if (mean && max && max >= mean) { out.dv = (3 * mean) / max; out.dvSrc = src; }
  const pubMax = p.wx ?? (src === 'published volume and published depth' ? p.wu : undefined);
  const zmax = pubMax ?? (s && s.g[2] > 0 ? s.g[2] : undefined);
  if (zmax && p.a > 0) { out.zr = (50 * zmax * Math.sqrt(Math.PI)) / Math.sqrt(p.a * 1e6); out.zrSrc = pubMax ? 'published maximum depth' : 'GLOBathy model'; }
  if (l) {
    if (l[1] != null && l[1] >= 1) out.dl = l[1];
    if (l[2] != null && l[2] > 0) out.tau = l[2];
    if (l[3] != null && l[3] > 0 && p.a > 0) out.ratio = l[3] / p.a;
  }
  return out;
}

/** "about 3 weeks", "about 4 years": a residence time people can picture. */
export function durationWords(days: number): string {
  const r = (x: number) => (x < 10 ? Math.round(x * 10) / 10 : Math.round(x)).toLocaleString('en-US');
  if (days < 1) return 'less than a day';
  if (days < 14) return `about ${r(days)} days`;
  if (days < 61) return `about ${r(days / 7)} weeks`;
  if (days < 730) return `about ${r(days / 30.4)} months`;
  return `about ${r(days / 365.25)} years`;
}

/** Lines for the explorer view: how long water stays, how its bed is shaped, how wide its catchment is. */
export function limnoWords(ix: Indices): string[] {
  const out: string[] = [];
  if (ix.tau) out.push(`Water stays in it for ${durationWords(ix.tau)} on average before it flows out (HydroLAKES: volume divided by the mean outflow, both mostly modelled).`);
  if (ix.dv) {
    const shape = ix.dv < 0.75 ? 'most of its water sits in a deep hollow, with wide shallows around it'
      : ix.dv <= 1.3 ? 'its sides slope fairly evenly down to the deepest point, like a cone or a bowl'
        : 'it is steep-sided with a broad, flat floor';
    out.push(`From its ${ix.dvSrc}: ${shape} (volume development ${ix.dv.toFixed(2)}).`);
  }
  if (ix.ratio && ix.ratio >= 2) out.push(`Its catchment is ${ix.ratio < 100 ? Math.round(ix.ratio) : Math.round(ix.ratio).toLocaleString('en-US')} times the area of the lake.`);
  return out;
}

const cache = new Map<string, Promise<Record<string, Limno>>>();
export async function lakeLimno(base: string, id: number): Promise<Limno | null> {
  const url = `${base}v2/limno/${String(id % 256).padStart(3, '0')}.json?v=${EXTRA_VERSION}`;
  let p = cache.get(url);
  if (!p) { p = fetch(url).then((r) => (r.ok ? r.json() : {})).catch(() => ({})); cache.set(url, p); }
  return (await p)[String(id)] ?? null;
}
