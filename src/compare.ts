// Compare the water of up to four lakes on one chart: each series as a share of its own usual volume (median = 100 %),
// so a reservoir and a sea can sit side by side. Pure (test/compare.test.ts).
import type { Water } from './v2';

export interface Item { id: number; name: string; w: Water }
export const COLORS = ['#ffd166', '#4cc9f0', '#ff7aa2', '#b8f28c'];
export const MAX_ITEMS = 4;

const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/** Percent of the series' median, by year; null where there is no value. */
export function normalise(w: Water): { year: number; pct: number | null }[] {
  const vals = w.v.filter((v): v is number => v != null && v > 0);
  const m = vals.length ? median(vals) : 0;
  return w.v.map((v, i) => ({ year: w.y0 + i, pct: v == null || !(m > 0) ? null : (100 * v) / m }));
}

export function compareChart(items: Item[], width = 560, height = 180): string {
  if (!items.length) return '';
  const series = items.map((it) => normalise(it.w));
  const years = series.flat().map((p) => p.year), y0 = Math.min(...years), y1 = Math.max(...years);
  const pcts = series.flat().map((p) => p.pct).filter((p): p is number => p != null);
  const hi = Math.max(150, ...pcts);
  const L = 44, T = 8, B = 20, R = 8;
  const X = (y: number) => L + ((y - y0) / Math.max(1, y1 - y0)) * (width - L - R);
  const Y = (p: number) => T + (1 - p / hi) * (height - T - B);
  const grid = [0, 100, hi].map((p) => `<line x1="${L}" x2="${width - R}" y1="${Y(p).toFixed(1)}" y2="${Y(p).toFixed(1)}" stroke="currentColor" stroke-opacity="${p === 100 ? 0.35 : 0.15}"/><text x="${L - 4}" y="${(Y(p) + 4).toFixed(1)}" text-anchor="end">${Math.round(p)} %</text>`).join('');
  const lines = series.map((s, k) => {
    let d = '', pen = false;
    for (const p of s) {
      if (p.pct == null) { pen = false; continue; }
      d += `${pen ? 'L' : 'M'}${X(p.year).toFixed(1)},${Y(p.pct).toFixed(1)}`;
      pen = true;
    }
    return `<path d="${d}" fill="none" stroke="${COLORS[k % COLORS.length]}" stroke-width="2"><title>${items[k].name.replace(/[<&]/g, '')}</title></path>`;
  }).join('');
  const axis = `<text x="${L}" y="${height - 4}">${y0}</text><text x="${width - R}" y="${height - 4}" text-anchor="end">${y1}</text>`;
  return `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" role="img" aria-label="Water of ${items.length} lakes, each as a share of its usual volume"><g font-size="10" fill="currentColor" fill-opacity="0.7">${grid}${axis}</g>${lines}</svg>`;
}

/** Add an item (once), keeping at most MAX_ITEMS: the oldest goes. */
export function addItem(list: Item[], it: Item): Item[] {
  const rest = list.filter((x) => x.id !== it.id);
  return [...rest, it].slice(-MAX_ITEMS);
}
