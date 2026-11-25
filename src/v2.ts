// Where a lake's water goes, and how its water changed since 1984 (pipeline/build_flow.py). Pure parts are tested in
// test/v2.test.ts; fetching is kept small and cached.

export interface Flow { p: number[]; km: number; endo: 0 | 1; sea?: string | null; sink?: number; sinkName?: string }
export interface Water { y0: number; v: (number | null)[]; src?: string }

/** [x0, y0, dx1, dy1, ...] in 0.01 degree units -> lon/lat pairs. */
export function decodePath(p: number[]): [number, number][] {
  const out: [number, number][] = [];
  let x = 0, y = 0;
  for (let i = 0; i + 1 < p.length; i += 2) {
    x += p[i]; y += p[i + 1];
    out.push([x / 100, y / 100]);
  }
  return out;
}

export function flowSentence(f: Flow, lakeName?: string): string {
  const km = f.km >= 1 ? `about ${f.km.toLocaleString('en-US')} km` : 'a short way';
  if (f.endo) {
    if (f.sinkName && f.sinkName !== lakeName) return `Its water never reaches the sea: it flows ${km} and ends in ${f.sinkName}, in a basin with no outlet.`;
    if (f.km < 1) return 'Its water never reaches the sea: the lake sits at the bottom of a basin with no outlet.';
    return `Its water never reaches the sea: it flows ${km} into a basin with no outlet, where it evaporates or soaks away.`;
  }
  if (!f.sea) return f.km < 1 ? 'No mapped river leaves this lake, so where its water goes is not known from these data.' : `Its water flows ${km} down rivers, to where the river map (HydroRIVERS) ends without reaching the sea.`;
  return `Its water flows ${km} down rivers to ${seaName(f.sea)}.`;
}

/** Natural Earth names are in capitals for oceans ("ARCTIC OCEAN") and title case for seas. */
export function seaName(s: string): string {
  const t = s === s.toUpperCase() ? s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : s;
  return /^(the )?(gulf|bay|sea|strait|bight|sound)\b/i.test(t) || /ocean|sea$/i.test(t) ? `the ${t.replace(/^the /i, '')}` : t;
}

export interface WaterSummary { from: [number, number]; to: [number, number]; change: number; words: string }

/** Compare the first and last five years with data (medians), so one odd year does not drive the message. */
export function waterSummary(w: Water): WaterSummary | null {
  const years = w.v.map((v, i) => [w.y0 + i, v] as const).filter((x): x is readonly [number, number] => x[1] != null && x[1] > 0);
  if (years.length < 6) return null;
  const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const first = years.slice(0, 5), last = years.slice(-5);
  const a = median(first.map((x) => x[1])), b = median(last.map((x) => x[1]));
  const change = (b - a) / a;
  const span = (xs: readonly (readonly [number, number])[]) => [xs[0][0], xs[xs.length - 1][0]] as [number, number];
  const f = span(first), t = span(last);
  const pct = Math.round(Math.abs(change) * 100);
  const peak = Math.max(...years.map((x) => x[1]));
  const F = `${f[0]}–${f[1]}`, T = `${t[0]}–${t[1]}`;
  let words: string;
  // percentages stop meaning anything when one end is close to empty (new reservoirs, lakes that dry out)
  if (a < 0.05 * peak) words = `Almost empty in ${F}; it held far more water by ${T}. New reservoirs and lakes that are often dry look like this.`;
  else if (b < 0.05 * peak) words = `Almost no water left in ${T}, compared with ${F}.`;
  else if (swings(years.map((x) => x[1])) && Math.abs(rankCorr(years.map((x) => x[0]), years.map((x) => x[1]))) < 0.5)
    words = 'Its water comes and goes from year to year (it fills in wet years), so the start and the end of the record say little about a long-term change.';
  else if (Math.abs(change) < 0.05) words = `About as much water in ${T} as in ${F}.`;
  else if (change >= 1) words = `${Math.round((b / a) * 10) / 10} times as much water in ${T} as in ${F}.`;
  else words = `${pct} % ${change < 0 ? 'less' : 'more'} water in ${T} than in ${F}.`;
  return { from: f, to: t, change, words };
}

/** Year-to-year variation large compared with the average (coefficient of variation above 0.6). */
export function swings(v: number[]): boolean {
  const m = v.reduce((a, b) => a + b, 0) / v.length;
  const sd = Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length);
  return m > 0 && sd / m > 0.6;
}

/** Spearman rank correlation (ties get average ranks): how steadily a series rises or falls over the years. */
export function rankCorr(x: number[], y: number[]): number {
  const rank = (a: number[]) => {
    const idx = a.map((v, i) => [v, i] as const).sort((p, q) => p[0] - q[0]);
    const r = new Array<number>(a.length);
    for (let i = 0; i < idx.length;) {
      let j = i;
      while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
      for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2;
      i = j + 1;
    }
    return r;
  };
  const rx = rank(x), ry = rank(y), n = x.length, mx = (n - 1) / 2;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) { num += (rx[i] - mx) * (ry[i] - mx); dx += (rx[i] - mx) ** 2; dy += (ry[i] - mx) ** 2; }
  return dx && dy ? num / Math.sqrt(dx * dy) : 0;
}

/** A small SVG sparkline (one point per year, gaps left open). */
export function sparkline(w: Water, width = 300, height = 64): string {
  const vals = w.v.filter((v): v is number => v != null);
  if (!vals.length) return '';
  const lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || 1;
  const n = w.v.length;
  const X = (i: number) => (n === 1 ? width / 2 : (i / (n - 1)) * (width - 8) + 4);
  const Y = (v: number) => height - 6 - ((v - lo) / span) * (height - 12);
  let d = '', pen = false;
  w.v.forEach((v, i) => {
    if (v == null) { pen = false; return; }
    d += `${pen ? 'L' : 'M'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`;
    pen = true;
  });
  return `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" role="img" aria-label="Water volume by year, ${w.y0} to ${w.y0 + n - 1}"><path d="${d}" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
}

// ---------- fetching ----------
// The tile site caches files for a week: bump this when pipeline/build_flow.py output is republished, or browsers keep
// the old shards (a stale, broken shard once left the panel empty).
const DATA_VERSION = '2026-11-26';
const cache = new Map<string, Promise<Record<string, unknown>>>();
function shard(base: string, kind: 'flow' | 'water', id: number, shards: number): Promise<Record<string, unknown>> {
  const url = `${base}v2/${kind}/${String(id % shards).padStart(3, '0')}.json?v=${DATA_VERSION}`;
  let p = cache.get(url);
  if (!p) {
    p = fetch(url).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
    cache.set(url, p);
  }
  return p;
}
export async function lakeFlow(base: string, id: number, shards = 128): Promise<Flow | null> {
  return ((await shard(base, 'flow', id, shards))[String(id)] as Flow) ?? null;
}
export async function lakeWater(base: string, id: number, shards = 128): Promise<Water | null> {
  return ((await shard(base, 'water', id, shards))[String(id)] as Water) ?? null;
}
