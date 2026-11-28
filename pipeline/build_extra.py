"""Inland Water Atlas: the numbers limnologists ask for, river profiles, dams, and names in more languages.

Outputs (out/v2/ unless said otherwise):
  limno/NNN.json   256 shards by Hylak_id % 256: {"id": [shore km, shoreline development, residence time days,
                   catchment km2, mean outflow m3/s]} from HydroLAKES v1.0 (Messager et al. 2016, CC BY 4.0) for every
                   lake. The panel derives the volume development and the relative depth from these and the depths.
  endo.json        Hylak_ids of lakes whose outlet lies in a basin with no outlet to the sea (HydroBASINS level 8
                   ENDO > 0, plus the basins that end in the Caspian, which HydroSHEDS treats as ocean; Lehner & Grill
                   2013, CC BY 4.0), for the "no way to the sea" map view.
  profile/NNN.json 128 shards by river id % 128: the main stem of each named river from its farthest source to its end:
                   x km from the source, z elevation (m, lowest point of each reach's catchment, RiverATLAS ele_mt_cmn),
                   q natural mean flow (m3/s, dis_m3_pyr), d degree of regulation (%, dor_pc_pva / 10: the share of a
                   year's flow that the reservoirs upstream can hold, from GRanD v1.1, capped at 1000 %), and lk the
                   lakes and reservoirs whose outlet is on it; ir = share of the basin above the end that is irrigated
                   (%, ire_pc_use). RiverATLAS v1.0 (Linke et al. 2019, CC BY 4.0) carries HydroRIVERS' ids.
  ../lake_aliases.json, ../river_aliases.json   Wikidata labels in other languages, for the search indexes.
  ../stats.json    adds volShareKnown: the share of all lake water held in lakes with a published depth or volume.

usage (on the processing server, from the project data folder, after build_lakes.py and build_rivers.py):
  uv run --with geopandas --with pyogrio --with pyarrow python pipeline/build_extra.py
"""
from __future__ import annotations

import glob
import hashlib
import json
import time
import unicodedata
import urllib.parse
import urllib.request
from collections import defaultdict
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
import pyogrio
import shapely

RAW, OUT = Path("raw"), Path("out")
QLEVER = "https://qlever.dev/api/wikidata"
# languages whose labels are added to search: the atlas's own (Uzbek, Russian) and the major ones of the regions with
# the most lakes; a label that folds to the name already shown is not added
LANGS = ("uz", "ru", "kk", "ky", "tg", "tk", "mn", "zh", "ja", "ko", "ar", "fa", "tr", "hi", "es", "pt", "fr", "de", "it", "fi", "sv", "no", "pl")
MAX_ALIASES = 8
GENERIC = {"lake", "lac", "lago", "sea", "reservoir", "the", "pond", "lower", "upper", "north", "south", "east", "west",
           "great", "little", "big", "small", "large", "laguna", "lagoon", "see", "ozero", "vodokhranilishche",
           "lough", "loch", "danau", "lagoa", "cienaga", "caka", "dano", "nizhnee", "verkhnee", "lac", "lagune", "embalse"}
PREFIX = ("PREFIX wdt: <http://www.wikidata.org/prop/direct/> PREFIX wd: <http://www.wikidata.org/entity/> "
          "PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#> PREFIX skos: <http://www.w3.org/2004/02/skos/core#> "
          "PREFIX wikibase: <http://wikiba.se/ontology#> ")


def log(t0: float, m: str) -> None:
    print(f"{m} ({time.time() - t0:.0f} s)", flush=True)


def sparql(q: str) -> list[dict]:
    # POST: a batch of 3,000 item ids makes a URL too long for a GET
    req = urllib.request.Request(QLEVER, data=urllib.parse.urlencode({"query": PREFIX + q}).encode(),
                                 headers={"Accept": "application/sparql-results+json", "User-Agent": "inland-water-atlas data build",
                                          "Content-Type": "application/x-www-form-urlencoded"})
    for attempt in range(4):
        try:
            return json.loads(urllib.request.urlopen(req, timeout=300).read(), strict=False)["results"]["bindings"]  # labels can hold control characters
        except Exception as e:
            if attempt == 3:
                raise
            print("retry", e); time.sleep(30)


def fold(s: str) -> str:
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn").lower()
    for a in "ʻʼ’‘`´":
        s = s.replace(a, "'")
    return s


def aliases(cache: Path, qids: list[str]) -> pd.DataFrame:
    """Labels and other names of the given items in LANGS and English, asked 3,000 items at a time (one query over
    every lake class with 24 languages did not finish on QLever). Cached per set of items and languages."""
    qids = sorted(set(qids))
    cache = cache.with_name(f"{cache.stem}-{hashlib.sha1(' '.join(qids + list(LANGS)).encode()).hexdigest()[:10]}.parquet")
    if cache.exists():
        return pd.read_parquet(cache)
    langs = ", ".join(f'"{l}"' for l in LANGS + ("en",))
    rows = []
    for i in range(0, len(qids), 3000):
        vals = " ".join(f"wd:{q}" for q in qids[i:i + 3000])
        for b in sparql(f"SELECT ?i ?lab WHERE {{ VALUES ?i {{ {vals} }} {{ ?i rdfs:label ?lab }} UNION {{ ?i skos:altLabel ?lab }} FILTER(LANG(?lab) IN ({langs})) }}"):
            rows.append({"qid": b["i"]["value"].rsplit("/", 1)[-1], "lab": b["lab"]["value"], "lang": b["lab"].get("xml:lang", "")})
        print(f"  labels: {i + 3000:,} of {len(qids):,} items, {len(rows):,} names", flush=True)
    d = pd.DataFrame(rows)
    d.to_parquet(cache)
    return d


def parents(cache: Path, qids: list[str]) -> pd.DataFrame:
    """Item -> the items it is "part of" (P361). Cached per set of items."""
    qids = sorted(set(qids))
    cache = cache.with_name(f"{cache.stem}-{hashlib.sha1(' '.join(qids).encode()).hexdigest()[:10]}.parquet")
    if cache.exists():
        return pd.read_parquet(cache)
    rows = []
    for i in range(0, len(qids), 3000):
        vals = " ".join(f"wd:{q}" for q in qids[i:i + 3000])
        for b in sparql(f"SELECT ?i ?p WHERE {{ VALUES ?i {{ {vals} }} ?i wdt:P361 ?p }}"):
            rows.append({"qid": b["i"]["value"].rsplit("/", 1)[-1], "p": b["p"]["value"].rsplit("/", 1)[-1]})
    d = pd.DataFrame(rows, columns=["qid", "p"])
    d.to_parquet(cache)
    return d


def sitelinks(cache: Path, qids: list[str]) -> dict[str, int]:
    """Number of Wikipedia articles of each item."""
    qids = sorted(set(qids))
    cache = cache.with_name(f"{cache.stem}-{hashlib.sha1(' '.join(qids).encode()).hexdigest()[:10]}.parquet")
    if not cache.exists():
        rows = []
        for i in range(0, len(qids), 3000):
            vals = " ".join(f"wd:{q}" for q in qids[i:i + 3000])
            for b in sparql(f"SELECT ?i ?sl WHERE {{ VALUES ?i {{ {vals} }} ?i wikibase:sitelinks ?sl }}"):
                rows.append({"qid": b["i"]["value"].rsplit("/", 1)[-1], "sl": int(b["sl"]["value"])})
        pd.DataFrame(rows, columns=["qid", "sl"]).to_parquet(cache)
    d = pd.read_parquet(cache)
    return dict(zip(d["qid"], d["sl"]))


def pick_aliases(names: dict, labs: pd.DataFrame) -> dict:
    """{key: [aliases]} for labels that fold to something new, preferred languages first: up to MAX_ALIASES of the
    item's own, then up to 4 of the lake it is part of (languages marked "~")."""
    order = {l: i for i, l in enumerate(LANGS)}
    rank = lambda lang: 50 + order.get(lang[1:], 49) if lang.startswith("~") else order.get(lang, 49)
    labs = labs.assign(o=labs["lang"].map(rank)).sort_values(["qid", "o"], kind="stable")
    out: dict = {}
    for qid, g in labs.groupby("qid", sort=False):
        for key, shown in names.get(qid, ()):
            seen = {fold(x) for x in shown}
            own, inherited = [], []
            for lab, lang in zip(g["lab"], g["lang"]):
                f = fold(lab)
                bucket, cap = (inherited, 4) if lang.startswith("~") else (own, MAX_ALIASES)
                if f in seen or len(lab) < 2 or len(bucket) >= cap:
                    continue
                seen.add(f); bucket.append(lab)
            if own or inherited:
                out[key] = own + inherited
    return out


def main() -> None:
    t0 = time.time()
    v2 = OUT / "v2"

    # ---------------- lakes: limnology, basins with no outlet, volume share ----------------
    hl = pyogrio.read_dataframe(RAW / "HydroLAKES_polys_v10_shp/HydroLAKES_polys_v10.shp", read_geometry=False,
                                columns=["Hylak_id", "Lake_area", "Shore_len", "Shore_dev", "Vol_total", "Res_time", "Wshd_area", "Dis_avg", "Pour_long", "Pour_lat", "Lake_type"])
    log(t0, f"HydroLAKES {len(hl):,}")
    shards: dict[int, dict] = defaultdict(dict)
    r = lambda x, k: None if not np.isfinite(x) or x < 0 else round(float(x), k)  # HydroLAKES writes -1 for "unknown"
    for row in hl.itertuples(index=False):
        shards[row.Hylak_id % 256][str(row.Hylak_id)] = [r(row.Shore_len, 1), r(row.Shore_dev, 2), r(row.Res_time, 1), r(row.Wshd_area, 0), r(row.Dis_avg, 3)]
    d = v2 / "limno"
    d.mkdir(parents=True, exist_ok=True)
    for s in range(256):
        (d / f"{s:03d}.json").write_text(json.dumps(shards.get(s, {}), separators=(",", ":"), allow_nan=False))
    log(t0, f"limno shards {sum(f.stat().st_size for f in d.glob('*.json')) / 1e6:.1f} MB")

    units = pd.concat([gpd.read_file(f"/vsizip/{z}", engine="pyogrio", columns=["HYBAS_ID", "MAIN_BAS", "ENDO"])
                       for z in sorted(glob.glob(str(RAW / "hybas/*lev08*.zip")))], ignore_index=True).to_crs("EPSG:4326")
    # HydroSHEDS treats the Caspian as ocean, so the Volga, Ural and Kura basins carry ENDO 0. Every main basin whose
    # outlet unit touches the Caspian (HydroLAKES 1) has no outlet to the sea either.
    caspian = gpd.read_file(RAW / "HydroLAKES_polys_v10_shp/HydroLAKES_polys_v10.shp", engine="pyogrio", where="Hylak_id = 1").geometry.iloc[0]
    outlets = units[units["HYBAS_ID"] == units["MAIN_BAS"]]
    to_caspian = set(outlets.loc[outlets.intersects(caspian.buffer(0.05)), "MAIN_BAS"])
    units["endo"] = (units["ENDO"] > 0) | units["MAIN_BAS"].isin(to_caspian)
    pts = gpd.GeoDataFrame({"id": hl["Hylak_id"]}, geometry=gpd.points_from_xy(hl["Pour_long"], hl["Pour_lat"]), crs="EPSG:4326")
    j = gpd.sjoin(pts, units, predicate="within", how="inner").drop_duplicates("id")
    endo = sorted({int(x) for x in j.loc[j["endo"], "id"]} | {1})
    log(t0, f"main basins draining to the Caspian: {len(to_caspian):,}")
    (v2 / "endo.json").write_text(json.dumps(endo, separators=(",", ":")))
    log(t0, f"lakes draining to a basin with no outlet: {len(endo):,} of {len(j):,} placed")

    lakes = pd.read_parquet(OUT / "lakes.parquet", columns=["Hylak_id", "tier", "Vol_total", "Lake_area", "qid", "name"])
    stats = json.loads((OUT / "stats.json").read_text())
    vol = lakes["Vol_total"].clip(lower=0)
    known = lakes["tier"] == 3
    caspian = lakes["Vol_total"].idxmax()  # the Caspian holds most of the world's lake water: the share without it too
    stats["volShareKnown"] = float(vol[known].sum() / vol.sum())
    stats["volShareKnownNoCaspian"] = float(vol[known].drop(caspian, errors="ignore").sum() / vol.drop(caspian).sum())
    stats["endorheicLakes"] = len(endo)
    (OUT / "stats.json").write_text(json.dumps(stats, indent=1))
    log(t0, f"volume share published {stats['volShareKnown']:.3f}, without the Caspian {stats['volShareKnownNoCaspian']:.3f}")

    # ---------------- names in other languages ----------------
    named = lakes[(lakes["name"] != "") & lakes["qid"].notna()]
    lab = aliases(RAW / "wd_lake_labels.parquet", named["qid"].tolist())
    # a lake in pieces (South and North Aral Sea) also answers to the whole lake's names (Orol dengizi): the labels of
    # the lake each item is "part of" (P361), when that is itself a lake on Wikidata, come after its own
    lake_items = set(pd.read_parquet(RAW / "wikidata_lakes_v2.parquet", columns=["qid"])["qid"])
    parent = parents(RAW / "wd_lake_parents.parquet", named["qid"].tolist())
    parent = parent[parent["p"].isin(lake_items)]
    # ... and a Wikidata lake that matched no polygon (its point is on what is now dry bed: the Aral Sea) lends its
    # names to the nearest lake of 10 km2 or more within 0.5 degree, if their English names share a word
    wdl = pd.read_parquet(RAW / "wikidata_lakes_v2.parquet", columns=["qid", "label", "lon", "lat"])
    wdl = wdl[~wdl["qid"].isin(set(lakes["qid"].dropna())) & wdl["label"].notna()]
    polys = gpd.read_file(RAW / "HydroLAKES_polys_v10_shp/HydroLAKES_polys_v10.shp", engine="pyogrio", columns=["Hylak_id", "Lake_area"], where="Lake_area >= 10")  # the where field must be read too
    near = gpd.sjoin_nearest(gpd.GeoDataFrame(wdl, geometry=gpd.points_from_xy(wdl["lon"], wdl["lat"]), crs="EPSG:4326"), polys, max_distance=0.5)
    qid_of = dict(zip(named["Hylak_id"], named["qid"])); name_of = dict(zip(named["Hylak_id"], named["name"]))
    words = lambda n: {w for w in fold(n).replace("-", " ").split() if len(w) > 2 and w not in GENERIC}
    # strict: the same distinctive words (a shared "Lough" or "Danau" lent Irish and Indonesian lakes each other's
    # names in a first try) and a well-known item, 20 Wikipedia articles or more (the Aral Sea has about 100)
    cand = [(qid_of[h], q) for q, lbl, h in zip(near["qid"], near["label"], near["Hylak_id"])
            if h in qid_of and words(lbl) and words(lbl) == words(name_of[h])]
    sl = sitelinks(RAW / "wd_lake_sitelinks.parquet", [q for _, q in cand])
    lent = [(c, q) for c, q in cand if sl.get(q, 0) >= 20]
    parent = pd.concat([parent, pd.DataFrame(lent, columns=["qid", "p"])], ignore_index=True).drop_duplicates()
    log(t0, f"unmatched Wikidata lakes lending their names to a nearby lake: {len(lent):,} ({', '.join(f'{q}->{name_of.get(next((h for h, qq in qid_of.items() if qq == c), 0), c)}' for c, q in lent[:12])})")
    plab = aliases(RAW / "wd_lake_parent_labels.parquet", parent["p"].tolist())
    plab = plab.merge(parent, left_on="qid", right_on="p").drop(columns=["qid_x", "p"], errors="ignore")
    plab = plab.rename(columns={"qid_y": "qid"})[["qid", "lab", "lang"]].assign(lang=lambda d: "~" + d["lang"])  # after own names
    lab = pd.concat([lab, plab], ignore_index=True)
    log(t0, f"lakes that are part of another lake item: {parent['qid'].nunique():,}")
    names = defaultdict(list)
    for hid, q, n in zip(named["Hylak_id"], named["qid"], named["name"]):
        names[q].append((str(int(hid)), [n]))
    la = pick_aliases(names, lab)
    (OUT / "lake_aliases.json").write_text(json.dumps(la, separators=(",", ":"), ensure_ascii=False))
    log(t0, f"lake aliases: {sum(map(len, la.values())):,} for {len(la):,} lakes ({len(lab):,} labels)")

    rivers: dict[str, dict] = {}
    for f in sorted((v2 / "river").glob("*.json")):
        rivers.update(json.loads(f.read_text()))
    rl = aliases(RAW / "wd_river_labels.parquet", [v["wd"] for v in rivers.values() if v.get("wd")])
    rnames = defaultdict(list)
    for rid, v in rivers.items():
        if v.get("wd"):
            rnames[v["wd"]].append((rid, [x for x in (v["n"], v.get("l"), v.get("aka")) if x]))
    ra = pick_aliases(rnames, rl)
    (OUT / "river_aliases.json").write_text(json.dumps(ra, separators=(",", ":"), ensure_ascii=False))
    log(t0, f"river aliases: {sum(map(len, ra.values())):,} for {len(ra):,} rivers")

    # ---------------- river profiles, dams and irrigation (RiverATLAS) ----------------
    ra_ = pyogrio.read_dataframe(RAW / "hydroatlas/RiverATLAS_v10.gdb", read_geometry=False,
                                 columns=["HYRIV_ID", "NEXT_DOWN", "LENGTH_KM", "DIST_DN_KM", "UPLAND_SKM", "dis_m3_pyr", "dor_pc_pva", "ele_mt_cmn", "ire_pc_use"])
    log(t0, f"RiverATLAS {len(ra_):,} reaches")
    ids = ra_["HYRIV_ID"].to_numpy()
    order = np.argsort(ids)
    pos = lambda q: order[np.searchsorted(ids, q, sorter=order)]
    nd = ra_["NEXT_DOWN"].to_numpy()
    N = len(ra_)
    NEXT = np.where(nd > 0, pos(np.where(nd > 0, nd, ids[0])), -1)
    up = ra_["UPLAND_SKM"].to_numpy(); length = ra_["LENGTH_KM"].to_numpy(); dist = ra_["DIST_DN_KM"].to_numpy()
    has = NEXT >= 0
    child, parent_ = np.nonzero(has)[0], NEXT[has]
    o = np.lexsort((up[child], parent_))
    child, parent_ = child[o], parent_[o]
    last = np.r_[parent_[1:] != parent_[:-1], True]
    UPMAIN = np.full(N, -1)
    UPMAIN[parent_[last]] = child[last]
    ele = ra_["ele_mt_cmn"].to_numpy(float); qq = ra_["dis_m3_pyr"].to_numpy(float)
    dor = ra_["dor_pc_pva"].to_numpy(float) / 10; ire = ra_["ire_pc_use"].to_numpy(float)

    # the reaches of each river (tiles input of build_rivers.py: r = river id), its farthest top, then up its main branch
    rv = gpd.read_file(OUT / "rivers.geojsonl", engine="pyogrio", columns=["id", "r"])
    rv = rv[rv["r"].notna()]
    members = rv.groupby("r")["id"].apply(list)
    river_of = dict(zip(rv["id"].astype(int), rv["r"].astype(int)))
    paths: dict[int, np.ndarray] = {}
    for rid, mem in members.items():
        rid = int(rid)
        if str(rid) not in rivers:
            continue
        m = pos(np.asarray(mem))
        top = m[np.argmax(dist[m] + length[m])]
        # headwaters above the named reaches, as build_rivers.py counts them, but not into a river of another name
        # (the Amu Darya's profile starts where its name does, as its length does, not at the source of the Panj)
        while UPMAIN[top] >= 0 and river_of.get(int(ids[UPMAIN[top]]), rid) == rid:
            top = UPMAIN[top]
        root = pos(np.asarray([rid]))[0]
        p, i = [], top
        while i >= 0:
            p.append(i)
            if i == root:
                break
            i = NEXT[i]
        if p and p[-1] == root and len(p) >= 2:
            paths[rid] = np.asarray(p)
    log(t0, f"main stems: {len(paths):,}")

    # lakes and reservoirs on each main stem: outlet within 0.01 degree of one of its reaches
    on_path = np.unique(np.concatenate(list(paths.values())))
    geo = gpd.read_file(OUT / "rivers.geojsonl", engine="pyogrio", columns=["id"])
    geo = geo[geo["id"].isin(ids[on_path])]
    big = hl[(hl["Lake_area"] >= 1) | (hl["Lake_type"] > 1)]
    lp = gpd.GeoDataFrame({"lid": big["Hylak_id"].to_numpy(), "t": big["Lake_type"].to_numpy(), "a": big["Lake_area"].to_numpy()},
                          geometry=gpd.points_from_xy(big["Pour_long"], big["Pour_lat"]), crs="EPSG:4326")
    near = gpd.sjoin_nearest(lp, geo, how="inner", max_distance=0.01).drop_duplicates("lid")
    lake_at = defaultdict(list)
    lname = dict(zip(lakes["Hylak_id"], lakes["name"]))
    for lid, t, a, rid_ in zip(near["lid"], near["t"], near["a"], near["id"]):
        lake_at[int(rid_)].append((int(lid), int(t), float(a)))
    log(t0, f"lakes on main stems: {len(near):,}")

    out: dict[int, dict] = defaultdict(dict)
    for rid, p in paths.items():
        x = dist[p[0]] + length[p[0]] - dist[p] - length[p] / 2  # km from the source to the middle of each reach
        x = np.maximum(x, 0)
        keep = np.unique(np.r_[np.searchsorted(x, np.linspace(0, x[-1], 160)).clip(0, len(p) - 1), len(p) - 1])
        k = p[keep]
        zz = [None if not np.isfinite(v) or v < -500 else int(round(v)) for v in ele[k]]
        rec = {"x": [round(float(v), 1) for v in x[keep]], "z": zz, "q": [round(float(v), 1) for v in qq[k]],
               "d": [round(float(v), 1) for v in dor[k]], "ir": round(float(ire[p[-1]]), 1)}
        lk = []
        for xi, i in zip(x, p):
            for lid, t, a in lake_at.get(int(ids[i]), ()):
                lk.append([round(float(xi), 1), lid, lname.get(lid) or "", t, round(a, 1)])
        lk.sort(key=lambda z: -z[4])
        if lk:
            rec["lk"] = sorted(lk[:40], key=lambda z: z[0])
        out[rid % 128][str(rid)] = rec
    d = v2 / "profile"
    d.mkdir(parents=True, exist_ok=True)
    for s in range(128):
        (d / f"{s:03d}.json").write_text(json.dumps(out.get(s, {}), separators=(",", ":"), ensure_ascii=False, allow_nan=False))
    log(t0, f"profiles {sum(len(v) for v in out.values()):,}, {sum(f.stat().st_size for f in d.glob('*.json')) / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
