'use strict';
// Shared helpers for the four-strategy recheck: runs on any data object (truncated, noisy),
// option lists, neighbours, an independent replay of a holdings sequence on true prices.
const H = require(require('path').join(__dirname, '..', 'lead-basis', 'harness.cjs'));
const { CODE, data, strategyOf, defaultsOf, idxOf, idxBefore } = H;
const NAMES = { 44: 'NFCI', 45: 'Buy-back', 47: 'Stretch', 48: 'NFCI + Mon', 49: 'Buy-back + Mon', 50: 'TQQQ vs QQQ + Mon', 52: 'Mon Turns', 53: 'Fit' };
const FOUR = [48, 49, 50, 53];
const FIT_FROM = '2009-12-31', FIT_TO = '2025-12-31', LAST = '2026-11-06';   // the 2026-11-09 row is an intraday snapshot
// Runs code on a data object over [startIdx, endIdx] (indexes), lump sum.
function runOn(d, code, params, startIdx, endIdx, initial = 100000) {
  const strategy = strategyOf(code);
  const result = strategy.run(d, { ...defaultsOf(code), ...params, initial, monthly: 0, annualRaise: 0, contributions: {},
    startIdx, endIdx, entryDate: d.dates[startIdx], exitDate: d.dates[endIdx], dailyDisplay: true });
  return Array.isArray(result) ? result : result.log;
}
const runLog = (code, params, from = FIT_FROM, to = FIT_TO, d = data) => runOn(d, code, params, typeof from === 'number' ? from : idxOf(from), typeof to === 'number' ? to : idxBefore(to));
function statsOfValues(dates, vals) {
  const n = vals.length, years = (Date.parse(dates[n - 1]) - Date.parse(dates[0])) / (365.25 * 86400000);
  const cagr = (Math.pow(vals[n - 1] / vals[0], 1 / years) - 1) * 100;
  let peak = -Infinity, dd = 0, w12 = Infinity;
  for (let i = 0; i < n; i++) { if (vals[i] > peak) peak = vals[i]; const x = 1 - vals[i] / peak; if (x > dd) dd = x; if (i >= 252) { const r = vals[i] / vals[i - 252] - 1; if (r < w12) w12 = r; } }
  return { cagr, dd: dd * 100, w12: w12 === Infinity ? NaN : w12 * 100, end: vals[n - 1], years };
}
const statsOfLog = (log) => statsOfValues(log.map(r => r.date), log.map(r => r.value));
const stat = (code, params, from, to, d) => statsOfLog(runLog(code, params, from, to, d));
// Option values of a setting, and the settings the app's Fit would tune (fit !== false, with options).
const paramOf = (code, id) => strategyOf(code).params.find(p => p.id === id);
const optionValues = (code, id) => paramOf(code, id).options.map(o => (o && typeof o === 'object') ? o.value : o);
const fitIds = (code) => strategyOf(code).params.filter(p => p.id != null && p.fit !== false && Array.isArray(p.options)).map(p => p.id);
// A copy of the data cut after index k (inclusive): every array shortened, so nothing later exists.
function truncated(k) { const out = {}; for (const [key, arr] of Object.entries(data)) out[key] = Array.isArray(arr) || ArrayBuffer.isView(arr) ? arr.slice(0, k + 1) : arr; return out; }
// Deterministic RNG.
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
function gauss(r) { let u = 0, v = 0; while (u === 0) u = r(); while (v === 0) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
// Daily weights of a log: the share of the account in each fund and in cash at each close.
function weightsOf(log) {
  return log.map(r => { const hv = r.holdingsValue || 0, v = r.value; const fund = String(r.held || 'CASH').toLowerCase(); return fund === 'cash' || !(v > 0) ? { cash: 1 } : { [fund]: hv / v, cash: 1 - hv / v }; });
}
// Replays a sequence of daily target weights on the true prices: the account earns each fund's
// close-to-close return on yesterday's weights (cash at cashRate), then pays `cost` on what it trades
// at today's close to reach today's weights. Independent of the strategies' bookkeeping.
function replay(dates, weights, { cost = 0.0002, cashRate = 4, d = data, startIdx } = {}) {
  const dayRate = Math.pow(1 + cashRate / 100, 1 / 252) - 1, vals = new Array(weights.length);
  let v = 1, w = weights[0]; vals[0] = 1;
  for (let k = 1; k < weights.length; k++) {
    const i = startIdx + k; let g = 0; const drift = {};
    for (const [f, x] of Object.entries(w)) { const r = f === 'cash' ? dayRate : d[f][i] / d[f][i - 1] - 1; drift[f] = x * (1 + r); g += drift[f]; }
    v *= g;
    const t = weights[k]; let traded = 0;
    const funds = new Set([...Object.keys(drift), ...Object.keys(t)]);
    for (const f of funds) if (f !== 'cash') traded += Math.abs((t[f] || 0) - (drift[f] || 0) / g);
    v *= 1 - cost * traded;
    vals[k] = v; w = t;
  }
  return vals;
}
module.exports = { H, CODE, data, strategyOf, defaultsOf, idxOf, idxBefore, NAMES, FOUR, FIT_FROM, FIT_TO, LAST, runOn, runLog, statsOfValues, statsOfLog, stat, paramOf, optionValues, fitIds, truncated, rng, gauss, weightsOf, replay };
