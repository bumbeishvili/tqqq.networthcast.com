/*
 * Library strategy #74, "10-25 - SOXL, TQQQ" (was "SOXL, TQQQ - 2010-2025 fit"): #53 (the 1983 fit) at the user's pick on
 * the map of Q1 2010 to Q4 2025, set as the defaults on 27 November 2026 (the #74 section of js/strategy-library-code.js).
 * Pure Node — no browser/server. Checks, on the repo's own price history:
 *   1. its settings are #53's, in the same order, with 29 defaults moved and no other;
 *   2. it trades as #53 does with those 29 set by hand, row for row, with a lump sum and
 *      with contributions and a withdrawal;
 *   3. its texts are #53's but for its name and the three of the late-week trade that state
 *      facts of a strategy's own trades, and those facts are this strategy's;
 *   4. with the map's money ($80K and $3K a month, Q1 2010 to Q4 2025) its max drawdown is the map's 37.6%.
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
const MOVED = {
  lookbackDays: 579, startAvgDays: 96, topLead: 109, topDays: 9, backLead: 29, bearUnder: 25.5, bearSlope: 21, bearCloses: 40, overPct: 53.5, overWindow: 234, sqqqMaxDays: 42,
  soxlLeadDays: 340, soxlLeadEnter: -35, soxlSell: 'turn', soxlLeadExit: 150, soxlTrail: 40, soxlTrailFrom: 40, soxlPile: true, dipDay: 4, dipUnder: 34, dipUnderMax: 69, dipSellDay: 1,
  lateFund: 'soxs', lateRsiSkip: true, lateRsiDays: 6, lateRsiLevel: 41.5, lateLagDays: 17, lateLagBy: 0.5, lateTrendDays: 37,
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
  ck('29 defaults differ from #53\'s, the map pick\'s', moved.slice().sort().join() === Object.keys(MOVED).sort().join() && moved.every(id => defaults[id] === MOVED[id]), moved.map(id => id + '=' + defaults[id]).join(', '));
  const byId = Object.fromEntries(settingsOf(mine).map(param => [param.id, param]));
  const optionValues = id => byId[id].options.map(option => (option && typeof option === 'object' ? option.value : option));
  ck('each of them is one of its setting\'s own choices', Object.entries(MOVED).every(([id, value]) => optionValues(id).includes(value)));
  ck('its name, the old one kept for saved copies', mine.name === '10-25 - SOXL, TQQQ', mine.name);
}

// ---- 2. It is #53 with the 29 set by hand ----
{
  const withMoney = { ...monthly(4000), '2020-06-15': -50000 };
  ck('a lump sum: #53 with the 29 set by hand, row for row', sameRows(run(mine, {}), run(fit, MOVED)));
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
  ck('the down trend\'s tip names its 37 days', /On here, at 37 days\.$/.test(byId.lateTrend.tip), byId.lateTrend.tip);
  ck('#53\'s text keeps its own section and facts', /section: "Late-week SQQQ"/.test(CODE[FIT]) && !/Late-week SOXS/.test(CODE[FIT]) && /122 trades, 47% of them up/.test(CODE[FIT]));
}

// ---- 4. The map's numbers ----
{
  const log = run(mine, {}, monthly(3000), 80000);
  let peak = 0, fall = 0; log.forEach((row) => { peak = Math.max(peak, row.value); fall = Math.max(fall, 1 - row.value / peak); });
  ck('with $80K and $3K a month its max drawdown is the map\'s 37.6%', (fall * 100).toFixed(1) === '37.6', (fall * 100).toFixed(1) + '%');
  ck('it holds SOXS late in the week', log.some(row => row.held === 'SOXS') && !run(fit, {}).some(row => row.held === 'SOXS'));
}

console.log(failures ? `\n${failures} check(s) failed` : 'library 2010-2025 fit: all checks passed');
process.exit(failures ? 1 : 0);
