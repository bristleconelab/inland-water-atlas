"""Data-quality checks on what the pipeline publishes. Run after a build, before deploying the tile site:

  DATA=../lakes-atlas-tiles/v2 APP_DATA=public/data uvx pytest -q pipeline/test_outputs.py

Each check guards a bug that once reached the live map (the docstrings say which).
"""
from __future__ import annotations

import json
import math
import os
import re
from pathlib import Path

import pytest

DATA = Path(os.environ.get("DATA", "../lakes-atlas-tiles/v2"))
APP = Path(os.environ.get("APP_DATA", "public/data"))
NOT_A_SEA = re.compile(r"\b(river|rio|río|canal|boca|estuary|delta)\b", re.I)


def shards(kind: str) -> dict:
    out: dict = {}
    for f in sorted((DATA / kind).glob("*.json")):
        out.update(json.loads(f.read_text()))
    return out


@pytest.fixture(scope="module")
def water() -> dict:
    return shards("water")


@pytest.fixture(scope="module")
def rivers() -> dict:
    return shards("river")


def test_water_has_no_negative_or_part_years(water):
    """Hylak 14355 once showed -16.9 million m3, and a part year (2026) entered the trend."""
    assert len(water) > 20_000
    for k, w in water.items():
        vals = [v for v in w["v"] if v is not None]
        assert all(v >= 0 and math.isfinite(v) for v in vals), k
        assert w["y0"] + len(w["v"]) - 1 <= 2025, k


def test_no_lake_or_river_ends_in_a_river_mouth(rivers):
    """35,336 lakes once flowed 'to the Saint Lawrence River' (a Natural Earth marine polygon)."""
    bad = [k for k, f in shards("flow").items() if f.get("sea") and NOT_A_SEA.search(f["sea"])]
    bad += [k for k, r in rivers.items() if r.get("sea") and NOT_A_SEA.search(r["sea"])]
    assert not bad, bad[:10]


# atlas lengths of docs/validation.md (2026-11-26); a river that breaks or loses its source moves far from them
LENGTHS = {"Volga": 3539, "Danube": 2776, "Rhône": 795, "Ob": 3911, "Lena": 4531, "Mississippi": 3642, "Niger": 4051, "Yenisei": 2726, "Mekong": 2596}


@pytest.mark.parametrize("name,km", LENGTHS.items())
def test_big_rivers_keep_their_length(rivers, name, km):
    """The Yenisei was once in 5 pieces, the Mekong in 2."""
    recs = [r for r in rivers.values() if r["n"].removesuffix(" River") == name]
    assert recs, name
    best = max(recs, key=lambda r: r["q"])
    assert 0.9 * km <= best["km"] <= 1.1 * km, (name, best["km"])


def test_trend_matches_water(water):
    t = json.loads((DATA / "trend.json").read_text())
    assert len(t) > 10_000
    assert set(t) <= set(water)
    assert all(c in (0, 1, 2) and 0 <= p <= 1 for _, p, c in t.values())


def test_limno_values_are_physical():
    lim = shards("limno")
    assert len(lim) > 1_400_000
    for k, (shore, dev, tau, wshd, q) in list(lim.items())[::97]:
        assert shore is None or shore > 0, k
        assert dev is None or dev >= 1, k  # a circle has the shortest shore
        assert tau is None or tau >= 0, k
        assert wshd is None or wshd >= 0, k


def test_profiles_run_downhill_in_distance():
    pr = shards("profile")
    assert len(pr) > 5_000
    for k, p in pr.items():
        assert p["x"] == sorted(p["x"]), k
        assert len(p["x"]) == len(p["z"]) == len(p["q"]) == len(p["d"]), k
        assert all(0 <= d <= 1000 for d in p["d"]), k
        assert all(z is None or -500 <= z <= 9000 for z in p["z"]), k


def test_endorheic_lakes_include_the_known_ones():
    """The biggest lakes with no outlet must be in the list; Baikal and Ladoga (they drain to the sea) must not."""
    endo = set(json.loads((DATA / "endo.json").read_text()))
    ix = json.loads((APP / "search.json").read_text())
    first = {}
    for n, i in zip(ix["n"], ix["id"]):  # biggest first: the first hit of a name is the big lake
        first.setdefault(n, i)
    for name in ("Caspian Sea", "Titicaca", "Issyk Kul", "Balkhash", "Great Salt"):
        assert first.get(name) in endo, name
    for name in ("Baikal", "Ladoga"):
        assert first.get(name) not in endo, name
    assert len(endo) > 10_000


def test_stats_add_up():
    s = json.loads((APP / "stats.json").read_text())
    assert s["published"] + s["seen"] + s["modelled"] == s["lakes"]
    for k in ("areaShareKnown", "volShareKnown"):
        assert 0 < s[k] < 1


def test_search_indexes_are_aligned():
    for f, cols in (("search.json", ("n", "id", "x", "y", "a", "t", "c")), ("search_rivers.json", ("n", "id", "x", "y", "q", "km", "to"))):
        ix = json.loads((APP / f).read_text())
        n = len(ix["n"])
        assert all(len(ix[c]) == n for c in cols), f
        assert all(0 <= int(i) < n and name for i, name in ix.get("o", {}).items()), f
