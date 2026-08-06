"""Figma REST client. Python 3.9+, standard library only.

    FIGMA_TOKEN=<personal access token> python figma_client.py [figma-url]

An OAuth access token works too - pass token_type="oauth".
"""

import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

BASE = "https://api.figma.com"
MAX_BACKOFF_S = 60  # Figma has returned Retry-After values of days. Cap it.
MAX_RETRIES = 4


def parse_figma_url(url):
    """Node ids arrive hyphenated in URLs and are colon-separated everywhere else."""
    parts = urllib.parse.urlparse(url)
    segments = parts.path.split("/")
    if len(segments) < 3 or not segments[2]:
        raise ValueError(f"no fileKey in {url}")
    raw = urllib.parse.parse_qs(parts.query).get("node-id", [None])[0]
    return {"fileKey": segments[2], "nodeId": raw.replace("-", ":") if raw else None}


class RateLimited(Exception):
    def __init__(self, retry_after_seconds):
        self.retry_after_seconds = retry_after_seconds
        super().__init__(f"rate limited; Figma asked for {retry_after_seconds}s")


class FigmaClient:
    def __init__(self, token=None, token_type="pat"):
        self.token = token or os.environ.get("FIGMA_TOKEN", "")
        if not self.token:
            raise ValueError("set FIGMA_TOKEN")
        self.token_type = token_type

    def _headers(self):
        # Crossing these returns 403, which reads as a file-permission problem.
        if self.token_type == "oauth":
            return {"Authorization": f"Bearer {self.token}"}
        return {"X-Figma-Token": self.token}

    def _get(self, path):
        for attempt in range(MAX_RETRIES + 1):
            req = urllib.request.Request(BASE + path, headers=self._headers())
            try:
                with urllib.request.urlopen(req, timeout=30) as res:
                    return json.loads(res.read())
            except urllib.error.HTTPError as e:
                if e.code == 429:
                    asked = int(e.headers.get("retry-after") or 0)
                    # Past the cap the budget is gone; retrying eats the next window.
                    if asked > MAX_BACKOFF_S or attempt >= MAX_RETRIES:
                        raise RateLimited(asked) from None
                    time.sleep(max(asked, 2**attempt))
                    continue
                if e.code >= 500 and attempt < MAX_RETRIES:
                    time.sleep(2**attempt)
                    continue
                body = e.read().decode("utf-8", "replace")[:300]
                raise RuntimeError(f"{e.code} {path}: {body}") from None

    def me(self):
        """Cheapest call that proves the token works. Run it before anything long."""
        return self._get("/v1/me")

    def file(self, key, depth=None, ids=None):
        """`depth` keeps a large design file from arriving whole."""
        q = {}
        if depth:
            q["depth"] = depth
        if ids:
            q["ids"] = ",".join(ids)
        suffix = f"?{urllib.parse.urlencode(q)}" if q else ""
        return self._get(f"/v1/files/{key}{suffix}")

    def nodes(self, key, ids, depth=None):
        """Specific subtrees. Much smaller than the whole file."""
        q = {"ids": ",".join(ids)}
        if depth:
            q["depth"] = depth
        return self._get(f"/v1/files/{key}/nodes?{urllib.parse.urlencode(q)}")

    def images(self, key, ids, fmt="svg", scale=1):
        """Returns short-lived URLs, not image bytes. Fetch them promptly."""
        q = {"ids": ",".join(ids), "format": fmt, "scale": scale}
        return self._get(f"/v1/images/{key}?{urllib.parse.urlencode(q)}")

    def versions(self, key):
        return self._get(f"/v1/files/{key}/versions")

    def comments(self, key):
        return self._get(f"/v1/files/{key}/comments")


if __name__ == "__main__":
    try:
        client = FigmaClient()
        me = client.me()
        print(json.dumps({"authenticated_as": me.get("handle"), "email": me.get("email")}, indent=2))

        if len(sys.argv) < 2:
            print("pass a Figma URL to read a node")
            sys.exit(0)

        ref = parse_figma_url(sys.argv[1])
        print(json.dumps(ref, indent=2))
        data = (
            client.nodes(ref["fileKey"], [ref["nodeId"]], depth=2)
            if ref["nodeId"]
            else client.file(ref["fileKey"], depth=1)
        )
        print(json.dumps(data, indent=2)[:1500])
    except Exception as exc:
        print(f"FAILED {exc}", file=sys.stderr)
        sys.exit(1)
