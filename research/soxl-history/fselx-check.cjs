'use strict';
// The French Chips industry against a real semiconductor fund before the index existed: Fidelity Select
// Electronics (FSELX, from 1985-07-29; now Select Semiconductors), monthly adjusted closes from Yahoo.
const F = require('./flib.cjs'), { french, corr, sd, ols } = F;
const y = require('./yahoo/fselx-monthly.json');
console.log('months', y.ts.length, y.adj.length, 'first', new Date(y.ts[0] * 1000).toISOString().slice(0, 10), 'last', new Date(y.ts[y.ts.length - 1] * 1000).toISOString().slice(0, 10));
const monthOf = (t) => new Date(t * 1000 + 12 * 3600e3).toISOString().slice(0, 7);
const chipsM = new Map(), mktM = new Map();
for (const [d, o] of french) { const m = d.slice(0, 7); chipsM.set(m, (chipsM.get(m) || 1) * (1 + o.Chips)); }
const rows = [];
for (let k = 1; k < y.ts.length - 1; k++) { const m = monthOf(y.ts[k]); rows.push({ m, fund: y.adj[k] / y.adj[k - 1] - 1, chips: chipsM.get(m) - 1 }); }   // the last bar (May 1994) is a part month
const f = rows.map(r => r.fund), c = rows.map(r => r.chips), fit = ols(f, rows.map(r => [1, r.chips]));
console.log(`${rows[0].m}..${rows[rows.length - 1].m}: ${rows.length} months | monthly corr ${corr(f, c).toFixed(3)} | fund = ${(fit.b[0] * 12 * 100).toFixed(1)}%/yr + ${fit.b[1].toFixed(2)} x Chips (R2 ${fit.r2.toFixed(2)}) | vol a year: fund ${(sd(f) * Math.sqrt(12) * 100).toFixed(0)}%, Chips ${(sd(c) * Math.sqrt(12) * 100).toFixed(0)}%`);
const cum = (a) => a.reduce((p, r) => p * (1 + r), 1), yrs = rows.length / 12;
console.log(`growth over the ${yrs.toFixed(1)} years: fund x${cum(f).toFixed(2)} (${((Math.pow(cum(f), 1 / yrs) - 1) * 100).toFixed(1)}%/yr), Chips x${cum(c).toFixed(2)} (${((Math.pow(cum(c), 1 / yrs) - 1) * 100).toFixed(1)}%/yr), 1.12 x Chips - 1.1%/yr x${cum(c.map(r => 1.12 * r - 0.011 / 12)).toFixed(2)}, 1.28 x Chips x${cum(c.map(r => 1.28 * r)).toFixed(2)}`);
for (const [a, b] of [['1985-08', '1987-09'], ['1987-10', '1987-11'], ['1987-12', '1990-12'], ['1991-01', '1994-04']]) { const part = rows.filter(r => r.m >= a && r.m <= b); console.log(`  ${a}..${b}: fund x${cum(part.map(r => r.fund)).toFixed(2)}, Chips x${cum(part.map(r => r.chips)).toFixed(2)}`); }
