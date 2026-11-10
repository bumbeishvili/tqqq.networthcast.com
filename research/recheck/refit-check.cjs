'use strict';
// The best-CAGR refits on 2010-2025 against the shipped settings: what the extra points are worth outside the fit.
const L = require('./lib.cjs'), T = require('./tools.cjs'), J = require('./jitter.cjs');
const SETS = {
  53: { 'shipped Fit': {}, 'refit 196.9': { backLead: 24, overPct: 57.5, overWindow: 241, sqqqMaxDays: 19, soxlLeadDays: 226, soxlLeadEnter: -13, soxlLeadExit: 91 }, 'refit 200.0': { lookbackDays: 536, topLead: 128, topDays: 33, backLead: 25, reentryCloses: 47, deepLead: -32, overPct: 54, overWindow: 240, sqqqMaxDays: 0, soxlLeadEnter: -13, soxlLeadExit: 124 } },
  50: { 'shipped TQQQ vs QQQ + Mon': {}, 'refit 150.3 (floor SQQQ, no SQQQ limit)': { lookbackDays: 552, topLead: 124, topDays: 18, floorLead: 6, floorHold: 'sqqq', deepLead: -32.5, overPct: 55.3, overWindow: 251, sqqqMaxDays: 0 } },
  48: { 'shipped NFCI + Mon': {}, 'refit 90.1': { window: 251, overPct: 55.1, exitPct: -20, belowGate: 13 } },
  49: { 'shipped Buy-back + Mon': {}, 'refit 118.7': { window: 251, overPct: 55.1, exitPct: 11, dipReentry: 5, sliceStop: 59.5 } },
};
const q = (a, f) => { const b = [...a].sort((x, y) => x - y); return b[Math.round(f * (b.length - 1))]; };
for (const [n, sets] of Object.entries(SETS)) { const code = L.CODE[n], m = T.measurer(code, L.FIT_FROM, L.FIT_TO);
  for (const [name, p] of Object.entries(sets)) {
    const full = { ...L.defaultsOf(code), ...p }, ns = T.nearScore(code, full, m), st = L.stat(code, p), h1 = L.stat(code, p, '2009-12-31', '2017-12-29'), h2 = L.stat(code, p, '2017-12-29', '2025-12-31');
    const draws = J.draws(code, p, 80, 1, 77).map(d => m({ ...L.defaultsOf(code), ...d }).cagr), y = L.runLog(code, p, '2025-12-31', L.LAST);
    console.log(`${name.padEnd(42)} ${st.cagr.toFixed(1)}% DD ${st.dd.toFixed(1)} w12 ${st.w12.toFixed(0)} | halves ${h1.cagr.toFixed(0)}/${h2.cagr.toFixed(0)} | worst near ${ns.worst.toFixed(0)} (${ns.worstAt}) | jitter p5 ${q(draws, 0.05).toFixed(0)} median ${q(draws, 0.5).toFixed(0)} | 2026 ${((y[y.length - 1].value / y[0].value - 1) * 100).toFixed(0)}%`);
  } }
