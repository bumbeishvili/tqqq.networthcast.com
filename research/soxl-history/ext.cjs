'use strict';
// SOXX and SOXL walked back from 1994-05-04 to 1953-01-02 on a proxy index r = a/252 + k x Chips (the updater's
// own formulas), what the extended series look like by decade, and what Fit and Mon Turns make on them.
const F = require('./flib.cjs'), { data, french, step, SOXL, SOXX, sd } = F, L = require('../recheck/lib.cjs');
const d = data.dates, i0 = d.indexOf('1994-05-04');
function extend(a, k) {
  const soxx = data.soxx.slice(), soxl = data.soxl.slice();
  // French has one day the repo's calendar lacks (1975-02-28): its return is compounded into the next repo day.
  const fdays = [...french.keys()].filter(x => x <= d[i0] && x >= '1952-12-31'), extra = new Map(); let carry = 1;
  for (const x of fdays) { if (d.includes(x)) { extra.set(x, carry * (1 + french.get(x).Chips) - 1); carry = 1; } else carry *= 1 + french.get(x).Chips; }
  for (let i = i0; i > 0; i--) { const r = a / 252 + k * extra.get(d[i]); soxx[i - 1] = soxx[i] / step(r, d[i - 1], SOXX.L, SOXX.fee, SOXX.spread); soxl[i - 1] = soxl[i] / Math.max(1e-9, step(r, d[i - 1], SOXL.L, SOXL.fee, SOXL.spread)); }
  return { soxx, soxl };
}
const cagr = (v, a, b) => (Math.pow(v[b] / v[a], 365.25 * 864e5 / (Date.parse(d[b]) - Date.parse(d[a]))) - 1) * 100;
const maxdd = (v, a, b) => { let p = 0, m = 0; for (let i = a; i <= b; i++) { p = Math.max(p, v[i]); m = Math.max(m, 1 - v[i] / p); } return m * 100; };
const idx = (date) => { const k = d.findIndex(x => x >= date); return k < 0 ? d.length - 1 : k; };
module.exports = { extend };
if (require.main === module) {
  for (const [name, a, k] of [['1.15 x Chips', 0, 1.15], ['1.28 x Chips', 0, 1.28], ['1.15 x Chips - 3%/yr', -0.03, 1.15]]) {
    const e = extend(a, k); console.log(`\n== ${name}: SOXX 1953-01-02 ${e.soxx[0].toExponential(3)}, SOXL ${e.soxl[0].toExponential(3)}`);
    for (const [x, y] of [['1953-01-02', '1962-12-31'], ['1963-01-02', '1972-12-29'], ['1973-01-02', '1982-12-31'], ['1983-01-03', '1994-05-04'], ['1953-01-02', '1994-05-04'], ['1994-05-04', '2026-11-06']]) {
      const A = idx(x), B = idx(y), r = []; for (let i = A + 1; i <= B; i++) r.push(e.soxx[i] / e.soxx[i - 1] - 1);
      console.log(`   ${x.slice(0, 4)}-${y.slice(0, 4)}: 1x ${cagr(e.soxx, A, B).toFixed(1)}%/yr vol ${(sd(r) * Math.sqrt(252) * 100).toFixed(0)}% DD ${maxdd(e.soxx, A, B).toFixed(0)}% | 3x ${cagr(e.soxl, A, B).toFixed(1)}%/yr DD ${maxdd(e.soxl, A, B).toFixed(1)}% | TQQQ file ${cagr(data.tqqq, A, B).toFixed(1)}%/yr DD ${maxdd(data.tqqq, A, B).toFixed(1)}%, QQQ file ${cagr(data.qqq, A, B).toFixed(1)}%/yr`);
    }
    // Fit and Mon Turns with the SOXL rule allowed from the first day the lead exists (the code's 1994 gate moved to 1953).
    const ext = { ...data, soxx: e.soxx, soxl: e.soxl };
    for (const n of [53, 52]) { const code = L.CODE[n], open = code.split('"1994-05-04"').join('"1953-01-02"'); if (open === code) throw new Error('gate not found');
      const cells = [['1953-01-02', '2026-11-06'], ['1982-12-31', '2026-11-06'], ['1953-01-02', '1994-05-04'], ['1982-12-31', '1994-05-04'], ['2009-12-31', '2025-12-31']].map(([x, y]) => { const s = L.idxOf(x), en = L.idxBefore(y), cur = L.statsOfLog(L.runOn(data, code, {}, s, en)), lg = L.runOn(ext, open, {}, s, en), nw = L.statsOfLog(lg), sx = lg.filter(r => r.held === 'SOXL' && r.date < '1994-05-04').length; return `${x.slice(0, 4)}-${y.slice(0, 4)}: now ${cur.cagr.toFixed(1)}% DD ${cur.dd.toFixed(1)} -> extended ${nw.cagr.toFixed(1)}% DD ${nw.dd.toFixed(1)}${sx ? ' (' + sx + ' SOXL days before 1994)' : ''}`; });
      console.log(`   ${L.NAMES[n]}: ${cells.join(' | ')}`); }
  }
}
