'use strict';
// How well French industry returns stand in for the semiconductor index: daily regressions of the repo's SOXX series
// (^SOX less fee to 2001-07-12, real SOXX after) on Chips alone and with neighbours, by period.
const F = require('./flib.cjs'), { data, french, ols, corr, sd } = F;
const d = data.dates, i0 = d.indexOf('1994-05-04'), rows = [];
for (let i = i0 + 1; i < d.length; i++) { const f = french.get(d[i]); if (!f || d[i] > '2026-09-30') continue; rows.push({ date: d[i], y: data.soxx[i] / data.soxx[i - 1] - 1, q: data.qqq[i] / data.qqq[i - 1] - 1, f }); }
const PERIODS = [['1994-05-05', '2001-07-12', '^SOX price, 1994-2001'], ['2001-07-13', '2010-03-10', 'SOXX, 2001-2010'], ['2010-03-11', '2021-06-18', 'SOXX, 2010-2021'], ['2021-06-21', '2026-09-30', 'SOXX on the ICE index, 2021-2026'], ['1994-05-05', '2026-09-30', 'all']];
const MODELS = { 'Chips': ['Chips'], 'Chips + Hardw': ['Chips', 'Hardw'], 'Chips + Mach + LabEq': ['Chips', 'Mach', 'LabEq'], 'Chips + Hardw + Softw + Mach + LabEq': ['Chips', 'Hardw', 'Softw', 'Mach', 'LabEq'], 'QQQ (the repo\'s Nasdaq-100 series)': ['QQQ'] };
const x = (r, name) => name === 'QQQ' ? r.q : r.f[name];
for (const [a, b, label] of PERIODS) {
  const part = rows.filter(r => r.date >= a && r.date <= b), y = part.map(r => r.y);
  console.log(`\n${label}: ${part.length} days, index vol ${(sd(y) * Math.sqrt(252) * 100).toFixed(1)}%/yr, Chips vol ${(sd(part.map(r => r.f.Chips)) * Math.sqrt(252) * 100).toFixed(1)}%/yr`);
  for (const [name, vars] of Object.entries(MODELS)) {
    const fit = ols(y, part.map(r => [1, ...vars.map(v => x(r, v))]));
    console.log(`   ${name.padEnd(40)} R2 ${fit.r2.toFixed(3)}  betas ${fit.b.slice(1).map(v => v.toFixed(2)).join(' / ')}  intercept ${(fit.b[0] * 252 * 100).toFixed(1)}%/yr`);
  }
}
// Fitted on one stretch, tested on another: the proxy's daily correlation and its volatility against the index's.
const test = (fitA, fitB, tA, tB, vars) => { const tr = rows.filter(r => r.date >= fitA && r.date <= fitB), te = rows.filter(r => r.date >= tA && r.date <= tB); const fit = ols(tr.map(r => r.y), tr.map(r => [1, ...vars.map(v => x(r, v))])); const p = te.map(r => vars.reduce((s, v, k) => s + fit.b[k + 1] * x(r, v), 0)), y = te.map(r => r.y); return `corr ${corr(p, y).toFixed(3)}, proxy vol / index vol ${(sd(p) / sd(y)).toFixed(2)}, betas ${fit.b.slice(1).map(v => v.toFixed(2)).join(' / ')}`; };
console.log('\nfitted 2001-07-13..2026-09-30, tested on 1994-05-05..2001-07-12:');
for (const [name, vars] of Object.entries(MODELS)) console.log(`   ${name.padEnd(40)} ${test('2001-07-13', '2026-09-30', '1994-05-05', '2001-07-12', vars)}`);
console.log('fitted 1994-05-05..2001-07-12, tested on 2001-07-13..2026-09-30:');
for (const [name, vars] of Object.entries(MODELS)) console.log(`   ${name.padEnd(40)} ${test('1994-05-05', '2001-07-12', '2001-07-13', '2026-09-30', vars)}`);
