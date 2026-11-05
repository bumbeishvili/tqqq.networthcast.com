# Live-price proxy (Cloudflare Worker)

The site's price history is committed to git by the GitHub Action. This worker serves the part that should not be committed hourly: each fund's latest price and today's intraday bars, read from Yahoo's chart endpoint (which sends no CORS header, so the page cannot call it itself), cached for a minute at the edge.

## Routes

| route | answer |
| --- | --- |
| `GET /quotes` | `{ fetchedAt, quotes: { TQQQ: { price, prevClose, changePct, time, open, high, low, volume }, ... } }` for the ten funds in `SYMBOLS` |
| `GET /quotes?symbols=TQQQ,SOXL` | the same for a subset |
| `GET /bars/TQQQ?range=1d&interval=1m` | `{ symbol, range, interval, timezone, bars: [{ t, o, h, l, c, v }] }`; `range` 1d with 1m or 5m bars, 5d with 5m |
| `GET /bars/TQQQ?range=1d&interval=1m&format=tsv` | the same bars in the layout of `data/intraday/tqqq-today-1m.tsv` (`Date Open High Low Close Volume`, the bar's open time in New York as `M/D/YYYY HH:MM:SS`, regular session 09:30-15:59 only, four decimals, integer volume): today's session for the intraday page, at most a minute old. Outside market days it is the last session, as the committed file is. |

The intraday page (`experiments/tqqq-intraday.html`) reads today's session from this TSV route once its `QUOTES_PROXY` constant holds the deployed URL; until then it reads the committed file the hourly pipeline writes.

`prevClose` is Yahoo's prior close on Yahoo's current adjustment basis. A page overlaying `price` on the committed files should compare `prevClose` with its own last close first: a gap of more than a few percent means the files are on another basis (a split, as SOXX on 2026-11-05) and the overlay has to wait for the refreshed files. When Yahoo reports a split in the requested range the quote carries `splitToday`.

## Who may call it

Pages on `https://tqqq.networthcast.com`, and pages served from `localhost` or `127.0.0.1` on any port. Any other `Origin`, and a request without one, gets `403` and no CORS header, so no other site's page can read or trigger it. The `Origin` header is a browser promise, so a script can send any value: this is a gate for web pages, not authentication. The upstream load is bounded by the cache (one Yahoo call per symbol per minute per edge location) and by the symbol allowlist. Edit `ORIGINS` and `SYMBOLS` at the top of `src/worker.mjs` to change either.

## Deploy

Automatic: a push to `main` that touches `cloudflare/quotes/**` runs `.github/workflows/deploy-quotes-proxy.yml`, which checks the handler in Node (offline, no Yahoo calls) and deploys with Cloudflare's wrangler action. The hourly data commits never touch this folder, so they never trigger it. The workflow needs two repository secrets (GitHub: Settings → Secrets and variables → Actions):

| secret | where it comes from |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Cloudflare dashboard → My Profile → API Tokens → Create Token → the "Edit Cloudflare Workers" template |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare dashboard → Workers & Pages → the Account ID in the right-hand column |

The first deploy prints the `https://tqqq-quotes.<account>.workers.dev` URL in the workflow log; it stays the same afterwards. "Run workflow" on the Actions page deploys without a push.

By hand, once logged in:

```
cd cloudflare/quotes
npx wrangler login        # once, opens the browser
npx wrangler deploy       # prints https://tqqq-quotes.<account>.workers.dev
```

Free plan: 100,000 requests a day, which at one call a minute per open tab is about 70 tabs open all day. For a hostname on the networthcast.com zone, see the `routes` line in `wrangler.toml`.

## Test

Without an account, the handler runs in Node against the real Yahoo endpoint:

```
node cloudflare/quotes/test.mjs
```

With wrangler, the worker runs in the real runtime locally:

```
npx wrangler dev --port 8787
curl -H "Origin: http://127.0.0.1:5500" "http://127.0.0.1:8787/quotes?symbols=TQQQ"
curl -i -H "Origin: https://elsewhere.example" "http://127.0.0.1:8787/quotes"   # 403
```

A deployed worker answers the same `curl` lines on its workers.dev URL. The address bar sends no `Origin`, so it shows the 403 by design.
