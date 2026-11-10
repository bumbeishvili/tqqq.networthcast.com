'use strict';
// Buy-back + Monday: the fitted defaults against the earlier hand-set ones and a robust climb from each.
const L = require('./lib.cjs'), T = require('./tools.cjs'), J = require('./jitter.cjs'), code = L.CODE[49];
const m = T.measurer(code, L.FIT_FROM, L.FIT_TO), q = (a, f) => { const b = [...a].sort((x, y) => x - y); return b[Math.round(f * (b.length - 1))]; };
const OLD = { exitPct: -3, confirmDays: 5, bbPct: -34, bbSlice: 50 };
const C = { 'shipped (sell +10, 4 closes, buy-back -32 all)': {}, 'earlier (sell -3, 5 closes, buy-back -34 half)': OLD, 'earlier, all the money at the line': { ...OLD, bbSlice: 100 }, 'sell 0': { exitPct: 0 }, 'sell -3, 4 closes': { exitPct: -3 }, 'sell -10': { exitPct: -10, confirmDays: 5 } };
const cl = T.climb(code, { ...L.defaultsOf(code), ...OLD }, m, { loss: 0.10 }); C['climb from earlier'] = Object.fromEntries(Object.entries(cl.params).filter(([k, v]) => L.defaultsOf(code)[k] !== v));
for (const [name, p] of Object.entries(C)) {
  const full = { ...L.defaultsOf(code), ...p }, ns = T.nearScore(code, full, m), st = L.stat(code, p), h1 = L.stat(code, p, '2009-12-31', '2017-12-29'), h2 = L.stat(code, p, '2017-12-29', '2025-12-31');
  const ds = J.draws(code, p, 80, 1, 77), draws = ds.map(d => m({ ...L.defaultsOf(code), ...d }).cagr), y = L.runLog(code, p, '2025-12-31', L.LAST);
  const y26 = ds.slice(0, 40).map(d => { const lg = L.runLog(code, d, '2025-12-31', L.LAST); return (lg[lg.length - 1].value / lg[0].value - 1) * 100; });
  console.log(`${name.padEnd(46)} ${st.cagr.toFixed(1)}% DD ${st.dd.toFixed(1)} w12 ${st.w12.toFixed(0)} | halves ${h1.cagr.toFixed(0)}/${h2.cagr.toFixed(0)} | worst near ${ns.worst.toFixed(0)} (${ns.worstAt}) | jitter p5 ${q(draws, 0.05).toFixed(0)} median ${q(draws, 0.5).toFixed(0)} | 2026 ${((y[y.length - 1].value / y[0].value - 1) * 100).toFixed(0)}% (neighbours' median ${q(y26, 0.5).toFixed(0)}%)${name.startsWith('climb') ? ' ' + JSON.stringify(p) : ''}`);
}
