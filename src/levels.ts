// Water level of the largest lakes since 1992 from radar altimetry (pipeline/build_levels.py, NASA GSFC Global Water
// Monitor / G-REALM). Pure parts are tested in test/levels.test.ts.
import type { Trend } from './trend';

export interface Level { n: string; id: number; y0: number; v: (number | null)[]; err: number; passes: number }

/** Yearly level against the target's reference (m), scale on the left, value on hover. */
export function levelYearsChart(l: Level, width = 300, height = 84, line?: Trend): string {
  const vals = l.v.filter((v): v is number => v != null);
  if (!vals.length) return '';
  const L = 46, T = 6, B = 6, n = l.v.length;
  const lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || 0.1;
  const X = (i: number) => L + 4 + (i / Math.max(1, n - 1)) * (width - L - 8);
  const Y = (v: number) => height - B - ((v - lo) / span) * (height - T - B);
  let d = '', pen = false, dots = '';
  l.v.forEach((v, i) => {
    if (v == null) { pen = false; return; }
    d += `${pen ? 'L' : 'M'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`; pen = true;
    dots += `<circle cx="${X(i).toFixed(1)}" cy="${Y(v).toFixed(1)}" r="2.2" fill-opacity="0"><title>${l.y0 + i}: ${v >= 0 ? '+' : ''}${v.toFixed(2)} m</title></circle>`;
  });
  const f = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(span < 1 ? 2 : 1)} m`;
  let fit = '';
  if (line) {
    const yv = (i: number) => Math.min(hi, Math.max(lo, line.intercept + line.slope * (l.y0 + i)));
    fit = `<path d="M${X(0).toFixed(1)},${Y(yv(0)).toFixed(1)}L${X(n - 1).toFixed(1)},${Y(yv(n - 1)).toFixed(1)}" stroke="currentColor" stroke-opacity="0.55" stroke-width="1.2" stroke-dasharray="4 3" fill="none"><title>Theil-Sen trend</title></path>`;
  }
  const axis = `<g font-size="10" fill="currentColor" fill-opacity="0.7" text-anchor="end"><text x="${L - 4}" y="${Y(hi) + 4}">${f(hi)}</text><text x="${L - 4}" y="${Y(lo)}">${f(lo)}</text></g><line x1="${L}" x2="${width}" y1="${Y(hi)}" y2="${Y(hi)}" stroke="currentColor" stroke-opacity="0.12"/><line x1="${L}" x2="${width}" y1="${Y(lo)}" y2="${Y(lo)}" stroke="currentColor" stroke-opacity="0.12"/>`;
  return `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" role="img" aria-label="Water level by year, ${l.y0} to ${l.y0 + n - 1}, from ${f(lo)} to ${f(hi)}">${axis}${fit}<path d="${d}" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><g fill="currentColor">${dots}</g></svg>`;
}

/** The change in words, in centimetres a decade (the level is relative, so no share of a volume). */
export function levelWords(l: Level, t: Trend | null): string {
  const first = l.v.findIndex((v) => v != null), last = l.v.length - 1 - [...l.v].reverse().findIndex((v) => v != null);
  const a = l.v[first]!, b = l.v[last]!;
  const span = `${l.y0 + first}–${l.y0 + last}`;
  const net = `From ${l.y0 + first} to ${l.y0 + last} its level ${b < a ? 'fell' : 'rose'} by ${Math.abs(b - a).toFixed(2)} m.`;
  if (!t) return net;
  const cm = (x: number) => `${Math.abs(x * 1000).toFixed(Math.abs(x * 1000) < 10 ? 1 : 0)} cm`;
  const pv = t.p < 0.001 ? 'p < 0.001' : `p = ${t.p.toFixed(3)}`;
  if (t.p >= 0.05 || (t.lo <= 0 && t.hi >= 0)) return `${net} No clear trend over ${span} (Mann-Kendall ${pv}).`;
  return `${net} ${t.slope < 0 ? 'Falling' : 'Rising'} by about ${cm(t.slope)} a decade (95 %: ${cm(t.lo)} to ${cm(t.hi)}; Mann-Kendall ${pv}, corrected for carry-over).`;
}

let all: Promise<Record<string, Level>> | null = null;
export async function lakeLevel(base: string, id: number): Promise<Level | null> {
  all ??= fetch(`${base}v2/levels.json?v=2026-11-26`).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
  return (await all)[String(id)] ?? null;
}
