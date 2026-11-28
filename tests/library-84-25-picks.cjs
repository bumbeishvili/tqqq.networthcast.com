/*
 * Library strategies #77 "84-25 - Extend buy-back turn" and #78 "84-25 - Min - late-week SQQQ": #49 "10-25 - Extend
 * buy-back turn" and #72 "10-25 - Min - late-week SQQQ" at the user's picks on the map of Q1 1984 to Q4 2025 (28 November
 * 2026: "Add both of these, call them same name but start with 84-25 instedad of 10-25"; the #77 and #78 section of
 * js/strategy-library-code.js). Pure Node — no browser/server. Checks, for each, on the repo's own price history:
 *   1. its settings are its 10-25 entry's, in the same order, with the ones the pick moved and no other, each an option;
 *   2. it trades as that entry does with those set by hand, row for row: a lump sum from 1984, contributions and a
 *      withdrawal, a switch over two days;
 *   3. its code is that entry's but for its name, its defaults and, for #78, the six tips that quoted #72's own facts;
 *   4. the map's numbers on 1984-2025 with $80K and $3K a month, at the pick and before; $100K once on 1984-2025 and on
 *      2010-2025;
 *   5. the card: its name, the rules at the pick, the count of settings moved, its place among the 84-25 entries; and
 *      for #78 the lag rule's weeks hold SQQQ over Thursday and Friday, as the card says.
 *
 *   node tests/library-84-25-picks.cjs
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
  { n: 77, from: 49, name: '84-25 - Extend buy-back turn', fromName: '10-25 - Extend buy-back turn', tips: [],
    moved: { window: 243, overPct: 54.5, park: 'psq', exitPct: 10, confirmDays: 3, dipReentry: 10, bbPct: -27.5, sliceStop: 11.5, sliceCap: 57, bigRise: 9.5, bigDrop: 23.5 },
    map: '87.7%, 63.6%', before: '48.4%, 98.9%', lump: '84.8%, 63.6%', since2010: '112.7%, 54.6%',
    rules: [/^Hold TQQQ\. When it closes 54\.5% above its median of the last 243 closes, switch to PSQ\./m,
      /Sell line: 10% above the median\. The first close under it sells to cash\. Buy back after 3 closes in a row above it\./,
      /after 3 closes in a row above a line 10% of the way from the median down/, /Buy-back line: 27\.5% below the median\./,
      /falls 11\.5% under its buy price, and it can happen 57 times per sold-out stretch\. After such a sale, 3 closes/, /SPY closes down on a Monday/,
      /Big days: after TQQQ rises 9\.5% or more in a day, sell and buy back at the next close\. When the rules want cash and TQQQ falls 23\.5% or more in a day, buy TQQQ and sell at the next close\.$/] },
  { n: 78, from: 72, name: '84-25 - Min - late-week SQQQ', fromName: '10-25 - Min - late-week SQQQ', tips: ['weekendCheck', 'rsiSkip', 'rsiLevel', 'lagTake', 'lagBy', 'lagHold'],
    moved: { trendFund: 'qld', trendUnder: -3, trendDays: 27, fund: 'qld', rsiDays: 6, rsiLevel: 38, lagFund: 'gld', lagBy: 3.5, lagHold: 'weekend' },
    map: '72.9%, 69.5%', before: '62.3%, 99.6%', lump: '68.2%, 69.5%', since2010: '80.0%, 45.8%',
    rules: [/^Hold QLD\. In a week where QLD’s Wednesday close is under the median of the 27 closes before it, or less than 3% over it, switch to SQQQ at that close and back to QLD at Monday’s close: SQQQ is held over Thursday, Friday and Monday\./m,
      /If QLD is not under Wednesday’s close at Friday’s close, it is bought back there/, /QQQ’s RSI over 6 days is at 38 or under/,
      /still taken to the weekend, SQQQ over Thursday and Friday, when GLD’s return over 2 days is under QLD’s by more than 3\.5% at that close\./,
      /\n\nAs settings: every setting of 10-25 - Min - late-week SQQQ\.$/] },
];
const { dates } = data, at = d => dates.findIndex(x => x >= d);
const Y84 = at('1984-01-01') - 1, Y2010 = at('2010-01-04') - 1, END = at('2026-01-01') - 1;
const run = (strategy, settings = {}, { contributions = {}, initial = 100000, from = Y84 } = {}) =>
  strategy.run(data, { ...defaultsOf(strategy), ...settings, initial, contributions, startIdx: from, endIdx: END, dailyDisplay: true }).log;
const sameRows = (a, b) => a.length === b.length && a.every((row, k) => row.value === b[k].value && row.held === b[k].held && row.action === b[k].action && row.note === b[k].note);
const firstCloses = (from, amount) => Object.fromEntries(dates.slice(from + 1, END + 1).filter((date, k, all) => k === 0 || all[k - 1].slice(0, 7) !== date.slice(0, 7)).map(date => [date, amount]));
const fallOf = (log) => { let peak = 0, fall = 0; log.forEach(r => { peak = Math.max(peak, r.value); fall = Math.max(fall, 1 - r.value / peak); }); return fall; };
const years = (a, b) => (Date.parse(b) - Date.parse(a)) / (365.25 * 864e5);
const monthEnds = dates.filter((d, k) => k === dates.length - 1 || dates[k + 1].slice(0, 7) !== d.slice(0, 7)).map(d => [d]);
const lumpText = (log) => `${((Math.pow(log[log.length - 1].value / log[0].value, 1 / years(log[0].date, log[log.length - 1].date)) - 1) * 100).toFixed(1)}%, ${(fallOf(log) * 100).toFixed(1)}%`;
const withoutDefaults = text => text.replace(/, default: [^,}]+/g, '');

const stub = new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => '' : stub), apply: () => stub });
const page = { console, window: {}, document: stub, localStorage: stub, setTimeout: () => 0 };
vm.createContext(page);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'strategy-library.js'), 'utf8') + '\nthis.LIBRARY = STRATEGY_LIBRARY;', page);

for (const pick of PICKS) {
  const mine = strategyOf(pick.n), theirs = strategyOf(pick.from), tag = `#${pick.n}`;
  // ---- 1. The settings ----
  ck(`${tag}: its name, and its 10-25 entry's`, mine.name === pick.name && theirs.name === pick.fromName, `${mine.name} / ${theirs.name}`);
  const ids = settingsOf(mine).map(p => p.id);
  ck(`${tag}: the settings are #${pick.from}'s, in the same order`, ids.join() === settingsOf(theirs).map(p => p.id).join(), ids.join());
  const d = defaultsOf(mine), was = defaultsOf(theirs);
  const moved = ids.filter(id => JSON.stringify(d[id]) !== JSON.stringify(was[id]));
  ck(`${tag}: the ${Object.keys(pick.moved).length} the pick moved, and no other`, moved.slice().sort().join() === Object.keys(pick.moved).sort().join() && moved.every(id => JSON.stringify(d[id]) === JSON.stringify(pick.moved[id])),
    moved.map(id => `${id} ${JSON.stringify(was[id])} -> ${JSON.stringify(d[id])}`).join(', '));
  const byId = Object.fromEntries(settingsOf(mine).map(p => [p.id, p]));
  const isOption = (id, v) => byId[id].options.some(o => String(o && typeof o === 'object' ? o.value : o) === String(v));
  ck(`${tag}: every moved value is one of its setting's options`, Object.keys(pick.moved).every(id => isOption(id, pick.moved[id])), Object.keys(pick.moved).filter(id => !isOption(id, pick.moved[id])).join());

  // ---- 2. The 10-25 entry with the moved ones set by hand, row for row ----
  const withMoney = { ...firstCloses(Y2010, 4000), '2020-06-15': -50000 };
  ck(`${tag}, a lump sum from 1984: #${pick.from} at the pick, row for row`, sameRows(run(mine), run(theirs, pick.moved)));
  ck(`${tag}, contributions and a withdrawal: row for row`, sameRows(run(mine, {}, { contributions: withMoney, from: Y2010 }), run(theirs, pick.moved, { contributions: withMoney, from: Y2010 })));
  ck(`${tag}, a switch over two days: row for row`, sameRows(run(mine, { splitDays: true }), run(theirs, { ...pick.moved, splitDays: true })));

  // ---- 3. The code ----
  const swapped = ids.filter(id => byId[id].tip !== settingsOf(theirs).find(p => p.id === id).tip);
  ck(`${tag}: the tips swapped: ${pick.tips.join(', ') || 'none'}`, swapped.join() === pick.tips.join(), swapped.join());
  ck(`${tag}: no swapped tip quotes a year`, pick.tips.every(id => !/\b(19|20)\d\d\b/.test(byId[id].tip)), pick.tips.map(id => byId[id].tip).find(t => /\b(19|20)\d\d\b/.test(t)));
  let expected = CODE[pick.from].replace(JSON.stringify(pick.fromName), JSON.stringify(pick.name));
  for (const id of swapped) expected = expected.replace(JSON.stringify(settingsOf(theirs).find(p => p.id === id).tip), JSON.stringify(byId[id].tip));
  ck(`${tag}: the code is #${pick.from}'s but for its name, its defaults and those tips`, withoutDefaults(expected) === withoutDefaults(CODE[pick.n]));

  // ---- 4. The map's numbers ----
  // The map's rate is the chart's (cfgMoneyWeightedCAGR -> moneyWeightedCAGR in js/metrics.js): the strategy gets each
  // $3K at the month's first close, the rate counts it at the month's last. On 1984-2025 the map's own rate read 0.4 to
  // 0.5 points higher, at the pick and before alike; its drawdowns are these.
  const contributions = firstCloses(Y84, 3000);
  const mapRate = (strategy) => {
    const log = run(strategy, {}, { contributions, initial: 80000 }), final = log[log.length - 1].value;
    const rate = moneyWeightedCAGR(80000, 3000, 0, dates[Y84], dates[END], years(dates[Y84], dates[END]), final, monthEnds, 80000 + 3000 * Object.keys(contributions).length);
    return `${rate.toFixed(1)}%, ${(fallOf(log) * 100).toFixed(1)}%`;
  };
  ck(`${tag}: $80K and $3K a month on 1984-2025 at the pick: ${pick.map}`, mapRate(mine) === pick.map, mapRate(mine));
  ck(`${tag}: and before, at #${pick.from}'s: ${pick.before}`, mapRate(theirs) === pick.before, mapRate(theirs));
  ck(`${tag}: $100K once on 1984-2025: ${pick.lump}`, lumpText(run(mine)) === pick.lump, lumpText(run(mine)));
  ck(`${tag}: $100K once on 2010-2025: ${pick.since2010}`, lumpText(run(mine, {}, { from: Y2010 })) === pick.since2010, lumpText(run(mine, {}, { from: Y2010 })));

  // ---- 5. The card ----
  const card = page.LIBRARY.find(e => e.n === pick.n);
  ck(`${tag}'s card: its name, runnable`, !!card && card.name === pick.name && card.runnable === true && !card.hidden, card && card.name);
  ck(`${tag}'s card counts the settings moved`, card.rules.startsWith(`Fitted to 1984-2025: ${pick.fromName} with ${Object.keys(pick.moved).length} settings moved.\n\n`), card.rules.split('\n')[0]);
  const missing = pick.rules.filter(re => !re.test(card.rules));
  ck(`${tag}'s card gives the pick's rules`, missing.length === 0, missing.map(String).join(' | '));
  const order = page.LIBRARY.map(e => e.name), place = order.indexOf(pick.name);
  ck(`${tag} stands among the 84-25 entries`, order[place - 1].startsWith('84-25 - ') || order[place + 1].startsWith('84-25 - '), order.slice(place - 1, place + 2).join(' | '));
}

// ---- #78's lag weeks: SQQQ over Thursday and Friday, QLD back at Friday's close ----
{
  const log = run(strategyOf(78)), weekday = date => new Date(date + 'T12:00:00Z').getUTCDay();
  const weeks = log.map((row, k) => k).filter(k => /^A skipped week taken for the days before the weekend/.test(log[k].note || ''));
  const shape = k => [log[k], log[k + 1], log[k + 2]].map(r => `${weekday(r.date)}${r.held}`).join(' ');
  const full = weeks.filter(k => weekday(log[k].date) === 3 && weekday(log[k + 1].date) === 4 && weekday(log[k + 2].date) === 5);
  ck(`#78: in each of the ${full.length} lag weeks with a full Thursday and Friday, SQQQ from Wednesday's close and QLD again at Friday's`,
    full.length > 0 && full.every(k => shape(k) === '3SQQQ 4SQQQ 5QLD'), full.map(shape).filter(s => s !== '3SQQQ 4SQQQ 5QLD').join(', '));
}

console.log(failures ? `${failures} failure(s)` : 'library-84-25-picks: all checks pass');
process.exit(failures ? 1 : 0);
