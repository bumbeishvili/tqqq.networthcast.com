/*
 * Library strategy #44, "10-25 - NFCI, overextend, crash" (was "NFCI veto"), at the user's pick on the map of Q1 2010
 * to Q4 2025 (27 November 2026: "set this for nfci veto and name as 10-25 - nfci,overextend,crash"). Pure Node — no
 * browser/server. Checks, on the repo's own price history:
 *   1. its defaults are the code's before the pick (NFCI_VETO_BASE) with the ten the pick moved;
 *   2. it trades as that code does at those ten, row for row: a lump sum, contributions and a withdrawal, a switch at
 *      one close, cash in between;
 *   3. the map's numbers: with $80K and $3K a month a money-weighted 94.2% a year and a 54.5% max drawdown (82.8%
 *      and 60.2% at the settings before), on the app's own rate; $100K once 93.8% (54.5%);
 *   4. what the card says of the credit rule: from 1953 it fired 13 times, the last from 30 November to 20 December 2007;
 *   5. #48 (since 28 November 2026 "10-25 - Extend floor turn", at a pick of its own) is built from the code before
 *      #44's pick: the settings its own pick left alone keep that code's values, not #44's.
 *
 *   node tests/library-nfci-10-25.cjs
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const { CODE, data, strategyOf, settingsOf, defaultsOf } = require('./library-harness.cjs');
const { moneyWeightedCAGR } = require('../js/metrics.js');

let failures = 0;
const ck = (name, ok, detail) => {
  if (ok) return;
  failures++;
  console.log('  FAIL  ' + name + (detail ? '   ' + detail : ''));
};

const MOVED = { window: 251, overPct: 55.5, park: 'soxs', crashStat: 'sma', crashWindow: 210, exitPct: 6, crashAsset: 'soxx', slopeGate: 96, belowGate: 2, nfciTh: 0.3 };
const WAS = { window: 250, overPct: 55, park: 'sqqq', crashStat: 'same', crashWindow: 0, exitPct: -28, crashAsset: 'cash', slopeGate: 20, belowGate: 10, nfciTh: 0.4 };
const { dates } = data;
const START = dates.findIndex(d => d >= '2010-01-04') - 1, END = dates.findIndex(d => d >= '2026-01-01') - 1;
const mine = strategyOf(44);
const base = new Function('"use strict"; return (' + CODE.NFCI_VETO_BASE + '\n);')();
const run = (strategy, settings = {}, contributions = {}, initial = 100000, from = START) => strategy.run(data, { ...defaultsOf(strategy), ...settings, initial, contributions, startIdx: from, endIdx: END, dailyDisplay: true });
const sameRows = (a, b) => a.length === b.length && a.every((row, k) => row.value === b[k].value && row.held === b[k].held && row.action === b[k].action && row.note === b[k].note);

// ---- 1. The defaults ----
{
  const d = defaultsOf(mine), was = defaultsOf(base);
  ck('the name, the old code name kept for saved copies', mine.name === '10-25 - NFCI, overextend, crash' && base.name === 'NFCI veto, med stretch with SQQQ and med crash exit', mine.name);
  ck('the settings are the code\'s before', settingsOf(mine).map(p => p.id).join() === settingsOf(base).map(p => p.id).join());
  ck('the code before had the defaults the pick moved from', Object.keys(WAS).every(id => JSON.stringify(was[id]) === JSON.stringify(WAS[id])), JSON.stringify(Object.keys(WAS).map(id => [id, was[id]])));
  const wrong = Object.keys(was).filter(id => JSON.stringify(d[id]) !== JSON.stringify(id in MOVED ? MOVED[id] : was[id]));
  ck('the ten moved to the pick, the rest kept', wrong.length === 0, wrong.map(id => `${id} ${d[id]}`).join(', '));
  const byId = Object.fromEntries(settingsOf(mine).map(p => [p.id, p]));
  const values = (id) => byId[id].options.map(o => (o && typeof o === 'object' ? o.value : o));
  ck('every moved value is among its options', Object.keys(MOVED).every(id => values(id).some(v => String(v) === String(MOVED[id]))), Object.keys(MOVED).filter(id => !values(id).some(v => String(v) === String(MOVED[id]))).join());
}

// ---- 2. The code before at the pick, row for row ----
{
  const monthly = Object.fromEntries(dates.slice(START + 1, END + 1).filter((date, k, all) => k === 0 || all[k - 1].slice(0, 7) !== date.slice(0, 7)).map(date => [date, 4000]));
  const withMoney = { ...monthly, '2020-06-15': -50000 };
  [['a lump sum', {}, {}], ['contributions and a withdrawal', {}, withMoney], ['a switch at one close', { splitDays: false }, {}], ['cash in between', { park: 'cash', crashAsset: 'cash' }, withMoney]].forEach(([tag, settings, contributions]) => {
    ck(`${tag}: the code before at the pick, row for row`, sameRows(run(mine, settings, contributions).log, run(base, { ...MOVED, ...settings }, contributions).log));
  });
}

// ---- 3. The map's numbers ----
{
  const fallOf = (log) => { let peak = 0, fall = 0; log.forEach(r => { peak = Math.max(peak, r.value); fall = Math.max(fall, 1 - r.value / peak); }); return fall; };
  const years = (a, b) => (Date.parse(b) - Date.parse(a)) / (365.25 * 864e5);
  const lump = run(mine).log;
  const perYear = Math.pow(lump[lump.length - 1].value / lump[0].value, 1 / years(lump[0].date, lump[lump.length - 1].date)) - 1;
  ck('$100K once: 93.8% a year, max drawdown 54.5%', (perYear * 100).toFixed(1) === '93.8' && (fallOf(lump) * 100).toFixed(1) === '54.5', `${(perYear * 100).toFixed(1)}%, ${(fallOf(lump) * 100).toFixed(1)}%`);
  const contributions = Object.fromEntries(dates.slice(START + 1, END + 1).filter((d, k, all) => k === 0 || all[k - 1].slice(0, 7) !== d.slice(0, 7)).map(d => [d, 3000]));
  // The map's rate is the chart's (cfgMoneyWeightedCAGR -> moneyWeightedCAGR in js/metrics.js): the strategy gets each $3K
  // at the month's first close, the rate counts it at the month's last (the page's monthlyData rows). Timed at the first
  // close it reads 93.9% here, 82.6% before.
  const monthEnds = dates.filter((d, k) => k === dates.length - 1 || dates[k + 1].slice(0, 7) !== d.slice(0, 7)).map(d => [d]);
  const mapRate = (strategy) => {
    const log = run(strategy, {}, contributions, 80000).log, final = log[log.length - 1].value;
    const rate = moneyWeightedCAGR(80000, 3000, 0, dates[START], dates[END], years(dates[START], dates[END]), final, monthEnds, 80000 + 3000 * Object.keys(contributions).length);
    return `${rate.toFixed(1)}%, ${(fallOf(log) * 100).toFixed(1)}%`;
  };
  ck('$80K and $3K a month: 94.2% a year money-weighted, max drawdown 54.5%', mapRate(mine) === '94.2%, 54.5%', mapRate(mine));
  ck('the settings before: 82.8% a year, max drawdown 60.2%', mapRate(base) === '82.8%, 60.2%', mapRate(base));
}

// ---- 4. The credit rule over the whole history ----
{
  const all = mine.run(data, { ...defaultsOf(mine), initial: 100000, contributions: {}, startIdx: 0, endIdx: dates.length - 1, dailyDisplay: true }).log;
  const stretches = [];
  all.forEach((r, k) => { if (r.zone !== 'CREDIT VETO') return; if (k && all[k - 1].zone === 'CREDIT VETO') stretches[stretches.length - 1].to = r.date; else stretches.push({ from: r.date, to: r.date }); });
  const last = stretches[stretches.length - 1];
  ck('from 1953 the credit rule fired 13 times, between 1971 and November 2007, the last 30 November to 20 December 2007', all[0].date.startsWith('1953') && stretches.length === 13 && stretches[0].from.startsWith('1971') && last.from === '2007-11-30' && last.to === '2007-12-20',
    `${all[0].date}: ${stretches.length} stretches, ${stretches.map(s => s.from + '→' + s.to).join(', ')}`);
}

// ---- 5. #48 is built from the code before #44's pick ----
{
  const turn = defaultsOf(strategyOf(48)), LEFT = ['crashAsset', 'nfciTh'];
  ck('#48 keeps the code before\'s values where its own pick left them: cash after the crash exit, the credit rule at 0.4', LEFT.every(id => JSON.stringify(turn[id]) === JSON.stringify(WAS[id])), JSON.stringify(LEFT.map(id => [id, turn[id]])));
  const stub = new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => '' : stub), apply: () => stub });
  const page = { console, window: {}, document: stub, localStorage: stub, setTimeout: () => 0 };
  vm.createContext(page);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'strategy-library.js'), 'utf8') + '\nthis.LIBRARY = STRATEGY_LIBRARY;', page);
  const card = (n) => page.LIBRARY.find(e => e.n === n);
  ck('#44\'s card: the new name, the old ones kept for saved copies', card(44).name === '10-25 - NFCI, overextend, crash' && card(44).formerNames.includes('NFCI veto'), card(44).name);
  ck('#44\'s card gives the pick\'s rules', /55\.5% above its median of the last 251 closes, hold SOXS/.test(card(44).rules) && /210-day moving average/.test(card(44).rules) && /\+0\.3/.test(card(44).rules) && !/SQQQ/.test(card(44).rules));
}

console.log(failures ? `${failures} failure(s)` : 'library-nfci-10-25: all checks pass');
process.exit(failures ? 1 : 0);
