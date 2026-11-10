'use strict';
// Out-of-sample experiment on split halves. On one half: fit (the app's Best CAGR, shipped start plus perturbed
// starts), then from the best fit a robust climb (worst near neighbour) using that half only. On the other half
// and on 2026: the fitted peak, the re-centred peak, and 20 sleeves around each (near box).
//   node halves.cjs <n> <H1|H2> [starts]
const fs = require('fs'), path = require('path'), L = require('./lib.cjs'), T = require('./tools.cjs');
const n = +process.argv[2], half = process.argv[3], STARTS = +(process.argv[4] || 4), code = L.CODE[n];
const H = { H1: ['2009-12-31', '2017-12-29'], H2: ['2017-12-29', '2025-12-31'] }, [from, to] = H[half], [ofrom, oto] = H[half === 'H1' ? 'H2' : 'H1'];
const m = T.measurer(code, from, to), defaults = L.defaultsOf(code), rnd = L.rng(100 + n + (half === 'H1' ? 0 : 50));
const fits = [];
for (let k = 0; k < STARTS; k++) { const f = T.fit(code, k === 0 ? defaults : T.perturbed(code, defaults, rnd), m); fits.push(f); console.log(`${L.NAMES[n]} ${half} start ${k}: fit ${f.cagr.toFixed(1)}% DD ${f.dd.toFixed(1)} (${m.runs()} runs)`); }
const out = { n, half, rows: [] };
const show = (name, p, inS) => {
  const o = T.evalOn(code, p, ofrom, oto), y = T.evalOn(code, p, '2025-12-31', L.LAST), sl = T.sleeves(code, p, ofrom, oto), sy = T.sleeves(code, p, '2025-12-31', L.LAST), si = T.sleeves(code, p, from, to);
  const row = { name, inSample: inS, other: o.cagr, otherDd: o.dd, y2026: (y.growth - 1) * 100, sleevesIn: si.cagr, sleevesOther: sl.cagr, sleevesOtherDd: sl.dd, drawsOtherMedian: sl.median, drawsOtherMin: sl.min, sleeves2026: (sy.growth - 1) * 100 };
  out.rows.push(row);
  console.log(`${L.NAMES[n]} ${half} ${name.padEnd(22)} in-sample ${inS.toFixed(1).padStart(6)} | other half: single ${o.cagr.toFixed(1).padStart(6)} (DD ${o.dd.toFixed(0)}), 20 sleeves ${sl.cagr.toFixed(1).padStart(6)} (DD ${sl.dd.toFixed(0)}), draws median ${sl.median.toFixed(1)} min ${sl.min.toFixed(1)} | 2026: single ${row.y2026.toFixed(0)}%, sleeves ${row.sleeves2026.toFixed(0)}%`);
};
fits.sort((a, b) => b.cagr - a.cagr);
fits.forEach((f, k) => {
  show(`fit #${k + 1}`, f.params, f.cagr);
  if (k < 2) { const c = T.climb(code, f.params, m); show(`fit #${k + 1} re-centred`, c.params, c.cagr); out.rows[out.rows.length - 1].worstNearIn = c.worst; }
});
show('shipped settings', defaults, m(defaults).cagr);
fs.writeFileSync(path.join(__dirname, 'out', `halves-${n}-${half}.json`), JSON.stringify(out));
