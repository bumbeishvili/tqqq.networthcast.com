# LETF Timing & Rotation Strategies — Top 25 Reference

The 25 best-known leveraged-ETF (LETF) strategies — the foundational academic
models, the famous community portfolios, and the widely-cited timing rules —
centered on the SMA-200 / trend-timing family this app implements.

## How to read this

Each strategy uses one rule grammar so it maps straight onto the app's knobs:

- **Signal** — the series that drives the decision and the average it's measured
  against (e.g. `SPY vs 200-day SMA`). "Own price" = the LETF's own price;
  otherwise the *unleveraged underlying/index* is the signal.
- **Enter / Exit** — the exact threshold that flips the position (with any
  buffer/hysteresis band, in %).
- **Freq** — how often the signal is checked (daily / weekly / monthly) — one of
  the biggest performance levers across these strategies.
- **In / Park** — what's held risk-on (the LETF) vs risk-off (cash, T-bills,
  unlevered equity, gold, bonds…).
- **Overlay** — any deleverage/bodyguard, DCA, or stop layered on top.

**On the performance numbers:** each figure is **as self-reported by that
source**, over **that source's own period and cost assumptions** — they are
*not* apples-to-apples across rows. Always check the start date (a pre-1932
start massively flatters SMA rules) and whether slippage/spreads/taxes were
modeled (most are not). 📊 = already implemented in the app's SMA/9sig panels.

> ⚠️ **Universal caveat (every row):** SMA/trend timing on 3× funds cuts
> *volatility* far more than *tail risk* — even buffered TQQQ variants backtest
> to ≈ **−96% peak-to-trough**. The rule beats buy-and-hold in only ~**49–50%**
> of rolling 3-year windows; its edge is risk control across full cycles, not
> consistent outperformance. Frequent rotation triggers **short-term cap gains +
> unqualified dividends**, and academic tests conclude real-world
> **slippage/costs likely erased** the paper gains.

---

## TQQQ-era head-to-head (2010-02-11 → 2026-07-10) — computed from this app's data

The source numbers in the Top-25 table below span wildly different eras
(1928–2015, 1901–2012, 2010–2023…) and cost models, so they are **not**
comparable. The table here is **one consistent backtest** I computed directly
from this repo's daily TSVs, over the real TQQQ era, so the strategies can be
ranked against each other and against buy-and-hold.

**Method:** lump-sum $10,000, no contributions, signal checked with **no
look-ahead** (position set from the prior close's signal, applied to the next
day's return), **cash parked at 0%**, no fees/taxes. Covers only the strategies
computable from price + SMA on assets the app holds (QQQ, SPY, TQQQ, SSO) —
rows needing VIX/MACD/TMF/gold/momentum aren't in this app's data and keep their
source-reported figures instead.

| Strategy | CAGR | Max DD | Ann. vol | Sharpe | Growth of $10k |
|---|--:|--:|--:|--:|--:|
| **B&H TQQQ** (benchmark) | **43.5%** | −81.7% | 61% | 0.90 | ×375 |
| B&H SSO 2× (benchmark) | 23.9% | −59.3% | 34% | 0.80 | ×34 |
| B&H QQQ (benchmark) | 19.7% | −35.1% | 21% | 0.98 | ×19 |
| B&H SPY (benchmark) | 14.6% | −33.7% | 17% | 0.88 | ×9 |
| **#13 Hollywood SPY 200SMA +4/−3 → TQQQ/QQQ** (daily) | **40.6%** | −59.9% | 48% | **0.96** | ×269 |
| **#25 QQQ 200SMA → TQQQ else QQQ** (always-invested) | **39.5%** | −58.7% | 49% | 0.93 | ×237 |
| #21 SPY 200SMA → TQQQ else cash (cross-index, daily) | 36.8% | −58.9% | 45% | 0.92 | ×171 |
| #19 Golden/Death cross 50/200 QQQ → TQQQ else cash | 35.6% | −69.9% | 53% | 0.84 | ×149 |
| #10 QQQ 200SMA → TQQQ else **cash** (daily) | 32.8% | −55.9% | 47% | 0.84 | ×106 |
| #1/#3 Faber **monthly** QQQ 200SMA → TQQQ else cash | 31.3% | −69.9% | 51% | 0.79 | ×87 |
| TQQQ **own-price** 200SMA → TQQQ else cash (daily) | 31.0% | −50.4% | 44% | 0.84 | ×84 |
| #12 SSO own 200SMA → SSO else cash (2×) | 14.9% | −42.2% | 23% | 0.73 | ×10 |

**What this shows (and it's the honest, uncomfortable result):**

- **Buy-and-hold TQQQ won on raw return** (43.5% CAGR) because 2010–2026 was a
  historic, largely uninterrupted bull with only brief bears (2018, 2020, 2022).
  Trend timing is designed for *long, grinding* bears that this window didn't
  really contain — so it mostly gave up return to sidestep drawdowns that
  recovered quickly anyway.
- **Timing's payoff was drawdown, not CAGR:** the best configs cut max drawdown
  from **−82% → ~−60%** while keeping most of the return.
- **Staying invested beats parking in cash.** The two best timing rows
  (#13 Hollywood and #25 always-in-QQQ) hold **QQQ on the sell side** instead of
  cash — that alone was worth ~**+7 pp CAGR** vs the identical rule parked in
  cash (#10: 32.8% → #25: 39.5%). Best risk-adjusted too (Sharpe 0.96 vs 0.84).
- **Slow / monthly signals hurt here:** monthly Faber and the 50/200 golden
  cross let deeper drawdowns through (−70%) *and* returned less — on a fast 3×
  fund, a monthly check reacts too late.
- **The asymmetric +4/−3 buffer earned its keep:** #13 posted the top Sharpe
  (0.96) and second-highest CAGR, validating the "harder to re-leverage, quicker
  to de-risk" design.

*(Cash at 0% is conservative to the timing rows; crediting a ~1.5–2%/yr T-bill
yield on parked cash would lift the cash-parked rows ~+0.5–1.0 pp CAGR each and
leave the always-invested rows and benchmarks unchanged. Reproduce/adjust with
`python3 research/backtest_strategies.py`.)*

---

## The Top 25

| # | Strategy / origin | Detailed rules | Reported performance | Src |
|---|---|---|---|---|
| 1 | **Faber 10-month / 200-day Timing Model** — the foundation | Signal: S&P 500 vs its **10-month SMA** (≈200-day). Enter: monthly close **>** SMA → hold index. Exit: monthly close **<** SMA → T-bills. Freq: **monthly**, last trading day (intra-month action ignored). Park: 90-day T-bills. Overlay: none. Paper explicitly extends to **leveraged** legs financed at the broker-call rate. | S&P TR 1901–2012: **10.18%** vs 9.32% B&H · vol 11.97% vs 17.87% · Sharpe **0.55** vs 0.32 · maxDD **−50%** vs −83% | [F] |
| 2 | **Gayed & Bilello LRS 3×** — *Leverage for the Long Run* | Signal: S&P 500 **Total-Return** index vs **200-day SMA**. Enter: close > SMA → **3× S&P**. Exit: close < SMA → T-bills. Freq: daily close. ~5 round-trips/yr. | 1928–2015: **26.8% CAGR · maxDD −92.2% · Sharpe 0.47** (vs 3× B&H 15.3% / −99.9% / 0.21) | [GB] |
| 3 | **Gayed & Bilello LRS 2×** | As #2 at **2×** leverage. | 1928–2015: **19.1% CAGR · maxDD −78.7% · Sharpe 0.51** (vs B&H 0.30) | [GB] |
| 4 | **Gayed & Bilello LRS 1.25×** | As #2 at **1.25×** — the conservative arm. | 1928–2015: **12.4%** annual | [GB] |
| 5 | **HedgeFundie's Excellent Adventure** — 55/45 UPRO/TMF | Static risk-parity-style: **55% UPRO (3× S&P) + 45% TMF (3× long Treasury)**, **quarterly** rebalance. Optional 200-SMA overlay to de-risk the UPRO leg. Freq: quarterly. | The famous Bogleheads LETF portfolio; strong 2010s, **2022 exposed the both-legs-down risk** (stocks + bonds fell together) | [BH] |
| 6 | **Alvarez UPRO/TQQQ composite** | **Monthly**, last trading day. Four gates: VIX ≤ 25 · S&P > 200-day MA · VWO momentum > 0 · BND momentum > 0. **All true →** 50% UPRO + 50% TQQQ. **1–2 false →** 50% QQQ + 50% SPY. **3–4 false →** 100% TLT. Enter next open. | 2010–2023: **24.4% CAR · maxDD −54%** | [ALV] |
| 7 | **Antonacci Dual Momentum → LETF sleeve** (GEM-style) | **Absolute filter:** hold risk-on only if the underlying's 12-mo return > T-bills. **Relative pick:** choose the stronger of S&P/Nasdaq momentum → hold matching **3×**; else T-bills. Freq: monthly. | Antonacci GEM is a widely-cited momentum framework; LETF sleeve amplifies both the momentum premium **and** the whipsaw | [QP] |
| 8 | **Siegel 200-day ±1% band** — the origin of the buffer | Signal: index vs **200-day SMA** with a symmetric **±1% band**. Enter: close **≥ +1%** above SMA. Exit: close **≤ −1%** below → T-bills. Freq: daily. Earliest documented hysteresis band (Siegel, DJIA 1886–2006), cited by Faber. | Historical origin of the whipsaw-buffer idea | [F] |
| 9 | **Canonical 200-day SMA on TQQQ** (r/LETF) | Signal: S&P 500 (or QQQ) vs **200-day SMA**. Enter > SMA → **TQQQ**. Exit < SMA → cash. Freq: daily/monthly. Variants float 150/175-day windows and ~1% bands. Community note: **UPRO is a cleaner vehicle** than TQQQ on an S&P signal (avoids SPX↔NDX basis risk). | S&P 200-MA (1960–present): 6.7% vs 7.4% B&H, **maxDD 29% vs 56%**, invested ~70% of the time | [BH][GS] |
| 10 | **QQQ 200-day → TQQQ (matched index)** 📊 | Signal: **QQQ** vs its 200-day SMA → trade **TQQQ**. Enter > SMA → TQQQ; Exit < SMA → cash. Freq: daily (monthly = Faber cadence). Matched-index avoids cross-index basis risk. | The app's canonical SMA configuration | [F][BH] |
| 11 | **SPY 200-day → UPRO (clean matched)** | Signal: SPY/S&P vs 200-day SMA → trade **UPRO (3× S&P)**. Enter > SMA; Exit < SMA → T-bills. Freq: daily. | "Cleaner than TQQQ" — signal and exposure share the same index | [BH] |
| 12 | **SSO/SHY 200-day own-price rotation** (2×) 📊 | Signal: **SSO's own price** vs 200-day SMA. Enter: price > SMA → **SSO**. Exit: price < SMA → **SHY** (1–3yr Treasuries). Re-enter on cross back up. Freq: daily. 200-day chosen over 50-day to cut trade count. | 5-yr: Sharpe **0.555** vs 0.524 B&H SPY | [SSO] |
| 13 | **Hollywood SPY 200SMA +4%/−3%** (r/TQQQ) 📊 | Signal: **SPY vs 200-day SMA**, asymmetric band. Enter: SPY **≥ +4%** above SMA → 100% **TQQQ**. Exit: SPY **≤ −3%** below → 100% **QQQ** (never cash — always invested). Freq: **daily**. Band = whipsaw filter (*harder to re-leverage, quicker to de-risk*). Overlays: bodyguard (#24) + DCA-back-in (#25). | 1985–2026: **27.3% CAGR · maxDD −95.8% · Sharpe 0.71 · vol 57.1%** — flagged *"not investable"* | [HW] |
| 14 | **Three-phase TQQQ/QLD/GLDM** (freefighter07) | **Phase 1:** SPY > 200SMA **+4%** → 100% **TQQQ**. **Phase 2:** after **366 days held** → 50% **QLD (2×)** + 50% **GLDM (gold)** (time-based deleverage). **Phase 3:** SPY < 200SMA **−3%** → 50% **SGOV** + 50% **GLDM**. Freq: daily. | Backtest sheet with dated trades published (3 tabs) | [3PH] |
| 15 | **Composer TQQQ-RSI** (200MA + RSI + PPO) | **200-day trend filter** (price > 200-day MA) **AND** RSI oscillator **AND** PPO. Buy **TQQQ** on dips within the uptrend; else park in **SHV** (short T-bills). Freq: **daily** rotation. | Since Sep 2023 (short OOS): **69.11% ann · maxDD −23.5% · Sharpe 1.47** (vs SPY 15.82% / −18.8%) | [CMP] |
| 16 | **Composer multi-signal + hedges** | #15 plus tactical hedges: brief **SQQQ (−3×)** or **UVXY** after extreme moves; **TECL (3×)** on sharp declines. Freq: daily. | Highest-complexity Composer variant; no tax/whipsaw disclosure | [CMP] |
| 17 | **Petrou weekly-MACD → TQQQ** (+ stops) | Signal: **QQQ/NDX weekly MACD**. Enter: MACD line crosses **above zero** → TQQQ. Exit: crosses **below zero** → cash. **Stops:** 10% hard stop below entry + **30% trailing** stop from peak (sized for 3×). Freq: **weekly** closes only. | Feb 2010–Jul 2025: **+11,194%** (BufferPct 2%, 2-bar confirm) — beat 40-week SMA crossover | [MACD] |
| 18 | **40-week SMA crossover → TQQQ** | Signal: NDX vs **40-week SMA** (≈200-day, weekly grain). Enter: weekly close > SMA → TQQQ; Exit: < SMA → cash. Freq: **weekly**. | ~**+2,800%** over the Petrou comparison window (weekly grain, no MACD) | [MACD] |
| 19 | **Golden / Death Cross 50/200** | Enter when **50-day SMA crosses above 200-day SMA** (golden cross) → LETF. Exit on **death cross** (50 < 200) → cash/T-bills. Freq: daily. | Classic MA-crossover; slower than price-vs-200, so later entries/exits | [GS] |
| 20 | **Volatility targeting** (scale leverage to target vol) | Leverage = **target-vol ÷ trailing realized vol**, capped at the fund multiple; deleverage as vol rises. Common targets 15–25%. Often paired with a 200-SMA on/off gate. Freq: weekly/monthly rebalance. | Reduces tail risk **without** binary exits; the QuantConnect systematic-risk approach | [QC] |
| 21 | **VIX-scaled leverage ladder** | Map VIX to leverage: e.g. VIX < 15 → 3×, 15–25 → 2×, 25–35 → 1×, > 35 → cash. Freq: daily/weekly. Ancestor of the Alvarez VIX gate. | Transparent regime ladder; deleverages into fear spikes | [ALV][QC] |
| 22 | **Connors RSI(2) dip-buy in uptrend** | **Trend filter:** price > 200-day SMA. **Entry:** buy TQQQ when **RSI(2) < 10** (short-term oversold). **Exit:** RSI(2) > 70 or price < 200SMA. Freq: daily. | Short-term mean-reversion *inside* the trend filter; improves entry price, adds turnover | [QS] |
| 23 | **TFTLT RSI overheat + cool-gate** 📊 | **Overheat exit:** if RSI(10) ≥ threshold (e.g. 70/80), exit to cash even while above the SMA. **Cool-gate entry:** on a BUY signal, don't re-enter until RSI(10) drops below a cool level (40–60) — buy the pullback, not the top. Freq: daily. | The Reddit "TFTLT" RSI convention; both levers app-implemented | [CMP] |
| 24 | **Bodyguard deleverage overlay** (+30 / +40) 📊 | Independent of the primary signal: if the **unlevered underlying ≥ 30%** above its 200SMA → swap 3×→**QQQ (1×)**; if **≥ 40%** above → sell **everything to cash**. Instant (overrides DCA). Dot-com-froth insurance. | Documented Hollywood overlay; app-implemented | [HW] |
| 25 | **Always-invested park + DCA-back-in** 📊 | On SELL, hold **QQQ/SPY (1×)** instead of cash (historically beat bonds/cash on the sell side). On BUY, **DCA into QQQ over 6–12 months or until SPY reclaims +4%** above its 200SMA, then rotate fully to TQQQ. Freq: monthly tranches. | +6.91% avg return holding QQQ vs bonds in downturns (from 2003); both levers app-implemented | [HW] |

---

## Sources

| Key | Source | Link |
|-----|--------|------|
| F | Faber, *A Quantitative Approach to Tactical Asset Allocation* (SSRN 962461) | https://mebfaber.com/wp-content/uploads/2016/05/SSRN-id962461.pdf |
| GB | Gayed & Bilello, *Leverage for the Long Run* (Leverage Rotation Strategy) | https://cmtassociation.org/wp-content/uploads/2025/08/2016-gayed-bilello.pdf · https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2741701 |
| ALV | Alvarez Quant Trading — UPRO/TQQQ strategy | https://alvarezquanttrading.com/blog/upro-tqqq-leveraged-etf-strategy/ |
| MACD | Lambros Petrou — Investing in Leveraged QQQ with MACD | https://www.lambrospetrou.com/articles/investing-leveraged-qqq-macd/ |
| SSO | Brightwork Research — LETFs + 200-day MA | https://www.brightworkresearch.com/using-letfs-combined-with-the-200-day-moving-average-trading-approach/ |
| HW | r/TQQQ "SPY 200SMA (+4%/−3%)" (u/XXXMrHOLLYWOOD) | https://bestfolio.app/strategies/tqqq-qqq-band · https://www.tradingview.com/script/QEVAQHl6-SPY-200SMA-4-Entry-3-Exit-Strategy-QQQ-TQQQ/ |
| 3PH | TradingView three-phase TQQQ/QLD/GLDM (freefighter07) | https://www.tradingview.com/script/cbUgg7hl-SPY-200SMA-4-Entry-3-Exit-TQQQ-QLD-GLDM-THREE-PHASE-STRATEGY/ |
| CMP | Composer.trade — TQQQ RSI strategy | https://www.composer.trade/trading-strategies/tqqq-rsi-strategy-Lh0fYfA5RJQmpyfGEORb · https://magnatecha.com/tqqq-with-moving-average-rotation/ |
| BH | Bogleheads — LETF / timing threads (incl. HedgeFundie) | https://www.bogleheads.org/forum/viewtopic.php?t=297591 |
| GS | GraniteShares — The 200 Moving Average Strategy Explained | https://graniteshares.com/research/the-200-moving-average-strategy-explained/ |
| QS | QuantifiedStrategies — 200-day MA trading strategy | https://www.quantifiedstrategies.com/200-day-moving-average-trading-strategy/ |
| QC | QuantConnect — Leveraged ETFs with systematic risk management | https://www.quantconnect.com/research/15351/leveraged-etfs-with-systematic-risk-management/ |
| QP | Quantpedia — Leveraged ETFs in asset allocation | https://quantpedia.com/leveraged-etfs-in-asset-allocation-opportunity-or-trap/ |
| ARX | arXiv 2504.20116 — LETF return dynamics / decay | https://arxiv.org/abs/2504.20116 |
| HFQ | Harbourfront Quant — Do LETFs really decay? | https://harbourfrontquant.substack.com/p/leveraged-etfs-do-they-really-decay |

---

## How this maps to the app

The SMA panel already implements the highest-value documented levers from the
list above:

- **Signal source** (QQQ/SPY, underlying vs LETF) → #10–13
- **SMA window** (100/150/200/250) → #8–10
- **Entry/exit buffers** (0–5%, symmetric & asymmetric) → #8, #13
- **RSI overheat + cool-gate** → #23
- **Park asset** (cash / QQQ / SPY) → #12, #25
- **Bodyguard delever/GTFO** (30% / 40% above SMA) → #24
- **DCA ladders** (in / to-out, 0/3/6/12 mo) → #25

**Documented patterns not yet in the app** (candidate features, ranked):

1. **Selectable signal-check frequency** (daily / weekly / monthly) — the single
   biggest un-modeled variable. Faber = monthly, Petrou = weekly, Hollywood /
   Composer = daily.
2. **Composite multi-condition gates** — Alvarez's VIX + MA + momentum (#6),
   MACD zero-cross (#17), and RSI+PPO combos (#15).
3. **Continuous volatility targeting / VIX-scaled leverage** (#20–21) — scale
   leverage instead of binary in/out.
4. **MA-crossover signals** (#18–19) as an alternative to price-vs-single-SMA.
5. **Dual momentum / relative-strength selection** (#7) across S&P vs Nasdaq
   sleeves.

> **Footnote on trusting the numbers:** the LETF-decay premise behind timing is
> itself contested — several sources ([ARX], [HFQ], [QP]) argue LETFs do **not**
> inherently erode long-run and can even skew to *outperform* their non-reset
> portfolios; regime (trending vs mean-reverting) matters more than "volatility
> drag." So treat the timing overlay as **tail-risk insurance**, not a
> guaranteed return enhancer.
