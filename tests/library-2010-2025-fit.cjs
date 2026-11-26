/*
 * Library strategy #74, "10-25 - SOXL, TQQQ" (was "SOXL, TQQQ - 2010-2025 fit"): #53 (the 1983 fit) at the settings of the
 * user's copy after a fit on Q1 2010 to Q4 2025 (the #74 section of js/strategy-library-code.js).
 * Pure Node — no browser/server. Checks, on the repo's own price history:
 *   1. its settings are #53's, in the same order, with sixteen defaults moved and no other:
 *      fifteen to the panel's values, and "back at" to 40% where the panel had 30% (the user,
 *      the same day: "ok do 40%");
 *   2. it trades as #53 does with those sixteen set by hand, row for row, with a lump sum and
 *      with contributions and a withdrawal;
 *   3. its texts are #53's but for its name and the three of the late-week trade that state
 *      facts of a strategy's own trades;
 *   4. with the panel's "back at" 30% and the user's money ($80K and $3K a month from Q1 2010 to
 *      Q4 2025) it ends where the user's panel did: $532.0T, a 47.2% drawdown from 24 April to 31 May 2019.
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
// The settings that are not #53's defaults: the fifteen of the user's panel, and "back at" 40% (the panel's was #53's 30%).
const PANEL_BACK_AT = 30;
const MOVED = {
  startAvgDays: 60, topDays: 10, backLead: 40, bearUnder: 25, bearSlope: 0, sqqqMaxDays: 0, soxlLeadDays: 360, soxlLeadEnter: -20, soxlLeadExit: 150,
  bigRise: 8.5, dipDay: 10, dipSellDay: 1, lateFund: 'soxs', lateRsiSkip: true, lateRsiDays: 7, lateTrendDays: 45,
};
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
  ck('sixteen defaults differ from #53\'s: the panel\'s fifteen and back at 40%', moved.slice().sort().join() === Object.keys(MOVED).sort().join() && moved.every(id => defaults[id] === MOVED[id]), moved.map(id => id + '=' + defaults[id]).join(', '));
  const byId = Object.fromEntries(settingsOf(mine).map(param => [param.id, param]));
  const optionValues = id => byId[id].options.map(option => (option && typeof option === 'object' ? option.value : option));
  ck('each of them is one of its setting\'s own choices', Object.entries(MOVED).every(([id, value]) => optionValues(id).includes(value)));
  ck('its name, the old one kept for saved copies', mine.name === '10-25 - SOXL, TQQQ', mine.name);
}

// ---- 2. It is #53 with the fifteen set by hand ----
{
  const withMoney = { ...monthly(4000), '2020-06-15': -50000 };
  ck('a lump sum: #53 with the sixteen set by hand, row for row', sameRows(run(mine, {}), run(fit, MOVED)));
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
  ck('the late-week section is named for its fund and counts this strategy\'s own trades', !!section && /67 trades, 66% of them up, 7\.6% each/.test(section.tip), section && section.tip);
  ck('the weekend check\'s tip gives this strategy\'s Mondays', /TQQQ fell 2\.30% on average on the Monday after such a close and moved \+1\.41% after the others\./.test(byId.lateWeekend.tip), byId.lateWeekend.tip);
  ck('the down trend\'s tip names its 45 days', /On here, at 45 days\.$/.test(byId.lateTrend.tip), byId.lateTrend.tip);
  ck('#53\'s text keeps its own section and facts', /section: "Late-week SQQQ"/.test(CODE[FIT]) && !/Late-week SOXS/.test(CODE[FIT]) && /122 trades, 47% of them up/.test(CODE[FIT]));
}

// ---- 4. The user's panel ----
{
  const log = run(mine, { backLead: PANEL_BACK_AT }, monthly(3000), 80000);
  let peak = 0, fall = 0, from = '', to = '', top = '';
  log.forEach((row) => { if (row.value > peak) { peak = row.value; top = row.date; } const f = 1 - row.value / peak; if (f > fall) { fall = f; from = top; to = row.date; } });
  const end = log[log.length - 1].value;
  ck('with back at 30%, $80K and $3K a month it ends at the panel\'s $532.0T', (end / 1e12).toFixed(1) === '532.0', '$' + (end / 1e12).toFixed(1) + 'T');
  ck('with the panel\'s drawdown, 47.2% from 24 April to 31 May 2019', (fall * 100).toFixed(1) === '47.2' && from === '2019-04-24' && to === '2019-05-31', (fall * 100).toFixed(1) + '% ' + from + ' to ' + to);
  ck('it holds SOXS late in the week', log.some(row => row.held === 'SOXS') && !run(fit, {}).some(row => row.held === 'SOXS'));
}

console.log(failures ? `\n${failures} check(s) failed` : 'library 2010-2025 fit: all checks passed');
process.exit(failures ? 1 : 0);
