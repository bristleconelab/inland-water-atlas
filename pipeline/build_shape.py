"""The shape of each lake bed, and how far the depth model is from published maximum depths.

Shape (out/v2/shape/NNN.json, 256 shards by Hylak_id % 256): {"id": {"g": [a, b, dmax, dmean], "o": [d0, a0, d1, a1, ...]}}
  g: GLOBathy (Khazaei et al. 2022, Scientific Data, figshare 13402070 / 13402124, CC0), a model for every HydroLAKES
     lake: area A = a * h^b (km2) at height h (m) above the bottom, up to its maximum depth dmax; dmean its mean depth.
  o: what satellites saw (3D-LAKES L1, Huang et al. 2025, CC BY 4.0): pairs of depth below the highest level seen (cm)
     and water area (hectares), at most 12, for the lakes where ICESat-2 and Landsat traced the shoreline.
Model error (out/v2/model_error.json): for lakes whose maximum depth is published on Wikidata with the criterion
  "maximum" (not "unspecified", not a mean), GLOBathy's maximum depth against it. GLOBathy's mean depth is not compared
  with published volumes: GLOBathy takes its volumes from HydroLAKES, which for those lakes are the published ones.

usage (on the processing server, from the project data folder, after build_lakes.py):
  uv run --with pandas --with pyarrow --with xarray --with netcdf4 python pipeline/build_shape.py
"""
from __future__ import annotations

import glob
import json
from collections import defaultdict
from pathlib import Path

import numpy as np
import pandas as pd
import xarray as xr

RAW, OUT = Path("raw"), Path("out")
SHARDS = 256
MAX_OBS = 12


def main() -> None:
    ds = xr.open_dataset(RAW / "globathy/hAV.nc")
    ids = ds["lake_id"].values.astype(int)
    fa = ds["f_hA"].values            # a, b, R2
    att = ds["lake_attributes"].values  # max depth, mean depth, area, volume
    g = pd.DataFrame({"a": fa[:, 0], "b": fa[:, 1], "dmax": att[:, 0], "dmean": att[:, 1]}, index=ids)
    print(f"GLOBathy: {len(g):,} lakes")

    st = pd.read_csv(RAW / "3D-LAKES-ST.csv", usecols=["Hylak_id"])
    l1 = json.load(open(RAW / "3D-LAKES-L1.json"))
    obs: dict[int, list] = {}
    for k, v in l1.items():
        e = np.asarray(v.get("Elevation (m)") or [], float)
        a = np.asarray(v.get("Area (m2)") or [], float)
        ok = np.isfinite(e) & np.isfinite(a)
        e, a = e[ok], a[ok]
        if len(e) < 3:  # two noisy points are not a shape
            continue
        o = np.argsort(-e)
        e, a = e[o], a[o]
        if len(e) > MAX_OBS:
            pick = np.unique(np.linspace(0, len(e) - 1, MAX_OBS).round().astype(int))
            e, a = e[pick], a[pick]
        depth_cm = np.round((e[0] - e) * 100).astype(int)
        area_ha = np.round(a / 1e4, 1)
        obs[int(st["Hylak_id"].iloc[int(k)])] = [x for pair in zip(depth_cm.tolist(), area_ha.tolist()) for x in pair]
    print(f"3D-LAKES: {len(obs):,} lakes with at least 3 observed levels")

    shards: dict[int, dict] = defaultdict(dict)
    for lid, r in g.iterrows():
        if not (np.isfinite(r.a) and np.isfinite(r.b) and r.dmax > 0):
            continue
        rec = {"g": [float(f"{r.a:.4g}"), round(float(r.b), 3), round(float(r.dmax), 1), round(float(r.dmean), 1)]}
        if lid in obs:
            rec["o"] = obs[lid]
        shards[lid % SHARDS][str(lid)] = rec
    d = OUT / "v2/shape"
    d.mkdir(parents=True, exist_ok=True)
    for s in range(SHARDS):
        (d / f"{s:03d}.json").write_text(json.dumps(shards.get(s, {}), separators=(",", ":"), allow_nan=False))
    size = sum(f.stat().st_size for f in d.glob("*.json"))
    print(f"shape shards: {sum(len(x) for x in shards.values()):,} lakes, {size / 1e6:.1f} MB")

    # model error: GLOBathy's maximum depth against a published maximum (Wikidata criterion "maximum")
    lakes = pd.read_parquet(OUT / "lakes.parquet", columns=["Hylak_id", "max", "Lake_area", "name"])
    m = lakes.dropna(subset=["max"]).set_index("Hylak_id")
    m = m[m["max"] > 0].join(g[["dmax"]], how="inner")
    m = m[m["dmax"] > 0]
    # GLOBathy takes a published maximum depth as its own for some lakes (the Caspian's 1,025 m): there the agreement is
    # not a test of the model, so those lakes are listed (flag 1) but left out of the statistics
    same = (m["dmax"] - m["max"]).abs() < 0.5
    err = {str(int(i)): [round(float(p), 1), round(float(q), 1), int(s)] for i, p, q, s in zip(m.index, m["max"], m["dmax"], same)}
    m = m[~same]
    ratio = m["dmax"] / m["max"]
    lr = np.log10(ratio)
    stats = {
        "n": int(len(m)), "sameAsPublished": int(same.sum()),
        "medianRatio": round(float(np.median(ratio)), 3),
        "withinFactor2": round(float(np.mean(np.abs(lr) <= np.log10(2))), 3),
        "withinFactor1_25": round(float(np.mean(np.abs(lr) <= np.log10(1.25))), 3),
        "tooDeep": round(float(np.mean(ratio > 1)), 3),
        "byArea": {lbl: {"n": int(sel.sum()), "medianRatio": round(float(np.median(ratio[sel])), 3) if sel.any() else None,
                         "withinFactor2": round(float(np.mean(np.abs(lr[sel]) <= np.log10(2))), 3) if sel.any() else None}
                   for lbl, sel in {"<1 km2": m.Lake_area < 1, "1-10 km2": (m.Lake_area >= 1) & (m.Lake_area < 10),
                                    "10-100 km2": (m.Lake_area >= 10) & (m.Lake_area < 100), ">=100 km2": m.Lake_area >= 100}.items()},
        "source": "GLOBathy Dmax (Khazaei et al. 2022, CC0) vs Wikidata P4511 with criterion maximum",
    }
    (OUT / "v2/model_error.json").write_text(json.dumps({"stats": stats, "lakes": err}, separators=(",", ":")))
    print(json.dumps(stats, indent=1))


if __name__ == "__main__":
    main()
