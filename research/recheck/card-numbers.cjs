'use strict';
// Every number the rewritten cards quote, from the library code and data as they are now.
const L = require('./lib.cjs'), P = require('./patches.cjs');
const { CODE, data, runLog, statsOfLog } = L;
const ddSpan = (log) => { let pk = -Infinity, pkAt = '', best = { dd: 0 }; for (const r of log) { if (r.value > pk) { pk = r.value; pkAt = r.date; } const d = 1 - r.value / pk; if (d > best.dd) best = { dd: d, from: pkAt, to: r.date }; } return `${(best.dd * 100).toFixed(1)}% (${best.from} to ${best.to})`; };
const line = (name, code, p, from, to) => { const lg = runLog(code, p, from, to), s = statsOfLog(lg); console.log(`  ${name.padEnd(46)} ${from.slice(0, 7)}..${to.slice(0, 7)}: ${s.cagr.toFixed(1)}% a year, DD ${ddSpan(lg)}, worst 12m ${s.w12.toFixed(0)}%, growth x${(lg[lg.length - 1].value / lg[0].value).toFixed(3)}`); return lg; };
const FIT = ['2009-12-31', '2025-12-31'], Y26 = ['2025-12-31', '2026-11-06'], H1 = ['2009-12-31', '2017-12-29'], H2 = ['2017-12-29', '2025-12-31'];
const hl = (code) => { const a = 'const tmHL = false,'; if (code.split(a).length !== 2) throw new Error('tmHL'); return code.split(a).join('const tmHL = true,'); };
console.log('NFCI veto (#44)');
line('as it is', CODE[44], {}, ...FIT); line('as it is', CODE[44], {}, ...Y26);
{ const lg = runLog(CODE[44], {}, '1953-01-02', '2026-11-06'); const wins = []; let cur = null;
  for (const r of lg) { const v = r.zone === 'CREDIT VETO'; if (v && !cur) cur = { from: r.date, days: 0 }; if (v) { cur.days++; cur.to = r.date; } if (!v && cur) { wins.push(cur); cur = null; } } if (cur) wins.push(cur);
  console.log('  veto windows from 1953:', wins.length, '| first', wins[0].from, '| last', wins[wins.length - 1].from, '->', wins[wins.length - 1].to, '| trading days in each:', wins.map(w => w.days).join(' '));
  console.log('  windows:', wins.map(w => w.from + '..' + w.to).join(', '));
  for (const r of lg.filter(r => r.date >= '2007-11-01' && r.date <= '2009-06-30' && ['buy', 'sell', 'switch'].includes(r.action))) console.log('   ', r.date, r.action, r.held, '|', String(r.note).slice(0, 70)); }
console.log('NFCI + Monday (#48)');
line('as it is', CODE[48], {}, ...FIT); line('as it is', CODE[48], {}, ...Y26); line('Monday rule on the prior day\'s low and high', hl(CODE[48]), {}, ...FIT);
console.log('Buy-back (#45)');
const OLD = { exitPct: 10, confirmDays: 4, bbPct: -32 };
line('new defaults (-3 / 5 / -34)', CODE[45], {}, ...FIT); line('new defaults', CODE[45], {}, ...H1); line('new defaults', CODE[45], {}, ...H2); line('new defaults', CODE[45], {}, ...Y26);
line('the fit (+10 / 4 / -32)', CODE[45], OLD, ...FIT); line('the fit', CODE[45], OLD, ...Y26);
line('the fit, half-way line only for lows under the median', P.halfwayBelowOnly(CODE[45]), OLD, ...FIT);
console.log('Buy-back + Monday (#49)');
line('new defaults', CODE[49], {}, ...FIT); line('new defaults', CODE[49], {}, ...H1); line('new defaults', CODE[49], {}, ...H2); line('new defaults', CODE[49], {}, ...Y26);
line('the fit (+10 / 4 / -32)', CODE[49], OLD, ...FIT); line('the fit', CODE[49], OLD, ...Y26);
line('the fit, half-way line only for lows under the median', P.halfwayBelowOnly(CODE[49]), OLD, ...FIT);
line('new defaults, Monday rule on the prior day\'s low and high', hl(CODE[49]), {}, ...FIT);
console.log('TQQQ vs QQQ + Monday (#50)');
line('as it is', CODE[50], {}, ...FIT); line('as it is', CODE[50], {}, '2004-12-31', '2025-12-31'); line('as it is', CODE[50], {}, ...Y26); line('stretch alone (#47)', CODE[47], {}, ...FIT); line('stretch alone (#47)', CODE[47], {}, '2004-12-31', '2025-12-31'); line('stretch alone (#47)', CODE[47], {}, ...Y26);
console.log('Fit (#53) and Mon Turns (#52)');
for (const [n, nm] of [[53, 'Fit'], [52, 'Mon Turns']]) { line(nm, CODE[n], {}, ...FIT); line(nm, CODE[n], {}, ...H1); line(nm, CODE[n], {}, ...H2); line(nm, CODE[n], {}, ...Y26); line(nm, CODE[n], {}, '1953-01-02', '2026-11-06'); line(nm, CODE[n], {}, '1982-12-31', '2026-11-06'); line(nm, CODE[n], {}, '2009-12-31', '2026-11-06'); }
const bh = (f, a, b) => { const i = L.idxOf(a), j = L.idxBefore(b); return ((data[f][j] / data[f][i] - 1) * 100).toFixed(1); };
console.log('B&H TQQQ 2026 to 11-06:', bh('tqqq', ...Y26) + '%', '| B&H TQQQ 2010-2025 a year:', statsOfLog(runLog(CODE[44], {}, ...FIT).map((r, k, a) => ({ date: r.date, value: data.tqqq[L.idxOf(FIT[0]) + k] }))).cagr.toFixed(1));
