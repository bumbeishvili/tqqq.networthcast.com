# Long-history price data for TQQQ, QLD, QQQ, SPY, SSO, SPXL, and SQQQ

Daily closing prices for seven ETFs, going back decades before any of them existed, plus the short-term interest rate series the reconstruction runs on. These files feed the [Strategies Simulator](https://9sig.networthcast.com). They're published here so you can run your own backtests without redoing the synthesis.

## ETF launch dates

- **SPY** — January 1993
- **QQQ** — March 1999
- **SSO** (2× S&P 500, ProShares Ultra S&P500) — June 2006
- **QLD** (2× Nasdaq-100, ProShares Ultra QQQ) — June 2006
- **SPXL** (3× S&P 500, Direxion Daily S&P500 Bull 3x) — November 2008
- **TQQQ** (3× Nasdaq-100) — February 2010
- **SQQQ** (−3× Nasdaq-100, ProShares UltraPro Short QQQ) — February 2010

Everything before a fund's launch date is reconstructed. The script walks the longer-lived index backward from launch day, applying the same daily arithmetic the fund itself runs on: leverage, expense ratio, financing cost on the borrowed leg, swap-counterparty spread. What comes out is a continuous "what it would have looked like" series. None of it happened, because the funds didn't exist. It is what the math says their daily prices would have done given the underlying index and the short-term rates of each era.

> **The price files start January 2, 1953.** The rate files go back further; `short-rates.tsv` starts in 1934. 1953 is where daily data gets clean, since the NYSE ran Saturday sessions before then. That start date lives in the committed TSVs themselves. `update_data.py` has no trimming step, and its daily refresh copies whatever pre-IPO prefix is already on disk.

## "How do you approximate TQQQ before it existed?"

The most-asked question about this dataset. The copy-paste answer:

> **Short version: the real Nasdaq-100 history with TQQQ's actual daily costs applied.** TQQQ delivers 3× the index's *daily* move. For each day before the fund existed, take that day's index return, multiply by 3, and subtract the running costs: the 0.88%/yr management fee, plus interest on the borrowed 2× at that day's real short-term rate + 0.65% swap spread. The interest is the larger cost. At 1980s rates it ran 15–35 percentage points a year, and that drag is what a plain "3× the index" backtest misses.
>
> Underlying data, era by era:
>
> - **2010 → now:** real TQQQ prices (Yahoo Finance). No reconstruction.
> - **1999–2010:** real Nasdaq-100 including dividends. Checked within 0.2%/yr against Nasdaq's official total-return index (XNDX, on FRED).
> - **1985–1999:** real Nasdaq-100, price-only (Yahoo `^NDX`). Dividends are missing, so a 3× fund runs about 2%/yr light.
> - **1971–1985:** the Nasdaq-100 didn't exist yet. This stretch comes from Stooq's back-extension, which matches the real Nasdaq Composite (FRED) within 0.01%/yr over the full 14 years, so it is the measured Composite carrying an NDX label.
> - **1953–1971:** no Nasdaq index of any kind existed. This part is Stooq's own construction, undocumented, with nothing real to check it against. Treat it as a hypothetical.
> - **Interest rates for the financing cost:** Fed Funds daily from 1954, 3-month T-bills back to 1934 (both FRED).
>
> Sanity check: the same formula run from 2010 onward tracks the real fund. That overlap is what calibrated the 0.65% swap spread.

## The files

| File | Real history starts | Synthesized portion |
| --- | --- | --- |
| **synthetic-qqq.tsv** | March 10, 1999, when QQQ launched. Real dividend-adjusted Yahoo Finance data from there on. | Before 1999, built from the Nasdaq-100 index (`^NDX`) minus QQQ's 0.20 %/yr expense ratio. No financing cost; QQQ is not leveraged. |
| **synthetic-qld.tsv** | June 21, 2006, when QLD (ProShares Ultra QQQ, 2×) launched. | Pre-2006: `(1 + 2 × NDX_daily − 1 × (short_rate + 0.50%)/yr − 0.95%/yr expense)`. 1999–2006 uses derived NDX-TR; before 1999 it falls back to price-only `^NDX`. |
| **synthetic-tqqq.tsv** | February 11, 2010, when TQQQ launched. | Pre-2010: `(1 + 3 × NDX_daily − 2 × (short_rate + 0.65%)/yr − 0.88%/yr expense)`. For 1999–2010 the underlying is derived NDX-TR (real Nasdaq movement plus actual dividends). Before 1999 it falls back to price-only `^NDX`, since dividend data doesn't reach that far. |
| **spy.tsv** | January 29, 1993, when SPY launched. | 1988–1993 uses the real S&P 500 Total Return index (`^SP500TR`). Before 1988 it falls back to plain `^GSPC`, since `^SP500TR`'s Yahoo history starts 1988-01-04. No financing cost; SPY is not leveraged. |
| **synthetic-sso.tsv** | June 21, 2006, when SSO (ProShares Ultra S&P500, 2×) launched. | Pre-2006: `(1 + 2 × SP500_daily − 1 × (short_rate + 0.50%)/yr − 0.87%/yr expense)`. 1988–2006 uses real `^SP500TR`, earlier years price-only `^GSPC`. |
| **synthetic-spxl.tsv** | November 5, 2008, when SPXL (Direxion Daily S&P500 Bull 3x) launched. | Pre-2008: `(1 + 3 × SP500_daily − 2 × (short_rate + 0.50%)/yr − 0.95%/yr expense)`. 1988–2008 uses real `^SP500TR`, earlier years price-only `^GSPC`. |
| **synthetic-sqqq.tsv** | February 11, 2010, when SQQQ launched. | Pre-2010 uses the inverse model `(1 − 3 × NDX_daily + 4.028 × short_rate/yr − 1.537 %/yr)`. An inverse fund borrows nothing. It is short 3 units and sits on (1+L)=4 units of cash *earning* the short rate. Both coefficients are fitted against real SQQQ 2010–2026: the rate slope came out 4.028 against a theoretical 4.0, and the −1.537 %/yr intercept covers the 0.95 % fee plus swap spread and slippage. Replayed forward from launch, the model tracks the real fund to within −6.4 % / +1.9 % cumulative over 16.5 years. |
| **fed-funds-effective.tsv** | Daily, July 1, 1954 onward. | None. FRED series `DFF`. Supplies the financing cost on the leveraged leg from 1954. |
| **t-bill-3mo.tsv** | Monthly, January 1934 onward. | None. FRED series `TB3MS`. The pre-Fed-Funds-market short-rate proxy for 1934–1953. |
| **short-rates.tsv** | Daily, January 2, 1934 onward. | Derived: `DFF` where it exists, `TB3MS` forward-filled where it doesn't. The only rate file the synthesis reads. |

Yahoo's `^NDX` history starts in 1985, which is also when the Nasdaq-100 index itself began. `update_data.py` reaches further back by merging a local `^ndx_d.csv` from Stooq, and **that file is not committed to this repo**. Without it, `read_ndx_csv()` returns nothing and a from-scratch `--rebuild` stops where Yahoo stops. The 1953-onward history in the committed TSVs was generated while the CSV was present.

The pre-1985 prefix splits into two very different stretches. **1971–1985 is real data in disguise**: checked against the actual Nasdaq Composite (FRED series `NASDAQCOM`, daily from the index's first day in February 1971), the Stooq reconstruction tracks it to within 0.01 pp/yr CAGR over the full 14 years and never diverges more than 0.3% over any rolling year — it is effectively the measured Composite wearing an NDX label. **Before 1971 no Nasdaq index of any kind existed** (the market traded OTC), so the 1953–1971 stretch is Stooq's own undocumented construction with nothing real to check it against. Read that stretch, and only that stretch, as a rough hypothetical.

## The financing-cost correction

A 3× ETF holding $1 of investor NAV produces $3 of index exposure. It borrows the other $2 from a bank through a total-return swap and pays interest on that $2 every day. Its own $1 of collateral earns roughly the same short rate, so the two partly cancel:

```
financing_drag_daily ≈ (L − 1) × short_rate_daily
                     = 2 × short_rate_daily   (for L=3, i.e. TQQQ)
```

None of this appears in the published expense ratio. ProShares lists 0.88 %/year for TQQQ, which is the management fee on its own. At any non-zero short rate the financing term is the larger of the two. Measured against real TQQQ from 2010 on:

- Regressing (naive synthesis − real TQQQ) on the Fed Funds rate over 16 years gives slope **1.998** and R² **0.97**. Theory predicts exactly 2.0.
- 2023, Fed Funds at 5 %: real TQQQ came in **11.3 percentage points** below a synthesis with no financing term, against a predicted 2 × 5 % = 10 %.
- 2010–2015, Fed Funds near zero: drag of about 1.3 %/year.

Skip the correction and a pre-2010 backtest runs optimistic wherever rates were high. Fed Funds sat between 7 % and 19 % through the 1970s and early 80s, which costs TQQQ 15–35 percentage points a year to financing alone.

## Swap-counterparty spread

The model above has the fund paying Fed Funds × (L−1). No counterparty actually lends at Fed Funds. They lend at Fed Funds plus a spread covering their risk premium and desk margin.

TQQQ's spread is calibrated: regress the no-spread synthesis against the real fund, then take the spread that closes the residual to about zero over the full window. The other three are that result carried across by leverage tier, and have never been regressed against their own funds.

| ETF | Leverage | TER (mgmt fee) | Spread used | Basis |
|---|---|---|---|---|
| **QLD**  | 2× (NDX) | 0.95 % | 0.50 %/yr | estimate; standard ProShares 2× tier, not regressed |
| **SSO**  | 2× (SPX) | 0.87 % | 0.50 %/yr | estimate; mirrors QLD's 2× spread, not regressed |
| **TQQQ** | 3× (NDX) | 0.88 % | 0.65 %/yr | calibrated on 2010–present: the 1.3 pp/yr residual ÷ (L−1) = 2 |
| **SPXL** | 3× (SPX) | 0.95 % | 0.50 %/yr | estimate; S&P 3× swaps assumed tighter than NDX, not regressed |

## How accurate is the synthesized portion?

Four biases survive the financing-cost correction.

**1. Nasdaq dividends before 1999.** For pre-1999 QQQ, QLD, TQQQ, and SQQQ there is only `^NDX`, which is price-only. The official NDX Total Return index (`^XNDX`) only begins March 4, 1999 — **FRED serves its full daily history free** (series [`NASDAQXNDX`](https://fred.stlouisfed.org/data/NASDAQXNDX); Yahoo lists the symbol but returns no history, and NASDAQ.com's API, NASDAQ Data Link, Stooq, Tiingo, EODHD, and Alpha Vantage all gate it) — so no total-return series reaches before 1999 outside institutional data like CRSP. Dividends contributed 0.690 pp/year to QQQ from its 1999 launch to today, so pre-1999 synthetic QQQ runs about 0.7 %/year light and synthetic TQQQ about 2 %/year (3 × that).

**2. S&P dividends before 1988.** SPY, SSO, and SPXL run on price-only `^GSPC` from the files' 1953 start to 1988-01-04. How big that gap is depends on the window you measure `^SP500TR` against `^GSPC` over, because the S&P dividend yield has fallen steadily:

| Window | TR premium |
|---|--:|
| 1988–1990 | 3.97 pp/yr |
| 1988–1993 | 3.70 pp/yr |
| 1988–2000 | 2.92 pp/yr |
| 2000–2010 | 1.82 pp/yr |
| 1988–2026 (full overlap) | 2.30 pp/yr |

The years next to the missing stretch are the ones that apply, and pre-1988 yields were higher still, so **3.7–4.0 pp/year** is the correction for 1953–1988. The full-overlap 2.30 is a floor. Leveraged series run light by L × that. Thirty-five years of every S&P-based series sit under this one, which makes it the largest bias in the dataset by span.

**3. Swap-counterparty spread.** Modeled and applied per the table above. TQQQ's 0.65 %/yr was fitted to absorb the whole measured 1.3 pp/yr residual, so nothing measurable is left over there. QLD, SSO, and SPXL use unregressed estimates. Their residual is unmeasured rather than zero.

**4. Operational drag the spread doesn't capture.** NAV-versus-market price deviation and daily-rebalancing slippage. TQQQ's calibrated spread already swallows whatever this came to over 2010–2026. For the other three it sits inside the gap their estimated spreads fail to close, and nobody has measured that gap.

Net direction on TQQQ before 2010, against what real TQQQ would have done had it existed:

- **Low-rate eras** (mid-1950s): flat to slightly light. The dividend gap outweighs the small operational drag.
- **Moderate-rate eras** (most of the history): 1–3 pp/year high.
- **High-rate eras** (1970s–80s): the rate effect is corrected now, leaving the operational component at 2–3 pp/year high.

From 2010 (TQQQ, SQQQ), 2008 (SPXL), 2006 (QLD, SSO), 1999 (QQQ), and 1993 (SPY) onward the prices are real and dividend-adjusted. Backtests confined to the last 15–30 years carry no synthesis bias at all.

### Checked against official sources (August 2026)

Three independent audits against series this dataset does not use:

- **QQQ vs the official NDX Total Return index** (FRED `NASDAQXNDX`), March 1999 – August 2026: our QQQ series lags XNDX by **−0.208 %/yr** over 27.4 years — QQQ's 0.20 % expense ratio, to within a basis point. The dividend adjustment is verified.
- **synthetic-tqqq 1999–2010 vs an official-XNDX rebuild**: re-running the documented formula on FRED's official total-return index instead of the derived NDX-TR lands within **0.16 %/yr**, worst cumulative divergence 2.3 % across the decade.
- **The pre-1985 prefix vs the real Nasdaq Composite** (FRED `NASDAQCOM`), 1971–1985: CAGR gap **0.01 pp/yr**, no rolling 1-year window diverging more than 0.3 % (details in the section above).

None of these moved anything, which is the point: where the synthesis can be checked against an official series, it matches.

## How to use the data

### Direct download

Fetch any file straight from GitHub:

| File | URL |
| --- | --- |
| QQQ  | [https://raw.githubusercontent.com/bumbeishvili/9sig.networthcast.com/refs/heads/main/data/synthetic-qqq.tsv](https://raw.githubusercontent.com/bumbeishvili/9sig.networthcast.com/refs/heads/main/data/synthetic-qqq.tsv) |
| QLD  | [https://raw.githubusercontent.com/bumbeishvili/9sig.networthcast.com/refs/heads/main/data/synthetic-qld.tsv](https://raw.githubusercontent.com/bumbeishvili/9sig.networthcast.com/refs/heads/main/data/synthetic-qld.tsv) |
| TQQQ | [https://raw.githubusercontent.com/bumbeishvili/9sig.networthcast.com/refs/heads/main/data/synthetic-tqqq.tsv](https://raw.githubusercontent.com/bumbeishvili/9sig.networthcast.com/refs/heads/main/data/synthetic-tqqq.tsv) |
| SPY  | [https://raw.githubusercontent.com/bumbeishvili/9sig.networthcast.com/refs/heads/main/data/spy.tsv](https://raw.githubusercontent.com/bumbeishvili/9sig.networthcast.com/refs/heads/main/data/spy.tsv) |
| SSO  | [https://raw.githubusercontent.com/bumbeishvili/9sig.networthcast.com/refs/heads/main/data/synthetic-sso.tsv](https://raw.githubusercontent.com/bumbeishvili/9sig.networthcast.com/refs/heads/main/data/synthetic-sso.tsv) |
| SPXL | [https://raw.githubusercontent.com/bumbeishvili/9sig.networthcast.com/refs/heads/main/data/synthetic-spxl.tsv](https://raw.githubusercontent.com/bumbeishvili/9sig.networthcast.com/refs/heads/main/data/synthetic-spxl.tsv) |
| SQQQ | [https://raw.githubusercontent.com/bumbeishvili/9sig.networthcast.com/refs/heads/main/data/synthetic-sqqq.tsv](https://raw.githubusercontent.com/bumbeishvili/9sig.networthcast.com/refs/heads/main/data/synthetic-sqqq.tsv) |
| Fed Funds Effective Rate (daily, 1954+) | [https://raw.githubusercontent.com/bumbeishvili/9sig.networthcast.com/refs/heads/main/data/fed-funds-effective.tsv](https://raw.githubusercontent.com/bumbeishvili/9sig.networthcast.com/refs/heads/main/data/fed-funds-effective.tsv) |
| 3-month T-bill (monthly, 1934+) | [https://raw.githubusercontent.com/bumbeishvili/9sig.networthcast.com/refs/heads/main/data/t-bill-3mo.tsv](https://raw.githubusercontent.com/bumbeishvili/9sig.networthcast.com/refs/heads/main/data/t-bill-3mo.tsv) |
| Combined daily short rates (1934+) | [https://raw.githubusercontent.com/bumbeishvili/9sig.networthcast.com/refs/heads/main/data/short-rates.tsv](https://raw.githubusercontent.com/bumbeishvili/9sig.networthcast.com/refs/heads/main/data/short-rates.tsv) |

`raw.githubusercontent.com` sits behind a CDN with its own cache TTL and enforces GitHub's unauthenticated rate limit. A client polling it in a tight loop will get stale bytes or a 429. Fetch once a day and cache locally.

### File format

Plain tab-separated, two columns:

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

- One row per trading day, or per month for `t-bill-3mo.tsv`.
- The time is always `16:00:00`, the New York 4 PM close.
- Closes are US dollars. Rates are annual percentages.
- Dates use unpadded `M/D/YYYY`.

## Auto-refresh

`.github/workflows/update-data.yml` fires hourly on weekdays (`30 13-22 * * 1-5`) and gates each fire to 09:00–17:30 ET, so nine runs land per trading day: one at the open, seven through the session, one after the close. Each run executes `update_data.py` in its default incremental mode and commits `data/*.tsv` only when the bytes changed, which makes holidays a no-op.

Incremental mode touches the **seven price files only**. It pulls fresh yfinance bars for the post-IPO tail of each ETF, copies the committed pre-IPO prefix through verbatim, and never contacts FRED. The three rate files refresh by hand:

```bash
python3 update_data.py --refresh-rates    # re-pull DFF + TB3MS from FRED
python3 update_data.py --rebuild          # full re-synthesis; needs ^ndx_d.csv for pre-1985
```

So the rate files lag the price files. Check the last row of `short-rates.tsv` before you rely on a recent rate; as of this writing it trails the price files by about three months.

Found a bug in the synthesis? Open an issue, or send a PR against `update_data.py` at the repo root.

## A note on synthetic backtesting

These are reconstructions. QQQ and TQQQ were not around for most of the market cycles people want to test against, and this is the best available substitute, but read it in that spirit. A strategy that looks great in 1973 or 2000 has a what-if behind it, not a track record.

Absolute CAGRs from pre-2010 backtests carry both dividend gaps above: roughly 2 pp/year on Nasdaq series before 1999, and 3.7–4.0 pp/year × leverage on S&P series before 1988. Both push the same direction for every strategy holding the same underlying, so a ranking of strategies against each other survives much better than any one of their quoted CAGRs.
