'use strict';
// How close Fit's level crossings since 2010 were: the lead at each floor break and deep buy, the lowest lead of
// each crash, and the ceiling crossings.
const L = require('./lib.cjs');
const log = L.runLog(L.CODE[53], {}, '2009-12-31', L.LAST), d = L.defaultsOf(L.CODE[53]);
const at = (date) => log.find(r => r.date === date);
for (const dt of ['2020-03-06', '2020-03-09', '2020-03-19', '2020-03-20', '2020-03-23', '2022-05-19', '2022-05-20', '2022-09-29', '2022-09-30', '2022-10-03']) { const r = at(dt); console.log(dt, 'lead', r.leadPct.toFixed(2), 'held', r.held, '|', String(r.note).slice(0, 90)); }
const minIn = (a, b) => log.filter(r => r.date >= a && r.date <= b).reduce((m, r) => r.leadPct < m.leadPct ? r : m);
for (const [a, b] of [['2020-02-01', '2020-06-30'], ['2022-01-01', '2023-03-31'], ['2015-06-01', '2016-12-31'], ['2018-09-01', '2019-06-30'], ['2011-06-01', '2012-06-30'], ['2025-01-01', '2025-12-31'], ['2026-01-01', '2026-11-06']]) { const m = minIn(a, b); console.log(`lowest lead ${a.slice(0, 7)}..${b.slice(0, 7)}: ${m.leadPct.toFixed(1)} on ${m.date}`); }
console.log('floor', d.floorLead, 'deep', d.deepLead, 'ceiling', d.topLead, 'back', d.backLead);
// every first close at or past the ceiling, with the lead the day before
let prev = null; for (const r of log) { if (prev && prev.leadPct < d.topLead && r.leadPct >= d.topLead) console.log('ceiling crossed', r.date, prev.leadPct.toFixed(1), '->', r.leadPct.toFixed(1)); prev = r; }
const last = log[log.length - 1]; console.log('now', last.date, 'lead', last.leadPct.toFixed(1), 'held', last.held, 'soxlLead', last.soxlLead == null ? null : last.soxlLead.toFixed(1), '| over median', last.overPct == null ? null : last.overPct.toFixed(1));
