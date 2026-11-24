#!/usr/bin/env node
/*
 * The installed app's icons (manifest.webmanifest), drawn from the site's one mark,
 * images/favicon.svg, so the icon on a phone's home screen is the tab's icon and never a
 * second drawing of it.
 *
 *   images/icons/app-192.png, app-512.png    the mark as it is, on a clear ground
 *   images/icons/app-maskable-512.png        the mark at MASKABLE_SHARE of the square on its own
 *                                            ground colour edge to edge: Android cuts a maskable
 *                                            icon to a circle or a rounded square and keeps only
 *                                            what sits inside the middle 80%
 *
 * Run it again when images/favicon.svg changes. It needs Playwright (not a dependency of the
 * site, which has none):
 *   NODE_PATH="$(npm root -g)" node scripts/build-app-icons.cjs
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const MARK = fs.readFileSync(path.join(ROOT, 'images/favicon.svg'), 'utf8');
const OUT = path.join(ROOT, 'images/icons');
const MASKABLE_SHARE = 0.62;
// The mark's own ground: the fill of the rectangle it is drawn on.
const GROUND = /<rect[^>]*fill="(#[0-9a-fA-F]{3,8})"/.exec(MARK)[1];
const ICONS = [
  { file: 'app-192.png', size: 192, share: 1, ground: 'transparent' },
  { file: 'app-512.png', size: 512, share: 1, ground: 'transparent' },
  { file: 'app-maskable-512.png', size: 512, share: MASKABLE_SHARE, ground: GROUND },
];
const pageOf = ({ share, ground }) => `<!doctype html><html><body style="margin:0;width:100vw;height:100vh;display:flex;align-items:center;justify-content:center;background:${ground}">
  <img src="data:image/svg+xml;base64,${Buffer.from(MARK).toString('base64')}" style="width:${share * 100}%;height:${share * 100}%"></body></html>`;

(async () => {
  const browser = await chromium.launch();
  await Promise.all(ICONS.map(async (icon) => {
    const page = await browser.newPage({ viewport: { width: icon.size, height: icon.size }, deviceScaleFactor: 1 });
    await page.setContent(pageOf(icon));
    await page.screenshot({ path: path.join(OUT, icon.file), omitBackground: icon.ground === 'transparent' });
    console.log(`${icon.file}: ${icon.size}×${icon.size}, the mark at ${Math.round(icon.share * 100)}% on ${icon.ground}`);
  }));
  await browser.close();
})();
