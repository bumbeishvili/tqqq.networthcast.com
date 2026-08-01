// Strategy Library — a catalog of the best-known LETF timing / rotation
// strategies plus hand-picked ones (tag 'picked'), shown in a modal table.
// Entries with code in window.STRATEGY_CODE get a "+ Add" button that drops
// them onto the chart as a real custom strategy (see addStrategyFromLibrary).
//
// `here` = CAGR / maxDD computed from THIS app's own daily TSVs over the TQQQ
// era (2010-02-11 → 2026-07-10), apples-to-apples — see backtest_strategies.py.
// `reported` = the source's self-reported figure over ITS OWN period (shown in
// parentheses); not comparable across rows.
const STRATEGY_LIBRARY = [
  { n: 1, name: 'Faber 10-month / 200-day Timing Model', tag: 'foundation', runnable: true,
    rules: 'Signal: S&P/QQQ vs 10-mo SMA (≈200-day). Enter: monthly close > SMA → hold. Exit: monthly close < SMA → T-bills. Freq: monthly (last trading day).',
    here: '31.3% / −69.9%', reported: '10.2% vs 9.3% B&H (S&P 1901–2012)', src: 'F' },
  { n: 2, name: 'Gayed & Bilello LRS 3× — Leverage for the Long Run', tag: 'academic', runnable: true,
    rules: 'Signal: S&P 500 Total-Return vs 200-day SMA. Enter > SMA → 3× S&P. Exit < SMA → T-bills. Freq: daily. ~5 round-trips/yr.',
    here: '≈ #10', reported: '26.8% CAGR · −92.2% DD · Sharpe 0.47 (1928–2015)', src: 'GB' },
  { n: 3, name: 'Gayed & Bilello LRS 2×', tag: 'academic', runnable: true,
    rules: 'As #2 at 2× leverage. Signal from unlevered S&P TR vs 200-day SMA. Park: T-bills. Freq: daily.',
    here: '≈ SSO rows', reported: '19.1% CAGR · −78.7% DD · Sharpe 0.51 (1928–2015)', src: 'GB' },
  { n: 4, name: 'Gayed & Bilello LRS 1.25×', tag: 'academic', runnable: true,
    rules: 'As #2 at 1.25× — the conservative arm. Signal: S&P TR vs 200-day SMA. Freq: daily.',
    here: '—', reported: '12.4% annual (1928–2015)', src: 'GB' },
  { n: 5, name: "HedgeFundie's Excellent Adventure (55/45 UPRO/TMF)", tag: 'portfolio', runnable: false, needs: 'TMF',
    rules: 'Static: 55% UPRO (3× S&P) + 45% TMF (3× long Treasury), quarterly rebalance. Optional 200-SMA overlay on the UPRO leg. Freq: quarterly.',
    here: '—', reported: 'Famous Bogleheads portfolio; 2022 exposed both-legs-down risk', src: 'BH' },
  { n: 6, name: 'Alvarez UPRO/TQQQ composite', tag: 'composite', runnable: false, needs: 'VIX',
    rules: 'Monthly. Gates: VIX≤25 · S&P>200-day MA · VWO mom>0 · BND mom>0. All true → 50% UPRO+50% TQQQ. 1–2 false → 50% QQQ+50% SPY. 3–4 false → 100% TLT.',
    here: '—', reported: '24.4% CAR · −54% DD (2010–2023)', src: 'ALV' },
  { n: 7, name: 'Antonacci Dual Momentum → LETF sleeve (GEM)', tag: 'momentum', runnable: false, needs: 'VWO/BND',
    rules: 'Absolute filter: underlying 12-mo return > T-bills. Relative pick: stronger of S&P/Nasdaq momentum → hold matching 3×; else T-bills. Freq: monthly.',
    here: '—', reported: 'Widely-cited momentum framework; LETF amplifies premium + whipsaw', src: 'QP' },
  { n: 8, name: 'Siegel 200-day ±1% band', tag: 'origin', runnable: true,
    rules: 'Signal: index vs 200-day SMA with symmetric ±1% band. Enter: close ≥ +1% above. Exit: close ≤ −1% below → T-bills. Freq: daily.',
    here: '—', reported: 'Origin of the whipsaw-buffer idea (DJIA 1886–2006)', src: 'F' },
  { n: 9, name: 'Canonical 200-day SMA on TQQQ (r/LETF)', tag: 'community', runnable: true,
    rules: 'Signal: S&P/QQQ vs 200-day SMA. Enter > SMA → TQQQ. Exit < SMA → cash. Freq: daily/monthly. Note: UPRO cleaner than TQQQ on an S&P signal.',
    here: '32.8% / −55.9%', reported: 'S&P 200MA 6.7% vs 7.4% B&H · DD 29% vs 56% (1960–)', src: 'BH·GS' },
  { n: 10, name: 'QQQ 200-day → TQQQ (matched index, cash park)', tag: 'app', runnable: true,
    rules: 'Signal: QQQ vs its 200-day SMA → trade TQQQ. Enter > SMA → TQQQ; Exit < SMA → cash. Matched-index avoids basis risk. Freq: daily.',
    here: '32.8% / −55.9%', reported: "The app's canonical SMA config", src: 'F·BH' },
  { n: 11, name: 'SPY 200-day → UPRO (clean matched)', tag: 'community', runnable: true,
    rules: 'Signal: SPY/S&P vs 200-day SMA → trade UPRO (3× S&P). Enter > SMA; Exit < SMA → T-bills. Signal + exposure share the index. Freq: daily.',
    here: '36.8% / −58.9%', reported: '"Cleaner than TQQQ" — no SPX↔NDX basis risk', src: 'BH' },
  { n: 12, name: 'SSO/SHY 200-day own-price rotation (2×)', tag: 'app', runnable: true,
    rules: "Signal: SSO's OWN price vs 200-day SMA. Enter > SMA → SSO. Exit < SMA → SHY (1–3yr T). Re-enter on cross up. Freq: daily.",
    here: '14.9% / −42.2%', reported: 'Sharpe 0.555 vs 0.524 B&H SPY (5-yr)', src: 'SSO' },
  { n: 13, name: 'Hollywood SPY 200SMA +4%/−3% → TQQQ/QQQ', tag: 'community', runnable: true,
    rules: 'Signal: SPY vs 200-day SMA, asymmetric band. Enter: SPY ≥ +4% above → 100% TQQQ. Exit: SPY ≤ −3% below → 100% QQQ (never cash). Freq: daily. + bodyguard + DCA-back-in.',
    here: '40.6% / −59.9%', reported: '27.3% CAGR · −95.8% DD · Sharpe 0.71 (1985–2026)', src: 'HW' },
  { n: 14, name: 'Three-phase TQQQ/QLD/GLDM', tag: 'community', runnable: false, needs: 'gold',
    rules: 'P1: SPY>200SMA+4% → 100% TQQQ. P2: after 366 days held → 50% QLD (2×)+50% GLDM (gold). P3: SPY<200SMA−3% → 50% SGOV+50% GLDM. Freq: daily.',
    here: '—', reported: 'Published backtest sheet with dated trades', src: '3PH' },
  { n: 15, name: 'Composer TQQQ-RSI (200MA + RSI + PPO)', tag: 'oscillator', runnable: false,
    rules: '200-day trend filter AND RSI AND PPO. Buy TQQQ on dips within the uptrend; else park in SHV. Freq: daily rotation.',
    here: '—', reported: '69.11% ann · −23.5% DD · Sharpe 1.47 (since Sep 2023, short)', src: 'CMP' },
  { n: 16, name: 'Composer multi-signal + hedges', tag: 'oscillator', runnable: false, needs: 'SQQQ/UVXY',
    rules: '#15 plus tactical hedges: brief SQQQ (−3×) or UVXY after extreme moves; TECL (3×) on sharp declines. Freq: daily.',
    here: '—', reported: 'Highest-complexity Composer variant', src: 'CMP' },
  { n: 17, name: 'Petrou weekly-MACD → TQQQ (+ stops)', tag: 'crossover', runnable: false,
    rules: 'Signal: QQQ/NDX weekly MACD. Enter: MACD crosses above zero → TQQQ. Exit: crosses below zero → cash. Stops: 10% hard + 30% trailing. Freq: weekly.',
    here: '—', reported: '+11,194% (Feb 2010–Jul 2025)', src: 'MACD' },
  { n: 18, name: '40-week SMA crossover → TQQQ', tag: 'crossover', runnable: true,
    rules: 'Signal: NDX vs 40-week SMA (≈200-day, weekly grain). Enter: weekly close > SMA → TQQQ. Exit: < SMA → cash. Freq: weekly.',
    here: '—', reported: '+2,800% (Petrou comparison window)', src: 'MACD' },
  { n: 19, name: 'Golden / Death Cross 50/200', tag: 'crossover', runnable: false,
    rules: 'Enter: 50-day SMA crosses above 200-day SMA (golden) → LETF. Exit: death cross (50 < 200) → cash/T-bills. Freq: daily.',
    here: '35.6% / −69.9%', reported: 'Classic MA-crossover; slower than price-vs-200', src: 'GS' },
  { n: 20, name: 'Volatility targeting (scale leverage to target vol)', tag: 'risk', runnable: false,
    rules: 'Leverage = target-vol ÷ trailing realized vol, capped at fund multiple; deleverage as vol rises. Targets 15–25%. Often + 200-SMA gate. Freq: weekly/monthly.',
    here: '—', reported: 'Reduces tail risk without binary exits (QuantConnect)', src: 'QC' },
  { n: 21, name: 'VIX-scaled leverage ladder', tag: 'risk', runnable: false, needs: 'VIX',
    rules: 'Map VIX to leverage: VIX<15 → 3×, 15–25 → 2×, 25–35 → 1×, >35 → cash. Freq: daily/weekly. Ancestor of the Alvarez VIX gate.',
    here: '—', reported: 'Transparent regime ladder; deleverages into fear', src: 'ALV·QC' },
  { n: 22, name: 'Connors RSI(2) dip-buy in uptrend', tag: 'oscillator', runnable: false,
    rules: 'Trend filter: price > 200-day SMA. Entry: buy TQQQ when RSI(2) < 10 (oversold). Exit: RSI(2) > 70 or price < 200SMA. Freq: daily.',
    here: '—', reported: 'Short-term mean-reversion inside the trend filter', src: 'QS' },
  { n: 23, name: '200-day SMA + RSI exit & re-entry', tag: 'app', runnable: true,
    rules: 'Overheat exit: RSI(10) ≥ threshold → exit to cash even above SMA. Cool-gate entry: on BUY, wait until RSI(10) drops below a cool level before re-entering. Freq: daily.',
    here: '—', reported: 'Sell when overbought, wait for a dip to buy back; app-implemented', src: 'CMP' },
  { n: 24, name: 'Bodyguard deleverage overlay (+30 / +40)', tag: 'app', runnable: true,
    rules: 'Independent of primary signal: underlying ≥ 30% above its 200SMA → swap 3×→QQQ (1×); ≥ 40% above → sell everything to cash. Instant (overrides DCA).',
    here: '—', reported: 'Dot-com-froth insurance; app-implemented', src: 'HW' },
  { n: 25, name: 'Always-invested park + DCA-back-in', tag: 'app', runnable: true,
    rules: 'On SELL, hold QQQ/SPY (1×) instead of cash. On BUY, DCA into QQQ over 6–12 mo or until SPY reclaims +4% above 200SMA, then rotate fully to TQQQ.',
    here: '39.5% / −58.7%', reported: '+6.91% avg holding QQQ vs bonds in downturns; app-implemented', src: 'HW' },
  // --- hand-picked (tag 'picked'): my own, not from a published write-up. No
  // `src`, so the card title renders as plain text instead of a dead link. ---
  { n: 26, name: 'Rolling median 250', tag: 'picked', runnable: true,
    rules: 'Signal: traded fund vs the MEDIAN of its own last 250 closes. Exit: price > 55% above the median → park (cash by default). Enter: any time it is not. Freq: daily. Overextension filter only — there is no downside rule, so it holds all the way through every crash.',
    here: '62.4% / −79.1%', reported: 'Hand-picked; numbers are this app’s own backtest, not an external claim' },
  { n: 39, name: 'Overheat exit \u2014 SSO signal (sell when stretched)', tag: 'picked', runnable: true,
    rules: 'Signal: SSO vs its own 150-day SMA. Exit: signal closes >20% above the SMA \u2192 park (cash by default). Enter: any time it is not. Freq: daily. Signal and traded fund are separate knobs. Overextension filter only \u2014 like Rolling median 250 it has no downside rule, so it holds through every crash.',
    here: '\u2014', reported: 'Hand-picked; numbers are this app\u2019s own backtest, not an external claim' },
  // --- optimizer winners (tag 'overfit'): the single top-ranked row from each
  // tab of the 9sig and SMA overfit explorers. These are the BEST-FITTING
  // parameter sets found by sweeping thousands of combinations against a fixed
  // window, so their headline numbers are the peak of a search, not a forecast —
  // shown here to make that gap visible, not as recommendations.
  { n: 27, name: '9sig · max return 2010–2025', tag: 'overfit', runnable: true,
    rules: 'Top-ranked max return row from the 9sig overfit explorer, tuned on 2010–2025 (in-sample CAGR 55.33%, drawdown 69.91%). Runs as a native 9sig config, so every knob stays editable. Selected by search over that window — expect the other windows to look much worse.',
    here: '—', reported: 'In-sample optimum over 2010–2025: 55.33% CAGR / −69.91% DD',
    preset: { type: "9sig", params: {"select-9sig-underlying":"tqqq","select-9sig-growth":"130","select-9sig-crashdrop":"5","select-9sig-crashwin":"24","select-9sig-spike":"25","select-9sig-period":"monthly","select-9sig-cash":"90","select-9sig-cashrate":"4","select-9sig-buypower":"100","select-9sig-deploy":"75","select-9sig-target-compound":"holding","select-9sig-park-asset":"cash","select-9sig-rebalance-point":"10","select-9sig-spike-target":"0","select-9sig-cost":"0.02"} } },
  { n: 28, name: '9sig · min drawdown 2010–2025', tag: 'overfit', runnable: true,
    rules: 'Top-ranked min drawdown row from the 9sig overfit explorer, tuned on 2010–2025 (in-sample CAGR 30.01%, drawdown 19.41%). Runs as a native 9sig config, so every knob stays editable. Selected by search over that window — expect the other windows to look much worse.',
    here: '—', reported: 'In-sample optimum over 2010–2025: 30.01% CAGR / −19.41% DD',
    preset: { type: "9sig", params: {"select-9sig-underlying":"tqqq","select-9sig-growth":"12","select-9sig-crashdrop":"25","select-9sig-crashwin":"21","select-9sig-spike":"100","select-9sig-period":"yearly","select-9sig-cash":"70","select-9sig-cashrate":"4","select-9sig-buypower":"70","select-9sig-deploy":"0","select-9sig-target-compound":"holding","select-9sig-park-asset":"qld","select-9sig-rebalance-point":"10","select-9sig-spike-target":"0","select-9sig-cost":"0.02"} } },
  { n: 29, name: '9sig · max return 1990–2025', tag: 'overfit', runnable: true,
    rules: 'Top-ranked max return row from the 9sig overfit explorer, tuned on 1990–2025 (in-sample CAGR 42.24%, drawdown 81.66%). Runs as a native 9sig config, so every knob stays editable. Selected by search over that window — expect the other windows to look much worse.',
    here: '—', reported: 'In-sample optimum over 1990–2025: 42.24% CAGR / −81.66% DD',
    preset: { type: "9sig", params: {"select-9sig-underlying":"tqqq","select-9sig-growth":"150","select-9sig-crashdrop":"5","select-9sig-crashwin":"36","select-9sig-spike":"200","select-9sig-period":"yearly","select-9sig-cash":"0","select-9sig-cashrate":"4","select-9sig-buypower":"100","select-9sig-deploy":"100","select-9sig-target-compound":"holding","select-9sig-park-asset":"cash","select-9sig-rebalance-point":"0","select-9sig-spike-target":"0","select-9sig-cost":"0.02"} } },
  { n: 30, name: '9sig · min drawdown 1990–2025', tag: 'overfit', runnable: true,
    rules: 'Top-ranked min drawdown row from the 9sig overfit explorer, tuned on 1990–2025 (in-sample CAGR 18.12%, drawdown 22.67%). Runs as a native 9sig config, so every knob stays editable. Selected by search over that window — expect the other windows to look much worse.',
    here: '—', reported: 'In-sample optimum over 1990–2025: 18.12% CAGR / −22.67% DD',
    preset: { type: "9sig", params: {"select-9sig-underlying":"tqqq","select-9sig-growth":"0.5","select-9sig-crashdrop":"5","select-9sig-crashwin":"60","select-9sig-spike":"250","select-9sig-period":"quarterly","select-9sig-cash":"70","select-9sig-cashrate":"4","select-9sig-buypower":"70","select-9sig-deploy":"50","select-9sig-target-compound":"holding","select-9sig-park-asset":"cash","select-9sig-rebalance-point":"30","select-9sig-spike-target":"0","select-9sig-cost":"0.02"} } },
  { n: 31, name: '9sig · max return 1953–2025', tag: 'overfit', runnable: true,
    rules: 'Top-ranked max return row from the 9sig overfit explorer, tuned on 1953–2025 (in-sample CAGR 19.96%, drawdown 96.58%). Runs as a native 9sig config, so every knob stays editable. Selected by search over that window — expect the other windows to look much worse.',
    here: '—', reported: 'In-sample optimum over 1953–2025: 19.96% CAGR / −96.58% DD',
    preset: { type: "9sig", params: {"select-9sig-underlying":"tqqq","select-9sig-growth":"40","select-9sig-crashdrop":"25","select-9sig-crashwin":"24","select-9sig-spike":"160","select-9sig-period":"quarterly","select-9sig-cash":"40","select-9sig-cashrate":"4","select-9sig-buypower":"85","select-9sig-deploy":"100","select-9sig-target-compound":"target","select-9sig-park-asset":"cash","select-9sig-rebalance-point":"30","select-9sig-spike-target":"0","select-9sig-cost":"0.02"} } },
  { n: 32, name: '9sig · min drawdown 1953–2025', tag: 'overfit', runnable: true,
    rules: 'Top-ranked min drawdown row from the 9sig overfit explorer, tuned on 1953–2025 (in-sample CAGR 12.01%, drawdown 45.8%). Runs as a native 9sig config, so every knob stays editable. Selected by search over that window — expect the other windows to look much worse.',
    here: '—', reported: 'In-sample optimum over 1953–2025: 12.01% CAGR / −45.8% DD',
    preset: { type: "9sig", params: {"select-9sig-underlying":"tqqq","select-9sig-growth":"15","select-9sig-crashdrop":"20","select-9sig-crashwin":"48","select-9sig-spike":"50","select-9sig-period":"yearly","select-9sig-cash":"60","select-9sig-cashrate":"4","select-9sig-buypower":"50","select-9sig-deploy":"0","select-9sig-target-compound":"holding","select-9sig-park-asset":"cash","select-9sig-rebalance-point":"15","select-9sig-spike-target":"25","select-9sig-cost":"0.02"} } },
  { n: 33, name: 'SMA · max return 2010–2025', tag: 'overfit', runnable: true,
    rules: 'Top-ranked max return row from the SMA overfit explorer, tuned on 2010–2025 (in-sample CAGR 79.79%, drawdown 74.03%). Runs as a native SMA config, so every knob stays editable. Selected by search over that window — expect the other windows to look much worse.',
    here: '—', reported: 'In-sample optimum over 2010–2025: 79.79% CAGR / −74.03% DD',
    preset: { type: "sma", params: {"select-sma-asset":"spy","select-sma-window":"280","select-sma-underlying":"sso","select-sma-cashrate":"0","select-sma-entry-buf":"5","select-sma-exit-buf":"1.9","select-sma-rsi-oh":"20","select-sma-rsi-cool":"55","select-sma-rsi-oh-window":"3","select-sma-rsi-cool-window":"22","select-sma-confirm-buy":"3","select-sma-confirm-sell":"10","select-sma-settle":"5","select-sma-out-asset":"tqqq","select-sma-dca-in":"10","select-sma-dca-to-out":"5","select-sma-bg-gtfo":"55","select-sma-bg-asset":"tqqq","select-sma-bg-window":"250","select-sma-cost":"0.02"} } },
  { n: 34, name: 'SMA · min drawdown 2010–2025', tag: 'overfit', runnable: true,
    rules: 'Top-ranked min drawdown row from the SMA overfit explorer, tuned on 2010–2025 (in-sample CAGR 61.01%, drawdown 44.5%). Runs as a native SMA config, so every knob stays editable. Selected by search over that window — expect the other windows to look much worse.',
    here: '—', reported: 'In-sample optimum over 2010–2025: 61.01% CAGR / −44.5% DD',
    preset: { type: "sma", params: {"select-sma-asset":"qqq","select-sma-window":"30","select-sma-underlying":"tqqq","select-sma-cashrate":"0","select-sma-entry-buf":"0.1","select-sma-exit-buf":"3.5","select-sma-rsi-oh":"65","select-sma-rsi-cool":"65","select-sma-rsi-oh-window":"4","select-sma-rsi-cool-window":"17","select-sma-confirm-buy":"3","select-sma-confirm-sell":"10","select-sma-settle":"1","select-sma-out-asset":"sso","select-sma-dca-in":"7","select-sma-dca-to-out":"42","select-sma-bg-gtfo":"35","select-sma-bg-asset":"sso","select-sma-bg-window":"270","select-sma-cost":"0.02"} } },
  { n: 35, name: 'SMA · max return 1990–2025', tag: 'overfit', runnable: true,
    rules: 'Top-ranked max return row from the SMA overfit explorer, tuned on 1990–2025 (in-sample CAGR 54.13%, drawdown 81.66%). Runs as a native SMA config, so every knob stays editable. Selected by search over that window — expect the other windows to look much worse.',
    here: '—', reported: 'In-sample optimum over 1990–2025: 54.13% CAGR / −81.66% DD',
    preset: { type: "sma", params: {"select-sma-asset":"qqq","select-sma-window":"30","select-sma-underlying":"spy","select-sma-cashrate":"0","select-sma-entry-buf":"13","select-sma-exit-buf":"12","select-sma-rsi-oh":"80","select-sma-rsi-cool":"70","select-sma-rsi-oh-window":"6","select-sma-rsi-cool-window":"16","select-sma-confirm-buy":"0","select-sma-confirm-sell":"10","select-sma-settle":"5","select-sma-out-asset":"tqqq","select-sma-dca-in":"7","select-sma-dca-to-out":"25","select-sma-bg-gtfo":"30","select-sma-bg-asset":"sso","select-sma-bg-window":"270","select-sma-cost":"0.02"} } },
  { n: 36, name: 'SMA · min drawdown 1990–2025', tag: 'overfit', runnable: true,
    rules: 'Top-ranked min drawdown row from the SMA overfit explorer, tuned on 1990–2025 (in-sample CAGR 31.28%, drawdown 39.46%). Runs as a native SMA config, so every knob stays editable. Selected by search over that window — expect the other windows to look much worse.',
    here: '—', reported: 'In-sample optimum over 1990–2025: 31.28% CAGR / −39.46% DD',
    preset: { type: "sma", params: {"select-sma-asset":"spxl","select-sma-window":"220","select-sma-underlying":"tqqq","select-sma-cashrate":"0","select-sma-entry-buf":"0","select-sma-exit-buf":"5","select-sma-rsi-oh":"15","select-sma-rsi-cool":"45","select-sma-rsi-oh-window":"2","select-sma-rsi-cool-window":"8","select-sma-confirm-buy":"0","select-sma-confirm-sell":"10","select-sma-settle":"0","select-sma-out-asset":"cash","select-sma-dca-in":"4","select-sma-dca-to-out":"12","select-sma-bg-gtfo":"30","select-sma-bg-asset":"sso","select-sma-bg-window":"270","select-sma-cost":"0.02"} } },
  { n: 37, name: 'SMA · max return 1953–2025', tag: 'overfit', runnable: true,
    rules: 'Top-ranked max return row from the SMA overfit explorer, tuned on 1953–2025 (in-sample CAGR 29.97%, drawdown 83.6%). Runs as a native SMA config, so every knob stays editable. Selected by search over that window — expect the other windows to look much worse.',
    here: '—', reported: 'In-sample optimum over 1953–2025: 29.97% CAGR / −83.6% DD',
    preset: { type: "sma", params: {"select-sma-asset":"spxl","select-sma-window":"20","select-sma-underlying":"tqqq","select-sma-cashrate":"0","select-sma-entry-buf":"0.4","select-sma-exit-buf":"0.4","select-sma-rsi-oh":"80","select-sma-rsi-cool":"0","select-sma-rsi-oh-window":"12","select-sma-rsi-cool-window":"17","select-sma-confirm-buy":"0","select-sma-confirm-sell":"0","select-sma-settle":"0","select-sma-out-asset":"spy","select-sma-dca-in":"1","select-sma-dca-to-out":"6","select-sma-bg-gtfo":"35","select-sma-bg-asset":"qld","select-sma-bg-window":"300","select-sma-cost":"0.02"} } },
  { n: 38, name: 'SMA · min drawdown 1953–2025', tag: 'overfit', runnable: true,
    rules: 'Top-ranked min drawdown row from the SMA overfit explorer, tuned on 1953–2025 (in-sample CAGR 18%, drawdown 51.79%). Runs as a native SMA config, so every knob stays editable. Selected by search over that window — expect the other windows to look much worse.',
    here: '—', reported: 'In-sample optimum over 1953–2025: 18% CAGR / −51.79% DD',
    preset: { type: "sma", params: {"select-sma-asset":"spxl","select-sma-window":"20","select-sma-underlying":"qld","select-sma-cashrate":"0","select-sma-entry-buf":"0.5","select-sma-exit-buf":"0.3","select-sma-rsi-oh":"85","select-sma-rsi-cool":"75","select-sma-rsi-oh-window":"8","select-sma-rsi-cool-window":"25","select-sma-confirm-buy":"0","select-sma-confirm-sell":"0","select-sma-settle":"1","select-sma-out-asset":"cash","select-sma-dca-in":"0","select-sma-dca-to-out":"5","select-sma-bg-gtfo":"20","select-sma-bg-asset":"qqq","select-sma-bg-window":"250","select-sma-cost":"0.02"} } },
];

const STRATEGY_SRC_LINKS = {
  F:   'https://mebfaber.com/wp-content/uploads/2016/05/SSRN-id962461.pdf',
  GB:  'https://cmtassociation.org/wp-content/uploads/2025/08/2016-gayed-bilello.pdf',
  ALV: 'https://alvarezquanttrading.com/blog/upro-tqqq-leveraged-etf-strategy/',
  MACD:'https://www.lambrospetrou.com/articles/investing-leveraged-qqq-macd/',
  SSO: 'https://www.brightworkresearch.com/using-letfs-combined-with-the-200-day-moving-average-trading-approach/',
  HW:  'https://bestfolio.app/strategies/tqqq-qqq-band',
  '3PH':'https://www.tradingview.com/script/cbUgg7hl-SPY-200SMA-4-Entry-3-Exit-TQQQ-QLD-GLDM-THREE-PHASE-STRATEGY/',
  CMP: 'https://www.composer.trade/trading-strategies/tqqq-rsi-strategy-Lh0fYfA5RJQmpyfGEORb',
  BH:  'https://www.bogleheads.org/forum/viewtopic.php?t=297591',
  GS:  'https://graniteshares.com/research/the-200-moving-average-strategy-explained/',
  QS:  'https://www.quantifiedstrategies.com/200-day-moving-average-trading-strategy/',
  QC:  'https://www.quantconnect.com/research/15351/leveraged-etfs-with-systematic-risk-management/',
  QP:  'https://quantpedia.com/leveraged-etfs-in-asset-allocation-opportunity-or-trap/',
  'BH·GS': 'https://www.bogleheads.org/forum/viewtopic.php?t=297591',
  'F·BH':  'https://mebfaber.com/wp-content/uploads/2016/05/SSRN-id962461.pdf',
  'ALV·QC':'https://alvarezquanttrading.com/blog/upro-tqqq-leveraged-etf-strategy/',
};

function esc(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// === Card stats: computed at runtime, nothing precomputed ================
// Era metrics AND sparklines are derived from the app's own daily series the
// first time the library opens, so editing a strategy's code — or a data
// refresh — changes its card with no rebuild step. (This replaced hard-coded
// SL_METRICS / SL_CURVES blobs that silently went stale whenever either moved.)
//
// Strategy code here is FIRST-PARTY: it ships in this repo, same trust level as
// the rest of the app's JS, so it runs on the main thread rather than through
// the custom-strategy worker. That sandbox exists to contain code a *user*
// pastes in; pushing ~80 sims through it one postMessage at a time would be
// slower and buy nothing.

const SL_SPARK_START = '1995-01-01';  // left edge of every sparkline
const SL_START_CAPITAL = 10000;       // opening lump sum
const SL_MONTHLY = 1000;              // added at the start of each new month

// Bounds for the four card windows. `null` end → last available bar.
const SL_ERA_BOUNDS = {
  '1980': ['1980-01-01', '2000-03-31'],
  '2000': ['2000-03-31', '2009-03-31'],
  '2009': ['2009-03-31', '2025-12-31'],
  '2026': ['2025-12-31', null],   // shares the 2009-era boundary, like the others
};

let SL_STATS = null;  // { quarters, spy, byN } — built by computeLibraryStats()

function slIdxOnOrAfter(dates, s) {
  for (let i = 0; i < dates.length; i++) if (dates[i] >= s) return i;
  return -1;
}
function slIdxOnOrBefore(dates, s) {
  if (!s) return dates.length - 1;
  for (let i = dates.length - 1; i >= 0; i--) if (dates[i] <= s) return i;
  return -1;
}

// Money-weighted CAGR (IRR) + deepest peak-to-trough dip over a log. Because
// every run takes SL_MONTHLY of new cash each month, a plain end/start rate
// would credit the deposits as growth — so this uses the same IRR the app's
// pills and the overfit explorers report. `total` is profit over everything
// paid in, which is the honest "total return" once contributions exist.
function slCagrDD(res) {
  const log = Array.isArray(res) ? res : (res && res.points);
  if (!log || log.length < 2) return null;
  const v0 = log[0].value, v1 = log[log.length - 1].value;
  if (!(v0 > 0)) return null;
  // A preset's sample points can stop short of the window edge (9sig emits at
  // rebalance dates), so annualise over the WINDOW the app uses, not the log's
  // own span — otherwise `years` and the contribution schedule both drift.
  const startDate = (!Array.isArray(res) && res.startDate) || log[0].date;
  const endDate = (!Array.isArray(res) && res.endDate) || log[log.length - 1].date;
  const yrs = (new Date(endDate) - new Date(startDate)) / (365.25 * 864e5);
  // Match the app: revalue holdings at every daily close when the engine gave
  // us control points; only custom strategies (no control points) fall back to
  // scanning the rebalance-grain series.
  const rows = (typeof daily !== 'undefined' && daily) ? daily : null;
  const mult = !Array.isArray(res) && res.ddMulti;
  const ctrl = !Array.isArray(res) && res.ddControls;
  let dd = null;
  if (mult && mult.length && rows && typeof computeDailyMaxDrawdownMulti === 'function') {
    dd = computeDailyMaxDrawdownMulti(mult, rows).pct;
  } else if (ctrl && ctrl.length && rows && typeof computeDailyMaxDrawdown === 'function') {
    dd = computeDailyMaxDrawdown(ctrl, rows, res.ddKey || 'tqqq').pct;
  }
  if (dd == null) {
    let peak = -Infinity; dd = 0;
    for (const r of log) {
      if (r.value > peak) peak = r.value;
      if (peak > 0) dd = Math.max(dd, 1 - r.value / peak);
    }
  }
  const months = Math.max(0, Math.round(yrs * 12));
  const paidIn = SL_START_CAPITAL + SL_MONTHLY * months;
  let cagr = 0;
  if (yrs > 0 && typeof moneyWeightedCAGR === 'function') {
    cagr = moneyWeightedCAGR(SL_START_CAPITAL, SL_MONTHLY, 0, startDate, endDate, yrs, v1,
      (typeof monthlyData !== 'undefined' ? monthlyData : null), paidIn);
  } else if (yrs > 0) {
    cagr = (Math.pow(v1 / paidIn, 1 / yrs) - 1) * 100;
  }
  return { total: (v1 / paidIn - 1) * 100, cagr, dd: dd * 100, paidIn };
}

// Quarter-end sampling points from SL_SPARK_START to the last bar:
// [{ key: '1995-03', date: <last trading day in that quarter> }]
function slQuarterEnds(dates) {
  const out = [], seen = {};
  const from = slIdxOnOrAfter(dates, SL_SPARK_START);
  if (from < 0) return out;
  for (let i = from; i < dates.length; i++) {
    const d = dates[i];
    // Bucket by quarter, but LABEL with the bucket's actual last trading month.
    // Naming the quarter-end month made the current, incomplete quarter read as
    // a future date (July data showing as 2026-09).
    const q = d.slice(0, 4) + 'Q' + Math.ceil(+d.slice(5, 7) / 3);
    if (!(q in seen)) { seen[q] = out.length; out.push({ key: d.slice(0, 7), date: d }); }
    else { const o = out[seen[q]]; o.date = d; o.key = d.slice(0, 7); }
  }
  return out;
}

// Forward-fill a strategy log onto the quarter grid.
function slCurveFromLog(log, quarters) {
  const out = new Array(quarters.length);
  let li = 0, last = SL_START_CAPITAL;
  for (let q = 0; q < quarters.length; q++) {
    while (li < log.length && log[li].date <= quarters[q].date) { last = log[li].value; li++; }
    out[q] = last;
  }
  return out;
}

// Evaluate a library strategy's code and run it over [si, ei] at its defaults.
function slRunCode(code, data, si, ei) {
  const mod = new Function('"use strict"; return (' + code + '\n);')();
  const p = {
    initial: SL_START_CAPITAL, monthly: SL_MONTHLY, annualRaise: 0,
    startIdx: si, endIdx: ei, entryDate: data.dates[si], exitDate: data.dates[ei],
  };
  for (const sp of (mod.params || [])) {
    let v = sp.default;
    if (v && typeof v === 'object' && 'value' in v) v = v.value;
    p[sp.id] = v;
  }
  const res = mod.run(data, p);
  return Array.isArray(res) ? res : (res && res.log);
}

// --- preset entries (native 9sig / SMA configs) -------------------------
// These carry sidebar control values rather than code, so they run through the
// app's real engines. The opts mapping below mirrors computeConfigSeries() in
// saved-configs.js — keep the two in step when a knob is added.
function slQIdx(dateStr, before) {
  if (typeof quarterlyData === 'undefined' || !quarterlyData) return -1;
  if (before) {
    if (!dateStr) return quarterlyData.length - 1;
    for (let i = quarterlyData.length - 1; i >= 0; i--) if (quarterlyData[i][0] <= dateStr) return i;
    return -1;
  }
  for (let i = 0; i < quarterlyData.length; i++) if (quarterlyData[i][0] >= dateStr) return i;
  return -1;
}

function slRunPreset(preset, si, ei) {
  const p = preset.params || {};
  const g = (id, d) => (id in p ? p[id] : d);
  if (preset.type === '9sig') {
    const cd = +g('select-9sig-crashdrop', 30), sp = +g('select-9sig-spike', 100);
    const dep = g('select-9sig-deploy', '0');
    const opts = {
      qGrowth: (+g('select-9sig-growth', 9)) / 100 || 0.09,
      underlyingCol: ulColFromVal(g('select-9sig-underlying', 'tqqq')),
      crashDropPct: Number.isFinite(cd) ? cd : 30,
      crashLookbackMonths: +g('select-9sig-crashwin', 24) || 24,
      spikeTriggerPct: Number.isFinite(sp) ? sp : 100,
      rebalancePeriod: g('select-9sig-period', 'quarterly') || 'quarterly',
      cashPct: (+g('select-9sig-cash', 40) || 0) / 100,
      contribDeployPct: dep === '1' ? 0.5 : (+dep || 0) / 100,
      targetFromPrevTarget: ['target', '1'].includes(g('select-9sig-target-compound', 'holding')),
      parkAsset: g('select-9sig-park-asset', 'cash') || 'cash',
      buyThrottlePct: +g('select-9sig-buypower', 90) || 90,
      spikeResetPct: g('select-9sig-spike-target', 'auto') || 'auto',
      tradeCostPct: +g('select-9sig-cost', 0) || 0,
    };
    const rp = +g('select-9sig-rebalance-point', 0) || 0;
    if (rp > 0 && typeof buildEnvelopeQData === 'function' && typeof PERIOD_DAYS !== 'undefined') {
      const off = Math.round(rp / 100 * ((PERIOD_DAYS[opts.rebalancePeriod] || 63) - 1));
      const q = buildEnvelopeQData(opts.rebalancePeriod, off, quarterlyData[si] && quarterlyData[si][0], quarterlyData[ei] && quarterlyData[ei][0]);
      if (q && q.length >= 2) opts.qData = q;
    }
    opts.sampleQuarterly = (opts.rebalancePeriod === 'yearly');
    const r = simulate(SL_START_CAPITAL, SL_MONTHLY, (+g('select-9sig-cashrate', 4) || 0) / 100, si, ei, 0, opts);
    const rows = (r.samplePoints && r.samplePoints.length) ? r.samplePoints : (r.log || []);
    const UL_KEY = { 1: 'tqqq', 2: 'qqq', 3: 'spy', 4: 'qld', 5: 'sso', 6: 'spxl' };
    return {
      points: rows.map(l => ({ date: l.date, value: l.total != null ? l.total : l.value })),
      ddControls: (r.log || []).map(l => ({ date: l.date, shares: l.price > 0 ? l.tqqqVal / l.price : 0, cash: l.cash })),
      ddKey: UL_KEY[opts.underlyingCol] || 'tqqq',
      startDate: quarterlyData[si] && quarterlyData[si][0],
      endDate: quarterlyData[ei] && quarterlyData[ei][0],
    };
  }
  if (preset.type === 'sma') {
    const opts = {
      smaAsset: g('select-sma-asset', 'qqq') || 'qqq',
      smaWindow: +g('select-sma-window', 200) || 200,
      underlyingCol: ulColFromVal(g('select-sma-underlying', 'tqqq')),
      entryBufferPct: +g('select-sma-entry-buf', 0) || 0,
      exitBufferPct: +g('select-sma-exit-buf', 0) || 0,
      rsiOverheatThreshold: +g('select-sma-rsi-oh', 0) || 0,
      rsiCoolThreshold: +g('select-sma-rsi-cool', 0) || 0,
      outAsset: g('select-sma-out-asset', 'cash') || 'cash',
      dcaInMonths: +g('select-sma-dca-in', 0) || 0,
      dcaToOutMonths: +g('select-sma-dca-to-out', 0) || 0,
      bgGtfoPct: +g('select-sma-bg-gtfo', 0) || 0,
      bgAsset: g('select-sma-bg-asset', 'qqq') || 'qqq',
      bgWindow: +g('select-sma-bg-window', 0) || 0,
      tradeCostPct: +g('select-sma-cost', 0) || 0,
      rsiOhWindow: +g('select-sma-rsi-oh-window', 10) || 10,
      rsiCoolWindow: +g('select-sma-rsi-cool-window', 10) || 10,
      rebalanceCheck: 'daily',
      confirmBuySteps: +g('select-sma-confirm-buy', 0) || 0,
      confirmSellSteps: +g('select-sma-confirm-sell', 0) || 0,
      settleDays: +g('select-sma-settle', 0) || 0,
      emitDD: true,
    };
    const r = simulateSMA(SL_START_CAPITAL, SL_MONTHLY, (+g('select-sma-cashrate', 4) || 0) / 100, si, ei, 0, opts);
    return {
      points: (r.smaPoints || []).map(pt => ({ date: pt.date, value: pt.value })),
      ddMulti: r.ddControls || null,
      startDate: quarterlyData[si] && quarterlyData[si][0],
      endDate: quarterlyData[ei] && quarterlyData[ei][0],
    };
  }
  return null;
}

// An entry is runnable if it has code OR a native preset.
function strategyRunnable(s) { return !!(s.preset || strategyHasCode(s.n)); }

// Buy & hold baseline (SPY, same lump sum) on the quarter grid.
// Buys SL_MONTHLY of SPY at the first close of each new month, so the baseline
// is fed on the same schedule as the strategies it is drawn against.
function slBuyHoldCurve(prices, dates, quarters) {
  const si = slIdxOnOrAfter(dates, SL_SPARK_START);
  const out = new Array(quarters.length);
  if (si < 0 || !(prices[si] > 0)) return out.fill(SL_START_CAPITAL);
  let shares = SL_START_CAPITAL / prices[si];
  let month = dates[si].slice(0, 7);
  let di = si;
  for (let q = 0; q < quarters.length; q++) {
    while (di < dates.length - 1 && dates[di] < quarters[q].date) {
      di++;
      const m = dates[di].slice(0, 7);
      if (m !== month) {
        month = m;
        if (prices[di] > 0) shares += SL_MONTHLY / prices[di];
      }
    }
    out[q] = shares * prices[di];
  }
  return out;
}

// Run every coded strategy once per era plus once for the sparkline. Cached
// until slInvalidateStats(). A strategy that throws is isolated: its card
// degrades to "—" instead of taking the whole library down.
// Base scaffolding only — quarter grid + SPY baseline. Cheap, runs once.
function computeLibraryStats() {
  if (SL_STATS) return SL_STATS;
  if (typeof buildCustomData !== 'function') return null;
  const data = buildCustomData();
  if (!data || !data.dates || !data.dates.length) return null;
  const dates = data.dates;
  const quarters = slQuarterEnds(dates);
  SL_STATS = { quarters, spy: slBuyHoldCurve(data.spy, dates, quarters), byN: {}, data, dates };
  return SL_STATS;
}

// Simulate ONE strategy and memoize it. Called per rendered card, so a page of
// 8 costs 8 strategies instead of all 39 — the sims are the expensive part.
function slStatsFor(n) {
  const st = computeLibraryStats();
  if (!st) return null;
  if (n in st.byN) return st.byN[n];
  const s = STRATEGY_LIBRARY.find(x => x.n === n);
  if (!s) return null;
  const code = strategyHasCode(n);
  if (!code && !s.preset) return (st.byN[n] = null);
  const { data, dates, quarters } = st;
  const sparkEi = dates.length - 1;
  // Code entries index the daily series; presets index quarterlyData.
  const run = code
    ? (from, to) => slRunCode(code, data, slIdxOnOrAfter(dates, from), to === null ? sparkEi : slIdxOnOrBefore(dates, to))
    : (from, to) => slRunPreset(s.preset, slQIdx(from, false), slQIdx(to, true));
  try {
    const metrics = {};
    for (const era of STRATEGY_ERAS) {
      const b = SL_ERA_BOUNDS[era.key];
      if (!b) continue;
      const m = slCagrDD(run(b[0], b[1]));
      if (m) metrics[era.key] = { cagr: m.cagr, dd: m.dd };
    }
    const sp = run(SL_SPARK_START, null);
    st.byN[n] = { metrics, curve: slCurveFromLog((Array.isArray(sp) ? sp : (sp && sp.points)) || [], quarters) };
  } catch (e) {
    console.warn('Strategy library: #' + n + ' failed to run —', (e && e.message) || e);
    st.byN[n] = { metrics: {}, curve: null };
  }
  return st.byN[n];
}

// Drop the cache so the next open recomputes (data refresh, edited code).
function slInvalidateStats() { SL_STATS = null; _strategyLibraryBuilt = false; _slPage = 1; }


// Four contiguous windows, cut at the two turning points that matter for a
// leveraged fund: the dot-com peak (2000 Q1) and the GFC bottom (2009 Q1). So
// era 2 is peak-to-trough and era 3 is trough-to-now — the best and worst cases
// a 3× product can hand you, rather than an average that hides both.
//
// Every window reports the same metric — money-weighted CAGR — so the row reads
// consistently. The 2026 stub is under a year, so its annualised rate swings
// hard on small moves; that is what an annual rate means, and it matches what
// the app's own strategy pills show for the same span.
const STRATEGY_ERAS = [
  { key: '1980', label: '1980–2000 Q1', sub: 'pre-bubble run-up' },
  { key: '2000', label: '2000 Q1–2009 Q1', sub: 'dot-com peak → GFC bottom' },
  { key: '2009', label: '2009 Q1–2025 Q4', sub: 'post-GFC bull' },
  { key: '2026', label: '2026–today', sub: 'year to date' },
];

// Adding a library strategy to the chart: renders the "+ Add" buttons and
// enables the #add-<n> deep-link. Flip to false to hide both again.
const SL_ADD_ENABLED = true;

// Which strategies have verified runnable custom-strategy code (window.STRATEGY_CODE).
function strategyHasCode(n) {
  return typeof window !== 'undefined' && window.STRATEGY_CODE && window.STRATEGY_CODE[n];
}

function fmtPct(v) {
  if (v == null || !isFinite(v)) return '—';
  return (v > 0 ? '+' : '') + v.toFixed(1) + '%';
}

// One row per measure, one column per window, with a labelled first column.
function eraTableHtml(m) {
  const tipFor = (era, cell) => {
    if (!cell) return era.label + (era.sub ? ' · ' + era.sub : '');
    const kind = 'annualised return (money-weighted CAGR)';
    return `${era.label}${era.sub ? ' · ' + era.sub : ''}\n${fmtPct(cell.cagr)} ${kind}\n−${Math.round(cell.dd)}% deepest drawdown inside the window`;
  };
  const dateCells = STRATEGY_ERAS.map(era =>
    `<td title="${esc(tipFor(era, m && m[era.key]))}">${era.label}</td>`).join('');
  const cagrCells = STRATEGY_ERAS.map(era => {
    const c = m && m[era.key];
    if (!c) return '<td class="sl-era-na">—</td>';
    return `<td class="sl-era-cagr ${c.cagr >= 0 ? 'pos' : 'neg'}">${fmtPct(c.cagr)}</td>`;
  }).join('');
  const ddCells = STRATEGY_ERAS.map(era => {
    const c = m && m[era.key];
    return c ? `<td class="sl-era-dd">−${Math.round(c.dd)}%</td>` : '<td class="sl-era-dd">—</td>';
  }).join('');
  return `<table class="sl-era-table">
    <tr class="sl-row-date"><th scope="row">date</th>${dateCells}</tr>
    <tr class="sl-row-cagr"><th scope="row">cagr</th>${cagrCells}</tr>
    <tr class="sl-row-dd"><th scope="row">max drawdown</th>${ddCells}</tr>
  </table>`;
}

// Compact money: $10k, $257k, $22M, $1.3B.
function fmtMoney(v) {
  if (!(v > 0)) return '—';
  if (v >= 1e9) return '$' + (v / 1e9).toFixed(v >= 1e10 ? 0 : 1) + 'B';
  if (v >= 1e6) return '$' + (v / 1e6).toFixed(v >= 1e7 ? 0 : 1) + 'M';
  if (v >= 1e3) return '$' + Math.round(v / 1e3) + 'k';
  return '$' + Math.round(v);
}

// Four evenly-spaced year labels under a sparkline, derived from the actual
// quarter grid so they track the data instead of being pinned to 1995–2025.
function slYearTicks() {
  const q = (SL_STATS && SL_STATS.quarters) || [];
  if (!q.length) return [];
  return [0, 1, 2, 3].map(i => q[Math.round((i / 3) * (q.length - 1))].key.slice(0, 4));
}

// Log-scaled SVG sparkline: SPY (muted) vs this strategy over the full computed
// span, with the start value (at the line's origin) and end values (at each
// line's tip) drawn inside the graph.
function sparklineHtml(n) {
  const st = slStatsFor(n);
  const curve = st && st.curve, spy = SL_STATS && SL_STATS.spy;
  if (!curve || !spy || !spy.length) return '<div class="sl-spark sl-spark-empty">no data series</div>';
  const W = 300, H = 120, PAD = 3;
  const both = curve.concat(spy).filter(v => v > 0);
  const lo = Math.log10(Math.min.apply(null, both)), hi = Math.log10(Math.max.apply(null, both));
  const span = (hi - lo) || 1, N = curve.length;
  const yAt = (v) => v > 0 ? H - PAD - ((Math.log10(v) - lo) / span) * (H - 2 * PAD) : H - PAD;
  const yPct = (v) => Math.max(6, Math.min(82, (yAt(v) / H) * 100)); // keep value labels clear of the year row
  const path = (arr) => arr.map((v, i) => {
    const x = PAD + (i / (N - 1)) * (W - 2 * PAD);
    return (i ? 'L' : 'M') + x.toFixed(1) + ' ' + yAt(v).toFixed(1);
  }).join(' ');
  // Decade gridlines (powers of 10) make the log scale visible.
  let grid = '';
  for (let p = Math.ceil(lo); p <= Math.floor(hi); p++) {
    const y = yAt(Math.pow(10, p)).toFixed(1);
    grid += `<line x1="0" y1="${y}" x2="${W}" y2="${y}" class="sl-grid"/>`;
  }
  const start = 10000; // lump-sum starter balance
  return `<div class="sl-spark" data-sl-n="${n}">
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Strategy vs SPY, log scale 1995–2025">
      ${grid}
      <path d="${path(spy)}" class="sl-spark-spy" fill="none"/>
      <path d="${path(curve)}" class="sl-spark-strat" fill="none"/>
    </svg>
    <span class="sl-logtag">log ⬍</span>
    <span class="sl-lbl sl-lbl-start" style="top:${yPct(start).toFixed(0)}%">${fmtMoney(start)}</span>
    <span class="sl-lbl sl-lbl-strat" style="top:${yPct(curve[N - 1]).toFixed(0)}%">${fmtMoney(curve[N - 1])}</span>
    <span class="sl-lbl sl-lbl-spy" style="top:${yPct(spy[spy.length - 1]).toFixed(0)}%">${fmtMoney(spy[spy.length - 1])}</span>
    <span class="sl-years">${slYearTicks().map(y => `<b>${y}</b>`).join('')}</span>
    <span class="sl-cross"></span>
    <span class="sl-dot sl-dot-spy"></span>
    <span class="sl-dot sl-dot-strat"></span>
  </div>`;
}

// Turn a run-on rules string into one labelled clause per line. The source is
// written as "Signal: … . Enter: … . Freq: …", which reads as a wall of text in
// a tooltip; splitting on the "Label:" boundaries makes it scannable.
function slFormatRules(text) {
  const t = String(text || '').trim();
  if (!t) return '';
  const re = /(^|[\s.;])([A-Z][A-Za-z0-9 +/&-]{0,20}):\s/g;
  const cuts = [];
  let m;
  while ((m = re.exec(t))) cuts.push({ at: m.index + m[1].length, label: m[2] });
  if (!cuts.length) return t;
  const rows = [];
  const lead = t.slice(0, cuts[0].at).trim().replace(/[.;]$/, '');
  if (lead) rows.push(lead);
  for (let i = 0; i < cuts.length; i++) {
    const from = cuts[i].at + cuts[i].label.length + 1;
    const to = i + 1 < cuts.length ? cuts[i + 1].at : t.length;
    const body = t.slice(from, to).trim().replace(/[.;]\s*$/, '');
    if (body) rows.push(cuts[i].label + ': ' + body);
  }
  return rows.join('\n');
}

// Full detail for a card's ⓘ. Newlines become &#10; so the shared
// .info-icon[data-tip] tooltip (white-space: pre-line) renders them as breaks.
function slInfoTip(s) {
  const parts = [s.name, '', slFormatRules(s.rules)];
  if (s.needs) parts.push('', 'Needs data this app does not carry: ' + s.needs);
  if (s.reported && s.reported !== '\u2014') parts.push('', 'Source note: ' + s.reported);
  return esc(parts.join('\n')).replace(/\n/g, '&#10;');
}

function buildStrategyCards(list) {
  return (list || STRATEGY_LIBRARY).map(s => {
    // Hand-picked entries have no published write-up behind them, so they carry
    // no `src` — render the title as plain text rather than a link to nowhere.
    const link = STRATEGY_SRC_LINKS[s.src];
    const st = slStatsFor(s.n);
    const m = st && st.metrics;
    const has = strategyRunnable(s);
    let add = '';
    if (has && SL_ADD_ENABLED) add = `<button type="button" class="sl-add" data-sl-add="${s.n}"><span class="sl-add-ico" aria-hidden="true">▸</span> Try</button>`;
    else if (!has && s.needs) add = `<span class="sl-add-na" title="Needs data this app doesn't carry">needs ${esc(s.needs)}</span>`;
    else if (!has) add = `<span class="sl-add-na">soon</span>`;
    const eras = eraTableHtml(m);
    // data-sl-search: everything the search box matches against.
    const hay = esc([s.name, s.tag, s.needs, s.rules].filter(Boolean).join(' ').toLowerCase());
    return `<div class="sl-card${has ? '' : ' sl-card-off'}" data-sl-search="${hay}">
      <div class="sl-card-head">
        ${link
          ? `<a class="sl-card-name" href="${link}" target="_blank" rel="noopener" title="${esc(s.rules)}">${esc(s.name)}</a>`
          : `<span class="sl-card-name" title="${esc(s.rules)}">${esc(s.name)}</span>`}
        ${add}
        <span class="info-icon sl-info" tabindex="0" data-tip-wide data-tip="${slInfoTip(s)}">\u24d8</span>
      </div>
      ${has ? sparklineHtml(s.n) : '<div class="sl-spark sl-spark-empty">no data series</div>'}
      ${eras}
    </div>`;
  }).join('');
}

// Add a library strategy to the chart as a real custom strategy (type:'custom',
// carrying the verified code). Reuses the existing custom-strategy engine — the
// line computes in the worker exactly like a user-pasted custom strategy.
function addStrategyFromLibrary(n) {
  if (!SL_ADD_ENABLED) return; // disabled for now
  const entry = STRATEGY_LIBRARY.find(s => s.n === n);
  const code = strategyHasCode(n);
  if (!entry || (!code && !entry.preset)) return;
  if (typeof savedConfigs === 'undefined' || typeof persistSavedConfigs !== 'function') return;
  const name = (typeof uniqueName === 'function') ? uniqueName(entry.name) : entry.name;
  // A preset becomes a NATIVE 9sig/SMA config (real engine, real sidebar knobs,
  // shareable); everything else becomes a custom config carrying its code.
  const cfg = {
    id: 'cfg_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    type: entry.preset ? entry.preset.type : 'custom',
    name: name,
    desc: entry.rules,
    params: entry.preset ? Object.assign({}, entry.preset.params) : {},
    color: (typeof nextConfigColor === 'function') ? nextConfigColor() : '#e879f9',
    hidden: false,
  };
  if (!entry.preset) cfg.code = code;
  savedConfigs.push(cfg);
  // Push a preset's values INTO the sidebar controls before it becomes the
  // edited config — otherwise the sidebar's current values sync back over
  // cfg.params and the strategy silently reverts to defaults.
  if (entry.preset && typeof applyParams === 'function') applyParams(cfg.type, cfg.params);
  window._editingConfigId = cfg.id;
  persistSavedConfigs();
  if (typeof renderSavedConfigPills === 'function') renderSavedConfigPills();
  if (typeof render === 'function') render();
  closeStrategyLibrary();                // ensure the new line is visible
  if (typeof flashSaveSuccess === 'function') flashSaveSuccess(cfg.id);
}

let _strategyLibraryBuilt = false;
const SL_PAGE_SIZE = 8;   // cards per page — each one costs a full set of sims
let _slPage = 1, _slQuery = '';
function buildStrategyLibrary() {
  if (_strategyLibraryBuilt) return;
  const body = document.getElementById('strategy-library-body');
  if (!body) return;
  computeLibraryStats();   // quarter grid + SPY baseline only; sims are per-card
  const ready = STRATEGY_LIBRARY.filter(strategyRunnable).length;
  const span = SL_STATS && SL_STATS.quarters.length
    ? SL_STATS.quarters[0].key.slice(0, 4) + '–' + SL_STATS.quarters[SL_STATS.quarters.length - 1].key.slice(0, 4)
    : '';
  body.innerHTML = `
    <div class="sl-wip">⚠ Work in progress. These are my own reimplementations from public write-ups, backtested on synthetic data with a $10k opening balance plus $1,000/month, and zero taxes. Real-world results would be worse: taxes and slippage eat the high-churn ones alive, and every 3× line here still lived through an 80–97% drawdown somewhere. Rough comparisons only — the numbers will change as I fix bugs and add the missing strategies.</div>
    <div class="sl-intro">
      <span class="sl-legend"><i class="sl-leg-strat"></i>strategy <i class="sl-leg-spy"></i>SPY · log · ${span}</span>
      <span class="sl-intro-note">${ready}/${STRATEGY_LIBRARY.length} backtested · hover a name for rules</span>
    </div>
    <input id="sl-search" class="sl-search" type="search" autocomplete="off" spellcheck="false"
           placeholder="Search strategies — name, tag, or rule text…" aria-label="Search strategies">
    <div class="sl-noresults" hidden>No strategy matches that.</div>
    <div class="sl-cards"></div>
    <div class="sl-pager"></div>`;
  body.onclick = (e) => {
    const add = e.target.closest('[data-sl-add]');
    if (add) { addStrategyFromLibrary(+add.getAttribute('data-sl-add')); return; }
    const pg = e.target.closest('[data-sl-page]');
    if (pg) { _slPage = +pg.getAttribute('data-sl-page'); renderLibraryPage(body); }
  };
  setupSparkTooltip(body);
  setupLibrarySearch(body);
  renderLibraryPage(body);
  _strategyLibraryBuilt = true;
}

// Entries matching the current query. Text-only, so filtering costs no sims.
function slFilteredEntries() {
  const terms = (_slQuery || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return STRATEGY_LIBRARY.slice();
  return STRATEGY_LIBRARY.filter(s => {
    const hay = [s.name, s.tag, s.needs, s.rules].filter(Boolean).join(' ').toLowerCase();
    return terms.every(t => hay.includes(t));
  });
}

// Render just the current page. Each card pulls its own stats, so only the
// strategies actually on screen get simulated.
function renderLibraryPage(body) {
  body = body || document.getElementById('strategy-library-body');
  if (!body) return;
  const list = slFilteredEntries();
  const pages = Math.max(1, Math.ceil(list.length / SL_PAGE_SIZE));
  if (_slPage > pages) _slPage = pages;
  if (_slPage < 1) _slPage = 1;
  const from = (_slPage - 1) * SL_PAGE_SIZE;
  const slice = list.slice(from, from + SL_PAGE_SIZE);
  const cards = body.querySelector('.sl-cards');
  const empty = body.querySelector('.sl-noresults');
  const pager = body.querySelector('.sl-pager');
  if (cards) cards.innerHTML = buildStrategyCards(slice);
  if (empty) empty.hidden = list.length > 0;
  if (pager) pager.innerHTML = slPagerHtml(list.length, pages, from, slice.length);
  if (cards) cards.scrollIntoView({ block: 'nearest' });
}

function slPagerHtml(total, pages, from, shown) {
  if (!total) return '';
  const btn = (page, label, disabled, current) =>
    `<button type="button" class="sl-page${current ? ' on' : ''}" data-sl-page="${page}"${disabled ? ' disabled' : ''}>${label}</button>`;
  let nums = '';
  for (let i = 1; i <= pages; i++) nums += btn(i, i, false, i === _slPage);
  return `<span class="sl-page-info">${from + 1}–${from + shown} of ${total}</span>
    <span class="sl-page-btns">
      ${btn(_slPage - 1, '‹', _slPage <= 1, false)}${nums}${btn(_slPage + 1, '›', _slPage >= pages, false)}
    </span>`;
}

function setupLibrarySearch(body) {
  const input = body.querySelector('#sl-search');
  if (!input) return;
  const apply = () => { _slQuery = input.value; _slPage = 1; renderLibraryPage(body); };
  input.addEventListener('input', apply);
  // Esc clears rather than closing the modal out from under a half-typed query.
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && input.value) { e.stopPropagation(); input.value = ''; apply(); }
  });
}

// Hover tooltip over any sparkline: shows the year + strategy $ + SPY $ at the
// hovered point, plus a vertical crosshair.
function setupSparkTooltip(body) {
  let tip = document.getElementById('sl-tooltip');
  if (!tip) {
    tip = document.createElement('div');
    tip.id = 'sl-tooltip';
    tip.className = 'sl-tooltip';
    tip.hidden = true;
    document.body.appendChild(tip);
  }
  const W = 300, H = 120, PAD = 3;
  let active = null;
  const hideMarks = (spark) => {
    if (!spark) return;
    spark.querySelectorAll('.sl-cross, .sl-dot').forEach(el => el.style.display = 'none');
  };
  body.addEventListener('mousemove', (e) => {
    const spark = e.target.closest('.sl-spark[data-sl-n]');
    if (!spark) { tip.hidden = true; hideMarks(active); active = null; return; }
    if (active && active !== spark) hideMarks(active);
    active = spark;
    const n = spark.getAttribute('data-sl-n');
    const stt = slStatsFor(+n);
    const curve = stt && stt.curve, spy = SL_STATS && SL_STATS.spy;
    const ds = (SL_STATS ? SL_STATS.quarters : []).map(q => q.key);
    if (!curve || !spy) { tip.hidden = true; return; }
    const rect = spark.getBoundingClientRect();
    const N = curve.length;
    const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const idx = Math.round(frac * (N - 1));
    // Recompute the per-card log scale to place the marker exactly on the lines.
    const both = curve.concat(spy).filter(v => v > 0);
    const lo = Math.log10(Math.min.apply(null, both)), hi = Math.log10(Math.max.apply(null, both));
    const span = (hi - lo) || 1;
    const xView = PAD + (idx / (N - 1)) * (W - 2 * PAD);
    const xPx = (xView / W) * rect.width;
    const yPxOf = (v) => v > 0 ? ((H - PAD - ((Math.log10(v) - lo) / span) * (H - 2 * PAD)) / H) * rect.height : rect.height;
    const cross = spark.querySelector('.sl-cross');
    const dS = spark.querySelector('.sl-dot-strat'), dY = spark.querySelector('.sl-dot-spy');
    if (cross) { cross.style.left = xPx + 'px'; cross.style.display = 'block'; }
    if (dS) { dS.style.left = xPx + 'px'; dS.style.top = yPxOf(curve[idx]) + 'px'; dS.style.display = 'block'; }
    if (dY) { dY.style.left = xPx + 'px'; dY.style.top = yPxOf(spy[idx]) + 'px'; dY.style.display = 'block'; }
    const yr = (ds[idx] || '').replace('-', '·');
    const sv = curve[idx], pv = spy[idx], mx = Math.max(sv, pv, 1);
    const ws = Math.max(2, (sv / mx) * 100).toFixed(1), wp = Math.max(2, (pv / mx) * 100).toFixed(1);
    tip.innerHTML = `<div class="sl-tt-yr">${yr}<span class="sl-tt-mult">${pv > 0 ? (sv / pv).toFixed(sv / pv >= 10 ? 0 : 1) + '×' : ''}</span></div>
      <div class="sl-tt-row"><span class="sl-tt-track"><i class="sl-tt-fill-strat" style="width:${ws}%"></i></span><span class="sl-tt-strat">${fmtMoney(sv)}</span></div>
      <div class="sl-tt-row"><span class="sl-tt-track"><i class="sl-tt-fill-spy" style="width:${wp}%"></i></span><span class="sl-tt-spy">SPY ${fmtMoney(pv)}</span></div>`;
    tip.hidden = false;
    const tw = tip.offsetWidth;
    let left = e.clientX + 12;
    if (left + tw > window.innerWidth - 8) left = e.clientX - tw - 12;
    tip.style.left = left + 'px';
    tip.style.top = (e.clientY - 34) + 'px';
  });
  body.addEventListener('mouseleave', () => { tip.hidden = true; hideMarks(active); active = null; });
}

function openStrategyLibrary() {
  const modal = document.getElementById('strategy-library-modal');
  if (!modal) return;
  buildStrategyLibrary();
  modal.removeAttribute('hidden');
  document.body.classList.add('modal-open');
}
function closeStrategyLibrary() {
  const modal = document.getElementById('strategy-library-modal');
  if (!modal) return;
  modal.setAttribute('hidden', '');
  document.body.classList.remove('modal-open');
}
function toggleStrategyLibrary() {
  const modal = document.getElementById('strategy-library-modal');
  if (!modal) return;
  if (modal.hasAttribute('hidden')) openStrategyLibrary(); else closeStrategyLibrary();
}

// Close on Escape (matches the analytics modal's affordances).
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const modal = document.getElementById('strategy-library-modal');
    if (modal && !modal.hasAttribute('hidden')) toggleStrategyLibrary();
  }
});

// Deep-links: #library opens the catalog; #add-<n> drops strategy n straight
// onto the chart (shareable "try this strategy" link).
if (typeof window !== 'undefined' && window.location) {
  const hash = window.location.hash;
  if (hash === '#library') {
    document.addEventListener('DOMContentLoaded', () => toggleStrategyLibrary());
  } else if (/^#add-\d+$/.test(hash)) {
    const n = +hash.slice(5);
    // Wait for the app's async price data to finish loading before adding, so
    // the custom worker computes against a populated dataset.
    const tryAdd = () => {
      if (typeof daily !== 'undefined' && daily && daily.length) addStrategyFromLibrary(n);
      else setTimeout(tryAdd, 200);
    };
    document.addEventListener('DOMContentLoaded', () => setTimeout(tryAdd, 200));
  }
}
