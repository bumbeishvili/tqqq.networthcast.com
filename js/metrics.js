// metrics.js — pure portfolio-metric math (no DOM, no shared globals). Loaded
// before chart.js / saved-configs.js, and unit-tested directly in tests/sim.cjs.
//
// Two metrics live here:
//   1. computeMoneyWeightedReturn — money-weighted (IRR / XIRR) annual return.
//      It weights each contributed dollar by HOW LONG it was actually invested,
//      replacing the naive (endValue / totalContributed)^(1/years) CAGR, which
//      pretended every contribution was deposited on day one. Early
//      contributions compound longer, so they count for more — exactly the
//      "first years weighted more than last ones" behaviour we want.
//   2. computeDailyMaxDrawdown — max drawdown of a portfolio revalued at EVERY
//      daily close (reconstructed from rebalance "control points"), so an
//      intra-period crash is not hidden by coarse rebalance-grain sampling.

// Money-weighted annual return. Solves for the annual rate r where the net
// present value of all cash flows is zero:  Σ cf_i / (1+r)^(t_i) = 0, with t_i
// in years from the first flow. Contributions are negative (money in); the final
// portfolio value is the positive flow (money out). Solved by bisection on a
// wide bracket — no derivative needed and robust for the single-sign-change
// streams a contribution schedule produces. Returns a percentage, or null when
// it can't bracket a root (e.g. all-loss streams).
function computeMoneyWeightedReturn(flows) {
  if (!flows || flows.length < 2) return null;
  let hasPos = false, hasNeg = false;
  for (const f of flows) { if (f.cf > 0) hasPos = true; else if (f.cf < 0) hasNeg = true; }
  if (!hasPos || !hasNeg) return null;
  const npv = (r) => {
    let s = 0;
    for (const f of flows) s += f.cf / Math.pow(1 + r, f.t);
    return s;
  };
  let lo = -0.999999, hi = 1000;
  let flo = npv(lo), fhi = npv(hi);
  if (flo === 0) return lo * 100;
  if (!Number.isFinite(flo) || !Number.isFinite(fhi) || flo * fhi > 0) return null; // no sign change
  for (let i = 0; i < 300; i++) {
    const mid = (lo + hi) / 2;
    const fm = npv(mid);
    if (!Number.isFinite(fm)) return null;
    if (Math.abs(fm) < 1e-9 || (hi - lo) < 1e-12) return mid * 100;
    if (flo * fm <= 0) { hi = mid; } else { lo = mid; flo = fm; }
  }
  return ((lo + hi) / 2) * 100;
}

// Build the contribution cash-flow stream shared by every strategy over a date
// span: an initial outflow at t=0, then each contribution at its own date. All
// flows are NEGATIVE (money in) — append the strategy's final value as a
// positive flow before solving for the return.
//
// `schedule` (optional, from js/simulate.js's buildFormulaSchedule or a real
// uploaded transaction history) is preferred when supplied — its `.list` is
// already `{date, amount}` pairs, real dates included, no formula needed here.
// Without it, falls back to the original formula recomputed against
// `monthlyRows` ([date, ...] rows, the global monthlyData shape) — kept
// exactly as before so existing callers/tests (tests/sim.cjs) are unaffected.
function buildContributionFlows(initial, monthly, annualRaise, startDate, endDate, monthlyRows, schedule) {
  const start = new Date(startDate + 'T00:00:00Z');
  const flows = [{ t: 0, cf: -initial }];
  if (schedule && schedule.list) {
    for (const row of schedule.list) {
      if (row.date > startDate && row.date <= endDate && row.amount !== 0) {
        const t = (new Date(row.date + 'T00:00:00Z') - start) / (365.25 * 86400000);
        flows.push({ t, cf: -row.amount });
      }
    }
    return flows;
  }
  annualRaise = annualRaise || 0;
  const startYear = parseInt(String(startDate).substring(0, 4), 10);
  if (monthlyRows && monthly > 0) {
    for (let i = 0; i < monthlyRows.length; i++) {
      const d = monthlyRows[i][0];
      if (d > startDate && d <= endDate) {
        const yr = parseInt(String(d).substring(0, 4), 10);
        const amt = monthly * Math.pow(1 + annualRaise, yr - startYear);
        const t = (new Date(d + 'T00:00:00Z') - start) / (365.25 * 86400000);
        flows.push({ t, cf: -amt });
      }
    }
  }
  return flows;
}

// Convenience: money-weighted CAGR (%) for one strategy given its contribution
// schedule and final value. Falls back to the simple end/contributed CAGR when
// the IRR can't be solved (degenerate or loss-to-zero streams). `schedule` is
// optional — see buildContributionFlows.
function moneyWeightedCAGR(initial, monthly, annualRaise, startDate, endDate, years, finalValue, monthlyRows, totalContributed, schedule) {
  if (!(finalValue > 0) || !(years > 0)) return 0;
  const flows = buildContributionFlows(initial, monthly, annualRaise, startDate, endDate, monthlyRows, schedule);
  flows.push({ t: years, cf: finalValue });
  const r = computeMoneyWeightedReturn(flows);
  if (r != null && Number.isFinite(r)) return r;
  const tc = totalContributed > 0 ? totalContributed : initial;
  return tc > 0 ? (Math.pow(finalValue / tc, 1 / years) - 1) * 100 : 0;
}

// Max drawdown (fraction 0..1) of a portfolio revalued at every daily close.
// Reconstructed from rebalance "control points": between consecutive controls
// the holding (`shares` of the underlying) and `cash` are constant, so portfolio
// value moves only with the daily underlying price. This surfaces intra-period
// crashes that the rebalance-grain `total` series cannot show.
//   controls:  [{ date, shares, cash }]  sorted ascending by date
//   dailyRows: [{ date, [priceKey]:Number, ... }]  e.g. the global `daily`
//   priceKey:  daily field to revalue against ('tqqq'|'qqq'|'spy'|'qld'|'sso'|'spxl')
function computeDailyMaxDrawdown(controls, dailyRows, priceKey) {
  const empty = { pct: 0, peakDate: null, troughDate: null };
  if (!controls || !controls.length || !dailyRows || !dailyRows.length) return empty;
  const startDate = controls[0].date;
  const endDate = controls[controls.length - 1].date;
  let peak = -Infinity, peakDate = null, maxDD = 0, bestPeakDate = null, bestTroughDate = null, ci = 0;
  for (let i = 0; i < dailyRows.length; i++) {
    const row = dailyRows[i];
    if (row.date < startDate) continue;
    if (row.date > endDate) break;
    while (ci + 1 < controls.length && controls[ci + 1].date <= row.date) ci++;
    const c = controls[ci];
    const px = row[priceKey];
    if (!(px > 0)) continue;
    const v = c.shares * px + c.cash;
    if (!Number.isFinite(v) || v <= 0) continue;
    if (v > peak) { peak = v; peakDate = row.date; }
    if (peak > 0) {
      const dd = (peak - v) / peak;
      if (dd > maxDD) { maxDD = dd; bestPeakDate = peakDate; bestTroughDate = row.date; }
    }
  }
  return { pct: maxDD, peakDate: bestPeakDate, troughDate: bestTroughDate };
}

// Max drawdown (fraction 0..1) for a portfolio that holds MULTIPLE assets at
// once (the SMA strategy can sit in a leveraged ETF, an unleveraged out-asset,
// and cash — sometimes mixed mid-DCA). Each control carries the full holding
// map + cash; between controls the holding is constant and the portfolio is
// revalued at every daily close. This fixes the single-asset reconstruction
// that ignored the out-asset bucket entirely.
//   controls:  [{ date, h: { asset: shares, ... }, cash }]  ascending by date
//   dailyRows: [{ date, tqqq, qqq, spy, ... }]  e.g. the global `daily`
function computeDailyMaxDrawdownMulti(controls, dailyRows) {
  const empty = { pct: 0, peakDate: null, troughDate: null };
  if (!controls || !controls.length || !dailyRows || !dailyRows.length) return empty;
  const startDate = controls[0].date;
  const endDate = controls[controls.length - 1].date;
  let peak = -Infinity, peakDate = null, maxDD = 0, bestPeakDate = null, bestTroughDate = null, ci = 0;
  for (let i = 0; i < dailyRows.length; i++) {
    const row = dailyRows[i];
    if (row.date < startDate) continue;
    if (row.date > endDate) break;
    while (ci + 1 < controls.length && controls[ci + 1].date <= row.date) ci++;
    const c = controls[ci];
    let v = c.cash || 0;
    const h = c.h || {};
    for (const a in h) { const px = row[a]; if (px > 0) v += h[a] * px; }
    if (!Number.isFinite(v) || v <= 0) continue;
    if (v > peak) { peak = v; peakDate = row.date; }
    if (peak > 0) {
      const dd = (peak - v) / peak;
      if (dd > maxDD) { maxDD = dd; bestPeakDate = peakDate; bestTroughDate = row.date; }
    }
  }
  return { pct: maxDD, peakDate: bestPeakDate, troughDate: bestTroughDate };
}

// Turn a custom strategy's log into daily-revaluation control points, so its
// drawdown can be measured at every daily close like the built-in engines'
// instead of only on the rows it chose to emit. A strategy that logs just
// trades and month ends steps straight over intra-month troughs — worth up to
// 3.4pp on the library's buy-and-hold-through-crashes entries.
//
// Only usable when EVERY row carries held/shares/cash (the custom-strategy
// contract requires just date+value), so this returns null when it can't.
const DD_ASSET_KEYS = { tqqq: 1, qqq: 1, spy: 1, qld: 1, sso: 1, spxl: 1, sqqq: 1 };
function buildCustomDDControls(log) {
  if (!log || !log.length) return null;
  const out = [];
  for (const r of log) {
    if (!r || typeof r.date !== 'string') return null;
    if (typeof r.cash !== 'number' || !Number.isFinite(r.cash)) return null;
    const held = typeof r.held === 'string' ? r.held.toLowerCase() : null;
    if (!held) return null;
    const c = { date: r.date, cash: r.cash, h: {} };
    if (held !== 'cash') {
      if (!DD_ASSET_KEYS[held]) return null;           // unknown ticker — can't revalue
      if (typeof r.shares !== 'number' || !Number.isFinite(r.shares)) return null;
      c.h[held] = r.shares;
    }
    out.push(c);
  }
  return out.length ? out : null;
}

// Node test harness export (no-op in the browser).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { computeMoneyWeightedReturn, buildContributionFlows, moneyWeightedCAGR, computeDailyMaxDrawdown, computeDailyMaxDrawdownMulti, buildCustomDDControls };
}
