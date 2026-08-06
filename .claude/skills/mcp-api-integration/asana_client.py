#!/usr/bin/env python3
"""Asana REST helper. Python 3 stdlib only, no dependencies.

    ASANA_TOKEN=<personal access token> python3 asana_client.py list <project_gid>

The fallback for when the Asana MCP server isn't connected (headless / cron /
non-interactive runs, where the MCP OAuth flow can't complete). A personal access
token from Asana → Settings → Apps → Developer needs no callback and works
unattended.

Identity rule: everything written with this token is attributed to the token's
owner. Move/complete/assign are fine (task-state edits). Comments are a speech act
in the user's voice — `comment()` is here only so `delete_story()` can undo an
accidental one; don't post on the user's behalf.
"""
import json
import os
import sys
import urllib.request

BASE = "https://app.asana.com/api/1.0"


def api(path, data=None, method=None):
    """One request. GET by default; pass `data` (dict) for a POST/PUT body."""
    token = os.environ.get("ASANA_TOKEN", "")
    if not token:
        raise RuntimeError("set ASANA_TOKEN")
    body = json.dumps({"data": data}).encode() if data is not None else None
    req = urllib.request.Request(
        f"{BASE}/{path.lstrip('/')}",
        data=body,
        method=method or ("POST" if data is not None else "GET"),
    )
    req.add_header("Authorization", f"Bearer {token}")
    if body:
        req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req) as r:
        return json.load(r)


# --- reads -------------------------------------------------------------------

def me():
    """Cheapest call that proves the token works."""
    return api("users/me")["data"]


def sections(project_gid):
    """Board columns and their gids — needed before moving a task."""
    return api(f"projects/{project_gid}/sections")["data"]


def list_tasks(project_gid):
    """Project tasks with their current board column (memberships[].section.name)."""
    fields = "name,completed,notes,memberships.section.name,permalink_url"
    return api(f"tasks?project={project_gid}&opt_fields={fields}&limit=100")["data"]


def task(gid):
    return api(f"tasks/{gid}?opt_fields=name,notes,permalink_url")["data"]


def attachments(gid):
    """Attachments; each `download_url` is a signed, short-lived asset URL — fetch promptly.

    For Marker.io tickets the real screenshot is here; the files.marker.io link in
    the notes is auth-walled and returns HTML, not the image.
    """
    return api(f"tasks/{gid}/attachments?opt_fields=name,download_url,view_url")["data"]


def section_of(t):
    """The task's current board column from a list_tasks() row, or '' if none."""
    memberships = t.get("memberships") or [{}]
    return (memberships[0].get("section") or {}).get("name", "")


# --- writes (task-state only) ------------------------------------------------

def move(task_gid, section_gid):
    """Move a task into a board column. A column is a *section*; this is NOT a task
    field update — there is no `section` field to PUT."""
    return api(f"sections/{section_gid}/addTask", {"task": task_gid})


def complete(gid, done=True):
    return api(f"tasks/{gid}", {"completed": done}, method="PUT")


# --- speech acts (see identity rule) -----------------------------------------

def comment(gid, text):  # noqa: D401 — intentionally discouraged
    """Post a comment. Attributed to the token owner — avoid; prefer surfacing the
    blocker in chat. Present so an accidental comment can be undone with delete_story()."""
    return api(f"tasks/{gid}/stories", {"text": text})


def delete_story(story_gid):
    """Remove a story/comment your token authored (undo an accidental comment)."""
    return api(f"stories/{story_gid}", method="DELETE")


# --- tiny CLI ----------------------------------------------------------------

if __name__ == "__main__":
    args = sys.argv[1:]
    cmd = args[0] if args else "me"
    if cmd == "me":
        print(me()["name"])
    elif cmd == "sections":
        for s in sections(args[1]):
            print(s["gid"], s["name"])
    elif cmd == "list":
        rows = list_tasks(args[1])
        by_section = {}
        for t in rows:
            by_section.setdefault(section_of(t) or "(no section)", []).append(t)
        for name, ts in by_section.items():
            print(f"## {name} ({len(ts)})")
            for t in ts:
                print(f"  {t['gid']}  {t['name']}")
    elif cmd == "move":  # move <task_gid> <section_gid>
        move(args[1], args[2])
        print(f"moved {args[1]} -> section {args[2]}")
    elif cmd == "complete":
        complete(args[1])
        print(f"completed {args[1]}")
    elif cmd == "attachments":
        for a in attachments(args[1]):
            print(a.get("name"), "|", a.get("download_url") or a.get("view_url"))
    else:
        print(f"unknown command: {cmd}", file=sys.stderr)
        sys.exit(1)
