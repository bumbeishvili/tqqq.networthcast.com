/*
 * The bear exit of library strategy #53 (withBearExit in js/strategy-library-code.js),
 * which sells in place of the floor: cash from the first close a set share under
 * TQQQ's median while the median has stopped rising and TQQQ has closed under it
 * for days in a row, back in at the first close above that level.
 * Pure Node — no browser/server. Checks, on the repo's own price history:
 *   1. #53 has the exit's three settings and none of the floor's;
 *   2. the exit is on at the same closes as the price exit of the NFCI strategy
 *      (#44), which it copies, given the same median window and numbers: two
 *      separate implementations in the library;
 *   3. while it is on, #53 holds no TQQQ or SOXL except the one-day trades of
 *      its idle cash;
 *   4. off, it never sells, and the bare floor and the bare deep buy still run
 *      the floor that #53 used to have.
 *
 *   node tests/library-bear-exit.cjs
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'js/data.js'), 'utf8'));   // parseDataFile, buildDaily, buildNfciDaily
const CODE = require(path.join(ROOT, 'js/strategy-library-code.js'));

let failures = 0;
const ck = (name, ok, detail) => {
  if (ok) return;
  failures++;
  console.log('  FAIL  ' + name + (detail ? '   ' + detail : ''));
};

// ---- data: the same arrays the app hands a custom strategy (buildCustomData) ----
const TICKERS = ['tqqq', 'qqq', 'spy', 'qld', 'sso', 'spxl', 'sqqq', 'gld', 'soxl', 'soxx'];
const series = file => parseDataFile(fs.readFileSync(path.join(ROOT, 'data', file), 'utf8'));
const daily = buildDaily(series('synthetic-qqq.tsv'), series('synthetic-tqqq.tsv'), series('spy.tsv'),
  series('synthetic-qld.tsv'), series('synthetic-sso.tsv'), series('synthetic-spxl.tsv'), series('synthetic-sqqq.tsv'),
  series('synthetic-gld.tsv'), series('synthetic-soxl.tsv'), series('synthetic-soxx.tsv'));
const data = {
  dates: daily.map(d => d.date),
  nfci: buildNfciDaily(daily, series('nfci.tsv')),
  ...buildHighLowDaily(daily, Object.fromEntries(HIGH_LOW_FUNDS.map(f => [f, parseHighLowFile(fs.readFileSync(path.join(ROOT, 'data', f + '-hl.tsv'), 'utf8'))]))),
  ...Object.fromEntries(TICKERS.map(t => [t, daily.map(d => d[t] || 0)])),
};

const FIT = 53, NFCI = 44, BARE_FLOOR = 65, BARE_DEEP_BUY = 66;
const strategyOf = n => new Function('"use strict"; return (' + CODE[n] + '\n);')();
const defaultOf = param => (param.default && typeof param.default === 'object' && 'value' in param.default) ? param.default.value : param.default;
const defaultsOf = strategy => Object.fromEntries(strategy.params.filter(param => param.id != null).map(param => [param.id, defaultOf(param)]));
// Settled history with the bear market of 2022 and the fast crash of 2020 in it.
const START = data.dates.findIndex(d => d >= '2010-01-04'), END = data.dates.findIndex(d => d > '2025-12-31') - 1;
const run = (n, settings = {}) => { const strategy = strategyOf(n); return strategy.run(data, { ...defaultsOf(strategy), ...settings, initial: 100000, contributions: {}, startIdx: START, endIdx: END, dailyDisplay: true }); };

const fit = strategyOf(FIT), fitDefaults = defaultsOf(fit), ids = fit.params.filter(param => param.id != null).map(param => param.id);

// ---- 1. The settings ----
{
  const FLOOR_IDS = ['floorLead', 'floorHold', 'floorBackDays', 'floorBackOver', 'floorBackCloses', 'reentryLead', 'reentryCloses', 'deepLead', 'deepGuard'];
  ck('#53 has the bear exit\'s three settings', ['bearUnder', 'bearSlope', 'bearCloses'].every(id => ids.includes(id)));
  ck('#53 has none of the floor\'s settings', FLOOR_IDS.every(id => !ids.includes(id)), FLOOR_IDS.filter(id => ids.includes(id)).join(', '));
  ck('#53 has no floor section', !fit.params.some(param => /Floor/.test(param.section || '')));
  ck('the exit is on by default', fitDefaults.bearUnder > 0, 'bearUnder ' + fitDefaults.bearUnder);
}

// ---- 2. On at the same closes as the NFCI strategy's price exit ----
// The NFCI strategy with #53's median window and the exit's own numbers; its rows carry zone "crash" while its exit is on.
const twin = settings => run(NFCI, { window: fitDefaults.overWindow, stat: 'median', exitPct: -settings.bearUnder, slopeGate: settings.bearSlope, belowGate: settings.bearCloses });
// The NFCI strategy's own numbers and two others. A limit of exactly 0% on the median's rise is left out: the
// two engines' medians differ in their last decimals, and while the median is flat that decides the day.
const NFCI_EXIT = { ...fitDefaults, bearUnder: 28, bearSlope: 20, bearCloses: 10 };
[NFCI_EXIT, { ...fitDefaults, bearUnder: 20, bearSlope: 10, bearCloses: 0 }, { ...fitDefaults, bearUnder: 35, bearSlope: 999, bearCloses: 20 }].forEach(settings => {
  const tag = `exit ${settings.bearUnder}% / ${settings.bearSlope} / ${settings.bearCloses}:`;
  const mine = run(FIT, settings).log, theirs = twin(settings).log;
  const differing = mine.filter((row, k) => (row.bearOut === 1) !== (theirs[k].zone === 'crash'));
  ck(`${tag} on at the NFCI strategy's closes`, mine.length === theirs.length && differing.length === 0, `${differing.length} closes differ, first ${differing.slice(0, 3).map(row => row.date).join(', ')}`);
  ck(`${tag} it was on at some close`, mine.some(row => row.bearOut === 1));
});

// ---- 3. What is held while the exit is on ----
{
  const log = run(FIT).log, on = log.filter(row => row.bearOut === 1);
  ck('the exit was on through most of 2022', on.filter(row => row.date.startsWith('2022')).length > 150, on.filter(row => row.date.startsWith('2022')).length + ' closes');
  ck('the exit stayed off in the crash of March 2020', !on.some(row => row.date.startsWith('2020-03')));
  // Idle cash is traded for a few days at a time by Turnaround Monday, Big days and the month-end dip, which
  // holds TQQQ over each month end of a long decline: a stretch in a fund is days long, never weeks.
  const invested = on.filter(row => row.held !== 'CASH');
  const LONGEST_IDLE_TRADE = 10;   // closes: a month-end dip (five) with a Monday trade on either side
  const stretches = log.reduce((runs, row) => {
    if (row.bearOut === 1 && row.held !== 'CASH') runs[runs.length - 1]++; else if (runs[runs.length - 1] > 0) runs.push(0);
    return runs;
  }, [0]);
  ck('while it is on, the money is in cash but for short trades of the idle cash',
    invested.length < on.length / 2 && invested.every(row => row.held === 'TQQQ') && Math.max(...stretches) <= LONGEST_IDLE_TRADE,
    `${invested.length} of ${on.length} closes in a fund: ${[...new Set(invested.map(row => row.held))].join(', ')}; longest stretch ${Math.max(...stretches)} closes`);
  // At the NFCI strategy's numbers the exit comes on several times, some of them while a fund is held. With SOXL
  // left out, so the buy at its end is TQQQ's own: a SOXL buy gives SOXL's lead as its reason.
  const traded = run(FIT, { ...NFCI_EXIT, soxlWhen: 'never' }).log;
  const sale = traded.find(row => row.action === 'sell' && /bear exit/.test(row.note));
  ck('a sale names the bear exit', !!sale, sale ? sale.date + ' ' + sale.note : 'none');
  const back = traded.find(row => row.action === 'buy' && /bear exit over/.test(row.note));
  ck('a buy-back names the end of the bear exit', !!back, back ? back.date + ' ' + back.note : 'none');
  ck('the level is drawn while the median exists', log.filter(row => row.bearLine > 0).length === log.length);
  // What arms the exit has a chart panel of its own: the median's rise against the limit it has to be under.
  const armLines = run(FIT).lines.filter(line => line.group === 'Bear exit').map(line => line.key);
  ck('the median\'s rise and its limit share a panel', armLines.join() === 'medianRise,bearRiseLimit', armLines.join());
  const firstCloses = log.filter((row, k) => row.bearOut === 1 && (k === 0 || log[k - 1].bearOut !== 1));
  ck('the exit comes on only with the median\'s rise under the limit', firstCloses.length > 0 && firstCloses.every(row => row.medianRise < row.bearRiseLimit),
    firstCloses.filter(row => !(row.medianRise < row.bearRiseLimit)).map(row => row.date + ' ' + row.medianRise).join(', '));
  ck('with no limit on the rise the panel is gone', !run(FIT, { bearSlope: 999 }).lines.some(line => line.group === 'Bear exit'));
}

// ---- 4. Off, and the bare entries ----
{
  const off = run(FIT, { bearUnder: 0 });
  ck('off: it is never on and its line is gone', off.log.every(row => row.bearOut !== 1 && row.bearLine == null) && !off.lines.some(line => line.key === 'bearLine'));
  const cashIn2022 = log => log.filter(row => row.date.startsWith('2022') && row.held === 'CASH').length;
  ck('off: the decline of 2022 is spent mostly in the market', cashIn2022(off.log) < cashIn2022(run(FIT).log) / 2, `${cashIn2022(off.log)} closes in cash off, ${cashIn2022(run(FIT).log)} on`);
  const floorIds = strategyOf(BARE_FLOOR).params.filter(param => param.id != null).map(param => param.id);
  ck('the bare floor keeps the floor\'s settings', ['floorLead', 'floorBackDays', 'reentryLead', 'reentryCloses'].every(id => floorIds.includes(id)), floorIds.join(', '));
  ck('the bare floor still sells at its floor', run(BARE_FLOOR).log.some(row => row.action === 'sell'));
  ck('the bare deep buy still buys', run(BARE_DEEP_BUY).log.some(row => row.action === 'buy'));
}

console.log(failures ? `\n${failures} check(s) failed` : 'library bear exit: all checks passed');
process.exit(failures ? 1 : 0);
