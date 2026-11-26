"""Where a lake's or river's water comes from: its upstream catchment, drawn from HydroBASINS level 8.

HydroBASINS v1c (Lehner and Grill 2013, CC BY 4.0) cuts the land into nested sub-basins that know the one downstream
of them (NEXT_DOWN). For each lake of at least MIN_LAKE_KM2 and each named river (build_rivers.py), the level-8 unit
holding its outlet and every unit upstream of it are merged into one outline, simplified to about 2 km. Level-8 units
are a few hundred km2, so the outline is approximate near the outlet; the area given in the panel is the exact one
(HydroLAKES Wshd_area for lakes, HydroRIVERS UPLAND_SKM for rivers). "lakes" counts the HydroLAKES lakes (10 ha and
more) whose outlet lies in the outline.

Outputs (out/v2/basin/NNN.json, 128 shards by id % 128): {"L<Hylak_id>" | "R<river id>": {"a": km2, "lakes": n, "g": rings}}
rings: lists of 0.01-degree steps, first point absolute (as the river paths).

usage (on the processing server, from the project data folder, after build_lakes.py and build_rivers.py):
  uv run --with geopandas --with pyogrio --with pyarrow python pipeline/build_basins.py
"""
from __future__ import annotations

import glob
import json
import multiprocessing as mp
import time
from collections import defaultdict
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
import shapely

RAW, OUT = Path("raw"), Path("out")
SHARDS = 128
MIN_LAKE_KM2 = 10.0

GEOM: np.ndarray
KIDS: dict[int, list[int]]


def upstream(i: int) -> list[int]:
    out, stack = [], [i]
    while stack:
        j = stack.pop()
        out.append(j)
        stack.extend(KIDS.get(j, ()))
    return out


def encode_rings(g) -> list[list[int]]:
    rings = []
    for poly in getattr(g, "geoms", [g]):
        if poly.is_empty:
            continue
        for ring in [poly.exterior]:  # holes are left out: an outline is enough to show where the water comes from
            q = np.round(np.asarray(ring.coords) * 100).astype(int)
            keep = np.r_[True, np.any(np.diff(q, axis=0) != 0, axis=1)]
            q = q[keep]
            if len(q) >= 4:
                rings.append(np.vstack([q[:1], np.diff(q, axis=0)]).ravel().tolist())
    return rings


def outline(i: int) -> tuple[int, list[list[int]]]:
    ids = upstream(i)
    if len(ids) == 1:
        g = GEOM[i]
    else:
        try:  # fast when the units share their edges exactly
            g = shapely.coverage_union_all(GEOM[ids])
        except shapely.errors.GEOSException:  # some HydroBASINS edges are not noded alike: snap to ~100 m and union
            g = shapely.union_all(GEOM[ids], grid_size=0.001)
    g = shapely.simplify(g, 0.02, preserve_topology=True)
    return i, encode_rings(g)


def main() -> None:
    global GEOM, KIDS
    t0 = time.time()
    log = lambda m: print(f"{m} ({time.time() - t0:.0f} s)", flush=True)
    parts = [gpd.read_file(f"zip://{z}", engine="pyogrio", columns=["HYBAS_ID", "NEXT_DOWN"]) for z in sorted(glob.glob(str(RAW / "hybas/hybas_*_lev08.zip")))]
    hb = gpd.GeoDataFrame(pd.concat(parts, ignore_index=True), crs="EPSG:4326")
    hb["geometry"] = shapely.make_valid(hb.geometry.values)
    row = {int(h): i for i, h in enumerate(hb["HYBAS_ID"])}
    KIDS = defaultdict(list)
    for i, nd in enumerate(hb["NEXT_DOWN"].to_numpy()):
        if nd and int(nd) in row:
            KIDS[row[int(nd)]].append(i)
    GEOM = hb.geometry.values
    log(f"HydroBASINS level 8: {len(hb):,} units")

    lk = gpd.read_file(RAW / "HydroLAKES_polys_v10_shp/HydroLAKES_polys_v10.shp", engine="pyogrio",
                       columns=["Hylak_id", "Lake_area", "Wshd_area", "Pour_long", "Pour_lat"], read_geometry=False)
    pts = gpd.GeoDataFrame(lk, geometry=gpd.points_from_xy(lk.Pour_long, lk.Pour_lat), crs="EPSG:4326")
    j = gpd.sjoin(pts, hb[["geometry"]], predicate="within", how="left")
    j = j[~j.index.duplicated()]
    lk["unit"] = j["index_right"]
    lakes_in = lk.groupby("unit").size()
    log(f"lake outlets placed in units: {lk['unit'].notna().sum():,} of {len(lk):,}")

    targets: dict[str, tuple[int, float]] = {}
    for r in lk[(lk.Lake_area >= MIN_LAKE_KM2) & lk.unit.notna()].itertuples():
        targets[f"L{int(r.Hylak_id)}"] = (int(r.unit), float(r.Wshd_area))
    rec: dict[str, dict] = {}
    for f in (OUT / "v2/river").glob("*.json"):
        rec.update(json.loads(f.read_text()))
    # a river's outlet: the first point of its way on (its last reach's end), else the end of its longest line
    mouths = []
    for rid, v in rec.items():
        if v.get("p"):
            x, y = v["p"][0] / 100, v["p"][1] / 100
        else:
            part = max(v["g"], key=len)
            xy = np.cumsum(np.asarray(part).reshape(-1, 2), axis=0) / 100
            x, y = xy[-1] if len(xy) else (np.nan, np.nan)
        mouths.append((rid, x, y, v["up"]))
    mo = pd.DataFrame(mouths, columns=["rid", "x", "y", "up"]).dropna()
    mg = gpd.GeoDataFrame(mo, geometry=gpd.points_from_xy(mo.x, mo.y), crs="EPSG:4326")
    mj = gpd.sjoin_nearest(mg, hb[["geometry"]], how="left", max_distance=0.05)
    mj = mj[~mj.index.duplicated()].dropna(subset=["index_right"])
    for r in mj.itertuples():
        targets[f"R{r.rid}"] = (int(r.index_right), float(r.up))
    log(f"targets: {sum(k[0] == 'L' for k in targets):,} lakes, {sum(k[0] == 'R' for k in targets):,} rivers")

    units = sorted({u for u, _ in targets.values()})
    with mp.get_context("fork").Pool(16) as pool:
        shapes = dict(pool.imap_unordered(outline, units, chunksize=20))
    log(f"outlines: {len(shapes):,}")
    lake_count = {u: int(sum(lakes_in.get(k, 0) for k in upstream(u))) for u in units}

    shards: dict[int, dict] = defaultdict(dict)
    for key, (u, area) in targets.items():
        if not shapes.get(u):
            continue
        shards[int(key[1:]) % SHARDS][key] = {"a": round(area), "lakes": lake_count[u], "g": shapes[u]}
    d = OUT / "v2/basin"
    d.mkdir(parents=True, exist_ok=True)
    for s in range(SHARDS):
        (d / f"{s:03d}.json").write_text(json.dumps(shards.get(s, {}), separators=(",", ":"), allow_nan=False))
    size = sum(f.stat().st_size for f in d.glob("*.json"))
    log(f"basins: {sum(len(x) for x in shards.values()):,} written, {size / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
