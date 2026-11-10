'use strict';
// Fit's SOXL lead lookback: the refit's 226 days against the shipped 380, each with its own thresholds, over a fine grid.
const L = require('./lib.cjs'), code = L.CODE[53];
const refit = { backLead: 24, overPct: 57.5, overWindow: 241, sqqqMaxDays: 19, soxlLeadDays: 226, soxlLeadEnter: -13, soxlLeadExit: 91 };
const row = (p) => { const a = L.stat(code, p), h1 = L.stat(code, p, '2009-12-31', '2017-12-29'), h2 = L.stat(code, p, '2017-12-29', '2025-12-31'), y = L.runLog(code, p, '2025-12-31', L.LAST); return `${a.cagr.toFixed(1)}% DD ${a.dd.toFixed(1)} | halves ${h1.cagr.toFixed(0)}/${h2.cagr.toFixed(0)} | 2026 ${((y[y.length - 1].value / y[0].value - 1) * 100).toFixed(0)}%`; };
console.log('shipped Fit           ', row({}));
console.log('refit (start 0)       ', row(refit));
console.log('refit, SOXL part only ', row({ soxlLeadDays: 226, soxlLeadEnter: -13, soxlLeadExit: 91 }));
console.log('lookback scan with the refit thresholds (-13 / 91), other settings shipped:');
let line = ''; for (let d = 150; d <= 480; d += 6) line += `${d}:${L.stat(code, { soxlLeadDays: d, soxlLeadEnter: -13, soxlLeadExit: 91 }).cagr.toFixed(0)} `; console.log(' ', line);
console.log('lookback scan with the shipped thresholds (-33 / 101):');
line = ''; for (let d = 150; d <= 480; d += 6) line += `${d}:${L.stat(code, { soxlLeadDays: d }).cagr.toFixed(0)} `; console.log(' ', line);
console.log('fine scan 210-244 with -13 / 91:');
line = ''; for (let d = 210; d <= 244; d += 1) line += `${d}:${L.stat(code, { soxlLeadDays: d, soxlLeadEnter: -13, soxlLeadExit: 91 }).cagr.toFixed(0)} `; console.log(' ', line);
