# Project conventions

## Adding a new configurable control (dropdown/select) — do the FULL wiring, always

When the user asks to make something configurable ("make X a dropdown", "let me pick N",
"like the other dropdowns"), it means the control must behave like every other data-driven
control: persisted, shareable, restorable, and honored by every code path — WITHOUT being
asked to spell that out. Never ship a half-wired control that only reads from the DOM.

A new `select-*` control is not done until ALL of these are touched:

1. **index.html** — the `<select class="inline-select" id="select-...">` with options matching
   the sibling controls' style/range. Set the default `selected` to match current behavior.
2. **js/simulate.js** — read it off `opts` (with a sensible fallback so old callers don't break),
   and use it in the engine.
3. **js/chart.js** — add it to the `smaOpts`/options object passed to the sim.
4. **js/controls.js** —
   - add the id to `SLIDER_IDS` (top of file),
   - add the id to the change-handler `.forEach([...])` list (~line 224),
   - add a `params.set('<shortkey>', ...)` line in `saveSliders` (share-link output).
5. **js/init.js** — restore it from the URL param in the `params.get('<shortkey>')` block.
6. **js/saved-configs.js** — add the id to the strategy's persisted-field list (the `'sma': [...]`
   array) AND read it in the opts builder (`+pget(p, 'select-...', default)`).
7. **js/preview-dropdown.js** — THREE spots (this is what gives the dropdown its bar-chart
   preview and makes it look "data-driven like the others" — do NOT skip it):
   - register it in the `PREVIEW_SELECTS` map with `{ kind: 'sma', apply: (p, v) => { p.<field> = +v; } }`,
   - add it to the `readSmaParams()` (or `read9sigParams()`) params object,
   - pass it through in the `simulateSMA({...})` / `simulate({...})` call inside `smaFinal`/`nineSigFinal`.
   Without the `PREVIEW_SELECTS` entry it renders as a plain native `<select>` with no bars.
8. **js/analytics.js** — add it to BOTH SMA-opts builders (the DOM path ~1378 and the
   saved-params path ~1454).
9. **js/controls.js migrations** — if the new control changes behavior for existing shared links,
   bump `APP_VERSION` and add a `{ from: <oldVersion>, migrate(p) {...} }` entry to
   `LINK_MIGRATIONS` so old links resolve to the same configuration.
10. **index.html `?v=` cache-bust** — bump the `?v=NN` counter on all asset refs (`sed -i '' 's/?v=NN/?v=NN+1/g'`).

Short URL-param keys must be unique — grep existing `params.set(` / `params.get(` first.

## Voice / style
- Plain language, concrete examples, blunt and honest. No corporate hedging.
- Avoid AI-tell phrasing, especially the "X, not Y" construction.
- Never commit unless explicitly asked.
