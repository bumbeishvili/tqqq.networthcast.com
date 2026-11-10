'use strict';
// A proxy index  r = a/252 + k x Chips  put through the updater's SOXX (1x) and SOXL (3x) formulas over the years
// where the real series exist, against the repo's SOXX and SOXL files: growth per year, volatility, drawdown,
// rolling one-year gaps, and the 380-day SOXL-vs-SOXX lead that Fit reads.
const F = require('./flib.cjs'), { data, french, step, SOXL, SOXX, corr, sd } = F;
const d = data.dates;
function build(a, k, from, to) {   // -> { dates, x1, x3 } index levels starting at 1
  const s = d.indexOf(from), e = d.findIndex(x => x > to) - 1, dates = [d[s]], x1 = [1], x3 = [1];
  for (let i = s + 1; i <= e; i++) { const f = french.get(d[i]); const r = a / 252 + k * f.Chips; dates.push(d[i]); x1.push(x1[x1.length - 1] * step(r, d[i - 1], SOXX.L, SOXX.fee, SOXX.spread)); x3.push(x3[x3.length - 1] * Math.max(0, step(r, d[i - 1], SOXL.L, SOXL.fee, SOXL.spread))); }
  return { dates, x1, x3, s, e };
}
const cagr = (v, dates) => (Math.pow(v[v.length - 1] / v[0], 365.25 * 864e5 / (Date.parse(dates[dates.length - 1]) - Date.parse(dates[0]))) - 1) * 100;
const maxdd = (v) => { let p = 0, m = 0; for (const x of v) { p = Math.max(p, x); m = Math.max(m, 1 - x / p); } return m * 100; };
const rets = (v) => v.slice(1).map((x, i) => x / v[i] - 1);
const q = (arr, f) => { const b = [...arr].sort((x, y) => x - y); return b[Math.round(f * (b.length - 1))]; };
function compare(name, a, k, from, to) {
  const p = build(a, k, from, to), r1 = data.soxx.slice(p.s, p.e + 1), r3 = data.soxl.slice(p.s, p.e + 1), n = r1.length;
  const roll = (v, w, L = 252) => { const o = []; for (let i = L; i < n; i += 5) o.push((v[i] / v[i - L]) / (w[i] / w[i - L]) - 1); return o; };
  const g1 = roll(p.x1, r1).map(Math.abs), g3 = roll(p.x3, r3).map(Math.abs);
  // the 380-day lead of the 3x over the 1x, proxy against the files, and Fit's SOXL state on each (in under -33, out over 101)
  const lead = (x3, x1) => x3.map((v, i) => i >= 380 ? ((v / x3[i - 380]) / (x1[i] / x1[i - 380]) - 1) * 100 : NaN), lp = lead(p.x3, p.x1), lr = lead(r3, r1);
  const st = (l) => { let on = false; return l.map(v => { if (v === v) { if (!on && v < -33) on = true; else if (on && v > 101) on = false; } return on; }); };
  const sp = st(lp), sr = st(lr), idx = lp.map((v, i) => i).filter(i => lp[i] === lp[i]);
  console.log(`${name.padEnd(34)} ${from.slice(0, 4)}-${to.slice(0, 4)} | 1x a year: proxy ${cagr(p.x1, p.dates).toFixed(1)}% vs file ${cagr(r1, p.dates).toFixed(1)}%, vol ${(sd(rets(p.x1)) * Math.sqrt(252) * 100).toFixed(0)}/${(sd(rets(r1)) * Math.sqrt(252) * 100).toFixed(0)}, DD ${maxdd(p.x1).toFixed(0)}/${maxdd(r1).toFixed(0)}, 1-year gap median ${(q(g1, 0.5) * 100).toFixed(0)}% p90 ${(q(g1, 0.9) * 100).toFixed(0)}% | 3x a year: ${cagr(p.x3, p.dates).toFixed(1)}% vs ${cagr(r3, p.dates).toFixed(1)}%, DD ${maxdd(p.x3).toFixed(1)}/${maxdd(r3).toFixed(1)}, 1-year gap median ${(q(g3, 0.5) * 100).toFixed(0)}% p90 ${(q(g3, 0.9) * 100).toFixed(0)}% | lead corr ${corr(idx.map(i => lp[i]), idx.map(i => lr[i])).toFixed(2)}, SOXL state agrees ${(idx.filter(i => sp[i] === sr[i]).length / idx.length * 100).toFixed(0)}% of days`);
}
const SPANS = [['1994-05-04', '2001-07-12'], ['2001-07-13', '2010-03-10'], ['2010-03-11', '2026-09-30'], ['1994-05-04', '2026-09-30']];
for (const [name, a, k] of [['Chips as it is', 0, 1], ['1.15 x Chips', 0, 1.15], ['1.28 x Chips (volatility matched)', 0, 1.28], ['1.15 x Chips - 3%/yr', -0.03, 1.15]]) { for (const [f, t] of SPANS) compare(name, a, k, f, t); console.log(); }
module.exports = { build, cagr, maxdd, rets };
