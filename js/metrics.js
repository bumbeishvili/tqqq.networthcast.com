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

// A rate as a whole percent with its sign (+117%, -15%, +1,440%): the year so far everywhere, and a card's CAGR
// (the user, 2026-11-26: "round it to nearest whol number", then "let's also round drawdown(unless it's higher
// than 99%) and cagr so we have more space").
const fmtWholePct = (v) => (v >= 0 ? '+' : '') + (Math.round(v) || 0).toLocaleString('en-US') + '%';
// A card's drawdown: a whole percent, but over 99% the decimals fmtDD keeps (−99.9419% and −100% are a live
// account and a dead one).
const fmtCardDD = (pct) => (pct > 99 ? fmtDD(pct) : Math.round(pct) === 0 ? '0%' : '−' + Math.round(pct) + '%');   // no fall: "0%", as fmtDD's "0.0%"
// The year so far after a CAGR on a card or a chip: its figure, small, tight to the CAGR and a little below its
// baseline, and an ⓘ that says what it is (the user, 2026-11-26: "remove in 2026 text, just add info icon where it
// will say what it is, move that small number closer to big number and a bitbottom"), in as few words as it takes
// (the user, of a longer one: "just say this year cagr so far, what the fuck is with thos elengthy words").
const yearCagrTip = () => `${dataYear()} CAGR so far`;
// A small figure with its own ⓘ, or none with no tip: a card has one ⓘ for all its figures (cardTipText in
// js/saved-configs.js), a chip one after each.
const yearSoFarHtml = (text, cls, tip) => `<span class="year-so-far"><span class="year-so-far-value ${cls}">${text}</span>`
  + (tip ? `<span class="info-icon year-so-far-info" tabindex="0" data-tip="${tip}">ⓘ</span>` : '') + '</span>';
const yearCagrHtml = (v, tip = yearCagrTip()) => yearSoFarHtml(fmtWholePct(v), v >= 0 ? 'positive' : 'negative', tip);
// The year's max drawdown after a DD, the same way, its ⓘ with the year's name and the fall's dates
// (maxDDSoFarThisYear's { pct, peakDate, troughDate }).
const yearDDTip = (dd) => { const range = fmtDDRange(dd.peakDate, dd.troughDate); return `${dataYear()} max drawdown so far${range ? ', ' + range.replace('–', ' to ') : ''}`; };
const yearDDHtml = (dd, tip = yearDDTip(dd)) => yearSoFarHtml(fmtCardDD(dd.pct), 'negative', tip);
// The year a CAGR "so far" is of: the year of the data's last day (2026 on 26 November 2026).
const dataYear = () => daily[daily.length - 1].date.slice(0, 4);
// A run's money-weighted CAGR over the data's year so far (the user, 2026-11-26: "also inside cards and
// strategy details, everywehre include 2026 cagr so far"), as the library's "2026–today" column counts it:
// from the run's value at its last point before the year to its last value, with the money paid in or out
// in between (the run's own contributions: money as its whole CAGR takes it). A run that starts inside the
// year is the whole run: its own CAGR. null for a run that ends before the year, or has no value at its start.
//   labels: the run's dates (YYYY-MM-DD); values: its value at each, null where it has none;
//   money: { initial, monthly, annualRaise, contribSchedule }; wholeCagr: the run's CAGR.
function cagrSoFarThisYear(labels, values, money, wholeCagr) {
  const year = dataYear(), last = values.length - 1;
  let end = last;
  while (end >= 0 && values[end] == null) end--;
  if (end < 0 || String(labels[end]).slice(0, 4) < year) return null;
  let from = end;
  while (from >= 0 && String(labels[from]).slice(0, 4) >= year) from--;
  if (from < 0) return wholeCagr;
  const startValue = values[from], finalValue = values[end];
  if (!(startValue > 0) || !(finalValue > 0)) return null;
  const yearsBetween = (a, b) => (new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / (365.25 * 86400000);
  const offset = yearsBetween(labels[0], labels[from]), span = yearsBetween(labels[from], labels[end]);
  const all = buildContributionFlows(money.initial, money.monthly, money.annualRaise, labels[0], labels[end],
    (typeof monthlyData !== 'undefined' ? monthlyData : null), money.contribSchedule);
  const flows = [{ t: 0, cf: -startValue }]
    .concat(all.filter(f => f.t > offset + 1e-9).map(f => ({ t: f.t - offset, cf: f.cf })), { t: span, cf: finalValue });
  const r = computeMoneyWeightedReturn(flows);
  return r != null && Number.isFinite(r) ? r : null;
}

// The last close before the data's year: where the year so far starts, so a fall from that close counts.
function yearStartClose() {
  const year = dataYear();
  for (let i = daily.length - 1; i >= 0; i--) if (daily[i].date.slice(0, 4) < year) return daily[i].date;
  return null;
}
// A run's max drawdown over the data's year so far (the user, 2026-11-27: "Also disay current year max drawdown sr
// way"), measured as its whole drawdown is: `measure(from)` is the run's own drawdown read from the close `from` on,
// here the last close before the year. A run that starts inside the year gets its whole drawdown; one that ends
// before the year (its last date, endDate) none. { pct (percent, as the whole one's maxDD), peakDate, troughDate },
// or null.
function maxDDSoFarThisYear(endDate, measure) {
  if (!endDate || String(endDate).slice(0, 4) < dataYear()) return null;
  const dd = measure(yearStartClose());
  return dd ? { pct: dd.pct * 100, peakDate: dd.peakDate, troughDate: dd.troughDate } : null;
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

// The same money-weighted annual return, for a caller that solves many windows
// of one contribution stream (the analytics years-held chart: every start year
// × every number of years held). The contributions come as plain arrays, so a
// longer window only reads further into them, and the search steps by Newton's
// method from `guess` inside the bisection's own bracket, halving it whenever a
// step would leave it. It works on logs: the log of the contributions' grown
// value is close to a straight line in the log of the yearly growth factor, so
// a handful of passes over the flows land where the bisection above needs
// about fifty. Unlike the bisection it stays finite on a 50-year window with a
// large value, where the bisection's low bracket end overflows.
//   times[k], amounts[k]: the first `count` contributions — years from the
//     start and dollars paid in. All amounts must be >= 0 (money in): then the
//     contributions' grown value only rises with the rate and the root is single.
//   finalValue: the portfolio's value `years` after the start.
// Returns a percentage, or null when there is none: no positive final value,
// nothing paid in, or no root inside the bracket.
function moneyWeightedReturnOfContributions(times, amounts, count, finalValue, years, guess) {
  if (!(finalValue > 0) || !(years > 0)) return null;
  // At a yearly growth factor of e^x: the contributions grown to the window's
  // end, and the dollar-weighted average of how long each one grew — the slope
  // of that total's log in x.
  const grownAt = (x) => {
    let total = 0, weighted = 0;
    for (let k = 0; k < count; k++) {
      const span = years - times[k];
      const grown = amounts[k] * Math.exp(x * span);
      total += grown;
      weighted += grown * span;
    }
    return { total, span: weighted / total };
  };
  let lo = Math.log(1 - 0.999999), hi = Math.log(1 + 1000);
  if (!(grownAt(lo).total < finalValue && grownAt(hi).total > finalValue)) return null; // no root in the bracket
  const target = Math.log(finalValue);
  const start = Math.log(1 + guess);
  let x = (start > lo && start < hi) ? start : Math.log(1.1);
  for (let i = 0; i < 100; i++) {
    const { total, span } = grownAt(x);
    const miss = Math.log(total) - target;
    if (Math.abs(miss) < 1e-12) break;
    if (miss > 0) hi = x; else lo = x;
    const newton = x - miss / span;
    const next = (newton > lo && newton < hi) ? newton : (lo + hi) / 2;
    if (Math.abs(next - x) < 1e-14) break;
    x = next;
  }
  return (Math.exp(x) - 1) * 100;
}

// Max drawdown (fraction 0..1) of a portfolio revalued at every daily close.
// Reconstructed from rebalance "control points": between consecutive controls
// the holding (`shares` of the underlying) and `cash` are constant, so portfolio
// value moves only with the daily underlying price. This surfaces intra-period
// crashes that the rebalance-grain `total` series cannot show.
//   controls:  [{ date, shares, cash }]  sorted ascending by date
//   dailyRows: [{ date, [priceKey]:Number, ... }]  e.g. the global `daily`
//   priceKey:  daily field to revalue against ('tqqq'|'qqq'|'spy'|'qld'|'sso'|'spxl')
//   from:      optional date: read from that close on (the year so far, maxDDSoFarThisYear)
function computeDailyMaxDrawdown(controls, dailyRows, priceKey, from) {
  const empty = { pct: 0, peakDate: null, troughDate: null };
  if (!controls || !controls.length || !dailyRows || !dailyRows.length) return empty;
  const startDate = controls[0].date;
  const endDate = controls[controls.length - 1].date;
  let peak = -Infinity, peakDate = null, maxDD = 0, bestPeakDate = null, bestTroughDate = null, ci = 0;
  for (let i = 0; i < dailyRows.length; i++) {
    const row = dailyRows[i];
    if (row.date < startDate || (from && row.date < from)) continue;
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
//   from:      optional date: read from that close on (the year so far, maxDDSoFarThisYear)
function computeDailyMaxDrawdownMulti(controls, dailyRows, from) {
  const empty = { pct: 0, peakDate: null, troughDate: null };
  if (!controls || !controls.length || !dailyRows || !dailyRows.length) return empty;
  const startDate = controls[0].date;
  const endDate = controls[controls.length - 1].date;
  let peak = -Infinity, peakDate = null, maxDD = 0, bestPeakDate = null, bestTroughDate = null, ci = 0;
  for (let i = 0; i < dailyRows.length; i++) {
    const row = dailyRows[i];
    if (row.date < startDate || (from && row.date < from)) continue;
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

// A 9sig run's log as daily-revaluation control points: the fund's shares and
// the cash after each rebalance (js/chart.js's 9sig drawdown and the Fit
// search's both read it).
function nineSigDDControls(log) {
  return log.map(l => ({ date: l.date, shares: l.price > 0 ? l.tqqqVal / l.price : 0, cash: l.cash }));
}

// Turn a custom strategy's log into daily-revaluation control points, so its
// drawdown can be measured at every daily close like the built-in engines'
// instead of only on the rows it chose to emit. A strategy that logs just
// trades and month ends steps straight over intra-month troughs — worth up to
// 3.4pp on the library's buy-and-hold-through-crashes entries.
//
// Only usable when EVERY row carries held/shares/cash (the custom-strategy
// contract requires just date+value), so this returns null when it can't.
const DD_ASSET_KEYS = { tqqq: 1, qqq: 1, spy: 1, qld: 1, sso: 1, spxl: 1, sqqq: 1, gld: 1, soxl: 1, soxx: 1, soxs: 1 };
function buildCustomDDControls(log) {
  if (!log || !log.length) return null;
  const out = [];
  for (const r of log) {
    if (!r || typeof r.date !== 'string') return null;
    if (typeof r.cash !== 'number' || !Number.isFinite(r.cash)) return null;
    // "TQQQ + CASH" (a part in cash, as Bare volatility targeting writes it) is TQQQ's shares and the row's cash.
    const held = typeof r.held === 'string' ? r.held.toLowerCase().replace(/\s*\+\s*cash$/, '') : null;
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
  module.exports = { computeMoneyWeightedReturn, buildContributionFlows, moneyWeightedCAGR, moneyWeightedReturnOfContributions, computeDailyMaxDrawdown, computeDailyMaxDrawdownMulti, buildCustomDDControls, nineSigDDControls };
}
