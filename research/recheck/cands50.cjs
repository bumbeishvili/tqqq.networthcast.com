'use strict';
// Candidate robust settings for TQQQ vs QQQ + Monday, side by side.
const L = require('./lib.cjs'), T = require('./tools.cjs'), J = require('./jitter.cjs'), code = L.CODE[50];
const C = {
  'shipped': {},
  'lookback 545': { lookbackDays: 545 },
  'lookback 541': { lookbackDays: 541 },
  'lookback 545, ceiling 123 x 18d': { lookbackDays: 545, topLead: 123, topDays: 18 },
  'climb (ceiling 123x18, floor 7, deep -32)': { topLead: 123, topDays: 18, floorLead: 7, deepLead: -32 },
  'ceiling 123 x 18d': { topLead: 123, topDays: 18 },
  'lookback 545, back-at 28': { lookbackDays: 545, backLead: 28 },
};
const m = T.measurer(code, L.FIT_FROM, L.FIT_TO), q = (a, f) => { const b = [...a].sort((x, y) => x - y); return b[Math.round(f * (b.length - 1))]; };
for (const [name, p] of Object.entries(C)) {
  const full = { ...L.defaultsOf(code), ...p }, ns = T.nearScore(code, full, m), st = L.stat(code, p);
  const draws = J.draws(code, p, 80, 1, 77).map(d => m({ ...L.defaultsOf(code), ...d }).cagr);
  const miss = [-34, -40, -9999].map(d => L.stat(code, { ...p, deepLead: d }).cagr.toFixed(0)).join('/');
  const y = L.runLog(code, p, '2025-12-31', L.LAST), y9 = L.runLog(code, p, '2025-12-31', '2026-11-09'), last = y9[y9.length - 3];
  console.log(`${name.padEnd(42)} ${st.cagr.toFixed(1)}% DD ${st.dd.toFixed(1)} w12 ${st.w12.toFixed(0)} | worst near ${ns.worst.toFixed(0)} (${ns.worstAt}) | jitter p5 ${q(draws, 0.05).toFixed(0)} median ${q(draws, 0.5).toFixed(0)} | deep miss ${miss} | 2026 ${((y[y.length - 1].value / y[0].value - 1) * 100).toFixed(0)}% | Nov 4-9 held ${y9.slice(-4).map(r => r.held).join(',')} | lead 11-05 ${last.leadPct.toFixed(2)}`);
}
