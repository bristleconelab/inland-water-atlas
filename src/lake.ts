// What we know about one lake's depth, from the tile attributes written by pipeline/build_lakes.py. Pure (test/lake.test.ts).

export interface LakeProps {
  id: number;
  tier: 1 | 2 | 3;      // 3 published, 2 seen by satellite, 1 modelled only
  a: number;            // area km2
  n?: string;           // name
  c?: string;           // country
  t?: number;           // HydroLAKES Lake_type: 1 lake, 2 reservoir, 3 lake control (regulated)
  d?: number;           // HydroLAKES average depth, m
  v?: number;           // HydroLAKES total volume, million m3
  vs?: number;          // volume source: 1 literature, 2 GRanD reservoir register, 3 model
  e?: number;           // surface elevation, m
  s?: number;           // 3D-LAKES: band of water level seen by satellites, m
  wm?: number;          // Wikidata mean depth, m
  wx?: number;          // Wikidata maximum depth, m
  wu?: number;          // Wikidata depth without "mean" or "maximum", m
  q?: string;           // Wikidata item
}

export const TIERS = {
  3: { label: 'Depth published', short: 'Published', color: '#ffd166', line: 'A depth or volume has been measured and published.' },
  2: { label: 'Partly seen from space', short: 'Seen from space', color: '#4cc9f0', line: 'Satellites have seen its water level rise and fall, but not its full depth.' },
  1: { label: 'Only a model estimate', short: 'Model only', color: '#c8c3d9', line: 'No published depth and no satellite view: any depth on a map is a statistical estimate.' },
} as const;

export const KIND = { 1: 'Lake', 2: 'Reservoir', 3: 'Regulated lake' } as const;

const n0 = (x: number) => x.toLocaleString('en-US', { maximumFractionDigits: 0 });
const n1 = (x: number) => x.toLocaleString('en-US', { maximumFractionDigits: x < 10 ? 1 : 0 });

/** A volume in million m3 in words people can picture (km3 for big lakes). */
export function volumeWords(mcm: number): string {
  if (mcm >= 1000) return `${n1(mcm / 1000)} km³ of water`;
  return `${n1(mcm)} million m³ of water`;
}

export function areaWords(km2: number): string {
  return km2 >= 1 ? `${n1(km2)} km²` : `${n0(km2 * 100)} hectares`;
}

export interface Evidence { kind: 'published' | 'seen' | 'model'; title: string; text: string }

/** The three rows of the "how deep, and how do we know" panel, strongest evidence first. */
export function evidence(p: LakeProps): Evidence[] {
  const out: Evidence[] = [];
  const wd: string[] = [];
  if (p.wx != null) wd.push(`${n1(p.wx)} m at its deepest`);
  if (p.wm != null) wd.push(`${n1(p.wm)} m on average`);
  if (p.wu != null && p.wx == null && p.wm == null) wd.push(`${n1(p.wu)} m (not said whether mean or maximum)`);
  if (wd.length) out.push({ kind: 'published', title: 'Published depth', text: `${cap(wd.join(', '))}, as recorded on Wikidata from published sources.` });
  if (p.vs === 1 && p.v != null) out.push({ kind: 'published', title: 'Published volume', text: `${cap(volumeWords(p.v))}, from the scientific literature; that makes it ${n1(p.d ?? 0)} m deep on average.` });
  if (p.vs === 2 && p.v != null) out.push({ kind: 'published', title: 'Reservoir register', text: `${cap(volumeWords(p.v))}, as registered for its dam (GRanD); that makes it ${n1(p.d ?? 0)} m deep on average.` });
  if (p.s != null && p.s > 0) out.push({ kind: 'seen', title: 'Seen from space', text: `Satellites have watched its water level move over ${n1(p.s)} m (ICESat-2 and Landsat, 3D-LAKES). Below that, its shape is extrapolated.` });
  if (p.vs === 3 && p.d != null) out.push({ kind: 'model', title: 'Model estimate', text: `About ${n1(p.d)} m deep on average${p.v != null ? `, holding ${volumeWords(p.v)}` : ''}, estimated from its size and the slope of the land around it (HydroLAKES).` });
  return out;
}

/** Does a published single depth fit the average depth from a published volume? (A maximum depth is normally 1.5 to
 *  4 times the mean; below 1 or above 6 times means one of the numbers is probably wrong or belongs elsewhere.) */
export function depthCheck(p: LakeProps): string | null {
  const one = p.wx ?? p.wu;
  if (one == null || p.d == null || p.d <= 0 || !(p.vs === 1 || p.vs === 2)) return null;
  const r = one / p.d;
  if (r < 1) return `The published depth (${n1(one)} m) is less than the average depth its published volume implies (${n1(p.d)} m), so one of them is probably wrong.`;
  if (r > 6) return `The published depth (${n1(one)} m) is more than six times the average depth its published volume implies (${n1(p.d)} m). That is unusual: check the source on Wikidata.`;
  return null;
}

export function verdict(p: LakeProps): string {
  return TIERS[p.tier].line;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
