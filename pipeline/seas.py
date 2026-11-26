"""Where a river reaches the sea: the name of the nearest Natural Earth marine area (1:10m, public domain).

Natural Earth also draws big river mouths and estuaries as marine areas ("Saint Lawrence River", "Amazon River",
"Canal do Sul", "Boca Grande"). Naming the sea after them made 35,336 lakes "flow to" a river (2026-11-26 audit).
Such a mouth area now takes the name of the real sea it opens into (the one nearest to the area itself, which it
usually touches): the Saint Lawrence estuary -> Gulf of Saint Lawrence. Taking the sea nearest to the outlet point
instead sent the Great Lakes to the Gulf of Maine, which is closer to Quebec as the crow flies but not by water.
An outlet more than COAST_DEG from any marine area is not a river mouth: HydroRIVERS stops there
without saying where the water goes (Lake Chany came out as "0 km to the Gulf of Ob" before this check). Big estuaries
end well short of the sea polygon (the Yenisey by 1.2 degrees), hence the generous limits.
"""
from __future__ import annotations

import re
import urllib.request
import zipfile
from pathlib import Path

import geopandas as gpd
import numpy as np

NE_MARINE = "https://naciscdn.org/naturalearth/10m/physical/ne_10m_geography_marine_polys.zip"
COAST_DEG = 2.5   # an outlet this close to any marine area is a river mouth
SEA_DEG = 8.0     # how far a mouth area may be from the sea it opens into
NOT_A_SEA = re.compile(r"\b(river|rio|río|canal|boca|estuary|delta)\b", re.IGNORECASE)


def marine_areas(raw: Path) -> gpd.GeoDataFrame:
    ne = raw / "ne_10m_geography_marine_polys.zip"
    if not ne.exists():
        urllib.request.urlretrieve(NE_MARINE, ne)
    with zipfile.ZipFile(ne) as z:
        shp = next(n for n in z.namelist() if n.endswith(".shp"))
    m = gpd.read_file(f"zip://{ne}!{shp}", engine="pyogrio", columns=["name", "featurecla"])
    m["name"] = m["name"].fillna("")
    m["is_sea"] = (m["name"] != "") & (m["featurecla"] != "river") & ~m["name"].str.contains(NOT_A_SEA)
    return m


def sea_names(points: gpd.GeoDataFrame, marine: gpd.GeoDataFrame, key: str = "row") -> dict:
    """points[key] -> name of the sea it reaches, or None when the outlet is not on a coast."""
    marine = marine.reset_index(drop=True)
    seas = marine[marine["is_sea"]]
    # each mouth area -> the real sea nearest to the area (it opens into it)
    mouths = marine[~marine["is_sea"]]
    opens = gpd.sjoin_nearest(mouths[["geometry"]], seas[["name", "geometry"]], how="left", distance_col="deg")
    opens = opens.sort_values("deg").groupby(level=0).first()
    into = {i: (n if d <= SEA_DEG else None) for i, n, d in zip(opens.index, opens["name"], opens["deg"])}
    near = gpd.sjoin_nearest(points, marine[["name", "is_sea", "geometry"]], how="left", distance_col="deg").drop_duplicates(key)
    out = {}
    for k, i, d in zip(near[key], near["index_right"], near["deg"]):
        if not d <= COAST_DEG:
            out[k] = None
        elif marine.at[i, "is_sea"]:
            out[k] = marine.at[i, "name"]
        else:
            out[k] = into.get(i)
    return out
