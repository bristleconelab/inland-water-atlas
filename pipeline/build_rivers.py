"""Lake Atlas: named rivers. Every HydroRIVERS reach with a name gets the id of its river, and every river gets a record:
its length, its flow, where it ends, the way to the sea, and what satellites have seen of it.

Names
  HydroRIVERS v1.0 (Lehner & Grill 2013, CC BY 4.0) has the network but no names. SWORD v17c (the SWOT River Database,
  Altenau et al. 2021; v17c 2026, CC BY 4.0) has names from OpenStreetMap for rivers about 30 m wide and more. Each
  HydroRIVERS reach (flow >= 5 m3/s) is matched at three points to the nearest SWORD reach within MATCH_DEG, if their
  drainage areas agree within a factor of 3 (so a tributary does not lend its name to the main river at a junction).
  Names are compared as keys (lower case, no accents, without "River", "Rio", "Fluss"...), so "Niger" and "Niger River"
  are one river. A reach takes the key most of its points agree on; ties ("Amur; Ussuri") follow the neighbours.
Rivers
  A river is a chain of reaches with the same key, joined downstream. Short gaps with no name (lakes on the river, a
  missed match) are filled when the same name continues below. Upstream of the last named reach the river continues up
  the branch with the largest drainage area to its farthest source, so lengths count the headwaters too.
Records (out/v2/river/NNN.json, 128 shards by river id % 128; the id is the HYRIV_ID of the river's last reach):
  n name, l local name, km length (to its farthest source, or to where it continues another named river, fromName),
  q mean flow at the end (m3/s), up drainage area (km2), g geometry (parts of 0.01 degree steps), p path from its end
  to the sea, dkm distance on to the sea, then where it ends: into (river id) + intoName, or sea, or endo + sinkName;
  w width (m, from Landsat), swot = [stretches SWOT has measured at least 5 times, their median width seen by SWOT in m],
  wd its Wikidata item. When the item is found, the name shown is its English label (Chang Jiang -> Yangtze).
  SWORD's per-stretch level range (wse_obs_range, p90 - p10) is NOT used: it includes passes of poor quality and gave
  6.7 m for the Rhone where the quality-filtered passes at Avignon move 0.5 m; the panel shows the live, filtered
  record instead.
Also out/river_names.geojsonl (one line per river, for labels) and out/rivers.geojsonl for the tiles (id, o, q, n,
r = river id, or d = the first named river downstream, s = the SWORD reach SWOT has seen most often there).
The search index comes from the records: build_search_rivers.py.

usage (on the processing server, from the project data folder):
  uv run --with geopandas --with pyogrio --with pyarrow python pipeline/build_rivers.py
"""
from __future__ import annotations

import json
import re
import time
import unicodedata
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from difflib import SequenceMatcher
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
import shapely

from seas import marine_areas, sea_names

RAW, OUT = Path("raw"), Path("out")
SHARDS = 128
MIN_Q = 5.0          # m3/s, the reaches drawn on the map
MATCH_DEG = 0.015    # about 1.5 km
GAP_STEPS = 200      # reaches walked through a nameless gap (reservoirs: SWORD lake stretches often have no name)
SMOOTH = 10          # reaches looked at up and down when smoothing names
QLEVER = "https://qlever.dev/api/wikidata"
WD_RIVERS = """PREFIX wd: <http://www.wikidata.org/entity/>
PREFIX wdt: <http://www.wikidata.org/prop/direct/>
PREFIX wikibase: <http://wikiba.se/ontology#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
SELECT ?item ?sl ?coord (SAMPLE(?enl) AS ?en) (GROUP_CONCAT(DISTINCT ?l; SEPARATOR="|") AS ?labels) WHERE {
  ?item wdt:P31 wd:Q4022 . ?item wikibase:sitelinks ?sl . FILTER(?sl >= 5)
  OPTIONAL { ?item wdt:P625 ?coord } ?item rdfs:label ?l .
  OPTIONAL { ?item rdfs:label ?enl FILTER(LANG(?enl) = "en") }
} GROUP BY ?item ?sl ?coord"""
GENERIC = re.compile(r"\b(river|rio|rivière|riviere|fleuve|fluss|reka|река|rivier|rivière|the)\b")


def key_of(name: str) -> str:
    s = unicodedata.normalize("NFKD", name.lower())
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = GENERIC.sub(" ", s)
    return re.sub(r"[\W_]+", "", s)  # letters and digits of any script


def names_of(*fields) -> list[str]:
    out = []
    for f in fields:
        if isinstance(f, str) and f and f != "NODATA":
            out += [x.strip() for x in f.split(";") if x.strip() and x.strip() != "NODATA"]
    return out


def encode(coords: np.ndarray) -> list[int]:
    q = np.round(np.asarray(coords) * 100).astype(int)
    keep = np.r_[True, np.any(np.diff(q, axis=0) != 0, axis=1)]
    q = q[keep]
    return np.vstack([q[:1], np.diff(q, axis=0)]).ravel().tolist()


def wikidata_rivers() -> dict[str, dict]:
    """Rivers with Wikipedia articles in at least 5 languages: their labels in every language and their points."""
    f = RAW / "wd_rivers_v2.tsv"  # v2: with the English label
    if not f.exists():
        req = urllib.request.Request(QLEVER, data=urllib.parse.urlencode({"query": WD_RIVERS}).encode(),
                                     headers={"Accept": "text/tab-separated-values", "User-Agent": "lakes-atlas-pipeline"})
        f.write_bytes(urllib.request.urlopen(req, timeout=300).read())
    items: dict[str, dict] = {}
    for line in f.read_text().splitlines()[1:]:
        c = line.split("\t")
        if len(c) < 5:
            continue
        q = c[0].rsplit("/", 1)[-1].rstrip(">")
        en = re.sub(r'^"(.*)"(@en)?$', r"\1", c[3]) if c[3] else ""
        it = items.setdefault(q, {"sl": int(c[1].split("^")[0].strip('"') or 0), "pts": [], "keys": set(), "en": en})
        m = re.match(r'"?POINT\(([-\d.e]+) ([-\d.e]+)\)', c[2])  # Earth points only (others carry a globe prefix)
        if m:
            it["pts"].append((float(m.group(1)), float(m.group(2))))
        it["keys"].update(k for k in (key_of(x) for x in c[4].strip('"').split("|")) if k)
    return items


def jump(parent: np.ndarray) -> np.ndarray:
    """Follow parent pointers to the end (pointer jumping): roots point to themselves."""
    p = parent.copy()
    while True:
        q = p[p]
        if np.array_equal(q, p):
            return p
        p = q


def main() -> None:
    t0 = time.time()
    log = lambda m: print(f"{m} ({time.time() - t0:.0f} s)", flush=True)

    # ---------------- network ----------------
    rv = gpd.read_file(RAW / "HydroRIVERS_v10_shp/HydroRIVERS_v10.shp", engine="pyogrio",
                       columns=["HYRIV_ID", "NEXT_DOWN", "MAIN_RIV", "LENGTH_KM", "DIST_DN_KM", "UPLAND_SKM", "ENDORHEIC", "DIS_AV_CMS", "ORD_FLOW"])
    N = len(rv)
    ids = rv["HYRIV_ID"].to_numpy()
    order = np.argsort(ids)
    pos = lambda q: order[np.searchsorted(ids, q, sorter=order)]
    nd = rv["NEXT_DOWN"].to_numpy()
    NEXT = np.where(nd > 0, pos(np.where(nd > 0, nd, ids[0])), -1)
    up = rv["UPLAND_SKM"].to_numpy()
    q = rv["DIS_AV_CMS"].to_numpy()
    length = rv["LENGTH_KM"].to_numpy()
    dist = rv["DIST_DN_KM"].to_numpy()
    geoms = rv.geometry.values
    ends = shapely.get_point(geoms, -1)
    XY = np.column_stack([shapely.get_x(ends), shapely.get_y(ends)])
    # the upstream reach with the largest drainage area ("main" branch) of each reach
    has = NEXT >= 0
    child, parent_ = np.nonzero(has)[0], NEXT[has]
    o = np.lexsort((up[child], parent_))
    child, parent_ = child[o], parent_[o]
    last = np.r_[parent_[1:] != parent_[:-1], True]
    UPMAIN = np.full(N, -1)
    UPMAIN[parent_[last]] = child[last]
    log(f"HydroRIVERS: {N:,} reaches")

    # ---------------- names from SWORD ----------------
    cols = ["reach_id", "river_name", "river_name_en", "river_name_local", "facc", "width", "type",
            "wse_obs_range", "width_obs_p50", "n_obs", "geometry"]
    sw = pd.concat([gpd.read_parquet(f, columns=cols) for f in sorted((RAW / "sword/parquet").glob("*_reaches.parquet"))], ignore_index=True)
    sw = gpd.GeoDataFrame(sw, geometry="geometry", crs="EPSG:4326")
    sw = sw[sw["type"] != 6].reset_index(drop=True)  # 6 = ghost reaches
    sw_names = [names_of(a, b) for a, b in zip(sw.river_name_en, sw.river_name)]
    sw_keys = [list(dict.fromkeys(k for k in (key_of(n) for n in ns) if k)) for ns in sw_names]
    log(f"SWORD: {len(sw):,} reaches, {sum(1 for k in sw_keys if k):,} named")

    big = np.nonzero(q >= MIN_Q)[0]
    fr = np.repeat([0.25, 0.5, 0.75], len(big))
    rows = np.tile(big, 3)
    pts = shapely.line_interpolate_point(geoms[rows], fr, normalized=True)
    pg = gpd.GeoDataFrame({"row": rows}, geometry=pts, crs="EPSG:4326")
    m = gpd.sjoin_nearest(pg, sw[["facc", "geometry"]], how="inner", max_distance=MATCH_DEG, distance_col="dd")
    m = m.sort_values("dd").reset_index().drop_duplicates("index")  # one SWORD reach per point
    ratio = m["facc"].to_numpy() / np.maximum(up[m["row"].to_numpy()], 1e-6)
    m = m[(ratio > 1 / 3) & (ratio < 3)]
    log(f"matched points: {len(m):,} of {len(pg):,}")

    # the SWORD reach SWOT has seen most often near each reach: the panel asks SWOT's time series service for it
    m["nobs"] = sw["n_obs"].fillna(0).to_numpy()[m["index_right"].to_numpy()]
    best = m.sort_values(["nobs", "dd"], ascending=[False, True]).drop_duplicates("row")
    SWID = dict(zip(best["row"], sw["reach_id"].to_numpy()[best["index_right"].to_numpy()]))
    votes: dict[int, Counter] = defaultdict(Counter)
    sw_of: dict[int, set] = defaultdict(set)
    for r, s in zip(m["row"].to_numpy(), m["index_right"].to_numpy()):
        sw_of[r].add(s)
        for k in sw_keys[s]:
            votes[r][k] += 1
    KEY = np.full(N, -1)               # index into keys
    keys: list[str] = []
    kid: dict[str, int] = {}

    def ki(k: str) -> int:
        if k not in kid:
            kid[k] = len(keys)
            keys.append(k)
        return kid[k]
    ties: dict[int, list[str]] = {}
    for r, c in votes.items():
        top = c.most_common()
        best = [k for k, v in top if v == top[0][1]]
        if len(best) == 1:
            KEY[r] = ki(best[0])
        else:
            ties[r] = best
    for _ in range(3):  # ties follow a neighbour that has a key
        for r, cand in list(ties.items()):
            nb = [KEY[x] for x in (NEXT[r], UPMAIN[r]) if x >= 0 and KEY[x] >= 0]
            pick = next((k for k in cand if kid.get(k) in nb), None)
            if pick:
                KEY[r] = kid[pick]
                del ties[r]
    for r, cand in ties.items():
        KEY[r] = ki(cand[0])
    log(f"reaches with a name: {(KEY >= 0).sum():,}")

    # one river, several spellings: keys that SWORD often gives the same reach (in its name, English name and local
    # name fields: "Volga" and "Волга"), and near-identical keys that follow each other downstream ("amudarya" and
    # "amudaryo"). A confluence reach that lists both rivers ("Danube; Olt") is rare compared with either river, so the
    # pair has to cover a good share of the smaller one.
    uf = list(range(len(keys)))
    def find(a: int) -> int:
        while uf[a] != a:
            uf[a] = uf[uf[a]]
            a = uf[a]
        return a
    seen_k: Counter = Counter()
    pairs: Counter = Counter()
    for s in {s for ss in sw_of.values() for s in ss}:
        ks = sorted({kid[k] for k in (key_of(n) for n in names_of(sw.river_name[s], sw.river_name_en[s], sw.river_name_local[s])) if k in kid})
        seen_k.update(ks)
        pairs.update((a, b) for i, a in enumerate(ks) for b in ks[i + 1:])
    joined = 0
    for (a, b), c in pairs.items():
        if c >= 5 and c >= 0.3 * min(seen_k[a], seen_k[b]) and find(a) != find(b):
            uf[find(a)] = find(b)
            joined += 1
    nk = np.where(NEXT >= 0, KEY[np.maximum(NEXT, 0)], -1)
    for a, b in set(zip(KEY[(KEY >= 0) & (nk >= 0) & (nk != KEY)], nk[(KEY >= 0) & (nk >= 0) & (nk != KEY)])):
        ka, kb = keys[a], keys[b]
        if min(len(ka), len(kb)) >= 5 and find(a) != find(b) and SequenceMatcher(None, ka, kb).ratio() >= 0.8:
            uf[find(a)] = find(b)
            joined += 1
    # translations: two names that follow each other downstream and are labels of the same Wikidata river
    # ("Donau" above "Danube")
    wd = wikidata_rivers()
    items_of: dict[int, set] = defaultdict(set)
    for q_, it in wd.items():
        for k in it["keys"]:
            if k in kid:
                items_of[kid[k]].add(q_)
    for a, b in set(zip(KEY[(KEY >= 0) & (nk >= 0) & (nk != KEY)], nk[(KEY >= 0) & (nk >= 0) & (nk != KEY)])):
        if find(a) != find(b) and items_of[a] & items_of[b]:
            uf[find(a)] = find(b)
            joined += 1
    canon = np.array([find(a) for a in range(len(keys))])
    KEY[KEY >= 0] = canon[KEY[KEY >= 0]]
    items_raw = {k: set(v) for k, v in items_of.items()}  # by the exact name, before spellings were joined
    wd_by_key: dict[str, set] = defaultdict(set)  # any label in any language -> items (for local names: 长江, Енисей)
    for q_, it in wd.items():
        for k in it["keys"]:
            wd_by_key[k].add(q_)
    for k in list(items_of):
        items_of[canon[k]] |= items_of[k]
    log(f"spellings joined: {joined:,} ({len(wd):,} Wikidata rivers)")

    # smoothing: a reach takes name X when X is the name of most of the next SMOOTH reaches downstream and also continues
    # up at least one of the branches above it. Fixes a main-river reach that SWORD named after a side channel or the
    # tributary joining there (the Volga below the Oka), but keeps a tributary's own last reaches (the Missouri).
    kids_lo = np.searchsorted(parent_, np.arange(N), "left")
    kids_hi = np.searchsorted(parent_, np.arange(N), "right")
    def chain(i: int, step: np.ndarray) -> Counter:
        c: Counter = Counter()
        for _ in range(SMOOTH):
            if i < 0:
                break
            if KEY[i] >= 0:
                c[KEY[i]] += 1
            i = step[i]
        return c
    for _ in range(4):  # a run of wrongly named reaches is fixed from the top, one more reach each round
        change = {}
        for i in np.nonzero(KEY >= 0)[0]:
            down = chain(NEXT[i], NEXT)
            if not down:
                continue
            x, cx = down.most_common(1)[0]
            if x == KEY[i] or cx * 2 <= sum(down.values()):
                continue
            if any(x in chain(c, UPMAIN) for c in child[kids_lo[i]:kids_hi[i]]):
                change[i] = x
        for i, x in change.items():
            KEY[i] = x
        log(f"smoothed reaches: {len(change):,}")

    # gaps: from the last reach of a named chain, walk down through nameless reaches; same name below -> fill
    def fill_gaps() -> int:
        filled = 0
        mouths = np.nonzero((KEY >= 0) & (NEXT >= 0) & (KEY[np.maximum(NEXT, 0)] != KEY))[0]
        for r0 in mouths:
            k, path, i = KEY[r0], [], NEXT[r0]
            while i >= 0 and KEY[i] < 0 and len(path) < GAP_STEPS:
                path.append(i)
                i = NEXT[i]
            if path and i >= 0 and KEY[i] == k:
                KEY[path] = k
                filled += len(path)
        return filled
    log(f"gap reaches filled: {fill_gaps():,}")

    # a stretch with another name between two stretches of the same river is part of that river: the upper Danube is
    # "Danube" in SWORD, then "Donau" for 700 km, then "Danube" again; the Ob has a "Sharap" stretch in the middle
    def chains() -> tuple[np.ndarray, dict[int, np.ndarray]]:
        par = np.arange(N)
        same = (KEY >= 0) & (NEXT >= 0) & (KEY[np.maximum(NEXT, 0)] == KEY)
        par[same] = NEXT[same]
        root = jump(par)
        named = np.nonzero(KEY >= 0)[0]
        o = np.argsort(root[named], kind="stable")
        r_sorted = root[named][o]
        cuts = np.nonzero(np.diff(r_sorted))[0] + 1
        return root, dict(zip(r_sorted[np.r_[0, cuts]], np.split(named[o], cuts)))
    _, groups = chains()
    relabel = 0
    def named_from(i: int, step: np.ndarray) -> tuple[int, list[int]]:
        """The first named reach from i on (i included), and the nameless ones passed on the way."""
        gap = []
        while i >= 0 and KEY[i] < 0 and len(gap) < GAP_STEPS:
            gap.append(i)
            i = step[i]
        return (i if i >= 0 and KEY[i] >= 0 else -1), gap
    for b, mem in groups.items():
        x, below = named_from(NEXT[b], NEXT) if NEXT[b] >= 0 else (-1, [])
        if x < 0 or KEY[x] == KEY[b]:
            continue
        ka, kb = KEY[x], KEY[b]
        # the highest reach of B where river A comes in from above (maybe through a nameless stretch, such as a
        # reservoir): from there down, B is really A
        best = None
        for m_ in mem:
            for c in child[kids_lo[m_]:kids_hi[m_]]:
                if KEY[c] == kb:
                    continue
                y, above = named_from(c, UPMAIN)
                if y >= 0 and KEY[y] == ka and (best is None or dist[m_] > dist[best[0]]):
                    best = (m_, above)
        if best is None:
            continue
        i, above = best
        path = list(above) + list(below)
        while True:
            path.append(i)
            if i == b:
                break
            i = NEXT[i]
        KEY[path] = ka
        relabel += len(path)
    log(f"reaches joined to the river above and below them: {relabel:,}")

    # a river cut by several stretches in a row that SWORD named after tributaries (the Yenisei below the Sayan:
    # "Oya", "Abakan", then "Sisim" at the Krasnoyarsk reservoir; the Mekong: "H.Kadian", "Nam Lepou"). From the farthest
    # top of each river, climb the main branch; if the same name comes back within half the river's length (and 1,500
    # km), the main-branch reaches on the way are that river. Only the main stem is renamed: the tributaries' own
    # branches keep their names.
    same_above = np.zeros(N, bool)
    same_above[parent_[(KEY[child] >= 0) & (KEY[child] == KEY[parent_])]] = True
    _, groups = chains()
    rejoined = 0
    for b, mem in sorted(groups.items(), key=lambda kv: -len(kv[1])):
        k = KEY[b]
        if np.any(KEY[mem] != k):
            continue  # part of it was renamed by a bigger river just now
        cand = mem[~same_above[mem]]
        if not len(cand):
            continue
        top = cand[np.argmax(dist[cand] + length[cand])]
        limit = min(1500.0, max(300.0, 0.5 * float(dist[top] + length[top] - dist[b])))
        path, i = [], UPMAIN[top]
        while i >= 0 and KEY[i] != k and dist[i] - dist[top] <= limit:
            path.append(i)
            i = UPMAIN[i]
        if path and i >= 0 and KEY[i] == k:
            KEY[path] = k
            rejoined += len(path)
    log(f"main-stem reaches rejoined to their river: {rejoined:,}")

    # headwaters: up the main branch from the top of each named chain, while nameless
    # (only from a real top: no branch above it has the same name. Below Lyon the Saone is the bigger branch and has no
    # name in SWORD; starting there would have carried the Rhone's name up the Saone)
    # and only from the top farthest from the river's end, one per river: a stretch of the Rhone's name on the Saone
    # side of the Lyon junction is a top too, and climbing from there would still run up the Saone)
    same_above = np.zeros(N, bool)
    same_above[parent_[(KEY[child] >= 0) & (KEY[child] == KEY[parent_])]] = True
    _, groups = chains()
    tops = []
    for mem in groups.values():
        cand = mem[~same_above[mem]]
        if len(cand):
            tops.append(cand[np.argmax(dist[cand] + length[cand])])
    ext = 0
    for t in tops:
        k, i = KEY[t], UPMAIN[t]
        while i >= 0 and KEY[i] < 0:
            KEY[i] = k
            ext += 1
            i = UPMAIN[i]
    log(f"headwater reaches added: {ext:,}")

    # rivers: root = last reach of the chain with the same key
    par = np.arange(N)
    same = (KEY >= 0) & (NEXT >= 0) & (KEY[np.maximum(NEXT, 0)] == KEY)
    par[same] = NEXT[same]
    ROOT = jump(par)
    named = np.nonzero(KEY >= 0)[0]
    # first named reach at or below each reach (for nameless ones: the river they flow into)
    par2 = np.where(KEY >= 0, np.arange(N), np.where(NEXT >= 0, NEXT, np.arange(N)))
    DOWN = jump(par2)
    log(f"rivers: {len(np.unique(ROOT[named])):,}")

    # ---------------- where rivers end ----------------
    lakes = pd.read_parquet(OUT / "lakes.parquet", columns=["Hylak_id", "name"])
    lnames = lakes.set_index("Hylak_id")["name"]
    roots = np.unique(ROOT[named])
    outlet = pos(rv["MAIN_RIV"].to_numpy()[roots])
    op = gpd.GeoDataFrame({"row": np.unique(outlet)}, geometry=gpd.points_from_xy(XY[np.unique(outlet), 0], XY[np.unique(outlet), 1]), crs="EPSG:4326")
    lp = gpd.read_file(RAW / "HydroLAKES_polys_v10_shp/HydroLAKES_polys_v10.shp", engine="pyogrio", columns=["Hylak_id", "Lake_area"])
    sink = gpd.sjoin_nearest(op, lp, how="left", max_distance=0.05).sort_values("Lake_area", ascending=False).drop_duplicates("row")
    sink_id = dict(zip(sink["row"], sink["Hylak_id"]))
    sea_name = sea_names(op, marine_areas(RAW))  # pipeline/seas.py: real seas only, not river mouths ("Canal do Sul")
    endo = rv["ENDORHEIC"].to_numpy()
    log("outlets named")

    # ---------------- records ----------------
    members: dict[int, list[int]] = defaultdict(list)
    for r in named:
        members[ROOT[r]].append(r)
    disp: dict[int, Counter] = defaultdict(Counter)
    local: dict[int, Counter] = defaultdict(Counter)
    is_key = lambda n, k: kid.get(key_of(n)) is not None and canon[kid[key_of(n)]] == k
    for r in named:
        for s in sw_of.get(r, ()):
            own = [n for n in names_of(sw.river_name_en[s], sw.river_name[s]) if is_key(n, KEY[r])]
            for n in names_of(sw.river_name_en[s]):  # the English name counts twice: "Amu Darya" over "Amudaryo"
                if is_key(n, KEY[r]):
                    disp[ROOT[r]][n] += 1
            for n in own:
                disp[ROOT[r]][n] += 1
            if own:  # a local name only from this river's own stretches, not from a side channel next to it
                for n in names_of(sw.river_name_local[s]):
                    local[ROOT[r]][n] += 1
    swd = sw[["width", "wse_obs_range", "width_obs_p50", "n_obs"]].to_numpy(dtype=float)
    rivers: dict[int, dict] = {}
    names_out = []  # one merged line per river, for the map labels (HydroRIVERS reaches are too short to carry them)
    ordf = rv["ORD_FLOW"].to_numpy()
    for root, mem in members.items():
        if not disp[root]:
            continue  # a chain made only of filled or headwater reaches cannot happen, but be safe
        name = disp[root].most_common(1)[0][0]
        tot = sum(local[root].values())
        loc = next((n for n, c in local[root].most_common(1) if key_of(n) != key_of(name) and c >= 0.3 * tot), None)
        mem = np.array(mem)
        top = mem[np.argmax(dist[mem] + length[mem])]
        km = float(dist[top] + length[top] - dist[root])
        line = shapely.line_merge(shapely.union_all(geoms[mem]))
        parts = [shapely.simplify(g, 0.01) for g in getattr(line, "geoms", [line])]
        # smooth enough for a label to follow it (a jagged line gets no label: MapLibre's text-max-angle)
        names_out.append((int(ids[root]), name, int(ordf[mem].min()), shapely.simplify(line, 0.008)))
        rec = {"n": name, "km": round(km), "q": round(float(q[root]), 1), "up": round(float(up[root])),
               "g": [encode(np.asarray(g.coords)) for g in parts if len(g.coords) > 1]}
        if loc:
            rec["l"] = loc
        if UPMAIN[top] >= 0 and KEY[UPMAIN[top]] >= 0:
            rec["from"] = int(ids[ROOT[UPMAIN[top]]])  # above its first reach it is another named river
        # the way on from its end
        pts, i = [], NEXT[root]
        while i >= 0:
            pts.append(XY[i])
            i = NEXT[i]
        if pts:
            path = shapely.simplify(shapely.LineString([XY[root]] + pts), 0.02)
            rec["p"] = encode(np.asarray(path.coords))
            rec["dkm"] = round(float(dist[root]))
            into = DOWN[NEXT[root]]
            if KEY[into] >= 0:
                rec["into"] = int(ids[ROOT[into]])
        out = pos(rv["MAIN_RIV"].to_numpy()[root])
        if endo[root]:
            rec["endo"] = 1
            sid = sink_id.get(out)
            if sid is not None and not pd.isna(sid):
                n = lnames.get(int(sid))
                if isinstance(n, str) and n:
                    rec["sinkName"] = n
        else:
            rec["sea"] = sea_name.get(out)
        seen = sorted({s for r in mem for s in sw_of.get(r, ())})
        if seen:
            d = swd[seen]
            w = d[:, 0][d[:, 0] > 0]
            if len(w):
                rec["w"] = round(float(np.median(w)))
            obs = d[d[:, 3] >= 5]  # stretches SWOT measured at least 5 times
            if len(obs) >= 3:
                wo = obs[:, 2][obs[:, 2] > 0]
                rec["swot"] = [len(obs), round(float(np.median(wo))) if len(wo) else None]
        # its Wikidata item. Candidates: rivers labelled (in any language) with one of its main names: a name that is at
        # least a fifth of the names on its SWORD stretches, English or local, so a tributary's name on a confluence
        # stretch (乌江 on the Yangtze) brings no candidate. Score: Wikipedia articles, in full when the item's point is
        # within 1.5 degrees of the river, at half for a well-known river (80 articles or more) within 20 degrees,
        # because a river's one point is often its source or mouth, beyond the stretch named here (the Yangtze's is in
        # Tibet, the Yenisey's in Tuva). Sorted by score then id, so the choice is the same on every run.
        def main_names(c: Counter) -> list[str]:
            tot = sum(c.values())
            return [n_ for n_, k_ in c.items() if k_ >= 0.2 * tot]
        cands = set(items_of.get(KEY[root], ())) | set(items_raw.get(kid.get(key_of(name), -1), ()))
        for n_ in main_names(disp[root]) + main_names(local[root]):
            cands |= wd_by_key.get(key_of(n_), set())
        pts_m = XY[mem]
        def score(q: str) -> float:
            it = wd[q]
            d = min((float(np.min(np.abs(pts_m - np.array(pt)).max(axis=1))) for pt in it["pts"]), default=np.inf)
            return it["sl"] if d <= 1.5 else it["sl"] * 0.5 if (d <= 20 and it["sl"] >= 80) else 0.0
        scored = sorted(((score(q), q) for q in cands), key=lambda x: (-x[0], x[1]))
        best_q = scored[0][1] if scored and scored[0][0] > 0 else None
        if best_q:
            rec["wd"] = best_q
            en = wd[best_q]["en"]
            if en and en != rec["n"]:
                was = rec["n"]
                rec["n"] = en
                if rec.get("l") and key_of(rec["l"]) == key_of(en):
                    del rec["l"]  # the local name was the English one ("Amu Darya")
                if key_of(was) != key_of(en) and key_of(was) != key_of(rec.get("l", "")):
                    if rec.get("l"):
                        rec["aka"] = was  # searchable, not shown ("Chang Jiang" when the local name is 长江)
                    else:
                        rec["l"] = was  # "Amudaryo"
        rec["_basin"] = int(out)
        rivers[int(ids[root])] = rec
    # the same name twice at one sea (or one inland basin), not joined: the smaller one with a different local name is shown by that name
    # (a tributary of the Yenisei Gulf, its own system in HydroRIVERS, carries "Yenisei River" in SWORD's English field, "Большая Хета" locally)
    biggest: dict[tuple, int] = {}
    for rid_, rec in rivers.items():
        kk = (rec.get("sea") or rec["_basin"], key_of(rec["n"]))
        if kk not in biggest or rec["q"] > rivers[biggest[kk]]["q"]:
            biggest[kk] = rid_
    renamed = 0
    for rid_, rec in rivers.items():
        big_ = rivers[biggest[(rec.get("sea") or rec["_basin"], key_of(rec["n"]))]]
        rec.pop("_basin")
        if big_ is not rec and rec.get("wd") and rec["wd"] == big_.get("wd"):
            continue  # two pieces of one river (same Wikidata item): both keep its name
        if big_ is not rec and rec.get("l"):
            rec["n"] = rec.pop("l")
            renamed += 1
    log(f"duplicates shown by their local name: {renamed:,}")
    for rec in rivers.values():
        if "from" in rec:
            rec["fromName"] = rivers.get(rec.pop("from"), {}).get("n")
            if rec["fromName"] is None or rec["fromName"] == rec["n"]:
                del rec["fromName"]
        if "into" in rec:
            rec["intoName"] = rivers.get(rec["into"], {}).get("n")
            if rec["intoName"] is None:
                del rec["into"], rec["intoName"]
    log(f"river records: {len(rivers):,}")

    d = OUT / "v2/river"
    d.mkdir(parents=True, exist_ok=True)
    shards: dict[int, dict] = defaultdict(dict)
    for k, v in rivers.items():
        shards[k % SHARDS][str(k)] = v
    for s in range(SHARDS):
        (d / f"{s:03d}.json").write_text(json.dumps(shards.get(s, {}), separators=(",", ":"), ensure_ascii=False, allow_nan=False))

    # ---------------- tiles ----------------
    t = rv.iloc[big][["HYRIV_ID", "ORD_FLOW", "DIS_AV_CMS", "geometry"]].rename(columns={"HYRIV_ID": "id", "ORD_FLOW": "o", "DIS_AV_CMS": "q"})
    t["q"] = t["q"].round(1)
    rid = np.where(KEY[big] >= 0, ids[ROOT[big]], 0)
    rid = np.where(np.isin(rid, list(rivers)), rid, 0)
    did = np.where((rid == 0) & (KEY[DOWN[big]] >= 0), ids[ROOT[DOWN[big]]], 0)
    did = np.where(np.isin(did, list(rivers)), did, 0)
    t["r"] = pd.array(np.where(rid > 0, rid, None), dtype="Int64")
    t["d"] = pd.array(np.where(did > 0, did, None), dtype="Int64")
    t["n"] = [rivers[x]["n"] if x else None for x in rid]
    t["s"] = pd.array([SWID.get(r) for r in big], dtype="Int64")
    t.to_file(OUT / "rivers.geojsonl", driver="GeoJSONSeq", engine="pyogrio")
    log(f"tiles input: {len(t):,} reaches, {(rid > 0).sum():,} named")

    with open(OUT / "river_names.geojsonl", "w") as f:
        for rid_, name, o_, g in names_out:
            if int(rid_) in rivers and not g.is_empty:
                f.write(json.dumps({"type": "Feature", "properties": {"r": rid_, "n": name, "o": o_},
                                    "geometry": json.loads(shapely.to_geojson(g))}, ensure_ascii=False) + "\n")

    size = sum(f.stat().st_size for f in d.glob("*.json"))
    log(f"records {size / 1e6:.1f} MB (search index: build_search_rivers.py)")


if __name__ == "__main__":
    main()
