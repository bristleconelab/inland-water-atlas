# Lake Atlas

**How deep is this lake, and how do we know?** All 1,427,688 lakes of at least 10 hectares on one map, coloured by
the best evidence there is for their depth.

| | Lakes | Share |
|---|---:|---:|
| **Depth published**: a measured depth or volume, from the literature, a dam register or Wikidata | 14,110 | 1.0 % |
| **Seen from space**: satellites saw the water level rise and fall over part of the bed (3D-LAKES) | 501,654 | 35.1 % |
| **Model only**: the depth in HydroLAKES, and in the maps and models built on it, is a statistical estimate | 911,924 | 63.9 % |

By area the picture is better: lakes with a published depth cover 57.8 % of all lake area, because the big lakes are
the well-studied ones. Satellites typically saw a band of water level only 0.66 m high.

Click any lake to read what is known: its published depth (with a link to the Wikidata item), a volume from the
literature or a dam register, the band of level satellites have seen, or the model estimate. When a published depth
does not fit the published volume, the panel says so. Search 125,597 named lakes by name; rivers with at least 5 m³/s
of average flow are drawn underneath.

The panel also answers two more questions:

- **Where does its water go?** For 233,337 lakes (every lake of at least 1 km², every named lake and every lake with a
  water record), the river path from the lake's outlet to the sea, drawn on the map with *Show the way*. 221,660 reach
  a named sea; 8,597 end inland, in a basin with no outlet (named after the lake they end in, such as the Aral Sea);
  for 3,080 the river map stops without reaching a sea, and the panel says so.
- **How has its water changed?** For 20,847 lakes and reservoirs, the yearly water volume since 1984 (to 2026 for most),
  with one sentence comparing the first five years with the last five. Lakes that fill in wet years and dry out in
  between are described as such instead of being given a trend.

![Lake Balkhash and Central Asia](docs/img/central-asia.png)

| Finland: well documented | Northern Canada: mostly seen from space or modelled |
|---|---|
| ![Finland](docs/img/finland.png) | ![Canada](docs/img/canada.png) |

| Geneva: its water reaches the Mediterranean through the Rhône | Narran: a lake that fills only in wet years |
|---|---|
| ![Geneva flow path](docs/img/flow-geneva.png) | ![Narran water record](docs/img/water-narran.png) |

| The whole Earth | On a phone |
|---|---|
| ![Globe](docs/img/globe.png) | <img src="docs/img/phone.png" alt="Titicaca on a phone" width="260"> |

## Why

Lake depth drives estimates of the world's fresh water, lake heat and ice, methane and carbon, and lake models inside
weather forecasts. The global datasets (HydroLAKES, GLOBathy, GLRDAV) estimate it for every lake, but none of them, and
no viewer, shows which depths were actually measured. GLOBathy, GLRDAV/Global Waterbody Calculator and 3D-LAKES are
data and code; the Global Surface Water Explorer shows water extent, not depth.

## Data

| Data | Source | Licence |
|---|---|---|
| Lake outlines, area, volume and depth, volume source | [HydroLAKES v1.0](https://www.hydrosheds.org/products/hydrolakes), Messager et al. (2016) | CC BY 4.0 |
| Water-level band seen by ICESat-2 and Landsat (L1) | [3D-LAKES](https://doi.org/10.5281/zenodo.13107867), Huang et al. (2025) Scientific Data | CC BY 4.0 |
| Names (125,597 lakes) and published depths (7,616 lakes) | [Wikidata](https://www.wikidata.org) via [QLever](https://qlever.dev), matched when the item's point is inside the lake | CC0 |
| Rivers, flow at least 5 m³/s; downstream paths | [HydroRIVERS v1.0](https://www.hydrosheds.org/products/hydrorivers), Lehner and Grill (2013) | CC BY 4.0 |
| Water volume by month since 1984 (22,367 lakes) | [GloLakes v1.1](https://doi.org/10.25914/K8ZF-6G46), Hou et al. (2024) Earth System Science Data 16, 201 | CC BY 4.0 |
| Names of seas where rivers end | [Natural Earth](https://www.naturalearthdata.com) 1:10m marine areas | public domain |
| Background | NASA Blue Marble through GIBS | public domain |

## How it is built

The pipeline runs on a Linux server (`pipeline/`): `build_lakes.py` joins HydroLAKES, 3D-LAKES and Wikidata and writes
`out/stats.json`; `export_rivers.py` filters HydroRIVERS; `build_tiles.sh` makes vector tiles with
[tippecanoe](https://github.com/felt/tippecanoe) (lakes, labels, rivers; 617 MB of PMTiles); `split_pmtiles.mjs` cuts
them into 294 pieces of 2 MiB for a static host without range requests; `build_search.py` writes the name index.
The tile pieces are published as their own static site and read with `src/chunked.ts`.

`build_flow.py` adds the river paths and water records. A lake joins HydroRIVERS at the reach nearest to its HydroLAKES
pour point (within about 2 km); its path follows `NEXT_DOWN` to the outlet and is simplified to about 2 km, and its
length is the reach's `DIST_DN_KM`. A coastal outlet is named after the nearest Natural Earth marine area if one lies
within 2.5 degrees (big estuaries such as the Yenisey's end more than a degree short of the gulf polygon); farther
away, the outlet is not treated as a river mouth. GloLakes months are reduced to yearly medians (years with at least
three months of data; lakes with at least five such years). Both are written as 128 JSON files per kind, so a
lake's panel loads at most one 640 kB file per question (about 150 kB compressed).

Wikidata coordinates arrive as `POINT(lon lat)` for Earth; points on other bodies (Mars has lakes on Wikidata) carry a
globe prefix and are skipped. Depths are read with their unit normalised to metres, and "mean" and "maximum" are told
apart from the "criterion used" qualifier where it is given.

## Honest limits

- A Wikidata depth can be wrong (Titicaca is recorded as 489 m without saying mean or maximum; the literature gives
  about 280 m at the deepest) or can belong to a nearby water body. Each lake links to its item so it can be checked.
- 3D-LAKES "seen" means the shape of the top of the bed over the range the water level moved; the full depth is still
  extrapolated.
- HydroLAKES outlines date from around 2000 (the Aral Sea is drawn larger than today).
- River paths follow the river network, not the real hydrology of every lake: a terminal lake next to a river (the
  Narran Lakes, say) is drawn as draining into it, and 31,180 of the 264,517 lakes considered are more than about 2 km
  from any mapped river and get no path.
- GloLakes leaves out the largest lakes (the Caspian, the Great Lakes, Baikal and others), so they have no water
  record here. Its volumes come mostly from the lake's extent in Landsat images; the year-to-year ups and downs are
  more reliable than the absolute amount.

## Development

```sh
npm install
python3 scripts/tiles_server.py ../lakes-atlas-tiles 5401 & # the tile pieces with CORS (any static server will do)
VITE_TILES=http://127.0.0.1:5401/ npx vite --port 5499
npm test                                                     # depth evidence wording, consistency check, search, flow and water wording
```

Code: MIT. Part of [Bristlecone Lab](https://bristleconelab.org).
