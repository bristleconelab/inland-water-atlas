// Regenerate docs/img/*.png and public/og-image.png from a running dev server (needs Google Chrome).
// usage: python3 scripts/tiles_server.py ../lakes-atlas-tiles 5401 & VITE_TILES=http://127.0.0.1:5401/ npx vite --port 5499; node scripts/screenshots.mjs
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
const base = process.argv[2] ?? 'http://localhost:5499/';
mkdirSync('docs/img', { recursive: true });
const shots = [
  { file: 'docs/img/central-asia.png', hash: '#lake=12@75.875,46.598,4.6', size: [1440, 900] },
  { file: 'docs/img/finland.png', hash: '', size: [1440, 900], js: 'window.__lakes.map.jumpTo({ center: [27.5, 62.3], zoom: 8.2 })' },
  { file: 'docs/img/canada.png', hash: '', size: [1440, 900], js: 'window.__lakes.map.jumpTo({ center: [-98, 58.5], zoom: 7.4 })' },
  { file: 'docs/img/globe.png', hash: '', size: [1440, 900], js: 'window.__lakes.map.jumpTo({ center: [40, 45], zoom: 2.3 })' },
  { file: 'docs/img/flow-geneva.png', hash: '#lake=1261@6.550,46.450,8.0', size: [1440, 900], js: "document.querySelector('#panel .btn-small').click()", settle: 2500 },
  { file: 'docs/img/water-narran.png', hash: '#lake=16471@147.400,-29.800,9.0', size: [1440, 900], js: "document.querySelector('#panel .more:last-of-type')?.scrollIntoView()" },
  { file: 'docs/img/river-amudarya.png', hash: '#r=40278731', size: [1440, 900], settle: 2500 },
  { file: 'docs/img/river-rhone-swot.png', hash: '#river=20527372@4.778,43.927,7.5', size: [1440, 900], js: "document.querySelector('#panel .level')?.scrollIntoView()", settle: 4000 },
  { file: 'docs/img/phone.png', hash: '#lake=78@-69.290,-15.910,6.5', size: [390, 844], mobile: true },
  { file: 'public/og-image.png', hash: '#lake=12@75.875,46.598,4.6', size: [1200, 630] },
];
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
for (const s of shots) {
  const ctx = await browser.newContext({ viewport: { width: s.size[0], height: s.size[1] }, deviceScaleFactor: s.mobile ? 2 : 1, isMobile: !!s.mobile, hasTouch: !!s.mobile });
  const page = await ctx.newPage();
  await page.goto(base + s.hash, { waitUntil: 'networkidle', timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(3000);
  if (s.js) { await page.waitForTimeout(1500); await page.evaluate(s.js); await page.waitForTimeout(s.settle ?? 500); }
  await page.waitForFunction(() => window.__lakes?.map?.areTilesLoaded?.(), null, { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(3000);
  await page.screenshot({ path: s.file });
  console.log(s.file);
  await ctx.close();
}
await browser.close();
