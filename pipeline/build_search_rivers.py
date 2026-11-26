"""Search index of named rivers -> out/search_rivers.json, from the river records of build_rivers.py (out/v2/river).

  {"n": [names], "id": [river id], "x": [lon*100], "y": [lat*100], "q": [m3/s at its end], "km": [length],
   "to": [where it ends: the river it joins, else its sea or inland lake, "" when unknown]}
"to" tells apart rivers of one name in the results (three "Yangtze River" stretches, 13 "Xi River").
Rivers of at least 20 km, biggest flow first. A river is listed under its name, its local name and its former SWORD
name when they differ (Amu Darya / Amudaryo, Volga / Волга, Yangtze / Chang Jiang), so each finds it once per name.

usage (from the project data folder, after build_rivers.py): python3 pipeline/build_search_rivers.py
"""
import json
from pathlib import Path

rows = []
for f in sorted(Path("out/v2/river").glob("*.json")):
    for rid, v in json.loads(f.read_text()).items():
        if v["km"] < 20 or not v["g"]:
            continue
        part = max(v["g"], key=len)  # a point in the middle of its longest part
        x = y = 0
        pts = []
        for i in range(0, len(part) - 1, 2):
            x += part[i]; y += part[i + 1]
            pts.append((x, y))
        mx, my = pts[len(pts) // 2]
        for name in dict.fromkeys(n for n in (v["n"], v.get("l"), v.get("aka")) if n):
            to = v.get("intoName") or v.get("sea") or v.get("sinkName") or ""
            rows.append((name, int(rid), mx, my, v["q"], v["km"], to))
rows.sort(key=lambda r: -r[4])
out = {k: [r[i] for r in rows] for i, k in enumerate(("n", "id", "x", "y", "q", "km", "to"))}
Path("out/search_rivers.json").write_text(json.dumps(out, separators=(",", ":"), ensure_ascii=False))
print(f"{len(rows):,} names for {len({r[1] for r in rows}):,} rivers -> out/search_rivers.json")
