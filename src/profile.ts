// A river from its source to its end (pipeline/build_extra.py, RiverATLAS): elevation, natural flow, how much of a
// year's flow the dams upstream can hold, and the lakes and reservoirs on the way. Pure parts in test/profile.test.ts.
import { EXTRA_VERSION } from './limno';

/** x km from the source, z m (lowest point of each reach's catchment), q natural mean flow m3/s, d degree of
 *  regulation %, ir % of the basin irrigated, lk [km, Hylak_id, name, lake type 1/2/3, area km2]. */
export interface Profile { x: number[]; z: (number | null)[]; q: number[]; d: number[]; ir: number; lk?: [number, number, string, number, number][] }

const n0 = (x: number) => Math.round(x).toLocaleString('en-US');
const esc = (s: string) => s.replace(/[<&"]/g, (c) => ({ '<': '&lt;', '&': '&amp;', '"': '&quot;' }[c]!));

/** Elevation along the river as a filled profile, with lakes (circles) and reservoirs (squares) where their outlet is. */
export function profileChart(p: Profile, width = 300, height = 110): string {
  const pts = p.x.map((x, i) => [x, p.z[i]] as const).filter((q): q is readonly [number, number] => q[1] != null);
  if (pts.length < 2) return '';
  const L = 44, T = 8, B = 16;
  const x1 = Math.max(p.x[p.x.length - 1], 1);
  const zs = pts.map((q) => q[1]), lo = Math.min(...zs), hi = Math.max(...zs), span = hi - lo || 1;
  const X = (x: number) => L + 4 + (x / x1) * (width - L - 8);
  const Y = (z: number) => height - B - ((z - lo) / span) * (height - T - B);
  const zAt = (x: number) => { // the profile's height at km x, for the markers
    let k = pts.findIndex((q) => q[0] >= x);
    if (k <= 0) return pts[Math.max(k, 0)][1];
    const [xa, za] = pts[k - 1], [xb, zb] = pts[k];
    return za + ((zb - za) * (x - xa)) / (xb - xa || 1);
  };
  const line = pts.map((q, i) => `${i ? 'L' : 'M'}${X(q[0]).toFixed(1)},${Y(q[1]).toFixed(1)}`).join('');
  const area = `${line}L${X(pts[pts.length - 1][0]).toFixed(1)},${height - B}L${X(pts[0][0]).toFixed(1)},${height - B}Z`;
  const marks = (p.lk ?? []).map(([x, , name, t, a]) => {
    const cx = X(x), cy = Y(zAt(x)) - 4, what = t === 1 ? 'lake' : t === 2 ? 'reservoir' : 'lake with a dam';
    const tip = `<title>${esc(name || `Unnamed ${what}`)} (${what}, ${a >= 1 ? `${n0(a)} km²` : `${n0(a * 100)} ha`}), ${n0(x)} km from the source</title>`;
    return t === 1 ? `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="3.2" fill="#4cc9f0">${tip}</circle>`
      : `<rect x="${(cx - 3.2).toFixed(1)}" y="${(cy - 3.2).toFixed(1)}" width="6.4" height="6.4" fill="#ff9f1c">${tip}</rect>`;
  }).join('');
  const axis = `<g font-size="10" fill="currentColor" fill-opacity="0.7"><g text-anchor="end"><text x="${L - 4}" y="${Y(hi) + 4}">${n0(hi)} m</text><text x="${L - 4}" y="${Y(lo)}">${n0(lo)} m</text></g>`
    + `<text x="${X(0)}" y="${height - 3}">source</text><text x="${width - 4}" y="${height - 3}" text-anchor="end">${n0(x1)} km</text></g>`;
  return `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" role="img" aria-label="Height of the river from its source at ${n0(hi)} m to ${n0(lo)} m over ${n0(x1)} km">${axis}<path d="${area}" fill="currentColor" fill-opacity="0.12"/><path d="${line}" fill="none" stroke="currentColor" stroke-width="1.6"/>${marks}</svg>`;
}

/** Dams and irrigation in words: the degree of regulation where the river ends (Lehner et al. 2011; rivers above
 *  2 % count as regulated in Grill et al. 2019) and the irrigated share of its basin. */
export function damWords(p: Profile): string | null {
  const dEnd = p.d[p.d.length - 1] ?? 0, dMax = Math.max(0, ...p.d);
  const res = (p.lk ?? []).filter((l) => l[3] > 1).length;
  const parts: string[] = [];
  if (dMax >= 2) {
    const where = dMax > dEnd * 1.5 && dMax - dEnd >= 2 ? ` (up to ${pct(dMax)} further up)` : '';
    parts.push(`The reservoirs upstream of its end can hold ${pct(dEnd)} of a year's flow${where}${dEnd >= 100 ? ', more than a whole year of it' : ''}.${res ? ` ${res === 1 ? 'One reservoir sits' : `${res} reservoirs sit`} on the river itself.` : ''}`);
  } else {
    parts.push('Dams hardly hold back its flow: the reservoirs upstream can store less than 2 % of a year\'s water.');
  }
  if (p.ir >= 5) parts.push(`${pct(p.ir)} of the land that drains into it is irrigated, so much less water reaches its end than the model's natural flow.`);
  return parts.join(' ');
}
const pct = (x: number) => `${x < 10 ? x.toFixed(1) : n0(x)}\u00a0%`; // no break between the number and %

const cache = new Map<string, Promise<Record<string, Profile>>>();
export async function riverProfile(base: string, id: number): Promise<Profile | null> {
  const url = `${base}v2/profile/${String(id % 128).padStart(3, '0')}.json?v=${EXTRA_VERSION}`;
  let p = cache.get(url);
  if (!p) { p = fetch(url).then((r) => (r.ok ? r.json() : {})).catch(() => ({})); cache.set(url, p); }
  return (await p)[String(id)] ?? null;
}
