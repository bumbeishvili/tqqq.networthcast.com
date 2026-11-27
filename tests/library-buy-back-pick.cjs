/*
 * Library strategy #45, "10-25 - Stretch buy-back" (was "SQQQ stretch + buy-back"), at the user's pick on the map of Q1
 * 2010 to Q4 2025 (27 November 2026: "put this as default", then "call it 10-25 stretch buyback"). Pure Node — no browser/server. Checks, on the repo's own price history:
 *   1. its defaults are the code's before the pick (BUY_BACK_BASE) with the nine the pick moved;
 *   2. it trades as that code does at those nine, row for row: a lump sum, contributions and a withdrawal, a switch
 *      over two days, cash in between;
 *   3. the map's numbers, on the app's own rate: with $80K and $3K a month a money-weighted 122.7% a year and a 45.3%
 *      max drawdown (100.4% and 49.6% at the settings before); $100K once 121.6% (45.3%);
 *   4. Buy-back + Turnaround Monday (#49) still runs the code before at its settings, and its card still starts with
 *      the rules SQQQ stretch + buy-back had.
 *
 *   node tests/library-buy-back-pick.cjs
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

const MOVED = { window: 234, overPct: 53.5, park: 'soxs', crashAsset: 'gld', confirmDays: 35, dipReentry: 97, sliceStop: 6.5, sliceCap: 2, splitDays: false };
const WAS = { window: 250, overPct: 55, park: 'sqqq', crashAsset: 'cash', confirmDays: 5, dipReentry: 50, sliceStop: 20, sliceCap: 1, splitDays: true };
const { dates } = data;
const START = dates.findIndex(d => d >= '2010-01-04') - 1, END = dates.findIndex(d => d >= '2026-01-01') - 1;
const mine = strategyOf(45);
const base = new Function('"use strict"; return (' + CODE.BUY_BACK_BASE + '\n);')();
const run = (strategy, settings = {}, contributions = {}, initial = 100000, from = START) => strategy.run(data, { ...defaultsOf(strategy), ...settings, initial, contributions, startIdx: from, endIdx: END, dailyDisplay: true });
const sameRows = (a, b) => a.length === b.length && a.every((row, k) => row.value === b[k].value && row.held === b[k].held && row.action === b[k].action && row.note === b[k].note);
const firstCloses = (amount) => Object.fromEntries(dates.slice(START + 1, END + 1).filter((date, k, all) => k === 0 || all[k - 1].slice(0, 7) !== date.slice(0, 7)).map(date => [date, amount]));

// ---- 1. The defaults ----
{
  const d = defaultsOf(mine), was = defaultsOf(base);
  ck('the new name, the old code name kept for saved copies', mine.name === '10-25 - Stretch buy-back' && base.name === 'SQQQ stretch, sell line + crash buy-back', mine.name);
  ck('the settings are the code\'s before', settingsOf(mine).map(p => p.id).join() === settingsOf(base).map(p => p.id).join());
  ck('the code before had the defaults the pick moved from', Object.keys(WAS).every(id => JSON.stringify(was[id]) === JSON.stringify(WAS[id])), JSON.stringify(Object.keys(WAS).map(id => [id, was[id]])));
  const wrong = Object.keys(was).filter(id => JSON.stringify(d[id]) !== JSON.stringify(id in MOVED ? MOVED[id] : was[id]));
  ck('the nine moved to the pick, the rest kept', wrong.length === 0, wrong.map(id => `${id} ${d[id]}`).join(', '));
  const byId = Object.fromEntries(settingsOf(mine).map(p => [p.id, p]));
  const values = (id) => byId[id].options.map(o => (o && typeof o === 'object' ? o.value : o));
  ck('every moved value is among its options', Object.keys(MOVED).every(id => values(id).some(v => String(v) === String(MOVED[id]))), Object.keys(MOVED).filter(id => !values(id).some(v => String(v) === String(MOVED[id]))).join());
}

// ---- 2. The code before at the pick, row for row ----
{
  const withMoney = { ...firstCloses(4000), '2020-06-15': -50000 };
  [['a lump sum', {}, {}], ['contributions and a withdrawal', {}, withMoney], ['a switch over two days', { splitDays: true }, {}], ['cash in between', { park: 'cash', crashAsset: 'cash' }, withMoney]].forEach(([tag, settings, contributions]) => {
    ck(`${tag}: the code before at the pick, row for row`, sameRows(run(mine, settings, contributions).log, run(base, { ...MOVED, ...settings }, contributions).log));
  });
}

// ---- 3. The map's numbers ----
{
  const fallOf = (log) => { let peak = 0, fall = 0; log.forEach(r => { peak = Math.max(peak, r.value); fall = Math.max(fall, 1 - r.value / peak); }); return fall; };
  const years = (a, b) => (Date.parse(b) - Date.parse(a)) / (365.25 * 864e5);
  const lump = run(mine).log;
  const perYear = Math.pow(lump[lump.length - 1].value / lump[0].value, 1 / years(lump[0].date, lump[lump.length - 1].date)) - 1;
  ck('$100K once: 121.6% a year, max drawdown 45.3%', (perYear * 100).toFixed(1) === '121.6' && (fallOf(lump) * 100).toFixed(1) === '45.3', `${(perYear * 100).toFixed(1)}%, ${(fallOf(lump) * 100).toFixed(1)}%`);
  // The map's rate is the chart's (cfgMoneyWeightedCAGR -> moneyWeightedCAGR in js/metrics.js): the strategy gets each $3K
  // at the month's first close, the rate counts it at the month's last (the page's monthlyData rows).
  const contributions = firstCloses(3000);
  const monthEnds = dates.filter((d, k) => k === dates.length - 1 || dates[k + 1].slice(0, 7) !== d.slice(0, 7)).map(d => [d]);
  const mapRate = (strategy) => {
    const log = run(strategy, {}, contributions, 80000).log, final = log[log.length - 1].value;
    const rate = moneyWeightedCAGR(80000, 3000, 0, dates[START], dates[END], years(dates[START], dates[END]), final, monthEnds, 80000 + 3000 * Object.keys(contributions).length);
    return `${rate.toFixed(1)}%, ${(fallOf(log) * 100).toFixed(1)}%`;
  };
  ck('$80K and $3K a month: 122.7% a year money-weighted, max drawdown 45.3%', mapRate(mine) === '122.7%, 45.3%', mapRate(mine));
  ck('the settings before: 100.4% a year, max drawdown 49.6%', mapRate(base) === '100.4%, 49.6%', mapRate(base));
}

// ---- 4. Buy-back + Turnaround Monday keeps SQQQ stretch + buy-back as it was ----
{
  const monday = defaultsOf(strategyOf(49));
  ck('#49 runs the code before at its settings', Object.keys(WAS).every(id => JSON.stringify(monday[id]) === JSON.stringify(WAS[id])), JSON.stringify(Object.keys(WAS).map(id => [id, monday[id]])));
  const stub = new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => '' : stub), apply: () => stub });
  const page = { console, window: {}, document: stub, localStorage: stub, setTimeout: () => 0 };
  vm.createContext(page);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'strategy-library.js'), 'utf8') + '\nthis.LIBRARY = STRATEGY_LIBRARY; this.OLD = BUY_BACK_RULES;', page);
  const card = (n) => page.LIBRARY.find(e => e.n === n);
  ck('#45\'s card: the new name, the old ones kept for saved copies', card(45).name === '10-25 - Stretch buy-back' && card(45).formerNames.includes('SQQQ stretch + buy-back'), card(45).name);
  ck('#45\'s card gives the pick\'s rules', /53\.5% above its median of the last 234 closes, switch to SOXS/.test(card(45).rules) && /switches to GLD\. Buy back after 35 closes/.test(card(45).rules) && /97% of the way/.test(card(45).rules) && /6\.5% under its buy price/.test(card(45).rules) && !/SQQQ/.test(card(45).rules));
  ck('#49\'s card still starts with the rules SQQQ stretch + buy-back had', card(49).rules.startsWith(page.OLD + '\n\n') && /55% above its 250-day median, switch to SQQQ/.test(page.OLD), card(49).rules.slice(0, 80));
}

console.log(failures ? `${failures} failure(s)` : 'library-buy-back-pick: all checks pass');
process.exit(failures ? 1 : 0);
