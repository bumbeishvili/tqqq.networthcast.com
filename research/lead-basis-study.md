# Lead basis study: is there a better measure of how much leverage is punished?

8 to 9 November 2026. The user's question: the lead used by TQQQ vs QQQ stretch
(#47, #50, #52) and by the SOXL rule in #52 is "TQQQ's growth over the lookback
against QQQ's". It depends on where the window started: from a top it reads
deeply negative with no extra decay at all, from a trough it reads huge. Is a
start-independent measure of the leverage cost a better signal?

Horizon: 2010 onward throughout. Money: $100K lump sum, no contributions, so
CAGR is scale-free. Engines: the library's own code run in Node (same text, same
data files, parity checked to the cent against the app).

## The bases

All in percent, high = ahead or calm, low = behind or stressed. `g_lev` and
`g_idx` are the leveraged fund's and the index's growth over the lookback from
the same averaged start (±65 days for TQQQ, none for SOXL).

| Basis | Formula | What it is |
|---|---|---|
| growth (current) | g_lev / g_idx − 1 | the shipped lead |
| indexOnly | g_idx² − 1 | the lead with no decay at all: the index's own move |
| residual3x | g_lev / g_idx³ − 1 | the fund against a frictionless 3× from the same start: the decay plus costs |
| decay | exp(−3 Σ r_idx²) − 1 over the lookback | the decay alone, from the index's realized variance |
| ratioMed | (lev/idx) / median(lev/idx over the lookback) − 1 | the pair ratio against its own history; every day is a reference |

In log terms the current lead is about twice the index's move minus three times
its realized variance, so `indexOnly` and `decay` are its two parts.

## A. What the lead is made of (2010–2025, daily)

| Pair | corr(lead, indexOnly) | corr(lead, decay) | corr(indexOnly, decay) |
|---|---|---|---|
| TQQQ vs QQQ, 550 days ±65 | 0.854 | 0.544 | 0.086 |
| SOXL vs SOXX, 380 days | 0.844 | 0.473 | −0.02 |

The two parts are nearly independent, so their shares add: about 73% of the
lead's variance is QQQ's own two-year move, about 30% is the decay. Ranges
(p5 / p50 / p95) for TQQQ: growth −46 / 50 / 132; indexOnly 3 / 112 / 277;
residual3x −53 / −29 / −14; decay −48 / −23 / −11; ratioMed −35 / 24 / 65.

## B. Does any measure predict forward returns on its own?

Spearman correlation between the measure and the fund's forward return, with a
p-value from 400 circular shifts of the measure (a null that keeps both series'
autocorrelation). Negative means mean reversion: a high lead, a low return.

| TQQQ, measure → TQQQ forward | 21 days | 63 days | 126 days | 252 days |
|---|---|---|---|---|
| growth | −0.24 (p 0.00) | −0.37 (0.00) | −0.47 (0.00) | −0.60 (0.005) |
| indexOnly | −0.20 (0.003) | −0.35 (0.00) | −0.45 (0.013) | −0.58 (0.048) |
| ratioMed | −0.18 (0.01) | −0.25 (0.035) | −0.31 (0.17) | −0.54 (0.058) |
| residual3x | −0.11 (0.00) | −0.11 (0.03) | −0.13 (0.12) | −0.10 (0.39) |
| decay | −0.10 (0.018) | −0.11 (0.10) | −0.11 (0.27) | −0.09 (0.51) |

Decile means of the 126-day forward return, low measure to high: growth 53, 38,
40, 34, 33, 22, 14, 23, 10, −19 (monotone apart from one step); residual3x 45,
40, 6, 23, 17, 21, 38, 36, 6, 16 (no order). The decay carries a small
short-horizon effect (after heavy decay the next one to three months run a bit
better) and nothing at six to twelve months. The index move carries the
reversion the stretch rules trade.

SOXL vs SOXX, 252 days, SOXL forward: growth −0.54 (p 0.037), indexOnly −0.51
(0.07), ratioMed −0.37 (0.11), residual3x −0.14 (0.42), decay −0.12 (0.46).
Against SOXL's return over TQQQ's (what the SOXL rule actually bets on) nothing
is significant: growth −0.38 (p 0.12) is the best.

## C. Inside TQQQ vs QQQ + Turnaround Monday (#50)

Method, the same for every basis: the five lead thresholds (ceiling, back,
floor, re-entry, deep buy) each get a grid of 199 values, the percentiles of
that basis's own distribution over 2010–2025, plus Off where the shipped
dropdown has it; lookback (37 values, 252 to 1008 days) and start averaging
(0 to 120 days) are fitted too; all other settings stay at the shipped defaults.
Coordinate descent as the app's Fit (each setting tries every option with the
rest held, passes until nothing moves, at most four), from 16 random starts.

### In-sample fit, 2010–2025

| Basis | As shipped | Best fit | Max DD | Worst neighbour | 2026 holdout | 2010–17 / 2018–25 |
|---|---|---|---|---|---|---|
| growth | 139.7% | 146.7% | 52% | 134.6% | 141% | 124% / 171% |
| indexOnly | 50.9% | 132.9% | 51% | 114.2% | 41% | 118% / 147% |
| residual3x | 74.8% | 125.2% | 75% | 104.4% | 27% | 85% / 172% |
| decay | 74.8% | 123.7% | 41% | 97.8% | 59% | 86% / 167% |
| ratioMed | 67.0% | 119.7% | 47% | 103.4% | 46% | 88% / 155% |

"As shipped" is the shipped thresholds read on the new basis, meaningless for
the four alternatives and listed only to show why each needs its own grid.
"Worst neighbour" is the lowest CAGR when any one threshold moves one or two
grid steps.

### Shuffled-lead baseline

The lead series circularly shifted by a random offset of at least 600 trading
days, so it keeps its shape and autocorrelation but says nothing about the
prices it trades, then fitted the same way (3 starts), 16 shuffles per basis.
This is how much CAGR the search alone manufactures with seven free settings
on 16 years of TQQQ.

| Basis | Real fit | Shuffled median | 90th pct | Max |
|---|---|---|---|---|
| growth | 146.7% (shipped 139.7%) | 111% | 118% | 130% |
| indexOnly | 132.9% | 107% | 119% | 136% |
| residual3x | 125.2% | 99% | 107% | 112% |
| decay | 123.7% | 99% | 107% | 110% |
| ratioMed | 119.7% | 112% | 120% | 136% |

The current lead clears its shuffled maximum by 17 points, the shipped defaults
by 10. The index-only and ratio-against-median leads sit inside their own
noise bands. The two decay bases clear theirs in-sample, and the next section
shows that surplus did not travel.

### Walk-forward

Each test year from 2016 to 2026 traded on settings fitted to the years before
it, then the eleven years chained. Buy & hold TQQQ over 2016 to 6 Nov 2026:
34.4% a year. "Under B&H" counts test years below buy & hold TQQQ that year.

| Basis | Fit window, starts | Chained 2016–2026 | Worst year | Under B&H | Worst fold DD |
|---|---|---|---|---|---|
| growth | 6 yr, 4 | 84.0% | −11% (2025) | 4 / 11 | 60% |
| growth | 6 yr, 8 | 78.5% | −13% | 3 / 11 | 58% |
| growth | 4 yr, 4 | 88.2% | −18% | 2 / 11 | 49% |
| ratioMed | 6 yr, 4 | 81.6% | +5% | 5 / 11 | 43% |
| ratioMed | 6 yr, 8 | 98.2% | −22% (2018) | 5 / 11 | 52% |
| ratioMed | 4 yr, 4 | 67.9% | −19% | 6 / 11 | 72% |
| residual3x | 6 yr, 4 | 76.5% | −45% (2022) | 3 / 11 | 58% |
| decay | 6 yr, 4 | 41.7% | −80% (2022) | 5 / 11 | 81% |
| indexOnly | 6 yr, 4 | 29.4% | −65% (2022) | 5 / 11 | 69% |

Halves, fit on one and run on the other: growth 104% (2010–17 → 2018–25, DD
60%) and 72% (the reverse); ratioMed 68% and 43%; indexOnly 70% and 52%;
residual3x 64% (DD 81%) and 49%; decay 84% (DD 81%) and 27%.

Reading it: taking the decay out of the lead (indexOnly) drops the
walk-forward under buy & hold, with three losing years; the decay on its own
repeats 2022's −80%. The residual's 76.5% is one fold, 2020 at +632%. The
ratio against its median is the only alternative in the current lead's range,
and the range is wide: 68% to 98% against 78% to 88% depending on the fit
window and the number of starts, with one 2020 fold (+765% to +820%) doing most
of the work when it wins. Its settings held still from 2020 to 2026 in the
4-start run (lookback 252–300, ceiling 36–38, floor 4–13, deep buy −26 to −32)
and moved to lookbacks 550–620 in the 8-start run, so the surface is flat and
multi-modal, as the current lead's is.

For scale: #50 as shipped, whose settings were fitted on 2010–2025, makes 172%
a year over 2016–2026, in-sample.

## D. The SOXL lead inside SOXL, TQQQ VS QQQ, Mon Turns (#52)

The same bases for SOXL against SOXX, fitted on the three SOXL settings
(lookback from the shipped list, entry and exit levels on 199-value quantile
grids), the TQQQ lead left at the shipped defaults.

A free fit inverted the band for four bases (entry level above the exit level,
which flips SOXL on and off day by day) and reached 204% to 208%. The numbers
below keep the band in order (entry at or under exit), 12 starts.

| SOXL basis | As shipped | Best fit | Max DD | 2026 holdout | Shuffled median / 90th / max |
|---|---|---|---|---|---|
| growth | 177.0% | 195.8% | 55% | 190% | 156 / 179 / 182 |
| indexOnly | 165.6% | 198.5% | 47% | 190% | 156 / 178 / 183 |
| ratioMed | 172.3% | 192.5% | 55% | 4% | 153 / 182 / 188 |
| residual3x | 162.6% | 173.3% | 52% | 160% | 153 / 171 / 178 |
| decay | 162.6% | 171.0% | 55% | 160% | not run |

A shuffled SOXL lead mostly makes the fit switch the rule off and fall back to
the base strategy's 139.7%; the 16 shuffles reach 178% to 188% at best. Only
the current lead and the index-only lead clear their shuffled maximum, by 14
and 15 points. The shipped SOXL defaults (177%) sit inside the chance band: the
SOXL rule's in-sample edge is real but thinner than the TQQQ lead's.

Walk-forward on the three SOXL settings (6-year fits, 4 starts), TQQQ lead at
the shipped defaults, chained 2016–2026:

| SOXL basis | Chained | Worst year | Under B&H TQQQ | Worst fold DD |
|---|---|---|---|---|
| growth | 214.2% | 49% (2022) | 1 / 11 | 56% |
| ratioMed | 214.3% | 49% | 0 / 11 | 56% |
| residual3x | 208.3% | 49% | 1 / 11 | 81% |
| decay | 207.4% | 49% | 1 / 11 | 81% |
| indexOnly | 182.4% | 23% | 1 / 11 | 51% |

These are high because the TQQQ lead's shipped settings (fitted on 2010–2025)
do most of the work; #52 as shipped makes 273.5% over the same span,
in-sample. The point is the ordering: the basis of the SOXL lead barely
matters out of sample, the current lead and the ratio against its median tie,
the decay forms carry 81% fold drawdowns, and the index-only form is worst.

## E. The TQQQ lead inside #52

The same TQQQ-lead walk-forward as section C (6-year fits, 4 starts, the five
lead thresholds, lookback and start averaging refit each year) inside #52, with
the SOXL rule at its shipped settings. Chained 2016–2026, buy & hold TQQQ 34.4%:

| TQQQ lead basis | Chained | Worst year | Under B&H | Worst fold DD | 2010–17 → 2018–25 | 2018–25 → 2010–17 |
|---|---|---|---|---|---|---|
| growth | 157.4% | +41% (2018) | 0 / 11 | 49% | 124% (DD 66%) | 69% |
| ratioMed | 81.3% | +15% (2022) | 3 / 11 | 72% | 114% (DD 58%) | 25% |

With the SOXL rule on, the current lead wins every year it is compared on and
never trails buy & hold; the ratio against its median loses the 2020 rebound
(+22% against +273%) and 2023 (+117% against +569%), the two years the SOXL
rule earns its keep, because its floor and re-entry fire at other times than
the SOXL entry was tuned for. The tie of section C does not carry into the
strategy the user runs.

## Verdict

1. The user's reading of the lead is right: about three quarters of it is
   QQQ's own two-year move, a quarter is leverage being punished, and the two
   parts are independent.
2. The leverage cost on its own (the decay, or the residual against a
   frictionless 3×) is not a usable signal here. It predicts nothing at six to
   twelve months, fits to knife-edge thresholds, and refit by year repeats
   2022's −80% or carries an 81% drawdown.
3. Taking the start dependence out by keeping only the index move (indexOnly)
   is worse than the current lead on every out-of-sample test and sits inside
   its shuffled-noise band in-sample. The small decay term riding on the index
   move is what made the current lead hold up.
4. The start-independent form the user described, the ratio against its own
   median, is the one alternative that ties the current lead on the plain
   stretch strategy (68% to 98% against 78% to 88% in TQQQ walk-forward; 214%
   against 214% as the SOXL lead). It does not beat it, its in-sample fit is
   inside the shuffled band, and inside the SOXL strategy it falls to 81%
   against 157% because it misses the 2020 and 2023 rebounds the SOXL rule
   was tuned around.
5. The current lead is the only basis that clears its shuffled band on both
   leads and is first or tied in every out-of-sample test. Nothing here
   replaces it. The start dependence the user dislikes is the signal, tempered
   already by averaging the start over ±65 days.

Not to re-propose without a new idea: a decay or realized-variance lead; an
index-only lead; the ratio against its median as a replacement for the lead.
Untested: a hybrid that keeps the growth lead and adds a short-window decay
rate as a filter; the earlier volatility-timing result (it paid only with
same-close switches) argues against spending time on it.

## Reproduce

`research/lead-basis/`: `harness.cjs` (data and engine runner), `basis.cjs`
(the basis switch as text surgery on the library code, with a parity check:
`node basis.cjs`), `fit.cjs` (the fitter; `--mode insample|walkforward|surrogate`,
`--lead tqqq|soxl`, `--basis`, `--starts`, `--window`, `--constrain 1`),
`partAB.cjs` (sections A and B), `analyze.cjs` (tables from `out/`). Results as
run are in `out/`. A full in-sample fit of one basis takes about 30 minutes on
one core; the whole study ran overnight on eight.
