#!/usr/bin/env node
// Copy this per investigation, fill in CONFIG and reproduce(), then run it with:
//   NODE_PATH="$(npm root -g)" node repro.cjs
// NODE_PATH points Node at the global Playwright install; drop it when running from
// inside a project that has playwright in its own node_modules.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const CONFIG = {
  baseUrl: process.env.BASE_URL || 'http://localhost:3000',
  startPath: '/',
  viewport: { width: 1400, height: 900 },
  // Headed by default so you watch the bug happen. HEADLESS=1 for long soak loops.
  headless: process.env.HEADLESS === '1',
  slowMo: Number(process.env.SLOWMO || 0),
  artifacts: path.join(__dirname, 'artifacts'),
  storageState: path.join(__dirname, 'auth.json'),
  // Set to enable auth reuse: { path, user, pass, userSelector, passSelector, submitName } — delete auth.json to re-authenticate.
  login: null,
};

const log = (...a) => console.log(...a);
const problems = [];

// Wait on a real condition. Use this for anything the page has to finish first.
async function until(page, fn, { timeout = 20000, every = 100 } = {}) {
  const start = Date.now();
  for (;;) {
    if (await page.evaluate(fn)) return true;
    if (Date.now() - start > timeout) throw new Error(`timed out waiting for: ${fn}`);
    await page.waitForTimeout(every);
  }
}

function watch(page) {
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') problems.push(`console.${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('requestfailed', (r) => problems.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`));
  page.on('response', (r) => {
    if (r.status() >= 400) problems.push(`http ${r.status()}: ${r.url()}`);
  });
}

async function authenticate(browser) {
  const { login, storageState, baseUrl } = CONFIG;
  if (!login) return undefined;
  if (fs.existsSync(storageState)) return storageState;
  const ctx = await browser.newContext({ viewport: CONFIG.viewport });
  const page = await ctx.newPage();
  await page.goto(baseUrl + login.path, { waitUntil: 'domcontentloaded' });
  await page.fill(login.userSelector, login.user);
  await page.fill(login.passSelector, login.pass);
  await page.getByRole('button', { name: login.submitName }).click();
  await page.waitForURL((u) => !u.pathname.startsWith(login.path), { timeout: 30000 });
  await ctx.storageState({ path: storageState });
  await ctx.close();
  log(`saved session to ${storageState}`);
  return storageState;
}

async function shot(page, name) {
  fs.mkdirSync(CONFIG.artifacts, { recursive: true });
  const file = path.join(CONFIG.artifacts, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  log(`shot: ${file}`);
  return file;
}

function dump(name, data) {
  fs.mkdirSync(CONFIG.artifacts, { recursive: true });
  const file = path.join(CONFIG.artifacts, `${name}.json`);
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
  log(`dump: ${file}`);
}

// Everything specific to the bug goes here. Return the observation, do not judge it.
async function reproduce(page) {
  // Replace with the condition that means "this screen is actually ready".
  await until(page, () => !document.querySelector('.spinner, [aria-busy="true"]'));

  const observed = await page.evaluate(() => ({
    title: document.title,
    rows: document.querySelectorAll('[data-row]').length,
  }));

  await shot(page, 'state');
  return observed;
}

(async () => {
  const browser = await chromium.launch({ headless: CONFIG.headless, slowMo: CONFIG.slowMo });
  const state = await authenticate(browser);
  const ctx = await browser.newContext({ viewport: CONFIG.viewport, storageState: state });
  const page = await ctx.newPage();
  watch(page);

  await page.goto(CONFIG.baseUrl + CONFIG.startPath, { waitUntil: 'domcontentloaded', timeout: 45000 });

  const observed = await reproduce(page);

  log('\n=== OBSERVED ===');
  log(JSON.stringify(observed, null, 2));
  dump('observed', observed);

  log(`\n=== PROBLEMS (${problems.length}) ===`);
  problems.slice(0, 40).forEach((p) => log(`  ${p}`));

  await browser.close();
  process.exit(problems.length ? 1 : 0);
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(2);
});
