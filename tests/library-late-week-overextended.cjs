/*
 * Library strategy #73, "Late-week + overextended SQQQ": #72 (Min - late-week SQQQ) with the
 * overextended line of the fits as one more rule (withOverextendedLine in
 * js/strategy-library-code.js). Pure Node — no browser/server. Checks, on the repo's
 * own price history:
 *   1. its settings are #72's with the line's five in a section of their own, before
 *      the execution section, and #72's defaults untouched;
 *   2. with the rule off it trades as #72 does, row for row: a lump sum,
 *      contributions and a withdrawal, one trade per day;
 *   3. at its defaults it holds, at every close, the line's fund where the line says
 *      so or #72 holds it, and #72's fund otherwise; with cash over the line, #72's
 *      days in its fund held in between come first;
 *   4. the line's reading is #71's own on every close, and the account is those
 *      holdings replayed from the closes with the entry's books;
 *   5. a run without the line's settings is a run at their defaults;
 *   6. the line's trades are marked in its panel and say why, and the dashboard
 *      carries its card and its reading in today's call.
 *
 *   node tests/library-late-week-overextended.cjs
 */
const { data, strategyOf, settingsOf, defaultsOf } = require('./library-harness.cjs');

let failures = 0;
const ck = (name, ok, detail) => {
  if (ok) return;
  failures++;
  console.log('  FAIL  ' + name + (detail ? '   ' + detail : ''));
};

const MIN = 72, OVER = 73, STEADY = 71;
const OVER_IDS = ['overTake', 'overFund', 'overPct', 'overWindow', 'overHold'];
const LEVEL = 55, DAYS = 255;   // the line's defaults
const { dates, tqqq: T } = data;
const START = dates.findIndex(d => d >= '2010-01-04') - 1, END = dates.findIndex(d => d >= '2026-11-23');
const run = (n, settings = {}, contributions = {}) => { const strategy = strategyOf(n); return strategy.run(data, { ...defaultsOf(strategy), ...settings, initial: 100000, contributions, startIdx: START, endIdx: END, dailyDisplay: true }); };
const sameRows = (mine, theirs) => mine.length === theirs.length && mine.every((row, k) => row.value === theirs[k].value && row.held === theirs[k].held && row.action === theirs[k].action && row.note === theirs[k].note);

const min = strategyOf(MIN), over = strategyOf(OVER);

// ---- 1. The settings ----
{
  const minIds = settingsOf(min).map(param => param.id), ids = settingsOf(over).map(param => param.id);
  ck('its settings are #72\'s and the line\'s five', ids.filter(id => !OVER_IDS.includes(id)).join() === minIds.join() && OVER_IDS.every(id => ids.includes(id)), ids.join());
  const sections = over.params.filter(param => param.section).map(param => param.section);
  ck('the line has a section of its own, before the execution section', sections.join(' | ') === 'Overextended | Execution & costs', sections.join(' | '));
  const at = over.params.findIndex(param => param.section === 'Overextended');
  ck('the five follow that section in order', over.params.slice(at + 1, at + 6).map(param => param.id).join() === OVER_IDS.join());
  const minDefaults = defaultsOf(min), defaults = defaultsOf(over);
  ck('#72\'s defaults are untouched', minIds.every(id => JSON.stringify(defaults[id]) === JSON.stringify(minDefaults[id])));
  ck('the line\'s defaults: on, TQQQ, 55% over the 255-day median, SQQQ', JSON.stringify(OVER_IDS.map(id => defaults[id])) === JSON.stringify([true, 'tqqq', LEVEL, DAYS, 'sqqq']), JSON.stringify(OVER_IDS.map(id => defaults[id])));
  const byId = Object.fromEntries(settingsOf(over).map(param => [param.id, param]));
  ck('the four that belong to the rule show only while it is on', OVER_IDS.slice(1).every(id => JSON.stringify(byId[id].when) === '{"overTake":true}'));
  ck('the level has no Off choice: the rule\'s own setting switches it', !byId.overPct.options.some(option => option && option.label === 'Off') && byId.overPct.options.length > 100);
  ck('every setting of the line has a tip and a sentence', OVER_IDS.every(id => byId[id].tip && /\{\}/.test(byId[id].text)));
}

// ---- 2. With the rule off it is #72 ----
{
  const monthly = Object.fromEntries(dates.slice(START + 1, END + 1).filter((date, k, all) => k === 0 || all[k - 1].slice(0, 7) !== date.slice(0, 7)).map(date => [date, 4000]));
  const withMoney = { ...monthly, '2020-06-15': -50000 };
  [['a lump sum', {}, {}], ['contributions and a withdrawal', {}, withMoney], ['one trade per day', { splitDays: true }, {}], ['cash in between', { park: 'cash' }, withMoney]].forEach(([tag, settings, contributions]) => {
    ck(`rule off, ${tag}: #72 row for row`, sameRows(run(OVER, { ...settings, overTake: false }, contributions).log, run(MIN, settings, contributions).log));
  });
  ck('rule off: no panel, no card, #72\'s call', (() => { const mine = run(OVER, { overTake: false }), theirs = run(MIN);
    return JSON.stringify(mine.lines) === JSON.stringify(theirs.lines) && JSON.stringify(mine.signals) === JSON.stringify(theirs.signals); })());
}

// The line's state at every close, worked out here from the closes alone: the median of the last `days` closes, today's included.
const overAt = (() => {
  const state = new Uint8Array(dates.length), rel = new Float64Array(dates.length).fill(NaN);
  for (let i = DAYS - 1; i < dates.length; i++) {
    const sorted = Array.from(T.slice(i - DAYS + 1, i + 1)).sort((a, b) => a - b);
    if (!(sorted[0] > 0)) continue;
    rel[i] = (T[i] / sorted[(DAYS - 1) / 2] - 1) * 100;   // 255 closes: the middle one
    state[i] = rel[i] > LEVEL ? 1 : 0;
  }
  return { state, rel };
})();
const index = Object.fromEntries(dates.map((date, i) => [date, i]));
const minHeld = Object.fromEntries(run(MIN).log.map(row => [index[row.date], row.held]));

// ---- 3. The holdings ----
{
  const mine = run(OVER).log;
  ck('a row for every close', mine.length === END - START + 1, mine.length + ' rows');
  const wrong = mine.filter(row => row.held !== (overAt.state[index[row.date]] || minHeld[index[row.date]] === 'SQQQ' ? 'SQQQ' : 'TQQQ'));
  ck('SQQQ where the line says so or #72 holds it, TQQQ otherwise', wrong.length === 0, wrong.slice(0, 3).map(row => row.date + ' ' + row.held).join(', '));
  ck('the line and #72 do act, so the check above can fail', mine.some(row => overAt.state[index[row.date]] && minHeld[index[row.date]] === 'TQQQ') && mine.some(row => !overAt.state[index[row.date]] && minHeld[index[row.date]] === 'SQQQ'));
  const cash = run(OVER, { overHold: 'cash' }).log;
  const wrongCash = cash.filter(row => row.held !== (minHeld[index[row.date]] === 'SQQQ' ? 'SQQQ' : overAt.state[index[row.date]] ? 'CASH' : 'TQQQ'));
  ck('cash over the line: #72\'s SQQQ days come first', wrongCash.length === 0 && cash.some(row => row.held === 'CASH') && cash.some(row => overAt.state[index[row.date]] && row.held === 'SQQQ'), wrongCash.slice(0, 3).map(row => row.date + ' ' + row.held).join(', '));
  const same = run(OVER, { overHold: 'tqqq' });
  ck('TQQQ over the line trades nothing: #72\'s rows, and the card says so', sameRows(same.log, run(MIN).log) && same.signals.cards.some(card => card.label === 'Overextended' && card.value === 'No trades' && /trades nothing/.test(card.tip)));
}

// ---- 4. The reading and the books ----
{
  const mine = run(OVER), steady = run(STEADY).log;
  const offBy = (rows, theirs) => rows.reduce((worst, row) => (theirs(row) == null ? worst : Math.max(worst, Math.abs(row.overRel - theirs(row)))), 0);
  const steadyAt = Object.fromEntries(steady.map(row => [row.date, row.overPct]));
  ck('#71 charts the line with the same settings, so the check below compares like with like', defaultsOf(strategyOf(STEADY)).overPct === LEVEL && defaultsOf(strategyOf(STEADY)).overWindow === DAYS);
  ck('the reading is #71\'s on every close', mine.log.every(row => row.overRel != null) && offBy(mine.log, row => steadyAt[row.date]) < 1e-9, 'off by ' + offBy(mine.log, row => steadyAt[row.date]));
  ck('and the one worked out here from the closes', offBy(mine.log, row => overAt.rel[index[row.date]]) < 1e-9);
  // The account from the holdings alone: a fund's move over each session, and the trading cost on each side of a switch.
  const defaults = defaultsOf(over), cost = defaults.tradeCost / 100;
  let value = 100000 * (1 - cost), worst = 0;
  mine.log.forEach((row, k) => {
    if (k > 0) {
      const was = mine.log[k - 1].held.toLowerCase(), i = index[row.date];
      value *= data[was][i] / data[was][i - 1];
      if (row.held !== mine.log[k - 1].held) value *= (1 - cost) * (1 - cost);
    }
    worst = Math.max(worst, Math.abs(value / row.value - 1));
  });
  ck('the account is its holdings replayed from the closes', worst < 1e-9, 'off by ' + worst);
}

// ---- 5. The fallbacks ----
{
  const strategy = strategyOf(OVER), bare = Object.fromEntries(Object.entries(defaultsOf(strategy)).filter(([id]) => !OVER_IDS.includes(id)));
  const without = strategy.run(data, { ...bare, initial: 100000, contributions: {}, startIdx: START, endIdx: END, dailyDisplay: true }).log;
  ck('a run without the line\'s settings is a run at their defaults', sameRows(without, run(OVER).log));
}

// ---- 6. Marks, notes and the dashboard ----
{
  const mine = run(OVER), PANEL = 'TQQQ vs its 255-day median', TRADES = ['buy', 'sell', 'switch'];
  const lines = mine.lines.filter(line => line.group === PANEL);
  ck('the line has a panel of its own at full height: the reading and the level, each with a price', lines.map(line => line.key).join() === 'overRel,overLevel' && lines.every(line => line.tall && line.unit === '%' && line.priceKey), JSON.stringify(lines));
  const trades = mine.log.filter(row => TRADES.includes(row.action)), byLine = trades.filter(row => row.firedBy === PANEL);
  const ins = byLine.filter(row => row.held === 'SQQQ'), outs = byLine.filter(row => row.held === 'TQQQ');
  ck('its trades are marked in that panel', ins.length > 50 && outs.length > 50, `${ins.length} in, ${outs.length} out`);
  ck('a trade into SQQQ there says overextended, at a close over the level', ins.every(row => /^Overextended: TQQQ \+\d+\.\d% against its 255-day median, more than 55% above it$/.test(row.note) && row.overRel > LEVEL), (ins.find(row => !/^Overextended/.test(row.note)) || {}).note);
  ck('a trade back says so, at a close not over it', outs.every(row => /^Back under the overextended level: TQQQ [+−]\d+\.\d% against its 255-day median, the level is 55% above it$/.test(row.note) && row.overRel <= LEVEL), (outs.find(row => !/^Back under/.test(row.note)) || {}).note);
  ck('#72\'s own trades keep their panels', trades.some(row => row.firedBy === 'TQQQ vs its 30-day median') && trades.some(row => row.firedBy === 'SOXX vs QQQ, 20 days'));
  ck('the level\'s price is the median times 1.55', mine.log.every(row => Math.abs(row.overPx / (row.overClose / (1 + row.overRel / 100)) - 1.55) < 1e-9));
  ck('the log has the line\'s column', over.columns.some(column => column.key === 'overRel' && column.tip));
  const { cards, decision } = mine.signals;
  ck('the dashboard has the line\'s card after #72\'s', cards.map(card => card.label).slice(0, 2).join() === 'Late-week SQQQ,Overextended', cards.map(card => card.label).join());
  ck('today\'s call carries both readings', decision.reasons.map(reason => reason.name).join() === 'Late-week SQQQ,Overextended', JSON.stringify(decision.reasons));
  // A day the line holds the money: the call is the line's, with its reading first.
  const held = dates.findIndex((date, i) => i > START && overAt.state[i] && minHeld[i] === 'TQQQ');
  const then = strategyOf(OVER).run(data, { ...defaultsOf(over), initial: 100000, contributions: {}, startIdx: START, endIdx: held, dailyDisplay: true }).signals;
  ck('on a day the line holds SQQQ the call says so', then.decision.action === 'Hold SQQQ' && then.decision.tone === 'bad' && /^overextended: TQQQ \+/.test(then.decision.note) && then.decision.reasons[0].name === 'Overextended' && then.cards[1].value === 'SQQQ', JSON.stringify(then.decision));
}

console.log(failures ? `\n${failures} check(s) failed` : 'library late-week + overextended: all checks passed');
process.exit(failures ? 1 : 0);
