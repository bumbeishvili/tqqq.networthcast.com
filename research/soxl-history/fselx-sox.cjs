'use strict';
// The Fidelity fund against the semiconductor index where both exist (monthly, May 1994 to December 2001), and
// French Chips against the index on the same months: which stands in better for the index.
const F = require('./flib.cjs'), { french, data, corr, sd, ols } = F;
const y = require('./yahoo/fselx-monthly-1994-2001.json');
const monthOf = (t) => new Date(t * 1000 + 12 * 3600e3).toISOString().slice(0, 7);
const lastOfMonth = new Map(); data.dates.forEach((d, i) => lastOfMonth.set(d.slice(0, 7), i));
const chipsM = new Map(); for (const [d, o] of french) { const m = d.slice(0, 7); chipsM.set(m, (chipsM.get(m) || 1) * (1 + o.Chips)); }
const rows = [];
for (let k = 1; k < y.ts.length - 1; k++) { const m = monthOf(y.ts[k]), pm = monthOf(y.ts[k - 1]); if (m < '1994-06') continue; const i = lastOfMonth.get(m), j = lastOfMonth.get(pm); rows.push({ m, fund: y.adj[k] / y.adj[k - 1] - 1, sox: data.soxx[i] / data.soxx[j] - 1, chips: chipsM.get(m) - 1 }); }
const f = rows.map(r => r.fund), s = rows.map(r => r.sox), c = rows.map(r => r.chips), cum = (a) => a.reduce((p, r) => p * (1 + r), 1), yrs = rows.length / 12;
const fs1 = ols(s, rows.map(r => [1, r.fund])), cs1 = ols(s, rows.map(r => [1, r.chips]));
console.log(`${rows[0].m}..${rows[rows.length - 1].m}: ${rows.length} months`);
console.log(`index vs fund : corr ${corr(s, f).toFixed(3)}, index = ${(fs1.b[0] * 1200).toFixed(1)}%/yr + ${fs1.b[1].toFixed(2)} x fund (R2 ${fs1.r2.toFixed(2)})`);
console.log(`index vs Chips: corr ${corr(s, c).toFixed(3)}, index = ${(cs1.b[0] * 1200).toFixed(1)}%/yr + ${cs1.b[1].toFixed(2)} x Chips (R2 ${cs1.r2.toFixed(2)})`);
console.log(`vol a year: index ${(sd(s) * Math.sqrt(12) * 100).toFixed(0)}%, fund ${(sd(f) * Math.sqrt(12) * 100).toFixed(0)}%, Chips ${(sd(c) * Math.sqrt(12) * 100).toFixed(0)}% | growth: index x${cum(s).toFixed(2)} (${((Math.pow(cum(s), 1 / yrs) - 1) * 100).toFixed(1)}%/yr), fund x${cum(f).toFixed(2)} (${((Math.pow(cum(f), 1 / yrs) - 1) * 100).toFixed(1)}%/yr), Chips x${cum(c).toFixed(2)} (${((Math.pow(cum(c), 1 / yrs) - 1) * 100).toFixed(1)}%/yr)`);
