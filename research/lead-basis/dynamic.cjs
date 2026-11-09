'use strict';
// The dynamic lookback (the user, 2026-11-09: a strategy that finds the 2.2 years itself): each test
// year, run #52 at every lookback on the trailing --window years with everything else at the shipped
// defaults, carry the winner into the test year, chain 2016-2026. The luck test runs the same
// selection on circularly shifted leads. SOXL rule at shipped settings throughout.
//   node dynamic.cjs --window 6 --surrogates 16 --out out/dyn-w6.json
const fs = require('fs'), path = require('path');
const { run, data, idxOf, idxBefore } = require('./harness.cjs');
const { BASIS_CODE } = require('./basis.cjs');   // for leadShift; growth basis = parity with #52
const code = BASIS_CODE[52];
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i < 0 ? d : process.argv[i + 1]; };
const W = +arg('window', 6), SURS = +arg('surrogates', 0), PICK = arg('pick', 'best'), OUT = arg('out', `out/dyn-w${W}${PICK === 'best' ? '' : '-' + PICK}.json`);   // --pick worst3: choose the lookback whose WORST of itself and its two grid neighbours is highest (the plateau, not the spike)
const LS = [252, 280, 300, 320, 340, 360, 380, 400, 420, 440, 460, 480, 500, 510, 520, 530, 540, 550, 560, 570, 580, 590, 600, 620, 640, 660, 680, 700, 720, 756, 780, 800, 840, 880, 920, 960, 1008];
let seed = 7; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const chainCagr = (chain) => {
  const yrs = (Date.parse(chain[chain.length - 1].to) - Date.parse(chain[0].from)) / (365.25 * 86400000);
  return +((Math.pow(chain.reduce((a, c) => a * c.f, 1), 1 / yrs) - 1) * 100).toFixed(1);
};
function pipeline(fixed) {
  const picks = [], chain = [];
  for (let y = 2016; y <= 2026; y++) {
    const cagrs = LS.map(L => run(code, { ...fixed, lookbackDays: L }, `${y - W}-01-01`, `${y - 1}-12-31`).cagr);
    const score = (k) => PICK === 'worst3' ? Math.min(...[k - 1, k, k + 1].filter(j => j >= 0 && j < LS.length).map(j => cagrs[j])) : cagrs[k];
    let bestK = 0; for (let k = 1; k < LS.length; k++) if (score(k) > score(bestK)) bestK = k;
    const best = { L: LS[bestK], cagr: cagrs[bestK] };
    const t = run(code, { ...fixed, lookbackDays: best.L }, `${y}-01-01`, `${y}-12-31`);
    picks.push({ y, L: best.L, fit: +best.cagr.toFixed(1), test: +t.cagr.toFixed(1), dd: +t.dd.toFixed(1) });
    chain.push({ from: t.log[0].date, to: t.log[t.log.length - 1].date, f: t.log[t.log.length - 1].value / t.log[0].value });
  }
  return { cagr: chainCagr(chain), picks };
}
// The fixed-lookback baselines, chained the same way so the method matches.
function chained(fixed, L) {
  const chain = [];
  for (let y = 2016; y <= 2026; y++) { const t = run(code, { ...fixed, lookbackDays: L }, `${y}-01-01`, `${y}-12-31`); chain.push({ from: t.log[0].date, to: t.log[t.log.length - 1].date, f: t.log[t.log.length - 1].value / t.log[0].value }); }
  return chainCagr(chain);
}
const t0 = Date.now();
const real = pipeline({});
console.log('picks:', real.picks.map(p => `${p.y}:${p.L}d fit ${p.fit} -> test ${p.test}`).join('  '));
let bestPast = null;
for (const L of LS) { const r = run(code, { lookbackDays: L }, '2010-01-01', '2015-12-31'); if (!bestPast || r.cagr > bestPast.cagr) bestPast = { L, cagr: +r.cagr.toFixed(1) }; }
const out = {
  window: W, pick: PICK, grid: LS.length, dynamic: real,
  fixed550Chained: chained({}, 550), fixed550Single: +run(code, {}, '2016-01-01', '2026-12-31').cagr.toFixed(1),
  fitOn2010_2015: { ...bestPast, chained2016_2026: chained({}, bestPast.L) },
  bhTqqq2016_2026: (() => { const a = idxOf('2016-01-01'), b = idxBefore('2026-12-31'); const yrs = (Date.parse(data.dates[b]) - Date.parse(data.dates[a])) / (365.25 * 86400000); return +((Math.pow(data.tqqq[b] / data.tqqq[a], 1 / yrs) - 1) * 100).toFixed(1); })(),
  surrogates: [],
};
for (let k = 0; k < SURS; k++) {
  const shift = 600 + Math.floor(rnd() * (data.dates.length - 1900));
  const s = pipeline({ leadShift: shift });
  out.surrogates.push({ shift, cagr: s.cagr, picks: s.picks.map(p => p.L) });
  process.stderr.write(`surrogate ${k} (shift ${shift}): ${s.cagr}%\n`);
}
if (out.surrogates.length) {
  const c = out.surrogates.map(s => s.cagr).sort((a, b) => a - b);
  out.surrogateSummary = { n: c.length, min: c[0], median: c[Math.floor(c.length / 2)], p90: c[Math.floor(0.9 * (c.length - 1))], max: c[c.length - 1] };
}
out.seconds = Math.round((Date.now() - t0) / 1000);
fs.writeFileSync(path.isAbsolute(OUT) ? OUT : path.join(__dirname, OUT), JSON.stringify(out, null, 1));
console.log(JSON.stringify({ window: W, dynamic: real.cagr, fixed550: out.fixed550Chained, fitOnPast: out.fitOn2010_2015, bh: out.bhTqqq2016_2026, sur: out.surrogateSummary, seconds: out.seconds }));
