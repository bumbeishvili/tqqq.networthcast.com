# MCP & API integration — playbook

Recipes for the Figma MCP server, the Figma REST API and the Asana MCP server.

---

## 1. Server configuration

Both servers are HTTP transport with OAuth. In `~/.claude.json` under the project, or in a project `.mcp.json`:

```json
{
  "mcpServers": {
    "figma-remote-mcp": { "type": "http", "url": "https://mcp.figma.com/mcp" },
    "asana": {
      "type": "http",
      "url": "https://mcp.asana.com/v2/mcp",
      "oauth": { "clientId": "<client-id>", "callbackPort": 8080 }
    }
  }
}
```

Confirm port 8080 is free before authenticating Asana:

```bash
lsof -nP -iTCP:8080 -sTCP:LISTEN
```

Anything listening there takes the OAuth callback and the flow fails without naming the cause.

---

## 2. Figma URLs and node ids

```
https://www.figma.com/design/<fileKey>/<fileName>?node-id=<nodeId>
```

The URL writes node ids with a hyphen; the API and the MCP tools want a colon.

```js
function parseFigmaUrl(url) {
  const u = new URL(url);
  const fileKey = u.pathname.split('/')[2];
  const raw = u.searchParams.get('node-id');
  return { fileKey, nodeId: raw ? raw.replace(/-/g, ':') : null };
}
```

`figma.com/design/abc123/Site?node-id=41-1096` gives `fileKey: 'abc123'`, `nodeId: '41:1096'`. Passing `41-1096` through returns an empty node set rather than an error, which reads as a missing layer.

---

## 3. Figma REST endpoints

Base `https://api.figma.com`. Each path below was confirmed to exist by an unauthenticated probe returning 401 or 403 while an invented path returns 404.

| Path | Use |
|---|---|
| `GET /v1/me` | Cheapest call that proves a token works |
| `GET /v1/files/:key` | Whole file; take `depth` and `ids` to trim it |
| `GET /v1/files/:key/nodes?ids=1:23` | Specific subtrees, far smaller than the file |
| `GET /v1/images/:key?ids=1:23&format=svg&scale=2` | Render nodes to images; returns URLs to fetch |
| `GET /v1/files/:key/images` | Image fills already placed in the file |
| `GET /v1/files/:key/versions` | Version history |
| `GET /v1/files/:key/comments` | Comments on the file |

Auth header depends on the token:

```
X-Figma-Token: <personal access token>
Authorization: Bearer <oauth access token>
```

A token in the wrong header returns 403, which reads as a permissions problem on the file rather than a header mistake. Check the header first.

`GET /v1/images` returns URLs rather than image bytes. Fetch those separately, and treat them as short-lived.

---

## 4. Rate limits

Figma meters by credits per minute and per day, with a different cost per endpoint, so a script that stays under a request-per-second target can still exhaust the budget on expensive calls. Figma's guidance is roughly two requests a second against file reads and three against the others; treat those as a ceiling and stay under it. OAuth-app limits apply to the whole application rather than per user, so several people running the same integration share one budget.

Deliberately do not hardcode the credit figures — they change. Read them from [Figma's rate-limit documentation](https://developers.figma.com/docs/rest-api/) when the number matters.

**Cap the backoff.** A 429 from Figma has been reported carrying a `Retry-After` in the hundreds of thousands of seconds. Honouring that literally stalls a script for days and looks like a hang:

```js
const wait = Math.min(Number(res.headers.get('retry-after') || 0) * 1000, MAX_BACKOFF_MS);
```

When the header exceeds your cap, stop and tell the user the budget is exhausted. Retrying past that point burns the next window too.

---

## 5. Which Figma interface for which job

| Job | Interface |
|---|---|
| Implement a design in code | MCP `get_design_context` |
| Understand a file's structure | MCP `get_metadata` |
| Exact tokens — hex, px, type styles | MCP `get_variable_defs` |
| Check your build against the design | MCP `get_screenshot` |
| Export assets at set scales and formats | REST `/v1/images` |
| Read many files in one pass | REST `/v1/files/:key` per file, rate-limited |
| Find what changed and when | REST `/v1/files/:key/versions` |

Load the matching skill before the MCP tools that require one: `figma-design-to-code` before `get_design_context`, `figma-use` before `use_figma`.

MCP read-tool behaviours worth knowing before you call:

- **`get_variable_defs`** returns a node's bound design tokens — colors, font sizes, line heights, named styles. Pull it before hardcoding any value; it beats reading a hex off a screenshot.
- **`get_screenshot` returns a short-lived asset URL and a curl command, not image bytes.** Download with curl to keep the response small; pass `enableBase64Response: true` only when you can't fetch. The URL is signed and expires — treat it like a secret.
- **`get_metadata` with no `nodeId` lists top-level pages, and often only the active page.** A frame on another page still resolves when you pass its id directly, so query the id you have instead of enumerating. Metadata gives a node's children only — no parent link — so you cannot walk up to a containing frame; start from a page or a known id.
- Tool names carry the live namespace, which need not match the configured server name. Check the tool list before calling (SKILL.md, Figma).

---

## 6. Asana writes

Allowed, because they change task state:

- assignment
- section moves
- custom-field values
- task type and labels

Not allowed, because it attributes them to the user: comments via `mcp__asana__add_comment` (or REST `POST /tasks/{gid}/stories`), and any other call that produces text in the user's voice. The rule holds for a personal REST token too, not only the OAuth MCP server.

When you hit a blocker — a missing Figma link, an ambiguous spec, an asset that was never attached — write it in your chat reply. The user relays it if they want it on the ticket.

If you posted a comment by mistake, remove it: `GET /tasks/{gid}/stories` to find the story gid, then `DELETE /stories/{gid}`. You can only delete stories your own token authored.

---

## 7. Recovering a dead session

Symptoms come in this order: a tool that worked before returns empty, then returns a generic error, then names an auth failure. Empty is the common case, so treat an unexpected empty result as an auth question first.

```
mcp__figma-remote-mcp__authenticate
```

Returns a URL the user opens in a browser. It cannot complete without them, so a scheduled or headless run has to fail loudly rather than retry.

Before a long unattended job, make one cheap read and confirm real data comes back.

---

## 8. Connection check

Run this before depending on either server. It separates "authenticated and empty" from "not authenticated".

```bash
# REST token works, and identifies who it belongs to
curl -s -H "X-Figma-Token: $FIGMA_TOKEN" https://api.figma.com/v1/me | head -c 200

# a known file returns a name, not an error body
curl -s -H "X-Figma-Token: $FIGMA_TOKEN" \
  "https://api.figma.com/v1/files/$FILE_KEY?depth=1" | head -c 200
```

For the MCP servers, the equivalent is one small read against something you know exists — a file you can see in the browser, a task you can name. A result matching what you already know is the only evidence the connection is live.

---

## 9. Asana REST

The fallback when the MCP server isn't connected — which is the norm in a headless, cron or otherwise non-interactive run, because the MCP OAuth flow needs a browser. A personal access token (Asana → Settings → Apps → Developer → personal access token) sent as a Bearer header needs no callback and works unattended.

Base `https://app.asana.com/api/1.0`. Every write wraps its body in `{ "data": { ... } }`, and every read can trim its payload with `opt_fields`.

```
Authorization: Bearer <personal access token>
Content-Type: application/json   # writes only
```

| Call | Use |
|---|---|
| `GET /users/me` | Cheapest call that proves the token works |
| `GET /projects/{gid}/sections` | Board columns and their gids — you need these to move tasks |
| `GET /tasks?project={gid}&opt_fields=name,completed,notes,memberships.section.name,permalink_url&limit=100` | List a project's tasks with their current column |
| `GET /tasks/{gid}?opt_fields=name,notes,permalink_url` | One task's detail |
| `GET /tasks/{gid}/attachments?opt_fields=name,download_url,view_url` | Attachments; `download_url` is a signed, short-lived asset URL |
| `POST /sections/{gid}/addTask` `{data:{task}}` | **Move a task into a board column** |
| `PUT /tasks/{gid}` `{data:{completed:true}}` | Complete / reopen |
| `PUT /tasks/{gid}` `{data:{assignee, custom_fields, ...}}` | Other state changes |
| `POST /tasks/{gid}/stories` `{data:{text}}` | Comment — **avoid** (identity rule) |
| `DELETE /stories/{gid}` | Remove a comment your token authored |

Two things that waste time if you don't know them:

- **A board column is a *section*.** Moving a task between columns is `POST /sections/{gid}/addTask` — not a field on the task. There is no `section` field to `PUT`. Section gids aren't guessable; read them from `GET /projects/{gid}/sections` first.
- **The current column lives in `memberships[].section.name`,** not a top-level field. Ask for it explicitly (`opt_fields=memberships.section.name`) or it won't be in the response.

### Marker.io tasks

QA tickets filed by Marker.io have AI-generated titles prefixed `[Marker.io]` and a notes body that carries, in plain text:

- `Source URL:` — the page to reproduce the bug on.
- a `https://files.marker.io/...` asset link — **auth-walled; it returns an HTML login page, not the image.**
- reporter name/email and a `app.marker.io/i/...` issue link.

Read the actual screenshot from the task's own attachment instead: `GET /tasks/{gid}/attachments` → `download_url` (a signed `asanausercontent.com` URL, short-lived — fetch it promptly).

See `asana_client.py` for a copy-ready helper covering list / move / complete / attachments.

---

## 10. Board lifecycle convention

A QA board runs its tasks left to right through columns. The convention that keeps the board honest:

- **ToDo → In Progress → Dev Testing.** Move a task to *In Progress* the moment you start it, so the board shows what's being worked on. Move it to *Dev Testing* only when it is fixed **and** verified — not when the edit is written.
- **Never move a task to *Done*.** Closing is the reviewer's decision. The agent's terminal state is *Dev Testing*; a human promotes from there.
- **One at a time.** Carry a single task through the full lifecycle before picking up the next, so In Progress never fills with half-done work.
- **Verify before Dev Testing.** Reproduce the reported bug first, fix it, then prove the fix against the same repro; for a web bug that means a throwaway Playwright script, not an assumption. If the [`playwright-repro`](../../../playwright-repro/skills/playwright-repro/SKILL.md) skill is available, use it for the reproduce-first workflow (measure against ground truth, then prove the fix). A task reaches Dev Testing only with that evidence behind it.
- **Never comment to report progress.** The board columns *are* the status. Blockers, questions and "can't reproduce" go in your chat reply to the user, never on the ticket (identity rule, §6).
- **Polling for new work** (unattended runs): re-read the ToDo column on an interval; a task's section, not a flag, tells you it's new. Stop when ToDo is empty rather than spinning.
