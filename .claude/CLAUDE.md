Before moving on with any tasks, first output in the message "I've read custom instructions" to confirm that you have read the instructions. Then, proceed with the task. Don't output above text in this file.

> **Project context:** See [ABOUT.md](ABOUT.md) for project overview, tech stack, structure, and key details.

# AI Code Guide

## Rules *(unless user suggests otherwise)*

1. **No Repetition** - Extract logic into functions
2. **No Hard Coding** - Use variables, read from data sources
3. **No VS Code Browser** - Don't run/build projects
4. **No JS→TS Conversion** - Don't fix TypeScript issues
5. **Single Task Focus** - Don't volunteer extra fixes
6. **Embrace Uncertainty** - It's okay to not know everything
7. **Prefer map over forEach** - Use functional programming patterns
8. **Use library functions** - If included, prefer d3.sum, d3.groups, d3.mean over native alternatives
9. **String matching** - Prefer direct equality for known values over includes
10. **Preserve defaults** - Don't modify default values unless specifically asked
11. **Data & State Management** - Preserve existing data flow, reactive statements, transformation chains and add new functionality without disrupting existing patterns
12. **Variable renaming** - Only update actual variable names and identifiers, not string literals, text content, or display text
13. **Lint handling** - Don't automatically fix lint warnings unless explicitly requested, focus on user's actual request over style suggestions
14. **No overly defensive programming** - don't favour usage of try catch blocks and if's unless absolutely certain application could break, even then, descriptive errors are better to catch the source issue, compared to missing errors in try/catch blocks
15. **production quality** No shortcuts, make sure to write production quality code unless asked otherwise
16. **Understandable code** Try to write the code in a way, it to pass senior developer review, but can be understood by junior developer
17. **No running scripts directly** - Don't execute Python scripts or data processing code directly via command line. Update the notebook and let the user run it themselves. Notebook cell execution is fine. Reason: the user needs to see outputs inline, catch errors immediately, and have a documented record of what was run and what it produced. Running scripts silently hides all of that.
18. **No Figma node IDs in user-facing content** - Never surface a Figma node id (`123:456`) in tooltips, labels, copy or any text an end user reads. Node ids are internal design references and mean nothing to users. Keep them in code comments or commit messages if needed.
19. **Analyze before fixing** - Read logs and data carefully before diagnosing issues. Don't assume the root cause — verify it. If a fix turns out to be based on a wrong assumption, roll it back immediately instead of leaving incorrect changes in the code.

## Shared components

- **No inline SVGs**  Do NOT inline the SVG. Reason: this keeps the mark consistent across pages — previously it was copy-pasted in multiple places and kept drifting.

## Tracking (PostHog)

All analytics goes through `$lib/analytics` — never call `posthog` directly. Keep new pages/components consistent:

- **Custom events**: on each meaningful user action call `track('event_name', { ...props })` with `snake_case` names (e.g. `find_answers`, `aim_selected`); props carry context (aim, query, step).
- **Autocapture labels**: give interactive elements `data-ph-capture-attribute-action="kebab-name"` so autocapture logs are readable. For the shared `Button`, pass the `phAction` prop instead.
- **Person properties**: call `setPerson({ ... })` on key choices (e.g. selected aim/role) so cohorts/segments work.
- **Pageviews**: fire automatically in the root layout's `afterNavigate` — no per-page code — and are **excluded on `/admin`** (admin is Google-authed; keep it out of end-user analytics).
- **Identify / reset**: end-users are identified by email in the layout; `resetAnalytics()` runs on logout. Never identify admins.
- **Privacy**: no PII or secrets in event props; session replay masks all inputs.

## Skills

Installed under `.claude/skills/`. Most load themselves when the task matches their description; these notes cover what description-matching misses.

- **ai-deslop** — writing style is not a task, so this one never self-triggers. Follow `.claude/skills/ai-deslop/SKILL.md` for all prose: chat replies, docs, commits, PR descriptions, code comments.
- **mcp-api-integration** — Figma and Asana, over MCP or REST. It owns those rules, including the Figma tool namespace, node-id parsing and which Asana writes are safe. Prefer it over Figma or Asana guidance restated anywhere else.
- **playwright-repro** — any browser bug or UI verification. Reproduce in a script before diagnosing, re-run the same script to prove the fix.
- **d3-charts** — read before writing D3 chart code.
- **light-cms** — the git-backed SvelteKit CMS.
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
   - register it in the `PREVIEW_SELECTS` map with `{ kind: 'sma', name: 'Short name', apply: (p, v) => { p.<field> = +v; } }`
     (`name` labels it in the Fit summary; add `fit: false` when it is a cost or execution setting the Fit button must not tune),
   - add it to the `readSmaParams()` (or `read9sigParams()`) params object,
   - pass it through in the `simulateSMA({...})` / `simulate({...})` call inside `smaRun`/`nineSigRun`.
   Without the `PREVIEW_SELECTS` entry it renders as a plain native `<select>` with no bars, and Fit never tries it.
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
