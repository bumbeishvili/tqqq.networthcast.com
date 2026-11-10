'use strict';
// The start price as a plain (arithmetic) average instead of the code's geometric mean, same levels; and the
// ceiling's own SQQQ limit of Fit switched off. Sizes two findings of the stretch-family audit.
const L = require('./lib.cjs');
const once = (text, find, repl, what) => { const at = text.indexOf(find); if (at < 0 || text.indexOf(find, at + 1) >= 0) throw new Error('patch: ' + what); return text.slice(0, at) + repl + text.slice(at + find.length); };
const plainAvg = (code) => {
  let t = once(code, '    for (let i = L + W; i < n; i++) {\n', '    const sumT = new Float64Array(n + 1), sumQ = new Float64Array(n + 1);\n    for (let i = 0; i < n; i++) { sumT[i + 1] = sumT[i] + (T[i] > 0 ? T[i] : 0); sumQ[i + 1] = sumQ[i] + (Q[i] > 0 ? Q[i] : 0); }\n    for (let i = L + W; i < n; i++) {\n', 'the lead loop');
  t = once(t, 'baseT[i] = W ? Math.exp((logT[b] - logT[a]) / (b - a)) : T[i - L];', 'baseT[i] = W ? (sumT[b] - sumT[a]) / (b - a) : T[i - L];', 'baseT');
  return once(t, 'baseQ[i] = W ? Math.exp((logQ[b] - logQ[a]) / (b - a)) : Q[i - L];', 'baseQ[i] = W ? (sumQ[b] - sumQ[a]) / (b - a) : Q[i - L];', 'baseQ');
};
for (const n of [50, 53]) { const a = L.stat(L.CODE[n], {}), b = L.stat(plainAvg(L.CODE[n]), {}); const lg = L.runLog(plainAvg(L.CODE[n]), {}, '2009-12-31', '2026-11-06'), r = lg.find(x => x.date === '2026-11-05'); console.log(`${L.NAMES[n]}: geometric mean ${a.cagr.toFixed(1)}%, plain average ${b.cagr.toFixed(1)}% DD ${b.dd.toFixed(1)}; lead on 2026-11-05 by the plain average ${r.leadPct.toFixed(3)}, held on 11-06 ${lg[lg.length - 1].held}`); }
const a = L.runLog(L.CODE[53], {}, '2009-12-31', '2026-11-06'), b = L.runLog(L.CODE[53], { topDays: 0 }, '2009-12-31', '2026-11-06'), diff = a.filter((r, k) => r.held !== b[k].held);
console.log(`Fit, ceiling SQQQ limit off: ${L.stat(L.CODE[53], { topDays: 0 }).cagr.toFixed(1)}% against ${L.stat(L.CODE[53], {}).cagr.toFixed(1)}%; ${diff.length} days held differently (${diff.map(r => r.date).join(' ')})`);
