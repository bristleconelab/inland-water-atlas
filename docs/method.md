# Method

How each number in the atlas is made. The code is in `pipeline/` (run on a Linux server, in this order:
`build_lakes.py`, `build_flow.py`, `build_rivers.py`, `build_search.py`, `build_search_rivers.py`, `build_shape.py`,
`build_basins.py`, `build_levels.py`, `build_tiles.sh`, `split_pmtiles.mjs`) and in `src/` (computed in the browser).
What was checked and how is in [validation.md](validation.md).

## Lakes and the evidence for their depth (`build_lakes.py`)

- Lakes: HydroLAKES v1.0, all 1,427,688 lakes of at least 10 ha.
- **Depth published** (tier 3): HydroLAKES took the volume from the literature (`Vol_src` 1) or from the GRanD dam
  register (`Vol_src` 2), or Wikidata gives a depth (P4511) for the item whose point lies inside the lake. Deprecated
  statements are dropped; if an item has a preferred statement, only preferred ones count; several values of one kind
  (mean, maximum, not given, from the "criterion used" qualifier P1013) give their median. `wr` records whether every
  depth statement cites a source (prov:wasDerivedFrom).
- **Seen from space** (tier 2): 3D-LAKES L1 has at least two observed levels; the band is max - min of the observed
  elevations.
- **Model only** (tier 1): neither.
- Consistency check (`src/lake.ts`): a published single depth below the mean depth implied by a published volume, or
  more than 4 times it, is flagged (most lakes have a maximum 1.5 to 4 times their mean; volume development 0.75 to 2).

## Where water goes (`build_flow.py`, `seas.py`)

A lake joins HydroRIVERS at the reach nearest to its pour point within 0.02 degrees; its path follows `NEXT_DOWN` to
the outlet and is simplified to 0.02 degrees; its length is `DIST_DN_KM`. Inland outlets (`ENDORHEIC`) are named
after the largest HydroLAKES lake within 0.05 degrees of the outlet. Coastal outlets: an outlet within 2.5 degrees of a
Natural Earth 1:10m marine area is a river mouth; if that area is itself a river mouth or estuary (name with River, Rio,
Canal, Boca, Estuary or Delta, or class "river"), the name is that of the real sea nearest to the area (within 8
degrees), the one it opens into.

## Water over time (`build_flow.py`, `src/v2.ts`, `src/trend.ts`)

GloLakes v1.1 monthly storage (million m³): negative values dropped; the incomplete last year dropped; for each lake,
the mean of each calendar month; yearly value = median of (month - its calendar mean) over the year + the lake's
median, for years with at least 3 months, clipped at zero; lakes with at least 5 such years.

- Summary sentence: medians of the first and the last five years with a value; "comes and goes" when the coefficient
  of variation exceeds 0.6 and |Spearman rho| (year, value) is below 0.5; "almost empty / almost no water left" when
  one end is below 5 % of the peak.
- Trend (10 years or more, not for "comes and goes"): Theil-Sen slope (median of pairwise slopes) with the 95 %
  interval from the ordered slopes at (N' -+ C)/2, C = 1.96 sqrt(Var S) (Sen 1968; Gilbert 1987); Mann-Kendall S with
  the variance corrected for ties and for autocorrelation (Hamed and Rao 1998: lags of the ranks of the detrended
  series with |rho_k| > 1.96 / sqrt(n), factor floored at 1); two-sided normal p with continuity correction. The slope
  is stated as a share of the lake's median volume a decade.

## Water level of the largest lakes (`build_levels.py`, `src/levels.ts`)

NASA GSFC Global Water Monitor (G-REALM) 10-day product: passes with a height variation flagged missing (999.99) or
an error of 99.999 are dropped; yearly median of the height variation for years with at least 3 passes, the
incomplete last year dropped; series of at least 5 years. A target is matched to the HydroLAKES lake holding its
mid-point (else the nearest within 0.05 degrees); of several targets in one lake, the one with the most passes. Trend
as above, in centimetres a decade.

## Lake-bed shape and the model's error (`build_shape.py`, `src/shape.ts`)

GLOBathy gives, for every lake, A = a h^b (km², h in m above the bottom) up to its maximum depth; the chart plots area
against depth below the surface. 3D-LAKES L1 levels (at least 3) are drawn as points: depth below the highest level
seen, at most 12 evenly spaced. Model error: GLOBathy's maximum depth over a Wikidata maximum depth (criterion
"maximum"); lakes where the two are equal within 0.5 m are listed but left out (GLOBathy uses the published value).

## Catchments (`build_basins.py`)

HydroBASINS v1c level 8: the unit holding a lake's pour point (or a river's outlet, nearest within 0.05 degrees) and
all units upstream through `NEXT_DOWN`, merged (coverage union, else a union snapped to 0.001 degrees) and simplified
to 0.02 degrees, exterior rings only. The area shown is HydroLAKES `Wshd_area` or HydroRIVERS `UPLAND_SKM`; "lakes in
it" counts HydroLAKES pour points in the units.

## Rivers (`build_rivers.py`)

See the README ("How it is built"): SWORD v17c names matched onto HydroRIVERS reaches (three points per reach, within
0.015 degrees, drainage area within a factor of 3), name keys, joining of spellings (co-occurrence, near-identical
neighbours, Wikidata labels), smoothing at confluences, gap filling, main-stem rejoining, headwater extension from the
farthest top, and the Wikidata item scored by articles and distance. Lengths are measured along HydroRIVERS; flows are
WaterGAP 1971-2000 means in HydroRIVERS.

## SWOT water level at a point (`src/river.ts`)

PO.DAAC Hydrocron, SWOT L2 HR River Single Pass, for the SWORD reach SWOT has measured most often near the clicked
HydroRIVERS reach: passes with `reach_q` above 1, `ice_clim_f` 2, or `wse_u` above 1 m are dropped, and so are heights
more than max(10 MAD, 10 m) from the median. Heights are above the EGM2008 geoid.

## Limits

- A Wikidata depth can be wrong (Titicaca is recorded as 489 m without saying mean or maximum; the literature gives
  about 280 m at the deepest; the panel now flags it) or can belong to a nearby water body. Each lake links to its item
  so it can be checked.
- 3D-LAKES "seen" means the shape of the top of the bed over the range the water level moved; the full depth is still
  extrapolated.
- HydroLAKES outlines date from around 2000 (the Aral Sea is drawn larger than today).
- River paths follow the river network, not the real hydrology of every lake: a terminal lake next to a river (the
  Narran Lakes, say) is drawn as draining into it, and 31,180 of the 264,517 lakes considered are more than about 2 km
  from any mapped river and get no path.
- River names come from OpenStreetMap through SWORD and only for rivers about 30 m wide or more. Some rivers are still
  split or mislabelled (a stretch of the Amazon carries the name of a tributary, Arapiuns), and delta branches are
  named as rivers of their own (the Danube "flows into" the Kiliia branch).
- River lengths are measured along HydroRIVERS from the farthest source the network reaches; they differ from textbook
  lengths, which follow other conventions. River flows are modelled long-term averages (WaterGAP, 1971–2000), not gauge
  readings, and they do not take out what dams and irrigation use: far less reaches the Aral Sea through the Amu Darya
  than the panel's number.
- SWOT water levels are heights above the EGM2008 geoid from single passes. Passes with quality flag 2 or worse, over
  ice, or with an uncertainty over 1 m are dropped, and so are heights both more than 10 median absolute deviations and
  more than 10 m from the rest (a bank or a bridge); real floods of several metres stay in. Some noise remains. SWORD's
  own per-stretch level range is not shown: it includes poor passes (6.7 m for the Rhône, against 0.5 m in the
  filtered passes at Avignon).
- Catchment outlines are made of HydroBASINS level-8 units, a few hundred km² each, so they are rough near the outlet,
  and a big lake with several inflows shows the catchment of the unit at its outlet only (the Caspian's outline is the
  Volga's; its area, 1.4 million km², is HydroLAKES' own and complete).
- GLOBathy is itself a model; for 44 lakes it uses a published maximum depth, and those are left out of the model
  error figures.
- GloLakes leaves out the largest lakes (the Caspian, the Great Lakes, Baikal and others), so they have no water
  record here. Its volumes come mostly from the lake's extent in Landsat images; the year-to-year ups and downs are
  more reliable than the absolute amount.

## Running it locally

```sh
npm install
python3 scripts/tiles_server.py ../lakes-atlas-tiles 5401 & # the tile pieces with CORS (any static server will do)
VITE_TILES=http://127.0.0.1:5401/ npx vite --port 5499
npm test                                                     # depth evidence and checks, search, flow, water and river wording, SWOT filtering
```

The pipeline runs on a Linux server from the project data folder; each `pipeline/*.py` says how to run it in its docstring.
