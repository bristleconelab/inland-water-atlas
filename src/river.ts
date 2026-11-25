// Named rivers (pipeline/build_rivers.py) and the water level SWOT measured along them. Pure parts are tested in
// test/river.test.ts; fetching is kept small and cached.
import { decodePath, seaName } from './v2';

export interface River {
  n: string; l?: string; km: number; q: number; up: number; g: number[][];
  p?: number[]; dkm?: number; into?: number; intoName?: string; sea?: string | null; endo?: 1; sinkName?: string;
  w?: number; swot?: [number, number, number | null]; fromName?: string; wd?: string;
}
/** A river reach as it comes out of the tiles. */
export interface Reach { id: number; o: number; q: number; n?: string; r?: number; d?: number; s?: number }
export interface Fact { kind: 'model' | 'seen'; title: string; text: string }

const n0 = (x: number) => Math.round(x).toLocaleString('en-US');
/** "the Danube", but "Rio Negro" and "Lake Ladoga" as they are. */
export const theRiver = (n: string) => (/^(the|rio|río|río|lake|lac|lago)\b/i.test(n) ? n : `the ${n}`);

export const riverLines = (r: River): [number, number][][] => r.g.map(decodePath).filter((l) => l.length > 1);

/** Where the river ends, and where its water goes from there. */
export function riverEnd(r: River): string {
  const on = r.dkm != null && r.dkm >= 5 ? `about ${n0(r.dkm)} km further on` : '';
  const goal = r.endo
    ? (r.sinkName ? `${r.sinkName}, in a basin with no outlet` : 'a basin with no outlet, where it evaporates or soaks away')
    : r.sea ? seaName(r.sea) : null;
  if (r.into && r.intoName) {
    if (!goal) return `It flows into ${theRiver(r.intoName)}. The river map ends before the water reaches the sea.`;
    return `It flows into ${theRiver(r.intoName)}, and its water ${r.endo ? 'never reaches the sea: it ends in' : 'reaches'} ${goal}${on ? `, ${on}` : ''}.`;
  }
  if (r.endo) return `It never reaches the sea: its water ends in ${goal}${on ? `, ${on}` : ''}.`;
  if (!goal) return 'Where it ends, the river map stops without reaching a named sea.';
  return on ? `Its water reaches ${goal} ${on}.` : `It flows into ${goal}.`;
}

export function riverFacts(r: River): Fact[] {
  const out: Fact[] = [
    { kind: 'model', title: 'Length', text: r.fromName
      ? `About ${n0(r.km)} km long, measured along HydroRIVERS, a river network traced from elevation data. Above that it is called ${theRiver(r.fromName)}.`
      : `About ${n0(r.km)} km from its farthest source to its end, measured along HydroRIVERS, a river network traced from elevation data.` },
    { kind: 'model', title: 'Flow', text: `About ${n0(r.q)} m³ of water a second where it ends, on average for 1971–2000. This is from a hydrological model (WaterGAP, in HydroRIVERS), not a gauge.` },
    { kind: 'model', title: 'Basin', text: `It gathers water from ${n0(r.up)} km².` },
  ];
  const seen: string[] = [];
  if (r.w) seen.push(`About ${n0(r.w)} m wide in Landsat images (median of its stretches in SWORD).`);
  if (r.swot) {
    const [n, range] = r.swot;
    seen.push(`Since 2023 the SWOT satellite has measured its water level on ${n0(n)} stretch${n === 1 ? '' : 'es'}; there it typically moves over ${range.toFixed(1)} m between low and high water.`);
  }
  if (seen.length) out.push({ kind: 'seen', title: 'Seen from space', text: seen.join(' ') });
  return out;
}

// ---------- SWOT water level (PO.DAAC Hydrocron) ----------
export interface Level { t: number; h: number }
const HYDROCRON = 'https://soto.podaac.earthdatacloud.nasa.gov/hydrocron/v1/timeseries';

/** Hydrocron CSV -> good measurements, oldest first. Keeps quality 0 (good) and 1 (suspect), drops fill values and
 *  heights far from the rest (more than 6 median absolute deviations: SWOT sometimes sees a bank or a bridge). */
export function parseLevels(csv: string): Level[] {
  const [head, ...rows] = csv.trim().split('\n');
  if (!head) return [];
  const c = head.split(',');
  const it = c.indexOf('time_str'), ih = c.indexOf('wse'), iq = c.indexOf('reach_q');
  if (it < 0 || ih < 0) return [];
  const pts: Level[] = [];
  for (const row of rows) {
    const f = row.split(',');
    const t = Date.parse(f[it]), h = Number(f[ih]), q = iq >= 0 ? Number(f[iq]) : 0;
    if (Number.isFinite(t) && Number.isFinite(h) && h > -1000 && h < 9000 && q <= 1) pts.push({ t, h });
  }
  if (pts.length < 3) return pts.sort((a, b) => a.t - b.t);
  const med = median(pts.map((p) => p.h));
  const mad = median(pts.map((p) => Math.abs(p.h - med))) || 0.05;
  return pts.filter((p) => Math.abs(p.h - med) <= 6 * mad).sort((a, b) => a.t - b.t);
}
function median(a: number[]): number {
  const s = [...a].sort((x, y) => x - y), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function quantile(a: number[], p: number): number {
  const s = [...a].sort((x, y) => x - y), i = (s.length - 1) * p, lo = Math.floor(i);
  return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (i - lo);
}

const month = (t: number) => new Date(t).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
export function levelSummary(pts: Level[]): string | null {
  if (pts.length < 5) return null;
  const hs = pts.map((p) => p.h);
  const range = quantile(hs, 0.9) - quantile(hs, 0.1);
  return `Measured ${pts.length} times from ${month(pts[0].t)} to ${month(pts[pts.length - 1].t)}. The water level here typically moved over ${range < 1 ? range.toFixed(2) : range.toFixed(1)} m (between its 10th and 90th percentiles), around ${n0(median(hs))} m above sea level.`;
}

/** Dots joined by a thin line, placed by date. */
export function levelChart(pts: Level[], width = 300, height = 72): string {
  if (!pts.length) return '';
  const t0 = pts[0].t, t1 = pts[pts.length - 1].t || t0 + 1;
  const hs = pts.map((p) => p.h), lo = Math.min(...hs), hi = Math.max(...hs), span = hi - lo || 1;
  const X = (t: number) => 4 + ((t - t0) / (t1 - t0 || 1)) * (width - 8);
  const Y = (h: number) => height - 6 - ((h - lo) / span) * (height - 12);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.t).toFixed(1)},${Y(p.h).toFixed(1)}`).join('');
  const dots = pts.map((p) => `<circle cx="${X(p.t).toFixed(1)}" cy="${Y(p.h).toFixed(1)}" r="1.8"/>`).join('');
  return `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" role="img" aria-label="Water level measured by SWOT, ${month(t0)} to ${month(t1)}"><path d="${d}" fill="none" stroke="currentColor" stroke-opacity="0.45" stroke-width="1"/><g fill="currentColor">${dots}</g></svg>`;
}

const levelCache = new Map<number, Promise<Level[] | null>>();
export function swotLevels(reach: number): Promise<Level[] | null> {
  let p = levelCache.get(reach);
  if (!p) {
    const end = new Date().toISOString().slice(0, 19) + 'Z';
    const url = `${HYDROCRON}?feature=Reach&feature_id=${reach}&start_time=2023-07-01T00:00:00Z&end_time=${end}&output=csv&fields=reach_id,time_str,wse,reach_q`;
    p = fetch(url).then((r) => (r.ok ? r.json() : null)).then((j) => (j?.results?.csv ? parseLevels(j.results.csv) : [])).catch(() => null);
    levelCache.set(reach, p);
  }
  return p;
}

// ---------- river records ----------
// bump with pipeline/build_rivers.py output, like DATA_VERSION in v2.ts (the tile site caches files for a week)
const RIVER_VERSION = '2026-11-26';
const shardCache = new Map<string, Promise<Record<string, River>>>();
export async function riverRecord(base: string, id: number, shards = 128): Promise<River | null> {
  const url = `${base}v2/river/${String(id % shards).padStart(3, '0')}.json?v=${RIVER_VERSION}`;
  let p = shardCache.get(url);
  if (!p) {
    p = fetch(url).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
    shardCache.set(url, p);
  }
  return (await p)[String(id)] ?? null;
}
