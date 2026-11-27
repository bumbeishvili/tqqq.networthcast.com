/*
 * Library strategy #72, "10-25 - Min - late-week SQQQ" (was "Min - late-week SQQQ"), at the user's pick on the map of Q1 2010 to Q4 2025 (27 November 2026:
 * "set this as default"). Pure Node — no browser/server. Checks, on the repo's own price history:
 *   1. its defaults are the code's before the pick (MIN_LATE_WEEK_BASE) with the seven the pick moved;
 *   2. it trades as that code does at those seven, row for row: a lump sum, contributions and a withdrawal, one trade
 *      per day, cash in between;
 *   3. five tips are redone at the pick and the rest are the code's before;
 *   4. the map's numbers: with $80K and $3K a month, the max drawdown 41.2% (the map: 41.2%) and a money-weighted
 *      168.8% a year (the map: 169.2%); $100K lump sum 170.4% a year.
 *
 *   node tests/library-min-late-week.cjs
 */
const { CODE, data, strategyOf, settingsOf, defaultsOf } = require('./library-harness.cjs');

let failures = 0;
const ck = (name, ok, detail) => {
  if (ok) return;
  failures++;
  console.log('  FAIL  ' + name + (detail ? '   ' + detail : ''));
};

const MOVED = { trendUnder: -1.5, rsiFund: 'qqq', rsiLevel: 41.5, lagFund: 'spxl', lagDays: 2, lagVs: 'qld', lagBy: 1.5 };
const WAS = { trendUnder: 0, rsiFund: 'tqqq', rsiLevel: 40, lagFund: 'soxx', lagDays: 20, lagVs: 'qqq', lagBy: 2 };
const TIPPED = ['weekendCheck', 'rsiLevel', 'lagTake', 'lagBy', 'lagHold'];
const { dates } = data;
const START = dates.findIndex(d => d >= '2010-01-04') - 1, END = dates.findIndex(d => d >= '2026-01-01') - 1;
const mine = strategyOf(72);
const base = new Function('"use strict"; return (' + CODE.MIN_LATE_WEEK_BASE + '\n);')();
const run = (strategy, settings = {}, contributions = {}, initial = 100000) => strategy.run(data, { ...defaultsOf(strategy), ...settings, initial, contributions, startIdx: START, endIdx: END, dailyDisplay: true });
const sameRows = (a, b) => a.length === b.length && a.every((row, k) => row.value === b[k].value && row.held === b[k].held && row.action === b[k].action && row.note === b[k].note);

// ---- 1. The defaults ----
{
  const d = defaultsOf(mine), was = defaultsOf(base);
  ck('the name, the old one kept for saved copies', mine.name === '10-25 - Min - late-week SQQQ' && base.name === 'Min - late-week SQQQ', mine.name);
  ck('the settings are the code\'s before', settingsOf(mine).map(p => p.id).join() === settingsOf(base).map(p => p.id).join());
  ck('the code before had the defaults the pick moved from', Object.keys(WAS).every(id => JSON.stringify(was[id]) === JSON.stringify(WAS[id])), JSON.stringify(Object.keys(WAS).map(id => [id, was[id]])));
  const wrong = Object.keys(was).filter(id => JSON.stringify(d[id]) !== JSON.stringify(id in MOVED ? MOVED[id] : was[id]));
  ck('the seven moved to the pick, the rest kept', wrong.length === 0, wrong.map(id => `${id} ${d[id]}`).join(', '));
  const byId = Object.fromEntries(settingsOf(mine).map(p => [p.id, p]));
  const values = (id) => byId[id].options.map(o => (o && typeof o === 'object' ? o.value : o));
  ck('every moved value is among its options', Object.keys(MOVED).every(id => values(id).some(v => String(v) === String(MOVED[id]))));
}

// ---- 2. The code before at the pick, row for row ----
{
  const monthly = Object.fromEntries(dates.slice(START + 1, END + 1).filter((date, k, all) => k === 0 || all[k - 1].slice(0, 7) !== date.slice(0, 7)).map(date => [date, 4000]));
  const withMoney = { ...monthly, '2020-06-15': -50000 };
  [['a lump sum', {}, {}], ['contributions and a withdrawal', {}, withMoney], ['one trade per day', { splitDays: true }, {}], ['cash in between', { park: 'cash' }, withMoney]].forEach(([tag, settings, contributions]) => {
    ck(`${tag}: the code before at the pick, row for row`, sameRows(run(mine, settings, contributions).log, run(base, { ...MOVED, ...settings }, contributions).log));
  });
  const a = run(mine), b = run(base, MOVED);
  ck('the same panels and call', JSON.stringify(a.lines) === JSON.stringify(b.lines) && JSON.stringify(a.signals) === JSON.stringify(b.signals));
}

// ---- 3. The tips ----
{
  const tips = (s) => Object.fromEntries(settingsOf(s).map(p => [p.id, p.tip]));
  const now = tips(mine), was = tips(base);
  ck('five tips redone', TIPPED.every(id => now[id] !== was[id]), TIPPED.filter(id => now[id] === was[id]).join());
  ck('the rest as before', Object.keys(was).filter(id => !TIPPED.includes(id)).every(id => now[id] === was[id]));
  ck('the lag tips name the pick\'s funds', /SPXL trailed QLD by more than 1\.5% over 2 days/.test(now.lagTake) && /2 days with 1\.5%/.test(now.lagBy));
  ck('the level tip names the pick\'s level', /most at 41\.5/.test(now.rsiLevel));
}

// ---- 4. The map's numbers ----
{
  const stats = (log) => { let peak = 0, fall = 0; log.forEach(r => { peak = Math.max(peak, r.value); fall = Math.max(fall, 1 - r.value / peak); }); return fall; };
  const years = (a, b) => (Date.parse(b) - Date.parse(a)) / (365.25 * 864e5);
  const lump = run(mine).log;
  const perYear = Math.pow(lump[lump.length - 1].value / lump[0].value, 1 / years(lump[0].date, lump[lump.length - 1].date)) - 1;
  ck('$100K lump sum: 170.4% a year, max drawdown 41.2%', (perYear * 100).toFixed(1) === '170.4' && (stats(lump) * 100).toFixed(1) === '41.2', `${(perYear * 100).toFixed(1)}%, ${(stats(lump) * 100).toFixed(1)}%`);
  const contributions = Object.fromEntries(dates.slice(START + 1, END + 1).filter((d, k, all) => k === 0 || all[k - 1].slice(0, 7) !== d.slice(0, 7)).map(d => [d, 3000]));
  const log = run(mine, {}, contributions, 80000).log, final = log[log.length - 1].value;
  const flows = [[dates[START], 80000], ...Object.entries(contributions)];
  let lo = -0.99, hi = 50;
  for (let k = 0; k < 200; k++) { const r = (lo + hi) / 2, v = flows.reduce((s, [d, a]) => s + a * Math.pow(1 + r, years(d, dates[END])), 0); if (v < final) lo = r; else hi = r; }
  ck('$80K and $3K a month: 168.8% a year money-weighted, max drawdown 41.2%', (lo * 100).toFixed(1) === '168.8' && (stats(log) * 100).toFixed(1) === '41.2', `${(lo * 100).toFixed(1)}%, ${(stats(log) * 100).toFixed(1)}%`);
}

console.log(failures ? `${failures} failure(s)` : 'library-min-late-week: all checks pass');
process.exit(failures ? 1 : 0);
