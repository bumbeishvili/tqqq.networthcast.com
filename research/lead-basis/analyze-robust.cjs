'use strict';
// Tables for the lookback-robustness study from out/: the vote variants, the single-lookback baseline
// at equal breadth, the dynamic re-pick, the era stress. Missing files print as pending.
//   node analyze-robust.cjs
const fs = require('fs'), path = require('path');
const load = (f) => { const p = path.join(__dirname, 'out', f); return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null; };
const n1 = (x) => x == null ? '—' : (+x).toFixed(1);
const n0 = (x) => x == null ? '—' : (+x).toFixed(0);
const rows = [
  ['Single lookback (current measure)', '52b-tqqq-growth', '52-tqqq-growth-walkforward.json'],
  ['Median vote, 450–650', '52v-votemed-narrow', null],
  ['Median vote, 380–880', '52v-votemed-wide', null],
  ['Majority vote, 450–650', '52v-votemaj-narrow', null],
  ['Follow-the-winner, 450–650', '52v-votewin-narrow', null],
  ['Follow-the-winner, 380–880', '52v-votewin-wide', null],
];
console.log('| Variant | Fit 2010–25 | DD | Shuffled median / p90 / max | Walk-forward 2016–26 | Under B&H | Worst fold DD | Halves fit→test | 2026 |');
console.log('|---|---|---|---|---|---|---|---|---|');
for (const [tag, stem, wfFile] of rows) {
  const i = load(stem + '-insample.json'), s = load(stem + '-surrogate.json'), w = load(wfFile || stem + '-walkforward.json');
  const sur = s ? `${n0(s.surrogateSummary.median)} / ${n0(s.surrogateSummary.p90)} / ${n0(s.surrogateSummary.max)}` : 'pending';
  const wf = w ? `${n1(w.chained.cagr)}` : 'pending';
  const under = w ? `${w.folds.filter(f => f.test.cagr < f.bhTqqq).length} of ${w.folds.length}` : '—';
  const wdd = w ? n0(Math.max(...w.folds.map(f => f.test.dd))) : '—';
  const halves = w ? `${n0(w.halves.fitH1.testH2.cagr)} / ${n0(w.halves.fitH2.testH1.cagr)}` : '—';
  console.log(`| ${tag} | ${i ? n1(i.fit.cagr) : 'pending'} | ${i ? n0(i.fit.dd) : '—'} | ${sur} | ${wf} | ${under} | ${wdd} | ${halves} | ${i ? n0(i.holdout2026.cagr) : '—'} |`);
  if (i) console.log(`<!-- ${tag} fitted: ${JSON.stringify(i.fit.params)} -->`);
}
console.log('\nDynamic lookback (shipped thresholds, lookback re-picked each year from the trailing window):');
console.log('| Window | Pick | Chained 2016–26 | Fixed 550 chained | Fit on 2010–15 then fixed | Picks | Shuffled median / p90 / max |');
console.log('|---|---|---|---|---|---|---|');
for (const f of ['dyn-w6.json', 'dyn-w6-worst3.json', 'dyn-w3.json']) {
  const d = load(f); if (!d) { console.log(`| ${f} | pending |`); continue; }
  const picks = d.dynamic.picks.map(p => p.L); const uniq = [...new Set(picks)].sort((a, b) => a - b);
  console.log(`| ${d.window}y | ${d.pick || 'best'} | ${n1(d.dynamic.cagr)} | ${n1(d.fixed550Chained)} | L=${d.fitOn2010_2015.L}: ${n1(d.fitOn2010_2015.chained2016_2026)} | ${uniq.join(', ')} | ${d.surrogateSummary ? `${n0(d.surrogateSummary.median)} / ${n0(d.surrogateSummary.p90)} / ${n0(d.surrogateSummary.max)}` : '—'} |`);
}
const e = load('era-stress.json');
if (e) {
  console.log('\nEra stress (shipped thresholds; winner at window 504, no hysteresis):');
  console.log('| Era | Best single lookback | Fixed 550 (rank of 37) | Median 450–650 | Median 380–880 | Majority 450–650 | Majority 380–880 | Winner 450–650 | Winner 380–880 |');
  console.log('|---|---|---|---|---|---|---|---|---|');
  for (const [tag, era] of Object.entries(e.eras)) {
    const c = (k) => `${n1(era[k].cagr)} / ${n0(era[k].dd)}`;
    console.log(`| ${tag} | ${era.bestL.L}d: ${n1(era.bestL.cagr)} | ${n1(era.at550.cagr)} (${era.rankOf550}) | ${c('median narrow')} | ${c('median wide')} | ${c('majority narrow')} | ${c('majority wide')} | ${c('winner narrow')} | ${c('winner wide')} |`);
  }
  console.log(`\nWide winner occupancy ${e.occupancy.first}..${e.occupancy.last}: ${e.occupancy.switches} horizon switches; by decade: ` + Object.entries(e.occupancy.byDecade).map(([dec, counts]) => { const total = Object.values(counts).reduce((a, x) => a + x, 0); return dec + ' ' + Object.entries(counts).sort((x, y) => y[1] - x[1]).slice(0, 2).map(([L, c]) => L + 'd ' + Math.round(100 * c / total) + '%').join(' '); }).join('; '));
}
const nf = load('vote-nofit.json');
if (nf) {
  console.log('\nShipped thresholds, no refit (CAGR / DD):');
  const cols = Object.keys(nf.table[0]).filter(k => k !== 'tag');
  console.log('| Variant | ' + cols.join(' | ') + ' |'); console.log('|---|' + cols.map(() => '---').join('|') + '|');
  for (const r of nf.table) console.log(`| ${r.tag} | ${cols.map(k => r[k]).join(' | ')} |`);
  console.log('No-fit luck (32 shifts, 2010–25): ' + Object.entries(nf.luck).map(([k, v]) => `${k} median ${v.median} max ${v.max}`).join('; '));
}
