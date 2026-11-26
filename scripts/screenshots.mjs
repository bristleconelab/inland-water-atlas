// Regenerate the README pictures in docs/img/ (public/og-image.png is the designed preview from the logo pack) from a running dev server (needs Google Chrome).
// usage: python3 scripts/tiles_server.py ../lakes-atlas-tiles 5401 & VITE_TILES=http://127.0.0.1:5401/ npx vite --port 5499; node scripts/screenshots.mjs
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
const base = process.argv[2] ?? 'http://localhost:5499/';
mkdirSync('docs/img', { recursive: true });
const shots = [
  { file: 'docs/img/hero.png', hash: '#lake=12@75.875,46.598,5.2', size: [1600, 900] },
  { file: 'docs/img/powell-water-years.png', hash: '#lake=802@-111.050,37.150,8.6', size: [1440, 900], settle: 2500,
    js: "window.__lakes.map.jumpTo({center:[-111.55,37.0],zoom:9.1});[...document.querySelectorAll('#panel .spark')].filter(e=>!e.classList.contains('level')).pop()?.scrollIntoView({block:'end'})" },
  { file: 'docs/img/rhone-swot-level.png', hash: '#river=20527372@4.778,43.927,7.5', size: [1440, 900], js: "document.querySelector('#panel .level')?.scrollIntoView()", settle: 4000 },
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
