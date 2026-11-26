#!/bin/bash
# Vector tiles for the atlas: lakes (polygons), lake labels (points) and rivers -> out/lakes-atlas.pmtiles
#   lakes   id, tier (3 published / 2 seen by satellite / 1 modelled), a (area km2); smallest lakes dropped first when a
#           tile is too full, so big lakes show from zoom 0 and every lake by zoom 10
#   labels  id, name, a, tier for named lakes
#   rivernames  r, n, o: one line per named river, for labels
#   rivers  id, o (ORD_FLOW 1 = largest), q (m3/s), n name, r river id or d the named river downstream, s SWORD reach
#           (from build_rivers.py); big rivers from zoom 0, smaller ones as you zoom in
# ONLY_RIVERS=1 rebuilds the river layer and reuses the lake layers in out/tmp. The archive name carries a version
# (NAME), because the tile site caches pieces for a week: new pieces must never replace old ones under the same name.
set -euo pipefail
# run from the data folder that holds raw/, out/ and tools/tippecanoe (a tippecanoe checkout, built with make)
cd "${LAKES_DATA:-.}"
T=${TIPPECANOE:-tools/tippecanoe}
NAME=${NAME:-lakes-atlas-v4}
mkdir -p out/tmp
if [ -z "${ONLY_RIVERS:-}" ]; then
$T/tippecanoe -o out/tmp/lakes.pmtiles --force -P -l lakes -Z0 -z10 \
  --drop-smallest-as-needed --extend-zooms-if-still-dropping --simplification=6 --no-tile-stats \
  out/lakes_polys.geojsonl
$T/tippecanoe -o out/tmp/labels.pmtiles --force -l labels -Z2 -z10 -r1 --no-tile-stats \
  -j '{"labels": ["any", [">=", "a", 1000], ["all", [">=", "$zoom", 4], [">=", "a", 50]], ["all", [">=", "$zoom", 6], [">=", "a", 5]], [">=", "$zoom", 8]]}' \
  out/lakes_points.geojsonl
fi
$T/tippecanoe -o out/tmp/rivers.pmtiles --force -P -l rivers -Z0 -z10 --drop-densest-as-needed --simplification=8 --no-tile-stats \
  -j '{"rivers": ["any", ["<=", "o", 3], ["all", [">=", "$zoom", 3], ["<=", "o", 4]], ["all", [">=", "$zoom", 5], ["<=", "o", 5]], [">=", "$zoom", 7]]}' \
  out/rivers.geojsonl
# river names: one merged line per river (build_rivers.py), so a label has room along it
$T/tippecanoe -o out/tmp/rivernames.pmtiles --force -l rivernames -Z2 -z10 --drop-densest-as-needed --simplification=10 --no-tile-stats \
  -j '{"rivernames": ["any", ["<=", "o", 2], ["all", [">=", "$zoom", 4], ["<=", "o", 4]], ["all", [">=", "$zoom", 6], ["<=", "o", 5]], [">=", "$zoom", 7]]}' \
  out/river_names.geojsonl
$T/tile-join -o out/$NAME.pmtiles --force --no-tile-size-limit out/tmp/lakes.pmtiles out/tmp/labels.pmtiles out/tmp/rivers.pmtiles out/tmp/rivernames.pmtiles
ls -la out/$NAME.pmtiles
