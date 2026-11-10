'use strict';
// Fit's long-history numbers split by cause: the SOXL history before 1994 and the six moved defaults (lump sum).
const L = require('./lib.cjs');
const code = L.CODE[53], gated = code.split('const SOXL_FROM = "1953-01-02"').join('const SOXL_FROM = "1994-05-04"'); if (gated === code) throw new Error('gate');
const OLD = { lookbackDays: 543, startAvgDays: 65, backLead: 34, reentryLead: 65, reentryCloses: 44, deepLead: -32.5 };
const eras = [['1953-01-02', '2026-11-06'], ['1979-12-31', '2000-03-31'], ['1999-12-31', '2009-03-31'], ['1982-12-31', '2026-11-06'], ['2008-12-31', '2025-12-31'], ['2009-12-31', '2025-12-31']];
for (const [name, c, p] of [['fitted values, SOXL rule off before 1994 (before)', gated, OLD], ['fitted values, SOXL history from 1953', code, OLD], ['new values, SOXL rule off before 1994', gated, {}], ['new values, SOXL history from 1953 (now)', code, {}]])
  console.log(name.padEnd(52), eras.map(([a, b]) => { const s = L.stat(c, p, a, b); return `${a.slice(0, 4)}-${b.slice(0, 4)} ${s.cagr.toFixed(1)}% DD ${s.dd.toFixed(0)}`; }).join(' | '));
