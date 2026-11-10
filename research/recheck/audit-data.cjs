'use strict';
// Data audit for 2010+: leveraged funds against 3x / -3x their index day by day (a bad row, a missed split or an
// unadjusted print shows as a tracking gap), highs/lows bracketing the close, duplicate or missing days.
const L = require('./lib.cjs');
const { data, idxOf } = L;
const s = idxOf('2010-03-12'), n = data.dates.length;
const pairs = [['tqqq', 'qqq', 3], ['sqqq', 'qqq', -3], ['soxl', 'soxx', 3]];
for (const [lev, idx, k] of pairs) {
  const gaps = [];
  for (let i = s; i < n; i++) { const a = data[lev][i] / data[lev][i - 1] - 1, b = k * (data[idx][i] / data[idx][i - 1] - 1); gaps.push([Math.abs(a - b), data.dates[i], a, b]); }
  gaps.sort((x, y) => y[0] - x[0]);
  const med = gaps[Math.floor(gaps.length / 2)][0];
  console.log(`${lev.toUpperCase()} vs ${k}x ${idx.toUpperCase()}: median daily gap ${(med * 100).toFixed(3)}%, days over 3 points: ${gaps.filter(g => g[0] > 0.03).length}; ten largest:`);
  console.log(gaps.slice(0, 10).map(g => `  ${g[1]} fund ${(g[2] * 100).toFixed(1)}% vs ${(g[3] * 100).toFixed(1)}%`).join('\n'));
}
// highs and lows
for (const f of ['tqqq', 'qqq', 'spy']) {
  let bad = 0, first = '', nan = 0;
  for (let i = s; i < n; i++) { const h = data[f + 'High'][i], l = data[f + 'Low'][i], c = data[f][i]; if (!(h > 0 && l > 0)) { nan++; continue; } if (h < c * (1 - 1e-6) || l > c * (1 + 1e-6) || h < l) { bad++; if (!first) first = `${data.dates[i]} H ${h} L ${l} C ${c}`; } }
  console.log(`${f.toUpperCase()} high/low: ${bad} days where the close is outside its day's range${first ? ' (first ' + first + ')' : ''}, ${nan} days without a high/low`);
}
// calendar: weekdays only, no duplicates, gaps over 4 calendar days
let dup = 0, gaps = [];
for (let i = s; i < n; i++) { if (data.dates[i] <= data.dates[i - 1]) dup++; const g = (Date.parse(data.dates[i]) - Date.parse(data.dates[i - 1])) / 864e5; if (g > 4) gaps.push(data.dates[i - 1] + '→' + data.dates[i]); }
console.log(`calendar: ${dup} out-of-order days, gaps over 4 days: ${gaps.join(', ')}`);
console.log('last rows:'); for (let i = n - 8; i < n; i++) console.log(' ', data.dates[i], ['tqqq', 'qqq', 'sqqq', 'soxl', 'soxx', 'spy'].map(f => f + ' ' + data[f][i].toFixed(2)).join('  '));
