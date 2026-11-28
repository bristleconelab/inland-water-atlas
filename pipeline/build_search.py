"""Search index of named lakes -> out/search.json: parallel arrays, biggest lakes first so a prefix search can stop early.

  {"n": [names], "id": [Hylak_id], "x": [lon*100], "y": [lat*100], "a": [area km2, rounded], "t": [tier], "c": [country],
   "an": [names in other languages], "ai": [the row of the lake each of them names]}
The country tells apart lakes of the same name (33 lakes are called Victoria). A lake is also listed under its Wikidata
labels in other languages (out/lake_aliases.json from build_extra.py: Orol dengizi, Аральское море, Chorvoq suv
ombori), kept apart so the lake's other columns are not repeated.

usage (on the processing server, from the project data folder): python3 pipeline/build_search.py   (reads out/lakes_points.geojsonl)
"""
import json
from pathlib import Path

aliases = json.loads(Path("out/lake_aliases.json").read_text()) if Path("out/lake_aliases.json").exists() else {}
rows = []
with open("out/lakes_points.geojsonl") as f:
    for line in f:
        ft = json.loads(line)
        p, (lon, lat) = ft["properties"], ft["geometry"]["coordinates"]
        rows.append((p["name"], p["id"], round(lon * 100), round(lat * 100), round(p["a"], 1), p["tier"], p.get("c") or ""))
rows.sort(key=lambda r: -r[4])
out = {k: [r[i] for r in rows] for i, k in enumerate(("n", "id", "x", "y", "a", "t", "c"))}
out["an"], out["ai"] = [], []
for i, r in enumerate(rows):
    for al in aliases.get(str(r[1]), ()):
        out["an"].append(al); out["ai"].append(i)
with open("out/search.json", "w") as f:
    json.dump(out, f, separators=(",", ":"), ensure_ascii=False)
print(f"{len(rows):,} lakes, {len(out['an']):,} names in other languages -> out/search.json")
