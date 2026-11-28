# Data contract

Everything the app reads besides its own `public/data/` files lives on the tile site
(`https://inlandwater-tiles.bristleconelab.org/`, set with `VITE_TILES`). The site caches files for a week, so every URL
carries a version: bump it when the files behind it are republished.

| Path | Written by | Read by | Version constant |
|---|---|---|---|
| `manifest.json`, `lakes-atlas-vN/NNNNN.bin` | `pipeline/build_tiles.sh`, `pipeline/split_pmtiles.mjs` | `src/map.ts`, `src/chunked.ts` | `TILES_VERSION` |
| `v2/flow/NNN.json`, `v2/water/NNN.json` (128 shards, `Hylak_id % 128`) | `pipeline/build_flow.py` | `src/v2.ts` | `DATA_VERSION` |
| `v2/river/NNN.json` (128, river id % 128) | `pipeline/build_rivers.py` | `src/river.ts` | `RIVER_VERSION` |
| `v2/shape/NNN.json` (256), `v2/model_error.json` | `pipeline/build_shape.py` | `src/shape.ts` | `SHAPE_VERSION` |
| `v2/basin/...` | `pipeline/build_basins.py` | `src/basin.ts` | in `src/basin.ts` |
| `v2/levels.json` | `pipeline/build_levels.py` | `src/levels.ts` | query string in `src/levels.ts` |
| `v2/limno/NNN.json` (256), `v2/endo.json`, `v2/profile/NNN.json` (128) | `pipeline/build_extra.py` | `src/limno.ts`, `src/profile.ts`, `src/main.ts` | `EXTRA_VERSION` |
| `v2/trend.json` | `scripts/build_trend.ts` (from `v2/water`) | `src/main.ts` | `EXTRA_VERSION` |

`public/data/stats.json`, `search.json` and `search_rivers.json` ship with the app (`pipeline/build_lakes.py`,
`build_extra.py`, `build_search.py`, `build_search_rivers.py`).

## Tiles

`manifest.json` maps a layer name to `{ base, size, chunk, count, sha256, source? }`: the PMTiles archive cut into
`count` pieces of `chunk` bytes under `base` (Cloudflare Pages has no range requests and a 25 MiB file limit).
`src/chunked.ts` turns a byte range into piece reads. Source layers: `lakes` (polygons; `id`, `tier`, `a`, `n`, `c`,
`t`, `d`, `v`, `vs`, `e`, `s`, `wm`, `wx`, `wu`, `q`, `wr`, see `LakeProps` in `src/lake.ts`), `labels`, `rivers`
(`id`, `o`, `q`, `n`, `r`, `d`, `s`, see `Reach` in `src/river.ts`) and `rivernames`.

## Shards

Each shard is one JSON object keyed by the id as a string. Values:

- **flow**: `{ p, km, endo, sea?, sink?, sinkName? }`; `p` is a path in 0.01 degree steps, first point absolute, then
  differences (`decodePath` in `src/v2.ts`).
- **water**: `{ y0, v, src? }`; `v[i]` is the GloLakes volume (million m³) of year `y0 + i`, `null` when missing.
- **river**: see `River` in `src/river.ts`.
- **shape**: `{ g: [a, b, dmax, dmean], o? }`; GLOBathy area `A = a h^b` (km², `h` m above the bottom) and the
  3D-LAKES observed pairs `[depth cm, area ha, ...]`.
- **limno**: `[shore km, shoreline development, residence time days, catchment km², mean outflow m³/s]`, `null` when
  HydroLAKES does not know.
- **profile**: `{ x, z, q, d, ir, lk? }`: km from the source, elevation m, natural flow m³/s, degree of regulation %,
  irrigated share of the basin %, and `[km, Hylak_id, name, type, area km²]` of the lakes on the main stem.
- **trend.json**: `{ id: [% of the usual volume a decade, p, class] }`, class 1 falling, 2 rising, 0 no clear trend.
- **endo.json**: sorted `Hylak_id`s of the lakes that drain to a basin with no outlet.

Every writer uses `allow_nan=False` (a single NaN once made a whole shard unreadable).
