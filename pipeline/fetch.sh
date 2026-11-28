#!/bin/bash
# Raw inputs of the pipeline, into raw/ of the project data folder (about 12 GB; run it on a machine with disk and a
# good connection). Every source is open: see LICENSES.md. Re-running resumes partial downloads.
set -euo pipefail
mkdir -p raw && cd raw
get() { echo "$(date -Is) start $2"; mkdir -p "$(dirname "$2")"; curl -sS -L --retry 5 --retry-delay 10 -C - -o "$2" "$1"; echo "$(date -Is) done $2 $(stat -c %s "$2" 2>/dev/null || stat -f %z "$2") bytes"; }

# lakes: HydroLAKES v1.0 and 3D-LAKES (Zenodo 13107867)
get https://data.hydrosheds.org/file/hydrolakes/HydroLAKES_polys_v10_shp.zip HydroLAKES_polys_v10_shp.zip
get https://zenodo.org/api/records/13107867/files/3D-LAKES-ST.csv/content 3D-LAKES-ST.csv
get https://zenodo.org/api/records/13107867/files/QA_fag.csv/content 3D-LAKES-QA_fag.csv
get "https://zenodo.org/api/records/13107867/files/L1%20A-E%20product.json/content" 3D-LAKES-L1.json
# lake beds: GLOBathy (figshare 13402070 and 13402124)
get https://ndownloader.figshare.com/files/28917783 globathy/hAV.nc
get https://ndownloader.figshare.com/files/28919991 globathy/basic.zip
# rivers: HydroRIVERS v1.0, RiverATLAS v1.0 (figshare 9890531), SWORD v17c (Zenodo 23870877)
get https://data.hydrosheds.org/file/HydroRIVERS/HydroRIVERS_v10_shp.zip HydroRIVERS_v10_shp.zip
get https://ndownloader.figshare.com/files/20087321 hydroatlas/RiverATLAS_Data_v10.gdb.zip
get https://zenodo.org/api/records/23870877/files/SWORD_v17c_parquet.zip/content sword/SWORD_v17c_parquet.zip
# catchments: HydroBASINS v1c level 8, every region
for r in af ar as au eu gr na sa si; do
  get "https://data.hydrosheds.org/file/hydrobasins/standard/hybas_${r}_lev08_v1c.zip" "hybas/hybas_${r}_lev08.zip"
done
# water level of the largest lakes: NASA GSFC Global Water Monitor (G-REALM), 10-day series
get https://earth.gsfc.nasa.gov/gwm/zip/lake.10.tar.gz gwm/lake.10.tar.gz
echo "$(date -Is) ALL DONE"
echo "Not fetched here: GloLakes v1.1 (doi:10.25914/K8ZF-6G46): put the two Global_Lake_Absolute_Storage_*.nc files from"
echo "the NCI catalogue that DOI leads to in raw/glolakes/. Natural Earth marine polygons are fetched by pipeline/seas.py."
echo "Unpack: HydroLAKES, HydroRIVERS and RiverATLAS zips in place, SWORD into sword/parquet/, gwm tarball into gwm/ts/."
