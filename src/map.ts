// The map: NASA Blue Marble, rivers, and 1.4 million lakes coloured by how well we know their depth.
import * as maplibregl from 'maplibre-gl';
import type { MapGeoJSONFeature, StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { PMTiles, Protocol } from 'pmtiles';
import { ChunkedSource, type ChunkedArchive } from './chunked';
import { TIERS, type LakeProps } from './lake';
import type { Reach } from './river';

maplibregl.setWorkerUrl(workerUrl);
const GIBS = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_ShadedRelief_Bathymetry/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg';
const GLYPHS = 'https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf';
const protocol = new Protocol();
maplibregl.addProtocol('pmtiles', protocol.tile);

export const SELECT_COLOR = '#ff5d8f';
/** Lakes by the evidence for their depth (the model-error view swaps these out, src/main.ts). */
export const LAKE_COLOR = ['match', ['get', 'tier'], 3, TIERS[3].color, 2, TIERS[2].color, TIERS[1].color] as unknown as maplibregl.ExpressionSpecification;
export const LAKE_OPACITY = ['match', ['get', 'tier'], 3, 0.95, 2, 0.85, 0.55] as unknown as maplibregl.ExpressionSpecification;
/** The way the water goes: a light, dashed line that reads on both rivers and land. */
export const FLOW_COLOR = '#fff1b8';

/** The vector tiles live in their own static site (lakes-atlas-tiles), cut into 2 MiB pieces: they change rarely and
 *  are far bigger than the app. VITE_TILES overrides the location (the dev setup serves them from localhost:5401). */
export const TILES: string = import.meta.env.VITE_TILES ?? 'https://inlandwater-tiles.bristleconelab.org/';
/** Bump when the tile archive is rebuilt (pipeline/build_tiles.sh NAME). */
const TILES_VERSION = 'v5';

export async function createMap(container: HTMLElement): Promise<maplibregl.Map> {
  // versioned: the tile site caches files for a week, and a new archive lives under a new folder (lakes-atlas-v4/)
  const manifest = await fetch(`${TILES}manifest.json?v=${TILES_VERSION}`).then((r) => r.json()) as Record<string, ChunkedArchive>;
  const archive = manifest['lakes-atlas'];
  archive.base = new URL(archive.base, TILES).href;
  protocol.add(new PMTiles(new ChunkedSource(archive)));

  const style: StyleSpecification = {
    version: 8,
    glyphs: GLYPHS,
    projection: { type: 'globe' },
    sky: { 'sky-color': '#0c1a24', 'horizon-color': '#24485a', 'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 0.9, 5, 0.5, 7, 0] },
    sources: {
      earth: { type: 'raster', tiles: [GIBS], tileSize: 256, maxzoom: 8, attribution: 'Imagery: NASA Blue Marble via <a href="https://earthdata.nasa.gov/gibs">GIBS</a>' },
      atlas: { type: 'vector', url: `pmtiles://${archive.base}`, promoteId: { lakes: 'id' }, attribution: 'Lakes: HydroLAKES, 3D-LAKES, Wikidata; rivers: HydroRIVERS, SWORD (names © OpenStreetMap contributors)' },
      selected: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
      flow: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
      basin: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#0c1a24' } },
      // darkened and desaturated, so the coloured lakes carry the picture
      { id: 'earth', type: 'raster', source: 'earth', paint: { 'raster-saturation': -0.55, 'raster-brightness-max': 0.62, 'raster-contrast': 0.1 } },
      {
        id: 'rivers', type: 'line', source: 'atlas', 'source-layer': 'rivers', layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#7fb6e8',
          'line-opacity': ['interpolate', ['linear'], ['zoom'], 2, 0.45, 8, 0.8],
          'line-width': ['interpolate', ['exponential', 1.6], ['zoom'], 2, ['max', 0.3, ['-', 3.2, ['*', 0.45, ['get', 'o']]]], 10, ['max', 0.8, ['-', 9, ['*', 1.1, ['get', 'o']]]]],
        },
      },
      {
        id: 'lakes', type: 'fill', source: 'atlas', 'source-layer': 'lakes',
        paint: {
          'fill-color': LAKE_COLOR,
          'fill-opacity': LAKE_OPACITY,
          'fill-antialias': true,
        },
      },
      // the catchment of the chosen lake or river, under the lakes so they stay readable
      { id: 'basin-fill', type: 'fill', source: 'basin', paint: { 'fill-color': '#9ad1ff', 'fill-opacity': 0.12 } },
      { id: 'basin-line', type: 'line', source: 'basin', paint: { 'line-color': '#9ad1ff', 'line-width': 1.4, 'line-opacity': 0.8 } },
      { id: 'lakes-edge', type: 'line', source: 'atlas', 'source-layer': 'lakes', minzoom: 7, paint: { 'line-color': '#0c1a24', 'line-width': 0.4, 'line-opacity': 0.5 } },
      { id: 'flow-glow', type: 'line', source: 'flow', filter: ['==', ['geometry-type'], 'LineString'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': FLOW_COLOR, 'line-width': 7, 'line-opacity': 0.25, 'line-blur': 3 } },
      { id: 'flow', type: 'line', source: 'flow', filter: ['==', ['geometry-type'], 'LineString'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': FLOW_COLOR, 'line-width': 2.4, 'line-dasharray': [2, 1.5] } },
      { id: 'flow-end', type: 'circle', source: 'flow', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': 6, 'circle-color': FLOW_COLOR, 'circle-stroke-color': '#0c1a24', 'circle-stroke-width': 2 } },
      // the chosen lake, drawn from the tiles themselves: a GeoJSON copy of the tile pieces showed the cuts between
      // tiles as pink lines across the lake
      { id: 'selected-lake', type: 'line', source: 'atlas', 'source-layer': 'lakes', filter: ['==', ['get', 'id'], -1], paint: { 'line-color': SELECT_COLOR, 'line-width': 3 } },
      { id: 'selected', type: 'line', source: 'selected', paint: { 'line-color': SELECT_COLOR, 'line-width': 3 } },
      {
        id: 'river-labels', type: 'symbol', source: 'atlas', 'source-layer': 'rivernames', minzoom: 2,
        layout: {
          'symbol-placement': 'line', 'symbol-spacing': 420, 'text-field': ['get', 'n'], 'text-font': ['Noto Sans Italic'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 3, ['-', 13, ['get', 'o']], 10, ['-', 16, ['*', 0.5, ['get', 'o']]]],
          'text-letter-spacing': 0.06, 'text-max-angle': 60, 'symbol-sort-key': ['get', 'o'], 'text-padding': 6,
        },
        paint: { 'text-color': '#a9d3f5', 'text-halo-color': '#0c1a24', 'text-halo-width': 1.3 },
      },
      {
        id: 'labels', type: 'symbol', source: 'atlas', 'source-layer': 'labels',
        layout: {
          'text-field': ['get', 'name'], 'text-font': ['Noto Sans Italic'], 'text-size': ['interpolate', ['linear'], ['zoom'], 3, 11, 9, 14],
          'text-max-width': 8, 'symbol-sort-key': ['-', 0, ['get', 'a']], 'text-padding': 4,
        },
        paint: { 'text-color': '#f3f6f8', 'text-halo-color': '#0c1a24', 'text-halo-width': 1.4 },
      },
    ],
  };
  const map = new maplibregl.Map({ container, style, center: [60, 35], zoom: 2.2, minZoom: 0.8, maxZoom: 13, attributionControl: { compact: true } });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
  await new Promise<void>((res) => map.once('load', () => res()));
  return map;
}

/** The lake under a point (its outline is drawn from the tiles by the 'selected-lake' layer). */
export function lakeAt(map: maplibregl.Map, point: maplibregl.PointLike): LakeProps | null {
  const hit = map.queryRenderedFeatures(point, { layers: ['lakes'] })[0] as MapGeoJSONFeature | undefined;
  return hit ? (hit.properties as unknown as LakeProps) : null;
}

/** The biggest river reach within a few pixels of a point (river lines are thin). */
export function riverAt(map: maplibregl.Map, p: maplibregl.Point, r = 6): Reach | null {
  const hits = map.queryRenderedFeatures([[p.x - r, p.y - r], [p.x + r, p.y + r]], { layers: ['rivers'] });
  if (!hits.length) return null;
  const best = hits.reduce((a, b) => ((b.properties.q as number) > (a.properties.q as number) ? b : a));
  return best.properties as unknown as Reach;
}
