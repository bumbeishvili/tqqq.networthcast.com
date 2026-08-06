---
name: mcp-api-integration
description: Working rules for Figma and Asana over MCP and REST — which writes are safe when a connection acts as the signed-in user, which interface to reach for, how OAuth sessions fail quietly, and how to prove a connection returns real data. Covers Figma file key and node id parsing, design-token reads, the Asana board-column move, the ToDo → In Progress → Dev Testing convention, and REST fallbacks for headless runs. Use when reading a Figma design, pulling Figma or Asana data over REST, reading or updating Asana tasks, wiring up either MCP server, or debugging a call that returns nothing.
---
# MCP & API integration

Figma and Asana, each reachable over MCP or REST. They share one rule.

- **[`playbook.md`](playbook.md)** — mechanics: server config, endpoint tables, tool behaviours, rate limits, Asana REST, board lifecycle.
- **[`figma-client.ts`](figma-client.ts)** / **[`figma_client.py`](figma_client.py)** / **[`asana_client.py`](asana_client.py)** — dependency-free REST clients.

## The identity rule

**Every connection here acts as the signed-in user.** True of an OAuth MCP server and of a personal REST token, so it holds whichever way you reach Asana.

- **Report blockers in your chat reply.** Comments, messages and replies land under the user's name and read as though they wrote them, so leave `mcp__asana__add_comment` and `POST /tasks/{gid}/stories` alone. The user relays what they want relayed.
- **Change state freely.** Assignment, section moves, custom-field values, type and label changes carry no false voice.
- If a comment goes out by mistake, delete it rather than leaving it under their name (playbook §6).

Apply this to any OAuth server you connect later.

## Choosing the interface

- **Figma MCP** to read a design you are implementing.
- **Figma REST** for what MCP does not expose: asset exports, bulk reads across files, version history.
- **Asana MCP** for task state in an interactive session.
- **Asana REST** with a personal token when MCP OAuth cannot run — headless, cron, non-interactive. It needs no browser callback.

Which Figma tool suits which job, and how each one behaves, is playbook §5.

## Figma

- **Verify the tool namespace before calling.** The configured server name and the live tool prefix differ: Figma via claude.ai surfaces as `mcp__claude_ai_Figma__*`, not `figma-remote-mcp`. Read the tool list.
- **Convert `-` to `:` in node ids.** A URL carries `node-id=1-23`; every tool and endpoint wants `1:23`. The hyphen returns an empty node set, which reads as a missing layer.
- **Take exact values from `get_variable_defs`.** It returns the bound colors, sizes and named type styles. A hex sampled off a screenshot is a guess.
- **Read the comments and annotations.** Comments are the file's threads; annotations are dev-mode notes pinned to a node. Both carry requirements the visual alone does not.
- **Load the matching skill first** where one exists: `figma-design-to-code` before `get_design_context`, `figma-use` before `use_figma`, `figma-create-new-file` before `create_new_file`, `figma-generate-diagram` before `generate_diagram`.

## Asana

- **Move a task between board columns with `POST /sections/{gid}/addTask`.** A column is a *section*, and moving is not a task-field update. Read section gids from `GET /projects/{gid}/sections`; a guessed gid fails silently.
- **Request `opt_fields=memberships.section.name`** to learn a task's current column. It is not a top-level field, so the parameter is what makes it appear.
- **Follow ToDo → In Progress → Dev Testing.** Move to *In Progress* when you start, to *Dev Testing* once the fix is verified. Leave *Done* to the reviewer. One task at a time (playbook §10).
- **Keep port 8080 free** for the MCP OAuth callback. A process holding it makes authentication fail as though the server were down.
- Marker.io tickets carry a reproduction URL and a screenshot attachment; the retrieval path is playbook §9.

## Before you rely on a resultwai

- **Prove the connection returns real data.** An empty first call means either no matching records or a dead session. Establish which before reporting either.
- **Re-authenticate when something that worked returns nothing.** An expired session surfaces as empty results or a generic failure rather than as an auth error.
- **Check for a live session before unattended work.** Re-auth returns a URL a human opens in a browser, so a headless or cron run cannot complete it and should fail loudly instead of retrying.
- **Confirm a value that matters against a second source** — the REST API, or the design open in the app.

## Practices

- **Read credentials from the environment**: `FIGMA_TOKEN`, `ASANA_TOKEN`.
- **Match the header to the token type** — `X-Figma-Token` for a personal access token, `Authorization: Bearer` for OAuth. Crossing them returns 403 and reads like a file-permission problem.
- **Ask for the smallest response.** `depth` and an explicit `ids` list keep a design file from arriving whole.
- **Cap 429 backoff.** Figma has returned `Retry-After` values large enough to stall a script for days; cap the wait and surface the limit (playbook §4).
- **Record the `fileKey` and node id you read** so the next person opens exactly what you saw.
