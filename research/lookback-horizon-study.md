# Lookback horizon study: does the strategy have to hang on 2.2 years?

Date: 2026-11-09. Strategy: library #52, SOXL, TQQQ VS QQQ, Mon Turns, with its SOXL rule at the
shipped settings throughout. Period judged: 2010 onward. Money: $100K lump sum. Continues
[lead-basis-study.md](lead-basis-study.md), where the lead's measure was the question; here the
question is its horizon.

## The question

The user: "My primary worry is that that 2.5 years might change and might become 3.5 years ... I
wanted something dynamic, that would end up on that 2.2 or 2.5 years themselves dynamically."

At the shipped thresholds, #52's return by lookback (2010–2025): 1.0y 87%, 1.5y 68%, 2.0y 130%,
2.2y 177% (the default, drawdown 47%), 2.4y 104%, 3.0y 83%, 3.5y 52%; buy & hold TQQQ 40%. One
sharp peak.

## The variants

All built by text surgery on #52's code (`research/lead-basis/vote.cjs`, `dynamic.cjs`), parity
with #52 checked trade for trade since 1953 when the vote is off or the band is one horizon.

- **Median vote**: the engine's one lead is the median of the lead at nine horizons (450–650 days,
  or 380–880), each with the shipped start averaging scaled to its horizon. Five thresholds refit.
- **Majority vote**: nine complete copies of the stretch rules, one per horizon; the money holds
  what most of them want; the overlays (overextended line, credit veto, SQQQ cap) apply once. Five
  shared thresholds refit.
- **Follow-the-winner**: the nine copies each run a virtual book (their want, one-day lag, no
  costs); the money follows the copy with the best trailing return over a window, switching only
  when a rival beats it by a factor. Window and factor refit with the five thresholds (seven
  settings, as many as the single-lookback baseline's).
- **Dynamic lookback**: each test year, every lookback on a 37-value grid is run on the trailing
  six (or three) years with the shipped thresholds; the winner trades the test year; chained
  2016–2026. A plateau-seeking pick (the lookback whose worst of itself and its two neighbours is
  highest) beside the plain best.
- **Era stress**: everything at shipped thresholds on 1953–1982 and 1983–2009, which no tuning saw.
- **Scale normalization** of the horizons was measured and dropped: over 1953–2009 the lead's
  median is 6–8 points and its IQR 61–74 at every horizon from 380 to 880 days, so the horizons
  already share a scale.

Protocol per fitted variant, the lead-basis study's: quantile grids per threshold, 16-start
coordinate descent on 2010–2025, 16 shuffled-lead fits with 3 starts (the luck band), six-year
walk-forward with 4 starts chained over 2016–2026, halves fitted on each other.

## Results

Fitted variants (2010–2025 fit, $100K lump; luck band = 16 fits on circularly shifted leads; walk-forward
= refit on the six prior years, test the next, chained 2016–2026, buy & hold TQQQ 34.4%):

| Variant | Fit 2010–25 | DD | Shuffled median / p90 / max | Walk-forward 2016–26 | Under B&H | Worst fold DD | Halves fit→test | 2026 |
|---|---|---|---|---|---|---|---|---|
| Single lookback (current measure) | 191.7 | 59 | 140 / 156 / 165 | 157.4 | 0 of 11 | 49 | 124 / 69 | 363 |
<sub>Single lookback (current measure) fitted: lookbackDays:590, startAvgDays:65, topLead:96.2, backLead:89.1, floorLead:71.9, reentryLead:58.1, deepLead:41.3</sub>
| Median vote, 450–650 | 161.3 | 47 | 124 / 141 / 148 | 111.5 | 4 of 11 | 81 | 93 / 67 | 372 |
<sub>Median vote, 450–650 fitted: topLead:112, backLead:24.3, floorLead:7.8, reentryLead:24.8, deepLead:-32.8</sub>
| Median vote, 380–880 | 141.6 | 59 | 116 / 131 / 148 | 114.8 | 3 of 11 | 71 | 76 / 61 | 113 |
<sub>Median vote, 380–880 fitted: topLead:56.8, backLead:53.6, floorLead:37.8, reentryLead:11.6, deepLead:31.6</sub>
| Majority vote, 450–650 | 171.4 | 59 | 125 / 140 / 143 | 132.2 | 2 of 11 | 65 | 109 / 71 | 481 |
<sub>Majority vote, 450–650 fitted: topLead:114.1, backLead:83.8, floorLead:77.8, reentryLead:58.6, deepLead:32.3</sub>
| Follow-the-winner, 450–650 | 170.1 | 49 | 128 / 146 / 152 | 112.8 | 2 of 11 | 73 | 59 / 90 | 392 |
<sub>Follow-the-winner, 450–650 fitted: voteSelWindow:1008, voteSelHyst:1.2, topLead:125.4, backLead:28.8, floorLead:4.3, reentryLead:34.4, deepLead:-29.9</sub>
| Follow-the-winner, 380–880 | 165.3 | 47 | 129 / 147 / 153 | 75.8 | 3 of 11 | 78 | 79 / 87 | 84 |
<sub>Follow-the-winner, 380–880 fitted: voteSelWindow:756, voteSelHyst:1.2, topLead:133.6, backLead:36.3, floorLead:27.2, reentryLead:1.1, deepLead:-28.4</sub>

Dynamic lookback (shipped thresholds, lookback re-picked each year from the trailing window):
| Window | Pick | Chained 2016–26 | Fixed 550 chained | Fit on 2010–15 then fixed | Picks | Shuffled median / p90 / max |
|---|---|---|---|---|---|---|
| 6y | best | 262.9 | 267.8 | L=540: 259.0 | 530, 540, 550 | 94 / 118 / 142 |
| 6y | worst3 | 262.6 | 267.8 | L=540: 259.0 | 530, 540 | 93 / 126 / 130 |
| 3y | best | 199.1 | 267.8 | L=540: 259.0 | 500, 510, 530, 540, 550, 590, 660 | 103 / 125 / 130 |

Era stress (shipped thresholds; winner at window 504, no hysteresis):
| Era | Best single lookback | Fixed 550 (rank of 37) | Median 450–650 | Median 380–880 | Majority 450–650 | Majority 380–880 | Winner 450–650 | Winner 380–880 |
|---|---|---|---|---|---|---|---|---|
| 1953-1982 | 920d: -0.4 | -7.9 (24) | -7.5 / 99 | -5.6 / 99 | -7.3 / 99 | -4.3 / 99 | -5.5 / 99 | -0.6 / 97 |
| 1983-2009 | 520d: 16.3 | 14.0 (5) | 11.5 / 93 | 6.2 / 91 | 9.4 / 93 | 9.5 / 91 | 7.1 / 96 | -2.9 / 99 |
| 2010-2026 | 550d: 186.9 | 186.9 (1) | 158.6 / 77 | 113.9 / 77 | 138.6 / 77 | 84.2 / 77 | 148.2 / 79 | 95.1 / 79 |

Wide winner occupancy 1954-06-22..2026-11-06: 609 horizon switches; by decade: 1950s 630d 42% 568d 30%; 1960s 880d 32% 380d 18%; 1970s 880d 26% 380d 24%; 1980s 693d 32% 443d 23%; 1990s 380d 29% 693d 16%; 2000s 380d 44% 505d 28%; 2010s 568d 40% 505d 33%; 2020s 693d 27% 505d 27%

Shipped thresholds, no refit (CAGR / DD):
| Variant | 2010-25 | 2010-17 | 2018-25 | 2026-26 | 1983-26 | 1953-26 |
|---|---|---|---|---|---|---|
| #52 as shipped | 177.0/47.2 | 100.6/46.0 | 280.5/47.2 | 391.5/43.5 | 62.5/93.2 | 29.0/99.7 |
| median narrow | 148.2/76.5 | 101.0/46.0 | 204.9/76.5 | 391.5/43.5 | 54.0/93.2 | 25.2/99.8 |
| median wide | 103.2/76.6 | 79.4/54.0 | 129.0/76.6 | 391.5/43.5 | 39.0/91.2 | 18.8/99.7 |
| majority narrow | 128.1/76.5 | 82.3/46.0 | 183.7/76.5 | 391.5/43.5 | 47.6/93.2 | 22.2/99.7 |
| majority wide | 82.8/76.5 | 46.7/54.0 | 126.5/76.5 | 85.6/40.1 | 33.7/91.2 | 16.7/99.6 |
No-fit luck (32 shifts, 2010–25): #52 single lead median 65.4 max 102.4; median narrow median 73.3 max 100.9; majority narrow median 73.9 max 94.4


## Findings

1. Every vote variant trails the single lookback out of sample: walk-forward 75.8–132.2 against
   157.4; two to four years under buy & hold against none; worst test-year drawdown 65–81% against
   49%; halves 59–109 / 61–90 against 124 / 69.
2. In-sample, the single lookback refits to 191.7 (shuffled max 165); the votes refit to 141.6–171.4.
   The median 380–880 band's 141.6 sits inside its shuffled band (max 148); the others clear theirs by
   13 to 28 points.
3. Fitted, follow-the-winner chooses the longest selection window and the most reluctant switch
   factor offered, and thresholds within a few points of #52's own (125.4 / 28.8 / 4.3 / 34.4 / −29.9
   against 125 / 25 / 5 / 25 / −30): the fit turns it back into "pick 550 and stay".
4. The yearly re-pick with a six-year window chose 530–550 days in every year 2016–2026 and made
   262.9% chained against 267.8% for a fixed 550 at the same thresholds (shuffled leads through the
   same selector: median 94, max 142). A three-year window wanders 500–660 days and makes 199.1%.
   The plateau-seeking pick changes nothing (262.6%).
5. Era stress: on 1983–2009 the best single lookback was 520 days and 550 ranked fifth of 37; on
   1953–1982 every lookback lost money (best −0.4% at 920 days, 550 at −7.9%, rank 24). Every vote
   trails fixed 550 in both eras, except the wide follow-the-winner on 1953–1982 (−0.6% against
   −7.9%), which then makes −2.9% against 14.0% on 1983–2009 with 609 horizon switches since 1954.
6. Normalizing the horizons' lead scale is moot: medians 6–8 points and IQRs 61–74 at every horizon
   from 380 to 880 days on 1953–2009.
7. At the shipped thresholds and no refit, every vote makes less than #52 on every era, with a 76–77%
   drawdown against 47% on 2010–2025.

Not to re-propose: a median or majority vote across horizons; a daily follow-the-winner selector.
The one horizon safeguard that cost little is the yearly re-pick on a six-year window; it is a
check to run, not a change to the strategy.


## Scale-free leads (the "oval": the same shape at another time scale)

The user: "we try to fit one radius curve, but there might be oval in the future, but it will still be
the curve." Three versions of the lead that do not assume a fixed time scale (`research/lead-basis/
scale.cjs`; parity with #52 exact at the defaults, the volatility window checked by hand):

- **Smoothing**: the lead is the mean of its last k daily values, k fitted from 1 to 20.
- **Volatility clock**: the lookback counts motion, not days: the window reaches back until QQQ's
  summed squared daily returns hit L times a typical day's variance (1958–2009). With L = 550 the
  window ran 290–1,051 days over 2010–2025 (median 613) and 218–2,121 since 1958.
- **Sigma units**: the lead divided by its window's own realized volatility (scaled so a typical window
  reads as before), so the lines read "stretched by so many sigmas".

Same battery as the rest (16-start fit, 16 shuffled-lead fits, six-year walk-forward chained 2016–2026,
SOXL rule shipped, $100K lump):

| Variant | Fit 2010–25 | DD | Shuffled median / p90 / max | Walk-forward | Under B&H | Worst fold DD | Halves | 2026 |
|---|---|---|---|---|---|---|---|---|
| Single lookback, percent (baseline) | 191.7 | 59 | 140 / 156 / 165 | 157.4 | 0 of 11 | 49 | 124 / 69 | 363 |
| Smoothing (fit chose k = 1) | 180.9 | 47 | 140 / 150 / 162 | 154.4 | 2 of 11 | 53 | 110 / 69 | 372 |
| Volatility clock (fit: 252-day budget) | 168.6 | 51 | 137 / 151 / 160 | 112.7 | 2 of 11 | 76 | 77 / 47 | 371 |
| Sigma units | 165.6 | 72 | 134 / 151 / 163 | 155.5 | 2 of 11 | 65 | 123 / 48 | 431 |

<sub>Smoothing fitted: lookback 550, start ±65, 125.4 / 25.1 / 8.1 / 25.1 / −33, k = 1 (no smoothing); per
walk-forward fold k jumped 1–20. Volatility clock fitted: budget 252 days' worth, start ±40, 130.5 / 63.8 /
35.4 / 47.1 / −17.9; per fold the budget ran 280–756. Sigma units fitted: 550, ±120, 106.7 / 179.4 / 89.7 /
79.2 / 30.9 (the back line above the ceiling, so no band).</sub>

At the shipped thresholds with no refit (CAGR / DD): smoothing 3 days 136.6 / 64, 5 days 119.8 / 76,
volatility clock 79.5 / 76, sigma units 101.5 / 67, both together 67.7 / 76, against #52's 177.0 / 47 on
2010–2025. On the untuned eras sigma units was the one variant above #52: 15.5 against 14.0 on 1983–2009
(drawdown 90 against 93) and −4.6 against −7.9 on 1953–1982; the volatility clock made 2.3 and −6.6.

Findings: the smoothing fit chose no smoothing. The volatility clock loses 45 points out of sample and
its budget wanders. Sigma units ties the baseline out of sample (155.5 against 157.4) at a deeper drawdown
and clears its shuffled band by 3 points against the baseline's 27. No time-scale change shows in the
data; the scale-free forms cost return now for protection that cannot be measured yet.

### The daily-autocorrelation regime (arXiv 2504.20116)

Tested as a signal in [lead-basis-study.md](lead-basis-study.md) section G: QQQ's rolling AR(1) does not
predict TQQQ's shortfall against 3× QQQ (ρ within ±0.08) and carries a weak contrarian relation to
TQQQ's 3–6 month return (ρ −0.16 to −0.23), a quarter of the lead's. Not pursued.

## Reproduce

`research/lead-basis/`: `vote.cjs` (the vote surgery and its parity checks: `node vote.cjs`),
`fit.cjs --vote "450,...,650" --votemode median|majority|winner`, `fit.cjs --scale smooth|vol|sigma`
(`scale.cjs`), `ar1-regime.cjs`, `dynamic.cjs --window 6
--pick best|worst3 --surrogates 16`, `era-stress.cjs`, `analyze-robust.cjs` (the tables above from
`out/`). Results as run are in `out/` (`52v-*`, `52b-*`, `dyn-*`, `era-stress.json`,
`vote-nofit.json`).
