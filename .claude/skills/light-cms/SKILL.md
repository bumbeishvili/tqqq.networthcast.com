---
name: light-cms
description: Build a lightweight Git-backed CMS into a SvelteKit + Vercel project — Google-auth admin editors, saves that commit content JSON to GitHub via the Contents API, Vercel auto-deploy with status polling, localStorage preview of unsaved edits, and public pages that read bundled JSON (never GitHub at runtime). Use when the user wants editable page content without a database/headless CMS, wants to add an /admin editing UI to a Svelte site, or asks to replicate the "Public Servant Project light CMS". Pairs with the full reference implementation in playbook.md.
---

# Light CMS

A no-database CMS where **the Git repo is the single source of truth**. Editors
sign in at `/admin`, edit a visual mirror of each page, and Save — which commits
the page's JSON to the branch as the editor, triggering a Vercel deploy.

**`playbook.md` (next to this file) is the full as-built reference**: inlined,
copy-ready code for every module plus the complete lessons-learned list. Read it
before writing code. This SKILL.md is the map; the playbook is the territory.

## Two cardinal rules (everything else follows from these)

1. **Public pages read BUNDLED JSON, never GitHub at runtime.** Public
   `+page.server.ts` does `import bundled from '../../static/assets/<slug>.json'`.
   Admin pages — and only admin pages — read live from GitHub so editors see the
   latest commit before it deploys. Runtime GitHub reads on public pages burn the
   shared token rate limit, add latency, and break under traffic.

2. **Preview is 100% client-side (localStorage + URL token), never server-side.**
   Save stashes the working copy in `localStorage` and opens
   `/<slug>?_cmsPreview=<token>`; the page swaps it in via `onMount`. Never encode
   the payload in the URL (HTTP 431 on big pages) and never read it in a load.

## Build order

1. Auth — Auth.js + Google, `ADMIN_EMAILS` allowlist, hooks guard on `/admin` + `/api/cms`.
2. GitHub server layer — read / commit (with SHA) via Contents API.
3. Write endpoint — `PUT /api/cms/pages/[slug]`.
4. Deploy-status endpoint — `GET /api/cms/commit-status/[sha]`.
5. Public read path — bundled import + `onMount` preview swap + layout banner.
6. Preview module + markdown editor (TipTap, dynamic import).
7. Admin shell + one visual-mirror editor wired to Save/poll/Preview. Repeat per page.

## Gotchas that aren't visible in the code (full detail in playbook §2)

- `csr = dev` silently disables preview in production (kills `onMount`). Never use it on a public route.
- `prerender = true` + reading `url.searchParams` in a load = build crash. The load must not touch the URL.
- `$page.url.origin` is `http://sveltekit-prerender` at build time → hardcode `SITE_URL` for any absolute URL on a prerendered page.
- GitHub Contents API needs the file's current SHA to update; 404 → omit SHA → it creates.
- Encode path segments but keep `/` literal, or the API 404s.
- Commit `author` + `committer` = the signed-in editor (token is shared).
- Markdown toolbar must expose only formatting the public CSS styles.
- Enforce the allowlist in both the Auth.js `signIn` callback and the hooks guard.

## Verify before calling it done (full checklist in playbook §8)

The decisive test: on a **production build** (not dev), Preview ↗ still overlays
unsaved content — that proves CSR is on and `onMount` fires, catching the
`csr = dev` trap. Also grep that no public `+page.server.ts` imports
`readJsonFromBranch`.

Run it as a local Playwright check by hand after implementing a page (not CI).
Preview only — never Save (real commit + deploy) or auth (Google OAuth). Ready
spec in playbook §10.
