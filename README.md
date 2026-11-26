# tqqq.networthcast.com

Backtesting platform for TQQQ. Strategies run over a reconstructed daily price history that starts in 1953, on TQQQ and ten related funds (QQQ, QLD, SQQQ, SPY, SSO, SPXL, GLD, SOXL, SOXX, SOXS): SMA timing, 9Sig, a library of 48 published and community rules, and custom strategies written in JavaScript, with buy & hold and a cash baseline drawn alongside. A real transaction history can be uploaded to put your own portfolio on the same chart, a separate page follows TQQQ's intraday path session by session, and a desktop widget shows both.

Live: https://tqqq.networthcast.com

## What it looks like

![The main chart: a library strategy against buy & hold TQQQ and the contributions alone](images/readme-chart.png)

$10K plus $500 a month from 2010: TQQQ vs QQQ + Turnaround Monday from the library, buy & hold TQQQ, and the contributions on their own. Log scale; entry and exit sit on the slider under the chart.

### Strategy library

![The strategy library](images/readme-library.png)

48 strategies: published rules, community favourites and a few of the site's own. Each card has its rules, a sparkline against SPY, and CAGR and max drawdown by era. Try puts one on the chart.

### Settings as sentences, Fit, signal charts

![A strategy's panel docked beside the chart](images/readme-strategy-panel.png)

A library strategy's settings read as sentences. Every dropdown shows what each value would have made, and Fit searches them. Its window is sentences too: what to freeze, the years to fit on (2010 to 2025 unless changed; the first choice of each end follows the chart's Entry or Exit), the highest CAGR or the lowest drawdown with the limit the other one has to keep, whether the result must be a plateau, round or any numbers, the fewest or any settings. Beside them a card shows the Map as it stands. The Map draws every combination of settings that has been run as a dot, max drawdown across and CAGR up, with dashed lines through the settings as they are. Its head has the same two year dropdowns as the Fit window, the same choice: changing them runs the map again on those years. In both Freeze lists a frozen setting's value is a plain dropdown of its choices: a pick sets it on the strategy and the map runs again on it. It fills itself from the moment it opens: every setting at each of its values, the search the window is set to (its result marked Fit), then new combinations bred from the best found, until 60 rounds in a row find nothing better. A dot is larger the better its result holds with one setting 10% off. A yellow point marks buy and hold TQQQ over the same years with the same money. A clicked dot shows the whole strategy beside the chart, each changed value struck through next to the new one, and Use sets it. CSV downloads every dot with its settings. Fit and Map share their runs, so each makes the other quicker.

A strategy's card in the sidebar shows its CAGR and max drawdown on one line. On a day the strategy trades, a second line says where the money goes at that day's close (TQQQ → SQQQ); the icon beside it gives the reason.

![The signal chart inside the panel](images/readme-signal-chart.png)

The signal chart draws the rules' lines on the price, the lead over QQQ with its ceiling, floor and deep-buy levels, and the credit-stress index with its veto. Each trade is marked where its rule fired, and today's readings sit on the right.

### Analytics grid

![The analytics grid](images/readme-analytics.png)

Every start year and holding period at once, coloured against a baseline (here compounded cash).

### Intraday page

![TQQQ intraday paths](images/readme-intraday.png)

[experiments/tqqq-intraday.html](experiments/tqqq-intraday.html): every session's 5-minute path over ten years (as far back as the data refresh has pulled; Alpaca's history starts in January 2016), for TQQQ or another of the eleven funds (a dropdown, or `?ticker=SOXL` in the address), the mean and median path, bars by weekday and by day for one of the day's prices against another (a dropdown with all ten pairs of the previous close, open, low, high and close; close vs prev close unless changed), and filters behind one button: one month of the year, one weekday (both together keep, say, the Fridays of every November), the trend at the close before the day (that close against the mean or median of the last N closes, or the RSI over N days, more or less than a value; several rules must all hold), the day's open and close, and the period. The days kept are drawn bold on the price line under the daily bars. Hover for the path nearest the pointer; drag across the plot for the move over that span on today's path, the mean, the median and the nearest day.

### Desktop widget

![The widget page](images/readme-widget.png)

[widget.html](widget.html), framed by an Übersicht widget: today's intraday path and a strategy's signal chart. A private `config.json` adds your own portfolio. See [widget/README.md](widget/README.md).

## Repository layout

| Path | What it is |
|---|---|
| `index.html`, `js/`, `styles.css` | The site. GitHub Pages serves the root of `main`, so `CNAME` and `.nojekyll` stay there. |
| `data/` | Price, rate and intraday series, refreshed by the workflow. Format, synthesis and known biases: [data/README.md](data/README.md). |
| `experiments/` | The intraday page and the 9sig and SMA overfit explorers, linked from the site. |
| `widget.html`, `widget/` | The widget page and its installer. |
| `manifest.webmanifest`, `sw.js`, `js/app-install.js` | The site as an installable app that opens offline: its manifest, its offline copy and the menu entry. `sw.js` stays at the root, which is the part of the site it can serve. Icons: `scripts/build-app-icons.cjs`. |
| `scripts/` | The data updaters the workflow runs. |
| `tests/` | Node checks: library parity, withdrawals, daily display. |
| `research/` | Notes and scripts behind the library. |
| `old/v1/` | The frozen first version. Old share links redirect there. |

## Updating price data

The series under `data/` are TSV files: eleven price files, their daily highs and lows, three short-rate files, NFCI, and each fund's intraday bars. See [data/README.md](data/README.md) for the format, the synthesis method, and its known biases.

```bash
# One-time setup (creates a venv and installs yfinance)
python3 -m venv .venv
.venv/bin/pip install yfinance

# Default: incremental refresh of the price TSVs
.venv/bin/python3 scripts/update_data.py
```

The default run pulls `period="max"` with `auto_adjust=True`, so every series is dividend- and split-adjusted on the same basis and comparisons between them stay fair. It replaces the post-IPO tail of each price file and copies the committed pre-IPO synthesized prefix through untouched. It does not contact FRED, so the rate files are left alone.

Price files: `synthetic-qqq.tsv`, `synthetic-qld.tsv`, `synthetic-tqqq.tsv`, `spy.tsv`, `synthetic-sso.tsv`, `synthetic-spxl.tsv`, `synthetic-sqqq.tsv`, `synthetic-gld.tsv`, `synthetic-soxl.tsv`, `synthetic-soxx.tsv`, `synthetic-soxs.tsv`.

High/low files, written on the same runs from the same bars: `tqqq-hl.tsv`, `qqq-hl.tsv`, `spy-hl.tsv` (date, high, low and that bar's close; real trading days only). The Turnaround Monday strategies read them.

Flags cover the rest:

- `--refresh-rates` re-pulls DFF and TB3MS from FRED and rewrites `fed-funds-effective.tsv`, `t-bill-3mo.tsv`, and `short-rates.tsv`. Nothing else refreshes these, so they drift stale until you run it.
- `--rebuild` regenerates every price TSV from scratch through the backward-synthesis pipeline. It needs a local `^ndx_d.csv` (Stooq) at the repo root to reach pre-1985 Nasdaq history; that file is not committed, and without it the rebuild stops where Yahoo's `^NDX` stops. Run it when adding a ticker or changing the synthesis.
- `--high-low-history`, `--gold-history`, `--soxl-history`, `--soxx-history` and `--soxs-history` rebuild the pre-launch rows of the high/low files, of `synthetic-gld.tsv`, `synthetic-soxl.tsv`, `synthetic-soxx.tsv` and `synthetic-soxs.tsv`. [data/README.md](data/README.md) has the details.

## Automated refresh

`.github/workflows/update-data.yml` runs `scripts/update_data.py` in its default incremental mode, then `scripts/update_intraday.py --incremental` (Alpaca 5-minute bars, one file a fund) and `scripts/update_intraday_today.py` (today's 1-minute bars from Yahoo), and commits changed TSVs back to `main`.

- **Schedule**: hourly on weekdays, `30 13-22 * * 1-5`. That's ten fires, and a gate step drops any that falls outside 09:00–17:30 ET, leaving nine runs per trading day.
- **DST**: GitHub cron is fixed UTC. 13:30–22:30 UTC covers 09:30–18:30 ET in summer and 08:30–17:30 ET in winter, so the gate trims one fire off whichever end the current offset pushes out. Either way the day runs 09:30 to 17:30 ET.
- **Manual trigger**: `workflow_dispatch` runs it on demand from the Actions tab and skips the clock gate.
- **No-op on holidays**: the commit step checks `git diff --quiet -- 'data/*.tsv'` and exits cleanly when nothing changed.
- **Overlapping runs**: a `concurrency` group with `cancel-in-progress: false` queues a delayed run instead of killing it, and the push step rebases first, since two runs writing `data/*.tsv` would otherwise race.
- **Rate limits**: yfinance throttles shared CI IPs, and nine runs a day each pull `period="max"` for every price ticker. The refresh step retries once after 120s so a transient 429 lands as a later refresh rather than a failed run.
- **Permissions**: the workflow uses the default `GITHUB_TOKEN` with `contents: write`. If org-level settings block workflow pushes, flip *Settings → Actions → General → Workflow permissions* to "Read and write".
