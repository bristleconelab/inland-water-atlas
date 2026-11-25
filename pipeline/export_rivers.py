"""HydroRIVERS v1.0 (Lehner & Grill 2013, CC BY 4.0) -> out/rivers.geojsonl for the tiles.

Keeps reaches with a long-term discharge of at least MIN_Q m3/s (about 400,000 of 8.5 million reaches), with
ORD_FLOW (1 = largest rivers, 10 = smallest). Which rivers show at which zoom is decided in build_tiles.sh.

usage (on the processing server, from the project data folder): uv run --with geopandas --with pyogrio python pipeline/export_rivers.py
"""
from pathlib import Path

import geopandas as gpd

MIN_Q = 5.0  # m3/s
src = Path("raw/HydroRIVERS_v10_shp/HydroRIVERS_v10.shp")
r = gpd.read_file(src, engine="pyogrio", columns=["HYRIV_ID", "NEXT_DOWN", "ORD_FLOW", "DIS_AV_CMS", "LENGTH_KM"],
                  where=f"DIS_AV_CMS >= {MIN_Q}")
r = r.rename(columns={"HYRIV_ID": "id", "ORD_FLOW": "o", "DIS_AV_CMS": "q"})[["id", "o", "q", "geometry"]]
r["q"] = r["q"].round(1)
Path("out").mkdir(exist_ok=True)
r.to_file("out/rivers.geojsonl", driver="GeoJSONSeq", engine="pyogrio")
print(f"{len(r):,} river reaches with Q >= {MIN_Q} m3/s -> out/rivers.geojsonl")
