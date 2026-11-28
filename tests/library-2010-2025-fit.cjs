/*
 * Library strategy #74, "10-25 - SOXL, TQQQ" (was "SOXL, TQQQ - 2010-2025 fit"): #53 (the 1983 fit) at the user's pick on
 * the map of Q1 2010 to Q4 2025, set as the defaults on 27 November 2026 (the #74 section of js/strategy-library-code.js).
 * Pure Node — no browser/server. Checks, on the repo's own price history:
 *   1. its settings are #53's, in the same order, with 33 defaults moved and no other (29 until 28 November 2026);
 *   2. it trades as #53 does with those 33 set by hand, row for row, with a lump sum and
 *      with contributions and a withdrawal;
 *   3. its texts are #53's but for its name and the three of the late-week trade that state
 *      facts of a strategy's own trades, and those facts are this strategy's;
 *   4. with the map's money ($80K and $3K a month, Q1 2010 to Q4 2025) its max drawdown is 37.9%, and its money-weighted rate 387.8%;
 *   5. $100K once, the map's numbers: 383.3% a year, max drawdown 39.9%;
 *   6. the card's late-week sentence names the Tuesday sale.
 *
 *   node tests/library-2010-2025-fit.cjs
 */
const { CODE, data, strategyOf, settingsOf, defaultsOf } = require('./library-harness.cjs');

let failures = 0;
const ck = (name, ok, detail) => {
  if (ok) return;
  failures++;
  console.log('  FAIL  ' + name + (detail ? '   ' + detail : ''));
};

const FIT = 53, FIT_2010 = 74;
// The settings that are not #53's defaults, at the map pick.
// Since 28 November 2026 the user's second pick that day on that map ("found even better"): 33 of them.
const MOVED = {
  lookbackDays: 500, startAvgDays: 67, topLead: 133, topDays: 20, backLead: 21, bearUnder: 28, bearSlope: 0, bearCloses: 40, overPct: 56, overWindow: 253, sqqqMaxDays: 85, nfciVeto: 1.22,
  soxlLeadDays: 340, soxlLeadEnter: -35, soxlSell: 'turn', soxlLeadExit: 150, soxlTrail: 50, soxlTrailFrom: 0, soxlPile: true, bigRise: 8.5, bigDrop: 16.5, dipDay: 4, dipUnder: 51.5, dipUnderMax: 73.5,
  lateFund: 'soxs', lateBackDay: 2, lateRsiSkip: true, lateRsiDays: 18, lateRsiLevel: 42, lateLagDays: 15, lateLagBy: 1, lateTrend: false, lateTrendDays: 37,
};
const COUNT = Object.keys(MOVED).length;
const { dates } = data;
const START = dates.findIndex(d => d >= '2010-01-04') - 1, END = dates.findIndex(d => d > '2025-12-31') - 1;
const fit = strategyOf(FIT), mine = strategyOf(FIT_2010);
const run = (strategy, settings, contributions = {}, initial = 100000) => strategy.run(data, { ...defaultsOf(strategy), ...settings, initial, contributions, startIdx: START, endIdx: END, dailyDisplay: true }).log;
const sameRows = (a, b) => a.length === b.length && a.every((row, k) => row.value === b[k].value && row.held === b[k].held && row.action === b[k].action && row.note === b[k].note);
// A contribution at the first close of each month after the entry.
const monthly = amount => Object.fromEntries(dates.slice(START + 1, END + 1).filter((date, k, all) => k === 0 || all[k - 1].slice(0, 7) !== date.slice(0, 7)).map(date => [date, amount]));

// ---- 1. The settings ----
{
  const fitIds = settingsOf(fit).map(param => param.id), ids = settingsOf(mine).map(param => param.id);
  ck('its settings are #53\'s, in the same order', ids.join() === fitIds.join(), ids.join());
  const fitDefaults = defaultsOf(fit), defaults = defaultsOf(mine);
  const moved = ids.filter(id => JSON.stringify(defaults[id]) !== JSON.stringify(fitDefaults[id]));
  ck(`${COUNT} defaults differ from #53's, the map pick's`, moved.slice().sort().join() === Object.keys(MOVED).sort().join() && moved.every(id => defaults[id] === MOVED[id]), moved.map(id => id + '=' + defaults[id]).join(', '));
  const byId = Object.fromEntries(settingsOf(mine).map(param => [param.id, param]));
  const optionValues = id => byId[id].options.map(option => (option && typeof option === 'object' ? option.value : option));
  ck('each of them is one of its setting\'s own choices', Object.entries(MOVED).every(([id, value]) => optionValues(id).includes(value)));
  ck('its name, the old one kept for saved copies', mine.name === '10-25 - SOXL, TQQQ', mine.name);
}

// ---- 2. It is #53 with the 33 set by hand ----
{
  const withMoney = { ...monthly(4000), '2020-06-15': -50000 };
  ck(`a lump sum: #53 with the ${COUNT} set by hand, row for row`, sameRows(run(mine, {}), run(fit, MOVED)));
  ck('contributions and a withdrawal: the same', sameRows(run(mine, {}, withMoney), run(fit, MOVED, withMoney)));
  ck('with #53\'s own values put back by hand it is #53', sameRows(run(mine, Object.fromEntries(Object.keys(MOVED).map(id => [id, defaultsOf(fit)[id]]))), run(fit, {})));
  ck('and the two differ at their defaults, so the checks above can fail', !sameRows(run(mine, {}), run(fit, {})));
}

// ---- 3. The texts ----
{
  // Every text of a setting or a section, by its place: a setting's label, sentence and tip, a section's name and tip.
  const texts = strategy => strategy.params.map(param => [param.id || 'section', param.section || param.label, param.text || '', param.tip || '']);
  const a = texts(mine), b = texts(fit);
  const changed = a.map((row, k) => (row.join('|') === b[k].join('|') ? null : row[0] === 'section' ? 'section ' + row[1] : row[0])).filter(Boolean);
  ck('only the late-week section, its weekend check and its down trend read differently from #53\'s', changed.join() === 'section Late-week SOXS,lateWeekend,lateTrend', changed.join());
  const section = mine.params.find(param => param.section === 'Late-week SOXS'), byId = Object.fromEntries(settingsOf(mine).map(param => [param.id, param]));
  // The facts the three state, from this strategy's own run (lump sum, Q1 2010 to Q4 2025).
  const log = run(mine, {}), late = []; let open = null, at = d => dates.findIndex(x => x >= d);
  log.forEach((r, k) => { if (r.lateTrade && !open) open = { from: k }; if (!r.lateTrade && open) { late.push({ ...open, to: k }); open = null; } });
  const g = late.map(t => data.soxs[at(log[t.to].date)] / data.soxs[at(log[t.from].date)] - 1);
  const avg = (100 * g.reduce((s, v) => s + v, 0) / g.length).toFixed(1), up = Math.round(100 * g.filter(v => v > 0).length / g.length);
  ck(`the late-week section is named for its fund and counts this strategy's own trades: ${late.length}, ${up}% up, ${avg}% each`, !!section && section.tip.includes(`${late.length} trades, ${up}% of them up, ${avg}% each on average`), section && section.tip);
  const T = data.tqqq, wd = dates.map(ds => new Date(ds + 'T12:00:00Z').getUTCDay()), rows = new Map(run(mine, { lateWeekend: false }).map(r => [r.date, r])), under = [], over = [];
  for (let i = START; i < END; i++) if (wd[i] === 3 && rows.get(dates[i]) && rows.get(dates[i]).lateTrade && wd[i + 1] === 4 && wd[i + 2] === 5 && wd[i + 3] === 1) (T[i + 2] < T[i] ? under : over).push(T[i + 3] / T[i + 2] - 1);
  const mean = xs => 100 * xs.reduce((s, v) => s + v, 0) / xs.length, signed = v => (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
  ck(`the weekend check's tip gives this strategy's Mondays: ${mean(under).toFixed(2)}%, ${mean(over).toFixed(2)}%`, byId.lateWeekend.tip.includes(`TQQQ fell ${(-mean(under)).toFixed(2)}% on average on the Monday after such a close and moved ${signed(mean(over))} after the others.`), byId.lateWeekend.tip);
  ck('the down trend\'s tip says it is off here', /Off here\.$/.test(byId.lateTrend.tip), byId.lateTrend.tip);
  ck('#53\'s text keeps its own section and facts', /section: "Late-week SQQQ"/.test(CODE[FIT]) && !/Late-week SOXS/.test(CODE[FIT]) && /122 trades, 47% of them up/.test(CODE[FIT]));
}

// ---- 4. The map's numbers ----
{
  const log = run(mine, {}, monthly(3000), 80000);
  let peak = 0, fall = 0; log.forEach((row) => { peak = Math.max(peak, row.value); fall = Math.max(fall, 1 - row.value / peak); });
  ck('with $80K and $3K a month its max drawdown is 37.9%', (fall * 100).toFixed(1) === '37.9', (fall * 100).toFixed(1) + '%');
  // The map's rate is the chart's (cfgMoneyWeightedCAGR -> moneyWeightedCAGR): the money counted at the month-end rows.
  const { moneyWeightedCAGR } = require('../js/metrics.js');
  const monthEnds = dates.filter((d, k) => k === dates.length - 1 || dates[k + 1].slice(0, 7) !== d.slice(0, 7)).map(d => [d]);
  const paid = Object.keys(monthly(3000)).length, years = (Date.parse(dates[END]) - Date.parse(dates[START])) / (365.25 * 864e5);
  const rate = moneyWeightedCAGR(80000, 3000, 0, dates[START], dates[END], years, log[log.length - 1].value, monthEnds, 80000 + 3000 * paid);
  ck('and its money-weighted rate 387.8% a year', rate.toFixed(1) === '387.8', rate.toFixed(1) + '%');
  // $100K once, as the map ran it.
  const lump = run(mine, {}), lumpYears = (Date.parse(lump[lump.length - 1].date) - Date.parse(lump[0].date)) / (365.25 * 864e5);
  let top = 0, lumpFall = 0; lump.forEach((row) => { top = Math.max(top, row.value); lumpFall = Math.max(lumpFall, 1 - row.value / top); });
  const lumpText = ((Math.pow(lump[lump.length - 1].value / lump[0].value, 1 / lumpYears) - 1) * 100).toFixed(1) + '%, ' + (lumpFall * 100).toFixed(1) + '%';
  ck('$100K once: the map\'s 383.3%, 39.9%', lumpText === '383.3%, 39.9%', lumpText);
  ck('it holds SOXS late in the week', log.some(row => row.held === 'SOXS') && !run(fit, {}).some(row => row.held === 'SOXS'));
}

// ---- 6. The card ----
{
  const fs = require('fs'), path = require('path'), vm = require('vm');
  const stub = new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => '' : stub), apply: () => stub });
  const page = { console, window: {}, document: stub, localStorage: stub, setTimeout: () => 0 };
  vm.createContext(page);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'strategy-library.js'), 'utf8') + '\nthis.LIBRARY = STRATEGY_LIBRARY;', page);
  const card = page.LIBRARY.find(entry => entry.n === FIT_2010), other = page.LIBRARY.find(entry => entry.n === 53);
  ck('the card\'s late-week sentence names the Tuesday sale', card.rules.includes('hold SOXS from Wednesday’s close to Tuesday’s, and over the weekend only if TQQQ ends Friday under that Wednesday’s close.'), card.rules.match(/Late-week SOXS:[^\n]*/)[0]);
  ck('the 1983 fit\'s card keeps Monday', other.rules.includes('from Wednesday’s close to Monday’s'));
  ck(`the card counts the ${COUNT} settings moved`, card.rules.startsWith(`Fitted to 2010-2025: SOXL, TQQQ, QQQ - 1983 fit with ${COUNT} settings moved.`), card.rules.split('\n')[0]);
}

console.log(failures ? `\n${failures} check(s) failed` : 'library 2010-2025 fit: all checks passed');
process.exit(failures ? 1 : 0);
