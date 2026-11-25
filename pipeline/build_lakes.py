"""Lake table for the atlas: how deep is each lake, and how do we know?

Inputs (raw/, see fetch.sh):
  HydroLAKES v1.0 polygons (Messager et al. 2016, CC BY 4.0): 1,427,688 lakes >= 10 ha. Depth_avg and Vol_total come
    from literature (Vol_src 1), from the GRanD reservoir database (Vol_src 2) or from a geostatistical model (3).
  3D-LAKES (Huang et al. 2025, Sci Data, Zenodo 13107867, CC BY 4.0): area-elevation pairs that ICESat-2 and Landsat
    actually observed for 510,530 lakes (L1). This is the band in which the water level was seen to move, not the
    full depth.
  Wikidata (CC0), through QLever: names of lakes and reservoirs with coordinates, and published depths (P4511, with
    P1013 "criterion used" telling mean from maximum where given). Matched to HydroLAKES when the item's point lies
    inside the lake polygon.

Outputs (out/):
  lakes.parquet          one row per HydroLAKES lake with the fields below
  lakes_points.geojsonl  label points for the lakes that have a name
  lakes_polys.geojsonl   simplified polygons with id, tier, area for the tiles
  stats.json             headline numbers

Tier ("how we know the depth"):
  3 published  a depth or volume from the literature or a reservoir register (Vol_src 1/2, or a Wikidata depth)
  2 seen       satellites saw the water level move over part of the bed (3D-LAKES L1), depth below is modelled
  1 modelled   only the HydroLAKES / GLOBathy statistical estimate

usage (on the processing server, from the project data folder): uv run --with geopandas --with pyogrio --with pyarrow python pipeline/build_lakes.py
"""
from __future__ import annotations

import json
import re
import time
import urllib.parse
import urllib.request
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd

RAW, OUT = Path("raw"), Path("out")
QLEVER = "https://qlever.dev/api/wikidata"
PREFIX = ("PREFIX wdt: <http://www.wikidata.org/prop/direct/> PREFIX wd: <http://www.wikidata.org/entity/> "
          "PREFIX p: <http://www.wikidata.org/prop/> PREFIX ps: <http://www.wikidata.org/prop/statement/> "
          "PREFIX pq: <http://www.wikidata.org/prop/qualifier/> PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#> "
          "PREFIX schema: <http://schema.org/> PREFIX psn: <http://www.wikidata.org/prop/statement/value-normalized/> "
          "PREFIX wikibase: <http://wikiba.se/ontology#> ")
# P1013 "criterion used" values seen on lake depths (QLever, 2026-11-25): average Q202785 (1,274), lowest point Q30278109
# (697), maximum Q10578722 (695), mean Q2796622, average Q54835811, arithmetic mean Q19033
WD = "http://www.wikidata.org/entity/"
MEAN_DEPTH = {WD + q for q in ("Q202785", "Q2796622", "Q54835811", "Q19033")}
MAX_DEPTH = {WD + q for q in ("Q10578722", "Q30278109")}


def sparql(q: str) -> list[dict]:
    req = urllib.request.Request(f"{QLEVER}?{urllib.parse.urlencode({'query': PREFIX + q})}",
                                 headers={"Accept": "application/sparql-results+json", "User-Agent": "lakes-atlas data build"})
    for attempt in range(4):
        try:
            return json.load(urllib.request.urlopen(req, timeout=600))["results"]["bindings"]
        except Exception as e:  # QLever is a public service: retry a few times
            if attempt == 3:
                raise
            print("retry", e); time.sleep(20)


def wikidata() -> pd.DataFrame:
    cache = RAW / "wikidata_lakes.parquet"
    if cache.exists():
        return pd.read_parquet(cache)
    rows = sparql("""SELECT ?l ?coord (SAMPLE(?name) AS ?label) (SAMPLE(?art) AS ?article) WHERE {
      { ?l wdt:P31/wdt:P279* wd:Q23397 } UNION { ?l wdt:P31/wdt:P279* wd:Q131681 }
      ?l wdt:P625 ?coord .
      OPTIONAL { ?l rdfs:label ?name FILTER(LANG(?name) = "en") }
      OPTIONAL { ?art schema:about ?l ; schema:isPartOf <https://en.wikipedia.org/> }
    } GROUP BY ?l ?coord""")
    d = pd.DataFrame([{k: v["value"] for k, v in b.items()} for b in rows])
    print(f"  wikidata rows: {len(d):,}")
    # Earth only: coordinates on other bodies carry a globe prefix ("<...Q111> Point(...)" is Mars);
    # unknown values come back as blank-node URIs and do not match
    # Earth coordinates arrive as "POINT(lon lat)"; QLever writes other globes as "<...Q111> Point(...)"
    pt = d["coord"].str.extract(r"^POINT\(([-\d.eE]+) ([-\d.eE]+)\)$", flags=re.IGNORECASE).astype(float)
    d["lon"], d["lat"] = pt[0], pt[1]
    d["qid"] = d["l"].str.rsplit("/", n=1).str[-1]
    depths = sparql("""SELECT ?l ?d ?crit WHERE {
      { ?l wdt:P31/wdt:P279* wd:Q23397 } UNION { ?l wdt:P31/wdt:P279* wd:Q131681 }
      ?l p:P4511 ?st . ?st psn:P4511 ?nv . ?nv wikibase:quantityAmount ?d . OPTIONAL { ?st pq:P1013 ?crit } }""")
    dd = pd.DataFrame([{k: v["value"] for k, v in b.items()} for b in depths])
    dd["qid"] = dd["l"].str.rsplit("/", n=1).str[-1]
    dd["d"] = pd.to_numeric(dd["d"], errors="coerce")  # normalised to metres
    crit = dd["crit"] if "crit" in dd else pd.Series("", index=dd.index)
    dd["kind"] = np.select([crit.isin(MEAN_DEPTH), crit.isin(MAX_DEPTH)], ["mean", "max"], "unspecified")
    best = (dd.dropna(subset=["d"]).sort_values("d", ascending=False)
              .groupby(["qid", "kind"])["d"].first().unstack())  # one value per kind
    d = d.merge(best, left_on="qid", right_index=True, how="left")
    keep = ["qid", "label", "article", "lon", "lat"] + [c for c in ("mean", "max", "unspecified") if c in d]
    print(f"  depth statements: {len(dd):,}, numeric {dd['d'].notna().sum():,}; kinds {dd['kind'].value_counts().to_dict()}")
    d = d.dropna(subset=["lon", "lat"])[keep].drop_duplicates("qid")
    print(f"  Earth items with coordinates: {len(d):,}")
    d.to_parquet(cache)
    return d


def main() -> None:
    OUT.mkdir(exist_ok=True)
    t0 = time.time()
    lakes = gpd.read_file(RAW / "HydroLAKES_polys_v10_shp/HydroLAKES_polys_v10.shp", engine="pyogrio",
                          columns=["Hylak_id", "Lake_name", "Country", "Lake_type", "Grand_id", "Lake_area", "Vol_total",
                                   "Vol_src", "Depth_avg", "Elevation", "Pour_long", "Pour_lat"])
    print(f"HydroLAKES {len(lakes):,} lakes in {time.time() - t0:.0f} s")

    # --- satellites: the band of water level 3D-LAKES saw (L1) ---
    st = pd.read_csv(RAW / "3D-LAKES-ST.csv", usecols=["Hylak_id"])
    l1 = json.load(open(RAW / "3D-LAKES-L1.json"))
    rng = np.full(len(st), np.nan)
    for k, v in l1.items():
        e = v.get("Elevation (m)") or []
        if len(e) >= 2:
            rng[int(k)] = max(e) - min(e)
    sat = pd.DataFrame({"Hylak_id": st["Hylak_id"].values, "seen_m": rng})
    lakes = lakes.merge(sat, on="Hylak_id", how="left")
    print(f"3D-LAKES L1 joined: {sat['seen_m'].notna().sum():,} lakes with an observed level band")

    # --- Wikidata names and published depths ---
    wd = wikidata()
    pts = gpd.GeoDataFrame(wd, geometry=gpd.points_from_xy(wd["lon"], wd["lat"]), crs="EPSG:4326")
    j = gpd.sjoin(pts, lakes[["Hylak_id", "Lake_area", "geometry"]], predicate="within", how="inner")
    # several items can fall in one lake (islands, bays): prefer an item with a depth, then one with an article
    j["score"] = j[[c for c in ("mean", "max", "unspecified") if c in j]].notna().any(axis=1) * 2 + j["article"].notna()
    j = j.sort_values(["Hylak_id", "score"], ascending=[True, False]).drop_duplicates("Hylak_id")
    cols = ["Hylak_id", "qid", "label", "article"] + [c for c in ("mean", "max", "unspecified") if c in j]
    lakes = lakes.merge(pd.DataFrame(j[cols]), on="Hylak_id", how="left")
    print(f"Wikidata: {len(wd):,} items, {len(j):,} matched to a lake")

    wd_depth = lakes[[c for c in ("mean", "max", "unspecified") if c in lakes]].notna().any(axis=1)
    published = lakes["Vol_src"].isin([1, 2]) | wd_depth
    lakes["tier"] = np.where(published, 3, np.where(lakes["seen_m"].fillna(0) > 0, 2, 1)).astype("int8")
    lakes["name"] = lakes["Lake_name"].fillna("").where(lakes["Lake_name"].fillna("") != "", lakes["label"].fillna(""))

    n = len(lakes)
    stats = {
        "lakes": n,
        "published": int((lakes.tier == 3).sum()), "seen": int((lakes.tier == 2).sum()), "modelled": int((lakes.tier == 1).sum()),
        "volSrc": {str(k): int(v) for k, v in lakes["Vol_src"].value_counts().sort_index().items()},
        "wikidataDepth": int(wd_depth.sum()), "named": int((lakes["name"] != "").sum()),
        "seenMedianM": float(np.nanmedian(lakes["seen_m"])),
        "areaShareKnown": float(lakes.loc[lakes.tier == 3, "Lake_area"].sum() / lakes["Lake_area"].sum()),
        "byAreaClass": {lbl: {"n": int(m.sum()), "published": int((m & (lakes.tier == 3)).sum())}
                        for lbl, m in {"0.1-1 km2": lakes.Lake_area < 1, "1-10 km2": (lakes.Lake_area >= 1) & (lakes.Lake_area < 10),
                                       "10-100 km2": (lakes.Lake_area >= 10) & (lakes.Lake_area < 100), ">=100 km2": lakes.Lake_area >= 100}.items()},
        "sources": {"hydrolakes": "Messager et al. 2016, HydroLAKES v1.0, CC BY 4.0",
                    "3dlakes": "Huang et al. 2025, 3D-LAKES, Zenodo 10.5281/zenodo.13107867, CC BY 4.0",
                    "wikidata": f"Wikidata via QLever, CC0, fetched {time.strftime('%Y-%m-%d')}"},
    }
    (OUT / "stats.json").write_text(json.dumps(stats, indent=1))
    print(json.dumps(stats, indent=1))

    table = pd.DataFrame(lakes.drop(columns="geometry"))
    table.to_parquet(OUT / "lakes.parquet")
    # polygons for the tiles: few attributes; everything else is looked up per lake on click
    # everything the click panel needs travels in the tiles (short keys keep them small)
    poly = gpd.GeoDataFrame({
        "id": lakes["Hylak_id"], "tier": lakes["tier"], "a": lakes["Lake_area"].round(2),
        "n": lakes["name"].replace("", None), "c": lakes["Country"], "t": lakes["Lake_type"].astype("int8"),
        "d": lakes["Depth_avg"].round(1), "v": lakes["Vol_total"].round(1), "vs": lakes["Vol_src"].astype("int8"),
        "e": lakes["Elevation"].round(0), "s": lakes["seen_m"].round(2),
        "wm": lakes.get("mean"), "wx": lakes.get("max"), "wu": lakes.get("unspecified"), "q": lakes["qid"],
    }, geometry=lakes.geometry, crs=lakes.crs)
    for k in ("wm", "wx", "wu"):
        if k in poly:
            poly[k] = poly[k].round(1)
    poly.to_file(OUT / "lakes_polys.geojsonl", driver="GeoJSONSeq", engine="pyogrio")
    named = lakes[lakes["name"] != ""]
    lab = gpd.GeoDataFrame({"id": named["Hylak_id"], "name": named["name"], "a": named["Lake_area"].round(1), "tier": named["tier"]},
                           geometry=named.geometry.representative_point(), crs="EPSG:4326")
    lab.to_file(OUT / "lakes_points.geojsonl", driver="GeoJSONSeq", engine="pyogrio")
    print(f"done in {time.time() - t0:.0f} s")


if __name__ == "__main__":
    main()
