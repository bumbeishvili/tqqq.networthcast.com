# Playwright Repro — playbook

Recipes for throwaway browser investigation scripts. Copy what you need into a
`template.cjs` copy. Everything here runs as a plain script, no test runner.

Install Playwright globally, once per machine:

```bash
npm i -g playwright && playwright install chromium
```

Global suits throwaway scripts: they live outside any repo, so there is no project to
be a dependency of, and the browsers land in one shared cache
(`~/Library/Caches/ms-playwright` on macOS) that every investigation reuses instead of
downloading per project.

**Run scripts with `NODE_PATH` pointing at the global root.** Node does not search
npm's global directory, so a bare `require('playwright')` from a scratch directory
fails with `MODULE_NOT_FOUND`:

```bash
NODE_PATH="$(npm root -g)" node repro.cjs
```

Use the `$(npm root -g)` substitution rather than a fixed path — under `nvm` the global
root is per Node version, so it moves when you switch versions.

Keep scripts in a scratch directory outside the repo (`/tmp/repro/`, or whatever
scratch path your tooling gives you). If one lands inside the repo, delete it before
you finish.

When a project already has Playwright as a dev dependency, run from inside that project
and drop `NODE_PATH`; the local `node_modules` resolves on its own.

---

## 0. Run headed

**Watch the browser.** Every investigation launches with a visible window:

```js
const browser = await chromium.launch({ headless: false, slowMo: 250 });
```

`slowMo` puts a pause between actions so a click, a transition and a re-render are
separable by eye. The template runs headed by default; set `SLOWMO=250` to add the
pause and `HEADLESS=1` to drop the window.

Watching the real window shows you what a log leaves out, because the screen carries
everything you did not think to assert on. A layout that jumps, a flash of stale data,
a control that never gained focus, a modal that swallowed the click, a spinner that
never stops — each of these is obvious on screen and absent from a log that says
`rows: 0`.

Two further reasons to prefer it:

- **Headless can render differently.** Playwright runs headed on the `chrome` binary
  and headless on `chrome-headless-shell`, and the two differ in font rendering and
  GPU path, so a visual bug may be absent or a phantom bug may appear that no user
  will hit. Pass `channel: 'chromium'` to launch if you need both modes on the same
  full browser.
- **You can take over.** Add `await page.pause()` to freeze the run and open the
  Playwright Inspector — from there you step through actions, hover selectors and
  poke at devtools on the live page with all your setup already applied.

Switch to headless for long soak loops (§8), once you know what you are looking at and
only need the numbers. When a headless run surfaces something surprising, reproduce it
headed before you believe it.

---

## 1. Authenticate once, reuse the session

Logging in on every run is slow and turns one bug into two. Log in once, save the
cookies and storage to a file, and hand that file to every later context.

```js
const ctx = await browser.newContext({ storageState: 'auth.json' });
```

The template does this in `authenticate()`. Two things that bite:

- **Delete `auth.json` when the session expires.** A stale file fails in a way that
  looks like a bug in the page ("the app redirects me to /login").
- **`http://localhost` and `http://127.0.0.1` are different origins.** Cookies, local
  storage and CORS allowlists do not carry between them. If the app works in your
  browser and not in the script, check you are on the same hostname the app expects.

Read credentials from the environment, or use the throwaway test account the project
already documents. Keep them out of any file you commit.

---

## 2. Capture everything, from the first run

Attach these before the first `goto`, always, even when the bug "is only visual":

```js
page.on('console', m => { if (m.type() === 'error') problems.push(m.text()); });
page.on('pageerror', e => problems.push(e.message));
page.on('requestfailed', r => problems.push(`${r.url()} ${r.failure()?.errorText}`));
page.on('response', r => { if (r.status() >= 400) problems.push(`${r.status()} ${r.url()}`); });
```

**Read what they print** before you form a theory, including when the bug "is only
visual". These four handlers name the failure for you: a blocked request gives you the
URL and the error text, a rejected response gives you the status, a thrown effect gives
you the module and line. A line that "looks unrelated" is still evidence — check it
against the symptom before you set it aside.

When the console is noisy, filter by substring so the channel stays on.

---

## 3. Wait for a condition

Wait on something observable — an element, a count, a response:

```js
await page.waitForFunction(() => document.querySelectorAll('[data-row]').length > 0);
await page.waitForSelector('.chart svg', { state: 'visible' });
await page.waitForResponse(r => r.url().includes('/api/totals') && r.ok());
```

A fixed `await page.waitForTimeout(3000)` is a guess: it passes on your machine, fails
on a slower one, and hides the race you are trying to find. The one legitimate use is
the interval inside a poll loop, below.

For state that lives in memory rather than the DOM, poll it:

```js
async function until(page, fn, { timeout = 15000, every = 100 } = {}) {
  const start = Date.now();
  for (;;) {
    if (await page.evaluate(fn)) return true;
    if (Date.now() - start > timeout) throw new Error(`timed out: ${fn}`);
    await page.waitForTimeout(every);
  }
}
```

`networkidle` reports that the network went quiet, which happens before the app has
finished rendering. Treat it as a hint, then wait on the element or value you care about.

---

## 4. Read state out of the page

`page.evaluate` runs in the page and returns anything structured-cloneable. It cannot
close over Node variables — pass them as the second argument.

```js
const rows = await page.evaluate(() => [...document.querySelectorAll('[data-row]')].map(el => ({
  id: el.dataset.row,
  total: el.querySelector('.total')?.textContent?.trim(),
})));

const value = await page.evaluate(([sel, attr]) => document.querySelector(sel)?.getAttribute(attr), ['.bar', 'height']);
```

For state the DOM does not show — a store, a cache, a computed value — expose it
deliberately from app source:

```js
if (import.meta.env.DEV) window.__repro = { store, cache };
```

**This is a debt you must repay in the same session.** Write down the exact hook name
the moment you add it, and `grep` for it before you report anything:

```bash
grep -rn "__repro" src/
```

Run the `grep` before you report anything. A hook left in source outlives the
investigation, and the next person reads it as intentional API.

---

## 5. Measure, and then distrust the measurement

Rule 2 of the skill, in practice. When a script reports a number you did not expect,
you now have two suspects: the app and the script.

**Always validate the measuring code on a case whose answer you already know.** Feed
it something where you can state the correct output in advance. If it gets that
wrong, everything it told you about the real case is void.

Specific traps:

- **Mixed coordinate spaces.** A screenshot is page-space. Values from element APIs
  are usually element-relative. Comparing the two directly manufactures a constant
  offset equal to the element's page position, which reads exactly like a real
  rendering bug. Convert first:
  ```js
  const box = await page.locator('.chart').boundingBox();
  const pageX = box.x + localX;
  ```
- **Device pixel ratio.** Screenshot pixels may be 2× CSS pixels. Divide before comparing.
- **Rounding.** A "1px offset" is often two different rounding rules, not a bug.
- **Sampling one point.** One pixel or one row proves nothing. Sample many and report
  the distribution — median, worst case, count — not a single value.

When a measurement disagrees with the source of truth, work out which one is wrong
before writing any fix. A fix aimed at a measurement artifact moves the number without
touching the bug, which then reads as a partial fix and sends you looking for a second
cause that does not exist.

---

## 6. Compare against ground truth

To show the app renders the *right* value, fetch that value from its source in plain
Node and compare. The app's own network response is a reasonable source; your memory
of what it should be is not.

```js
const truth = await fetch(`${API}/totals?region=${id}`).then(r => r.json());
const shown = await page.evaluate(() => document.querySelector('.total').textContent);
console.log(JSON.stringify({ truth: truth.total, shown, match: String(truth.total) === shown }));
```

This is what separates "the number changed" from "the number is correct". A fix that
makes the display agree with your assumption, while both disagree with the backend,
is a bug you have now hidden.

---

## 7. Visual checks without a snapshot suite

Screenshot each meaningful state to a named file so you can flip between runs:

```js
await page.screenshot({ path: `artifacts/${name}.png` });
await page.locator('.card').screenshot({ path: `artifacts/${name}-card.png` });
```

To check *where* something rendered rather than *that* it rendered, draw the expected
position into the page and screenshot the result — a wrong overlay is obvious to the
eye and ambiguous in numbers:

```js
await page.evaluate(({ x, y }) => {
  const d = document.createElement('div');
  d.style.cssText = `position:fixed;left:${x}px;top:${y}px;width:8px;height:8px;background:red;z-index:99999`;
  document.body.appendChild(d);
}, expected);
```

Remove the marker before any screenshot you intend to compare against a clean run.

---

## 8. Stress and repetition

Bugs that appear "after a while" need repetition. Reproduce the first occurrence headed,
then loop headless for the numbers — this is the one place headless earns its keep,
since each of 100 identical iterations carries the same information as the last and the
window costs you frames.

```js
for (let i = 0; i < 100; i++) {
  await page.click('.next');
  await until(page, () => !document.querySelector('.spinner'));
  if (i % 10 === 0) {
    const heap = await page.evaluate(() => performance.memory?.usedJSHeapSize ?? 0);
    console.log(JSON.stringify({ i, heapMB: +(heap / 1048576).toFixed(1), problems: problems.length }));
  }
}
```

Report the **trend** across samples: a number that climbs and then flattens is a cache,
a number that climbs without flattening is a leak. A single endpoint reading
distinguishes neither. Launch with
`--js-flags=--expose-gc` and call `window.gc()` before sampling if you need the
readings to be comparable.

For state that only goes wrong after real idle time, drive the same lifecycle events
the browser would (`visibilitychange`, a backgrounded tab, a dropped connection)
rather than waiting in real time.

---

## 9. Navigation and teardown bugs

Crashes on leaving a page are common and easy to miss, because the script usually
ends there. Navigate away *inside* the script and keep watching:

```js
await page.goto(BASE + '/dashboard');
await until(page, () => !!document.querySelector('.dashboard'));
await page.click('a[href="/settings"]');
await page.waitForURL(/\/settings$/);

// A false here is the result: the route changed and nothing rendered behind it.
const rendered = await until(page, () => !!document.querySelector('.settings'), { timeout: 5000 })
  .catch(() => false);
const alive = await page.evaluate(() => document.body.innerText.trim().length > 0);
console.log(JSON.stringify({ rendered, alive, problems }));
```

A blank body plus a `pageerror` is a teardown bug — something ran cleanup against an
object its owner had already destroyed.

---

## 10. Finishing

Before you report anything:

- [ ] You watched the bug happen in a **headed** run.
- [ ] The original script reproduces the bug on the **pre-fix** code.
- [ ] The **same** script passes on the post-fix code.
- [ ] You ran the script against an unrelated area and it still behaves.
- [ ] Console and network are clean, or every remaining message is explained.
- [ ] You ran the `grep` and every debug hook is removed.
- [ ] Scripts and artifacts are deleted, or live outside the repo.
- [ ] The report names whatever you could **not** reproduce.

State the unreproduced parts explicitly. "I could not reproduce the mobile crash, so
that part is unverified" tells the reader what still needs checking; leaving it out
reads as verified.
