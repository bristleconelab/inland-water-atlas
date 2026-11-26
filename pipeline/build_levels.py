"""Water level of the largest lakes since 1992, from satellite radar altimetry (NASA GSFC Global Water Monitor, the
former USDA G-REALM; 10-day product, TOPEX/Poseidon, Jason-1/2/3 and Sentinel-6A on one Jason-2 reference).

GloLakes leaves out the biggest lakes (the Caspian, Baikal, Victoria, the Great Lakes); these are the lakes radar
altimeters were built to follow. Each target is a stretch of one satellite pass over a lake; it is matched to the
HydroLAKES lake holding its mid-point (or the nearest within 0.05 degrees). When several targets fall in one lake
(Victoria 1, 2, 3), the one with the most good passes is kept. Kept as yearly medians of the height variation (m, against
the target's reference level), for years with at least MIN_PASSES good passes; the last year only when it is complete.

Output: out/v2/levels.json {"Hylak_id": {"n": target name, "id": target id, "y0": first year, "v": [m or null], "err": median error m}}
Data: NASA GSFC Global Water Monitor, https://earth.gsfc.nasa.gov/gwm/lake/Index (US Government work, public domain;
acknowledge USDA/NASA G-REALM).

usage (on the processing server, from the project data folder): uv run --with geopandas --with pyogrio python pipeline/build_levels.py
"""
from __future__ import annotations

import datetime as dt
import json
import re
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd

RAW, OUT = Path("raw"), Path("out")
MIN_PASSES = 3


def read_target(f: Path) -> dict | None:
    lines = f.read_text(errors="replace").splitlines()
    tid = name = None
    lat = lon = None
    rows = []
    for ln in lines:
        if ln.endswith(": Target database id number and name"):
            m = re.match(r"\s*(\d+)\s+(.*?)\s*:", ln)
            tid, name = int(m.group(1)), m.group(2).strip()
        elif ln.endswith(": Latitude and longitude (degrees East) of target mid-point"):
            a = ln.split(":")[0].split()
            lat, lon = float(a[0]), float(a[1])
        elif re.match(r"^[A-Z0-9-]+\s+\d+\s+\d{8}\s", ln):
            c = ln.split()
            date, h, err = c[2], float(c[5]), float(c[6])
            if date.startswith("9999") or h >= 999 or err >= 99:
                continue
            rows.append((dt.date(int(date[:4]), int(date[4:6]), int(date[6:8])), h, err))
    if tid is None or lat is None or not rows:
        return None
    if lon > 180:
        lon -= 360
    return {"id": tid, "name": name, "lat": lat, "lon": lon, "rows": rows}


def main() -> None:
    targets = [t for t in (read_target(f) for f in sorted((RAW / "gwm/ts").glob("lake*.10d.2.txt"))) if t]
    print(f"targets with data: {len(targets)}")
    pts = gpd.GeoDataFrame({"k": range(len(targets))}, geometry=gpd.points_from_xy([t["lon"] for t in targets], [t["lat"] for t in targets]), crs="EPSG:4326")
    lk = gpd.read_file(RAW / "HydroLAKES_polys_v10_shp/HydroLAKES_polys_v10.shp", engine="pyogrio", columns=["Hylak_id", "Lake_area"])
    j = gpd.sjoin(pts, lk, predicate="within", how="left")
    j = j.sort_values("Lake_area", ascending=False).drop_duplicates("k").set_index("k")
    miss = j["Hylak_id"].isna()
    if miss.any():
        nj = gpd.sjoin_nearest(pts[pts.k.isin(j.index[miss])], lk, max_distance=0.05, how="left").drop_duplicates("k").set_index("k")
        j.loc[nj.index, "Hylak_id"] = nj["Hylak_id"]
    last_day = max(r[0] for t in targets for r in t["rows"])
    out: dict[str, dict] = {}
    for k, t in enumerate(targets):
        hid = j.loc[k, "Hylak_id"] if k in j.index else np.nan
        if pd.isna(hid):
            continue
        d = pd.DataFrame(t["rows"], columns=["date", "h", "err"])
        d["year"] = [x.year for x in d.date]
        if last_day.month < 12:
            d = d[d.year < last_day.year]
        g = d.groupby("year")
        yearly = g["h"].median().where(g.size() >= MIN_PASSES)
        if yearly.notna().sum() < 5:
            continue
        y0, y1 = int(yearly.index.min()), int(yearly.index.max())
        full = yearly.reindex(range(y0, y1 + 1))
        rec = {"n": t["name"], "id": t["id"], "y0": y0, "v": [None if pd.isna(x) else round(float(x), 2) for x in full.values],
               "err": round(float(d["err"].median()), 3), "passes": int(len(d))}
        key = str(int(hid))
        if key not in out or rec["passes"] > out[key]["passes"]:
            out[key] = rec
    (OUT / "v2").mkdir(parents=True, exist_ok=True)
    (OUT / "v2/levels.json").write_text(json.dumps(out, separators=(",", ":"), ensure_ascii=False, allow_nan=False))
    print(f"lakes with a level record: {len(out)}; last pass {last_day}")
    for hid in ("1", "11", "8", "12"):
        if hid in out:
            r = out[hid]; print(hid, r["n"], r["y0"], len(r["v"]), r["v"][:3], r["v"][-3:])


if __name__ == "__main__":
    main()
