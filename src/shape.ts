// The shape of a lake bed: GLOBathy's model (area A = a * h^b at height h above the bottom) and the levels satellites
// traced (3D-LAKES L1), from pipeline/build_shape.py. Pure parts are tested in test/shape.test.ts.

export interface Shape { g: [number, number, number, number]; o?: number[] }
export interface ModelError { stats: { n: number; medianRatio: number; withinFactor2: number; withinFactor1_25: number }; lakes: Record<string, [number, number]> }

/** Model curve as [depth below the surface m, area km2] from the surface down to the bottom. */
export function modelCurve(s: Shape, steps = 24): [number, number][] {
  const [a, b, dmax] = s.g;
  const out: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const h = dmax * (1 - i / steps); // height above the bottom
    out.push([dmax - h, a * Math.pow(Math.max(h, 0), b)]);
  }
  return out;
}

/** Observed levels as [depth below the highest level seen m, area km2]. */
export function observed(s: Shape): [number, number][] {
  const o = s.o ?? [];
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < o.length; i += 2) out.push([o[i] / 100, o[i + 1] / 100]);
  return out;
}

const n1 = (x: number) => (x < 10 ? x.toFixed(1) : Math.round(x).toLocaleString('en-US'));

/** What the panel says: the model's depths, the band satellites saw, and how far the model is from a published maximum. */
export function shapeWords(s: Shape, publishedMax?: number): string[] {
  const [, , dmax, dmean] = s.g;
  const out = [`GLOBathy, a model, makes it ${n1(dmax)} m deep at most and ${n1(dmean)} m on average.`];
  const obs = observed(s);
  if (obs.length >= 3) out.push(`Satellites traced its shoreline over the top ${n1(Math.max(...obs.map((p) => p[0])))} m (dots); the rest of the curve is the model.`);
  if (publishedMax && publishedMax > 0) {
    const r = dmax / publishedMax;
    out.push(r >= 0.8 && r <= 1.25
      ? `The published maximum depth is ${n1(publishedMax)} m: the model is within a quarter of it.`
      : `The published maximum depth is ${n1(publishedMax)} m: the model makes it ${r > 1 ? `${n1(r)} times deeper` : `${n1(1 / r)} times shallower`}.`);
  }
  return out;
}

/** Area against depth: the model as a line, what satellites saw as dots. Depth grows downwards. */
export function shapeChart(s: Shape, width = 300, height = 120): string {
  const curve = modelCurve(s), obs = observed(s);
  const L = 44, T = 8, B = 18, R = 8;
  const dmax = Math.max(s.g[2], ...obs.map((p) => p[0]), 0.1);
  const amax = Math.max(...curve.map((p) => p[1]), ...obs.map((p) => p[1]), 1e-6);
  const X = (a: number) => L + (a / amax) * (width - L - R);
  const Y = (d: number) => T + (d / dmax) * (height - T - B);
  const line = curve.map(([d, a], i) => `${i ? 'L' : 'M'}${X(a).toFixed(1)},${Y(d).toFixed(1)}`).join('');
  const dots = obs.map(([d, a]) => `<circle cx="${X(a).toFixed(1)}" cy="${Y(d).toFixed(1)}" r="2.6" fill="#4cc9f0"><title>seen at ${d.toFixed(2)} m below the top: ${n1(a)} km²</title></circle>`).join('');
  const area = amax < 1 ? `${(amax * 100).toFixed(0)} ha` : `${n1(amax)} km²`;
  const axes = `<g font-size="10" fill="currentColor" fill-opacity="0.7"><text x="${L - 4}" y="${Y(0) + 4}" text-anchor="end">0 m</text><text x="${L - 4}" y="${Y(dmax)}" text-anchor="end">${n1(dmax)} m</text><text x="${L}" y="${height - 3}">0</text><text x="${width - R}" y="${height - 3}" text-anchor="end">${area}</text></g><line x1="${L}" x2="${width - R}" y1="${Y(0)}" y2="${Y(0)}" stroke="currentColor" stroke-opacity="0.25"/>`;
  return `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" role="img" aria-label="Lake area against depth, ${n1(dmax)} m deep at most">${axes}<path d="${line}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-dasharray="5 3"><title>GLOBathy model</title></path>${dots}</svg>`;
}

/** Colour of a lake in the model-error view: blue when the model is too shallow, red when too deep (log scale). */
export function errorColor(model: number, published: number): string {
  const t = Math.max(-1, Math.min(1, Math.log10(model / published))); // -1 = 10x too shallow, +1 = 10x too deep
  const lerp = (x: number, y: number, k: number) => Math.round(x + (y - x) * k);
  const mid = [236, 236, 228], blue = [58, 120, 230], red = [226, 74, 51];
  const to = t < 0 ? blue : red, k = Math.min(1, Math.abs(t) / 0.6);
  return `rgb(${lerp(mid[0], to[0], k)} ${lerp(mid[1], to[1], k)} ${lerp(mid[2], to[2], k)})`;
}

// ---------- fetching ----------
const SHAPE_VERSION = '2026-11-26';
const cache = new Map<string, Promise<Record<string, Shape>>>();
export async function lakeShape(base: string, id: number, shards = 256): Promise<Shape | null> {
  const url = `${base}v2/shape/${String(id % shards).padStart(3, '0')}.json?v=${SHAPE_VERSION}`;
  let p = cache.get(url);
  if (!p) { p = fetch(url).then((r) => (r.ok ? r.json() : {})).catch(() => ({})); cache.set(url, p); }
  return (await p)[String(id)] ?? null;
}
let errP: Promise<ModelError | null> | null = null;
export function modelError(base: string): Promise<ModelError | null> {
  errP ??= fetch(`${base}v2/model_error.json?v=${SHAPE_VERSION}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  return errP;
}
