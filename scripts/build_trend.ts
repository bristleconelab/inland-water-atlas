// Water trend of every GloLakes lake for the "drying or filling" map view, computed with the same functions the lake
// panel uses (src/trend.ts, src/v2.ts), so the map and the panel never disagree.
// usage: node scripts/build_trend.ts ../lakes-atlas-tiles/v2   (reads water/NNN.json, writes trend.json)
// trend.json: {"id": [percent of the usual volume a decade (1 decimal), p (3 decimals), class]}; class 1 = clear
// fall, 2 = clear rise, 0 = no clear trend. Lakes whose water comes and goes get no trend, as in the panel.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { trend } from '../src/trend.ts';
import { waterSummary, type Water } from '../src/v2.ts';

const dir = process.argv[2] ?? '../lakes-atlas-tiles/v2';
const out: Record<string, [number, number, number]> = {};
let n = 0, fall = 0, rise = 0;
for (const f of readdirSync(join(dir, 'water')).filter((x) => x.endsWith('.json')).sort()) {
  const shard = JSON.parse(readFileSync(join(dir, 'water', f), 'utf8')) as Record<string, Water>;
  for (const [id, w] of Object.entries(shard)) {
    n++;
    const sum = waterSummary(w);
    if (!sum || sum.words.startsWith('Its water comes and goes')) continue;
    const t = trend(w.y0, w.v);
    if (!t || !(t.level > 0)) continue;
    const clear = t.p < 0.05 && !(t.lo <= 0 && t.hi >= 0);
    const cls = clear ? (t.slope < 0 ? 1 : 2) : 0;
    if (cls === 1) fall++; if (cls === 2) rise++;
    out[id] = [Math.round(((t.slope * 1000) / t.level) * 10) / 10, Math.round(t.p * 1000) / 1000, cls];
  }
}
writeFileSync(join(dir, 'trend.json'), JSON.stringify(out));
console.log(`${n} lakes with water records, ${Object.keys(out).length} with a trend: ${fall} falling, ${rise} rising`);
