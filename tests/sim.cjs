/*
 * Numerical unit tests for the simulation engine (js/simulate.js).
 * Pure Node — no browser/server. Loads simulate.js with synthetic price data
 * where the correct answer is known by hand, and checks the financial math.
 *
 *   node tests/sim.cjs
 */
const fs = require('fs');
const sim = fs.readFileSync(__dirname + '/../js/simulate.js', 'utf8');
global.fmt = (n) => String(Math.round(n));
global.computeMaxDrawdown = function (s, dates) {
  const empty = { pct: 0, peakIdx: -1, troughIdx: -1, peakDate: null, troughDate: null };
  if (!s || s.length < 2) return empty;
  let peak = -Infinity, peakIdx = -1, maxDD = 0, bestPeakIdx = -1, bestTroughIdx = -1;
  for (let i = 0; i < s.length; i++) {
    const v = s[i];
    if (!Number.isFinite(v)) continue;
    if (v > peak) { peak = v; peakIdx = i; }
    if (peak > 0) {
      const dd = (peak - v) / peak;
      if (dd > maxDD) { maxDD = dd; bestPeakIdx = peakIdx; bestTroughIdx = i; }
    }
  }
  const dateAt = (i) => (dates && i >= 0 && i < dates.length) ? dates[i] : null;
  return { pct: maxDD, peakIdx: bestPeakIdx, troughIdx: bestTroughIdx, peakDate: dateAt(bestPeakIdx), troughDate: dateAt(bestTroughIdx) };
};

const MONTHS = ['2020-01-31','2020-02-29','2020-03-31','2020-04-30','2020-05-31','2020-06-30','2020-07-31','2020-08-31','2020-09-30','2020-10-31','2020-11-30','2020-12-31','2021-01-31','2021-02-28','2021-03-31','2021-04-30','2021-05-31','2021-06-30','2021-07-31','2021-08-31','2021-09-30','2021-10-31','2021-11-30','2021-12-31'];
const QENDS = new Set(['2020-03-31','2020-06-30','2020-09-30','2020-12-31','2021-03-31','2021-06-30','2021-09-30','2021-12-31']);
function install(prices) { // prices: 24 monthly numbers (tqqq=qqq=spy=qld=sso=spxl)
  const md = MONTHS.map((d, i) => [d, prices[i], prices[i], prices[i], prices[i], prices[i], prices[i]]);
  global.monthlyData = md;
  global.quarterlyData = md.filter(r => QENDS.has(r[0]));
  global.periodDataByName = null; global.monthsInPeriodByName = null; global.monthlyByQuarter = null;
  global.smaAtMonthlyByKey = null; global.rsiAtMonthlyByAsset = null;
}
(0, eval)(sim);
// utils.js (unlike simulate.js) has top-level DOM-touching calls elsewhere in
// the file (icon setup etc.), so evaling the whole thing breaks under Node —
// pull out just the pure functions under test by source instead.
(function () {
  const utilsSrc = fs.readFileSync(__dirname + '/../js/utils.js', 'utf8');
  for (const name of ['computeDayChange', 'computeFlowAdjustedDrawdown']) {
    const m = utilsSrc.match(new RegExp('function ' + name + '\\([\\s\\S]*?\\n}'));
    if (!m) throw new Error(name + ' not found in js/utils.js — did it move/rename?');
    (0, eval)(m[0]);
    global[name] = eval(name);
  }
})();

// metrics.js is a pure module — load it directly for the IRR / daily-drawdown tests.
const { computeMoneyWeightedReturn, buildContributionFlows, moneyWeightedCAGR, computeDailyMaxDrawdown } = require('../js/metrics.js');

const A = []; let pass = true;
const ck = (n, c, e) => { if (!c) { pass = false; A.push('  FAIL  ' + n + (e ? '   ' + e : '')); } else A.push('  ok    ' + n); };
const approx = (a, b, tol) => Math.abs(a - b) <= (tol != null ? tol : 1e-6) * Math.max(1, Math.abs(b));
const flat = new Array(24).fill(100), last = 7;

// ----- Buy & Hold -----
install(flat);
let r = simulate(1000, 0, 0, 0, last, 0, {});
ck('B&H lump, flat → value stays 1000', approx(r.bhPoints.at(-1).value, 1000));
ck('B&H lump → totalContributed = initial', r.totalContributed === 1000);
r = simulate(1000, 100, 0, 0, last, 0, {});
ck('B&H DCA flat → totalContributed = 1000 + 21*100', r.totalContributed === 3100);
ck('B&H DCA flat → final value 3100 (31 shares)', approx(r.bhPoints.at(-1).value, 3100));
ck('B&H DCA → q1 value 1300', approx(r.bhPoints[1].value, 1300));
const dblP = MONTHS.map((d, i) => i <= 2 ? 100 : 200);
install(dblP);
ck('B&H lump, doubling → final 2000', approx(simulate(1000, 0, 0, 0, last, 0, {}).bhPoints.at(-1).value, 2000));

// ----- 9sig core invariants -----
const vary = [100,100,120,90,110,80,130,70,140,95,105,150,60,160,100,100,100,100,100,100,100,100,100,100];
install(vary);
r = simulate(1000, 100, 0, 0, last, 0, { qGrowth: 0.09 });
ck('9sig invariant: total === tqqqVal + cash (every row)', r.log.every(l => approx(l.total, l.tqqqVal + l.cash, 1e-6)));
ck('9sig: first row action is START', r.log[0].action === 'START');
ck('9sig: total > 0 every row', r.log.every(l => l.total > 0));
install(flat);
r = simulate(1000, 0, 0, 0, last, 0, { qGrowth: 0.09 });
ck('9sig conservation: flat + no contrib + 0 rate → total stays 1000', r.log.every(l => approx(l.total, 1000, 1e-6)));

// ----- 9sig rebalancing -----
install(MONTHS.map((d, i) => i <= 2 ? 100 : 200));
r = simulate(1000, 0, 0, 0, 1, 0, { qGrowth: 0.09, spikeTriggerPct: 0 });
ck('9sig SELL: total conserved at pre-rebalance 1600', approx(r.log[1].total, 1600, 1e-6));
ck('9sig SELL: action is a SELL', /SELL/.test(r.log[1].action), r.log[1].action);
ck('9sig SELL: stock pulled down to signal (654)', approx(r.log[1].tqqqVal, 654, 1e-6));
install(MONTHS.map((d, i) => i <= 2 ? 100 : 10));
r = simulate(1000, 0, 0, 0, 1, 0, { qGrowth: 0.09 });
ck('9sig BUY throttle: keeps >= 10% cash dry', r.log[1].cash >= 40 - 1e-6, 'cash ' + r.log[1].cash);
ck('9sig BUY throttle: partial buy flagged', /part/.test(r.log[1].action), r.log[1].action);
ck('9sig BUY: total conserved at 460', approx(r.log[1].total, 460, 1e-6));

// ----- contribution split / Invested Compounded / annual raise -----
install(flat);
const rNo = simulate(1000, 100, 0, 0, last, 0, { qGrowth: 0.09, contribDeployPct: 0 });
const rYes = simulate(1000, 100, 0, 0, last, 0, { qGrowth: 0.09, contribDeployPct: 0.5 });
ck('contribDeployPct: same totalContributed regardless of split', rNo.totalContributed === rYes.totalContributed);
ck('contribDeployPct: flat prices → same end total (timing only matters intra-period)', approx(rNo.log.at(-1).total, rYes.log.at(-1).total, 1e-6));
r = simulate(1000, 100, 0, 0, last, 0, { baselineRate: 0.12 });
let v = 1000; for (let i = 0; i < 21; i++) v = v * 1.01 + 100;
ck('Invested Compounded matches manual compounding loop', approx(r.log.at(-1).investedCompounded, v, 1e-6));
ck('Invested Compounded > totalContributed (interest accrues)', r.log.at(-1).investedCompounded > r.totalContributed);
r = simulate(1000, 100, 0, 0, last, 0.10, {});
ck('totalContributed honors annual raise (9*100 + 12*110)', r.totalContributed === 1000 + 9 * 100 + 12 * 110);

// ----- drawdown -----
ck('drawdown [100,150,75,120] = 0.5', approx(computeMaxDrawdown([100, 150, 75, 120]).pct, 0.5));
ck('drawdown monotonic-up = 0', computeMaxDrawdown([100, 110, 120]).pct === 0);
// Drawdown range tracks the peak (idx 1) → trough (idx 2) bracket and resolves dates when provided.
(function () {
  const r = computeMaxDrawdown([100, 150, 75, 120], ['2020-01-31', '2020-02-29', '2020-03-31', '2020-04-30']);
  ck('drawdown range: peakIdx = 1 (peak 150)', r.peakIdx === 1, 'got ' + r.peakIdx);
  ck('drawdown range: troughIdx = 2 (trough 75)', r.troughIdx === 2, 'got ' + r.troughIdx);
  ck('drawdown range: peakDate resolved', r.peakDate === '2020-02-29', 'got ' + r.peakDate);
  ck('drawdown range: troughDate resolved', r.troughDate === '2020-03-31', 'got ' + r.troughDate);
  // After a new high (180), a deeper second drawdown supersedes the first; range moves to the new peak/trough.
  const r2 = computeMaxDrawdown([100, 150, 75, 180, 60], ['a', 'b', 'c', 'd', 'e']);
  ck('drawdown range: second deeper trough wins (peak=d, trough=e)',
     r2.peakDate === 'd' && r2.troughDate === 'e',
     'got peak=' + r2.peakDate + ' trough=' + r2.troughDate);
  // No dates → null peak/trough date (still computes pct).
  const r3 = computeMaxDrawdown([100, 50]);
  ck('drawdown range: no dates → null date fields, pct still set',
     r3.pct === 0.5 && r3.peakDate === null && r3.troughDate === null);
})();

// ----- SMA -----
install(flat); global.smaAtMonthlyByKey = { 'qqq_200': new Array(24).fill(1) };
ck('SMA always-in, flat, no contrib → 1000', approx(simulateSMA(1000, 0, 0, 0, last, 0, { smaAsset: 'qqq', smaWindow: 200, underlyingCol: 1 }).smaPoints.at(-1).value, 1000));
global.smaAtMonthlyByKey = { 'qqq_200': new Array(24).fill(1e9) };
ck('SMA always-out, 0 rate → stays 1000 (cash)', approx(simulateSMA(1000, 0, 0, 0, last, 0, { smaAsset: 'qqq', smaWindow: 200, underlyingCol: 1 }).smaPoints.at(-1).value, 1000));
install(dblP); global.smaAtMonthlyByKey = { 'qqq_200': new Array(24).fill(1) };
ck('SMA always-in, doubling underlying → 2000', approx(simulateSMA(1000, 0, 0, 0, last, 0, { smaAsset: 'qqq', smaWindow: 200, underlyingCol: 1 }).smaPoints.at(-1).value, 2000));

// ----- SMA: out-asset, DCA ladders, bodyguard -----
// SMA always-out + outAsset = qqq → fully invested in QQQ on price doubling.
// Same prices as dblP (100 → 200), so $1000 lump → $2000.
install(dblP); global.smaAtMonthlyByKey = { 'qqq_200': new Array(24).fill(1e9), 'spy_200': new Array(24).fill(1e9) };
ck('SMA always-out + outAsset=qqq, doubling → 2000 (full QQQ exposure)',
   approx(simulateSMA(1000, 0, 0, 0, last, 0, { smaAsset: 'qqq', smaWindow: 200, underlyingCol: 1, outAsset: 'qqq' }).smaPoints.at(-1).value, 2000));
// Always-in + DCA-in 12mo on a doubling underlying (price 100→200 step at month 3):
// shouldn't matter — we start "in" so the first month deploys fully via the seed.
// Then on stable prices, DCA-in has no effect once in.
install(dblP); global.smaAtMonthlyByKey = { 'qqq_200': new Array(24).fill(1) };
ck('SMA always-in + dcaInMonths=12 → still doubles (seed bypasses ladder)',
   approx(simulateSMA(1000, 0, 0, 0, last, 0, { smaAsset: 'qqq', smaWindow: 200, underlyingCol: 1, dcaInMonths: 12 }).smaPoints.at(-1).value, 2000));
// Bodyguard GTFO: SMA always-in, but signal-asset (qqq) is wildly above its SMA → bgGtfo forces cash.
// We rig: smaAtMonthlyByKey['qqq_200'] = 1 (so primary signal stays "in" — price > 1), AND we ALSO set
// the bodyguard branch to use 'qqq_200' (default for underlyingCol=1 = tqqq → unleveraged = qqq).
// Underlying price (col 1 = TQQQ) = 100..200 throughout. unleveraged QQQ price = same column (synth data).
// So aboveBy = (200/1 - 1)*100 = 19900% → trivially > any threshold → bgGtfo trips immediately.
ck('SMA always-in + bgGtfo=30 → forced to cash, no doubling',
   simulateSMA(1000, 0, 0, 0, last, 0, { smaAsset: 'qqq', smaWindow: 200, underlyingCol: 1, bgGtfoPct: 30 }).smaPoints.at(-1).value < 1100);

// QLD as underlying (col 4) — when prices double the holding doubles.
// The synthetic install() fills every column with the same price array, so
// underlyingCol:4 (QLD) on dblP behaves identically to underlyingCol:1 (TQQQ).
install(dblP); global.smaAtMonthlyByKey = { 'qqq_200': new Array(24).fill(1) };
ck('SMA always-in, underlyingCol=4 (QLD), doubling → 2000',
   approx(simulateSMA(1000, 0, 0, 0, last, 0, { smaAsset: 'qqq', smaWindow: 200, underlyingCol: 4 }).smaPoints.at(-1).value, 2000));
ck('9sig with underlyingCol=4 (QLD): qldPoints present + doubles',
   approx(simulate(1000, 0, 0, 0, last, 0, { qGrowth: 0.09, underlyingCol: 4 }).qldPoints.at(-1).value, 2000));

// SSO (col 5, 2× S&P) and SPXL (col 6, 3× S&P) as underlyings.
ck('SMA always-in, underlyingCol=5 (SSO), doubling → 2000',
   approx(simulateSMA(1000, 0, 0, 0, last, 0, { smaAsset: 'qqq', smaWindow: 200, underlyingCol: 5 }).smaPoints.at(-1).value, 2000));
ck('SMA always-in, underlyingCol=6 (SPXL), doubling → 2000',
   approx(simulateSMA(1000, 0, 0, 0, last, 0, { smaAsset: 'qqq', smaWindow: 200, underlyingCol: 6 }).smaPoints.at(-1).value, 2000));
ck('9sig with underlyingCol=5 (SSO): ssoPoints present + doubles',
   approx(simulate(1000, 0, 0, 0, last, 0, { qGrowth: 0.09, underlyingCol: 5 }).ssoPoints.at(-1).value, 2000));
ck('9sig with underlyingCol=6 (SPXL): spxlPoints present + doubles',
   approx(simulate(1000, 0, 0, 0, last, 0, { qGrowth: 0.09, underlyingCol: 6 }).spxlPoints.at(-1).value, 2000));

// ----- 9sig park-asset: safety side held as an underlying instead of cash -----
// Flat prices → parking in QQQ should yield the same end value as cash + 0 rate.
install(flat);
const rParkCash = simulate(1000, 100, 0, 0, last, 0, { qGrowth: 0.09 });
const rParkQQQ  = simulate(1000, 100, 0, 0, last, 0, { qGrowth: 0.09, parkAsset: 'qqq' });
ck('parkAsset=qqq on flat prices: same end total as cash + 0 rate',
   approx(rParkCash.log.at(-1).total, rParkQQQ.log.at(-1).total, 1e-6),
   'cash ' + rParkCash.log.at(-1).total.toFixed(2) + ' vs qqq ' + rParkQQQ.log.at(-1).total.toFixed(2));
// Doubling underlying with parkAsset=qqq: the safety side rides the doubling.
// 1000 initial, 40% cashPct → 400 parked. No contribs. On doubling, parked side
// = 800. Stock side (col 1, TQQQ) also doubles: 600 → 1200. Total ~2000 if no
// rebalance pulled. With 9sig SELL at q1, the holding gets pulled back to signal
// but the SELL proceeds go INTO the park asset (which is also doubled).
install(dblP);
const rParkDbl = simulate(1000, 0, 0, 0, 1, 0, { qGrowth: 0.09, spikeTriggerPct: 0, parkAsset: 'qqq' });
ck('parkAsset=qqq on doubling: total > parkAsset=cash equivalent (safety rides)',
   rParkDbl.log[1].total > simulate(1000, 0, 0, 0, 1, 0, { qGrowth: 0.09, spikeTriggerPct: 0 }).log[1].total + 100,
   'park-qqq ' + rParkDbl.log[1].total.toFixed(2));
// Invariant still holds: total === tqqqVal + cash (cash is re-priced from park shares).
ck('parkAsset=qqq: total === tqqqVal + cash invariant preserved',
   rParkDbl.log.every(l => approx(l.total, l.tqqqVal + l.cash, 1e-6)));

// ----- #1 signal growth is LITERAL per rebalance period -----
install(flat);
r = simulate(1000, 0, 0, 0, last, 0, { qGrowth: 0.09 });
ck('quarterly: signal grows 9% PER QUARTER → target 654 after q1', approx(r.log[1].target, 654, 1e-6), 'got ' + r.log[1].target);
(function () { // yearly: the SAME 9% setting grows the signal 9% PER YEAR (literal, not annualized)
  const md = MONTHS.map(d => [d, 100, 100, 100, 0, 100]);
  global.monthlyData = md;
  global.quarterlyData = md.filter(x => QENDS.has(x[0]));
  global.periodDataByName = { yearly: md.filter(x => x[0].endsWith('-12-31')) };
  global.monthsInPeriodByName = null; global.monthlyByQuarter = null; global.smaAtMonthlyByKey = null; global.rsiAtMonthlyByAsset = null;
})();
const ry = simulate(1000, 0, 0, 0, 7, 0, { rebalancePeriod: 'yearly', qGrowth: 0.09 });
ck('yearly: signal grows 9% PER YEAR (literal) → target 654 after year 1', approx(ry.log[1].target, 654, 1e-4), 'got ' + ry.log[1].target.toFixed(2));
// Live snapshot tail: chart exit (2021-12-31) is past the last anniversary
// (2021-03-31), so simulate appends a non-rebalancing SNAPSHOT row at exit so
// the chart's right edge reflects current shares × current price + current cash.
const lastRow = ry.log[ry.log.length - 1];
ck('yearly live snapshot: last row is SNAPSHOT at chart exit',
   lastRow.action === 'SNAPSHOT' && lastRow.date === '2021-12-31',
   JSON.stringify({ date: lastRow.date, action: lastRow.action }));
ck('yearly live snapshot: total conserved (flat prices + no contrib → 1000)',
   approx(lastRow.total, 1000, 1e-6), 'total ' + lastRow.total.toFixed(2));

// ----- target grows from PRIOR HOLDING (not prior target) -----
// At q1 the prior holding is the start holding (600) — same as the old "grow
// from prior target" gave — so target after q1 is still 600 × 1.09 = 654.
install(MONTHS.map((d, i) => i <= 2 ? 100 : 10));
r = simulate(1000, 0, 0, 0, 1, 0, { qGrowth: 0.09 });
ck('target after q1 = prior holding × (1+g) = 600 × 1.09 = 654', approx(r.log[1].target, 654, 1e-6), 'target ' + r.log[1].target);
// The behaviour difference shows up at q2: after q1's throttled buy left the
// holding at 420 (not the 654 the target asked for), q2's target grows from
// 420, NOT from the runaway 654. So 420 × 1.09 = 457.8 instead of 654 × 1.09.
r = simulate(1000, 0, 0, 0, 2, 0, { qGrowth: 0.09 });
ck('target at q2 grows from prior HOLDING (457.8), not prior target (712.9)',
   approx(r.log[2].target, 420 * 1.09, 1e-3),
   'q1 holding ' + r.log[1].tqqqVal.toFixed(1) + ' · q2 target ' + r.log[2].target.toFixed(2));
// targetFromPrevTarget: TRUE = compound the target on itself —
// q2's target then grows from the prior TARGET (654), not the throttled holding.
r = simulate(1000, 0, 0, 0, 2, 0, { qGrowth: 0.09, targetFromPrevTarget: true });
ck('opts.targetFromPrevTarget: q2 target grows from prior TARGET (712.9) instead',
   approx(r.log[2].target, 654 * 1.09, 1e-3),
   'q2 target ' + r.log[2].target.toFixed(2));

// ----- #2 money-weighted (IRR) return -----
ck('IRR: -100 @t0, +110 @t1 → 10%', approx(computeMoneyWeightedReturn([{ t: 0, cf: -100 }, { t: 1, cf: 110 }]), 10, 1e-4));
ck('IRR: -100 @t0, +121 @t2 → 10% (compounded 2y)', approx(computeMoneyWeightedReturn([{ t: 0, cf: -100 }, { t: 2, cf: 121 }]), 10, 1e-4));
ck('IRR: two -100 deposits, +231 @t2 → 10%', approx(computeMoneyWeightedReturn([{ t: 0, cf: -100 }, { t: 1, cf: -100 }, { t: 2, cf: 231 }]), 10, 1e-4));
ck('IRR: all-negative stream → null (no return)', computeMoneyWeightedReturn([{ t: 0, cf: -100 }, { t: 1, cf: -100 }]) === null);
ck('IRR: total loss to ~0 → strongly negative', computeMoneyWeightedReturn([{ t: 0, cf: -100 }, { t: 1, cf: 1 }]) < -90);

// moneyWeightedCAGR with no monthly contributions reduces to the simple CAGR
ck('moneyWeightedCAGR(lump, no DCA) == simple CAGR (1000→2000 / 2y ≈ 41.42%)',
   approx(moneyWeightedCAGR(1000, 0, 0, '2020-01-01', '2022-01-01', 2, 2000, [], 1000), (Math.pow(2, 1 / 2) - 1) * 100, 1e-3));

// DCA into a rising market: money-weighted return EXCEEDS the naive
// end/totalContributed CAGR (early dollars compounded longer). This is the
// whole point of fix #2.
(function () {
  install(flat); // gives us monthlyData (24 monthly rows) for the contribution schedule
  const start = '2020-03-31', end = '2021-12-31', yrs = (new Date(end) - new Date(start)) / (365.25 * 86400000);
  const finalV = 9000; // arbitrary "winning" final value
  const tc = 1000 + 21 * 100; // initial + 21 monthly contributions = 3100
  const mw = moneyWeightedCAGR(1000, 100, 0, start, end, yrs, finalV, monthlyData, tc);
  const simpleCagr = (Math.pow(finalV / tc, 1 / yrs) - 1) * 100;
  ck('moneyWeightedCAGR(DCA, rising) > simple end/contributed CAGR', mw > simpleCagr, 'mw ' + mw.toFixed(2) + ' vs simple ' + simpleCagr.toFixed(2));
})();

// ----- #3 daily-sampled max drawdown -----
const dly = (arr, key) => arr.map(([date, px]) => ({ date, [key]: px }));
// Pure holding (1 share, no cash): drawdown follows the price path. Control
// points bracket the path (first + last rebalance), as real strategies always do.
ck('dailyDD: pure holding 100→150→75 = 50%',
   approx(computeDailyMaxDrawdown([{ date: '2020-01-01', shares: 1, cash: 0 }, { date: '2020-01-03', shares: 1, cash: 0 }],
     dly([['2020-01-01', 100], ['2020-01-02', 150], ['2020-01-03', 75]], 'tqqq'), 'tqqq').pct, 0.5, 1e-9));
// Daily DD also reports the peak/trough DATES so the UI can render "Jan 2020 – Mar 2020".
(function () {
  const r = computeDailyMaxDrawdown(
    [{ date: '2020-01-01', shares: 1, cash: 0 }, { date: '2020-01-03', shares: 1, cash: 0 }],
    dly([['2020-01-01', 100], ['2020-01-02', 150], ['2020-01-03', 75]], 'tqqq'), 'tqqq');
  ck('dailyDD range: peakDate = 2020-01-02', r.peakDate === '2020-01-02', 'got ' + r.peakDate);
  ck('dailyDD range: troughDate = 2020-01-03', r.troughDate === '2020-01-03', 'got ' + r.troughDate);
})();
// Daily sampling catches an intra-period crash that the rebalance-grain points miss.
// Two control points both at value 100 (flat at the "rebalances"), but the price
// dives 40% mid-way → daily DD = 40%.
ck('dailyDD: catches intra-period crash the period grain misses (40%)',
   approx(computeDailyMaxDrawdown(
     [{ date: '2020-01-01', shares: 1, cash: 0 }, { date: '2020-01-05', shares: 1, cash: 0 }],
     dly([['2020-01-01', 100], ['2020-01-02', 60], ['2020-01-03', 90], ['2020-01-05', 100]], 'tqqq'), 'tqqq').pct, 0.4, 1e-9));
// Cash cushions the drawdown: 1 share + 100 cash, price 100→50 → value 200→150 = 25%.
ck('dailyDD: cash cushions drawdown (25% not 50%)',
   approx(computeDailyMaxDrawdown([{ date: '2020-01-01', shares: 1, cash: 100 }, { date: '2020-01-02', shares: 1, cash: 100 }],
     dly([['2020-01-01', 100], ['2020-01-02', 50]], 'tqqq'), 'tqqq').pct, 0.25, 1e-9));
// Daily DD >= period-grain DD for a volatile holding (it can only find MORE drawdown).
(function () {
  const ctrl = [{ date: '2020-01-01', shares: 1, cash: 0 }, { date: '2020-01-31', shares: 1, cash: 0 }];
  const prices = [['2020-01-01', 100], ['2020-01-10', 40], ['2020-01-20', 70], ['2020-01-31', 120]];
  const ddDaily = computeDailyMaxDrawdown(ctrl, dly(prices, 'tqqq'), 'tqqq').pct;
  const periodSeries = ctrl.map(c => c.shares * prices.find(p => p[0] === c.date)[1] + c.cash); // [100, 120]
  const ddPeriod = computeMaxDrawdown(periodSeries).pct;
  ck('dailyDD >= period-grain DD for volatile holding', ddDaily >= ddPeriod && ddDaily > 0.5, 'daily ' + ddDaily.toFixed(3) + ' period ' + ddPeriod.toFixed(3));
})();

// ----- exitDateOverride + qData subset (exact-range API) -----
// A caller can pin a sim to an arbitrary shorter range via entryDateOverride/
// exitDateOverride + a qData subset (the exact-date-picker mechanism) — this
// checks that produces a shorter-range result consistent with fewer elapsed
// contributions. (The day-change badge deliberately does NOT use this — an
// exit-shifted sim drops the whole current partial month's contributions via
// the month-row walk; it reprices end-state holdings instead, see
// js/utils.js's repriceAtPrevTradingDay.)
(function () {
  install(flat);
  const full = simulate(1000, 100, 0, 0, last, 0, {});
  const shortQData = quarterlyData.slice(0, 6); // stops 2 quarters before `last`
  const short = simulate(1000, 100, 0, 0, last, 0, {
    qData: shortQData,
    entryDateOverride: quarterlyData[0][0],
    exitDateOverride: shortQData[shortQData.length - 1][0],
  });
  ck('exitDateOverride+qData shift → shorter range invests less than full range',
     short.totalContributed < full.totalContributed,
     'short ' + short.totalContributed + ' full ' + full.totalContributed);
  ck('exitDateOverride+qData shift → shorter range B&H value = totalContributed (flat prices)',
     approx(short.bhPoints.at(-1).value, short.totalContributed));
})();

// ----- computeDayChange (js/utils.js) — the day-over-day change badge's math -----
ck('computeDayChange: 100→110 = {pct:10, abs:10}',
   (() => { const d = computeDayChange(110, 100); return !!d && approx(d.pct, 10) && approx(d.abs, 10); })());
ck('computeDayChange: 100→90 = {pct:-10, abs:-10}',
   (() => { const d = computeDayChange(90, 100); return !!d && approx(d.pct, -10) && approx(d.abs, -10); })());
ck('computeDayChange: non-finite today → null', computeDayChange(NaN, 100) === null);
ck('computeDayChange: zero yesterday → null (div-by-zero guard)', computeDayChange(100, 0) === null);
ck('computeDayChange: negative yesterday → null', computeDayChange(100, -5) === null);

// ----- computeFlowAdjustedDrawdown (js/utils.js) — "My portfolio" DD -----
// The whole point: withdrawals/deposits move the BALANCE but are not market
// performance, so they must not register as drawdown/recovery.
(function () {
  const P = (arr) => arr.map(([date, value]) => ({ date, value }));
  const F = (arr) => arr.map(([date, amount]) => ({ date, amount }));
  // 1. Pure withdrawal, flat market: 100 → withdraw 50 → balance 50. Naive DD = 50%; true DD = 0.
  let d = computeFlowAdjustedDrawdown(
    P([['2024-01-01', 100], ['2024-02-01', 50]]),
    F([['2024-02-01', -50]]));
  ck('flowDD: withdrawal on flat market → 0% (naive would say 50%)', approx(d.pct, 0));
  // 2. Pure deposit, flat market: 100 → deposit 100 → 200: no "recovery", no DD.
  d = computeFlowAdjustedDrawdown(
    P([['2024-01-01', 100], ['2024-02-01', 200]]),
    F([['2024-02-01', 100]]));
  ck('flowDD: deposit on flat market → 0%', approx(d.pct, 0));
  // 3. Real 50% crash, no flows → 50%.
  d = computeFlowAdjustedDrawdown(
    P([['2024-01-01', 100], ['2024-02-01', 50], ['2024-03-01', 80]]), []);
  ck('flowDD: genuine 50% crash → 50%', approx(d.pct, 0.5));
  ck('flowDD: crash peak/trough dates', d.peakDate === '2024-01-01' && d.troughDate === '2024-02-01');
  // 4. Crash MASKED by a deposit: 100 → (deposit 60, market halves: 50+60=110).
  //    Naive sees balance UP (no DD); true market DD = 50%.
  d = computeFlowAdjustedDrawdown(
    P([['2024-01-01', 100], ['2024-02-01', 110]]),
    F([['2024-02-01', 60]]));
  ck('flowDD: crash hidden under a deposit → 50% (naive would say 0%)', approx(d.pct, 0.5));
  // 5. Withdrawal DURING a real crash: 100 → market -30% and withdraw 20 (70-20=50).
  //    True DD 30%, not 50%.
  d = computeFlowAdjustedDrawdown(
    P([['2024-01-01', 100], ['2024-02-01', 50]]),
    F([['2024-02-01', -20]]));
  ck('flowDD: withdrawal during a 30% crash → 30%, not 50%', approx(d.pct, 0.3));
  // 6. Flows at-or-before the first reading are ignored (index starts there).
  d = computeFlowAdjustedDrawdown(
    P([['2024-01-01', 100], ['2024-02-01', 100]]),
    F([['2024-01-01', 100]]));
  ck('flowDD: flow at the first reading ignored → 0%', approx(d.pct, 0));
})();

console.log(A.join('\n'));
console.log(pass ? '\n===== ALL PASS =====' : '\n===== FAILURES =====');
process.exit(pass ? 0 : 1);