// Strategy Library — a catalog of the best-known LETF timing / rotation
// strategies plus hand-picked ones (tag 'picked'), shown in a modal table.
// Entries with code in window.STRATEGY_CODE get a "+ Add" button that drops
// them onto the chart as a real custom strategy (see addStrategyFromLibrary).
//
// `here` = CAGR / maxDD computed from THIS app's own daily TSVs over the TQQQ
// era (2010-02-11 → 2026-07-10), apples-to-apples — see research/backtest_strategies.py.
// `reported` = the source's self-reported figure over ITS OWN period (shown in
// parentheses); not comparable across rows.
// `formerNames` = what an entry was called before it was renamed. A saved copy
// still wearing one of them takes the current name at load
// (js/saved-configs.js's refreshedLibraryName); a name the user typed stays.
const STRATEGY_LIBRARY = [
  // --- the app's own canonical base strategies (tag 'app'), listed first so
  // the two engines behind the sidebar panels are one Try away. Presets, not
  // code: Try spawns a NATIVE 9sig/SMA config with every knob editable. ---
  { n: 42, name: '9sig', tag: 'app', runnable: true,
    rules: 'Jason Kelly\u2019s 9-Sig adapted to TQQQ: hold TQQQ + a 40% cash buffer; each quarter compare the TQQQ holding against a signal line growing 9%/quarter \u2014 above it, sell the excess into cash; below it, buy the shortfall from cash (buying throttled to 90% of the cash pile). A \u201430% crash rule (vs the 2-year peak) pauses selling, and a +100%/quarter spike resets the target to a 60% stock weight. The app\u2019s canonical defaults \u2014 the same engine and settings as the 9sig sidebar panel.',
    here: '\u2014', reported: 'The app\u2019s own base strategy; numbers are this app\u2019s backtest at canonical defaults' },
  { n: 43, name: 'SMA 200', tag: 'app', runnable: true,
    rules: 'The app\u2019s canonical trend rule: hold TQQQ while QQQ closes above its 200-day moving average, park in cash (earning interest) when it closes below \u2014 checked daily, no buffers, with an RSI(9)>90 overheat exit, an RSI(7)<80 cool-gate re-entry, T+1 settlement and 15-day ease-ins. Same engine and settings as the SMA sidebar panel.',
    here: '\u2014', reported: 'The app\u2019s own base strategy; numbers are this app\u2019s backtest at canonical defaults' },
  { n: 1, name: 'Faber 10-month timing', formerNames: ['Faber 10-month / 200-day Timing Model'], tag: 'foundation', runnable: true,
    rules: 'Signal: QQQ vs its 530-day median, read on the month’s last trading day. Enter: above → TQQQ. Exit: below → cash. Freq: monthly.',
    here: '31.3% / −69.9%', reported: '10.2% vs 9.3% B&H (S&P 1901–2012) · defaults fitted to 2010–2025 and rounded: 42.1% a year, max drawdown 70%, 3 trades (published settings: 31.8%, 70%)', src: 'F' },
  { n: 2, name: 'Gayed & Bilello LRS 3×', formerNames: ['Gayed & Bilello LRS 3× — Leverage for the Long Run'], tag: 'academic', runnable: true,
    rules: 'Signal: SPY vs its 297-day average. Enter: above → SPXL (3× S&P). Exit: below → cash. Freq: daily.',
    here: '≈ #10', reported: '26.8% CAGR · −92.2% DD · Sharpe 0.47 (1928–2015) · defaults from your pick on the map of 2010–2025 (26 November 2026), 297 days: 23.9% a year, max drawdown 54% (295 days, the rounded fit before: 23.2%, 54%; published settings: 21.7%, 52%)', src: 'GB' },
  { n: 3, name: 'Gayed & Bilello LRS 2×', tag: 'academic', runnable: true,
    rules: 'Signal: SPY vs its 297-day average. Enter: above → SSO (2× S&P). Exit: below → cash. Freq: daily.',
    here: '≈ SSO rows', reported: '19.1% CAGR · −78.7% DD · Sharpe 0.51 (1928–2015) · defaults from your pick on the map of 2010–2025 (26 November 2026), 297 days: 17.8% a year, max drawdown 39% (295 days, the rounded fit before: 17.3%, 39%; published settings: 16.0%, 37%)', src: 'GB' },
  { n: 5, name: 'HedgeFundie 55/45 UPRO/TMF', formerNames: ["HedgeFundie's Excellent Adventure (55/45 UPRO/TMF)"], tag: 'portfolio', runnable: false, needs: 'TMF',
    rules: 'Static: 55% UPRO (3× S&P) + 45% TMF (3× long Treasury), quarterly rebalance. Optional 200-SMA overlay on the UPRO leg. Freq: quarterly.',
    here: '—', reported: 'Famous Bogleheads portfolio; 2022 exposed both-legs-down risk', src: 'BH' },
  { n: 6, name: 'Alvarez composite', formerNames: ['Alvarez UPRO/TQQQ composite'], tag: 'composite', runnable: false, needs: 'VIX',
    rules: 'Monthly. Gates: VIX≤25 · S&P>200-day MA · VWO mom>0 · BND mom>0. All true → 50% UPRO+50% TQQQ. 1–2 false → 50% QQQ+50% SPY. 3–4 false → 100% TLT.',
    here: '—', reported: '24.4% CAR · −54% DD (2010–2023)', src: 'ALV' },
  { n: 7, name: 'Bare dual momentum', formerNames: ['Antonacci dual momentum', 'Antonacci Dual Momentum → LETF sleeve (GEM)'], tag: 'momentum', runnable: true,
    rules: 'Each month end, pick the stronger of SPY and QQQ over 399 trading days. Enter: it beat T-bills → SPY if SPY led, QLD if QQQ led. Exit: it did not → SOXL. Switch: sell today, buy tomorrow. Freq: monthly.',
    here: '—', reported: 'Widely-cited momentum framework; LETF amplifies premium + whipsaw · T-bills here are the cash interest setting · defaults from your pick on the map of 2010–2025 (26 November 2026), 399 days with QLD when QQQ leads and SOXL when out: 41.5% a year, max drawdown 52% (the rounded fit before, 430 days with TQQQ and GLD: 41.5%, 70%; published settings: 30.1%, 76%) · the gain is SOXL’s: with GLD when out 23.6%, with cash 21.3% · 398 days 34.5% (63%), 400 days 37.5% (55%) · 2026 to 25 November −3% (before −40%) · 1994–2009 on the reconstructed prices −16.1% a year (before 1.5%)', src: 'QP' },
  { n: 8, name: 'Siegel 200-day ±1% band', tag: 'origin', runnable: true,
    rules: 'Signal: SPY vs its 166-day average with a ±3.2% band. Enter: SPY closes 3.2% above → TQQQ. Exit: SPY closes 3.2% below → cash. Freq: daily.',
    here: '—', reported: 'Origin of the whipsaw-buffer idea (DJIA 1886–2006) · defaults from your pick on the map of 2010–2025 (27 November 2026): a 3.2% band around the 166-day average (the rounded fit before, 3.5% and 145 days: 38.8% a year, max drawdown 57%, at the cost and interest below; published settings: 27.8%, 66%) · one step either way: a 3.1% band 36.2% (62%), 3.3% 38.1% (47%), 167 days 38.3% (47%)', src: 'F' },
  { n: 10, name: 'Bare trend line', formerNames: ['QQQ 200-day → TQQQ', 'QQQ 200-day → TQQQ (matched index, cash park)'], tag: 'app', runnable: true,
    rules: 'Signal: SOXX vs its 280-day average → trade TQQQ. Enter: above → TQQQ. Exit: below → cash. Freq: daily.',
    here: '32.8% / −55.9%', reported: "The app's canonical SMA config · defaults from your pick on the map of 2010–2025 (27 November 2026): SOXX against its 280-day average (the rounded fit before, QQQ against its 160-day median: 37.5% a year, max drawdown 55%, at the cost and interest below; published settings: 30.2%, 56%) · 270 days 43.2% (57%), 290 days 41.5% (66%), the median in place of the average 35.9% (78%), QQQ in SOXX's place 24.6% (66%)", src: 'F·BH' },
  { n: 12, name: 'SSO/SHY 200-day rotation', formerNames: ['SSO/SHY 200-day own-price rotation (2×)'], tag: 'app', runnable: true,
    rules: 'Signal: SSO\'s own price vs its 30-day median. Enter: above → SSO. Exit: below → cash. Freq: daily.',
    here: '14.9% / −42.2%', reported: 'Sharpe 0.555 vs 0.524 B&H SPY (5-yr) · defaults from your pick on the map of 2010–2025 (27 November 2026): SSO against its own 30-day median, 401 trades in 16 years (the rounded fit before, a 400-day average: 15.9% a year, max drawdown 40%, at the cost and interest below; published settings: 14.1%, 42%) · 20 days 13.4% (33%), 40 days 11.9% (36%), the average in place of the median 12.6% (32%)', src: 'SSO' },
  { n: 13, name: 'Hollywood +4%/−3% band', formerNames: ['Hollywood SPY 200SMA +4%/−3% → TQQQ/QQQ'], tag: 'community', runnable: true,
    rules: 'Signal: SPY vs its 15-day median. Enter: SPY closes 3% above → TQQQ. Exit: SPY closes 5.5% below → QQQ (never cash). Freq: daily.',
    here: '40.6% / −59.9%', reported: '27.3% CAGR · −95.8% DD · Sharpe 0.71 (1985–2026) · defaults fitted to 2010–2025 and rounded: 44.9% a year, max drawdown 77% (published settings: 38.9%, 60%)', src: 'HW' },
  { n: 14, name: 'Three-phase TQQQ/QLD/GLDM', tag: 'community', runnable: true,
    rules: 'Enter: SPY closes 0.5% above its 10-day median → TQQQ. Exit: SPY closes 7.5% under it → gold. After 640 days: gold, until SPY has gone 7.5% under and back 0.5% above. Switch: sell today, buy tomorrow. Freq: daily.',
    here: '—', reported: 'Published backtest sheet with dated trades · here GLD stands in for GLDM (0.40% vs 0.10% yearly fee) and cash for SGOV · defaults fitted to 2010–2025 and rounded: 54.7% a year, max drawdown 58% (published settings 4%/−3% bands, 200-day average, 366 days, 50/50 mixes: 28.9%, 51%)', src: '3PH' },
  { n: 15, name: 'Composer TQQQ-RSI', formerNames: ['Composer TQQQ-RSI (200MA + RSI + PPO)'], tag: 'oscillator', runnable: true,
    rules: 'Hold TQQQ while QQQ is above its 160-day median and its RSI(14) is under 75; otherwise cash. Freq: daily.',
    here: '—', reported: '69.11% ann · −23.5% DD · Sharpe 1.47 (since Sep 2023, short) · defaults fitted to 2010–2025 and rounded: 40.8% a year, max drawdown 53% (published settings: 33.8%, 55%)', src: 'CMP' },
  { n: 16, name: 'Composer multi-signal', formerNames: ['Composer multi-signal + hedges'], tag: 'oscillator', runnable: false, needs: 'SQQQ/UVXY',
    rules: '#15 plus tactical hedges: brief SQQQ (−3×) or UVXY after extreme moves; TECL (3×) on sharp declines. Freq: daily.',
    here: '—', reported: 'Highest-complexity Composer variant', src: 'CMP' },
  { n: 17, name: 'Petrou weekly MACD', formerNames: ['Petrou weekly-MACD → TQQQ (+ stops)'], tag: 'crossover', runnable: true,
    rules: 'Signal: QQQ’s MACD (12/26/9). Enter: MACD above its signal line and zero → TQQQ. Exit: below either → cash, or TQQQ closes 15% under its high since the buy. Freq: daily.',
    here: '—', reported: '+11,194% (Feb 2010–Jul 2025) · defaults fitted to 2010–2025 and rounded: 18.7% a year, max drawdown 39% (published settings: 18.6%, 39%)', src: 'MACD' },
  { n: 18, name: '40-week SMA crossover', formerNames: ['40-week SMA crossover → TQQQ'], tag: 'crossover', runnable: true,
    rules: 'Signal: QQQ’s weekly close vs its 495-day median. Enter: above → TQQQ. Exit: below → cash. Freq: weekly.',
    here: '—', reported: '+2,800% (Petrou comparison window) · defaults fitted to 2010–2025 and rounded: 35.7% a year, max drawdown 72% (published settings: 31.3%, 62%)', src: 'MACD' },
  { n: 19, name: 'Bare golden cross', formerNames: ['Golden cross 50/200', 'Golden / Death Cross 50/200'], tag: 'crossover', runnable: true,
    rules: 'Enter: QQQ’s 75-day median crosses above its 335-day median → TQQQ. Exit: it crosses below → cash. Freq: daily.',
    here: '35.6% / −69.9%', reported: 'Classic MA-crossover; slower than price-vs-200 · defaults fitted to 2010–2025 and rounded: 43.1% a year, max drawdown 70% (published settings: 32.1%, 70%)', src: 'GS' },
  { n: 20, name: 'Bare volatility targeting', formerNames: ['Volatility targeting', 'Volatility targeting (scale leverage to target vol)'], tag: 'risk', runnable: true,
    rules: 'Each month, hold the share of TQQQ that makes the holding swing about 65% a year, measured over the last 10 days; the rest in cash. Freq: monthly.',
    here: '—', reported: 'Reduces tail risk without binary exits (QuantConnect) · defaults fitted to 2010–2025 and rounded: 42.6% a year, max drawdown 75% (published settings: 26.3%, 38%)', src: 'QC' },
  { n: 21, name: 'VIX-scaled leverage ladder', tag: 'risk', runnable: false, needs: 'VIX',
    rules: 'Map VIX to leverage: VIX<15 → 3×, 15–25 → 2×, 25–35 → 1×, >35 → cash. Freq: daily/weekly. Ancestor of the Alvarez VIX gate.',
    here: '—', reported: 'Transparent regime ladder; deleverages into fear', src: 'ALV·QC' },
  { n: 22, name: 'Connors RSI(2) dip-buy', formerNames: ['Connors RSI(2) dip-buy in uptrend'], tag: 'oscillator', runnable: true,
    rules: 'Trend filter: QQQ above its 200-day median. Entry: buy TQQQ when QQQ’s RSI(2) drops under 20. Exit: RSI(2) over 95, or QQQ closes under the line. Freq: daily.',
    here: '—', reported: 'Short-term mean-reversion inside the trend filter · defaults fitted to 2010–2025 and rounded: 30.2% a year, max drawdown 66% (published settings: 12.0%, 45%)', src: 'QS' },
  { n: 23, name: '200-day SMA + RSI', formerNames: ['200-day SMA + RSI exit & re-entry'], tag: 'app', runnable: true,
    rules: 'Above QQQ’s 200-day median, hold TQQQ. Overheat exit: RSI(10) reaches 85 → cash. Cool gate: buy back only once RSI(10) is under 60. Freq: daily.',
    here: '—', reported: 'Sell when overbought, wait for a dip to buy back; app-implemented · defaults fitted to 2010–2025 and rounded: 36.3% a year, max drawdown 62% (published settings: 34.7%, 55%)', src: 'CMP' },
  { n: 24, name: 'Bodyguard deleverage', formerNames: ['Bodyguard deleverage overlay (+30 / +40)'], tag: 'app', runnable: true,
    rules: 'Below QQQ’s 160-day median: cash. Above it: TQQQ. At 8.5% above → swap TQQQ for QQQ. At 15% above → all cash. Freq: daily.',
    here: '—', reported: 'Dot-com-froth insurance; app-implemented · defaults fitted to 2010–2025 and rounded: 41.2% a year, max drawdown 39% (published settings: 30.7%, 56%)', src: 'HW' },
  { n: 25, name: 'Always invested + DCA', formerNames: ['Always-invested park + DCA-back-in'], tag: 'app', runnable: true,
    rules: 'Above QQQ’s 160-day median: TQQQ. Below it: QQQ (never cash). Freq: daily.',
    here: '39.5% / −58.7%', reported: '+6.91% avg holding QQQ vs bonds in downturns; app-implemented · defaults fitted to 2010–2025 and rounded: 41.3% a year, max drawdown 59% (published settings: 36.6%, 59%)', src: 'HW' },
  // --- hand-picked (tag 'picked'): my own, not from a published write-up. No
  // `src`, so the card title renders as plain text instead of a dead link. ---
  { n: 26, name: 'Bare overextension', formerNames: ['Median overextension 250d'], tag: 'picked', runnable: true,
    rules: 'Signal: traded fund vs the MEDIAN of its own last 250 closes. Exit: price > 55% above the median → park (cash by default). Enter: any time it is not. Freq: daily. Overextension filter only — there is no downside rule, so it holds all the way through every crash.',
    here: '62.4% / −79.1%', reported: 'Hand-picked; numbers are this app’s own backtest, not an external claim' },
  { n: 39, name: 'SSO overheat exit', formerNames: ['Overheat exit \u2014 SSO signal (sell when stretched)'], tag: 'picked', runnable: true,
    rules: 'Signal: SSO vs its own 150-day SMA. Exit: signal closes >20% above the SMA \u2192 park (cash by default). Enter: any time it is not. Freq: daily. Signal and traded fund are separate knobs. Overextension filter only \u2014 like Median overextension 250d it has no downside rule, so it holds through every crash.',
    here: '\u2014', reported: 'Hand-picked; numbers are this app\u2019s own backtest, not an external claim' },
  { n: 40, name: 'Overextension, SQQQ park', formerNames: ['Median overextension (250d) \u2014 SQQQ park'], tag: 'picked', runnable: true,
    rules: 'Hold TQQQ. When it closes 55% above its 250-day median, sell and buy SQQQ. Buy back when it drops under. Checked daily. No stop-loss.',
    here: '82.8% / \u221279.1%', reported: 'Hand-picked; numbers are this app\u2019s own backtest, not an external claim' },
  { n: 41, name: 'Overextension + crash exit', formerNames: ['Median overextension with SQQQ and crash exit'], tag: 'picked', runnable: true,
    rules: 'Hold TQQQ. When it closes 55% above its 250-day median, switch to SQQQ. When it closes 28% below the median — and the median itself has stopped rising (slope under +20%/yr, 10+ straight days below the line) — sell to cash. Buy back when the price recovers above the exit line. Checked daily, one trade per day.',
    here: '\u2014', reported: 'Hand-picked; tuned by sweep on 2010\u20132025, so treat the headline as in-sample. Numbers are this app\u2019s own backtest' },
  // --- optimizer winners (tag 'overfit'): the single top-ranked row from each
  // tab of the 9sig and SMA overfit explorers. These are the BEST-FITTING
  // parameter sets found by sweeping thousands of combinations against a fixed
  // window, so their headline numbers are the peak of a search, not a forecast —
  // shown here to make that gap visible, not as recommendations.
  { n: 27, name: '10-25 - 9sig · max return', formerNames: ['9sig · max return 2010–2025'], tag: 'overfit', runnable: true,
    rules: 'Top-ranked max return row from the 9sig overfit explorer, tuned on 2010–2025 (in-sample CAGR 55.33%, drawdown 69.91%). Runs as a code strategy on the app’s 9sig engine, so every knob stays editable. Selected by search over that window — expect the other windows to look much worse.',
    here: '—', reported: 'In-sample optimum over 2010–2025: 55.33% CAGR / −69.91% DD' },
  { n: 28, name: '10-25 - 9sig · min drawdown', formerNames: ['9sig · min drawdown 2010–2025'], tag: 'overfit', runnable: true,
    rules: 'Top-ranked min drawdown row from the 9sig overfit explorer, tuned on 2010–2025 (in-sample CAGR 30.01%, drawdown 19.41%). Runs as a code strategy on the app’s 9sig engine, so every knob stays editable. Selected by search over that window — expect the other windows to look much worse.',
    here: '—', reported: 'In-sample optimum over 2010–2025: 30.01% CAGR / −19.41% DD' },
  { n: 29, name: '9sig · max return 1990–2025', tag: 'overfit', runnable: true,
    rules: 'Top-ranked max return row from the 9sig overfit explorer, tuned on 1990–2025 (in-sample CAGR 42.24%, drawdown 81.66%). Runs as a code strategy on the app’s 9sig engine, so every knob stays editable. Selected by search over that window — expect the other windows to look much worse.',
    here: '—', reported: 'In-sample optimum over 1990–2025: 42.24% CAGR / −81.66% DD' },
  { n: 30, name: '9sig · min drawdown 1990–2025', tag: 'overfit', runnable: true,
    rules: 'Top-ranked min drawdown row from the 9sig overfit explorer, tuned on 1990–2025 (in-sample CAGR 18.12%, drawdown 22.67%). Runs as a code strategy on the app’s 9sig engine, so every knob stays editable. Selected by search over that window — expect the other windows to look much worse.',
    here: '—', reported: 'In-sample optimum over 1990–2025: 18.12% CAGR / −22.67% DD' },
  { n: 31, name: '9sig · max return 1953–2025', tag: 'overfit', runnable: true,
    rules: 'Top-ranked max return row from the 9sig overfit explorer, tuned on 1953–2025 (in-sample CAGR 19.96%, drawdown 96.58%). Runs as a code strategy on the app’s 9sig engine, so every knob stays editable. Selected by search over that window — expect the other windows to look much worse.',
    here: '—', reported: 'In-sample optimum over 1953–2025: 19.96% CAGR / −96.58% DD' },
  { n: 32, name: '9sig · min drawdown 1953–2025', tag: 'overfit', runnable: true,
    rules: 'Top-ranked min drawdown row from the 9sig overfit explorer, tuned on 1953–2025 (in-sample CAGR 12.01%, drawdown 45.8%). Runs as a code strategy on the app’s 9sig engine, so every knob stays editable. Selected by search over that window — expect the other windows to look much worse.',
    here: '—', reported: 'In-sample optimum over 1953–2025: 12.01% CAGR / −45.8% DD' },
  { n: 33, name: '10-25 - SMA · max return', formerNames: ['SMA · max return 2010–2025'], tag: 'overfit', runnable: true,
    rules: 'Top-ranked max return row from the SMA overfit explorer, tuned on 2010–2025 (in-sample CAGR 79.79%, drawdown 74.03%). Runs as a code strategy on the app’s SMA engine, so every knob stays editable. Selected by search over that window — expect the other windows to look much worse.',
    here: '—', reported: 'In-sample optimum over 2010–2025: 79.79% CAGR / −74.03% DD' },
  { n: 34, name: '10-25 - SMA · min drawdown', formerNames: ['SMA · min drawdown 2010–2025'], tag: 'overfit', runnable: true,
    rules: 'Top-ranked min drawdown row from the SMA overfit explorer, tuned on 2010–2025 (in-sample CAGR 61.01%, drawdown 44.5%). Runs as a code strategy on the app’s SMA engine, so every knob stays editable. Selected by search over that window — expect the other windows to look much worse.',
    here: '—', reported: 'In-sample optimum over 2010–2025: 61.01% CAGR / −44.5% DD' },
  { n: 35, name: 'SMA · max return 1990–2025', tag: 'overfit', runnable: true,
    rules: 'Top-ranked max return row from the SMA overfit explorer, tuned on 1990–2025 (in-sample CAGR 54.13%, drawdown 81.66%). Runs as a code strategy on the app’s SMA engine, so every knob stays editable. Selected by search over that window — expect the other windows to look much worse.',
    here: '—', reported: 'In-sample optimum over 1990–2025: 54.13% CAGR / −81.66% DD' },
  { n: 36, name: 'SMA · min drawdown 1990–2025', tag: 'overfit', runnable: true,
    rules: 'Top-ranked min drawdown row from the SMA overfit explorer, tuned on 1990–2025 (in-sample CAGR 31.28%, drawdown 39.46%). Runs as a code strategy on the app’s SMA engine, so every knob stays editable. Selected by search over that window — expect the other windows to look much worse.',
    here: '—', reported: 'In-sample optimum over 1990–2025: 31.28% CAGR / −39.46% DD' },
  { n: 37, name: 'SMA · max return 1953–2025', tag: 'overfit', runnable: true,
    rules: 'Top-ranked max return row from the SMA overfit explorer, tuned on 1953–2025 (in-sample CAGR 29.97%, drawdown 83.6%). Runs as a code strategy on the app’s SMA engine, so every knob stays editable. Selected by search over that window — expect the other windows to look much worse.',
    here: '—', reported: 'In-sample optimum over 1953–2025: 29.97% CAGR / −83.6% DD' },
  { n: 38, name: 'SMA · min drawdown 1953–2025', tag: 'overfit', runnable: true,
    rules: 'Top-ranked min drawdown row from the SMA overfit explorer, tuned on 1953–2025 (in-sample CAGR 18%, drawdown 51.79%). Runs as a code strategy on the app’s SMA engine, so every knob stays editable. Selected by search over that window — expect the other windows to look much worse.',
    here: '—', reported: 'In-sample optimum over 1953–2025: 18% CAGR / −51.79% DD' },
  // --- the NFCI strategy and the buy-back strategy built from it (tag 'picked'),
  // kept together on the last page. CODE[45] is #44's code with the credit veto
  // taken out and the sell line, buy-back, re-entry and slice rules added. ---
  { n: 44, name: 'NFCI veto', formerNames: ['NFCI veto, med stretch with SQQQ and med crash exit'], tag: 'picked', runnable: true,
    rules: 'Hold TQQQ. When it closes 55% above its 250-day median, switch to SQQQ. When it closes 28% below the median — and the median has stopped rising (up less than 20%/yr over the last 3 months, 10+ straight days closing below it) — sell to cash. Buy back when the price recovers above the exit line. Checked daily, one trade per day. On top of that, one credit rule using the Chicago Fed’s weekly NFCI (0 = average conditions, higher = tighter credit; each reading is used 7 days after its week ends): when it crosses above +0.4, sell whatever is held to cash and stay there. The credit rule switches off when the NFCI falls back under +0.4, or as soon as the price rules re-enter after a crash exit of their own while it is on (the exit may have come before the credit rule did). After that the price rules run everything until the NFCI drops under +0.4 and crosses back above. The credit rule only ever sells, never buys. In the backtest it fired 11 times, all between 1971 and November 2007, holding cash for 3 weeks to 15 months each time. It does not hold cash through a whole crisis: in 2008 it sold on December 7, 2007 and handed control back to the price rules on April 1, 2008; the price rules then sold on September 15, 2008 and bought back in April 2009.',
    here: '\u2014', reported: 'The veto leg was validated separately: era tables from 1973, 52-window walk-forward, arc-preserving bootstrap (87% of resampled paths), Fed vintage data, and a placebo test. Its edge is episodic \u2014 a handful of credit crises carry it. Since 10 November 2026 a start inside a sold-out or vetoed stretch carries that state in (the rules run over the three windows before the Entry without trading), and the NFCI readings from May 2011 on are the first-published ones: the Chicago Fed revises the index’s history every week (April 2020 read 0.07 when published and 0.51 in the April 2025 file)' },
  { n: 45, name: 'SQQQ stretch + buy-back', formerNames: ['SQQQ stretch, sell line + crash buy-back'], tag: 'picked', runnable: true,
    rules: 'Hold TQQQ. When it closes 55% above its 250-day median, switch to SQQQ. Switch back to TQQQ on the first close under that line.\n\nSell line: 3% below the median. The first close under it sells to cash. Buy back after five closes in a row above it.\n\nDeeper corrections are bought back sooner: after five closes in a row above a line half way back from the low toward the median.\n\nBuy-back line: 34% below the median. While sold out, the first close at or under it buys TQQQ with all the money. That buy is sold if the price falls 20% under its buy price, and it happens once per sold-out stretch. After such a sale, five closes in a row above the line buy back, without waiting for the sell line.\n\nAfter buying back below the sell line, the buy-back line works as the sell line until a close above the sell line: a close back under it sells everything, with no new buy at the line until the strategy is back in, and five closes above it buy again.\n\nSales act on the first close. Buying back waits for the closes in a row (the slice excepted), because the big up days inside a crash are the whipsaws. Checked daily, one trade per day: a switch between TQQQ and SQQQ sells today and buys tomorrow. No credit rule: price alone decides. Every number above is a setting.',
    here: '\u2014', reported: 'Since 10 November 2026: sell line 3% under the median, five closes, buy-back 34% under it with all the money. Q1 2010 to Q4 2025, numbers from this app’s own backtest: 97.0% a year (max drawdown 54%, worst 12 months −24%) against 40.0% for buy & hold TQQQ; 2010–17 59%, 2018–25 145%; January to 6 November 2026 up 85% against −0.3%. From 29 October to 10 November the settings were a fit of 286,000 runs to the same years (sell line 10% above the median, four closes, buy-back −32%): 100.8% (53%, −33%). The recheck of 10 November found what that fit rested on: with the sell line above the median, a correction’s low usually stays above the median too, the line half way from the median to the low then lies under the price, and the buy-back came after four closes whatever they were (36 of 44 buy-backs, none at the sell line), with the sell line off until a close back above it. With that path closed the fit makes 92.6%, and in 2026, out of the fit, it made 34% where these settings made 85%. Same SQQQ rule and costs as the NFCI veto strategy, with the credit veto taken out; the sell line, the buy-back, the five-close re-entry, the half-way re-entry after corrections and the buy at the buy-back line are the differences. Also since 10 November: a buy-back that closes at or above the sell line leaves that line on (it was left off until a later close above it), and a start inside a sold-out stretch carries that state in', },
  // hidden (the user, 2026-11-09: "remove these from library"): off the catalog, kept in the list
  // because #48-#50 build their rules text on this card, every stretch strategy's code builds on
  // CODE[47], and saved copies, share links and the "day change like" list look entries up by number.
  { n: 47, name: 'TQQQ vs QQQ stretch', tag: 'picked', runnable: true, hidden: true,
    rules: 'Hold TQQQ, but step aside when its lead over QQQ, counted from their average price (a geometric mean) 1.9 to 2.4 years ago, gets too big or too small.\n\nCeiling: at 125% ahead (TQQQ grew 2.3 times as much as QQQ), switch to SQQQ for up to 20 days, then cash. Back to TQQQ at 25% ahead.\nFloor: under 5% ahead, sell to cash. Back to TQQQ after 5 closes in a row at 25% ahead.\nDeep buy: at 30% behind, buy TQQQ back. The floor stays off until it is 25% ahead again.\nOverextended: while TQQQ is more than 55% above its 250-day median, hold SQQQ.\n\nCrash defence (none triggered since 2010):\nHold SQQQ at most 40 days in a row, then cash.\nSell a deep buy that falls 25%, and buy back when TQQQ closes above its median.\nHold cash instead of TQQQ while credit stress (NFCI) is above 0.5.\n\nChecked at every close. Going between TQQQ and SQQQ takes two days: sell at one close, buy at the next.',
    here: '\u2014', reported: 'Your idea plus the buy-back strategy’s overextended line, fitted to Q1 2010 to Q4 2025. Since 3 November 2026 the defaults sit in the middle of the flat stretch each dropdown shows, picked by hand from a hill-climb on the worst nearby setting (every dropdown counted but the overextended line’s two): 124.6% a year (max drawdown 41%, worst 12 months −24%) against 40.0% for buy & hold TQQQ; 120% to 125% at the lookbacks 539 to 553 days, 96% to 99% at 556 and 560. The 609-day settings tried first (ceiling 140%, back at 50%, floor 15%, re-entry 40%, deep buy −20%) made 108.3% with a 58% drawdown, the 2025 crash held through; these sell at the ceiling on 18 February 2025 and buy back on 8 April. The start price is the average over 65 trading days either side; from one day’s close, lookbacks a week apart made 80% to 141%. Since 2 November 2026 the floor sells to cash instead of switching to SQQQ: SQQQ bought after a floor break lost on average over 169 break days since 2010. From 2005 (prices before 2010 reconstructed): 84.9% a year. Since 4 November 2026 SQQQ is held at most 40 days in a row, 100 before: since 2010 every SQQQ hold ended by day 35, while 100 days let the 1999 bubble run on, two 100-day holds losing 71% and 89%. The 40-day limit last fired on 2 November 2009, ending an SQQQ hold begun in September; that costs 1 point from 2010 (125.6% at 100 days). Otherwise the defences change nothing from 2010 and are there for other markets: on the reconstructed prices from 1956 they lift the rules from 14.0% a year to 25.2%, and the 1973–74, 2000–02 and 2008 bear markets from −94%, −98% and −92% to −21%, −38% and −28%. January to October 2026, left out of the fit: up 102.6% against 18.3% for buy & hold TQQQ' },
];
// #48-#50: NFCI veto, buy-back and TQQQ vs QQQ stretch, each trading the
// user's Turnaround Monday rule in its idle cash (js/strategy-library-code.js
// withTurnaroundMonday). A card is its base card's rules plus the Monday
// paragraph, so a change to the base's rules text reaches it too.
const turnaroundMondayRules = (signal, levels) => levels === 'hl'
  ? `Turnaround Monday: when the rules want cash and ${signal} closes a Monday under the prior day's low, buy TQQQ. Hold it until ${signal} closes above the prior day's high, or until the rules want something else. Money still in SQQQ that Monday sits it out.`
  : `Turnaround Monday: when the rules want cash and ${signal} closes down on a Monday, buy TQQQ. Hold it until ${signal} first closes up, or until the rules want something else. Money still in SQQQ that Monday sits it out.`;
// #48-#50 and #53: the Big days rule (js/strategy-library-code.js withBigDay), a
// paragraph after the Monday one, at 15% both ways for #48-#50 and at #53's own levels there.
const bigDayRules = (fallToo, rise = 15, fall = 15) => `Big days: after TQQQ rises ${rise}% or more in a day, sell and buy back at the next close.`
  + (fallToo ? ` When the rules want cash and TQQQ falls ${fall}% or more in a day, buy TQQQ and sell at the next close.` : '');
// #53: the Month-end dip rule (js/strategy-library-code.js withMonthEndDip), a
// paragraph after the Big days one.
// #53: the late-week SQQQ trade (js/strategy-library-code.js withLateWeekCash), a
// paragraph after the Month-end dip one.
// A week is skipped for a low RSI (or taken for a day when SOXX lags) where the RSI skip is on; where the
// down trend is on, only weeks that start under the median are taken.
const lateWeekRules = ({ rsiSkip, trendDays, fund = 'SQQQ', rsiDays = 10, rsiLevel = 40, lagDays = 20, lagBy = 2 }) => 'Late-week ' + fund + ': while the rules hold cash, hold ' + fund + ' from Wednesday’s close to Monday’s, and over the weekend only if TQQQ ends Friday under that Wednesday’s close.'
  + (rsiSkip ? ' A week that starts with TQQQ’s RSI over ' + rsiDays + ' days at ' + rsiLevel + ' or under is skipped, or taken for one day when SOXX’s return over ' + lagDays + ' days is under QQQ’s by more than ' + lagBy + '%.' : '')
  + (trendDays ? ' Only weeks that start with TQQQ under its ' + trendDays + '-day median are taken.' : '')
  + ' It starts from cash the account already sat in.';
const monthEndDipRules = ({ under, underMax, day, sellDay }) => 'Month-end dip: when TQQQ is ' + under + '% to ' + underMax + '% under its 1-year high at the close of the ' + day + ' trading day of a month, hold TQQQ in place of cash until the close of the next month’s ' + sellDay + ' trading day.';
STRATEGY_LIBRARY.push(...[
  { n: 48, base: 44, name: 'NFCI veto + Turnaround Monday', signal: 'TQQQ', levels: 'close',
    reported: 'Your Turnaround Monday rule (the r/TQQQ post) trading NFCI veto’s idle cash, Q1 2010 to Q4 2025: 88.0% a year (max drawdown 60%, worst 12 months −35%) against 82.5% for NFCI veto alone (worst 12 months −47%) and 40.0% for buy & hold TQQQ. The same trades on random days inside the same cash stretches did as well in 28 of 500 draws. The r/TQQQ post’s rule, Monday close under the prior day’s low and exit over its high, makes 89.1% on those years but 65.7% from 2005 against 71.5% (max drawdown 74% against 60%), so the prior close stays. January to 6 November 2026: up 71%, the same as NFCI veto alone. Since 10 November 2026 every down Monday counts (one used to be skipped when TQQQ had not closed up since an earlier down Monday; none since 1990 here), a start inside a sold-out or vetoed stretch carries that state in, and the NFCI readings from May 2011 on are the first-published ones: the Chicago Fed revises the index’s history every week, and on its April 2025 file this strategy showed 82.6% for these years, with a veto in April 2020 that no reading published at the time called for. Since 11 November 2026 the Big days rule is in, at your 15%: out for a day after TQQQ rises that much, in for a day after it falls that much while the rules want cash. With it 99.4% a year on those years (max drawdown 58%, worst 12 months −34%), and 85% in 2026 to 10 November either way; the figures above are without it. Six of its seven sales since 2010 were in March and April 2020, and on the reconstructed prices before 2010 it adds nothing: 24.1% a year from 1953 to 2025 against 24.5%' },
  { n: 49, base: 45, name: 'Buy-back + Turnaround Monday', signal: 'SPY', levels: 'close',
    reported: 'Your Turnaround Monday rule (the r/TQQQ post) trading buy-back’s idle cash, with the Monday signal read on SPY, Q1 2010 to Q4 2025: 114.7% a year (max drawdown 51%, worst 12 months −16%) against 97.0% for buy-back alone (54%, −24%) and 40.0% for buy & hold TQQQ; 2010–17 68%, 2018–25 175%. The same trades on random days inside the same cash stretches did as well in 2 of 500 draws. The r/TQQQ post’s rule, Monday close under the prior day’s low and exit over its high: 108.1% with a 54% drawdown. January to 6 November 2026: up 107% against 85% for buy-back alone. Since 10 November 2026 buy-back’s sell line is 3% under the median with five closes and the buy-back 34% under it (its card says why); the fitted settings before made 116.8% as the code then was, 118.9% now that every down Monday counts (three were skipped since 2010) and 107.7% with the quirk they rested on closed, and in 2026, out of that fit, 41% where these make 107%. Since 11 November 2026 the Big days rule is in, at your 15%: out for a day after TQQQ rises that much, in for a day after it falls that much while the rules want cash. With it 120.2% a year on those years with the same drawdown and worst 12 months, 2010–17 68%, 2018–25 189%, and 114% in 2026 to 10 November against 107%; the figures above are without it. Four of its six sales since 2010 were in March and April 2020, and on the reconstructed prices before 2010 it adds nothing: 28.3% a year from 1953 to 2025 against 28.8%' },
  { n: 50, base: 47, name: 'TQQQ vs QQQ + Turnaround Monday', signal: 'TQQQ', levels: 'hl',
    reported: 'Your Turnaround Monday rule (the r/TQQQ post) trading the stretch strategy’s idle cash, the floor’s included: since 2 November 2026 the floor holds cash for the Monday rule instead of SQQQ. Since 3 November 2026 the defaults sit in the middle of the flat stretch each dropdown shows, picked by hand from a hill-climb on the worst nearby setting (every dropdown counted but the overextended line’s two). Q1 2010 to Q4 2025: 139.6% a year (max drawdown 41%, worst 12 months −4%) against 124.6% for TQQQ vs QQQ stretch alone and 40.0% for buy & hold TQQQ; 140.7% with SQQQ held up to 100 days, the limit before 4 November 2026. Nearby: lookbacks 532 to 553 days 134% to 140% (556: 117%); start window 56 to 65 days 134% to 140% (70: 121%); floor 3 to 8 points 137% to 140%, −7 to 2 and 9 to 17 129% to 137%; re-entry 24 to 37 points all 140%; deep buy −33 to −24 138% to 140%; closes in a row 4 to 10 all 140% (1 to 3: 135%); SQQQ at the ceiling 10 to 21 days 135% to 141%; ceiling 122% to 126% 132% to 141% (127%: 122%); back at 25% 140%, 26% to 35% 133% to 135% (24%: 127%). Of the 140, 17 points come from one trade: sold at the ceiling on 18 February 2025, SQQQ through the April crash, bought back on 8 April; without it 122%. The 609-day settings tried first (ceiling 140%, back at 50%, floor 15%, re-entry 40%, deep buy −20%) made 119.4% (max drawdown 58%, the 2025 crash held through); the one-day start at 567 days before them made 141.1% (max drawdown 47%) at 567 alone and 88% to 97% at the weeks around it. From 2005 (prices before 2010 reconstructed, the Monday rule on TQQQ highs and lows derived from QQQ’s): 105.4% with a 52% drawdown, autumn 2008. 2010–17 alone 89% a year, 2018–25 alone 203%. January to 6 November 2026: up 71%. Since 10 November 2026 every down Monday counts (one used to be skipped when TQQQ had not closed over its exit level since an earlier one; none since 2010 here). Since 11 November 2026 the Big days rule is in, at your 15%: out for a day after TQQQ rises that much, in for a day after it falls that much while the rules want cash. With it 144.9% a year on Q1 2010 to Q4 2025 with the same 41% drawdown, 2010–17 89%, 2018–25 217%, and 85% in 2026 to 10 November either way; the figures above, the nearby ones included, are without it. Four of its seven sales since 2010 were in March and April 2020; from 1953 to 2025 it makes 26.4% a year against 25.7%' },
].map(({ n, base, name, signal, levels, reported }) => ({
  n, name, tag: 'picked', runnable: true,
  rules: STRATEGY_LIBRARY.find(e => e.n === base).rules + '\n\n' + turnaroundMondayRules(signal, levels) + '\n\n' + bigDayRules(true),
  here: '—', reported,
})));
// #52: #50 with the monthly contributions piling up in SOXL while the rules
// hold TQQQ, handed to the strategy when they switch to SQQQ (the user's idea,
// 2026-11-05; js/strategy-library-code.js withSoxlPile, scratchpad soxl/).
STRATEGY_LIBRARY.push({
  n: 52, name: 'SOXL, TQQQ VS QQQ, Mon Turns', formerNames: ['TQQQ VS QQQ, Mon Turn, Soxl Acc'], tag: 'picked', runnable: true,
  hidden: true,   // the user, 2026-11-09: "remove these from library"; kept in the list: Fit (#53) is built from this code, the widget and share links use the number
  rules: STRATEGY_LIBRARY.find(e => e.n === 50).rules.split('\n\n' + bigDayRules(true)).join('')   // #50's card less its Big days paragraph: this entry's code has no such rule
    + '\n\nSOXL instead of TQQQ:\nThe lead is SOXL’s growth over 380 trading days against SOXX’s.\nWhile the rules hold TQQQ, hold SOXL from the first close with the lead under −15% until the first close with it over 90%.\n\nContributions in SOXL:\nA contribution buys SOXL while the rules hold TQQQ.\nAt the switch to SQQQ, the pile is sold once SQQQ is bought; its money joins the strategy the close after.\nWhen the rules sell TQQQ to cash, the pile waits in cash and buys SOXL again at the next TQQQ buy.\nA withdrawal comes out of the pile first.',
  here: '\u2014',
  reported: 'Your question (5 November 2026): where is SOXL\u2019s edge? On the days the strategy holds TQQQ by its rules, SOXL beat TQQQ by 24% a year over 2010\u20132026, nearly all of it in the volatile stretches and the rebounds after semiconductor crashes; in calm stretches the two tie, and momentum conditions make it worse (SOXL above its 200-day average is the worse half). Timing on volatility needs same-close switches (168% a year with both legs at one close, 148% with the two-day rule), so the usable rules are the reversal ones. The first fit read SOXL\u2019s own price (below its 225-day average, 170.3% a year); your call was the lead over SOXX instead, and it is better on every count. Fitted on Q1 2010 to Q4 2025 at twelve lookbacks and every shape the stretch rules use (under a line, over a line, a band, deep buy plus ceiling; 600 rules), the pick is the 400-day lead held from a close under 0% until one over 20%. $10K lump sum: 183.2% a year (max drawdown 42.3%) against 170.3% (42.9%) for the average rule, now a setting, and 139.6% (40.8%) for TQQQ vs QQQ + Turnaround Monday; 2010\u201317 114% against 96% and 89%, 2018\u201325 275% against 272% and 203%; with $10K plus $500 a month 184.3% money-weighted (drawdown 42%) against 173.4% and 141.0%. SOXL is held on 1,355 of 4,000 days in 22 stretches, against 799 days in 41 stretches for the average rule. The lead rule that was best on 2010\u201317 makes 265% to 275% on 2018\u201325 (the best average rule 252%); the reverse 92% to 93% against 96%. The pattern on random dates reaches 179% at best in 200 tries, under the real 183%; the average rule\u2019s 171% matches its 170%. The lookback is a ridge: 350 and 450 days make 167% to 181%. The same settings at other times: 2026 to date +376% a year against +132% without the rule (SOXL from January, sold on 9 April when the lead passed 20%, TQQQ since 1 July, so from 6 October to 4 November the account fell 26% with TQQQ, where the average rule bought SOXL back on 15 October and fell 45%); the 1996\u20132009 reconstruction 25% a year against 34%, 2000\u201302 2% against 9%, 2003\u201307 12% against 27%, 2005\u201309 26% against 26%, 2008 57% against 58%: every SOXL rule loses to plain TQQQ before 2010. $100K plus $4K a month from each of 199 month-end starts since 2010: $1M in 1.93 years at the median against 2.14, sooner in 165 starts, later in 7, worst 10.4 months later, drawdown on the way up to 42% against 38%. The other settings: \u201cfar under its high\u201d (50% under the 250-day high) 160.5% a year at the base\u2019s drawdown, the flattest family, 25% against 34% in the reconstruction; \u201calways SOXL\u201d 162% with a 55% drawdown, +363% in 2026, 18% against 34% over 1996\u20132009. The catch, whichever rule: it buys semiconductors while they still fall; the \u201cswitch in\u201d setting waits for SOXL to climb back above an average and keeps only a few points. The contributions pile adds 0.2 points: at $10K plus $500 a month the deposits are a rounding error next to the compounding. On 6 November 2026 you set the defaults to a 380-day lead held from a close under −15% until one over 90%: on today’s data, $10K lump sum 2010–2025, 181.4% a year with a 47.2% drawdown against 176.4% and 42.3% for the fitted pick; 2010–17 104% against 116%, 2018–25 287% against 254%; 2026 to date +439% a year against +269%. Figures before 2010 in this note were measured before 10 November 2026, when SOXL and SOXX history before May 1994 was added from a stand-in and the Monday rule began taking every down Monday.',
});

// #53: #52 with the settings the Fit button found for the best CAGR on the
// whole chart, Q1 1953 to date, as defaults (the user, 2026-11-08: "let's
// create this new strategy, call soxl, tqqq, qqq - 1983 fit"; the name is
// the user's, the fit's period starts in 1953;
// js/strategy-library-code.js withDefaults). The rules text is #52's with its
// numbers; the Monday paragraph is shared with #48-#50. Since 2026-11-21 the
// defaults are the user's round fit (FIT_ROUND_DEFAULTS there). Since
// 2026-11-22 it offers a second way to sell SOXL, once its lead turns down
// (withSoxlTurnSell there); the level is the default and what the rules say.
// The rules text of #53 and of #71 beside it, which differ in the ceiling, the
// SOXL sell level and the contributions pile.
// Every number that differs between the two is a field of the card's own settings (FIT_CARD, STEADY_CARD below).
// A lead level as the card writes it: −70%, 10%.
const leadPct = (v) => (v < 0 ? '−' + -v : String(v)) + '%';
const fitRules = (c) => 'Hold TQQQ, but step aside when its lead over QQQ, counted from their average price (a geometric mean) ' + ((c.lookback - c.window) / 252).toFixed(1) + ' to ' + ((c.lookback + c.window) / 252).toFixed(1) + ' years ago, gets too big, and sit out a long decline.'
  + '\n\nCeiling: at ' + c.ceiling + '% ahead (TQQQ grew ' + +(1 + c.ceiling / 100).toFixed(2) + ' times as much as QQQ), ' + (c.ceilingDays ? 'switch to SQQQ for up to ' + c.ceilingDays + ' days, then cash' : 'switch to SQQQ, with no day limit of its own') + '. Back to TQQQ at ' + c.back + '% ahead.'
  + '\nBear exit: sell to cash when TQQQ closes ' + c.bearUnder + '% under its ' + c.medianDays + '-day median, but only ' + (c.bearSlope == null ? 'once it' : 'while that median has risen less than ' + c.bearSlope + '% a year over the last three months and TQQQ') + ' has closed under it ' + c.bearCloses + ' days in a row. Buy back at the first close above that level.'
  + '\nOverextended: while TQQQ is more than ' + c.over + '% above its ' + c.medianDays + '-day median, hold SQQQ.'
  + '\n\nCrash defence:\n' + (c.sqqqMax ? 'Hold SQQQ at most ' + c.sqqqMax + ' days in a row, then cash.' : 'SQQQ is held with no limit of days.') + '\nHold cash instead of TQQQ while credit stress (NFCI) is above ' + c.nfci + '.'
  + '\n\nChecked at every close. ' + (c.twoDays ? 'Going between TQQQ and SQQQ takes two days: sell at one close, buy at the next.' : 'A switch between two funds sells and buys at the same close.') + '\n\n' + turnaroundMondayRules('TQQQ', 'hl') + '\n\n' + bigDayRules(true, c.bigRise, c.bigFall) + '\n\n' + monthEndDipRules(c.dip) + '\n\n' + lateWeekRules(c.late)
  + '\n\nSOXL instead of TQQQ:\nThe lead is SOXL’s growth over ' + c.soxlDays + ' trading days against SOXX’s.\nWhile the rules hold TQQQ, hold SOXL from the first close with the lead under ' + leadPct(c.soxlEnter) + ' until '
  + (c.soxlTrail ? 'the lead turns down: the first close ' + c.soxlTrail + ' points under its highest close since it went under ' + leadPct(c.soxlEnter) + ', counted once that high is over ' + leadPct(c.soxlTrailFrom) + '.' : 'the first close with it over ' + c.soxlExit + '%.')
  + (c.soxlConfirm ? '\nIn that time SOXL is held only at closes over its ' + c.soxlConfirm + '-day average, TQQQ at the others.' : '')
  + (c.pile ? '\n\nContributions in SOXL:\nA contribution buys SOXL while the rules hold TQQQ.\nAt the switch to SQQQ, the pile is sold once SQQQ is bought; its money joins the strategy the close after.\nWhen the rules sell TQQQ to cash, the pile joins the strategy: its money becomes the strategy’s cash.\nA withdrawal comes out of the pile first.' : '');
// The round fit of 21 November 2026 with Steady fit's ceiling and SOXL level, and the late-week rules of 24 November.
const STEADY_CARD = { lookback: 540, window: 60, ceiling: 100, ceilingDays: 20, back: 35, bearUnder: 30, bearSlope: 20, bearCloses: 15, over: 55, medianDays: 255, sqqqMax: 15, nfci: 0.5, bigRise: 10, bigFall: 25,
  dip: { under: 35, underMax: 85, day: '4th to last', sellDay: 'first' }, late: { rsiSkip: true, trendDays: 0 }, soxlDays: 420, soxlEnter: -20, soxlExit: 10, pile: false, twoDays: true };
// The defaults of 24 November 2026, the second fit of that day (FIT_DEFAULTS_2026_11_24 and the late-week spec in js/strategy-library-code.js).
const FIT_CARD = { lookback: 585, window: 55, ceiling: 110, ceilingDays: 65, back: 30, bearUnder: 30, bearSlope: null, bearCloses: 35, over: 55, medianDays: 245, sqqqMax: 9, nfci: 0.5, bigRise: 10, bigFall: 20,
  dip: { under: 60, underMax: 85, day: '3rd to last', sellDay: '4th' }, late: { rsiSkip: false, trendDays: 40 }, soxlDays: 330, soxlEnter: -75, soxlExit: 325, pile: false, twoDays: false };
STRATEGY_LIBRARY.push({
  n: 53, name: 'SOXL, TQQQ, QQQ - 1983 fit', tag: 'picked', runnable: true,
  hidden: true,   // the user, 2026-11-26, on adding #76: "remove all others soxl tqqq qqq strategies that were fit on 1983 today"; kept in the list: #71, #74 and #76 are built from this code, saved copies and share links use the number
  rules: fitRules(FIT_CARD),
  here: '\u2014',
  reported: 'Your Fit (Best CAGR) on the chart from its first quarter, Q1 1953, to 6 November 2026 with a $100K lump sum, run on SOXL, TQQQ VS QQQ, Mon Turns on 8 November 2026: sixteen settings moved, three of them to values between the dropdown’s options (58.2%, −33%, 101%, the Fit’s second pass). The name says 1983; the fit’s period starts in 1953, the chart’s first quarter. On 10 November 2026, after a recheck, six of the fitted values were moved for steadiness: re-entry 35% for 10 closes (65% for 44 was fitted), deep buy −30.5% (−32.5%), lookback 546 days with the start averaged over ±60 (543, ±65), back at 28% (34%). Why: the re-entry had never fired since 2010 and decides only what happens when a deep buy is missed, where the fitted pair waited out most of the recovery (128% a year instead of 149% with the deep buy at −34%); both deep buys since 2010 fired within a point of their level (20 March 2020 at −33.4%, the low of that crash, and 30 September 2022), and at −33.5% the 2020 one never happens; the other three lift the worst result one small step away from 143% to 149% and cut the drawdown. Q1 2010 to Q4 2025, where strategies are judged here: 176.0% a year (max drawdown 45.7%, April to July 2012) against 177.5% (48.3%) for the fitted values and 176.8% (47.2%) for the parent; 2010–17 104%, 2018–25 274%; January to 6 November 2026 up 347%, the same as the fitted values. Fitted on one half of 2010–2025 and tested on the other, this kind of strategy made 28% to 129% a year (eight tests, mean 64%), so expect far less than the fit shows. From Q1 1953: 46.9% a year with a 98.8% drawdown (August 1959 to October 1985) against 28.2% for the parent; from Q1 1983, 89.1% against 59.5%, drawdowns 85% and 95%. Prices before 2010 are reconstructed; SOXL and SOXX before May 1994 are a stand-in (US electronic-equipment stocks at 1.15 times their daily move, added 10 November 2026), which took 4 points a year off the 1953 figure and 8 off the 1983 one. The ceiling’s SQQQ limit came out at 61 days; the defence’s 18-day cap cuts nearly every SQQQ hold first, and the 61 acted once, in November 2021. What differs from the parent: the floor holds SQQQ instead of cash and buys back after 10 closes at a 35% lead, with the deep buy at −30.5%; the ceiling steps back in at 28%; the overextended line is 58.2% over a 236-day median; SQQQ is held 18 days at most; the deep buy guard sits at 52% and the credit veto at 0.75; SOXL is held from a lead under −33% until one over 101%. Since 11 November 2026 the Big days rule is in, at your 15%: after TQQQ rises that much in a day the fund held, SOXL included, is sold and bought back at the next close. With it 182.9% a year on Q1 2010 to Q4 2025 with the same drawdown, 2010–17 104%, 2018–25 293%, and 384% in 2026 to 10 November either way; the figures above are without it. Three of its six sales since 2010 were in March and April 2020; from 1953 to 2025 it makes 45.5% a year against 44.6%. The rule’s other half, buying for a day after a 15% fall while the rules want cash, is Off here: it cost three points a year (179.8%). Since 11 November 2026 the Month-end dip rule is in, at your call after that day’s search for calendar rules: 192.9% a year on Q1 2010 to Q4 2025 with the same drawdown, 2010–17 108%, 2018–25 311%, and 384% in 2026 to 10 November either way, with no trade yet that year. Six trades since 2010, all up, 10.0% on average: August 2011, August 2015, November 2018, January, February and March 2022. From 1953 to 2025 it makes 48.0% a year against 45.5%. On TQQQ alone the same trade made 6.1% on 64 trades since 1985 and nothing with the month end moved a week either way, but 0.7% on 67 trades before 1985, when the bounce came about three days later, so the timing may move again. Without the 50% limit it makes 188.0% with a 54.1% drawdown. Since 17 November 2026, at your call, the floor sells to cash, and a break that reverses is undone: within 20 days of it, three closes in a row at 2 points over the floor buy TQQQ back. Why: the fitted 6% sat beside a cliff. With SQQQ after the break and no way back, floors from 0% to 20% made 130% to 196% a year on Q1 2010 to Q4 2025 with drawdowns up to 57%; 7% would have sold on 5 November 2026, and at 11% the year 2026 stood 11% down on 16 November. Now they make 173% to 188% with drawdowns up to 49%, and 2026 is up at least 192% at every one of them. At 6% it costs: 187.7% a year against 192.9% with the same drawdown, 2010–17 108%, 2018–25 297%, from SQQQ’s gain after the March 2020 break and an early return in May 2022; from 1953 to 2025 it makes 45.9% against 48.0%. The figures above are with SQQQ after the break. The Fit button leaves the three way-back settings alone. Since 20 November 2026, at your call, the floor is 0%. At 6% it sold TQQQ at the 19 November 2026 close with the lead at 3%; at 0% that close keeps TQQQ. On Q1 2010 to Q4 2025 it makes 184.4% a year (max drawdown 49.0%) against 187.7% (45.7%) at 6%: 2010–17 108% either way, 2018–25 288% against 297%. The difference is March 2020, where the break comes on the 12th, three days later (2020 up 938% against 1,153%). Floors of 2% to 5% make 186.8%. From 1953 to 2025 it makes 45.8% against 45.9%; January to 19 November 2026 up 319% either way. The figures above are at 6%. Since 20 November 2026, at your call (“can’t we use nfci strategy rule, where we only sell in prolonged bear markets”), the floor, its way back, the re-entry and the deep buy with its guard are out, and a bear exit sells in their place: the NFCI veto strategy’s price exit on this strategy’s own median. Why: with the lead at the floor that day, nothing tested could tell a break that goes on from one that reverses (about 900 variants), and a floor of 11% had sold on 30 March 2026 and missed a 41% rise in two weeks. It runs at your settings of 21 November: 26% under the median, the median lower than three months before, 10 closes under it. On Q1 2010 to Q4 2025 it makes 196.9% a year (max drawdown 47.1%, 4 to 12 March 2020) against 187.7% (45.7%) with the floor at 6% and 184.4% (49.0%) at 0%; with no floor at all 180.3% (69.0%). 2010–17 108%, 2018–25 323%; 2020 up 1,387%, 2022 up 110%; January to 19 November 2026 up 319%, in TQQQ at that close. Since 2010 the exit has been out once, 27 April 2022 to 19 January 2023. These values are the top of their neighbourhood: the 90 settings around them (level 22% to 30%, rate −10% to 20%, 5 to 15 closes) make 178% to 197%, median 187%, with drawdowns of 47% to 54%, so expect the middle. The rate sits on an edge: at 0% to 5% the sale of 2022 comes on 27 April and the result is 195% to 197%, just under 0% it comes on 16 June and the result is 186%; over 200 wider settings the result runs from 157% to 197%, and the rate has to stay at 20% or under. What it gives up: a fast crash is held through (March 2020 fell 47% in eight days), one bear market carries its evidence, and before 2010 the floor and the deep buy did more: from 1953 to 2025 40.9% a year against 45.8%, from 1983 76.9% against 87.8%. Seven settings fewer. The figures above are with the floor. Since 21 November 2026 the defaults are your round fit: the Fit button’s “Best CAGR, round numbers”, run twice on your copy, the second time on a history that starts in the 1980s, so every fitted number is a round one. Twenty settings moved: lookback 540 days (546); ceiling at 125%, SQQQ for 20 days, back at 35% (123%, 61, 28%); bear exit 30% under the median, with its rise under 20% a year and 15 closes under it (26%, 0%, 10); overextended 55% over a 255-day median (58.2%, 236); SQQQ 15 days at most (18); credit veto 0.5 (0.75); SOXL’s lead over 420 days, held from under −20% until over 195% (380, −33%, 101%); the pile joins the strategy when the rules sell to cash (it waited in cash); Big days out after a 10% rise and in for a day after a 25% fall in cash (15%, Off); Month-end dip on the 4th to last day at 35% to 85% under the high (5th, 30% to 50%). On Q1 2010 to Q4 2025 it makes 196.8% a year (max drawdown 51.9%, May to August 2010; worst 12 months −22%) against 196.9% (47.1%, −15%) at the settings before: the same return with a deeper fall. 2010–17 107%, 2018–25 325%; 2020 up 1,533%, 2022 up 175%. January to 19 November 2026 up 586% against 319%, in TQQQ at that close; 2026 was inside the fitted period, so it is no test. From 1983 to 2025 82.0% a year (max drawdown 91.2%) against 76.9% (94.5%); from 1953, 40.9% either way (99.2% against 98.6%). The bear exit has been out in February 2016, December 2018 to January 2019 and April 2022 to January 2023; through that last decline the Month-end dip now buys TQQQ over each month end. SOXL is held on 2,178 of 4,025 closes against 1,635, and the trades go from 290 to 399. The figures above are at the settings before. Since 22 November 2026 there is a second way to sell SOXL, built after you pointed at the cycle in its lead (“let’s integrate it in both”): “Sell SOXL back to TQQQ once its lead turns down”, at the first close with the lead 30 points under its highest close since SOXL was bought, counted once that high is over 50%. The 195% level stays the default. Why it was built: the lead swings from a trough under −20% to a high of 150% to 400% and back, six times since 2010, and a fixed level has to guess the high. The 195% caught the 2026 top by 8 points; at 205% that year is up 64% in place of 477%. On Q1 2010 to Q4 2025 the turn sale makes 198.0% a year (max drawdown 45.7%, April to July 2012) against 196.8% (51.9%), with six falls of 30% or more against ten; January to 20 November 2026 up 314% against 477%. Why it is not the default: on years the settings had not seen it did not hold up. One fitted copy with the turn sale against one with a fitted level, return a year and deepest fall: fitted on earlier years and run on each next year of 2016–2025, 121% and 77% against 139% and 80%; fitted on 2018–2026 and run on 2010–2017, 54% and 52% against 59% and 63%; fitted on both ends and run on 2014–2021, 56% and 55% against 97% and 47%. On the fitted years about 750 settings of rules that follow the lead’s turn only tie the fixed levels (a plain “over 40%” makes 198.3% with a 45.7% drawdown). Holding SOXL only while the lead rises, without the buy in the trough, lost in every form tried. Since 23 November 2026 the Late-week SQQQ rule is in, at your call after that day’s study: while the rules sit in cash, SQQQ is bought at Wednesday’s close and sold at Friday’s. With it 229.9% a year on Q1 2010 to Q4 2025 with the same 51.9% drawdown, against 196.8% without; 2010–17 114.6% against 107.4%, 2018–25 406.8% against 324.5%; January to 20 November 2026 up 477% either way, the rules having sat in cash on 12 days. 161 trades since 2010, 56% of them up, 1.5% on average: the 36 of 2022 made 162% together, the 25 of 2011 43%, the 18 of 2018 44%; the 46 of 2015 lost 17% together and the 7 of 2023 15%. The worst single trade lost 27% (9 November 2022), with the whole account in SQQQ. Thursday alone makes 211.6%, Friday alone 213.3%; Monday to Wednesday loses (192.3%). A down-trend rule on top added nothing: read 72 ways, every one was ahead of Fit in both halves and none ahead of taking every week, because the weeks these rules sit in cash are already the falling market. In cash that is cash in any market (Bare Turnaround Monday) the same trade loses. When a trade is open and the rules want a fund, the fund is bought a close later, as on any switch: 11 such days since 2010. Since the same day Steady fit has the rule too. Since 24 November 2026, at your call after that day’s study of what carries over from Min - late-week SQQQ, the trade has three of its rules: it runs to Monday’s close, over the weekend only if TQQQ ends Friday under Wednesday’s close; a week that starts with TQQQ’s RSI over 10 days at 40 or under is skipped; and such a week is taken for one day when SOXX’s return over 20 days is under QQQ’s by more than 2%. With them 253.9% a year on Q1 2010 to Q4 2025 with the same 51.9% drawdown and worst 12 months (−22%), against 229.9%; 2010–17 118.0% against 114.6%, 2018–25 474.3% against 406.8%; 2026 the same, with no late-week trade that year. 151 trades, 54% of them up, 2.9% on average, the worst −14% (21 October 2015) where it was −27%; the 33 of 2022 make more than half of the gain. One rule at a time: the Monday alone 230.5% (2010–17 down to 104.9%), the RSI skip alone 236.6%, with the lagging week 239.1%. Ahead of the trade as it was in 2015, 2016, 2018, 2021, 2022 and 2025; behind in 2010, 2011, 2014 and 2023. Of 17 settings one step away, 10 were ahead in both halves and all made 235% to 259%. The fourth rule, only in weeks with TQQQ under its 30-day median, is a setting and off: 240.9%. The study’s own figure was 254.9%: its weeks began at the first Wednesday of 2010 and left out Monday 4 January 2010, which the rule takes. Before 2010, on reconstructed prices, the three rules cost: 28.0% a year on 1986–2009 against 40.1% with the trade as it was and 45.4% without it; with the down trend on, 46.8%. Since 24 November 2026 the defaults are your fit of that day, the settings of your copy pasted as they stood. Twenty-one moved: lookback 555 days with the start averaged over ±65 (540, ±60); ceiling at 105% into cash, back at 30% (125% into SQQQ for 20 days, 35%); the bear exit after 35 closes under the median whatever the median’s rise (15 closes, only with a rise under 20% a year); the median over 245 days (255); SQQQ 3 days at most (15); SOXL’s lead over 330 days, held from under −75% until over 325% (420, −20%, 195%); contributions go into the strategy at once, the SOXL pile off; Big days in for a day after a 20% fall in cash (25%); Month-end dip on the 5th to last day at 55% to 85% under the high, sold on the 4th trading day (4th, 35%, the first); the late-week trade only in weeks that start with TQQQ under its 40-day median, with no RSI skip. On Q1 2010 to Q4 2025, where strategies are judged here, it makes 170.1% a year (max drawdown 60.7%, August 2022 to January 2023; worst 12 months −33.7%) against 253.9% (51.9%, −21.9%) at the settings before: 2010–17 102.7% against 118.0%, 2018–25 259.7% against 474.3%; behind in 11 of the 16 years, most in 2022 (up 120% against 1,263%), 2025 (679% against 1,182%) and 2018 (268% against 470%), and ahead in 2012, 2015, 2016, 2017 and 2019. January to 23 November 2026 up 771% against 587%; 2026 was inside the fitted period, so it is no test. Over the long history it is ahead: from 1953 to 2025 56.8% a year (max drawdown 91.2%) against 38.1% (99.9%), from 1983 104.7% against 78.9%, and on 1986–2009 78.9% against 28.0%. Prices before 2010 are reconstructed. So this fit gives up the years since 2010 for the ones before. One group of settings put back at a time, on 2010–2025: the late-week trade as it was (RSI skip, no down trend) 194.1% with a 51.9% drawdown; the Month-end dip 181.9% (53.7%); SOXL 179.4%; the ceiling 154.9% with an 84.3% drawdown; the lookback 158.5%. One step away it is flat on most settings (lookback 550 or 560: 167.6% and 169.6%; ceiling 100 or 110: 167.2% and 172.7%) and steep on one: back at 25% in place of 30% makes 136.5%. SOXL’s two levels do nothing one step away on 2010–2025 and decide 2026: sold at 330% in place of 325% the year is up 384%. The figures above are at the settings before. Later on 24 November 2026 the defaults are your second fit of that day, “Best CAGR, round numbers” run on the first. Nine settings moved: lookback 585 days with the start averaged over ±55 (555, ±65); ceiling at 110% into SQQQ for at most 65 days (105% into cash); SQQQ 9 days at most (3); Month-end dip on the 3rd to last day at 60% under the high (5th, 55%); and a switch between two funds at one close, where every default before spread it over two days. On Q1 2010 to Q4 2025 it makes 202.0% a year (max drawdown 52.4%, July 2024 to January 2025; worst 12 months −7.5%) against 170.1% (60.7%, −33.7%) for the first fit and 253.9% (51.9%, −21.9%) for the settings before both: 2010–17 108.8% against 102.7%, 2018–25 336.7% against 259.7%. January to 23 November 2026 up 1,097% against 771%; 2026 was inside the fitted period, so it is no test. From 1953 to 2025 58.3% a year against 56.8%, from 1983 108.6% against 104.7%; on 1986–2009 72.9% against 78.9%. The switch at one close is 11 of the 32 points: with the two-day switch kept, 190.8% a year (52.4%, worst 12 months −21.2%) and 2026 up 753%. The figures above are at the settings before.',
});

// #76: #53 at the settings of the user's copy after a pick on the map of 1984 to 2025 (the user, 2026-11-26, pasting the
// Fit note and the panel: "Set a new 1984-2025 strategy and remove all others soxl tqqq qqq strategies that were fit on
// 1983 today"; FIT_1984_2025_DEFAULTS in js/strategy-library-code.js). It takes #53's place in the catalog; #53 is
// hidden. Numbers: this app's backtest, $100K lump sum; 1984 to 2025 from the close of 30 December 1983.
const FIT_1984_2025_CARD = { lookback: 555, window: 49, ceiling: 132, ceilingDays: 63, back: 27, bearUnder: 29.5, bearSlope: 10, bearCloses: 7, over: 67.5, medianDays: 249, sqqqMax: 3, nfci: 0.27, bigRise: 14.5, bigFall: 21.5,
  dip: { under: 33, underMax: 68, day: '3rd to last', sellDay: 'first' }, late: { rsiSkip: true, rsiLevel: 29.5, lagDays: 11, lagBy: 4.5, trendDays: 38 }, soxlDays: 220, soxlEnter: 10, soxlTrail: 65, soxlTrailFrom: -15, soxlConfirm: 100, pile: false, twoDays: false };
STRATEGY_LIBRARY.push({
  n: 76, name: '84-25 - SOXL, TQQQ, QQQ', formerNames: ['SOXL, TQQQ, QQQ - 1984-2025 fit', '1984 - SOXL, TQQQ, QQQ'], tag: 'picked', runnable: true,
  rules: 'Fitted to 1984-2025: SOXL, TQQQ, QQQ - 1983 fit with 28 settings moved.\n\n' + fitRules(FIT_1984_2025_CARD),
  here: '\u2014',
  reported: 'Your request (26 November 2026): your copy of SOXL, TQQQ, QQQ - 1983 fit after a pick on the map of 1984 to 2025, as a strategy of its own; the 1983 fit is off the catalog since. Later that day you set its defaults to a second pick on the same map, 20 settings moved (the first pick’s in brackets): the lookback 555 days (554) with the start averaged over ±49 (57); the ceiling at 132% (127%), SQQQ there for at most 63 days (no limit of its own), back at 27% (29%); the bear exit 29.5% under the median (28.5%), only while the median rises less than 10% a year (8%), after 7 closes under it (3); overextended at 67.5% (68%) over a 249-day median (256); SQQQ 3 days at most (17); the credit veto over 0.27 (0.36); SOXL’s lead over 220 days (240), held from under 10% (−70%) until it turns down 65 points (80) once its high is over −15% (50%), and only at closes with SOXL over its 100-day average (10-day); the late-week lagging week over 11 days (18) by more than 4.5% (2%), the down trend on a 38-day median (44). Against the 1983 fit 28 settings differ. Your note’s max drawdown on 1984 to 2025, 54.5% before and 54.7% after, is these settings’ to the decimal. It is fitted on 1984 to 2025, so those years are no test of it. 1984 to 2025 (prices before 2010 reconstructed): 150.3% a year (max drawdown 54.7%, March to October 1994; worst 12 months −49%) against 140.9% (54.5%, −53%) for the first pick, 112.8% (87.1%) for the 1983 fit and 11.5% for buy & hold TQQQ; 1986–2009 155.2% against 140.3%; 1953 to 2025 74.1% (max drawdown 98.5%) against 68.8% (96.2%). Q1 2010 to Q4 2025: 170.7% a year (max drawdown 51.2%, 23 January to 12 March 2020; worst 12 months −20%) against 166.7% (46.3%, −16%) for the first pick, 202.0% for the 1983 fit, 202.4% for the steady fit, 287.4% for the 2010-2025 fit and 40.0% for buy & hold TQQQ; 2010–17 105.1% (93.8%), 2018–25 257.1% (266.9%). Since 2010 it was ahead of the first pick in 10 of the 16 years and behind in 6 (2011 to 2013, 2017, 2024 and 2025, which made 499% against 1,045%), with no year down. January to 25 November 2026: up 80.2% against 56.1% for the first pick, 1,073.8% for the 1983 fit and −13.6% for TQQQ. It sits on an edge: one step either way on any of its number settings makes 137.3% to 150.3% a year on 1984 to 2025 and 145.4% to 175.3% on 2010 to 2025, and three single steps take the max drawdown on 1984 to 2025 from 54.7% to 70.8%: the lookback at 556 days (138.9%), the start averaged over ±50 (141.7%) and the ceiling at 133% (141.9%). SOXL sold at a lead level in place of the turn: 133.0% and 150.1%. Since 2010 it held TQQQ on 1,842 of 4,024 closes, SOXL on 1,258, SQQQ on 241 and cash on 683.' });

// #71: #53 with what the study of 21-22 November 2026 found about it (the
// user, 2026-11-22: "add a paralel strategy with these findings"): a ceiling
// of 100%, SOXL sold at a lead over 10%, no SOXL pile, and eleven settings
// the Fit button leaves alone (js/strategy-library-code.js, the #71 section).
// It sits right after #53 in the catalog. The rules text is #53's with these
// numbers and without the contributions paragraph. Like #53 it offers the
// turn sell as the other way to sell SOXL.
STRATEGY_LIBRARY.push({
  n: 71, name: 'SOXL, TQQQ, QQQ - steady fit', tag: 'picked', runnable: true,
  rules: fitRules(STEADY_CARD),
  here: '—',
  reported: 'Your request (22 November 2026): a strategy beside SOXL, TQQQ, QQQ - 1983 fit with what the study of 21–22 November found about it. Three things differ. The ceiling is 100% (125%). SOXL goes back to TQQQ at a lead over 10% (195%). Every contribution goes into the strategy at once: the SOXL pile is out, its three settings moved the end value by under 1%. The Fit button leaves eleven settings alone: the ceiling and its way back, how SOXL is sold, the bear exit, the SQQQ limit and the credit veto. Q1 2010 to Q4 2025 with a $100K lump sum: 155.6% a year (max drawdown 39.3%, 4 to 12 March 2020; worst 12 months −4%) against 196.8% (51.9%, −22%) for the 1983 fit and 40.0% for buy & hold TQQQ; 2010–17 91%, 2018–25 242%. Six falls of 30% or more against ten, none of 40% against four; worst month −24% against −44%. SOXL is held on 1,052 of 4,025 closes against 2,178, with 421 trades against 395. It was behind the 1983 fit in 11 of the 17 years 2010–2026: January to 20 November 2026 is up 123% against 477%, with the same 50% fall since 6 October, in TQQQ at that close. Why it takes less: the 1983 fit’s settings are the peak of this history, and these two are where the peak is narrowest. 125% is the highest ceiling that still caught the 2025 fall; at 130% that fall is 72%. The 195% sold SOXL on 22 June 2026 with the lead at 203%; from 205% up it never sells, and 2026 is up 64% with an 85% fall. Across the SOXL level the return is flat on 2010–2025 and on 1986–2009, and the falls grow with it. On years the settings had not seen, one fitted copy of this shape against a plain fit, return a year and deepest fall: fitted on earlier years and run on each next year of 2016–2025, 123% and 65% against 108% and 80%; fitted on 2018–2026 and run on 2010–2017, 89% and 45% against 59% and 63%; fitted on both ends and run on 2014–2021, 165% and 42% against 97% and 47%. On SPXL, SSO and QLD, which the fit never saw, the lower ceiling made more with a smaller fall (SPXL 59% a year and 42% against 49% and 59%). So expect a fall of 45% to 65% in years to come; the 39% belongs to the fitted years. The values 100 and 10 were picked with the whole record in sight, and about 39 versions were compared on the same years, so treat the sizes as rough. The SQQQ limit and the credit veto do nothing since 2010 and stay for what came before: 1995–1999 made 132% a year against 41% without the limit, and 1987 was up 51% against down 7% without the veto. From 1986 to 2009, on reconstructed prices: 41.5% a year (max drawdown 86.2%) against 45.4% (91.2%); from 1983 to 2025, 69.6% against 82.0%. Since the same day “Sell SOXL back to TQQQ once its lead turns down” is the other choice of how SOXL is sold, as in the 1983 fit: 30 points under the lead’s highest close since SOXL was bought, counted once that high is over 50%. The 10% level stays the default. With the turn sale it makes 165.3% a year on Q1 2010 to Q4 2025 with a 45.7% drawdown (April to July 2012), holds SOXL on 1,502 closes against 1,052, and is up 314% in 2026. On years the settings had not seen, one fitted copy with the turn sale against one with the 10% level: 123% a year and a 63% fall against 114% and 65% on 2016–2025, 94% and 52% against 89% and 45% on 2010–2017, 130% and 37% against 165% and 42% on 2014–2021. Since 23 November 2026 the Late-week SQQQ rule of SOXL, TQQQ, QQQ - 1983 fit is in here too, at your word: while the rules sit in cash, SQQQ is bought at Wednesday’s close and sold at Friday’s. With it 175.5% a year on Q1 2010 to Q4 2025 with the same 39.3% drawdown, against 155.6% without; 2010–17 94.7% against 91.1%, 2018–25 289.7% against 241.6%; January to 20 November 2026 up 122% either way. It makes the strategy less steady: the worst 12 months go from −4.0% to −35.1% (May 2014 to May 2015), 2015 makes 8% where it made 34% and 2021 8% where it made 73%; 2011, 2018, 2022 and 2025 gain the most (171% against 97%, 170% against 81%, 636% against 175%, 684% against 413%). Better in 8 of 17 years, worse in 5, no year down either way. 254 trades since 2010, 48% of them up, 0.8% on average, the worst −27% (9 November 2022). Picking nothing for the fund turns it off. Since 24 November 2026, at your call after that day’s study of what carries over from Min - late-week SQQQ, the trade has three of its rules, as in the 1983 fit: it runs to Monday’s close, over the weekend only if TQQQ ends Friday under Wednesday’s close; a week that starts with TQQQ’s RSI over 10 days at 40 or under is skipped; and such a week is taken for one day when SOXX’s return over 20 days is under QQQ’s by more than 2%. With them 202.4% a year on Q1 2010 to Q4 2025 against 175.5%; max drawdown 40.8% (October 2014 to May 2015) against 39.3%; worst 12 months −38.6% against −35.1%; 2010–17 99.4% against 94.7%, 2018–25 358.4% against 289.7%; 2026 the same, with no late-week trade that year. 247 trades, 47% of them up, 1.8% on average, the worst −14% (21 October 2015). Ahead of the trade as it was in 2015, 2016, 2018, 2021, 2022, 2024 and 2025; behind in 2010, 2011, 2014 and 2023. The fourth rule, only in weeks with TQQQ under its 30-day median, is a setting and off. With it on: 194.6% a year, max drawdown 39.3% and worst 12 months −4.0%, as without the late-week trade; 2010–17 116.7%, 2018–25 300.4%; of 21 settings one step away from it, 16 were ahead in both halves and every one had a worst 12 months between −4% and −10%. Before 2010, on reconstructed prices, the three rules cost: 28.1% a year on 1986–2009 against 35.8% with the trade as it was and 41.5% without it; with the down trend on, 42.3%.',
});

// #74: #53 at the settings of the user's copy after a fit on Q1 2010 to Q4 2025 (the user, 2026-11-24: "create new
// strategy, call it 2010-2025 fit", then the copy's panel: "here , call it soxl,tqqq - 2010-2025 fit";
// FIT_2010_2025_DEFAULTS in js/strategy-library-code.js), with "back at" 40% where the panel had 30% (the user, the same
// day: "ok do 40%"). Numbers: this app's backtest, $100K lump sum.
const FIT_2010_2025_CARD = { lookback: 585, window: 60, ceiling: 110, ceilingDays: 10, back: 40, bearUnder: 25, bearSlope: 0, bearCloses: 35, over: 55, medianDays: 245, sqqqMax: 0, nfci: 0.5, bigRise: 8.5, bigFall: 20,
  dip: { under: 60, underMax: 85, day: '10th to last', sellDay: 'first' }, late: { rsiSkip: true, rsiDays: 7, trendDays: 45, fund: 'SOXS' }, soxlDays: 360, soxlEnter: -20, soxlExit: 150, pile: false, twoDays: false };
STRATEGY_LIBRARY.push({
  n: 74, name: '10-25 - SOXL, TQQQ', formerNames: ['SOXL, TQQQ - 2010-2025 fit'], tag: 'picked', runnable: true,
  rules: 'Fitted to 2010-2025: SOXL, TQQQ, QQQ - 1983 fit with sixteen settings moved.\n\n' + fitRules(FIT_2010_2025_CARD),
  here: '\u2014',
  reported: 'Your request (24 November 2026): your copy of SOXL, TQQQ, QQQ - 1983 fit after the Fit button’s “Best CAGR, round numbers” on Q1 2010 to Q4 2025, as a strategy of its own. It is that strategy’s rules with sixteen settings moved, fifteen of them to your panel’s values: the start averaged over ±60 days (55); SQQQ at the ceiling for 10 days (65); the bear exit 25% under the median and only while the median falls (30%, whatever the median does); no limit on days in SQQQ (9); SOXL’s lead over 360 days, held from under −20% until over 150% (330, −75%, 325%); Big days out after a rise of 8.5% (10%); the Month-end dip from the 10th to last day to the first of the next month (3rd, 4th); the late-week trade in SOXS (SQQQ), a week skipped for an RSI over 7 days at 40 or under (no skip), the down trend on a 45-day median (40). The sixteenth is yours of the same day: back to TQQQ at a lead of 40%, where your panel had 30%. Four times since 2010 the lead bottomed between 27% and 30% (June 2012, December 2018, April 2022, April 2025), and 30% caught each by 0.5 to 2.6 points. At 27% the buy of 8 April 2025 is missed and the fit makes 242.1% a year in place of 299.6%; from 28% to 45% it makes 281.2% to 301.9% with the same drawdown. Q1 2010 to Q4 2025, $100K lump sum: 287.4% a year (max drawdown 47.2%, 24 April to 31 May 2019; worst 12 months −12.9%) against 202.0% (52.4%, −7.5%) for the 1983 fit and 202.4% (40.8%, −38.6%) for steady fit. 2010–17 132.5%, 2018–25 544.9%; ahead of the 1983 fit in 14 of the 16 years, behind in 2016 and 2017, no year down. With back at 30% and your panel’s money, $80K and $3K a month, it ends at $532.0T with the same drawdown, as your panel read. These are the years it was fitted on, so they are no test of it. Outside them it trails the 1983 fit on every period measured: January to 23 November 2026 up 394.2% against 1,097.5%; on reconstructed prices, 1986–2009 12.3% a year (max drawdown 97.8%) against 72.9%, from 1983 to 2025 69.9% against 108.6%, from 1953 37.5% against 58.3%. One step away on a setting it is still steep in two places: a lookback of 590 days in place of 585 makes 238.3% with a 76.5% drawdown (587 days already does), and the ceiling at 115% 241.2% with 76.5% (111% already does). The other 34 steps tried make 261.4% to 287.4%. One group of settings put back to the 1983 fit’s value: the late-week RSI skip off 254.0% with a 62.9% drawdown; SQQQ at the ceiling for 65 days 254.2%; the late-week trade in SQQQ 263.3%; SQQQ 9 days at most 268.8%; SOXL 271.5% (2026 up 924%); the bear exit 277.3%. With a switch over two days 274.4%. The late-week trade: 67 trades in SOXS since 2010, 66% of them up, 7.6% each on average; the 16 of 2022 made about 40% of its gain. It holds SOXL on 1,763 of 4,024 closes, cash on 920, TQQQ on 801, SQQQ on 399 and SOXS on 141, in 458 trades.',
});

// #54: #52 with each start price spread over a triangle of days instead of one
// block or one close, the lead settings refit to 2010-2025 (the user,
// 2026-11-09: "i want strategy, where rate will be considered, but should not
// be influenced by when it started measuring"; js/strategy-library-code.js
// withSpreadStart; research/lead-basis). The rules text is #47's shape with
// this entry's numbers; the Monday paragraph is shared with #48-#50, the
// contributions paragraph with #52.
STRATEGY_LIBRARY.push({
  n: 54, name: 'SOXL, TQQQ, QQQ - spread start', tag: 'picked', runnable: true,
  hidden: true,   // the user, 2026-11-09: "remove these from library"; kept in the list so saved copies and share links still resolve
  rules: 'Hold TQQQ, but step aside when its lead over QQQ gets too big or too small. The lead is counted from a spread of starting days, not one block: each start price is an average of past closes weighted like a triangle, most weight 600 trading days back (2.4 years), falling in a straight line to nothing 150 days either side of it (1.8 to 3 years ago).\n\nCeiling: at 97.1% ahead (TQQQ grew about twice as much as QQQ), switch to SQQQ for up to 20 days, then cash. Back to TQQQ at 78.7% ahead.\nFloor: under 56.8% ahead, sell to cash. Back to TQQQ after 5 closes in a row at 92.5% ahead.\nDeep buy: once the lead has fallen to 32.5% ahead, buy TQQQ back. The floor stays off until it is 92.5% ahead again.\nOverextended: while TQQQ is more than 55% above its 250-day median, hold SQQQ.\n\nCrash defence:\nHold SQQQ at most 40 days in a row, then cash.\nSell a deep buy that falls 25%, and buy back when TQQQ closes above its median.\nHold cash instead of TQQQ while credit stress (NFCI) is above 0.5.\n\nChecked at every close. Going between TQQQ and SQQQ takes two days: sell at one close, buy at the next.\n\n' + turnaroundMondayRules('TQQQ', 'hl') + '\n\nSOXL instead of TQQQ:\nThe lead is SOXL’s growth against SOXX’s, counted from the same kind of spread: the weight peaks 500 trading days back and runs out 125 days either side.\nWhile the rules hold TQQQ, hold SOXL from the first close with the lead under 27.4% until the first close with it over 33.9%.\n\nContributions in SOXL:\nA contribution buys SOXL while the rules hold TQQQ.\nAt the switch to SQQQ, the pile is sold once SQQQ is bought; its money joins the strategy the close after.\nWhen the rules sell TQQQ to cash, the pile waits in cash and buys SOXL again at the next TQQQ buy.\nA withdrawal comes out of the pile first.',
  here: '\u2014',
  reported: 'Your request (9 November 2026): a lead “not influenced by when it started measuring”. This is #52 with each start price spread over a triangle of days instead of one block (TQQQ, QQQ) or one close (SOXL, SOXX), the lead settings refit to 2010–2025 with a $100K lump sum (research/lead-basis), the rest #52’s. Two spreads were tested at the breadth of the lead-basis study: this triangle, and a fading (exponential) average with no start day at all. On TQQQ vs QQQ + Turnaround Monday the fading average lost the signal: 116.5% a year in-sample, inside what a scrambled lead reaches by chance, and 29.9% a year walk-forward 2016–2026 against 34.4% for buy & hold TQQQ. The triangle kept most of it: 129.4% in-sample (the scrambled band reaches 132.5%), 77.7% walk-forward against 84.0% for the block start. Inside this strategy, refit with eight starts, the triangle made 205.8% a year 2010–2025 with a 72.5% drawdown (4 to 20 March 2020, in SOXL) against 200.0% and 55.1% for the block start refit the same way, and 177.0% and 47.2% for #52’s own defaults; 2010–17 137.8% against 100.6%, 2018–25 291.1% against 280.5%; 2026 to date +255% a year against +392%; from 1983 59.1% against 62.5%, from 1953 31.3% against 29.0%. It trades more (427 trades against 313) and sits in cash on 1,222 of 4,024 days against 828. Both leads chose a spread of a quarter of the lookback with 10% to 100% offered. The spread does not flatten the lookback dropdown: 40 days either side of the default, 17 of the 80 one-day steps move the end value by more than half, against 8 for #52. The cliffs come from the all-or-nothing lines, not from the start day: on #53 a lookback of 558 against 559 ended 110 times apart since 1953 over one close 0.1 point from the deep-buy line on 20 March 2020. The fit’s floor (56.8%) sits above its deep buy (32.5%): sold under the floor, it buys back either once the lead has fallen to 32.5% or once it is back over 92.5%. Scrambled leads fitted the same way inside this strategy reach 172% at best (median 150%), so the 205.8% is not the search alone; but refit on six past years and tested on the next, 2016–2026, the spread start makes 102.7% a year chained against 159.1% for the block start, and fitted on one half of 2010–2025 and tested on the other 124% / 72% against 132% / 94%. Out of sample the block start wins on every count. Figures before 2010 in this note were measured before 10 November 2026, when SOXL and SOXX history before May 1994 was added from a stand-in and the Monday rule began taking every down Monday.',
});

// #55, #56 (the user, 2026-11-09: "let's include 2x4", from a search for leveraged-fund strategies the
// library lacked): a calendar rule and a price-channel trend rule, neither mechanism present before.
// Defaults fitted to 2010-2025 (js/strategy-library-code.js); the published settings' numbers are in the card.
STRATEGY_LIBRARY.push({
  n: 55, name: 'Bare seasonal', formerNames: ['Seasonal TQQQ'], tag: 'academic', runnable: true, src: 'HAL',
  rules: 'Hold TQQQ by the calendar, decided at each close from the calendar alone: TQQQ while tomorrow is inside the window, cash (or QQQ) outside it.\n\nThe season: from the first trading day of May to the last trading day of November, out from December to April. The published form is the Halloween indicator, November to April, the other way round.\nThe turn of the month: TQQQ through the last trading day of each month and the first three of the next.\n\nA switch between TQQQ and QQQ takes two days: sell at one close, buy at the next.',
  here: '\u2014',
  reported: 'Bouman and Jacobsen (2002): November to April beat May to October in 36 of 37 markets since 1970; Lakonishok and Smidt (1988): the last and first few trading days carry most of a month\u2019s return. On TQQQ, $100K lump sum: the Halloween months November to April with cash made 15.3% a year 2010\u20132025 (max drawdown 70%), with QQQ outside the window 25.1% (71%); the turn of the month, last 1 and first 3 days, 9.2% (39%); buy & hold TQQQ 39.6% (82%). Since 26 November 2026 the defaults are your pick on the map of 2010\u20132025: May to November with cash, the Halloween months turned around. With the cost and the interest: 2010\u201317 24.3% a year, 2018\u201325 40.2%, 2026 to date \u221228%; on the reconstruction, 1983\u20132009 \u22126.6% and 1953\u20131982 1.4%. Before it the defaults were the fit over every start and end month pair and both parking choices, October to July with cash: 44.6% a year with a 75% max drawdown on 2010\u20132025 at the same cost and interest, 10 months of 12 in TQQQ, 33 trades in 16 years. The turn pattern\u2019s own fit ran to "nearly every day in", so its defaults stay the published 1 and 3.' },
{
  n: 56, name: 'Bare Donchian breakout', formerNames: ['Donchian breakout + ATR stop'], tag: 'crossover', runnable: true, src: 'TRT',
  rules: 'Buy TQQQ when it closes above its highest close of the last 19 days. Sell when it closes under its lowest close of the last 40 days, or under a trailing stop 4.5 average daily moves below its highest close since the buy, the average move over the last 5 days. Cash while out.\n\nThe channels and the average move read closes only, so the rule is the same on every day of the chart. Its position before the Entry is replayed, so a moved Entry inside a trend starts long.',
  here: '\u2014',
  reported: 'The Turtle rules (Dennis and Eckhardt, 1983; Curtis Faith, Way of the Turtle): buy a 20- or 55-day breakout, exit a 10- or 20-day low or a stop two true ranges below the peak. On TQQQ at the close, $100K lump sum, 2010\u20132025: 55/20 with a 3-move stop 3.0% a year (max drawdown 39%), 55/20 without the stop 13.1% (46%), 20/10 with a 2-move stop 9.2% (41%); buy & hold TQQQ 39.6% (82%). Since 26 November 2026 the defaults are your pick on the map of 2010\u20132025: a 19-day breakout, a 40-day exit, and a stop 4.5 average moves below the peak, the moves over 5 days. With the cost and the interest: max drawdown 36% (April to August 2010) where the defaults before fell 80%; 2010\u201317 26.8% a year, 2018\u201325 42.4%, 2026 to date +9%; on the reconstruction, 1983\u20132009 19.4% and 1953\u20131982 29.5%; 148 trades in 16 years. Without the stop the same channels make 29.1% with a 62% drawdown. One step either way: the breakout at 15 or 20 days 33.0% or 32.4%, the exit at 35 or 45 days 31.2% or 33.8%, the stop at 4 or 5 moves 34.6% or 31.8%, its moves over 7 days 29.3%. Before it the defaults were the fit over the option grids: a 15-day breakout, a 100-day exit, no stop, 38.3% a year with an 80% max drawdown at the same cost and interest, 31 trades.' });
// The user (2026-11-09): the two sit at the top of the catalog's second page, after the first eight.
STRATEGY_LIBRARY.splice(8, 0, ...STRATEGY_LIBRARY.splice(STRATEGY_LIBRARY.length - 2, 2));

// #57-#60, the bare entries (the user, 2026-11-20: "I want the bare strategies to be added separately
// in strategy library, and add bare in their naming ... the idea is to explore simplest form of them
// and see how they are working in current market"): one rule of the picked strategies each, with
// nothing around it (js/strategy-library-code.js bareStrategy). Pushed after the move above, so they
// stay together at the end of the catalog. Numbers: this app's backtest,
// $100K lump sum, Q1 2010 to Q4 2025, then 2026 to 18 November.
// The same day the user asked for the basic rules of every library strategy as bare entries ("in some
// case you might just need to rename"): #7, #10, #19, #20, #26, #55 and #56 above were one rule
// already and took "Bare" into their names where they stand; #61-#70 below are the rules that existed
// only inside bigger strategies (numbers to 19 November 2026).
// Three of the first four can hold another fund in place of cash (the user, 2026-11-20: "have an option to
// keep other, like qqq, or gld"); their cards end with this line.
const bareOtherFundRules = 'As a setting, QQQ, GLD or another fund is held in place of cash. A switch between two funds sells at one close and buys at the next.';
STRATEGY_LIBRARY.push(
  { n: 57, name: 'Bare Turnaround Monday', tag: 'bare', runnable: true,
    rules: 'Hold cash. When TQQQ closes a Monday under the prior day’s low, buy TQQQ. Sell at the first close above the prior day’s high.\n\n' + bareOtherFundRules,
    here: '—',
    reported: 'The Turnaround Monday rule that the “+ Turnaround Monday” strategies trade in their idle cash, here on its own. Q1 2010 to Q4 2025, cash at 4% a year: 28.5% a year (max drawdown 32%, worst 12 months −17%) against 40.0% (82%) for buy & hold TQQQ; 24.1% with cash earning nothing. In TQQQ on 12% of days: 151 trades, 79% of them up, TQQQ +2.6% a trade. 2010–17 26.1%, 2018–25 30.8%. January to 18 November 2026: up 26.5%, 9 trades, 7 up. With the prior close as both levels: 27.6% a year (29%), 301 trades, 75% up, +1.3% a trade, 2026 up 3.5%. With another buying day, same years: Tuesday 26.1% (47%), Wednesday 17.7% (53%), Thursday 7.5% (55%), Friday 16.0% (51%). With QQQ held between trades the purchase comes a day after the Monday, and a trade over by then is skipped: 21.4% a year (42%), 117 trades, +1.7% a trade, against 18.7% for QQQ alone; with both legs at one close 34.5% (36%). With GLD: 19.0% (31%). On the reconstructed prices 1985–2009: 35.1% a year with an 80% drawdown.' },
  { n: 58, name: 'Bare credit veto', tag: 'bare', runnable: true,
    rules: 'Hold TQQQ while credit stress (the Chicago Fed’s NFCI) is at or under −0.76, and SPXL while it is above. Each weekly reading is used a week after its week ends. A switch between the two sells at one close and buys at the next.\n\nAs a setting, cash or another fund is held in place of SPXL.',
    here: '—',
    reported: 'The credit rule of NFCI veto and the strategies built on it, here on its own. Since 26 November 2026 the defaults are your pick on the map of 2010 to 2025: the level at −0.76 (0.4 before) and SPXL while it is above (cash before). The index has read under 0 on most days since 2010 and above −0.76 on most of them, so this holds SPXL more than TQQQ. Q1 2010 to Q4 2025: SPXL on 2,721 of 4,024 closes, TQQQ on 1,265, 76 trades; 40.7% a year, max drawdown 64% (3 January to 12 October 2022; worst 12 months −59%) against 40.0% and 82% for buy & hold TQQQ. With cash in place of SPXL 12.1% (max drawdown 62%). One step either way: −0.78 35.3%, −0.74 39.1%. January to 25 November 2026: up 2% against −14% for TQQQ. At 0.4 the index last read above the level in August 2009, so from 2010 that was buy & hold TQQQ with no trade. It is fitted on 2010 to 2025; before 2010, on the reconstructed prices, it lost: 2007–2009 −39.8% a year (max drawdown 96%) against 32.0% (32%) for the 0.4 level with cash and −25.0% for TQQQ held; 1971–2009 −0.4% a year against 5.8%.' },
  { n: 59, name: 'Bare month-end dip', tag: 'bare', runnable: true,
    rules: 'Hold cash. At the close of the 5th to last trading day of a month, buy TQQQ if it is 30% to 50% under its 1-year high. Sell at the close of the next month’s first trading day.\n\n' + bareOtherFundRules,
    here: '—',
    reported: 'The Month-end dip rule of SOXL, TQQQ, QQQ - 1983 fit, here on its own. Q1 2010 to Q4 2025, cash at 4% a year: 12.8% a year (max drawdown 23%) against 40.0% (82%) for buy & hold TQQQ; 8.5% with cash earning nothing. In TQQQ on 2% of days: 19 trades, 17 up, TQQQ +7.6% a trade. 2010–17 11.4%, 2018–25 14.1%. The last trade: 24 April to 1 May 2025, +8.9%. January to 18 November 2026: no trade. With QQQ held between trades: 23.8% a year (34%) against 18.7% for QQQ alone, the 19 trades +6.9% each, bought a day later; with GLD 15.8% (46%) against 8.5% for GLD alone. On the reconstructed prices 1985–2009: 13.5% a year (27%).' },
  { n: 60, name: 'Bare big days', tag: 'bare', runnable: true,
    rules: 'Hold TQQQ. After it rises 15% or more in a day, sell and buy back at the next close.\n\nAs a setting, the other half: hold cash, and after TQQQ falls 15% or more in a day, buy it and sell at the next close.',
    here: '—',
    reported: 'The Big days rule of the “+ Turnaround Monday” strategies and SOXL, TQQQ, QQQ - 1983 fit, here on its own. Q1 2010 to Q4 2025: 47.6% a year (max drawdown 83%) against 40.0% (82%) for buy & hold TQQQ. Nine sales: TQQQ fell the next day after seven of them and moved −8.3% on average over the nine. Five of the nine were in March 2020; with those five undone, 40.5%. 2010–17 47.8%, the same as TQQQ (no such day); 2018–25 47.5% against 32.6%. The last sale: 9 April 2025 (+35.2%, then −12.3%). January to 18 November 2026: no such day. The other half, from cash: 6.9% a year with cash at 4% (2.8% with cash earning nothing), 7 trades, 5 up, TQQQ +7.5% a trade; in 2026 one, bought on 5 November after −18.9%, +3.5% the next day.' },
  { n: 61, name: 'Bare crash exit', tag: 'bare', runnable: true,
    rules: 'Hold TQQQ. Sell to cash when it closes 28% under its 250-day median while the median is rising less than 20% a year and it has closed under the median 10 days in a row. Buy back at the first close above that level.\n\n' + bareOtherFundRules,
    here: '\u2014',
    reported: 'The crash exit of NFCI veto and Overextension + crash exit, here on its own. Q1 2010 to Q4 2025: 45.5% a year (max drawdown 70%, worst 12 months −48%) against 40.0% (82%) for buy & hold TQQQ. Out 5 times; TQQQ fell during one, and moved −6.7% on average while out. 2010–17 45.7%, 2018–25 45.2%. The last time out ended on 20 January 2023. January to 19 November 2026: in TQQQ throughout, −6.5%.' },
  { n: 62, name: 'Bare sell line', tag: 'bare', runnable: true,
    rules: 'Hold TQQQ. Sell on the first close 3% under its 250-day median. Buy back after five closes in a row above that line.\n\n' + bareOtherFundRules,
    here: '\u2014',
    reported: 'The sell line of SQQQ stretch + buy-back, here on its own, without its earlier way back after deep corrections and without its buy-back line. Q1 2010 to Q4 2025: 35.1% a year (max drawdown 53%, worst 12 months −39%) against 40.0% (82%) for buy & hold TQQQ. Sold 19 times; TQQQ fell during two, and moved +5.5% on average while sold. 2010–17 31.3%, 2018–25 39.1%. January to 19 November 2026: −2.7% against −6.5%; sold since 2 November.' },
  { n: 63, name: 'Bare buy-back line', tag: 'bare', runnable: true,
    rules: 'Hold cash. Buy TQQQ at the first close 34% under its 250-day median. Sell at the first close above the sell line, 3% under the median.\n\n' + bareOtherFundRules,
    here: '\u2014',
    reported: 'The buy-back line of SQQQ stretch + buy-back as a trade of its own. There it only acts while the sell line has sold, and the TQQQ it buys is kept; here the trade ends at the first close back above the sell line, the stretch the buy-back adds. Without that strategy’s stop on the buy. Q1 2010 to Q4 2025, cash at 4% a year: 16.5% a year (max drawdown 62%) against 40.0% (82%) for buy & hold TQQQ. In TQQQ on 9% of days: 6 trades, 5 up, TQQQ +43.2% a trade. 2010–17 9.1%, 2018–25 24.3%. The last trade ended on 14 May 2025. January to 19 November 2026: no trade.' },
  { n: 64, name: 'Bare ceiling', tag: 'bare', runnable: true,
    rules: 'Hold TQQQ. When its lead over QQQ, counted from their average price 1.9 to 2.4 years ago, reaches 123%, step aside to cash. Go back once the lead is down to 28%.\n\n' + bareOtherFundRules,
    here: '\u2014',
    reported: 'The ceiling of SOXL, TQQQ, QQQ - 1983 fit, with the settings it had until 21 November 2026, here on its own. The full strategy holds SQQQ for a set number of days at the ceiling; here it is cash unless another fund is picked. Q1 2010 to Q4 2025: 67.2% a year (max drawdown 70%, worst 12 months −52%) against 40.0% (82%) for buy & hold TQQQ. Aside 5 times; TQQQ fell during all five, by 40.1% on average. 2010–17 60.1%, 2018–25 74.6%. The last time aside ended on 8 April 2025. January to 19 November 2026: in TQQQ throughout, −6.5%.' },
  { n: 65, name: 'Bare floor', tag: 'bare', runnable: true,
    rules: 'Hold TQQQ. When its lead over QQQ, counted from their average price 1.9 to 2.4 years ago, falls under 0%, sell to cash. Buy back after 10 closes in a row at 35% or more, or within 20 days after 3 closes in a row at 2% or more.\n\n' + bareOtherFundRules,
    here: '\u2014',
    reported: 'The floor SOXL, TQQQ, QQQ - 1983 fit had until 20 November 2026, with its settings and its way back, here on its own: no deep buy, no Monday or month-end trades in the cash. Q1 2010 to Q4 2025: 19.1% a year (max drawdown 84%, worst 12 months −72%) against 40.0% (82%) for buy & hold TQQQ. Sold 4 times; TQQQ rose during all four, by 112% on average: alone, the floor waits out most of each recovery. 2010–17 40.2%, 2018–25 1.2%. January to 19 November 2026: in TQQQ throughout, −6.5%. Since 20 November 2026 the floor is 0%; at the 6% before it made 20.7% a year and sold on 19 November. Later that day that strategy dropped its floor for a bear exit; this entry keeps the floor as it was.' },
  { n: 66, name: 'Bare deep buy', tag: 'bare', runnable: true,
    rules: 'Hold cash. Once TQQQ’s lead over QQQ, counted from their average price 1.9 to 2.4 years ago, has fallen under 0%, buy TQQQ at the first close with the lead at −30.5% or lower. Sell once the lead is back at 35%.\n\n' + bareOtherFundRules,
    here: '\u2014',
    reported: 'The deep buy SOXL, TQQQ, QQQ - 1983 fit had until 20 November 2026, as a trade of its own. There it only acted while the floor was broken, and the TQQQ it buys is kept; here the trade ends once the lead is back at the re-entry level, the stretch the deep buy adds. Without that strategy’s guard on the buy. Q1 2010 to Q4 2025, cash at 4% a year: 24.8% a year (max drawdown 43%, worst 12 months −18%) against 40.0% (82%) for buy & hold TQQQ. In TQQQ on 19% of days: 3 trades, all up, TQQQ +198% a trade. 2010–17 9.1%, 2018–25 42.7%. The last trade ended on 3 July 2024. January to 19 November 2026: no trade; the floor has not broken. Since 20 November 2026 the floor is 0%; the three trades are the same at 6%. Later that day that strategy dropped its floor and deep buy for a bear exit; this entry keeps the deep buy as it was.' },
  { n: 67, name: 'Bare SOXL lead', tag: 'bare', runnable: true,
    rules: 'Hold TQQQ. Hold SOXL instead from the first close with SOXL’s lead over SOXX, its growth over 380 trading days against SOXX’s, under −33% until the first close with it over 101%. A switch sells at one close and buys at the next.',
    here: '\u2014',
    reported: 'The “SOXL instead of TQQQ” rule of SOXL, TQQQ, QQQ - 1983 fit, with the settings it had until 21 November 2026, here on its own. Q1 2010 to Q4 2025: 53.0% a year (max drawdown 87%, worst 12 months −85%) against 40.0% (82%) for buy & hold TQQQ. In SOXL 5 times; SOXL did better than TQQQ over three of them, by 27.9% on average over the five. 2010–17 55.0%, 2018–25 51.0%. January to 19 November 2026: up 172.2% against −6.5%; in TQQQ since 7 May.' },
  { n: 68, name: 'Bare RSI overheat', tag: 'bare', runnable: true,
    rules: 'Hold TQQQ. When QQQ’s RSI(10) reaches 85, sell to cash. Buy back once it is under 60.\n\n' + bareOtherFundRules,
    here: '\u2014',
    reported: 'The overheat exit and cool gate of 200-day SMA + RSI, also in the SMA panel and Composer TQQQ-RSI with other numbers, here on its own. Q1 2010 to Q4 2025: 44.0% a year (max drawdown 82%) against 40.0% (82%) for buy & hold TQQQ. Out 13 times; TQQQ fell during ten, and moved −3.2% on average while out. 2010–17 50.8%, 2018–25 37.6%. January to 19 November 2026: −2.1% against −6.5%.' },
  { n: 69, name: 'Bare RSI(2) dip-buy', tag: 'bare', runnable: true,
    rules: 'Hold cash. Buy TQQQ when QQQ’s RSI(2) drops under 20. Sell once it is over 95.\n\n' + bareOtherFundRules,
    here: '\u2014',
    reported: 'The entry and exit of Connors RSI(2) dip-buy without its trend filter. Q1 2010 to Q4 2025, cash at 4% a year: 42.9% a year (max drawdown 69%, worst 12 months −58%) against 40.0% (82%) for buy & hold TQQQ. In TQQQ on 65% of days: 135 trades, 78% up, TQQQ +5.1% a trade. 2010–17 32.7%, 2018–25 53.8%. January to 19 November 2026: −26.2% against −6.5%.' },
  { n: 70, name: 'Bare MACD', tag: 'bare', runnable: true,
    rules: 'Hold TQQQ while QQQ’s MACD (12, 26, 9) is above its signal line and above zero. Cash otherwise.\n\n' + bareOtherFundRules,
    here: '\u2014',
    reported: 'The signal of Petrou weekly MACD without its trailing stop. Q1 2010 to Q4 2025, cash at 4% a year: 20.9% a year (max drawdown 38%, worst 12 months −36%) against 40.0% (82%) for buy & hold TQQQ. In TQQQ on 43% of days: 144 trades, 47% up, TQQQ +2.3% a trade. 2010–17 15.8%, 2018–25 26.2%. January to 19 November 2026: up 45.0% against −6.5%.' },
  // #72 (the user, 2026-11-23: "let's add one bare strategy, in downtrend, buy sqqq on wed close and buy tqqq
  // on Fridays close"). Numbers: this app's backtest, $100K lump sum, Q1 2010 to Q4 2025, then 2026 to 20 November.
  { n: 72, name: 'Min - late-week SQQQ', formerNames: ['Short strat - late-week SQQQ'], tag: 'short', runnable: true,
    rules: 'Hold TQQQ. In a week where TQQQ’s Wednesday close is under the median of the 30 closes before it, switch to SQQQ at that close and back to TQQQ at Monday’s close: SQQQ is held over Thursday, Friday and Monday. If TQQQ is not under Wednesday’s close at Friday’s close, it is bought back there and held over Monday. The week is skipped when TQQQ’s RSI over 10 days is at 40 or under at that close. A skipped week is still taken for one day, SQQQ over Thursday, when SOXX’s return over 20 days is under QQQ’s by more than 2% at that close. The down trend is read at Wednesday’s close and not again before Monday’s.\n\nAs settings: another fund in TQQQ’s place, and another fund to read the down trend on; cash or another fund in place of SQQQ; the two closes; the line’s length (2 to 500 days), average or median, and how many percent under it the close must be (a negative number: less than that far over it); the check before a weekend, on or off; one trade per day, where a switch between two funds sells at one close and buys at the next (TQQQ is then sold at Tuesday’s close and SQQQ at Friday’s); the skip of the weeks that start with a low RSI: on or off, its fund, its length and its level; and the lagging-fund rule: on or off, its two funds, its length, its level, and one day or the days before the weekend.',
    here: '\u2014',
    reported: 'From the weekday study of 23 November 2026: since 2010, on days that began with TQQQ under its 50-day average, its Thursdays averaged −0.48% and its Fridays −0.27%, against +1.05% on Tuesdays and +0.77% on Wednesdays; most of the weakness sits in the week of the monthly options expiry. The settings are the ones you set as the default on 24 November 2026: those of 23 November with the weekend check and the lagging-fund rule added. Q1 2010 to Q4 2025: 149.1% a year (max drawdown 56%, worst 12 months −39%) against 40.0% (82%) for buy & hold TQQQ. In SQQQ on 11% of days; out of TQQQ 217 times: 170 down-trend weeks, back before the weekend in 72 of them, and 47 skipped weeks taken for a day. 2010–17 161.6% against 47.8%, 2018–25 137.2% against 32.6%. January to 23 November 2026: up 251.2% against −6.3%. The lagging-fund rule, from the study of 24 November 2026 into the falls of 5 and 19–20 November, both in weeks the RSI skipped: of about 1,250 conditions read at Wednesday’s close, SOXX against QQQ told the skipped weeks that fell from those that bounced. Where SOXX’s 20-day return trailed QQQ’s by more than 2%, TQQQ fell on the Thursday by 3.2% on average in 2010–17, 1.4% in 2018–25 and 2.3% in 2026; where it led by more than 2%, TQQQ moved −0.1%, +3.5% and +2.7%. Without the rule: 120.8% a year (50%, worst 12 months −30%), 2010–17 128.5%, 2018–25 113.5%, 2026 up 177.6%. With it the routine was ahead in 12 of the 16 years, level in 2013 and behind in 2018, 2021 and 2024. It is a fitted rule. With the choosing counted, 40 of 2,000 shuffles of the skipped weeks’ results did as well. 20 days with 2% is the best of its neighbours: 15 days 134.6%, 25 days 128.9%, 1.5% 135.6%, 2.5% 139.3%. Its 52 weeks made ×8.7 against holding TQQQ, ×1.5 without the five best. The worst 12 months go from −30% to −39%. Staying out to the weekend in place of one day: 145.7% a year (53%, worst 12 months −36%), 2010–17 164.0%, 2018–25 128.7%, 2026 up 370.6%; it holds SQQQ over 20 November too, but Friday was flat on average in those weeks in 2010–2025. The weekend check, from the study of 24 November 2026: in the weeks taken, TQQQ’s Monday went the way of its Thursday and Friday. After a fall it averaged −1.26% in 2010–17 and −1.18% in 2018–25; after a rise, +1.13% and +1.17%. Without the check: 124.8% a year (66%, worst 12 months −56%), 2010–17 135.8%, 2018–25 114.4%. With it the routine was ahead in 12 of the 16 years, level in 2020 and behind in 2012, 2022 and 2025, and ahead in both halves in each of 396 versions of the routine tried without the lagging-fund rule: a line of 10 to 200 days, average or median, the down trend on TQQQ or QQQ, the RSI skip off or at 30 to 45. In 2026 it is behind: up 251.2% against 297.9% without it. Five Mondays were given up and two of them fell, 3.6% and 5.7%. The same check a day earlier loses: leaving the Friday out after a Thursday rise makes 80.6% a year against 99.3%, with neither added rule on. With the RSI over 9 days, the default earlier that day: 153.8% a year (51%, worst 12 months −33%), 2010–17 176.0%, 2018–25 133.4%, 2026 up 251.2%. The first default of 23 November, with the down trend read on QQQ, TQQQ back at Friday’s close and the RSI over 9 days: 131.8% a year (46%, worst 12 months −13%), 2010–17 124.2%, 2018–25 139.6%, 2026 up 206.7%; it has no weekend inside its days out. One step away on a setting: the RSI level at 39 makes 132.8% a year, at 41 142.0%; the RSI over 9 days 153.8%, over 11 days 144.5%; the 29-day median 152.0%, the 31-day 152.5%, the 50-day 125.4%; the down trend read on QQQ 151.6%; back at Friday’s close 117.7%, at Tuesday’s 124.9%; out at Thursday’s close 54.1%. With cash in place of SQQQ: 95.3% a year (52%, worst 12 months −33%), 2010–17 103.0%, 2018–25 87.8%, 2026 up 93.6%; with GLD 96.9% (52%), with QQQ 74.8% (57%). With one trade per day: 53.4% a year (70%), 2010–17 59.1%, 2018–25 47.9%, 2026 up 113.8%; it costs Wednesday, a strong day in a down trend, and moving the first close to Thursday keeps more of it: 60.4% (73%), 2026 up 133.8%. The weekend check and the lagging-fund rule are left out there. Without the RSI skip: 83.0% a year (81%, worst 12 months −80%), 2010–17 90.5%, 2018–25 75.7%, 2026 up 170.3%. In the weeks it skips TQQQ rose 1.5% on average over the days out in 2010–2025, against a fall of 1.6% in the weeks taken; in 2026 those weeks rose 2.6% against a fall of 3.2%. At a level of 50 it skips too many weeks (72.5%). A week short of a day keeps the days out; with one trade per day TQQQ then comes back a close late. The entry’s first settings, TQQQ’s own 50-day average, TQQQ back at Friday’s close and no skip: 62.8% a year (70%, worst 12 months −59%), 2010–17 65.6%, 2018–25 60.0%, 2026 up 524.1%.' },
  // #73 (the user, 2026-11-24, on that day's study of #72 and the fits' overextended line in one account: "I like
  // this, put it in a separate strategy"); defaults since 2026-11-26 the user's pick on the map ("set this as default for this
  // strategy"). Numbers: this app's backtest, $100K lump sum, Q1 2010 to Q4 2025, then 2026 to 25 November.
  { n: 73, name: 'Late-week + overextended SQQQ', tag: 'short', runnable: true,
    rules: 'Min - late-week SQQQ with one more rule. Hold SQQQ while TQQQ closes more than 54% above the median of its last 242 closes, today’s included, and go back to TQQQ at the first close that does not. It is the overextended line of SOXL, TQQQ, QQQ - 1983 fit and steady fit, read the same way. The rest is Min with three settings of its own: in a week where TQQQ’s Wednesday close is under the median of the 41 closes before it, or less than 0.5% over it, SQQQ from that close to Monday’s, with its weekend check, its RSI skip (TQQQ’s RSI over 9 days at 40 or under) and its lagging-fund rule.\n\nAs settings: every setting of Min; and for the line: on or off, the fund read, the level, the median’s length, and cash or another fund in place of SQQQ. On Min’s own days out, the fund Min holds in between comes first.',
    here: '—',
    reported: 'The settings are the ones you set as the default on 26 November 2026, from the map of Q1 2010 to Q4 2025: the line at 54% over the 242-day median (was 55% and 255 days), and Min’s down trend under the 41-day median or less than 0.5% over it (was under the 30-day median), with the RSI over 9 days (was 10). Q1 2010 to Q4 2025: 223.9% a year (max drawdown 43%, August 2024 to March 2025, worst 12 months −7%) against 198.3% (56%, −21%) at the settings before, 157.3% (43%, −34%) for these settings without the line, and 40.0% (82%) for buy & hold TQQQ. 2010–17 209.5%, 2018–25 238.9%. January to 25 November 2026: up 471.8%, against 528.4% at the settings before and −13.6% for TQQQ. Against the settings before it was ahead in 8 of the 16 years and behind in 8, most in 2019 (73% against 259%) and 2023 (166% against 244%). One step either way on any of the six settings of the down trend, the RSI and the line: 212.1% to 223.6% a year. In SQQQ on 20% of days; out of TQQQ 276 times. The two rules act at opposite ends: of the 383 closes over the line in 2010–2025, Min held SQQQ on 7. The line’s 67 stays: SQQQ rose over 56 of them, ×5.8 in all and ×3.7 without the five best. The line at 45%: 165.3% a year; 50%: 193.0%; 55%: 214.5%; 60%: 197.6%. Cash over the line: 193.1%; GLD 193.6%; QQQ 180.2%. One trade per day: 94.5%. Without the weekend check: 186.6%; without the lagging-fund rule: 187.9%. Your request when it was built (24 November 2026), on that day’s study of Min and the overextended line in one account: “I like this, put it in a separate strategy”. The line then held the fits’ own 255 days and 55%, fitted on these same years, and its stays put at random places made 108.1% a year at the median, none of 2,000 as well.' },
  // #75 (the user, 2026-11-26, on a screenshot of their copy of #73 after a pick on the map of 1984 to 2025: "Create this
  // new strategy, call it Late week 84-25 steady fit"; renamed the same day: "let's call all 1984 fitted strategies 1984 -
  // then primary name", then "actually make them to start with 84-25"). Numbers: this app's backtest, $100K lump sum; 1984 to 2025 from the
  // close of 30 December 1983, Q1 2010 to Q4 2025, then 2026 to 25 November.
  { n: 75, name: '84-25 - Late-week + overextended SQQQ', formerNames: ['Late week 84-25 steady fit', '1984 - Late-week + overextended SQQQ'], tag: 'short', runnable: true,
    rules: 'Fitted to 1984-2025: Late-week + overextended SQQQ with 13 settings moved. Hold SQQQ while SOXX closes more than 44% above the median of its last 234 closes, today’s included, and go back to TQQQ at the first close that does not. In a week where TQQQ’s Wednesday close is under the median of the 28 closes before it, or less than 3.5% over it, SQQQ from that close to Monday’s, with the weekend check. The week is skipped when SPY’s RSI over 6 days is at 32.5 or under at that close, and such a week is still taken, through the days before the weekend, when SSO’s return over 10 days is under QLD’s by more than 1.5%.\n\nAs settings: every setting of Late-week + overextended SQQQ.',
    here: '—',
    reported: 'Your request (26 November 2026): your copy of Late-week + overextended SQQQ after a pick on the map of 1984 to 2025, as a strategy of its own. Later that day you set its defaults to a second pick on the same map, 11 settings moved (the first pick’s in brackets): the down trend under the 28-day median (33) or less than 3.5% over it (1.5%); the RSI read on SPY (QQQ) over 6 days (9), at 32.5 (30.5); the lagging-fund rule on SSO (SOXX) against QLD (QQQ), over 10 days (12), by more than 1.5% (5.5%); and the line at 44% (43%) over SOXX’s 234-day median (233). Against Late-week + overextended SQQQ 13 settings differ. Your map’s numbers, 109.2% a year and a 70.2% max drawdown on 1984 to 2025 with $80K and $3K a month, are these settings’: 109.1% and 70.2% here. It is fitted on 1984 to 2025, so those years are no test of it. 1984 to 2025 (prices before 2010 reconstructed, SOXX before 1994 from a stand-in for its index): 105.9% a year (max drawdown 70.2%, July 2001 to April 2002; worst 12 months −65%) against 99.4% (75.1%, −70%) for the first pick, 65.2% (99.9%) for Late-week + overextended SQQQ and 11.5% for buy & hold TQQQ. Q1 2010 to Q4 2025 it makes less than the first pick: 92.8% a year (max drawdown 62.9%, May to December 2022; worst 12 months −48%) against 110.7% (64.8%, −54%), 223.9% (42.6%) for Late-week + overextended SQQQ and 40.0% for buy & hold TQQQ; 2010–17 91.5% (111.9%), 2018–25 94.2% (109.4%). Since 2010 it was ahead of the first pick in 8 of the 16 years and behind in 8; 2018 (−19%) and 2024 (−8%) were down. January to 25 November 2026: up 164.4% against 101.9% for the first pick, 471.8% for Late-week + overextended SQQQ and −13.6% for TQQQ. One step either way on any of its eight number settings makes 94.7% to 106.5% a year on 1984 to 2025 and 83.9% to 93.9% on 2010 to 2025; the steepest is the RSI over 5 days (94.7%, max drawdown 85.5%). The line read on TQQQ in place of SOXX: 77.6% on 1984 to 2025, 93.9% since 2010; the RSI read on TQQQ: 84.5% and 94.3%. Without the line: 82.7% (max drawdown 94.7%) on 1984 to 2025, 92.7% since 2010. Over 1984 to 2025 SOXX closed over the line in 54 stretches, and SQQQ rose over 47 of them; since 2010 in 5, and SQQQ rose over 4. In SQQQ on 25% of days since 1984, 20% since 2010.' });

// The entries given a trading cost and cash interest on 26 November 2026 (withCostAndCash in
// js/strategy-library-code.js; the user: "make sure all strategies have switching cost and cash percentage"). Their
// notes were measured without them; each says what its defaults make with them, Q1 2010 to Q4 2025, $100K lump sum:
// [CAGR %, max drawdown %] (tests/library-cost-cash.cjs's run).
const COST_CASH_RESULTS = { 1: [42.5, 70], 2: [24.5, 53], 3: [18.3, 39], 8: [39.0, 44], 10: [43.8, 60], 12: [14.3, 25], 13: [44.8, 77], 15: [41.6, 54],
  17: [21.0, 38], 18: [36.0, 72], 19: [43.6, 70], 20: [42.9, 75], 22: [32.4, 65], 23: [37.3, 62], 24: [41.5, 39], 25: [40.9, 59], 55: [32.0, 59], 56: [34.4, 36] };
for (const [n, [cagr, dd]] of Object.entries(COST_CASH_RESULTS)) {
  const entry = STRATEGY_LIBRARY.find(e => e.n === +n), said = `Now with 4% a year on cash and 0.02% per trade: ${cagr.toFixed(1)}% a year, max drawdown ${dd}% (2010–2025).`;
  entry.reported = /[.!?]$/.test(entry.reported) ? entry.reported + ' ' + said : entry.reported + ' · ' + said;
}

const STRATEGY_SRC_LINKS = {
  HAL: 'https://papers.ssrn.com/sol3/papers.cfm?abstract_id=76248',
  TRT: 'https://bigpicture.typepad.com/comments/files/turtlerules.pdf',
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

// Bounds for the card's era windows and the catalog's "2010–today". `null` end → last available bar.
const SL_ERA_BOUNDS = {
  '1953': ['1953-01-01', null],   // whole span — overlaps the four below by design
  '1980': ['1980-01-01', '2000-03-31'],
  '2000': ['2000-03-31', '2009-03-31'],
  '2009': ['2009-03-31', '2025-12-31'],
  '2026': ['2025-12-31', null],   // shares the 2009-era boundary, like the others
  '2010': ['2010-01-01', null],
};
// The last twelve months: a window that ends at the last bar and starts at the close a year before it.
const SL_LAST_YEAR = 'year';
// The windows a card's ⓘ gives, with no column in its era table: the two the catalog sorts by besides
// the whole span (the user, 2026-11-24: "sort based on name, difficulty 2010-today return, last year
// return, all time return"). `unit` follows the return; `trades`: with the count of trades the catalog sorts by.
const SL_FACT_WINDOWS = [
  { key: '2010', label: '2010–today', unit: ' a year', trades: true },
  { key: SL_LAST_YEAR, label: 'Last 12 months', unit: '' },
];
// A window's bounds: [from, to, exact]. The eras and 2010–today enter a quarter early, as the app's
// Entry does (slRunner); the last twelve months start at their exact close.
function slWindowBounds(key, dates) {
  if (key !== SL_LAST_YEAR) return SL_ERA_BOUNDS[key].concat(false);
  const last = dates[dates.length - 1];
  return [(+last.slice(0, 4) - 1) + last.slice(4), null, true];
}

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
  // A code entry holding several funds at once returns its daily holdings (the SMA strategy).
  const mult = !Array.isArray(res) && (res.ddMulti || res.holdings);
  const ctrl = !Array.isArray(res) && res.ddControls;
  let dd = null;
  if (mult && mult.length && rows && typeof computeDailyMaxDrawdownMulti === 'function') {
    dd = computeDailyMaxDrawdownMulti(mult, rows).pct;
  } else if (ctrl && ctrl.length && rows && typeof computeDailyMaxDrawdown === 'function') {
    dd = computeDailyMaxDrawdown(ctrl, rows, res.ddKey || 'tqqq').pct;
  } else if (rows && typeof buildCustomDDControls === 'function' && typeof computeDailyMaxDrawdownMulti === 'function') {
    // Code entries: rebuild daily control points from the log so the card is
    // measured exactly like the app's — see customSeriesResult().
    const cc = buildCustomDDControls(log);
    if (cc) dd = computeDailyMaxDrawdownMulti(cc, rows).pct;
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

// A library entry's code as its strategy object (first-party code, evaluated here: see above).
const slModule = (code) => new Function('"use strict"; return (' + code + '\n);')();

// An entry's complexity at its defaults: { settings, points } (customComplexity in
// js/saved-configs.js, the count Fit's "fewest settings" goes by), null for an entry with no code.
let _slComplexity = {};
function slComplexity(s) {
  if (!(s.n in _slComplexity)) {
    const code = strategyHasCode(s.n);
    _slComplexity[s.n] = code ? customComplexity(slModule(code).params || [], libraryEntryConfig(s)) : null;
  }
  return _slComplexity[s.n];
}

// Evaluate a library strategy's code and run it over [si, ei] at its defaults.
function slRunCode(code, data, si, ei) {
  const mod = slModule(code);
  const entryDate = data.dates[si], exitDate = data.dates[ei];
  // p.contributions is what every CODE[n] entry actually reads for its
  // monthly cash (js/strategy-library-code.js, rewritten this session to
  // `p.contributions[data.dates[i]]` instead of recomputing the formula
  // inline) — without it every lookup silently resolves to 0, so these
  // preview cards ran on the initial lump sum alone with no monthly DCA at
  // all. buildCustomContributions (js/simulate.js) is the shared builder —
  // also used by computeCustomGlobals (saved-configs.js) for the real
  // sandboxed run — so this path (a plain `new Function`, not the Worker
  // sandbox) can't quietly fall out of sync with it again.
  const contributions = buildCustomContributions(SL_MONTHLY, 0, entryDate, exitDate, null);
  const p = {
    initial: SL_START_CAPITAL, monthly: SL_MONTHLY, annualRaise: 0,
    startIdx: si, endIdx: ei, entryDate, exitDate, contributions,
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
    // Driven by the same sampleQuarterly flag set above, not by whether
    // samplePoints happens to be non-empty (see js/chart.js's pick()).
    const rows = opts.sampleQuarterly ? r.samplePoints : (r.log || []);
    const UL_KEY = { 1: 'tqqq', 2: 'qqq', 3: 'spy', 4: 'qld', 5: 'sso', 6: 'spxl', 7: 'sqqq', 8: 'gld', 9: 'soxl', 10: 'soxx', 11: 'soxs' };
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
  SL_STATS = { quarters, spy: slBuyHoldCurve(data.spy, dates, quarters), byN: {}, windows: {}, data, dates };
  return SL_STATS;
}

// How an entry runs over a window (from, to, exact): its result as slCagrDD and the sparkline read
// it. null for an entry with neither code nor a preset.
function slRunner(st, s) {
  const code = strategyHasCode(s.n);
  if (!code && !s.preset) return null;
  const { data, dates } = st, lastIdx = dates.length - 1;
  // Code entries index the daily series; presets index quarterlyData. Both start
  // one quarter EARLIER than the era's nominal boundary, because that is what the
  // app does: picking "Entry Q1 2000" buys at the previous quarter's close
  // (chart.js — `simEntryIdx = entryIdx - 1`). Running a card from the boundary
  // itself skipped that quarter, and for the 2000 era it holds the dot-com top —
  // worth up to 7.7pp of drawdown between a card and the strategy added from it.
  // An exact window starts at the last close on or before its first date instead.
  const entryQIdx = (d) => { const qi = slQIdx(d, false); return qi > 0 ? qi - 1 : qi; };
  const qDateAt = (qi, fallback) =>
    (qi >= 0 && typeof quarterlyData !== 'undefined' && quarterlyData[qi]) ? quarterlyData[qi][0] : fallback;
  if (code) {
    return (from, to, exact) => slRunCode(code, data,
      slIdxOnOrBefore(dates, exact ? from : qDateAt(entryQIdx(from), from)),
      to === null ? lastIdx : slIdxOnOrBefore(dates, qDateAt(slQIdx(to, true), to)));
  }
  return (from, to, exact) => {
    if (exact) throw new Error('a preset runs on the quarter grid and has no window from an exact date');
    return slRunPreset(s.preset, entryQIdx(from), slQIdx(to, true));
  };
}

// One window's result for a runnable entry: { cagr, dd, trades }, null where there is too little to
// measure. `trades` counts the strategy's own trades in a code entry's log, as its log table's
// "Strategy trades only" does (customRowTraded); a preset's result is no log and has none.
// Run once and kept, for the cards and for the sorts alike. A run that throws is the caller's to handle.
function slWindowMetric(st, s, key) {
  const kept = st.windows[s.n] || (st.windows[s.n] = {});
  if (!(key in kept)) {
    const res = slRunner(st, s)(...slWindowBounds(key, st.dates)), m = slCagrDD(res);
    kept[key] = m ? { cagr: m.cagr, dd: m.dd, trades: Array.isArray(res) ? res.filter(customRowTraded).length : null } : null;
  }
  return kept[key];
}

// Simulate ONE strategy and memoize it. Called per rendered card, so a page of
// 8 costs 8 strategies instead of all 39 — the sims are the expensive part.
function slStatsFor(n) {
  const st = computeLibraryStats();
  if (!st) return null;
  if (n in st.byN) return st.byN[n];
  const s = STRATEGY_LIBRARY.find(x => x.n === n);
  if (!s) return null;
  const run = slRunner(st, s);
  if (!run) return (st.byN[n] = null);
  try {
    // The card's eras, and the two windows its ⓘ gives.
    const windows = STRATEGY_ERAS.filter(era => SL_ERA_BOUNDS[era.key]).concat(SL_FACT_WINDOWS);
    const metrics = Object.fromEntries(windows.map(w => [w.key, slWindowMetric(st, s, w.key)]).filter(([, m]) => m));
    const sp = run(SL_SPARK_START, null);
    st.byN[n] = { metrics, curve: slCurveFromLog((Array.isArray(sp) ? sp : (sp && sp.points)) || [], st.quarters) };
  } catch (e) {
    console.warn('Strategy library: #' + n + ' failed to run —', (e && e.message) || e);
    st.byN[n] = { metrics: {}, curve: null };
  }
  return st.byN[n];
}

// Drop the cache so the next open recomputes (data refresh, edited code).
function slInvalidateStats() { SL_STATS = null; _slComplexity = {}; _strategyLibraryBuilt = false; _slPage = 1; }


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
  // Whole-span column first, then the breakdown. The four windows below start
  // at 1980, so without this the 1953-1980 stretch never showed up anywhere.
  { key: '1953', label: '1953–today', sub: 'full history' },
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

// What the ⓘ says of an entry's figures the catalog sorts by: its complexity, and its return over the
// windows with no column in the era table, with the trades since 2010. Kept off the card itself (the
// user, 2026-11-24: "put this inside info icon ... it should stay as clean as possible"). [] for an
// entry that cannot run.
function slFactLines(s, m) {
  const c = slComplexity(s);
  if (!c) return [];
  const returns = SL_FACT_WINDOWS.map((w) => {
    const cell = m && m[w.key];
    if (!cell) return w.label + ': —';
    return w.label + ': ' + fmtPct(cell.cagr) + w.unit + (w.trades && cell.trades !== null ? ', ' + cell.trades.toLocaleString('en-US') + ' trades' : '');
  });
  return [`Complexity: ${Math.round(c.points)} points from ${c.settings} ${c.settings === 1 ? 'setting' : 'settings'} in use`].concat(returns);
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
    // Past 90% the rounded figure hides the only thing that matters. −99.960%
    // and −100% are a survivable account and a wiped-out one, and both round to
    // "−100%", so keep three decimals up there and whole percent below.
    return c
      ? `<td class="sl-era-dd">−${c.dd > 90 ? c.dd.toFixed(3) : Math.round(c.dd)}%</td>`
      : '<td class="sl-era-dd">—</td>';
  }).join('');
  return `<div class="sl-era-table-wrap"><table class="sl-era-table">
    <tr class="sl-row-date"><th scope="row">date</th>${dateCells}</tr>
    <tr class="sl-row-cagr"><th scope="row">cagr</th>${cagrCells}</tr>
    <tr class="sl-row-dd"><th scope="row">max drawdown</th>${ddCells}</tr>
  </table></div>`;
}

// Compact money: $10k, $257k, $22M, $1.3B, $6.5T, $24Q (quadrillion: the
// 1953 reconstruction carries some cards there from $10k; "$24384873B" did not read).
function fmtMoney(v) {
  if (!(v > 0)) return '—';
  if (v >= 1e15) return '$' + (v / 1e15).toFixed(v >= 1e16 ? 0 : 1) + 'Q';
  if (v >= 1e12) return '$' + (v / 1e12).toFixed(v >= 1e13 ? 0 : 1) + 'T';
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
// line's tip) drawn inside the graph. SPY's end value carries its name, which is
// the chart's legend (the user, 2026-11-24: "remove legend, and instead display
// it in the chart (number and SPY)"); the other line is the card's strategy.
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
  // The two end labels must not sit on each other: a label is about 11% of the
  // graph's height, so when the strategy and SPY end that close, the lower one
  // moves down (or the upper one up at the bottom edge).
  const GAP = 12;
  let yStrat = yPct(curve[N - 1]), ySpy = yPct(spy[spy.length - 1]);
  if (Math.abs(yStrat - ySpy) < GAP) {
    const upper = Math.min(yStrat, ySpy), lower = upper + GAP;
    if (lower <= 82) { if (yStrat <= ySpy) ySpy = lower; else yStrat = lower; }
    else { if (yStrat <= ySpy) yStrat = 82 - GAP; else ySpy = 82 - GAP; }
  }
  return `<div class="sl-spark" data-sl-n="${n}">
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Strategy vs SPY, log scale 1995–2025">
      ${grid}
      <path d="${path(spy)}" class="sl-spark-spy" fill="none"/>
      <path d="${path(curve)}" class="sl-spark-strat" fill="none"/>
    </svg>
    <span class="sl-logtag">log ⬍</span>
    <span class="sl-lbl sl-lbl-start" style="top:${yPct(start).toFixed(0)}%">${fmtMoney(start)}</span>
    <span class="sl-lbl sl-lbl-strat" style="top:${yStrat.toFixed(0)}%">${fmtMoney(curve[N - 1])}</span>
    <span class="sl-lbl sl-lbl-spy" style="top:${ySpy.toFixed(0)}%">SPY ${fmtMoney(spy[spy.length - 1])}</span>
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
function slInfoTip(s, m) {
  const facts = slFactLines(s, m);
  const parts = [s.name, ''].concat(facts.length ? facts.concat('') : [], slFormatRules(s.rules));
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
        <span class="info-icon sl-info" tabindex="0" data-tip-wide data-tip="${slInfoTip(s, m)}">\u24d8</span>
      </div>
      ${has ? sparklineHtml(s.n) : '<div class="sl-spark sl-spark-empty">no data series</div>'}
      ${eras}
    </div>`;
  }).join('');
}

// The strategy a runnable library entry runs as: a preset becomes a NATIVE
// 9sig/SMA config (real engine, real sidebar knobs, shareable); everything
// else a custom config carrying its code. The fields a saved copy
// (addStrategyFromLibrary) and the account's day-change run
// (js/saved-configs.js's txFollowMove) share.
function libraryEntryConfig(entry) {
  return entry.preset
    ? { type: entry.preset.type, name: entry.name, params: Object.assign({}, entry.preset.params) }
    : { type: 'custom', name: entry.name, params: {}, code: strategyHasCode(entry.n) };
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
  const cfg = {
    ...libraryEntryConfig(entry),
    id: 'cfg_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name: (typeof uniqueName === 'function') ? uniqueName(entry.name) : entry.name,
    desc: entry.rules,
    color: (typeof nextConfigColor === 'function') ? nextConfigColor() : '#e879f9',
    hidden: false,
  };
  // Where the copy came from: a code copy's refresh to the current library
  // code (refreshLibraryCopies in js/saved-configs.js) and a preset copy's
  // Reset to default (strategyDefaultParams) both look it up.
  cfg.libraryN = n;
  if (!entry.preset) {
    // What its code looked like then, so a later load can refresh it unless
    // it was edited.
    cfg.libraryFingerprint = codeFingerprint(code);
    cfg.libraryDescFingerprint = codeFingerprint(entry.rules || '');
  }
  savedConfigs.push(cfg);
  // Push a preset's values INTO the sidebar controls before it becomes the
  // edited config — otherwise the sidebar's current values sync back over
  // cfg.params and the strategy silently reverts to defaults.
  if (entry.preset && typeof applyParams === 'function') applyParams(cfg.type, cfg.params);
  // Marked as editing so the new line renders emphasized (bold, others dimmed)
  // — the spotlight the user expects right after Try. A click on the page
  // background dismisses it (see the document click handler in js/chart.js).
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

// ---- The catalog's order (the user, 2026-11-24: "ability to sort based on name, difficulty
// 2010-today return, last year return, all time return", "ascending and descending both") ----
// Each sort starts in the direction that reads best for it (`first`) and the button beside it turns
// it round. A sort on a run reads one figure (`field`) of one window (`window`) of every entry in the
// list, not only of the cards on screen: the runs still missing are made when it is picked, and kept.
// The trades are counted from 2010 (the user, 2026-11-24: "also one sort rule should be count of
// transactions (from 2010 - today)").
const SL_SORTS = [
  { key: 'library', label: 'Library order', first: 'asc' },
  { key: 'name', label: 'Name', first: 'asc' },
  { key: 'complexity', label: 'Complexity', first: 'asc' },
  { key: '2010', label: 'Return, 2010–today', first: 'desc', window: '2010', field: 'cagr' },
  { key: SL_LAST_YEAR, label: 'Return, last 12 months', first: 'desc', window: SL_LAST_YEAR, field: 'cagr' },
  { key: '1953', label: 'Return, all time', first: 'desc', window: '1953', field: 'cagr' },
  { key: 'trades', label: 'Trades, 2010–today', first: 'asc', window: '2010', field: 'trades' },
];
const SL_DIRECTIONS = { asc: '↑ Ascending', desc: '↓ Descending' };
const SL_YIELD_MS = 25;   // a return sort's runs pause this often, so its count shows and the window responds
let _slSort = SL_SORTS[0], _slSortDir = _slSort.first;
let _slSortJob = 0;       // the latest sort asked for: runs made for an earlier one stop

// An entry's window for a sort (slWindowMetric), or null where it has none. A run that throws is said
// in the console and kept as none, so the entry sorts last and is not run again.
function slSortWindow(st, s, key) {
  try {
    return slWindowMetric(st, s, key);
  } catch (e) {
    console.warn('Strategy library: #' + s.n + ' failed to run —', (e && e.message) || e);
    return ((st.windows[s.n] || (st.windows[s.n] = {}))[key] = null);
  }
}
// What a sort orders an entry by; null for an entry it has nothing for.
function slSortValue(st, s, sort) {
  if (sort.key === 'library') return STRATEGY_LIBRARY.indexOf(s);
  if (sort.key === 'name') return s.name.toLowerCase();
  if (sort.key === 'complexity') { const c = slComplexity(s); return c ? c.points : null; }
  const m = strategyRunnable(s) ? slSortWindow(st, s, sort.window) : null;
  return m ? m[sort.field] : null;
}
// The list in the picked order. Entries the sort has nothing for come last in either direction;
// equal ones keep the library's order.
function slSorted(list) {
  const st = computeLibraryStats(), sign = _slSortDir === 'asc' ? 1 : -1;
  const rows = list.map(s => ({ s, value: slSortValue(st, s, _slSort) }));
  const ordered = d3.sort(rows.filter(r => r.value !== null), (a, b) => sign * d3.ascending(a.value, b.value));
  return ordered.concat(rows.filter(r => r.value === null)).map(r => r.s);
}
// The entries of a list whose window the picked sort still has to run.
function slSortRunsMissing(list) {
  const st = computeLibraryStats();
  if (!_slSort.window || !st) return [];
  return list.filter(s => strategyRunnable(s) && !(st.windows[s.n] && _slSort.window in st.windows[s.n]));
}
// Makes those runs, pausing every SL_YIELD_MS with the count beside the sort. Resolves to false when
// another sort was picked meanwhile.
async function slRunForSort(body, missing) {
  const st = computeLibraryStats(), job = ++_slSortJob, sort = _slSort, status = body.querySelector('.sl-sort-status');
  let lastYield = performance.now();
  for (let k = 0; k < missing.length && job === _slSortJob; k++) {
    slSortWindow(st, missing[k], sort.window);
    if (performance.now() - lastYield > SL_YIELD_MS) {
      status.textContent = `${k + 1} / ${missing.length}`;
      status.hidden = false;
      await new Promise(r => setTimeout(r, 0));
      lastYield = performance.now();
    }
  }
  if (job === _slSortJob) status.hidden = true;
  return job === _slSortJob;
}

function buildStrategyLibrary() {
  if (_strategyLibraryBuilt) return;
  const body = document.getElementById('strategy-library-body');
  if (!body) return;
  computeLibraryStats();   // quarter grid + SPY baseline only; sims are per-card
  body.innerHTML = `
    <div class="sl-sticky-head">
      <div class="sl-tools">
        <input id="sl-search" class="sl-search" type="search" autocomplete="off" spellcheck="false"
               placeholder="Search strategies — name, tag, or rule text…" aria-label="Search strategies">
        <select id="sl-sort" class="sl-sort" aria-label="Sort strategies by">
          ${SL_SORTS.map(sort => `<option value="${sort.key}"${sort === _slSort ? ' selected' : ''}>${sort.label}</option>`).join('')}
        </select>
        <button type="button" id="sl-sort-dir" class="sl-sort-dir" title="Turn the order round">${SL_DIRECTIONS[_slSortDir]}</button>
        <span class="sl-sort-status" hidden></span>
      </div>
    </div>
    <div class="sl-noresults" hidden>No strategy matches that.</div>
    <div class="sl-cards"></div>`;
  body.onclick = (e) => {
    const add = e.target.closest('[data-sl-add]');
    if (add) addStrategyFromLibrary(+add.getAttribute('data-sl-add'));
  };
  // The page buttons sit in the window's title bar (index.html), outside the body.
  document.getElementById('sl-pager').onclick = (e) => {
    const pg = e.target.closest('[data-sl-page]');
    if (pg) { _slPage = +pg.getAttribute('data-sl-page'); renderLibraryPage(body); }
  };
  setupSparkTooltip(body);
  setupLibrarySearch(body);
  setupLibrarySort(body);
  renderLibraryPage(body);
  _strategyLibraryBuilt = true;
}

// The sort's dropdown and its direction button. A new sort starts on the first page, in its own
// first direction; the button turns the order round and says which it now is.
function setupLibrarySort(body) {
  const select = body.querySelector('#sl-sort'), button = body.querySelector('#sl-sort-dir');
  const apply = (direction) => { _slSortDir = direction; button.textContent = SL_DIRECTIONS[direction]; _slPage = 1; renderLibraryPage(body); };
  select.addEventListener('change', () => { _slSort = SL_SORTS.find(sort => sort.key === select.value); apply(_slSort.first); });
  button.addEventListener('click', () => apply(_slSortDir === 'asc' ? 'desc' : 'asc'));
}

// Entries matching the current query. Text-only, so filtering costs no sims.
function slFilteredEntries() {
  const terms = (_slQuery || '').toLowerCase().split(/\s+/).filter(Boolean);
  const shown = STRATEGY_LIBRARY.filter(s => !s.hidden);   // hidden entries stay in the list for lookups by number, off the catalog
  if (!terms.length) return shown;
  return shown.filter(s => {
    const hay = [s.name, s.tag, s.needs, s.rules].filter(Boolean).join(' ').toLowerCase();
    return terms.every(t => hay.includes(t));
  });
}

// Render just the current page of the matching entries, in the picked order. Each card pulls its
// own stats, so only the strategies actually on screen get simulated; a return sort first makes
// the runs it still lacks (slRunForSort), and the page shows once they are in.
function renderLibraryPage(body) {
  body = body || document.getElementById('strategy-library-body');
  if (!body) return;
  const list = slFilteredEntries(), missing = slSortRunsMissing(list);
  if (!missing.length) { slShowPage(body, slSorted(list)); return; }
  slRunForSort(body, missing).then((done) => { if (done) slShowPage(body, slSorted(list)); });
}
function slShowPage(body, list) {
  const pages = Math.max(1, Math.ceil(list.length / SL_PAGE_SIZE));
  if (_slPage > pages) _slPage = pages;
  if (_slPage < 1) _slPage = 1;
  const from = (_slPage - 1) * SL_PAGE_SIZE;
  const slice = list.slice(from, from + SL_PAGE_SIZE);
  const cards = body.querySelector('.sl-cards');
  const empty = body.querySelector('.sl-noresults');
  const pager = document.getElementById('sl-pager');
  if (cards) cards.innerHTML = buildStrategyCards(slice);
  if (empty) empty.hidden = list.length > 0;
  if (pager) pager.innerHTML = slPagerHtml(list.length, pages);
  // A new page, search or order is read from its top. (Scrolling the cards "into view" put their first
  // row under the pinned head: the body is the scroll area and the head sticks to its top.)
  body.scrollTop = 0;
}

function slPagerHtml(total, pages) {
  if (!total) return '';
  const btn = (page, label, disabled, current) =>
    `<button type="button" class="sl-page${current ? ' on' : ''}" data-sl-page="${page}"${disabled ? ' disabled' : ''}>${label}</button>`;
  let nums = '';
  for (let i = 1; i <= pages; i++) nums += btn(i, i, false, i === _slPage);
  return `<span class="sl-page-btns">
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
