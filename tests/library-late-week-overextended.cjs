/*
 * Library strategy #73, "Late-week + overextended SQQQ": #72 (Min - late-week SQQQ) with the
 * overextended line of the fits as one more rule (withOverextendedLine in
 * js/strategy-library-code.js). Pure Node — no browser/server. Checks, on the repo's
 * own price history:
 *   1. its settings are #72's with the line's five in a section of their own, before
 *      the execution section, and #72's defaults but for the three it sets itself
 *      (the user's pick on the map, 26 November 2026);
 *   2. with the rule off it trades as #72 does at those three, row for row: a lump
 *      sum, contributions and a withdrawal, one trade per day;
 *   3. at its defaults it holds, at every close, the line's fund where the line says
 *      so or #72 holds it, and #72's fund otherwise; with cash over the line, #72's
 *      days in its fund held in between come first;
 *   4. the line's reading is #71's own on every close, and the account is those
 *      holdings replayed from the closes with the entry's books;
 *   5. a run without the line's settings is a run at their defaults;
 *   6. the line's trades are marked in its panel and say why, and the dashboard
 *      carries its card and its reading in today's call;
 *   7. the entry is that code at the user's pick on the map of 2010-2025 (27 November 2026): its defaults and nine
 *      tips, and the map's drawdown with the map's money.
 * Sections 1-6 check the line on the code as it was before the pick (LATE_WEEK_OVER_BASE, which #75 is built from):
 * the line on TQQQ into SQQQ, Min's fund TQQQ, which #71's line and #72's holdings read the same way.
 *
 *   node tests/library-late-week-overextended.cjs
 */
const { CODE, data, strategyOf, settingsOf, defaultsOf } = require('./library-harness.cjs');

let failures = 0;
const ck = (name, ok, detail) => {
  if (ok) return;
  failures++;
  console.log('  FAIL  ' + name + (detail ? '   ' + detail : ''));
};

const MIN = 72, OVER = 73, STEADY = 71;
const OVER_IDS = ['overTake', 'overFund', 'overPct', 'overWindow', 'overHold'];
const LEVEL = 54, DAYS = 242;   // the line's defaults
const OWN = { trendUnder: -0.5, trendDays: 41, rsiDays: 9 };   // #72's settings #73 sets its own defaults for
const { dates, tqqq: T } = data;
const START = dates.findIndex(d => d >= '2010-01-04') - 1, END = dates.findIndex(d => d >= '2026-11-23');
// #73's code before the user's pick of 27 November 2026, with its defaults then.
const overBase = new Function('"use strict"; return (' + CODE.LATE_WEEK_OVER_BASE + '\n);')();
const run = (n, settings = {}, contributions = {}) => { const strategy = n === OVER ? overBase : strategyOf(n); return strategy.run(data, { ...defaultsOf(strategy), ...settings, initial: 100000, contributions, startIdx: START, endIdx: END, dailyDisplay: true }); };
const sameRows = (mine, theirs) => mine.length === theirs.length && mine.every((row, k) => row.value === theirs[k].value && row.held === theirs[k].held && row.action === theirs[k].action && row.note === theirs[k].note);

const min = strategyOf(MIN), over = overBase;

// ---- 1. The settings ----
{
  const minIds = settingsOf(min).map(param => param.id), ids = settingsOf(over).map(param => param.id);
  ck('its settings are #72\'s and the line\'s five', ids.filter(id => !OVER_IDS.includes(id)).join() === minIds.join() && OVER_IDS.every(id => ids.includes(id)), ids.join());
  const sections = over.params.filter(param => param.section).map(param => param.section);
  ck('the line has a section of its own, before the execution section', sections.join(' | ') === 'Overextended | Execution & costs', sections.join(' | '));
  const at = over.params.findIndex(param => param.section === 'Overextended');
  ck('the five follow that section in order', over.params.slice(at + 1, at + 6).map(param => param.id).join() === OVER_IDS.join());
  const minDefaults = defaultsOf(min), defaults = defaultsOf(over);
  ck('#72\'s defaults but for the three it sets itself, which #72 keeps as they were', minIds.every(id => JSON.stringify(defaults[id]) === JSON.stringify(id in OWN ? OWN[id] : minDefaults[id]))
    && JSON.stringify([minDefaults.trendUnder, minDefaults.trendDays, minDefaults.rsiDays]) === '[0,30,10]', JSON.stringify(Object.keys(OWN).map(id => [id, minDefaults[id], defaults[id]])));
  ck(`the line\'s defaults: on, TQQQ, ${LEVEL}% over the ${DAYS}-day median, SQQQ`, JSON.stringify(OVER_IDS.map(id => defaults[id])) === JSON.stringify([true, 'tqqq', LEVEL, DAYS, 'sqqq']), JSON.stringify(OVER_IDS.map(id => defaults[id])));
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
    ck(`rule off, ${tag}: #72 row for row`, sameRows(run(OVER, { ...settings, overTake: false }, contributions).log, run(MIN, { ...OWN, ...settings }, contributions).log));
  });
  ck('rule off: no panel, no card, #72\'s call', (() => { const mine = run(OVER, { overTake: false }), theirs = run(MIN, OWN);
    return JSON.stringify(mine.lines) === JSON.stringify(theirs.lines) && JSON.stringify(mine.signals) === JSON.stringify(theirs.signals); })());
}

// The line's state at every close, worked out here from the closes alone: the median of the last `days` closes, today's included.
const overAt = (() => {
  const state = new Uint8Array(dates.length), rel = new Float64Array(dates.length).fill(NaN);
  for (let i = DAYS - 1; i < dates.length; i++) {
    const sorted = Array.from(T.slice(i - DAYS + 1, i + 1)).sort((a, b) => a - b);
    if (!(sorted[0] > 0)) continue;
    const mid = DAYS >> 1, median = DAYS % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;   // an even count: the two middle ones' average
    rel[i] = (T[i] / median - 1) * 100;
    state[i] = rel[i] > LEVEL ? 1 : 0;
  }
  return { state, rel };
})();
const index = Object.fromEntries(dates.map((date, i) => [date, i]));
const minHeld = Object.fromEntries(run(MIN, OWN).log.map(row => [index[row.date], row.held]));

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
  ck('TQQQ over the line trades nothing: #72\'s rows, and the card says so', sameRows(same.log, run(MIN, OWN).log) && same.signals.cards.some(card => card.label === 'Overextended' && card.value === 'No trades' && /trades nothing/.test(card.tip)));
}

// ---- 4. The reading and the books ----
{
  const mine = run(OVER), steady = run(STEADY, { overPct: LEVEL, overWindow: DAYS }).log;   // #71 with the line set as #73's
  const offBy = (rows, theirs) => rows.reduce((worst, row) => (theirs(row) == null ? worst : Math.max(worst, Math.abs(row.overRel - theirs(row)))), 0);
  const steadyAt = Object.fromEntries(steady.map(row => [row.date, row.overPct]));
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
  const strategy = overBase, bare = Object.fromEntries(Object.entries(defaultsOf(strategy)).filter(([id]) => !OVER_IDS.includes(id)));
  const without = strategy.run(data, { ...bare, initial: 100000, contributions: {}, startIdx: START, endIdx: END, dailyDisplay: true }).log;
  ck('a run without the line\'s settings is a run at their defaults', sameRows(without, run(OVER).log));
}

// ---- 6. Marks, notes and the dashboard ----
{
  const mine = run(OVER), PANEL = `TQQQ vs its ${DAYS}-day median`, TRADES = ['buy', 'sell', 'switch'];
  const lines = mine.lines.filter(line => line.group === PANEL);
  ck('the line has a panel of its own at full height: the reading and the level, each with a price', lines.map(line => line.key).join() === 'overRel,overLevel' && lines.every(line => line.tall && line.unit === '%' && line.priceKey), JSON.stringify(lines));
  const trades = mine.log.filter(row => TRADES.includes(row.action)), byLine = trades.filter(row => row.firedBy === PANEL);
  const ins = byLine.filter(row => row.held === 'SQQQ'), outs = byLine.filter(row => row.held === 'TQQQ');
  ck('its trades are marked in that panel', ins.length > 50 && outs.length > 50, `${ins.length} in, ${outs.length} out`);
  ck('a trade into SQQQ there says overextended, at a close over the level', ins.every(row => new RegExp(`^Overextended: TQQQ \\+\\d+\\.\\d% against its ${DAYS}-day median, more than ${LEVEL}% above it$`).test(row.note) && row.overRel > LEVEL), (ins.find(row => !/^Overextended/.test(row.note)) || {}).note);
  ck('a trade back says so, at a close not over it', outs.every(row => new RegExp(`^Back under the overextended level: TQQQ [+−]\\d+\\.\\d% against its ${DAYS}-day median, the level is ${LEVEL}% above it$`).test(row.note) && row.overRel <= LEVEL), (outs.find(row => !/^Back under/.test(row.note)) || {}).note);
  ck('#72\'s own trades keep their panels', trades.some(row => row.firedBy === `TQQQ vs its ${OWN.trendDays}-day median`) && trades.some(row => row.firedBy === 'SOXX vs QQQ, 20 days'));
  ck(`the level\'s price is the median times ${1 + LEVEL / 100}`, mine.log.every(row => Math.abs(row.overPx / (row.overClose / (1 + row.overRel / 100)) - (1 + LEVEL / 100)) < 1e-9));
  ck('the log has the line\'s column', over.columns.some(column => column.key === 'overRel' && column.tip));
  const { cards, decision } = mine.signals;
  ck('the dashboard has the line\'s card after #72\'s', cards.map(card => card.label).slice(0, 2).join() === 'Late-week SQQQ,Overextended', cards.map(card => card.label).join());
  ck('today\'s call carries both readings', decision.reasons.map(reason => reason.name).join() === 'Late-week SQQQ,Overextended', JSON.stringify(decision.reasons));
  // A day the line holds the money: the call is the line's, with its reading first.
  const held = dates.findIndex((date, i) => i > START && overAt.state[i] && minHeld[i] === 'TQQQ');
  const then = overBase.run(data, { ...defaultsOf(over), initial: 100000, contributions: {}, startIdx: START, endIdx: held, dailyDisplay: true }).signals;
  ck('on a day the line holds SQQQ the call says so', then.decision.action === 'Hold SQQQ' && then.decision.tone === 'bad' && /^overextended: TQQQ \+/.test(then.decision.note) && then.decision.reasons[0].name === 'Overextended' && then.cards[1].value === 'SQQQ', JSON.stringify(then.decision));
}

// ---- 7. The entry at the user's pick ----
{
  const PICK = { trendFund: 'qld', trendUnder: 1, trendDays: 26, fund: 'soxl', park: 'soxs', rsiFund: 'qqq', rsiDays: 10, rsiLevel: 41.5, lagFund: 'soxl', lagDays: 16, lagVs: 'tqqq', lagBy: 3,
    overFund: 'spxl', overPct: 67, overWindow: 390, overHold: 'soxs' };
  const now = strategyOf(OVER), d = defaultsOf(now), was = defaultsOf(overBase);
  const moved = Object.keys(d).filter(id => JSON.stringify(d[id]) !== JSON.stringify(was[id]));
  ck('its defaults are the code before at the pick\'s 16, and no other', moved.slice().sort().join() === Object.keys(PICK).sort().join() && moved.every(id => d[id] === PICK[id]), moved.map(id => `${id} ${was[id]} -> ${d[id]}`).join(', '));
  const tipsMoved = settingsOf(now).filter(p => p.tip !== settingsOf(overBase).find(q => q.id === p.id).tip).map(p => p.id);
  ck('nine tips swapped: six plain, the line\'s three on its own facts', tipsMoved.join() === 'weekendCheck,rsiSkip,rsiLevel,lagTake,lagBy,lagHold,overTake,overPct,overHold', tipsMoved.join());
  const E2025 = dates.findIndex(d => d >= '2026-01-01') - 1, monthly = Object.fromEntries(dates.slice(START + 1, E2025 + 1).filter((date, k, all) => k === 0 || all[k - 1].slice(0, 7) !== date.slice(0, 7)).map(date => [date, 3000]));
  const log = now.run(data, { ...d, initial: 80000, contributions: monthly, startIdx: START, endIdx: E2025, dailyDisplay: true }).log;
  let peak = 0, fall = 0; log.forEach(r => { peak = Math.max(peak, r.value); fall = Math.max(fall, 1 - r.value / peak); });
  ck('with $80K and $3K a month on 2010-2025 its max drawdown is the map\'s 64.8%', (fall * 100).toFixed(1) === '64.8', (fall * 100).toFixed(1) + '%');
  ck('it holds SOXL, and SOXS in between', log.some(r => r.held === 'SOXL') && log.some(r => r.held === 'SOXS') && !log.some(r => r.held === 'TQQQ' || r.held === 'SQQQ'));
}

console.log(failures ? `\n${failures} check(s) failed` : 'library late-week + overextended: all checks passed');
process.exit(failures ? 1 : 0);
