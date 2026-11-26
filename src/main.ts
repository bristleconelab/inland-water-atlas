import '@fontsource-variable/bricolage-grotesque';
import '@fontsource-variable/source-serif-4';
import './styles.css';
import type { FilterSpecification, GeoJSONSource, Map as MlMap } from 'maplibre-gl';
import { areaWords, depthCheck, evidence, KIND, TIERS, verdict, type LakeProps } from './lake';
import { createMap, LAKE_COLOR, LAKE_OPACITY, lakeAt, riverAt, TILES } from './map';
import { decodePath, flowSentence, lakeFlow, lakeWater, seaName, sparkline, waterSummary } from './v2';
import { levelChart, levelSummary, riverEnd, riverFacts, riverLines, riverRecord, swotLevels, theRiver, type Reach, type River } from './river';
import { trend, trendWords } from './trend';
import { errorColor, lakeShape, modelCurve, modelError, observed, shapeChart, shapeWords } from './shape';
import { download, scientist, tableHTML, toCSV, type Row } from './sci';
import { mergeHits, prefixSearch, riverSearch, type RiverIndex, type SearchIndex } from './search';

const $ = <T extends HTMLElement>(s: string) => document.querySelector(s) as T;
const base = import.meta.env.BASE_URL;
const fmt = (n: number) => n.toLocaleString('en-US');
const el = (tag: string, cls = '', text?: string) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const hint = $('#hint'), panel = $('#panel'), body = $('#panel .panel-body');

let map: MlMap;

async function start() {
  map = await createMap($('#map'));
  map.on('click', (e) => {
    const at: [number, number] = [e.lngLat.lng, e.lngLat.lat];
    const hit = lakeAt(map, e.point);
    if (hit) return showLake(hit, at);
    const reach = map.getLayoutProperty('rivers', 'visibility') === 'none' ? null : riverAt(map, e.point);
    if (reach) showReach(reach, at); else closePanel();
  });
  map.on('mousemove', (e) => {
    const rivers = map.getLayoutProperty('rivers', 'visibility') !== 'none';
    const on = map.queryRenderedFeatures(e.point, { layers: ['lakes'] }).length || (rivers && riverAt(map, e.point, 4));
    map.getCanvas().style.cursor = on ? 'pointer' : '';
  });
  applyHash();
}

// ---------- headline and key ----------
fetch(`${base}data/stats.json`).then((r) => r.json()).then((s: { lakes: number; published: number; seen: number; modelled: number }) => {
  const pct = (x: number) => `${(100 * x / s.lakes).toFixed(x / s.lakes < 0.1 ? 1 : 0)} %`;
  $('#headline').textContent = `Of ${fmt(s.lakes)} lakes, the depth of only ${fmt(s.published)} (${pct(s.published)}) has been published. For ${pct(s.modelled)} of them, the depth on any map is a model's guess.`;
  $('#c3').textContent = fmt(s.published); $('#c2').textContent = fmt(s.seen); $('#c1').textContent = fmt(s.modelled);
});
const tiersOn = new Set([1, 2, 3]);
document.querySelectorAll<HTMLInputElement>('input[data-tier]').forEach((cb) => cb.addEventListener('change', () => {
  const t = Number(cb.dataset.tier);
  if (cb.checked) tiersOn.add(t); else tiersOn.delete(t);
  const f = ['in', ['get', 'tier'], ['literal', [...tiersOn]]] as unknown as FilterSpecification;
  map?.setFilter('lakes', f); map?.setFilter('lakes-edge', f);
}));
// ---------- model error view: GLOBathy's maximum depth against published maxima (src/shape.ts) ----------
let errorView = false;
$<HTMLInputElement>('#error-on').addEventListener('change', async (e) => {
  errorView = (e.target as HTMLInputElement).checked;
  const me = await modelError(TILES);
  if (!me || !map) return;
  for (const [id, [pub, mod]] of Object.entries(me.lakes))
    map.setFeatureState({ source: 'atlas', sourceLayer: 'lakes', id: Number(id) }, { err: errorView, c: errorColor(mod, pub) });
  map.setPaintProperty('lakes', 'fill-color', errorView ? ['case', ['boolean', ['feature-state', 'err'], false], ['feature-state', 'c'], '#3a4650'] : LAKE_COLOR);
  map.setPaintProperty('lakes', 'fill-opacity', errorView ? ['case', ['boolean', ['feature-state', 'err'], false], 1, 0.35] : LAKE_OPACITY);
  $('#error-note').hidden = !errorView;
  $('#error-note').textContent = `${fmt(me.stats.n)} lakes have a published maximum depth. GLOBathy's model is within a factor of two for ${Math.round(me.stats.withinFactor2 * 100)} % of them and within a quarter for ${Math.round(me.stats.withinFactor1_25 * 100)} %. Blue: the model is too shallow; red: too deep.`;
});
$<HTMLInputElement>('#sci-on').checked = scientist.on;
$<HTMLInputElement>('#sci-on').addEventListener('change', (e) => {
  scientist.on = (e.target as HTMLInputElement).checked;
  if (!panel.hidden) applyHash(); // reopen what is shown, now with (or without) the numbers
});
$<HTMLInputElement>('#rivers-on').addEventListener('change', (e) => {
  const v = (e.target as HTMLInputElement).checked ? 'visible' : 'none';
  for (const id of ['rivers', 'river-labels']) map?.setLayoutProperty(id, 'visibility', v);
});

// ---------- lake panel ----------
function showLake(p: LakeProps, at: [number, number]) {
  hint.hidden = true;
  (map.getSource('selected') as GeoJSONSource).setData({ type: 'FeatureCollection', features: [] });
  map.setFilter('selected-lake', ['==', ['get', 'id'], p.id]);
  history.replaceState(null, '', `#lake=${p.id}@${at[0].toFixed(3)},${at[1].toFixed(3)},${map.getZoom().toFixed(1)}`);
  body.replaceChildren();
  const t = TIERS[p.tier];
  const badge = el('p', 'badge', t.label); badge.style.background = t.color;
  body.append(badge, el('h2', p.n ? '' : 'unnamed', p.n || 'Unnamed lake'));
  const meta = [KIND[(p.t ?? 1) as 1 | 2 | 3], p.c, areaWords(p.a), p.e != null ? `${fmt(p.e)} m above sea level` : ''].filter(Boolean).join(', ');
  body.append(el('p', 'meta', meta), el('p', 'verdict', verdict(p)));
  const ev = el('ol', 'evidence');
  for (const x of evidence(p)) {
    const li = el('li', `ev ev-${x.kind}`);
    li.append(el('h3', '', x.title), el('p', '', x.text));
    ev.append(li);
  }
  body.append(ev);
  const warn = depthCheck(p);
  if (warn) body.append(el('p', 'warn', warn));
  const links = el('p', 'links');
  if (p.q) { const a = el('a', '', 'Wikidata item') as HTMLAnchorElement; a.href = `https://www.wikidata.org/wiki/${p.q}`; a.target = '_blank'; a.rel = 'noopener'; links.append(a); }
  links.append(el('span', 'fine', `HydroLAKES id ${p.id}`));
  const flowBox = el('section', 'more'), waterBox = el('section', 'more'), shapeBox = el('section', 'more');
  const sciBox = el('section', 'more sci');
  body.append(flowBox, waterBox, shapeBox, sciBox, links);
  if (p.tier === 1) body.append(el('p', 'fine', 'Know a published depth for this lake? Adding it to the lake’s Wikidata item (with a source) will show it here after the next update.'));
  panel.hidden = false;
  setFlow(null);
  const token = ++shown;
  if (scientist.on) lakeNumbers(p, sciBox); // after the token: it checks it when its data arrive
  lakeFlow(TILES, p.id).then((f) => {
    if (token !== shown || !f) return;
    flowBox.append(el('h3', '', 'Where its water goes'), el('p', '', flowSentence(f, p.n)));
    const pts = decodePath(f.p);
    if (pts.length > 1 && f.km >= 1) { // a lake at the bottom of its own basin has no way to show
      const b = el('button', 'btn-small', 'Show the way') as HTMLButtonElement;
      b.addEventListener('click', () => {
        setFlow(pts);
        const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
        map.fitBounds([[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]], { padding: freeArea(), maxZoom: 9, duration: 1500 });
      });
      flowBox.append(b, el('p', 'fine', 'Along HydroRIVERS, from where the lake drains, simplified to about 2 km.'));
    }
  });
  lakeShape(TILES, p.id).then((s) => {
    if (token !== shown || !s) return;
    shapeBox.append(el('h3', '', 'The shape of its bed'));
    const chart = el('div', 'spark shape'); chart.innerHTML = shapeChart(s); // numbers only (src/shape.ts)
    shapeBox.append(chart);
    for (const line of shapeWords(s, p.wx)) shapeBox.append(el('p', 'fine', line));
  });
  lakeWater(TILES, p.id).then((w) => {
    if (token !== shown || !w) return;
    const sum = waterSummary(w);
    waterBox.append(el('h3', '', 'How its water changed'));
    if (sum) waterBox.append(el('p', '', sum.words));
    // the trend is not told for a lake whose water comes and goes: its start and end are as arbitrary as any other year
    const tr = sum && !sum.words.startsWith('Its water comes and goes') ? trend(w.y0, w.v) : null;
    if (tr) waterBox.append(el('p', 'trend', trendWords(tr, w.y0, w.y0 + w.v.length - 1)));
    const chart = el('div', 'spark');
    chart.innerHTML = sparkline(w, 300, 84, tr ?? undefined); // built from numbers only (src/v2.ts)
    const axis = el('div', 'spark-axis');
    axis.append(el('span', '', String(w.y0)), el('span', '', String(w.y0 + w.v.length - 1)));
    waterBox.append(chart, axis, el('p', 'fine', 'Water volume by year, estimated mostly from the lake’s extent in Landsat images (GloLakes). Trust the ups and downs more than the exact amount.'));
  });
}
let shown = 0;

/** The numbers view of a lake: every value with its source, and downloads (src/sci.ts). */
async function lakeNumbers(p: LakeProps, box: HTMLElement) {
  const token = shown;
  const [f, w, s, me] = await Promise.all([lakeFlow(TILES, p.id), lakeWater(TILES, p.id), lakeShape(TILES, p.id), modelError(TILES)]);
  if (token !== shown) return;
  const tr = w ? trend(w.y0, w.v) : null;
  const vsName = { 1: 'literature', 2: 'GRanD dam register', 3: 'HydroLAKES model' } as Record<number, string>;
  const rows: Row[] = [
    ['HydroLAKES id', p.id, 'HydroLAKES v1.0'], ['Name', p.n], ['Country', p.c], ['Area (km²)', p.a, 'HydroLAKES'],
    ['Elevation (m)', p.e, 'HydroLAKES'], ['Volume (million m³)', p.v, `HydroLAKES, from ${vsName[p.vs ?? 3] ?? 'model'}`],
    ['Mean depth (m)', p.d, `HydroLAKES, from ${vsName[p.vs ?? 3] ?? 'model'}`],
    ['Published mean depth (m)', p.wm, 'Wikidata P4511, criterion mean'], ['Published maximum depth (m)', p.wx, 'Wikidata P4511, criterion maximum'],
    ['Published depth, kind not given (m)', p.wu, 'Wikidata P4511'], ['Wikidata depth cites a source', p.wr == null ? null : p.wr ? 'yes' : 'no', 'Wikidata references'],
    ['Wikidata item', p.q, 'Wikidata'], ['Water-level band seen (m)', p.s, '3D-LAKES L1 (ICESat-2, Landsat)'],
    ['Model maximum depth (m)', s?.g[2], 'GLOBathy'], ['Model mean depth (m)', s?.g[3], 'GLOBathy'],
    ['Model / published maximum', s && p.wx ? s.g[2] / p.wx : null, 'GLOBathy / Wikidata'],
    ['River distance to its end (km)', f?.km, 'HydroRIVERS DIST_DN_KM'], ['Ends in', f ? (f.endo ? `basin with no outlet${f.sinkName ? `: ${f.sinkName}` : ''}` : f.sea ?? 'not known') : null, 'HydroRIVERS, Natural Earth'],
    ['Water record', w ? `${w.y0}–${w.y0 + w.v.length - 1}` : null, 'GloLakes v1.1 (yearly, deseasonalised)'],
    ['Trend (% of usual volume a decade)', tr && tr.level > 0 ? (tr.slope * 1000) / tr.level : null, 'Theil-Sen'],
    ['Trend 95 % interval (% a decade)', tr && tr.level > 0 ? `${((tr.lo * 1000) / tr.level).toFixed(2)} to ${((tr.hi * 1000) / tr.level).toFixed(2)}` : null, 'Sen 1968'],
    ['Mann-Kendall p (Hamed-Rao)', tr?.p, `n = ${tr?.n ?? ''}, tau = ${tr ? tr.tau.toFixed(3) : ''}`],
  ];
  box.append(el('h3', '', 'The numbers'));
  const tbl = el('div', 'sci-wrap'); tbl.innerHTML = tableHTML(rows); // escaped (src/sci.ts)
  const btns = el('p', 'btns');
  const b1 = el('button', 'btn-small', 'Numbers (CSV)');
  b1.addEventListener('click', () => download(`lake-${p.id}.csv`, toCSV(['quantity', 'value', 'source'], rows.filter((r) => r[1] != null).map((r) => [r[0], r[1] as string | number, r[2] ?? '']))));
  btns.append(b1);
  if (w) {
    const b2 = el('button', 'btn-small', 'Water by year (CSV)');
    b2.addEventListener('click', () => download(`lake-${p.id}-water.csv`, toCSV(['year', 'volume_million_m3'], w.v.map((v, i) => [w.y0 + i, v]))));
    btns.append(b2);
  }
  if (s) {
    const b3 = el('button', 'btn-small', 'Bed shape (CSV)');
    b3.addEventListener('click', () => download(`lake-${p.id}-shape.csv`, toCSV(['kind', 'depth_m', 'area_km2'],
      [...modelCurve(s).map(([d, a]) => ['GLOBathy model', +d.toFixed(2), +a.toFixed(4)]), ...observed(s).map(([d, a]) => ['3D-LAKES observed', d, a])])));
    btns.append(b3);
  }
  box.append(tbl, btns, el('p', 'fine', `Model error over all ${me ? me.stats.n : ''} lakes with a published maximum: within 2x for ${me ? Math.round(me.stats.withinFactor2 * 100) : ''} %.`));
}

// ---------- river panel ----------
const RIVER_COLOR = '#7fb6e8';
function showReach(reach: Reach, at: [number, number]) {
  history.replaceState(null, '', `#river=${reach.id}@${at[0].toFixed(3)},${at[1].toFixed(3)},${map.getZoom().toFixed(1)}`);
  openRiver(reach.r ?? null, reach, false);
}
/** A river by its id (r), or a nameless reach; `frame` fits the map to the whole river once it is loaded. */
function openRiver(rid: number | null, reach: Reach | null, frame: boolean) {
  hint.hidden = true;
  body.replaceChildren();
  setFlow(null);
  setSelected([]);
  const token = ++shown;
  const badge = el('p', 'badge', 'River'); badge.style.background = RIVER_COLOR;
  const title = el('h2', rid ? '' : 'unnamed', rid ? reach?.n ?? 'River' : 'River without a name');
  const meta = el('p', 'meta'), verdictP = el('p', 'verdict'), ev = el('ol', 'evidence');
  const wayBox = el('section', 'more'), levelBox = el('section', 'more'), links = el('p', 'links');
  body.append(badge, title, meta, verdictP, ev, wayBox, levelBox, links);
  panel.hidden = false;
  if (reach) {
    meta.textContent = `${fmt(Math.round(reach.q))} m³/s here on average (modelled)`;
    links.append(el('span', 'fine', `HydroRIVERS reach ${reach.id}`));
  }
  if (rid) {
    riverRecord(TILES, rid).then((r) => { if (token === shown && r) fillRiver(r, rid, title, meta, verdictP, ev, wayBox, reach, frame); });
  } else {
    verdictP.textContent = 'No name for this river was found on this map (names come from OpenStreetMap, for rivers about 30 m wide or more).';
    if (reach?.d) riverRecord(TILES, reach.d).then((r) => {
      if (token !== shown || !r) return;
      verdictP.textContent = `No name for this stretch was found on this map. It flows into ${theRiver(r.n)}.`;
      const b = el('button', 'btn-small', `Open ${theRiver(r.n)}`);
      b.addEventListener('click', () => { history.replaceState(null, '', `#r=${reach.d}`); openRiver(reach.d!, null, true); });
      wayBox.append(b);
    });
  }
  if (reach?.s) {
    levelBox.append(el('h3', '', 'Water level here, seen by SWOT'));
    const wait = el('p', 'fine', 'Asking NASA for the measurements…');
    levelBox.append(wait);
    swotLevels(reach.s).then((pts) => {
      if (token !== shown) return;
      wait.remove();
      if (pts == null) { levelBox.append(el('p', 'fine', 'The SWOT measurements could not be loaded just now. Try again later.')); return; }
      const sum = levelSummary(pts);
      if (!sum) { levelBox.append(el('p', 'fine', `SWOT has measured this stretch ${pts.length ? `only ${pts.length} times` : 'not yet, or not well enough'}.`)); return; }
      levelBox.append(el('p', '', sum));
      const chart = el('div', 'spark level'); chart.innerHTML = levelChart(pts); // numbers only (src/river.ts)
      const axis = el('div', 'spark-axis');
      const mo = (t: number) => new Date(t).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
      axis.append(el('span', '', mo(pts[0].t)), el('span', '', mo(pts[pts.length - 1].t)));
      levelBox.append(chart, axis, el('p', 'fine', 'Each dot is one pass of the SWOT satellite (NASA and CNES) over this stretch of river, from PO.DAAC Hydrocron. Doubtful passes are left out.'));
      if (scientist.on) {
        const b = el('button', 'btn-small', 'SWOT passes (CSV)');
        b.addEventListener('click', () => download(`swot-${reach.s}.csv`, toCSV(['time_utc', 'wse_m_egm2008', 'wse_u_m'], pts.map((q) => [new Date(q.t).toISOString(), q.h, q.u ?? '']))));
        const row = el('p', 'btns'); row.append(b); levelBox.append(row);
      }
    });
  }
}
function fillRiver(r: River, rid: number, title: HTMLElement, meta: HTMLElement, verdictP: HTMLElement, ev: HTMLElement, wayBox: HTMLElement, reach: Reach | null, frame: boolean) {
  title.textContent = r.n;
  const local = r.l && r.l !== r.n ? `locally ${r.l}` : '';
  meta.textContent = [local, `${fmt(r.km)} km long`, reach ? `${fmt(Math.round(reach.q))} m³/s here, ${fmt(Math.round(r.q))} m³/s at its end (modelled)` : `${fmt(Math.round(r.q))} m³/s at its end (modelled)`].filter(Boolean).join(', ');
  verdictP.textContent = riverEnd(r);
  for (const x of riverFacts(r)) {
    const li = el('li', `ev ev-${x.kind}`);
    li.append(el('h3', '', x.title), el('p', '', x.text));
    ev.append(li);
  }
  const lines = riverLines(r);
  setSelected(lines);
  const all = el('button', 'btn-small', 'Show all of it');
  all.addEventListener('click', () => fitTo(lines.flat()));
  const row = el('p', 'btns'); row.append(all);
  if (r.p) {
    const way = decodePath(r.p);
    const b = el('button', 'btn-small', 'Show the way to the sea');
    if (r.endo) b.textContent = 'Show where its water ends';
    b.addEventListener('click', () => { setFlow(way); fitTo([...lines.flat(), ...way]); });
    row.append(b);
  }
  wayBox.append(row);
  if (r.into && r.intoName) {
    const b = el('button', 'link', `Open ${theRiver(r.intoName)}`);
    b.addEventListener('click', () => { history.replaceState(null, '', `#r=${r.into}`); openRiver(r.into!, null, true); });
    wayBox.append(b);
  }
  wayBox.append(el('p', 'fine', 'Name from OpenStreetMap through SWORD; length, flow and course from HydroRIVERS.'));
  if (scientist.on) {
    const rows: Row[] = [
      ['River id (HYRIV_ID of its last reach)', rid, 'HydroRIVERS'], ['Name', r.n, 'SWORD / Wikidata English label'], ['Local name', r.l, 'SWORD (OpenStreetMap)'],
      ['Length (km)', r.km, 'HydroRIVERS DIST_DN_KM'], ['Mean flow at its end (m³/s)', r.q, 'WaterGAP 1971–2000 in HydroRIVERS'],
      ['Drainage area (km²)', r.up, 'HydroRIVERS UPLAND_SKM'], ['Flows into', r.intoName, 'HydroRIVERS + SWORD'],
      ['Ends in', r.endo ? `basin with no outlet${r.sinkName ? `: ${r.sinkName}` : ''}` : r.sea ?? null, 'Natural Earth'],
      ['Distance on to the end (km)', r.dkm, 'HydroRIVERS'], ['Width (m)', r.w, 'SWORD (Landsat, GRWL)'],
      ['Stretches measured by SWOT (5+ passes)', r.swot?.[0], 'SWORD v17c'], ['Width seen by SWOT (m)', r.swot?.[1], 'SWORD v17c'],
      ['Wikidata item', r.wd, 'Wikidata'], ['Clicked reach', reach?.id, 'HydroRIVERS'], ['SWORD reach at the click', reach?.s, 'SWORD v17c'],
    ];
    const box = el('div', 'sci-wrap'); box.innerHTML = tableHTML(rows); // escaped (src/sci.ts)
    const b = el('button', 'btn-small', 'Numbers (CSV)');
    b.addEventListener('click', () => download(`river-${rid}.csv`, toCSV(['quantity', 'value', 'source'], rows.filter((x) => x[1] != null).map((x) => [x[0], x[1] as string | number, x[2] ?? '']))));
    const row2 = el('p', 'btns'); row2.append(b);
    wayBox.append(el('h3', '', 'The numbers'), box, row2);
  }
  if (r.wd) {
    const a = el('a', '', 'Wikidata item') as HTMLAnchorElement;
    a.href = `https://www.wikidata.org/wiki/${r.wd}`; a.target = '_blank'; a.rel = 'noopener';
    const lp = el('p', 'links'); lp.append(a); wayBox.append(lp);
  }
  if (!reach) history.replaceState(null, '', `#r=${rid}`);
  if (frame) fitTo(lines.flat());
}
function setSelected(lines: [number, number][][]) {
  map?.setFilter('selected-lake', ['==', ['get', 'id'], -1]);
  (map?.getSource('selected') as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: lines.length ? [{ type: 'Feature', properties: {}, geometry: { type: 'MultiLineString', coordinates: lines } }] : [] });
}
function fitTo(pts: [number, number][]) {
  if (!pts.length) return;
  const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
  map.fitBounds([[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]], { padding: freeArea(), maxZoom: 9, duration: 1500 });
}
/** Padding that keeps a framed path clear of the title, the colour key and the lake panel (the river mouth of the
 *  Rhone ended up under the key with fixed padding). */
function freeArea() {
  const gap = 30;
  const top = (document.querySelector('.masthead')?.getBoundingClientRect().bottom ?? 0) + gap;
  if (matchMedia('(max-width: 760px)').matches) return { top, left: gap, right: gap, bottom: innerHeight * 0.6 };
  const key = document.getElementById('key')?.getBoundingClientRect();
  const left = (key && key.height ? key.right : 0) + gap;
  const right = innerWidth - panel.getBoundingClientRect().left + gap;
  return { top, left, right, bottom: gap };
}
function setFlow(pts: [number, number][] | null) {
  const src = map?.getSource('flow') as GeoJSONSource | undefined;
  if (!src) return;
  if (!pts) { src.setData({ type: 'FeatureCollection', features: [] }); return; }
  src.setData({ type: 'FeatureCollection', features: [
    { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: pts } },
    { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: pts[pts.length - 1] } },
  ] });
}
function closePanel() {
  panel.hidden = true;
  shown++;
  setFlow(null);
  (map?.getSource('selected') as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: [] });
  map?.setFilter('selected-lake', ['==', ['get', 'id'], -1]);
  history.replaceState(null, '', location.pathname);
}
panel.querySelector('.close')!.addEventListener('click', closePanel);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !panel.hidden && !document.querySelector('dialog[open]')) closePanel(); });

/** Fly to a lake and open it once its tiles are on screen. */
function goToLake(id: number, lon: number, lat: number, zoom: number) {
  const phone = matchMedia('(max-width: 760px)').matches; // the panel covers the bottom 60 % on phones
  map.flyTo({ center: [lon, lat], zoom, duration: 1600, essential: true, padding: phone ? { top: 0, left: 0, right: 0, bottom: innerHeight * 0.55 } : { top: 0, left: 0, bottom: 0, right: 400 } });
  map.once('idle', () => {
    const f = map.querySourceFeatures('atlas', { sourceLayer: 'lakes', filter: ['==', ['get', 'id'], id] });
    if (f.length) showLake(f[0].properties as unknown as LakeProps, [lon, lat]);
  });
}
function applyHash() {
  const m = /lake=(\d+)@(-?[\d.]+),(-?[\d.]+)(?:,([\d.]+))?/.exec(location.hash);
  if (m) return goToLake(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4] ?? 9));
  const rv = /river=(\d+)@(-?[\d.]+),(-?[\d.]+)(?:,([\d.]+))?/.exec(location.hash);
  if (rv) return goToReach(Number(rv[1]), Number(rv[2]), Number(rv[3]), Number(rv[4] ?? 8));
  const r = /[#&]r=(\d+)/.exec(location.hash);
  if (r) openRiver(Number(r[1]), null, true);
}
/** Fly to a clicked river reach (from a shared link) and open it once its tiles are on screen. */
function goToReach(id: number, lon: number, lat: number, zoom: number) {
  map.jumpTo({ center: [lon, lat], zoom });
  map.once('idle', () => {
    const f = map.querySourceFeatures('atlas', { sourceLayer: 'rivers', filter: ['==', ['get', 'id'], id] });
    if (f.length) showReach(f[0].properties as unknown as Reach, [lon, lat]);
  });
}

// ---------- search ----------
let index: SearchIndex | null = null, rindex: RiverIndex | null = null;
const input = $<HTMLInputElement>('#search'), hits = $<HTMLUListElement>('#hits');
let cursor = -1; // the hit chosen with the arrow keys
const highlight = (i: number) => {
  cursor = i;
  [...hits.children].forEach((li, k) => li.setAttribute('aria-selected', String(k === i)));
  if (i >= 0) input.setAttribute('aria-activedescendant', `hit-${i}`); else input.removeAttribute('aria-activedescendant');
};
const loadIndexes = async () => {
  [index, rindex] = await Promise.all([
    index ?? fetch(`${base}data/search.json`).then((r) => r.json()),
    rindex ?? fetch(`${base}data/search_rivers.json`).then((r) => r.json()).catch(() => ({ n: [], id: [], x: [], y: [], q: [], km: [] })),
  ]);
};
input.addEventListener('focus', loadIndexes, { once: true });
input.addEventListener('input', async () => {
  if (!index || !rindex) await loadIndexes();
  const res = mergeHits(prefixSearch(index!, input.value, 8), riverSearch(rindex!, input.value, 8), 8);
  hits.replaceChildren();
  for (const [i, r] of res.entries()) {
    const li = el('li'); li.setAttribute('role', 'option'); li.id = `hit-${i}`;
    if (r.kind === 'lake') {
      const sw = el('span', 'sw'); sw.style.background = TIERS[r.tier as 1 | 2 | 3].color;
      li.append(sw, el('span', 'hn', r.name), el('span', 'ha', [r.country, areaWords(r.area)].filter(Boolean).join(', ')));
      li.addEventListener('mousedown', (e) => { e.preventDefault(); hits.hidden = true; input.blur(); goToLake(r.id, r.lon, r.lat, zoomFor(r.area)); });
    } else {
      li.append(el('span', 'sw riv'), el('span', 'hn', r.name), el('span', 'ha', `${fmt(r.km)} km${r.to ? `, into ${seaName(r.to)}` : ' river'}`));
      li.addEventListener('mousedown', (e) => { e.preventDefault(); hits.hidden = true; input.blur(); history.replaceState(null, '', `#r=${r.id}`); openRiver(r.id, null, true); });
    }
    hits.append(li);
  }
  if (!res.length && input.value.trim().length >= 2) {
    const li = el('li', 'none', 'No lake or river by that name. Try another spelling or the local name.');
    li.setAttribute('aria-disabled', 'true');
    hits.append(li);
  }
  hits.hidden = !hits.children.length;
  highlight(-1);
  input.setAttribute('aria-expanded', String(!hits.hidden));
});
input.addEventListener('keydown', (e) => {
  const n = hits.hidden ? 0 : hits.children.length;
  if (e.key === 'ArrowDown' && n) { e.preventDefault(); highlight(Math.min(cursor + 1, n - 1)); }
  if (e.key === 'ArrowUp' && n) { e.preventDefault(); highlight(Math.max(cursor - 1, 0)); }
  if (e.key === 'Enter') (hits.children[Math.max(cursor, 0)] as HTMLElement | undefined)?.dispatchEvent(new MouseEvent('mousedown'));
  if (e.key === 'Escape') { hits.hidden = true; input.blur(); }
});
input.addEventListener('blur', () => setTimeout(() => { hits.hidden = true; }, 150));
const zoomFor = (km2: number) => Math.max(3, Math.min(12, 10.5 - Math.log2(Math.max(km2, 0.1)) / 2));

// ---------- about ----------
const about = $<HTMLDialogElement>('#about');
$('#about-open').addEventListener('click', () => about.showModal());
about.querySelector('.close')!.addEventListener('click', () => about.close());
about.addEventListener('click', (e) => { if (e.target === about) about.close(); });

start().catch((e) => { hint.textContent = 'The map did not load. Reload the page to try again.'; console.error(e); });
(window as unknown as { __lakes: unknown }).__lakes = { get map() { return map; } };
