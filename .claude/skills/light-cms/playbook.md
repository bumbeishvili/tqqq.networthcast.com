# Light CMS — Portable Build Playbook

A complete, self-contained spec for rebuilding the "light CMS" pattern in another
SvelteKit + Vercel project. Hand this whole file to the other agent as context.
It carries the architecture, the load-bearing code, **and the non-obvious
constraints we already hit and fixed** — the part that isn't recoverable by
reading code.

> Origin: this is the CMS running on the Public Servant Project site
> (`peoples-lab-site`). The original design brief is in `.claude/light-cms.md`;
> this playbook is the *as-built* truth, which diverges from the brief in two
> important ways (bundled JSON for public reads, localStorage for preview).

---

## 1. Mental model (read this first)

A **Git-backed CMS where the repo is the single source of truth.** No database.

- Editors sign in at `/admin` with Google; an `ADMIN_EMAILS` allowlist gates access.
- Each managed page is one JSON file in `static/assets/<slug>.json`.
- An editor edits a **visual mirror** of the page and clicks **Save**.
- Save `PUT`s the JSON to a server route, which **commits the file to the
  environment's branch via the GitHub Contents API**, authored as the signed-in
  editor (token is shared, but git blame shows the real person).
- Vercel auto-deploys on that push. The editor **polls the commit's deploy
  status** and shows pending → deployed ✓ with a live link.
- **Preview before save**: the editor stashes the working copy in `localStorage`
  and opens the public page with a `?_cmsPreview=<token>` URL; the page swaps in
  the unsaved content client-side.

### The single most important design decision: two read paths

| | Admin editor reads | Public page reads |
|---|---|---|
| Source | GitHub Contents API, **at request time** | bundled JSON, **`import`ed at build time** |
| Why | editors must see latest commit, even before deploy | every visitor gets a static-asset response |
| Trade-off | one GitHub call per editor page-load | edits go live only **after the next deploy** |

**Public pages must never fetch from GitHub at runtime.** That was the original
mistake. Reasons it's wrong: the Contents API rate limit (5,000/hr per token) is
shared across *all* visitors, it adds latency to every request, it makes the
public site depend on a token being valid, and it falls over under traffic. A
deploy already captures a known content state — serving that state is the whole
point of deploying.

---

## 2. Non-obvious constraints & lessons learned

Every item below is a bug we shipped or nearly shipped. This section is the
reason this playbook exists.

1. **`csr = dev` silently kills preview in production.** That directive disables
   client JS in prod builds → `onMount` never fires → the localStorage swap never
   runs → preview is dead, with no error. **Never** put `csr = dev` on a public
   route. CSR must stay on.

2. **`prerender = true` + reading `url.searchParams` in a load = build crash**
   ("Cannot access url.searchParams on a page with prerendering enabled"). The
   fix in this architecture is structural: the **server load never touches the
   URL** — preview is entirely client-side. Keep it that way and the conflict
   can't occur.

3. **`$page.url.origin` is `http://sveltekit-prerender` at build time.** If you
   bake it into canonical / Open Graph / sitemap URLs on a prerendered page, you
   ship `og:image="http://sveltekit-prerender/…"` and social cards break
   (Facebook/LinkedIn/Google will flag it). **Hardcode a `SITE_URL` constant**
   for any absolute URL emitted from a prerendered page.

4. **Preview payload in the URL hits HTTP 431** (request header too large) for
   big pages — a 22 KB page blew the limit. Solution: store the payload in
   `localStorage` and put only a short **token** in the URL. Trade-off: a preview
   link only works in the same browser that created it. That's acceptable —
   preview is a personal pre-save check, not a shareable artifact.

5. **The preview banner must read the URL client-side, not server `data`.** On a
   prerendered page, anything returned from the server load is frozen at build
   time, so a `data.isPreview` flag is always false in prod. Derive the banner
   from `$page.url.searchParams` in the layout, guarded by `browser`.

6. **The content swap must run in `onMount`, not in the load.** Pattern:
   `$: content = preview ?? data.content; onMount(() => preview = readPreviewIfActive());`

7. **GitHub Contents API needs the file's current SHA to update** an existing
   file. Fetch it first; a 404 means the file doesn't exist → omit SHA → it
   creates. Don't send a stale SHA.

8. **Encode path segments but keep `/` literal** in Contents API URLs. Plain
   `encodeURIComponent(path)` turns slashes into `%2F` and the API 404s. Split on
   `/`, encode each segment, rejoin.

9. **Commit `author` AND `committer` = the signed-in editor.** The token is
   shared, so without this every commit looks like the bot/token owner.

10. **Markdown toolbar must match what the site actually styles.** We removed
    bullet / numbered / blockquote / inline-code buttons because no public page
    has CSS for those tags — producing them would render as unstyled plain text.
    Only expose formatting the renderer styles. (Existing markdown with those
    constructs still *parses*; editors just can't create new ones.)

11. **TipTap must be imported dynamically** (`await import(...)` inside
    `onMount`) — it touches the DOM at import time and breaks SSR otherwise.

12. **ProseMirror "random bold" bug.** A stray `storedMark` survives certain
    clicks and the next typed char inherits it. Fixed with a small plugin
    (`SanitizeStoredMarks`, included below) that strips storedMarks not present
    at the cursor's real position.

13. **Enforce the allowlist twice.** Once in the Auth.js `signIn` callback (so a
    disallowed account never even gets a session) and again in the hooks guard
    (defensive, and it's where you 403). Belt and suspenders, cheap.

14. **Gate `/api/cms` in hooks, not just `/admin`.** The write + status endpoints
    are as sensitive as the UI.

15. **Dev 404 fallback for reads.** When authoring a new page locally before the
    JSON is pushed, the GitHub read 404s. In `dev` only, fall back to reading the
    local working-copy file so local dev doesn't break. Production stays strict.

16. **Branch-per-environment.** `CMS_GITHUB_BRANCH` differs per Vercel env
    (`main` for prod, `uat`, `dev`). A Save commits to *that env's* branch; you
    promote upward with normal PRs. If you delete/rename a branch, update the
    Vercel env var or saves on that env will fail.

17. **Each editor is a hand-built visual mirror, not schema-driven.** Adding a
    page or field is an engineering task by design (a generic structured-page
    editor was explicitly out of scope). Don't promise editors self-serve schema
    changes.

---

## 3. Dependencies

```
@auth/sveltekit          # Google OAuth + session
@tiptap/core
@tiptap/starter-kit
@tiptap/extension-link
@tiptap/pm               # ProseMirror state (for the sanitize plugin)
tiptap-markdown          # markdown round-trip in the editor
marked                   # markdown → HTML on the public side
```

No off-the-shelf CMS, no database, no UI framework. Lean Svelte components only.

---

## 4. Environment variables

Set locally in `.env` and in Vercel → Settings → Environment Variables for every
environment the CMS runs in.

| Variable | Purpose |
|---|---|
| `AUTH_SECRET` | Auth.js session secret. `openssl rand -base64 32`. |
| `GOOGLE_CLIENT_ID` | Google OAuth client. Add `<origin>/auth/callback/google` to its Authorized redirect URIs (one per env, incl. preview URLs). |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret. |
| `ADMIN_EMAILS` | Comma-separated editor emails. Case/space-insensitive. |
| `CMS_GITHUB_OWNER` | GitHub owner. |
| `CMS_GITHUB_REPO` | GitHub repo. |
| `CMS_GITHUB_BRANCH` | Branch this env reads from and writes to. |
| `GITHUB_TOKEN` | Fine-grained PAT, `Contents: read+write` on the repo. |
| `CMS_DEV_PREVIEW` | Optional. `true` in local dev to skip auth (guarded by `dev`, can't activate in prod). |

---

## 5. Build order

1. **Auth** — Auth.js + Google, allowlist module, hooks guard. Verify
   sign-in/allowlist works before anything else.
2. **GitHub server layer** — `readJsonFromBranch`, `commitJsonToBranch`, diff
   helper. Test against a throwaway file.
3. **Write endpoint** — `PUT /api/cms/pages/[slug]`.
4. **Deploy-status endpoint** — `GET /api/cms/commit-status/[sha]`.
5. **Public read path** — bundle one page's JSON, render it, confirm it deploys.
6. **Preview module** — `$lib/cms/preview.ts`, layout banner, the `onMount` swap.
7. **Markdown editor** — `MarkdownEditor.svelte` + `markdown.ts` renderer.
8. **Admin shell + first editor** — layout sidebar, one page's visual-mirror
   editor wired to Save + status polling + Preview.
9. Repeat step 8 per page.

---

## 6. File inventory

```
src/hooks.server.ts                          # route guard (allowlist + dev bypass)
src/lib/server/auth.ts                       # Auth.js / Google config
src/lib/server/cms/allowlist.ts              # ADMIN_EMAILS parsing
src/lib/server/cms/github.ts                 # read/commit via Contents API
src/lib/cms/preview.ts                       # localStorage preview (client-side)
src/lib/cms/markdown.ts                       # marked renderer (public side)
src/lib/cms/MarkdownEditor.svelte            # TipTap WYSIWYG → markdown
src/routes/api/cms/pages/[slug]/+server.ts   # write endpoint (PUT)
src/routes/api/cms/commit-status/[sha]/+server.ts  # deploy status (GET)
src/routes/admin/+layout.server.ts           # surface signed-in user
src/routes/admin/+layout.svelte              # admin shell + sidebar nav
src/routes/admin/+page.svelte                # admin landing (informational)
src/routes/admin/pages/<slug>/+page.server.ts  # admin reads JSON live from GitHub
src/routes/admin/pages/<slug>/+page.svelte     # the visual-mirror editor
src/routes/<slug>/+page.server.ts            # public reads BUNDLED json
src/routes/<slug>/+page.svelte               # public page + onMount preview swap
src/routes/+layout.svelte                    # preview banner + admin chrome suppress
static/assets/<slug>.json                    # the content, one file per page
```

---

## 7. Reference implementations

These are the as-built modules. Copy and adapt names; the logic is the value.

### 7.1 `src/lib/server/cms/allowlist.ts`

```ts
import { env } from '$env/dynamic/private';

export function getAllowedEditors(): readonly string[] {
	return (env.ADMIN_EMAILS ?? '')
		.split(',')
		.map((s) => s.trim().toLowerCase())
		.filter(Boolean);
}

export function isAllowedEditor(email: string | null | undefined): boolean {
	if (!email) return false;
	return getAllowedEditors().includes(email.toLowerCase());
}
```

### 7.2 `src/lib/server/auth.ts`

```ts
import { SvelteKitAuth } from '@auth/sveltekit';
import Google from '@auth/sveltekit/providers/google';
import { env } from '$env/dynamic/private';
import { isAllowedEditor } from '$lib/server/cms/allowlist';

export const { handle, signIn, signOut } = SvelteKitAuth({
	providers: [
		Google({ clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET })
	],
	trustHost: true,
	callbacks: {
		// Lock the OAuth flow to the allowlist — disallowed accounts never get a session.
		signIn({ profile }) {
			return isAllowedEditor(profile?.email ?? null);
		}
	}
});
```

### 7.3 `src/hooks.server.ts`

```ts
import { redirect, error, type Handle } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { handle as authHandle } from '$lib/server/auth';
import { isAllowedEditor } from '$lib/server/cms/allowlist';

const PROTECTED_PREFIXES = ['/admin', '/api/cms'];

// Dev-only auth bypass. The `dev` guard makes it impossible to enable in prod.
const CMS_DEV_PREVIEW = dev && env.CMS_DEV_PREVIEW === 'true';
const PREVIEW_USER = { email: 'preview@local', name: 'Preview Editor', image: null } as const;

const previewHandle: Handle = async ({ event, resolve }) => {
	(event.locals as any).auth = async () => ({ user: PREVIEW_USER });
	return resolve(event);
};

const guardAdmin: Handle = async ({ event, resolve }) => {
	const isProtected = PROTECTED_PREFIXES.some((p) => event.url.pathname.startsWith(p));
	if (!isProtected) return resolve(event);

	const session = await event.locals.auth();
	if (!session?.user?.email) {
		const callback = event.url.pathname + event.url.search;
		throw redirect(303, `/auth/signin?callbackUrl=${encodeURIComponent(callback)}`);
	}
	if (!isAllowedEditor(session.user.email)) {
		throw error(403, 'Your account is not in the editor allowlist (ADMIN_EMAILS).');
	}
	return resolve(event);
};

export const handle: Handle = CMS_DEV_PREVIEW ? previewHandle : sequence(authHandle, guardAdmin);
```

### 7.4 `src/lib/server/cms/github.ts`

```ts
import { env } from '$env/dynamic/private';
import { dev } from '$app/environment';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const API = 'https://api.github.com';

// Encode each segment but keep `/` literal — encodeURIComponent(path) would
// turn slashes into %2F and the Contents API 404s.
function encodePath(path: string): string {
	return path.split('/').map(encodeURIComponent).join('/');
}

function repoCoords() {
	const owner = env.CMS_GITHUB_OWNER;
	const repo = env.CMS_GITHUB_REPO;
	const branch = env.CMS_GITHUB_BRANCH;
	if (!owner || !repo || !branch) throw new Error('CMS GitHub env not set.');
	return { owner, repo, branch };
}

function authHeaders() {
	const headers: Record<string, string> = {
		Accept: 'application/vnd.github+json',
		'X-GitHub-Api-Version': '2022-11-28'
	};
	if (env.GITHUB_TOKEN) headers.Authorization = `Bearer ${env.GITHUB_TOKEN}`;
	return headers;
}

// ADMIN-side read. Uses the Contents API (not the raw CDN) so private repos work
// and we always get the latest commit (raw can be cache-stale ~5 min).
export async function readJsonFromBranch<T = unknown>(path: string): Promise<T> {
	const { owner, repo, branch } = repoCoords();
	const url = `${API}/repos/${owner}/${repo}/contents/${encodePath(path)}?ref=${encodeURIComponent(branch)}`;
	const res = await fetch(url, { headers: authHeaders() });
	if (!res.ok) {
		// Dev fallback: file not pushed yet → read local working copy. Prod stays strict.
		if (res.status === 404 && dev) {
			try {
				return JSON.parse(await readFile(join(process.cwd(), path), 'utf8')) as T;
			} catch { /* fall through */ }
		}
		throw new Error(`GitHub read failed (${res.status}): ${path} on ${branch}`);
	}
	const body = (await res.json()) as { content: string; encoding: string };
	if (body.encoding !== 'base64') throw new Error(`Unexpected encoding: ${body.encoding}`);
	return JSON.parse(Buffer.from(body.content, 'base64').toString('utf8')) as T;
}

export async function tryReadJsonFromBranch<T = unknown>(path: string): Promise<T | null> {
	try {
		return await readJsonFromBranch<T>(path);
	} catch (e) {
		if (e instanceof Error && /\(404\)/.test(e.message)) return null;
		throw e;
	}
}

// Top-level keys whose JSON differs — feeds the "Changed: …" commit message line.
export function diffTopLevelKeys(
	prev: Record<string, unknown> | null,
	next: Record<string, unknown>
): string[] {
	if (!prev) return Object.keys(next);
	const all = new Set([...Object.keys(prev), ...Object.keys(next)]);
	return [...all].filter((k) => JSON.stringify(prev[k]) !== JSON.stringify(next[k]));
}

export async function commitJsonToBranch(args: {
	path: string;
	value: unknown;
	message: string;
	author: { name: string; email: string };
}): Promise<{ commit: string }> {
	const { owner, repo, branch } = repoCoords();
	if (!env.GITHUB_TOKEN) throw new Error('GITHUB_TOKEN is not set — cannot commit.');

	// 1. Current SHA (required to update; 404 → new file, SHA stays undefined).
	const getUrl = `${API}/repos/${owner}/${repo}/contents/${encodePath(args.path)}?ref=${encodeURIComponent(branch)}`;
	const getRes = await fetch(getUrl, { headers: authHeaders() });
	let sha: string | undefined;
	if (getRes.ok) sha = ((await getRes.json()) as { sha: string }).sha;
	else if (getRes.status !== 404) throw new Error(`SHA lookup failed (${getRes.status})`);

	// 2. PUT new content. author+committer = the editor, so git blame is real.
	const json = JSON.stringify(args.value, null, '\t') + '\n';
	const body = {
		message: args.message,
		content: Buffer.from(json, 'utf8').toString('base64'),
		branch,
		...(sha ? { sha } : {}),
		committer: args.author,
		author: args.author
	};
	const putRes = await fetch(`${API}/repos/${owner}/${repo}/contents/${encodePath(args.path)}`, {
		method: 'PUT',
		headers: { ...authHeaders(), 'Content-Type': 'application/json' },
		body: JSON.stringify(body)
	});
	if (!putRes.ok) throw new Error(`Commit failed (${putRes.status}): ${(await putRes.text()).slice(0, 300)}`);
	return { commit: ((await putRes.json()) as { commit: { sha: string } }).commit.sha };
}
```

### 7.5 `src/routes/api/cms/pages/[slug]/+server.ts` (write)

```ts
import { error, json, type RequestHandler } from '@sveltejs/kit';
import { commitJsonToBranch, diffTopLevelKeys, tryReadJsonFromBranch } from '$lib/server/cms/github';

export const PUT: RequestHandler = async ({ request, params, locals }) => {
	const user = (await locals.auth())?.user;
	if (!user?.email) throw error(401, 'Not signed in');

	const slug = params.slug;
	if (!slug || !/^[a-z0-9-]+$/.test(slug)) throw error(400, 'Invalid slug');

	const value = await request.json().catch(() => null);
	if (!value || typeof value !== 'object' || Array.isArray(value))
		throw error(400, 'Body must be a JSON object');

	const path = `static/assets/${slug}.json`;
	const author = { name: user.name ?? user.email, email: user.email };

	const previous = await tryReadJsonFromBranch<Record<string, unknown>>(path);
	const changed = diffTopLevelKeys(previous, value as Record<string, unknown>);
	const message =
		`cms(${slug}): edited by ${author.email}\n\n` +
		`Editor: ${author.name} <${author.email}>\nPage:   /${slug}\nSource: ${path}\n` +
		(changed.length ? `Changed: ${changed.join(', ')}\n` : '');

	try {
		const { commit } = await commitJsonToBranch({ path, value, message, author });
		return json({ ok: true, commit });
	} catch (e) {
		throw error(502, e instanceof Error ? e.message : 'Commit failed');
	}
};
```

### 7.6 `src/routes/api/cms/commit-status/[sha]/+server.ts` (deploy status)

Merges GitHub's legacy commit **statuses** (some Vercel integrations) with
**check-runs** (Actions / modern Vercel), rolls into one state (failure > pending
> success), and surfaces a Vercel deploy URL.

```ts
import { error, json, type RequestHandler } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';

export const GET: RequestHandler = async ({ params, locals }) => {
	if (!(await locals.auth())?.user?.email) throw error(401, 'Not signed in');
	const sha = params.sha;
	if (!sha || !/^[a-f0-9]{7,40}$/.test(sha)) throw error(400, 'Invalid commit sha');

	const { CMS_GITHUB_OWNER: owner, CMS_GITHUB_REPO: repo, GITHUB_TOKEN: token } = env;
	if (!owner || !repo || !token) throw error(500, 'CMS GitHub env not configured');
	const headers = {
		Authorization: `Bearer ${token}`,
		Accept: 'application/vnd.github+json',
		'X-GitHub-Api-Version': '2022-11-28'
	};

	const [statusRes, checksRes] = await Promise.all([
		fetch(`https://api.github.com/repos/${owner}/${repo}/commits/${sha}/status`, { headers }),
		fetch(`https://api.github.com/repos/${owner}/${repo}/commits/${sha}/check-runs`, { headers })
	]);
	if (!statusRes.ok && !checksRes.ok) throw error(502, 'GitHub status lookup failed');

	type Ctx = { context: string; state: string; url: string | null };
	const contexts: Ctx[] = [];

	if (statusRes.ok) {
		const b = (await statusRes.json()) as { statuses?: any[] };
		for (const s of b.statuses ?? [])
			contexts.push({ context: s.context, state: s.state, url: s.target_url });
	}
	if (checksRes.ok) {
		const b = (await checksRes.json()) as { check_runs?: any[] };
		for (const c of b.check_runs ?? []) {
			let st = 'pending';
			if (c.status === 'completed') {
				if (c.conclusion === 'success') st = 'success';
				else if (c.conclusion === 'failure' || c.conclusion === 'timed_out') st = 'failure';
				else if (c.conclusion === 'skipped' || c.conclusion === 'neutral') st = 'skipped';
				else st = 'error';
			}
			contexts.push({ context: c.name, state: st, url: c.details_url ?? c.html_url });
		}
	}

	const meaningful = contexts.filter((c) => c.state !== 'skipped' && c.state !== 'neutral');
	let overall: 'pending' | 'success' | 'failure' | 'unknown';
	if (!meaningful.length) overall = 'unknown';
	else if (meaningful.some((c) => c.state === 'failure' || c.state === 'error')) overall = 'failure';
	else if (meaningful.some((c) => c.state === 'pending')) overall = 'pending';
	else overall = 'success';

	const vercel = contexts.find((c) => /vercel/i.test(c.context) && c.url);
	return json({ sha, state: overall, deployUrl: vercel?.url ?? null, contexts });
};
```

### 7.7 `src/lib/cms/preview.ts` (entirely client-side)

```ts
export const PREVIEW_QUERY_KEY = '_cmsPreview';
const LS_PREFIX = 'cmsPreview:';

export function storePreviewContent(content: unknown): string {
	if (typeof window === 'undefined') throw new Error('browser only');
	const token = randomToken();
	try { window.localStorage.setItem(LS_PREFIX + token, JSON.stringify(content)); }
	catch (e) { console.warn('[preview] localStorage write failed', e); }
	return token;
}

export function readPreviewContent<T = unknown>(token: string): T | null {
	if (typeof window === 'undefined') return null;
	try {
		const raw = window.localStorage.getItem(LS_PREFIX + token);
		return raw ? (JSON.parse(raw) as T) : null;
	} catch { return null; }
}

// Public pages call this in onMount. Reads the token from the URL, returns the
// stashed payload or null. Returns null on the server (no window).
export function readPreviewIfActive<T = unknown>(): T | null {
	if (typeof window === 'undefined') return null;
	const token = new URLSearchParams(window.location.search).get(PREVIEW_QUERY_KEY);
	return token ? readPreviewContent<T>(token) : null;
}

export function buildPreviewUrl(publicPath: string, content: unknown): string {
	const token = storePreviewContent(content);
	const sep = publicPath.includes('?') ? '&' : '?';
	return `${publicPath}${sep}${PREVIEW_QUERY_KEY}=${token}`;
}

function randomToken(): string {
	const bytes = new Uint8Array(9);
	if (typeof window !== 'undefined' && window.crypto?.getRandomValues) window.crypto.getRandomValues(bytes);
	else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
	let bin = '';
	for (const b of bytes) bin += String.fromCharCode(b);
	return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
```

### 7.8 Public read path

`src/routes/<slug>/+page.server.ts` — **bundled import, no GitHub, no URL access:**

```ts
import type { PageServerLoad } from './$types';
import bundled from '../../../static/assets/<slug>.json';

// Public page serves the JSON bundled into this deploy. Save in /admin commits a
// new JSON → Vercel rebuilds → next deploy reflects it. No runtime GitHub call.
// Preview of unsaved edits is client-side only (localStorage) — no preview branch here.
export const load: PageServerLoad = async () => {
	return { content: bundled, isPreview: false };
};
```

`src/routes/<slug>/+page.svelte` — **the onMount swap:**

```svelte
<script>
	import { onMount } from 'svelte';
	import { readPreviewIfActive } from '$lib/cms/preview';
	export let data;
	let preview = null;
	$: content = preview ?? data.content;   // preview wins when present
	onMount(() => { preview = readPreviewIfActive(); });
	// ...render from `content`
</script>
```

### 7.9 `src/routes/+layout.svelte` — banner + admin chrome suppression

```svelte
<script>
	import { browser } from '$app/environment';
	import { page } from '$app/stores';
	import { PREVIEW_QUERY_KEY } from '$lib/cms/preview';
	$: isAdmin = $page.url.pathname.startsWith('/admin');
	// browser-guarded + URL-derived so it works on prerendered pages.
	$: isPreview = browser && !isAdmin && $page.url.searchParams.has(PREVIEW_QUERY_KEY);
</script>

{#if isPreview}<div class="cms-preview-banner">CMS preview — unsaved changes</div>{/if}
{#if !isAdmin}<Header />{/if}
<slot />
{#if !isAdmin}<Footer />{/if}
```

### 7.10 Admin editor pattern (`src/routes/admin/pages/<slug>/+page.svelte`)

The admin **server load reads live from GitHub:**

```ts
// src/routes/admin/pages/<slug>/+page.server.ts
import type { PageServerLoad } from './$types';
import { readJsonFromBranch } from '$lib/server/cms/github';
export const load: PageServerLoad = async () => ({
	content: await readJsonFromBranch('static/assets/<slug>.json')
});
```

The component is a **visual mirror** of the public page with inputs bound to a
working copy. Save → `PUT` → poll status:

```svelte
<script lang="ts">
	import { onDestroy } from 'svelte';
	import { buildPreviewUrl } from '$lib/cms/preview';
	export let data;

	let content = structuredClone(data.content);   // editable working copy
	let saving = false, saveError: string | null = null, savedCommit: string | null = null;
	let deployState: 'pending' | 'success' | 'failure' | 'unknown' | null = null;
	let deployUrl: string | null = null;
	let pollTimer: ReturnType<typeof setTimeout> | null = null;
	onDestroy(() => pollTimer && clearTimeout(pollTimer));

	function openPreview() {
		window.open(buildPreviewUrl('/<slug>', content), '_blank', 'noopener');
	}

	async function save() {
		if (pollTimer) clearTimeout(pollTimer);
		saving = true; saveError = null; savedCommit = null; deployState = null;
		try {
			const res = await fetch('/api/cms/pages/<slug>', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(content)
			});
			if (!res.ok) throw new Error(`Save failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
			savedCommit = (await res.json()).commit;
			deployState = 'pending';
			poll(savedCommit, 0);
		} catch (e) {
			saveError = e instanceof Error ? e.message : String(e);
		} finally { saving = false; }
	}

	async function poll(sha: string, attempt: number) {
		try {
			const res = await fetch(`/api/cms/commit-status/${sha}`);
			if (res.ok) { const b = await res.json(); deployState = b.state; deployUrl = b.deployUrl; }
		} catch { /* retry next tick */ }
		if (deployState === 'success' || deployState === 'failure' || attempt >= 30) return;
		const delay = Math.min(15_000, 5000 + attempt * 1000);   // 5s → 15s backoff
		pollTimer = setTimeout(() => poll(sha, attempt + 1), delay);
	}
</script>
```

Wrap each editable field in an input bound to the working copy, e.g.
`<input bind:value={content.hero.title} />`, and for rich text use
`<MarkdownEditor bind:value={content.body} />`. List items get inline add/remove
buttons that splice the array.

### 7.11 Markdown: editor + renderer

`src/lib/cms/markdown.ts` — public-side rendering with `marked`. External links
get `target="_blank" rel="noopener noreferrer"`; headings get auto-`id`s for
anchors:

```ts
import { marked, type RendererObject, type Tokens } from 'marked';

const renderer: RendererObject = {
	link(token: Tokens.Link) {
		const href = token.href ?? '';
		const text = (this as any).parser.parseInline(token.tokens);
		const ext = /^https?:\/\//.test(href);
		return `<a href="${escapeAttr(href)}"${ext ? ' target="_blank" rel="noopener noreferrer"' : ''}>${text}</a>`;
	},
	heading(token: Tokens.Heading) {
		const text = (this as any).parser.parseInline(token.tokens);
		return `<h${token.depth} id="${slugify(token.text)}">${text}</h${token.depth}>\n`;
	}
};
function escapeAttr(s: string) { return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }
export function slugify(s: string) { return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
marked.use({ renderer });
export function renderMarkdown(md?: string | null) { return marked.parse(md ?? '', { async: false }) as string; }
export function renderMarkdownInline(md?: string | null) { return marked.parseInline(md ?? '', { async: false }) as string; }
```

`src/lib/cms/MarkdownEditor.svelte` — TipTap, **dynamically imported in
`onMount`** (DOM at import time → SSR-unsafe). Key points:

- Toolbar = bold, italic, strike, H2, H3, link **only** (match your site's CSS).
- `tiptap-markdown` for round-trip; read back with `editor.storage.markdown.getMarkdown()`.
- Include the `SanitizeStoredMarks` plugin to kill the stray-bold bug:

```ts
const SanitizeStoredMarks = Extension.create({
	name: 'sanitizeStoredMarks',
	addProseMirrorPlugins() {
		return [new Plugin({
			appendTransaction(_trs, _old, newState) {
				if (!newState.selection.empty) return null;
				const stored = newState.storedMarks;
				if (!stored?.length) return null;
				const here = newState.selection.$from.marks();
				const filtered = stored.filter((sm) => here.some((m) => m.eq(sm)));
				if (filtered.length === stored.length) return null;
				return newState.tr.setStoredMarks(filtered.length ? filtered : null);
			}
		})];
	}
});
```

- Push external `value` changes back into the editor guarded by a `suppress`
  flag so you don't loop `onUpdate` → `setContent` → `onUpdate`.

---

## 8. Definition of done (verification checklist)

- [ ] Disallowed Google account is rejected at sign-in (no session issued).
- [ ] Allowed account reaches `/admin`; unauthenticated hit → redirect to sign-in.
- [ ] `/api/cms/*` returns 401/403 without a valid allowlisted session.
- [ ] Save commits to the correct branch; the commit's author is the editor's email.
- [ ] New-file save (no prior JSON) creates; second save updates (SHA path works).
- [ ] Editor shows pending → deployed ✓ with a working live link.
- [ ] Public page renders from **bundled** JSON — confirm zero runtime GitHub
      calls (grep: no `readJsonFromBranch` in any public `+page.server.ts`).
- [ ] Preview ↗ opens the public page with the banner and the unsaved content,
      in the same browser.
- [ ] On a **production build** (not dev): preview still works (proves CSR is on
      and `onMount` fires). This is the test that catches the `csr = dev` trap.
- [ ] If any public page is prerendered: its load does not read `url`, and all
      absolute URLs use a hardcoded `SITE_URL`, not `$page.url.origin`.
- [ ] Markdown editor only exposes formatting the public CSS styles.

---

## 9. How to hand this off (Claude Code skill)

This playbook ships as a Claude Code **skill** so the receiving agent
auto-discovers it and can invoke it by name. Both ends are Claude Code, so use
the native machinery rather than a loose doc.

1. Copy the whole folder `.claude/skills/light-cms/` (this `playbook.md` plus its
   `SKILL.md`) into the target project's `.claude/skills/`. Claude Code indexes
   skills from `.claude/skills/<name>/SKILL.md` automatically — no registration.
2. The agent then sees `light-cms` in its skills list and invokes it (or you type
   `/light-cms`). `SKILL.md` is the lean trigger + procedure; it tells the agent
   to read this `playbook.md` for the full reference code.
3. Add a one-line pointer in the target project's `CLAUDE.md`, e.g.:
   `- To add CMS-editable content, use the **light-cms** skill (.claude/skills/light-cms/).`
4. If the agent can reach this repo too, point it here as the live reference
   implementation — playbook + working code together is the strongest transfer.
5. Optional, if you want hands-off scaffolding: add a project subagent
   (`.claude/agents/`) whose prompt is "follow the light-cms skill" so it can run
   the build end-to-end in its own context.

The two things it must never re-derive the hard way: **public reads bundled JSON
(never GitHub at runtime)** and **preview is client-side localStorage (never
server-side, never a URL-encoded payload)**. Everything else follows from those.

---

## 10. Local Playwright test (preview only)

Scope: **local Playwright, run by hand after you implement a page** — not CI, not
a test suite. Test **preview only**. It's the highest-value check, needs no auth,
and has no side effects. Don't test Save (it commits to the repo + triggers a
real deploy) and don't test auth (third-party Google OAuth).

The check, after wiring up a page: it proves CSR is on and `onMount` fires on a
prerendered/prod page — exactly what `csr = dev` silently breaks. No auth needed
because preview is pure client-side. Run it against a local production build
(`npm run build && npm run preview`, port 4173).

```js
// preview-prod.spec.js — run against `npm run build && npm run preview` (port 4173)
import { test, expect } from '@playwright/test';

const ORIGIN = 'http://localhost:4173';
const SLUG = '/public-servant-pulse';
const TOKEN = 'testtoken123';

test('unsaved preview content overlays the prod page', async ({ page }) => {
	const errors = [];
	page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

	// 1. Land on the origin so localStorage is same-origin, then seed a payload
	//    shaped like the page's JSON but with a recognizable doctored value.
	await page.goto(ORIGIN + SLUG);
	await page.evaluate(([token]) => {
		const doctored = { hero: { title: 'PREVIEW-MARKER-TITLE' } /* …rest of shape… */ };
		localStorage.setItem('cmsPreview:' + token, JSON.stringify(doctored));
	}, [TOKEN]);

	// 2. Visit the token URL — onMount should read localStorage and swap content.
	await page.goto(`${ORIGIN}${SLUG}?_cmsPreview=${TOKEN}`);

	// 3. Banner shows (URL-derived) AND the doctored value rendered (swap fired).
	await expect(page.locator('.cms-preview-banner')).toBeVisible();
	await expect(page.getByText('PREVIEW-MARKER-TITLE')).toBeVisible();
	expect(errors).toEqual([]);
});
```

If the swap *doesn't* fire, suspect (in order): `csr = dev` on the route,
`onMount` not calling `readPreviewIfActive`, or the banner reading server `data`
instead of `$page.url.searchParams`.

Keep Playwright headless — a headed run steals window focus.
