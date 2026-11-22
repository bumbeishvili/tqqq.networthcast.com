/*
 * Library strategy #71, "SOXL, TQQQ, QQQ - steady fit": #53 (the 1983 fit) with a
 * ceiling of 100%, SOXL sold at a lead over 10%, no SOXL pile, and eleven settings
 * the Fit button leaves alone (the #71 section of js/strategy-library-code.js).
 * Pure Node — no browser/server. Checks, on the repo's own price history:
 *   1. its settings are #53's less the pile's three, with two defaults changed and
 *      eleven marked fit: false, each saying so in its tip;
 *   2. it trades as #53 does with the same three changes made by hand, row for
 *      row, with a lump sum and with contributions and a withdrawal, both with
 *      the sell level both ship with and with the turn sell chosen;
 *   3. nothing of the pile is left: no column, no row value, no note, no card.
 *
 *   node tests/library-steady-fit.cjs
 */
const { data, strategyOf, settingsOf, defaultsOf } = require('./library-harness.cjs');

let failures = 0;
const ck = (name, ok, detail) => {
  if (ok) return;
  failures++;
  console.log('  FAIL  ' + name + (detail ? '   ' + detail : ''));
};

const FIT = 53, STEADY = 71;
const CEILING = 100, SOXL_EXIT = 10;   // #71's two changed defaults
const PILE_IDS = ['soxlPile', 'pileHandover', 'pileFloor'];
const LEFT_ALONE = ['topLead', 'backLead', 'bearUnder', 'bearSlope', 'bearCloses', 'sqqqMaxDays', 'nfciVeto', 'soxlSell', 'soxlLeadExit', 'soxlTrail', 'soxlTrailFrom'];
const START = data.dates.findIndex(d => d >= '2010-01-04'), END = data.dates.findIndex(d => d > '2025-12-31') - 1;
const run = (n, settings, contributions) => { const strategy = strategyOf(n); return strategy.run(data, { ...defaultsOf(strategy), ...settings, initial: 100000, contributions, startIdx: START, endIdx: END, dailyDisplay: true }); };

const fit = strategyOf(FIT), steady = strategyOf(STEADY);

// ---- 1. The settings ----
{
  const fitIds = settingsOf(fit).map(param => param.id), ids = settingsOf(steady).map(param => param.id);
  ck('its settings are #53\'s less the pile\'s three, in the same order', ids.join() === fitIds.filter(id => !PILE_IDS.includes(id)).join(), ids.join());
  ck('it has no contributions section', !steady.params.some(param => /Contributions/.test(param.section || '')));
  const fitDefaults = defaultsOf(fit), defaults = defaultsOf(steady);
  const moved = ids.filter(id => JSON.stringify(defaults[id]) !== JSON.stringify(fitDefaults[id]));
  ck('two defaults differ from #53\'s: the ceiling and the SOXL sell level', moved.join() === 'topLead,soxlLeadExit' && defaults.topLead === CEILING && defaults.soxlLeadExit === SOXL_EXIT,
    moved.map(id => `${id} ${fitDefaults[id]} -> ${defaults[id]}`).join(', '));
  // The Fit button skips a setting marked fit: false. #53 marks only its cost and execution settings.
  const skipped = strategy => settingsOf(strategy).filter(param => param.fit === false).map(param => param.id);
  ck('the Fit button leaves the eleven alone, besides what it leaves alone in #53', skipped(steady).join() === LEFT_ALONE.concat(skipped(fit)).join(), skipped(steady).join());
  const quiet = settingsOf(steady).filter(param => LEFT_ALONE.includes(param.id) && !/The Fit button leaves it alone\.$/.test(param.tip || ''));
  ck('each of the eleven says so in its tip', quiet.length === 0, quiet.map(param => param.id).join(', '));
  const loud = settingsOf(steady).filter(param => !LEFT_ALONE.includes(param.id) && /Fit button/.test(param.tip || ''));
  ck('no other tip mentions the Fit button', loud.length === 0, loud.map(param => param.id).join(', '));
}

// ---- 2. The same trades as #53 with the changes made by hand ----
{
  const BY_HAND = { topLead: CEILING, soxlLeadExit: SOXL_EXIT, soxlPile: false };
  // $4K at each month's first trading day and one withdrawal, so contributions and a sale to cover both happen.
  const monthly = Object.fromEntries(data.dates.slice(START + 1, END + 1).filter((date, k, all) => k === 0 || all[k - 1].slice(0, 7) !== date.slice(0, 7)).map(date => [date, 4000]));
  const withMoney = { ...monthly, '2020-06-15': -50000 };
  // Both ways of selling SOXL: the level both ship with, where the 10% acts, and the turn sell, where the level is idle.
  const SELLS = [['the sell level', {}], ['the turn sell', { soxlSell: 'turn' }]];
  SELLS.flatMap(([sell, how]) => [[`${sell}, a lump sum`, how, {}], [`${sell}, contributions and a withdrawal`, how, withMoney]]).forEach(([tag, how, contributions]) => {
    const mine = run(STEADY, how, contributions), theirs = run(FIT, { ...BY_HAND, ...how }, contributions);
    const differing = mine.log.filter((row, k) => { const other = theirs.log[k] || {}; return ['date', 'value', 'held', 'action', 'note'].some(key => row[key] !== other[key]); });
    ck(`${tag}: every row matches #53 changed by hand`, mine.log.length === theirs.log.length && differing.length === 0, `${differing.length} rows differ, first ${differing.slice(0, 3).map(row => row.date).join(', ')}`);
    ck(`${tag}: the holdings match too`, JSON.stringify(mine.holdings) === JSON.stringify(theirs.holdings));
    ck(`${tag}: it traded`, mine.log.filter(row => row.action === 'buy' || row.action === 'sell').length > 100);
  });
  // The changes are real ones: #53 as shipped ends somewhere else.
  const end = log => log[log.length - 1].value;
  ck('it does not end where #53 ends', end(run(STEADY, {}, {}).log) !== end(run(FIT, {}, {}).log));
  ck('its 10% sell level makes it end somewhere else than #53 with the ceiling alone changed', end(run(STEADY, {}, {}).log) !== end(run(FIT, { topLead: CEILING }, {}).log));
  ck('the pile would have changed the result with contributions', end(run(STEADY, {}, withMoney).log) !== end(run(FIT, { topLead: CEILING, soxlLeadExit: SOXL_EXIT }, withMoney).log));
}

// ---- 3. Nothing of the pile is left ----
{
  const withMoney = Object.fromEntries(data.dates.slice(START + 1, START + 400).filter((date, k) => k % 21 === 0).map(date => [date, 4000]));
  const mine = run(STEADY, {}, withMoney), theirs = run(FIT, {}, withMoney);
  const pileColumns = strategy => strategy.columns.filter(column => /pile/i.test(column.key + ' ' + column.label)).map(column => column.key);
  ck('#53 has the pile\'s columns, so the check below can fail', pileColumns(fit).length === 2, pileColumns(fit).join());
  ck('it has no pile column', pileColumns(steady).length === 0, pileColumns(steady).join());
  ck('#53\'s rows carry a pile, so the check below can fail', theirs.log.some(row => row.soxlPile > 0) && theirs.log.some(row => /pile/i.test(row.note || '')));
  ck('no row carries a pile value or names the pile', !mine.log.some(row => row.soxlPile != null || row.soxlPut != null || /pile/i.test(row.note || '')));
  const cardLabels = result => ((result.signals || {}).cards || []).map(card => card.label);
  ck('#53\'s dashboard has the pile\'s card, so the check below can fail', cardLabels(theirs).includes('SOXL pile'), cardLabels(theirs).join(', '));
  ck('its dashboard has no pile card and keeps the SOXL one', !cardLabels(mine).includes('SOXL pile') && cardLabels(mine).includes('SOXL instead of TQQQ'), cardLabels(mine).join(', '));
}

console.log(failures ? `\n${failures} check(s) failed` : 'library steady fit: all checks passed');
process.exit(failures ? 1 : 0);
