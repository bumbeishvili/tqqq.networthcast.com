# Long-history TQQQ, QLD, QQQ, SPY, SSO, and SPXL price data (+ short-rate reference data)

This folder contains daily closing-price series for **TQQQ, QLD, QQQ, SPY, SSO, and SPXL** stretching back **decades before any of these ETFs actually existed**, along with the **historical short-term interest rate series** the synthesis methodology depends on. They power the [Strategies Simulator](https://9sig.networthcast.com), and they're published here so anyone can grab them and run their own backtests without reinventing the synthesis work.

## ETF launch dates

- **SPY** — January 1993
- **QQQ** — March 1999
- **SSO** (2× S&P 500, ProShares Ultra S&P500) — June 2006
- **QLD** (2× Nasdaq-100, ProShares Ultra QQQ) — June 2006
- **SPXL** (3× S&P 500, Direxion Daily S&P500 Bull 3x) — November 2008
- **TQQQ** (3× Nasdaq-100) — February 2010

Pre-launch history is reconstructed from longer-lived indexes (Nasdaq-100, S&P 500, PHLX Semiconductor), using the same daily formulas the ETFs themselves use (leverage, expense ratios, financing costs on the borrowed leg, swap-counterparty spreads), and stitched onto the real series at each ETF's launch day.

The result is a continuous "what it would have looked like" series for each fund. It's not what really happened — those investments didn't exist yet — but it's what *the math says* their daily prices would have done given the underlying index **and the prevailing short-term interest rates of each era**.

> **Shipped range: January 2, 1953 → present.** The underlying index reconstruction runs back to 1938, but the published TSVs are trimmed to start in **1953** — the point where daily data becomes clean (before 1953 the NYSE ran Saturday sessions, and the pre-1953 reconstruction is the roughest). Everything below describing 1938–1953 synthesis is how that early stretch *was* built; it's no longer included in the files.

## The files

| File | Real history starts | Synthesized portion |
| --- | --- | --- |
| **synthetic-qqq.tsv** | March 10, 1999 — when QQQ launched. From here on it's real, dividend-adjusted Yahoo Finance data. | Before 1999 the series is built from the Nasdaq-100 index (`^NDX`), minus QQQ's tiny expense ratio. No financing-cost adjustment (QQQ is not leveraged). |
| **synthetic-qld.tsv** | June 21, 2006 — when QLD (ProShares Ultra QQQ, 2×) launched. | Pre-2006 uses `(1 + 2 × NDX_daily − 1 × (short_rate + 0.50%)/yr − 0.95%/yr expense)`. 1999–2006 uses derived NDX-TR; 1938–1999 falls back to price-only `^NDX`. |
| **synthetic-tqqq.tsv** | February 11, 2010 — when TQQQ launched. | Pre-2010 uses a leveraged-ETF formula that **includes the financing cost and a swap-counterparty spread**: `(1 + 3 × NDX_daily − 2 × (short_rate + 0.65%)/yr − 0.88%/yr expense)`. For 1999–2010 the underlying is the derived NDX-TR series (real Nasdaq movement plus actual dividends); for 1938–1999 it falls back to price-only `^NDX` because dividend data isn't available that far back. |
| **spy.tsv** | January 29, 1993 — when SPY launched. | 1988–1993 uses the real S&P 500 Total Return index. 1985–1988 falls back to the plain S&P 500 (`^GSPC`) because total-return data isn't available that far back. No financing-cost adjustment (SPY is not leveraged). |
| **synthetic-sso.tsv** | June 21, 2006 — when SSO (ProShares Ultra S&P500, 2×) launched. | Pre-2006 uses `(1 + 2 × SP500_daily − 1 × (short_rate + 0.50%)/yr − 0.87%/yr expense)`. 1988–2006 uses real `^SP500TR`; 1985–1988 falls back to price-only `^GSPC` (S&P dividend gap ~1.8%/yr understated). |
| **synthetic-spxl.tsv** | November 5, 2008 — when SPXL (Direxion Daily S&P500 Bull 3x) launched. | Pre-2008 uses `(1 + 3 × SP500_daily − 2 × (short_rate + 0.50%)/yr − 0.95%/yr expense)`. 1988–2008 uses real `^SP500TR`; 1985–1988 falls back to price-only `^GSPC`. |
| **fed-funds-effective.tsv** | Daily, July 1, 1954 → present. | None — pulled from FRED series `DFF`. Used by the synthesis to compute the financing cost on the leveraged leg from 1954 onward. |
| **t-bill-3mo.tsv** | Monthly, January 1934 → present. | None — pulled from FRED series `TB3MS`. Used as the pre-Fed-Funds-market (1934–1953) short-rate proxy. |
| **short-rates.tsv** | Daily, January 2, 1934 → present. | Derived: DFF where it exists, TB3MS forward-filled where DFF doesn't reach. This is the single file the synthesis script reads. |

A local `^ndx_d.csv` (sourced from Stooq) extends Nasdaq-100 history back to **January 1938**. The actual Nasdaq-100 index didn't exist before 1985, so values before then are themselves a back-reconstruction by the data provider — treat pre-1985 synthetic QQQ/TQQQ as "rough hypothetical" rather than gospel.

## The financing-cost correction

A leveraged ETF holding $1 of investor NAV produces $3 of NDX exposure by **borrowing** the extra $2 of synthetic exposure from a bank via total-return swap. The bank charges interest on that $2 every day. Meanwhile the fund's $1 of cash collateral earns roughly the same short-term rate. Net daily drag:

```
financing_drag_daily ≈ (L − 1) × short_rate_daily
                     = 2 × short_rate_daily   (for L=3, i.e. TQQQ)
```

**This drag is invisible in ProShares' published expense ratio** (0.88 %/year — the management fee) but is the dominant cost component in any non-zero interest-rate environment. Empirically verified against 2010-present TQQQ data:

- Regression of (naive synthesis − real TQQQ) on Fed Funds rate over 17 years → **slope 1.998** (theory predicts exactly 2.0), **R² 0.97**.
- In 2023 with Fed Funds at 5 %: real TQQQ underperformed a "no-financing-cost" synthesis by **11.3 percentage points** — matching `2 × 5 % = 10 %` predicted drag almost perfectly.
- In 2010–2015 with Fed Funds near 0 %: drag was only ~1.3 %/year (the irreducible operational residual).

Pre-2010 backtests done without this correction are **wildly optimistic** in any high-rate era. The 1970s and early 80s (Fed Funds 7–19 %) would have eaten **15–35 percentage points/year** of TQQQ's returns to financing alone.

## Swap-counterparty spread

The financing-cost model says the leveraged ETF pays **Fed Funds × (L−1)** on its borrowed leg. Reality is dirtier: the swap counterparty doesn't lend at Fed Funds — they lend at **Fed Funds + a spread** that covers their risk premium and desk margin. This spread is:

- Small for mature, deep-liquidity products (QLD, SSO, TQQQ, SPXL)

Each product's spread is **calibrated empirically** by regressing the naive (no-spread) synthesis against real ETF data and finding the spread that closes the residual gap to ≈ 0 over the full window:

| ETF | Leverage | TER (mgmt fee) | Calibrated spread | Window used | Full-window residual |
|---|---|---|---|---|---|
| **QLD**  | 2× (NDX) | 0.95 % | **0.50 %/yr** | 2006–present (uncalibrated estimate) | not yet regressed |
| **SSO**  | 2× (SPX) | 0.87 % | **0.50 %/yr** | 2006–present (uncalibrated estimate) | not yet regressed |
| **TQQQ** | 3× (NDX) | 0.88 % | **0.65 %/yr** | 2010–present (15+yr) | ~1.3 pp/yr → ≈ 0 with spread |
| **SPXL** | 3× (SPX) | 0.95 % | **0.50 %/yr** | 2008–present (uncalibrated estimate) | not yet regressed |

## How accurate is the synthesized portion?

After applying the financing-cost correction, the remaining known biases are:

1. **Missing dividends pre-1999.** For pre-1999 QQQ and TQQQ we have only `^NDX` (price-only) — Yahoo lists `^XNDX` (NDX Total Return) but serves no history for it; NASDAQ.com's API, NASDAQ Data Link, Stooq, Tiingo, EODHD, and Alpha Vantage all gate it. Pre-1999 synth QQQ understates by ~0.7 %/year; pre-1999 synth TQQQ understates by ~2 %/year (= 3 × dividend yield).

2. **Swap-counterparty spread** (modeled, calibrated above): QLD 0.50 %/yr, SSO 0.50 %/yr, TQQQ 0.65 %/yr, SPXL 0.50 %/yr added to the financing rate for the borrowed leg. Closes most of what was previously the "~1.3 %/year unmodeled operational residual" for TQQQ.

3. **Residual operational drag** (still not modeled): NAV-vs-market price deviations and daily-rebalancing slippage. For 3× products this is ~0.3–0.5 %/yr.

3. **1985–1987 SPY uses price-only S&P 500** because `^SP500TR`'s Yahoo history starts 1988-01-04. Measured TR premium over the overlap is +3.86 pp/year, so ~9 % cumulative understatement for that 2.3-year window.

Net direction of bias on TQQQ pre-2010 (vs what real TQQQ would have done if it existed):
- **Low-rate eras** (1938–45, mid-1950s): synthetic ≈ flat to slightly low (dividend gap > tiny operational drag).
- **Moderate-rate eras** (most history): synthetic ≈ slightly high by 1–3 pp/year.
- **High-rate eras** (1970s–80s): synthetic ≈ high by 2–3 pp/year operational, but rate effect is now corrected, so net is much smaller than the previous uncorrected synthesis.

For everything **from 2010 (TQQQ), 1999 (QQQ), and 1988 (SPY) onward** the price data is real and dividend-adjusted, so backtests over the last 15–25 years are unaffected by any synthesis biases.

## How to use the data

### Direct download

You can grab any of the files straight from GitHub at the URLs below. They're refreshed automatically every weekday with the latest closing prices and the latest Fed Funds rate, and there's no rate-limiting on these endpoints — it's safe to point an app or script directly at them and have your data stay current.

| File | URL |
| --- | --- |
| QQQ  | [https://raw.githubusercontent.com/bumbeishvili/9sig.networthcast.com/refs/heads/main/data/synthetic-qqq.tsv](https://raw.githubusercontent.com/bumbeishvili/9sig.networthcast.com/refs/heads/main/data/synthetic-qqq.tsv) |
| QLD  | [https://raw.githubusercontent.com/bumbeishvili/9sig.networthcast.com/refs/heads/main/data/synthetic-qld.tsv](https://raw.githubusercontent.com/bumbeishvili/9sig.networthcast.com/refs/heads/main/data/synthetic-qld.tsv) |
| TQQQ | [https://raw.githubusercontent.com/bumbeishvili/9sig.networthcast.com/refs/heads/main/data/synthetic-tqqq.tsv](https://raw.githubusercontent.com/bumbeishvili/9sig.networthcast.com/refs/heads/main/data/synthetic-tqqq.tsv) |
| SPY  | [https://raw.githubusercontent.com/bumbeishvili/9sig.networthcast.com/refs/heads/main/data/spy.tsv](https://raw.githubusercontent.com/bumbeishvili/9sig.networthcast.com/refs/heads/main/data/spy.tsv) |
| SSO  | [https://raw.githubusercontent.com/bumbeishvili/9sig.networthcast.com/refs/heads/main/data/synthetic-sso.tsv](https://raw.githubusercontent.com/bumbeishvili/9sig.networthcast.com/refs/heads/main/data/synthetic-sso.tsv) |
| SPXL | [https://raw.githubusercontent.com/bumbeishvili/9sig.networthcast.com/refs/heads/main/data/synthetic-spxl.tsv](https://raw.githubusercontent.com/bumbeishvili/9sig.networthcast.com/refs/heads/main/data/synthetic-spxl.tsv) |
| Fed Funds Effective Rate (daily, 1954+) | [https://raw.githubusercontent.com/bumbeishvili/9sig.networthcast.com/refs/heads/main/data/fed-funds-effective.tsv](https://raw.githubusercontent.com/bumbeishvili/9sig.networthcast.com/refs/heads/main/data/fed-funds-effective.tsv) |
| 3-month T-bill (monthly, 1934+) | [https://raw.githubusercontent.com/bumbeishvili/9sig.networthcast.com/refs/heads/main/data/t-bill-3mo.tsv](https://raw.githubusercontent.com/bumbeishvili/9sig.networthcast.com/refs/heads/main/data/t-bill-3mo.tsv) |
| Combined daily short rates (1934+) | [https://raw.githubusercontent.com/bumbeishvili/9sig.networthcast.com/refs/heads/main/data/short-rates.tsv](https://raw.githubusercontent.com/bumbeishvili/9sig.networthcast.com/refs/heads/main/data/short-rates.tsv) |

### File format

Every file is a plain tab-separated table:

```
Date	Close              ← price files (Close column)
1/2/2025 16:00:00	38.93
1/3/2025 16:00:00	40.79
...

Date	Rate               ← rate files (Rate column, value in % per year)
7/1/1954 16:00:00	1.1300
7/2/1954 16:00:00	1.2500
...
```

- One row per trading day (or per month for `t-bill-3mo.tsv`).
- The date column always says `16:00:00` — that's the New York 4 PM close.
- Price closes are in **US dollars**. Rate values are **annual percentages**.
- Dates use `M/D/YYYY` formatting.

Every spreadsheet, Python script, R notebook, etc. can read this with default settings (just tell it the delimiter is a tab).

## Daily auto-refresh

A scheduled GitHub Action runs every weekday at 15:30 UTC (about two hours after the US market opens), regenerates all six files from the latest Yahoo Finance and FRED data, and pushes them back to the repository. Whatever you fetch from the URLs above is always the latest version — no caching layer to wait on.

If you find a bug in the synthesis logic or have a suggestion, open an issue or send a PR against the script that generates the files (`update_data.py` at the repo root).

## A note on synthetic backtesting

These synthetic series are reconstructions, not history. They're as good as we can do given that QQQ and TQQQ simply weren't around through most market cycles people care about — but they should be read in that spirit. If a strategy backtest looks great in 1973 or 2000, that's a *what-if*, not a track record. Treat them accordingly.

The financing-cost correction (added 2026-05) closes the single biggest source of error in the previous synthesis, but a ~1.3 %/year operational residual remains unmodeled. **Absolute CAGRs from pre-2010 backtests are still approximate by ~1–2 percentage points**; relative comparisons between strategies (which all touch the same underlying) remain reliable.
