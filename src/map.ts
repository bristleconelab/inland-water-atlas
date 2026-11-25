// The map: NASA Blue Marble, rivers, and 1.4 million lakes coloured by how well we know their depth.
import * as maplibregl from 'maplibre-gl';
import type { MapGeoJSONFeature, StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { PMTiles, Protocol } from 'pmtiles';
import { ChunkedSource, type ChunkedArchive } from './chunked';
import { TIERS, type LakeProps } from './lake';

maplibregl.setWorkerUrl(workerUrl);
const GIBS = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_ShadedRelief_Bathymetry/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg';
const GLYPHS = 'https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf';
const protocol = new Protocol();
maplibregl.addProtocol('pmtiles', protocol.tile);

export const SELECT_COLOR = '#ff5d8f';

/** The vector tiles live in their own static site (lakes-atlas-tiles), cut into 2 MiB pieces: they change rarely and
 *  are far bigger than the app. VITE_TILES overrides the location (the dev setup serves them from localhost:5401). */
export const TILES: string = import.meta.env.VITE_TILES ?? 'https://lakes-atlas-tiles.pages.dev/';

export async function createMap(container: HTMLElement): Promise<maplibregl.Map> {
  const manifest = await fetch(`${TILES}manifest.json`).then((r) => r.json()) as Record<string, ChunkedArchive>;
  const archive = manifest['lakes-atlas'];
  archive.base = new URL(archive.base, TILES).href;
  protocol.add(new PMTiles(new ChunkedSource(archive)));
  const tier = (t: 1 | 2 | 3) => TIERS[t].color;

  const style: StyleSpecification = {
    version: 8,
    glyphs: GLYPHS,
    projection: { type: 'globe' },
    sky: { 'sky-color': '#0c1a24', 'horizon-color': '#24485a', 'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 0.9, 5, 0.5, 7, 0] },
    sources: {
      earth: { type: 'raster', tiles: [GIBS], tileSize: 256, maxzoom: 8, attribution: 'Imagery: NASA Blue Marble via <a href="https://earthdata.nasa.gov/gibs">GIBS</a>' },
      atlas: { type: 'vector', url: `pmtiles://${archive.base}`, attribution: 'Lakes: HydroLAKES, 3D-LAKES, Wikidata; rivers: HydroRIVERS' },
      selected: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
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
          'fill-color': ['match', ['get', 'tier'], 3, tier(3), 2, tier(2), tier(1)],
          'fill-opacity': ['match', ['get', 'tier'], 3, 0.95, 2, 0.85, 0.55],
          'fill-antialias': true,
        },
      },
      { id: 'lakes-edge', type: 'line', source: 'atlas', 'source-layer': 'lakes', minzoom: 7, paint: { 'line-color': '#0c1a24', 'line-width': 0.4, 'line-opacity': 0.5 } },
      { id: 'selected', type: 'line', source: 'selected', paint: { 'line-color': SELECT_COLOR, 'line-width': 3 } },
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

/** The lake under a point, with its full outline (all tile pieces with the same id merged). */
export function lakeAt(map: maplibregl.Map, point: maplibregl.PointLike): { props: LakeProps; outline: GeoJSON.Feature[] } | null {
  const hit = map.queryRenderedFeatures(point, { layers: ['lakes'] })[0] as MapGeoJSONFeature | undefined;
  if (!hit) return null;
  const id = hit.properties.id as number;
  const parts = map.querySourceFeatures('atlas', { sourceLayer: 'lakes', filter: ['==', ['get', 'id'], id] });
  return { props: hit.properties as unknown as LakeProps, outline: parts.map((f) => ({ type: 'Feature', properties: {}, geometry: f.geometry })) };
}
