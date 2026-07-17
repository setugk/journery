// Rasterize the Journery logo into PWA/apple-touch PNG icons using Chromium.
// Reads the mark straight out of the logo SVG (background colour + <path>s), so
// changing assets/logo/journery-logo.svg and re-running is all it takes — no
// hardcoded path data. Not a build-time dependency of the app; a dev tool:
//   node scripts/generate-icons.mjs
// Optional overrides: LOGO_SVG=<file> ICON_OUT=<dir>
import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';
import path from 'path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SVG_PATH = process.env.LOGO_SVG || path.resolve(HERE, '..', 'assets', 'logo', 'journery-logo.svg');
const OUT      = process.env.ICON_OUT || path.resolve(HERE, '..', 'static');

const raw = readFileSync(SVG_PATH, 'utf8');
// Background = first <rect> that carries a fill colour. The mark = every <path>.
const bg = (raw.match(/<rect\b[^>]*\bfill="(#[0-9A-Fa-f]{3,8})"/) || [])[1] || '#EE5339';
const paths = (raw.match(/<path\b[\s\S]*?\/>/g) || []).join('');
if (!paths) { console.error('No <path> found in', SVG_PATH); process.exit(1); }

const NS = 'xmlns="http://www.w3.org/2000/svg"';
// Full-bleed square (iOS + Android round corners themselves; drop the logo's own
// rounding + border since those would be masked/clipped on an app icon).
const square   = `<svg ${NS} viewBox="0 0 24 24"><rect width="24" height="24" fill="${bg}"/>${paths}</svg>`;
// Maskable: mark scaled into the ~80% Android safe zone.
const maskable = `<svg ${NS} viewBox="0 0 24 24"><rect width="24" height="24" fill="${bg}"/><g transform="translate(2.4 2.4) scale(0.8)">${paths}</g></svg>`;

const jobs = [
  { svg: square,   size: 180, file: 'icon-180.png' },
  { svg: square,   size: 192, file: 'icon-192.png' },
  { svg: square,   size: 512, file: 'icon-512.png' },
  { svg: maskable, size: 512, file: 'icon-512-maskable.png' },
];

const browser = await chromium.launch();
for (const j of jobs) {
  const page = await browser.newPage({ viewport: { width: j.size, height: j.size }, deviceScaleFactor: 1 });
  const svg = j.svg.replace('<svg ', `<svg width="${j.size}" height="${j.size}" `);
  await page.setContent(`<!doctype html><html><body style="margin:0">${svg}</body></html>`);
  await page.locator('svg').screenshot({ path: path.join(OUT, j.file) });
  await page.close();
  console.log('wrote', j.file, `(${j.size}px)`);
}
await browser.close();
console.log('bg colour:', bg);
