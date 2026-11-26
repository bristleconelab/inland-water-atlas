"""Lake Atlas v2 data: where each lake's water goes, and how its water changed since 1984.

Downstream ("where does its water go?")
  HydroRIVERS v1.0 (CC BY 4.0) gives every river reach its next reach downstream (NEXT_DOWN), its distance to the
  outlet (DIST_DN_KM), the outlet reach of its river system (MAIN_RIV) and whether that system ends inland (ENDORHEIC).
  A lake joins the network at the reach nearest to its HydroLAKES pour point. Its path is the chain of reach ends down to
  the outlet, simplified to about 2 km. Inland outlets are named after the HydroLAKES lake they end in; coastal outlets
  after the nearest Natural Earth sea (public domain; pipeline/seas.py leaves out areas named after a river mouth).
  Done for lakes of at least 1 km2, every named lake, and every GloLakes lake.

Water over time ("how has its water changed?")
  GloLakes v1.1 (Hou et al., ESSD 2024, CC BY 4.0): monthly storage in million m3, 1984 to present, for 22,367 lakes,
  mostly computed from the lake extent seen in Landsat images. Kept as one value a year, without the seasons: each
  month minus that lake's mean for the calendar month, the median of those for the year, plus the lake's median.
  A plain median of whatever months were cloud-free makes a summer-only year look fuller or emptier than it was (1 %
  of the lake's level typically, 7 % or more for one lake in ten); requiring 6 months instead would keep only 5,354
  of 20,906 lakes. Years need MIN_MONTHS months; negative storage values are dropped, and so is the last year when the
  record ends before December (GloLakes v1.1 ends 2026-11: a part year is not a year).

Outputs (out/v2/): flow/NN.json and water/NN.json, 128 shards by Hylak_id % 128, plus meta.json.
usage (on the processing server, from the project data folder):
  uv run --with geopandas --with pyogrio --with pyarrow --with xarray --with netcdf4 python pipeline/build_flow.py
"""
from __future__ import annotations

import json
import time
import multiprocessing as mp
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
import shapely
import xarray as xr

from seas import marine_areas, sea_names

RAW, OUT = Path("raw"), Path("out/v2")
SHARDS = 128
MIN_MONTHS = 3

# ---- shared state for worker processes (filled before the pool forks) ----
NEXT: np.ndarray
XY: np.ndarray


def walk(start: int) -> list[tuple[float, float]]:
    """Reach ends from a start reach down to the outlet."""
    pts, i, guard = [], start, 0
    while i >= 0 and guard < 20000:
        pts.append((float(XY[i, 0]), float(XY[i, 1])))
        i, guard = int(NEXT[i]), guard + 1
    return pts


def path_for(args: tuple[int, int, float, float]) -> tuple[int, list[int]]:
    lake_id, start, px, py = args
    pts = [(px, py)] + walk(start)
    line = shapely.LineString(pts) if len(pts) > 1 else None
    if line is None:
        return lake_id, []
    s = np.asarray(line.simplify(0.02, preserve_topology=False).coords)
    q = np.round(s * 100).astype(int)          # 0.01 degree units
    d = np.vstack([q[:1], np.diff(q, axis=0)])  # first point absolute, then steps
    return lake_id, d.ravel().tolist()


def main() -> None:
    global NEXT, XY
    t0 = time.time()
    OUT.mkdir(parents=True, exist_ok=True)
    lakes = pd.read_parquet("out/lakes.parquet", columns=["Hylak_id", "name", "Lake_area", "Pour_long", "Pour_lat"])

    # ---------------- water over time ----------------
    water: dict[int, dict] = {}
    for f in sorted((RAW / "glolakes").glob("*.nc")):
        ds = xr.open_dataset(f)
        st = pd.DataFrame(ds.lake_storage.values, index=pd.DatetimeIndex(ds.time.values), columns=ds.ID.values.astype(int))
        st = st.where(st >= 0)  # a few GloLakes series dip below zero (Hylak 14355: -16.9 million m3)
        if st.index.max().month < 12:  # the record stops inside its last year
            st = st[st.index.year < st.index.max().year]
        yr = st.index.year
        months = st.notna().groupby(yr).sum()
        clim = st.groupby(st.index.month).transform("mean")  # each lake's mean for each calendar month
        yearly = ((st - clim).groupby(yr).median() + st.median()).where(months >= MIN_MONTHS)
        yearly = yearly.clip(lower=0)  # a dry year's anomaly can undershoot zero (NaN stays NaN)
        for lid in yearly.columns:
            s = yearly[lid]
            if s.notna().sum() < 5 or lid in water:
                continue
            first = int(s.first_valid_index())
            vals = s.loc[first:]
            water[int(lid)] = {"y0": first, "v": [None if np.isnan(v) else float(f"{v:.4g}") for v in vals.values], "src": f.stem.split("_")[-2]}
    print(f"GloLakes: {len(water):,} lakes with >= 5 years ({time.time() - t0:.0f} s)")

    # ---------------- rivers ----------------
    rv = gpd.read_file(RAW / "HydroRIVERS_v10_shp/HydroRIVERS_v10.shp", engine="pyogrio",
                       columns=["HYRIV_ID", "NEXT_DOWN", "MAIN_RIV", "DIST_DN_KM", "ENDORHEIC"])
    ids = rv["HYRIV_ID"].to_numpy()
    order = np.argsort(ids)
    pos = lambda q: order[np.searchsorted(ids, q, sorter=order)]  # HYRIV_ID -> row
    nd = rv["NEXT_DOWN"].to_numpy()
    NEXT = np.where(nd > 0, pos(np.where(nd > 0, nd, ids[0])), -1)
    ends = shapely.get_point(rv.geometry.values, -1)  # downstream end of each reach
    XY = np.column_stack([shapely.get_x(ends), shapely.get_y(ends)])
    print(f"HydroRIVERS: {len(rv):,} reaches ({time.time() - t0:.0f} s)")

    pick = lakes[(lakes.Lake_area >= 1) | (lakes.name.fillna("") != "") | lakes.Hylak_id.isin(water.keys())].copy()
    pour = gpd.GeoDataFrame(pick, geometry=gpd.points_from_xy(pick.Pour_long, pick.Pour_lat), crs="EPSG:4326")
    near = gpd.sjoin_nearest(pour, rv[["HYRIV_ID", "geometry"]], how="left", max_distance=0.02, distance_col="dd")
    near = near.sort_values("dd").drop_duplicates("Hylak_id").dropna(subset=["HYRIV_ID"])
    near["start"] = pos(near["HYRIV_ID"].astype(np.int64).to_numpy())
    print(f"lakes on the network: {len(near):,} of {len(pick):,} picked ({time.time() - t0:.0f} s)")

    # outlets: inland ones are named after the lake they end in, coastal ones after the nearest marine area
    near["outlet_row"] = pos(rv["MAIN_RIV"].to_numpy()[near["start"].to_numpy()])
    near["endo"] = rv["ENDORHEIC"].to_numpy()[near["start"].to_numpy()].astype(int)
    near["dist_km"] = rv["DIST_DN_KM"].to_numpy()[near["start"].to_numpy()].round(0)
    outs = np.unique(near["outlet_row"].to_numpy())
    op = gpd.GeoDataFrame({"row": outs}, geometry=gpd.points_from_xy(XY[outs, 0], XY[outs, 1]), crs="EPSG:4326")
    lp = gpd.read_file(RAW / "HydroLAKES_polys_v10_shp/HydroLAKES_polys_v10.shp", engine="pyogrio", columns=["Hylak_id", "Lake_area"])
    names = lakes.set_index("Hylak_id")["name"]
    sink = gpd.sjoin_nearest(op, lp, how="left", max_distance=0.05).sort_values("Lake_area", ascending=False).drop_duplicates("row")
    sink_id = dict(zip(sink["row"], sink["Hylak_id"]))
    sea_name = sea_names(op, marine_areas(RAW))  # pipeline/seas.py: real seas only, not river mouths

    # ---------------- paths ----------------
    jobs = list(zip(near.Hylak_id.astype(int), near.start.astype(int), near.Pour_long, near.Pour_lat))
    ck = OUT / "paths.checkpoint.json"  # paths take minutes: keep them if a later step fails
    if ck.exists():
        paths = {int(k): v for k, v in json.loads(ck.read_text()).items()}
    else:
        # fork so the workers see NEXT and XY (Python 3.14 defaults to forkserver on Linux)
        with mp.get_context("fork").Pool(16) as pool:
            paths = dict(pool.imap_unordered(path_for, jobs, chunksize=500))
        ck.write_text(json.dumps(paths))
    print(f"paths: {len(paths):,} ({time.time() - t0:.0f} s)")

    flow: dict[int, dict] = {}
    for r in near.itertuples():
        row, endo = int(r.outlet_row), int(r.endo)
        rec = {"p": paths.get(int(r.Hylak_id), []), "km": int(r.dist_km), "endo": endo}
        if endo:
            sid = sink_id.get(row)
            if sid is not None and not pd.isna(sid) and int(sid) != int(r.Hylak_id):
                rec["sink"] = int(sid)
                n = names.get(int(sid))
                if isinstance(n, str) and n:
                    rec["sinkName"] = n
        else:
            rec["sea"] = sea_name.get(row)
        flow[int(r.Hylak_id)] = rec

    for kind, table in (("flow", flow), ("water", water)):
        d = OUT / kind
        d.mkdir(exist_ok=True)
        shards: dict[int, dict] = {}
        for k, v in table.items():
            shards.setdefault(k % SHARDS, {})[str(k)] = v
        for s, content in shards.items():
            # allow_nan=False: a NaN would make the whole shard unreadable in the browser (it happened once)
            (d / f"{s:03d}.json").write_text(json.dumps(content, separators=(",", ":"), ensure_ascii=False, allow_nan=False))
    meta = {"shards": SHARDS, "flowLakes": len(flow), "waterLakes": len(water),
            "endorheic": int(sum(v["endo"] for v in flow.values())),
            "sources": {"rivers": "HydroRIVERS v1.0, Lehner & Grill 2013, CC BY 4.0",
                        "water": "GloLakes v1.1, Hou et al. 2024, ESSD 16, 201, doi:10.25914/K8ZF-6G46, CC BY 4.0",
                        "seas": "Natural Earth 10m marine areas, public domain"}}
    (OUT / "meta.json").write_text(json.dumps(meta, indent=1))
    ck.unlink(missing_ok=True)
    size = sum(f.stat().st_size for f in OUT.rglob("*.json"))
    print(json.dumps(meta), f"{size / 1e6:.1f} MB", f"done in {time.time() - t0:.0f} s")


if __name__ == "__main__":
    main()
