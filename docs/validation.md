# Validation

What was checked, against what, and what came out. Figures are from the build of 2026-11-26 (tiles
`lakes-atlas-v5`, records version 2026-11-26c).

## River lengths against Wikidata

The atlas measures a river along HydroRIVERS from its farthest source to its end, or, when the river is called
something else upstream, from where its name starts. Wikidata's length (P2043, the value of normal or preferred
rank) follows whatever convention its source used. Read the differences with that in mind.

| River | Atlas (km) | Starts at | Wikidata P2043 (km) | Atlas / Wikidata |
|---|---:|---|---:|---:|
| Volga | 3,539 | its source | 3,530 | 1.00 |
| Rhône | 795 | its source | 812 | 0.98 |
| Danube | 2,776 | its source | 2,850 | 0.97 |
| Amur | 2,816 | Argun River (upstream name) | 2,824 | 1.00 |
| Missouri | 3,756 | its source | 3,726 | 1.01 |
| Mississippi | 3,642 | its source | 3,766 | 0.97 |
| Niger | 4,051 | its source | 4,180 | 0.97 |
| Ob | 3,911 | its source | 3,650 | 1.07 |
| Lena | 4,531 | its source | 4,294 | 1.06 |
| Yenisei | 2,726 | below the Sayan (upper stretches named otherwise) | 3,487 | 0.78 |
| Irtysh | 3,696 | Alakebieke River (upstream name) | 4,248 | 0.87 |
| Syr Darya | 2,018 | Naryn River (upstream name) | 2,212 | 0.91 |
| Amu Darya | 1,233 | Panj River (upstream name) | 2,620 | 0.47 |
| Mekong | 2,596 | Lancang River (upstream name) | 4,350 | 0.60 |
| Yangtze | 2,580 | Nanguang River (upstream name) | 6,300 | 0.41 |
| Nile | 2,955 | White Nile (upstream name) | 6,650 (preferred) | 0.44 |

Where the atlas river runs to its source, it is within 7 % of Wikidata. The large gaps are all rivers whose upper
course has another name in OpenStreetMap, which the atlas keeps (the panel says "Above that it is called …"):
Wikidata's figures for these rivers most likely include the upper course (2,620 km for the Amu Darya is about the
length with the Panj, 6,650 km for the Nile the length from the Kagera).

## GLOBathy's maximum depth against published maxima

Lakes whose maximum depth is on Wikidata with the criterion "maximum" (not a mean, not an unspecified depth):
970. For 44 of them GLOBathy's maximum equals the published one within 0.5 m, because GLOBathy uses that value; they
are no test and are left out. For the other 926:

| Lakes | n | Median model / published | Within a factor of 2 |
|---|---:|---:|---:|
| all | 926 | 1.10 | 59 % |
| under 1 km² | 348 | 1.38 | 49 % |
| 1 to 10 km² | 473 | 0.95 | 69 % |
| 10 to 100 km² | 67 | 0.77 | 48 % |
| 100 km² and more | 38 | 1.37 | 50 % |

Within a quarter of the published value: 20 %. The Wikidata values are themselves not all right (Titicaca's 489 m,
against about 281 m in the literature, is in this set; the panel flags it), so the spread is an upper bound on the
model's error, not a measurement of it.

## Trend statistics against scipy

`src/trend.ts` was checked against scipy (`theilslopes`, `kendalltau`) on a 15-year series
(`test/trend.test.ts`): slope -0.18333, 95 % interval -0.21111 to -0.13636, Kendall's tau -0.7714, all equal to four
decimals. The Hamed and Rao correction only ever widens the variance (it is floored at the plain test), so the
corrected p-values are equal to or larger than the plain ones.

## GloLakes yearly values

- Requiring 6 months a year kept 5,354 of 20,906 lakes; taking monthly anomalies from each lake's calendar-month mean
  keeps all 20,906 (20,807 after the incomplete year 2026 is dropped). Across all lake-years, the plain median of the
  months seen differs from the deseasonalised value by 1.1 % of the lake's level on the median, 7.2 % at the 90th
  percentile: the seasonal bias the method removes.
- Negative storage values: one lake (Hylak 14355, down to -16.9 million m³); dropped.

## Water level of the largest lakes (radar altimetry)

457 HydroLAKES lakes have a NASA GSFC Global Water Monitor record of at least 5 years. Net change of the yearly
median, 1992 to 2025: Caspian Sea -2.06 m, Baikal -0.42 m, Huron -0.22 m, Michigan -0.22 m, Superior -0.16 m,
Victoria +1.24 m, Balkhash +0.90 m. Each is the change over one satellite stretch of the lake against its reference
level, not a lake-wide mean.

## Where water ends

- Before the fix of 2026-11-26, 35,336 lake outlets were named after Natural Earth areas that are river mouths
  ("Saint Lawrence River" 29,478, "Amazon River" 3,304). After it: 0 lakes and 0 rivers end in an area whose name
  contains River, Rio, Canal, Boca, Estuary or Delta.
- Checked by hand: Quebec on the Saint Lawrence -> Gulf of Saint Lawrence; Amazon mouth -> South Atlantic Ocean;
  Orinoco -> North Atlantic Ocean; Rhône -> Golfe du Lion; Yenisei -> Yenisey Gulf; Columbia -> North Pacific Ocean;
  Lake Chany (a closed basin) -> none. The Great Lakes reach the Gulf of Saint Lawrence (the nearest sea to the
  outlet point, the Gulf of Maine, is not where the water goes).

## Reproducibility

`build_rivers.py` was run twice on the same inputs; `rivers.geojsonl`, `river_names.geojsonl` and all 128 river
record files were byte-identical. (Before, 571 river names changed between runs, because Wikidata candidates with
equal article counts were taken from an unordered set of strings.)

## SWOT water levels

At the Rhône stretch near Avignon (SWORD reach 21602100081) the filtered passes from July 2023 to November 2026 (199)
move over 0.52 m between their 10th and 90th percentiles. SWORD's own per-stretch level range for the Rhône's
stretches has a median of 6.7 m; it includes passes of poor quality, and is therefore not shown. The filter keeps a
synthetic 4 m flood on a still river (MAD 0.05 m) and drops a 21 m bridge echo (`test/river.test.ts`).

## Basins with no outlet

The first build of the "no way to the sea" view (HydroBASINS `ENDO` only) left out the Caspian: HydroSHEDS maps it
as ocean. `pipeline/test_outputs.py` checks that the Caspian, Titicaca, Issyk-Kul, Balkhash and the Great Salt Lake are
in the list and Baikal and Ladoga are not; adding the 217 main basins whose outlet touches the Caspian raised the count
from 38,698 to 48,818 lakes.

## River profiles

All 6,931 profiles end within 10 % of their river's length (the first build climbed past where a river's name starts:
the Amu Darya's ran up the Panj to 2,332 km against its 1,233). Start and end heights: Amu Darya 315 m at the
Panj-Vakhsh confluence to 73 m, Volga 238 m to -29 m (the Caspian is below sea level), Syr Darya 396 m to 40 m.
Degree of regulation at the end: Syr Darya 312 %, Nile 281 %, Volga 77 %, Amu Darya 27 %, Danube 10 %.

## Shares of what is published

Lakes with a published depth or volume are 1.0 % of all lakes, 57.8 % of the lake area and 94.6 % of the water
volume in HydroLAKES (91.0 % without the Caspian).

## Data-quality checks

`pipeline/test_outputs.py` (17 checks) runs on the published shards before the tile site is deployed: no negative or
part-year water, no lake or river ending in a "sea" named like a river, the lengths of nine big rivers within 10 % of
the table above, trend and water records aligned, physical ranges for the lake numbers and profiles, the stats adding
up, the search indexes aligned.
