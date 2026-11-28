/*
 * Library strategies #48 "10-25 - Extend floor turn" (was "NFCI veto + Turnaround Monday") and #49 "10-25 - Extend
 * buy-back turn" (was "Buy-back + Turnaround Monday") at the user's picks on the map of Q1 2010 to Q4 2025 (28 November
 * 2026: "set these two / first one should be 10-25 extend floor turn / second one should be 10-25 extend buyback turn").
 * Pure Node — no browser/server. Checks, for each, on the repo's own price history:
 *   1. its defaults are the code's before the pick (NFCI_TURN_BASE, BUY_BACK_TURN_BASE) with the ones the pick moved,
 *      each an option or, as the map can pick, a value between two options next to each other;
 *   2. it trades as that code does at those settings, row for row: a lump sum, contributions and a withdrawal, a
 *      switch over two days;
 *   3. the map's numbers, on the app's own rate, at the pick and before; $100K once;
 *   4. the card: the new name, the old one kept for saved copies, rules at the pick with its Big days numbers.
 *
 *   node tests/library-turn-picks.cjs
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

const PICKS = [
  { n: 48, name: '10-25 - Extend floor turn', former: 'NFCI veto + Turnaround Monday', base: 'NFCI_TURN_BASE',
    moved: { asset: 'soxl', stat: 'sma', window: 70, overPct: 35, park: 'soxs', crashStat: 'median', crashWindow: 110, exitPct: 17.5, slopeGate: 105, belowGate: 14, bigRise: 5.5, bigDrop: 17, splitDays: false },
    map: '170.5%, 55.5%', before: '100.3%, 58.0%', lump: '168.5%, 55.5%',
    rules: [/^Hold SOXL\. While it closes more than 35% above its 70-day moving average, hold SOXS instead/, /110-day median 14 days in a row while that median rises less than 105% a year/, /more than 17\.5% above the median/, /\+0\.4/,
      /Big days: after TQQQ rises 5\.5% or more in a day, sell and buy back at the next close\. When the rules want cash and TQQQ falls 17% or more in a day, buy SOXL and sell at the next close\.$/] },
  { n: 49, name: '10-25 - Extend buy-back turn', former: 'Buy-back + Turnaround Monday', base: 'BUY_BACK_TURN_BASE',
    moved: { window: 252, overPct: 55.5, park: 'soxs', exitPct: -1.5, confirmDays: 11, dipReentry: 77, bbPct: -35, sliceStop: 6, sliceCap: 2, bigRise: 8.5, bigDrop: 16.4, splitDays: false },
    map: '147.7%, 40.9%', before: '123.4%, 47.3%', lump: '145.3%, 41.6%',
    rules: [/^Hold TQQQ\. When it closes 55\.5% above its median of the last 252 closes, switch to SOXS\./, /Sell line: 1\.5% below the median\. The first close under it sells to cash\. Buy back after 11 closes in a row above it\./, /77% of the way/, /Buy-back line: 35% below the median/, /6% under its buy price, and it can happen twice/,
      /Big days: after TQQQ rises 8\.5% or more in a day, sell and buy back at the next close\. When the rules want cash and TQQQ falls 16\.4% or more in a day, buy TQQQ and sell at the next close\.$/] },
];
const { dates } = data;
const START = dates.findIndex(d => d >= '2010-01-04') - 1, END = dates.findIndex(d => d >= '2026-01-01') - 1;
const run = (strategy, settings = {}, contributions = {}, initial = 100000) => strategy.run(data, { ...defaultsOf(strategy), ...settings, initial, contributions, startIdx: START, endIdx: END, dailyDisplay: true });
const sameRows = (a, b) => a.length === b.length && a.every((row, k) => row.value === b[k].value && row.held === b[k].held && row.action === b[k].action && row.note === b[k].note);
const firstCloses = (amount) => Object.fromEntries(dates.slice(START + 1, END + 1).filter((date, k, all) => k === 0 || all[k - 1].slice(0, 7) !== date.slice(0, 7)).map(date => [date, amount]));
const fallOf = (log) => { let peak = 0, fall = 0; log.forEach(r => { peak = Math.max(peak, r.value); fall = Math.max(fall, 1 - r.value / peak); }); return fall; };
const years = (a, b) => (Date.parse(b) - Date.parse(a)) / (365.25 * 864e5);
const monthEnds = dates.filter((d, k) => k === dates.length - 1 || dates[k + 1].slice(0, 7) !== d.slice(0, 7)).map(d => [d]);

const stub = new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => '' : stub), apply: () => stub });
const page = { console, window: {}, document: stub, localStorage: stub, setTimeout: () => 0 };
vm.createContext(page);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'strategy-library.js'), 'utf8') + '\nthis.LIBRARY = STRATEGY_LIBRARY;', page);

for (const pick of PICKS) {
  const mine = strategyOf(pick.n), base = new Function('"use strict"; return (' + CODE[pick.base] + '\n);')(), tag = `#${pick.n}`;
  // ---- 1. The defaults ----
  const d = defaultsOf(mine), was = defaultsOf(base);
  ck(`${tag}: the new name, the old code name kept for saved copies`, mine.name === pick.name && base.name === pick.former, mine.name);
  ck(`${tag}: the settings are the code's before`, settingsOf(mine).map(p => p.id).join() === settingsOf(base).map(p => p.id).join());
  const wrong = Object.keys(was).filter(id => JSON.stringify(d[id]) !== JSON.stringify(id in pick.moved ? pick.moved[id] : was[id]));
  ck(`${tag}: the ones the pick moved, the rest kept`, wrong.length === 0 && Object.keys(pick.moved).every(id => JSON.stringify(was[id]) !== JSON.stringify(pick.moved[id])), wrong.map(id => `${id} ${d[id]}`).join(', '));
  const byId = Object.fromEntries(settingsOf(mine).map(p => [p.id, p]));
  const values = (id) => byId[id].options.map(o => (o && typeof o === 'object' ? o.value : o));
  const fits = (id, v) => values(id).some(o => String(o) === String(v))
    || (typeof v === 'number' && values(id).some((o, k, all) => typeof o === 'number' && typeof all[k + 1] === 'number' && Math.min(o, all[k + 1]) < v && v < Math.max(o, all[k + 1])));
  ck(`${tag}: every moved value is an option or lies between two next to each other`, Object.keys(pick.moved).every(id => fits(id, pick.moved[id])), Object.keys(pick.moved).filter(id => !fits(id, pick.moved[id])).join());

  // ---- 2. The code before at the pick, row for row ----
  const withMoney = { ...firstCloses(4000), '2020-06-15': -50000 };
  [['a lump sum', {}, {}], ['contributions and a withdrawal', {}, withMoney], ['a switch over two days', { splitDays: true }, {}]].forEach(([what, settings, contributions]) => {
    ck(`${tag}, ${what}: the code before at the pick, row for row`, sameRows(run(mine, settings, contributions).log, run(base, { ...pick.moved, ...settings }, contributions).log));
  });

  // ---- 3. The map's numbers ----
  // The map's rate is the chart's (cfgMoneyWeightedCAGR -> moneyWeightedCAGR in js/metrics.js): the strategy gets each $3K
  // at the month's first close, the rate counts it at the month's last (the page's monthlyData rows).
  const contributions = firstCloses(3000);
  const mapRate = (strategy) => {
    const log = run(strategy, {}, contributions, 80000).log, final = log[log.length - 1].value;
    const rate = moneyWeightedCAGR(80000, 3000, 0, dates[START], dates[END], years(dates[START], dates[END]), final, monthEnds, 80000 + 3000 * Object.keys(contributions).length);
    return `${rate.toFixed(1)}%, ${(fallOf(log) * 100).toFixed(1)}%`;
  };
  ck(`${tag}: $80K and $3K a month at the pick: ${pick.map}`, mapRate(mine) === pick.map, mapRate(mine));
  ck(`${tag}: the settings before: ${pick.before}`, mapRate(base) === pick.before, mapRate(base));
  const lump = run(mine).log, perYear = Math.pow(lump[lump.length - 1].value / lump[0].value, 1 / years(lump[0].date, lump[lump.length - 1].date)) - 1;
  const lumpText = `${(perYear * 100).toFixed(1)}%, ${(fallOf(lump) * 100).toFixed(1)}%`;
  ck(`${tag}: $100K once: ${pick.lump}`, lumpText === pick.lump, lumpText);

  // ---- 4. The card ----
  const card = page.LIBRARY.find(e => e.n === pick.n);
  ck(`${tag}'s card: the new name, the old one kept for saved copies`, card.name === pick.name && (card.formerNames || []).includes(pick.former), card.name);
  const missing = pick.rules.filter(re => !re.test(card.rules));
  ck(`${tag}'s card gives the pick's rules`, missing.length === 0, missing.map(String).join(' | '));
}

console.log(failures ? `${failures} failure(s)` : 'library-turn-picks: all checks pass');
process.exit(failures ? 1 : 0);
