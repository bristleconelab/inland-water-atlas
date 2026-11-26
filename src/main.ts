import '@fontsource-variable/bricolage-grotesque';
import '@fontsource-variable/source-serif-4';
import './styles.css';
import type { FilterSpecification, GeoJSONSource, Map as MlMap } from 'maplibre-gl';
import { areaWords, depthCheck, evidence, KIND, TIERS, verdict, type LakeProps } from './lake';
import { createMap, lakeAt, riverAt, TILES } from './map';
import { decodePath, flowSentence, lakeFlow, lakeWater, sparkline, waterSummary } from './v2';
import { levelChart, levelSummary, riverEnd, riverFacts, riverLines, riverRecord, swotLevels, theRiver, type Reach, type River } from './river';
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
  const flowBox = el('section', 'more'), waterBox = el('section', 'more');
  body.append(flowBox, waterBox, links);
  if (p.tier === 1) body.append(el('p', 'fine', 'Know a published depth for this lake? Adding it to the lake’s Wikidata item (with a source) will show it here after the next update.'));
  panel.hidden = false;
  setFlow(null);
  const token = ++shown;
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
  lakeWater(TILES, p.id).then((w) => {
    if (token !== shown || !w) return;
    const sum = waterSummary(w);
    waterBox.append(el('h3', '', 'How its water changed'));
    if (sum) waterBox.append(el('p', '', sum.words));
    const chart = el('div', 'spark');
    chart.innerHTML = sparkline(w); // built from numbers only (src/v2.ts)
    const axis = el('div', 'spark-axis');
    axis.append(el('span', '', String(w.y0)), el('span', '', String(w.y0 + w.v.length - 1)));
    waterBox.append(chart, axis, el('p', 'fine', 'Water volume by year, estimated mostly from the lake’s extent in Landsat images (GloLakes). Trust the ups and downs more than the exact amount.'));
  });
}
let shown = 0;

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
      li.append(el('span', 'sw riv'), el('span', 'hn', r.name), el('span', 'ha', `river, ${fmt(r.km)} km`));
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
