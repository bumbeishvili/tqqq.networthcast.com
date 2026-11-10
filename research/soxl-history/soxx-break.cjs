'use strict';
// The SOXX file's level break at its launch day (2001-07-13): size, the factor that removes it, and what it does
// to the strategies that read SOXX (Mon Turns, Fit) before 2010.
const F = require('./flib.cjs'), { rateOn } = F, data = F.H.data, L = require('../recheck/lib.cjs');   // the committed files as they are (flib's own data has the break joined)
const d = data.dates, k = d.indexOf('2001-07-13');
const soxlStep = data.soxl[k] / data.soxl[k - 1], r = (soxlStep - 1 + 2 * (rateOn(d[k - 1]) / 100 - 0.0181) / 252 + 0.0075 / 252) / 3;
const correctPrev = data.soxx[k] / (1 + r - 0.0035 / 252), factor = correctPrev / data.soxx[k - 1];
console.log(`SOXX file: ${d[k - 1]} ${data.soxx[k - 1].toFixed(4)} -> ${d[k]} ${data.soxx[k].toFixed(4)} = ${((data.soxx[k] / data.soxx[k - 1] - 1) * 100).toFixed(1)}% in a day; the index moved ${(r * 100).toFixed(2)}% (from the SOXL file). Factor that joins the prefix to the real fund: ${factor.toFixed(5)} (1/${(1 / factor).toFixed(3)})`);
// every one-day move over 30% in the two files
for (const f of ['soxx', 'soxl']) { const big = []; for (let i = d.indexOf('1994-05-05'); i < d.length; i++) { const x = data[f][i] / data[f][i - 1] - 1; if (Math.abs(x) > (f === 'soxx' ? 0.2 : 0.45)) big.push(`${d[i]} ${(x * 100).toFixed(0)}%`); } console.log(`${f.toUpperCase()} one-day moves past ${f === 'soxx' ? 20 : 45}%: ${big.join(', ') || 'none'}`); }
const fixed = { ...data, soxx: data.soxx.map((v, i) => i < k ? v * factor : v) };
const eras = [['1953-01-02', '2026-11-06'], ['1979-12-31', '2000-03-31'], ['1999-12-31', '2009-03-31'], ['2008-12-31', '2025-12-31'], ['2009-12-31', '2025-12-31'], ['1994-12-30', '2009-12-31'], ['2004-12-31', '2026-11-06']];
for (const n of [53, 52]) { console.log(L.NAMES[n]); for (const [a, b] of eras) { const s = L.idxOf(a), e = L.idxBefore(b), x = L.statsOfLog(L.runOn(data, L.CODE[n], {}, s, e)), y = L.statsOfLog(L.runOn(fixed, L.CODE[n], {}, s, e)); console.log(`   ${a.slice(0, 4)}-${b.slice(0, 7)}: file as it is ${x.cagr.toFixed(1)}% DD ${x.dd.toFixed(1)} | prefix joined ${y.cagr.toFixed(1)}% DD ${y.dd.toFixed(1)}`); } }
