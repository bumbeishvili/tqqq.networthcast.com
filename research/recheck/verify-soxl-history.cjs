'use strict';
// The rebuilt SOXL and SOXX files: rows from 1994-05-04 against the files before, and the new rows before it against
// an independent walk-back in Node (French Chips x 1.15 through the updater's step, scaled per French day).
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '..');   // the repo root; pass the folder holding synthetic-soxl.before.tsv and synthetic-soxx.before.tsv (the files before the rebuild) as the first argument
const read = (f) => fs.readFileSync(f, 'utf8').trim().split('\n').slice(1).map(l => { const [d, v] = l.split('\t'); const [m, dd, y] = d.split(' ')[0].split('/'); return [`${y}-${m.padStart(2, '0')}-${dd.padStart(2, '0')}`, +v, v]; });
const lines = fs.readFileSync(path.join(ROOT, '_raw/french/49_Industry_Portfolios_Daily.csv'), 'utf8').split(/\r?\n/);
const start = lines.findIndex(l => /Average Value Weighted Returns/.test(l)), k = lines[start + 1].split(',').map(s => s.trim()).indexOf('Chips'), chips = [];
for (let i = start + 2; i < lines.length; i++) { const p = lines[i].split(','); if (!/^\d{8}$/.test(p[0].trim())) break; const d = p[0].trim(); chips.push([`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`, +p[k] / 100]); }
const rates = read(path.join(ROOT, 'data/short-rates.tsv')), rateDates = rates.map(r => r[0]);
const rateOn = (date) => { let lo = 0, hi = rateDates.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (rateDates[m] <= date) lo = m; else hi = m - 1; } return rates[lo][1]; };
for (const [name, L, fee, spread] of [['soxx', 1, 0.0035, 0], ['soxl', 3, 0.0075, -0.0181]]) {
  const now = read(path.join(ROOT, `data/synthetic-${name}.tsv`)), before = read(path.join(process.argv[2] || __dirname, `synthetic-${name}.before.tsv`));
  const i0 = now.findIndex(r => r[0] === '1994-05-04'), bmap = new Map(before.map(r => [r[0], r]));
  let changed = [], maxRel = 0; for (let i = i0; i < now.length; i++) { const b = bmap.get(now[i][0]); if (!b) { changed.push(now[i][0] + ' new'); continue; } const rel = Math.abs(now[i][1] / b[1] - 1); if (rel > maxRel) maxRel = rel; if (now[i][2] !== b[2]) changed.push(`${now[i][0]} ${b[2]} -> ${now[i][2]}`); }
  console.log(`${name.toUpperCase()}: rows ${now.length}, first ${now[0][0]} ${now[0][2]}; from 1994-05-04: ${now.length - i0} rows, largest relative change ${maxRel.toExponential(1)}, rows with different text: ${changed.length}${changed.length <= 4 ? ' ' + changed.join(' | ') : ' (first ' + changed[0] + ', last ' + changed[changed.length - 1] + ')'}`);
  // independent walk-back
  let level = now[i0][1], worst = 0, worstAt = '', at = chips.findIndex(c => c[0] > now[i0][0]) - 1, bad = 0;
  for (let i = i0; i > 0; i--) {
    let growthIdx = 1; while (at >= 0 && chips[at][0] > now[i - 1][0]) { growthIdx *= 1 + 1.15 * chips[at][1]; at--; }
    const ret = growthIdx - 1, stepv = 1 + L * ret - (L - 1) * (rateOn(now[i - 1][0]) / 100 + spread) / 252 - fee / 252;
    level /= stepv; const rel = Math.abs(now[i - 1][1] / level - 1); if (rel > worst) { worst = rel; worstAt = now[i - 1][0]; } if (!(now[i - 1][1] > 0)) bad++;
  }
  console.log(`   before 1994-05-04: ${i0} rows, file against the Node walk-back: largest relative gap ${worst.toExponential(1)} (${worstAt}), rows not above zero ${bad}`);
  let big = []; for (let i = 1; i < i0; i++) { const x = now[i][1] / now[i - 1][1] - 1; if (Math.abs(x) > (L === 3 ? 0.3 : 0.1)) big.push(`${now[i][0]} ${(x * 100).toFixed(0)}%`); }
  console.log(`   one-day moves past ${L === 3 ? 30 : 10}% before 1994: ${big.join(', ') || 'none'}`);
}
