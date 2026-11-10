'use strict';
// Sleeves for Fit: the same rules run on a few copies with spread settings, equal money, never rebalanced.
const L = require('./lib.cjs'), J = require('./jitter.cjs'), code = L.CODE[53];
const E = { lookbackDays: 546, startAvgDays: 60, backLead: 28, reentryLead: 35, reentryCloses: 10, deepLead: -30.5 };
const show = (name, members, from = L.FIT_FROM, to = L.FIT_TO) => { const ev = J.evaluate(code, members, from, to), sl = ev.sleeves(members.length), c = ev.each.map(x => x.cagr); return `${name.padEnd(54)} ${sl.never.cagr.toFixed(1)}% DD ${sl.never.dd.toFixed(1)} w12 ${sl.never.w12.toFixed(0)} (members ${Math.min(...c).toFixed(0)}..${Math.max(...c).toFixed(0)})`; };
const y26 = (members) => { const ev = J.evaluate(code, members, '2025-12-31', L.LAST); const logs = members.map(p => L.runLog(code, p, '2025-12-31', L.LAST)); return (logs.reduce((a, lg) => a + lg[lg.length - 1].value / lg[0].value, 0) / members.length - 1) * 100; };
const sets = {
  'shipped Fit, one copy': [{}],
  'E, one copy': [E],
  'E, 3 copies: lookback 539 / 546 / 553': [539, 546, 553].map(l => ({ ...E, lookbackDays: l })),
  'E, 3 copies: deep buy -28.5 / -30.5 / -32.5': [-28.5, -30.5, -32.5].map(d => ({ ...E, deepLead: d })),
  'E, 5 copies: lookback 536..556 by 5': [536, 541, 546, 551, 556].map(l => ({ ...E, lookbackDays: l })),
  'E, 10 random near draws': J.draws(code, E, 10, 1, 77),
  'E, 20 random near draws': J.draws(code, E, 20, 1, 77),
  'shipped, 3 copies: lookback 536 / 543 / 550': [536, 543, 550].map(l => ({ lookbackDays: l })),
  'shipped, 20 random near draws': J.draws(code, {}, 20, 1, 77),
};
for (const [name, members] of Object.entries(sets)) console.log(show(name, members), '| 2026', y26(members).toFixed(0) + '%');
