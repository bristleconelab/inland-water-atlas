// Ways to colour the lakes (the "Colour lakes by" menu). Pure parts are tested in test/modes.test.ts.

export type Mode = 'evidence' | 'error' | 'trend' | 'kind' | 'endo';

export const MODES: Record<Mode, string> = {
  evidence: 'How their depth is known',
  error: 'How wrong the depth model is',
  trend: 'Drying or filling since 1984',
  kind: 'Natural lake or reservoir',
  endo: 'No way to the sea',
};

export const DIM = '#3a4650';
/** [colour, label] rows of each view's legend (the evidence view keeps its own list with counts). */
export const LEGEND: Record<Exclude<Mode, 'evidence'>, [string, string][]> = {
  error: [['rgb(58 120 230)', 'model 4x too shallow or more'], ['rgb(236 236 228)', 'model about right'], ['rgb(226 74 51)', 'model 4x too deep or more'], [DIM, 'no published maximum to test it']],
  trend: [['#d1495b', 'falling, 10 % a decade or more'], ['#f4a261', 'falling'], ['#9aa5ad', 'no clear trend'], ['#8ecae6', 'rising'], ['#1e6fd9', 'rising, 10 % a decade or more'], [DIM, 'no water record']],
  kind: [['#4cc9f0', 'natural lake'], ['#ff9f1c', 'reservoir behind a dam'], ['#c77dff', 'natural lake with a dam on it']],
  endo: [['#e9c46a', 'drains to a basin with no outlet'], [DIM, 'drains to the sea']],
};

/** Colour of a lake's water trend: [percent a decade, p, class 0 none / 1 falling / 2 rising]. */
export function trendColor([pct, , cls]: [number, number, number]): string {
  if (cls === 1) return pct <= -10 ? '#d1495b' : '#f4a261';
  if (cls === 2) return pct >= 10 ? '#1e6fd9' : '#8ecae6';
  return '#9aa5ad';
}

/** Lake colour by kind straight from the tile attribute t (HydroLAKES Lake_type). */
export const KIND_COLOR = ['match', ['get', 't'], 2, '#ff9f1c', 3, '#c77dff', '#4cc9f0'];

/** The sentence under the menu for a view, from its counts. */
export function modeNote(m: Mode, c: { falling?: number; rising?: number; flat?: number; endo?: number; total?: number }): string {
  const f = (x = 0) => x.toLocaleString('en-US');
  if (m === 'trend') return `GloLakes yearly volumes, 1984–2025, for ${f((c.falling ?? 0) + (c.rising ?? 0) + (c.flat ?? 0))} lakes with a long enough record: ${f(c.falling)} clearly falling, ${f(c.rising)} clearly rising (Theil-Sen, Mann-Kendall p < 0.05 corrected for carry-over). Lakes whose water comes and goes are left grey.`;
  if (m === 'kind') return 'HydroLAKES lake type: reservoirs and dammed lakes are where people decide how much water a lake holds.';
  if (m === 'endo') return `${f(c.endo)} lakes drain into a basin that never reaches the sea (HydroBASINS): their water leaves only by evaporation or seepage, so they rise and fall with the climate and with irrigation upstream.`;
  return '';
}
