import '@fontsource-variable/bricolage-grotesque';
import '@fontsource-variable/source-serif-4';
import './styles.css';
import type { FilterSpecification, GeoJSONSource, Map as MlMap } from 'maplibre-gl';
import { areaWords, depthCheck, evidence, KIND, TIERS, verdict, type LakeProps } from './lake';
import { createMap, lakeAt } from './map';
import { prefixSearch, type SearchIndex } from './search';

const $ = <T extends HTMLElement>(s: string) => document.querySelector(s) as T;
const base = import.meta.env.BASE_URL;
const fmt = (n: number) => n.toLocaleString('en-US');
const el = (tag: string, cls = '', text?: string) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const hint = $('#hint'), panel = $('#panel'), body = $('#panel .panel-body');

let map: MlMap;

async function start() {
  map = await createMap($('#map'));
  map.on('click', (e) => {
    const hit = lakeAt(map, e.point);
    if (hit) showLake(hit.props, hit.outline, [e.lngLat.lng, e.lngLat.lat]); else closePanel();
  });
  map.on('mousemove', (e) => { map.getCanvas().style.cursor = map.queryRenderedFeatures(e.point, { layers: ['lakes'] }).length ? 'pointer' : ''; });
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
$<HTMLInputElement>('#rivers-on').addEventListener('change', (e) => map?.setLayoutProperty('rivers', 'visibility', (e.target as HTMLInputElement).checked ? 'visible' : 'none'));

// ---------- lake panel ----------
function showLake(p: LakeProps, outline: GeoJSON.Feature[], at: [number, number]) {
  hint.hidden = true;
  (map.getSource('selected') as GeoJSONSource).setData({ type: 'FeatureCollection', features: outline });
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
  body.append(links);
  if (p.tier === 1) body.append(el('p', 'fine', 'Know a published depth for this lake? Adding it to the lake’s Wikidata item (with a source) will show it here after the next update.'));
  panel.hidden = false;
}
function closePanel() {
  panel.hidden = true;
  (map?.getSource('selected') as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: [] });
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
    if (f.length) showLake(f[0].properties as unknown as LakeProps, f.map((x) => ({ type: 'Feature', properties: {}, geometry: x.geometry })), [lon, lat]);
  });
}
function applyHash() {
  const m = /lake=(\d+)@(-?[\d.]+),(-?[\d.]+)(?:,([\d.]+))?/.exec(location.hash);
  if (m) goToLake(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4] ?? 9));
}

// ---------- search ----------
let index: SearchIndex | null = null;
const input = $<HTMLInputElement>('#search'), hits = $<HTMLUListElement>('#hits');
input.addEventListener('focus', async () => { index ??= await fetch(`${base}data/search.json`).then((r) => r.json()); }, { once: true });
input.addEventListener('input', async () => {
  index ??= await fetch(`${base}data/search.json`).then((r) => r.json());
  const res = prefixSearch(index!, input.value, 8);
  hits.replaceChildren();
  for (const r of res) {
    const li = el('li'); li.setAttribute('role', 'option');
    const sw = el('span', 'sw'); sw.style.background = TIERS[r.tier as 1 | 2 | 3].color;
    li.append(sw, el('span', 'hn', r.name), el('span', 'ha', areaWords(r.area)));
    li.addEventListener('mousedown', (e) => { e.preventDefault(); hits.hidden = true; input.blur(); goToLake(r.id, r.lon, r.lat, zoomFor(r.area)); });
    hits.append(li);
  }
  hits.hidden = !res.length;
  input.setAttribute('aria-expanded', String(!hits.hidden));
});
input.addEventListener('keydown', (e) => { if (e.key === 'Enter') (hits.firstElementChild as HTMLElement | null)?.dispatchEvent(new MouseEvent('mousedown')); if (e.key === 'Escape') { hits.hidden = true; input.blur(); } });
input.addEventListener('blur', () => setTimeout(() => { hits.hidden = true; }, 150));
const zoomFor = (km2: number) => Math.max(3, Math.min(12, 10.5 - Math.log2(Math.max(km2, 0.1)) / 2));

// ---------- about ----------
const about = $<HTMLDialogElement>('#about');
$('#about-open').addEventListener('click', () => about.showModal());
about.querySelector('.close')!.addEventListener('click', () => about.close());
about.addEventListener('click', (e) => { if (e.target === about) about.close(); });

start().catch((e) => { hint.textContent = 'The map did not load. Reload the page to try again.'; console.error(e); });
(window as unknown as { __lakes: unknown }).__lakes = { get map() { return map; } };
