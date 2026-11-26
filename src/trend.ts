// Trends in a yearly series: Theil-Sen slope with its 95 % confidence interval (Sen 1968; Gilbert 1987, ch. 16) and
// the Mann-Kendall test with the Hamed and Rao (1998) correction for autocorrelation: lake volumes carry over from one
// year to the next, and the plain test then finds "significant" trends in noise. Pure (test/trend.test.ts).

export interface Trend {
  n: number;            // years with a value
  slope: number;        // units a year (Theil-Sen)
  lo: number; hi: number; // 95 % interval of the slope
  intercept: number;    // value at year 0 of the line (y = intercept + slope * year)
  p: number;            // two-sided p-value, Mann-Kendall with the Hamed-Rao variance
  tau: number;          // Kendall's tau
  level: number;        // median of the values, to state the slope as a share
}

/** Standard normal CDF (Abramowitz and Stegun 26.2.17, error below 7.5e-8). */
export function normCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804014327 * Math.exp(-z * z / 2);
  const p = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return z > 0 ? 1 - p : p;
}

const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

function ranks(a: number[]): number[] {
  const idx = a.map((v, i) => [v, i] as const).sort((p, q) => p[0] - q[0]);
  const r = new Array<number>(a.length);
  for (let i = 0; i < idx.length;) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2 + 1;
    i = j + 1;
  }
  return r;
}

/** Theil-Sen and Mann-Kendall for values by year (null = no value). Needs at least `min` years. */
export function trend(y0: number, v: (number | null)[], min = 10): Trend | null {
  const xs: number[] = [], ys: number[] = [];
  v.forEach((val, i) => { if (val != null && Number.isFinite(val)) { xs.push(y0 + i); ys.push(val); } });
  const n = xs.length;
  if (n < min) return null;
  // Mann-Kendall S and pairwise slopes
  let S = 0;
  const slopes: number[] = [];
  for (let i = 0; i < n - 1; i++) for (let j = i + 1; j < n; j++) {
    S += Math.sign(ys[j] - ys[i]);
    slopes.push((ys[j] - ys[i]) / (xs[j] - xs[i]));
  }
  // variance with ties
  const tied = new Map<number, number>();
  ys.forEach((y) => tied.set(y, (tied.get(y) ?? 0) + 1));
  let varS = n * (n - 1) * (2 * n + 5);
  for (const t of tied.values()) if (t > 1) varS -= t * (t - 1) * (2 * t + 5);
  varS /= 18;
  const slope = median(slopes);
  // Hamed-Rao: autocorrelation of the ranks of the detrended series, significant lags only
  const det = ys.map((y, i) => y - slope * xs[i]);
  const r = ranks(det), rm = (n + 1) / 2;
  let c0 = 0;
  for (const x of r) c0 += (x - rm) ** 2;
  let sum = 0;
  const bound = 1.96 / Math.sqrt(n);
  for (let k = 1; k < n - 1 && c0 > 0; k++) {
    let ck = 0;
    for (let i = 0; i + k < n; i++) ck += (r[i] - rm) * (r[i + k] - rm);
    const rho = ck / c0;
    if (Math.abs(rho) > bound) sum += (n - k) * (n - k - 1) * (n - k - 2) * rho;
  }
  const factor = Math.max(1, 1 + (2 / (n * (n - 1) * (n - 2))) * sum); // never shrink the variance below the plain test
  const varStar = varS * factor;
  const z = S === 0 || varStar <= 0 ? 0 : (S - Math.sign(S)) / Math.sqrt(varStar);
  const p = Math.min(1, 2 * (1 - normCdf(Math.abs(z))));
  // 95 % interval of the slope from the ordered pairwise slopes (C = 1.96 * sqrt(Var S))
  const sorted = slopes.sort((a, b) => a - b), N = sorted.length, C = 1.96 * Math.sqrt(varStar);
  const m1 = Math.max(0, Math.round((N - C) / 2) - 1), m2 = Math.min(N - 1, Math.round((N + C) / 2));
  const intercept = median(ys.map((y, i) => y - slope * xs[i]));
  return { n, slope, lo: sorted[m1], hi: sorted[m2], intercept, p, tau: S / (n * (n - 1) / 2), level: median(ys) };
}

/** One sentence: the change a decade as a share of the lake's usual volume, its interval, and the p-value. */
export function trendWords(t: Trend, first: number, last: number): string {
  const pct = (x: number) => (t.level > 0 ? (x * 10 * 100) / t.level : 0);
  const f = (x: number) => `${Math.abs(x) < 10 ? Math.abs(x).toFixed(1) : Math.round(Math.abs(x))} %`;
  const span = `${first}–${last}`;
  const pv = t.p < 0.001 ? 'p < 0.001' : `p = ${t.p.toFixed(t.p < 0.01 ? 3 : 2)}`;
  if (t.p >= 0.05 || (t.lo <= 0 && t.hi >= 0))
    return `No clear trend over ${span} (Mann-Kendall ${pv}; Theil-Sen ${pct(t.slope) >= 0 ? '+' : '−'}${f(pct(t.slope))} a decade, 95 % from ${pct(t.lo) >= 0 ? '+' : '−'}${f(pct(t.lo))} to ${pct(t.hi) >= 0 ? '+' : '−'}${f(pct(t.hi))}).`;
  return `${t.slope < 0 ? 'Falling' : 'Rising'} by about ${f(pct(t.slope))} of its usual volume a decade over ${span} (95 %: ${f(pct(t.lo))} to ${f(pct(t.hi))}; Mann-Kendall ${pv}, corrected for year-to-year carry-over).`;
}
