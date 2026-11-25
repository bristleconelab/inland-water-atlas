#!/bin/bash
# Vector tiles for the atlas: lakes (polygons), lake labels (points) and rivers -> out/lakes-atlas.pmtiles
#   lakes   id, tier (3 published / 2 seen by satellite / 1 modelled), a (area km2); smallest lakes dropped first when a
#           tile is too full, so big lakes show from zoom 0 and every lake by zoom 10
#   labels  id, name, a, tier for named lakes
#   rivers  id, o (ORD_FLOW 1 = largest), q (m3/s); big rivers from zoom 0, smaller ones as you zoom in
set -euo pipefail
# run from the data folder that holds raw/, out/ and tools/tippecanoe (a tippecanoe checkout, built with make)
cd "${LAKES_DATA:-.}"
T=${TIPPECANOE:-tools/tippecanoe}
mkdir -p out/tmp
$T/tippecanoe -o out/tmp/lakes.pmtiles --force -P -l lakes -Z0 -z10 \
  --drop-smallest-as-needed --extend-zooms-if-still-dropping --simplification=6 --no-tile-stats \
  out/lakes_polys.geojsonl
$T/tippecanoe -o out/tmp/labels.pmtiles --force -l labels -Z2 -z10 -r1 --no-tile-stats \
  -j '{"labels": ["any", [">=", "a", 1000], ["all", [">=", "$zoom", 4], [">=", "a", 50]], ["all", [">=", "$zoom", 6], [">=", "a", 5]], [">=", "$zoom", 8]]}' \
  out/lakes_points.geojsonl
$T/tippecanoe -o out/tmp/rivers.pmtiles --force -P -l rivers -Z0 -z10 --drop-densest-as-needed --simplification=8 --no-tile-stats \
  -j '{"rivers": ["any", ["<=", "o", 3], ["all", [">=", "$zoom", 3], ["<=", "o", 4]], ["all", [">=", "$zoom", 5], ["<=", "o", 5]], [">=", "$zoom", 7]]}' \
  out/rivers.geojsonl
$T/tile-join -o out/lakes-atlas.pmtiles --force --no-tile-size-limit out/tmp/lakes.pmtiles out/tmp/labels.pmtiles out/tmp/rivers.pmtiles
ls -la out/lakes-atlas.pmtiles
