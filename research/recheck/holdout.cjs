'use strict';
// Does the peak carry over? Near-box joint draws around the shipped settings: each draw's 2010-2025 CAGR
// against its return on the months after the fit (2026 to 6 November). Where the shipped settings rank among
// their own neighbours on the unseen months, and whether doing better in-sample goes with doing better after.
const L = require('./lib.cjs'), J = require('./jitter.cjs');
const { CODE, NAMES, data, idxOf, idxBefore, runOn, statsOfLog } = L;
const COUNT = +(process.argv[2] || 150);
const spearman = (a, b) => { const rk = (x) => { const o = x.map((v, i) => [v, i]).sort((p, q) => p[0] - q[0]); const r = new Array(x.length); o.forEach((p, k) => r[p[1]] = k); return r; }; const ra = rk(a), rb = rk(b), m = (a.length - 1) / 2; let num = 0, da = 0, db = 0; for (let i = 0; i < a.length; i++) { num += (ra[i] - m) * (rb[i] - m); da += (ra[i] - m) ** 2; db += (rb[i] - m) ** 2; } return num / Math.sqrt(da * db); };
for (const n of L.FOUR) {
  const code = CODE[n], hs = idxBefore('2025-12-31'), he = idxBefore(L.LAST);
  const hold = (p) => { const lg = runOn(data, code, p, hs, he); return (lg[lg.length - 1].value / lg[0].value - 1) * 100; };
  const ins = (p) => statsOfLog(L.runLog(code, p)).cagr;
  const c0 = ins({}), h0 = hold({});
  for (const [name, box] of [['near', 1], ['wide', 2]]) {
    const ds = J.draws(code, {}, COUNT, box, 99), a = ds.map(ins), b = ds.map(hold);
    const sorted = [...b].sort((x, y) => x - y), q = (f) => sorted[Math.round(f * (sorted.length - 1))];
    console.log(`${NAMES[n].padEnd(20)} ${name}: shipped ${c0.toFixed(0)}% in the fit, ${h0.toFixed(0)}% in 2026 | draws in 2026: p10 ${q(0.1).toFixed(0)} median ${q(0.5).toFixed(0)} p90 ${q(0.9).toFixed(0)} | shipped beats ${(b.filter(x => x < h0).length / b.length * 100).toFixed(0)}% of its neighbours in 2026 | rank correlation fit vs 2026 ${spearman(a, b).toFixed(2)}`);
  }
}
