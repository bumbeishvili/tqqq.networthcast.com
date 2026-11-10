'use strict';
// Candidate robust settings for Fit, side by side: 2010-2025, worst near neighbour, joint jitter, the deep-buy-missing
// stress, 2026, other eras, and what each held on 5-9 November 2026.
const L = require('./lib.cjs'), T = require('./tools.cjs'), J = require('./jitter.cjs'), code = L.CODE[53];
const C = {
  'shipped Fit': {},
  'A: re-entry 35x10': { reentryLead: 35, reentryCloses: 10 },
  'B: A + deep buy -30.5': { reentryLead: 35, reentryCloses: 10, deepLead: -30.5 },
  'C: second climb (floor 7)': { lookbackDays: 546, startAvgDays: 60, backLead: 28, floorLead: 7, reentryLead: 35, reentryCloses: 5 },
  'D: C with floor 6, closes 10': { lookbackDays: 546, startAvgDays: 60, backLead: 28, reentryLead: 35, reentryCloses: 10 },
  'E: D + deep buy -30.5': { lookbackDays: 546, startAvgDays: 60, backLead: 28, reentryLead: 35, reentryCloses: 10, deepLead: -30.5 },
  'F: first climb (floor 7)': { lookbackDays: 550, startAvgDays: 60, backLead: 27, floorLead: 7, deepLead: -30.5, sqqqMaxDays: 22 },
};
const m = T.measurer(code, L.FIT_FROM, L.FIT_TO), q = (a, f) => { const b = [...a].sort((x, y) => x - y); return b[Math.round(f * (b.length - 1))]; };
for (const [name, p] of Object.entries(C)) {
  const full = { ...L.defaultsOf(code), ...p }, ns = T.nearScore(code, full, m), st = L.stat(code, p);
  const draws = J.draws(code, p, 80, 1, 77).map(d => m({ ...L.defaultsOf(code), ...d }).cagr);
  const miss = [-34, -40, -9999].map(d => L.stat(code, { ...p, deepLead: d }).cagr.toFixed(0)).join('/');
  const y = L.runLog(code, p, '2025-12-31', L.LAST), y9 = L.runLog(code, p, '2025-12-31', '2026-11-09');
  const e05 = L.stat(code, p, '2004-12-31', L.LAST), e83 = L.stat(code, p, '1982-12-31', L.LAST);
  console.log(`${name.padEnd(30)} ${st.cagr.toFixed(1)}% DD ${st.dd.toFixed(1)} w12 ${st.w12.toFixed(0)} | worst near ${ns.worst.toFixed(0)} (${ns.worstAt}) | jitter p5 ${q(draws, 0.05).toFixed(0)} median ${q(draws, 0.5).toFixed(0)} | deep miss ${miss} | 2026 ${((y[y.length - 1].value / y[0].value - 1) * 100).toFixed(0)}% (to 11-09 ${((y9[y9.length - 1].value / y9[0].value - 1) * 100).toFixed(0)}%) | 2005+ ${e05.cagr.toFixed(0)} DD ${e05.dd.toFixed(0)} | 1983+ ${e83.cagr.toFixed(0)} | Nov 4-9 held ${y9.slice(-4).map(r => r.held).join(',')}`);
}
