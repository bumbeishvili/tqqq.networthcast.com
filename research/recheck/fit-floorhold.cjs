'use strict';
// Fit: what is held after a floor break (SQQQ as shipped, or cash as in Mon Turns), alone and with the robust settings.
const L = require('./lib.cjs'), T = require('./tools.cjs'), J = require('./jitter.cjs'), code = L.CODE[53];
const E = { lookbackDays: 546, startAvgDays: 60, backLead: 28, reentryLead: 35, reentryCloses: 10, deepLead: -30.5 }, B = { reentryLead: 35, reentryCloses: 10, deepLead: -30.5 };
const C = { 'shipped (floor holds SQQQ)': {}, 'floor holds cash': { floorHold: 'cash' }, 'B (re-entry 35x10, deep -30.5)': B, 'B, floor holds cash': { ...B, floorHold: 'cash' }, 'E': E, 'E, floor holds cash': { ...E, floorHold: 'cash' } };
const m = T.measurer(code, L.FIT_FROM, L.FIT_TO), q = (a, f) => { const b = [...a].sort((x, y) => x - y); return b[Math.round(f * (b.length - 1))]; };
for (const [name, p] of Object.entries(C)) {
  const full = { ...L.defaultsOf(code), ...p }, ns = T.nearScore(code, full, m), st = L.stat(code, p);
  const draws = J.draws(code, p, 80, 1, 77).map(d => m({ ...L.defaultsOf(code), ...d }).cagr), wide = J.draws(code, p, 80, 2, 78).map(d => m({ ...L.defaultsOf(code), ...d }).cagr);
  const miss = [-34, -40, -9999].map(d => L.stat(code, { ...p, deepLead: d }).cagr.toFixed(0)).join('/'), y = L.runLog(code, p, '2025-12-31', L.LAST), e05 = L.stat(code, p, '2004-12-31', L.LAST);
  console.log(`${name.padEnd(32)} ${st.cagr.toFixed(1)}% DD ${st.dd.toFixed(1)} w12 ${st.w12.toFixed(0)} | worst near ${ns.worst.toFixed(0)} (${ns.worstAt}) | jitter near p5 ${q(draws, 0.05).toFixed(0)} median ${q(draws, 0.5).toFixed(0)}, wide p5 ${q(wide, 0.05).toFixed(0)} median ${q(wide, 0.5).toFixed(0)} | deep miss ${miss} | 2026 ${((y[y.length - 1].value / y[0].value - 1) * 100).toFixed(0)}% | 2005+ ${e05.cagr.toFixed(0)} DD ${e05.dd.toFixed(0)}`);
}
