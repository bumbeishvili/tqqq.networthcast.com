'use strict';
// Gathers out/*.json into one table per strategy and lead.
const fs = require('fs'), path = require('path');
const files = fs.readdirSync(path.join(__dirname, 'out')).filter(f => /^\d+-(tqqq|soxl)-.*\.json$/.test(f)).map(f => require(path.join(__dirname, 'out', f)));
const by = {};
for (const o of files) { const k = `#${o.n} ${o.lead} lead`; (by[k] = by[k] || {}); (by[k][o.basis] = by[k][o.basis] || {})[o.mode] = o; }
const f1 = v => v == null ? '' : (+v).toFixed(1);
for (const [k, bases] of Object.entries(by)) {
  console.log(`\n== ${k}`);
  console.log('basis'.padEnd(11), 'shipped'.padStart(8), 'fit'.padStart(7), 'dd'.padStart(6), '2026'.padStart(7), 'h1'.padStart(7), 'h2'.padStart(7), 'plateau'.padStart(8), '| wf-chain'.padStart(10), 'B&H'.padStart(6), 'h1->h2'.padStart(7), 'h2->h1'.padStart(7), '| surr p50'.padStart(10), 'p90'.padStart(6), 'max'.padStart(6));
  for (const [b, modes] of Object.entries(bases)) {
    const i = modes.insample, w = modes.walkforward, s = modes.surrogate;
    const plateauMin = i ? Math.min(...Object.values(i.plateau).flatMap(p => p.neighbours)) : null;
    console.log(b.padEnd(11), f1(i && i.asShipped.cagr).padStart(8), f1(i && i.fit.cagr).padStart(7), f1(i && i.fit.dd).padStart(6), f1(i && i.holdout2026.cagr).padStart(7), f1(i && i.halves.h1.cagr).padStart(7), f1(i && i.halves.h2.cagr).padStart(7), f1(plateauMin).padStart(8),
      ('| ' + f1(w && w.chained.cagr)).padStart(10), f1(w && w.chained.bhTqqq).padStart(6), f1(w && w.halves.fitH1.testH2.cagr).padStart(7), f1(w && w.halves.fitH2.testH1.cagr).padStart(7),
      ('| ' + f1(s && s.surrogateSummary.median)).padStart(10), f1(s && s.surrogateSummary.p90).padStart(6), f1(s && s.surrogateSummary.max).padStart(6));
  }
  for (const [b, modes] of Object.entries(bases)) if (modes.insample) console.log(`  ${b} fit params:`, JSON.stringify(modes.insample.fit.params), '| starts:', modes.insample.fit.starts.map(s => s.cagr.toFixed(0)).join(' '));
  for (const [b, modes] of Object.entries(bases)) if (modes.walkforward) console.log(`  ${b} walk-forward folds (test CAGR / B&H TQQQ):`, modes.walkforward.folds.map(f => `${f.year} ${f.test.cagr.toFixed(0)}/${f.bhTqqq.toFixed(0)}`).join('  '));
}
