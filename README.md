# 9sig.networthcast.com

Interactive backtester for the 9Sig and SMA-timing strategies, run over long-history price series for TQQQ, QLD, SSO, SPXL, SQQQ, QQQ, and SPY, with buy-and-hold benchmarks alongside.

Live: https://tqqq.networthcast.com

## Updating price data

Ten TSV files under `data/` hold the price and rate series: seven ETF price files and three short-rate files. See [data/README.md](data/README.md) for the format, the synthesis method, and its known biases.

```bash
# One-time setup (creates a venv and installs yfinance)
python3 -m venv .venv
.venv/bin/pip install yfinance

# Default: incremental refresh of the seven price TSVs
.venv/bin/python3 update_data.py
```

The default run pulls `period="max"` with `auto_adjust=True`, so every series is dividend- and split-adjusted on the same basis and comparisons between them stay fair. It replaces the post-IPO tail of each price file and copies the committed pre-IPO synthesized prefix through untouched. It does not contact FRED, so the rate files are left alone.

Price files: `synthetic-qqq.tsv`, `synthetic-qld.tsv`, `synthetic-tqqq.tsv`, `spy.tsv`, `synthetic-sso.tsv`, `synthetic-spxl.tsv`, `synthetic-sqqq.tsv`.

Two flags cover the rest:

- `--refresh-rates` re-pulls DFF and TB3MS from FRED and rewrites `fed-funds-effective.tsv`, `t-bill-3mo.tsv`, and `short-rates.tsv`. Nothing else refreshes these, so they drift stale until you run it.
- `--rebuild` regenerates every price TSV from scratch through the backward-synthesis pipeline. It needs a local `^ndx_d.csv` (Stooq) at the repo root to reach pre-1985 Nasdaq history; that file is not committed, and without it the rebuild stops where Yahoo's `^NDX` stops. Run it when adding a ticker or changing the synthesis.

## Automated refresh

`.github/workflows/update-data.yml` runs `update_data.py` in its default incremental mode and commits changed TSVs back to `main`.

- **Schedule**: hourly on weekdays, `30 13-22 * * 1-5`. That's ten fires, and a gate step drops any that falls outside 09:00–17:30 ET, leaving nine runs per trading day.
- **DST**: GitHub cron is fixed UTC. 13:30–22:30 UTC covers 09:30–18:30 ET in summer and 08:30–17:30 ET in winter, so the gate trims one fire off whichever end the current offset pushes out. Either way the day runs 09:30 to 17:30 ET.
- **Manual trigger**: `workflow_dispatch` runs it on demand from the Actions tab and skips the clock gate.
- **No-op on holidays**: the commit step checks `git diff --quiet -- 'data/*.tsv'` and exits cleanly when nothing changed.
- **Overlapping runs**: a `concurrency` group with `cancel-in-progress: false` queues a delayed run instead of killing it, and the push step rebases first, since two runs writing `data/*.tsv` would otherwise race.
- **Rate limits**: yfinance throttles shared CI IPs, and nine runs a day each pull `period="max"` for seven tickers. The refresh step retries once after 120s so a transient 429 lands as a later refresh rather than a failed run.
- **Permissions**: the workflow uses the default `GITHUB_TOKEN` with `contents: write`. If org-level settings block workflow pushes, flip *Settings → Actions → General → Workflow permissions* to "Read and write".
