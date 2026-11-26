// Guards what search engines and link previews read: the head of index.html and the files it points to.
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';

const html = readFileSync('index.html', 'utf8');
const SITE = 'https://inlandwater.bristleconelab.org/';

describe('index.html head', () => {
  it('has a title, description and canonical on the production domain', () => {
    expect(html).toMatch(/<title>Inland Water Atlas[^<]*<\/title>/);
    expect(html).toMatch(/<meta name="description" content="[^"]{80,}">/);
    expect(html).toContain(`<link rel="canonical" href="${SITE}">`);
    expect(html).not.toMatch(/pages\.dev/);
  });
  it('links icons, manifest and preview image that exist in public/', () => {
    for (const f of ['favicon.svg', 'favicon.ico', 'apple-touch-icon.png', 'site.webmanifest', 'og-image.png']) {
      expect(html).toContain(`/${f}"`);
      expect(existsSync(`public/${f}`), f).toBe(true);
    }
    const man = JSON.parse(readFileSync('public/site.webmanifest', 'utf8'));
    for (const i of man.icons) expect(existsSync(`public${i.src}`), i.src).toBe(true);
    expect(existsSync('public/brand/inland-water-atlas-mark.svg')).toBe(true);
  });
  it('carries valid JSON-LD', () => {
    const m = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    expect(m).toBeTruthy();
    const ld = JSON.parse(m![1]);
    const app = ld['@graph'].find((x: { '@type': string }) => x['@type'] === 'WebApplication');
    expect(app.url).toBe(SITE);
    expect(app.name).toBe('Inland Water Atlas');
  });
});

describe('crawler files', () => {
  it('robots.txt points to the sitemap, which lists the home page', () => {
    expect(readFileSync('public/robots.txt', 'utf8')).toContain(`Sitemap: ${SITE}sitemap.xml`);
    expect(readFileSync('public/sitemap.xml', 'utf8')).toContain(`<loc>${SITE}</loc>`);
  });
  it('has a noindex 404 page and the IndexNow key file named in the script', () => {
    expect(readFileSync('public/404.html', 'utf8')).toContain('noindex');
    const key = readFileSync('scripts/indexnow.sh', 'utf8').match(/^KEY=([0-9a-f]{32})$/m)![1];
    expect(readdirSync('public')).toContain(`${key}.txt`);
    expect(readFileSync(`public/${key}.txt`, 'utf8').trim()).toBe(key);
  });
});

describe('README', () => {
  it('points only to pictures and logos that exist', () => {
    const md = readFileSync('README.md', 'utf8');
    const refs = [...md.matchAll(/(?:src|srcset)="((?:docs|public)\/[^"]+)"/g)].map((m) => m[1]);
    expect(refs.length).toBeGreaterThan(4);
    for (const r of refs) expect(existsSync(r), r).toBe(true);
  });
});
