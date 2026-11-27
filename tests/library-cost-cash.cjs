/*
 * Every library strategy has a trading cost and a cash interest setting, frozen for Fit and the map (the user,
 * 2026-11-26: "make sure all strategies have switching cost and cash percentage", "and make sure they are frozen
 * by default"). The entries written without them get both from withCostAndCash (js/strategy-library-code.js).
 * Pure Node, on the repo's own price history, Q1 2010 to Q4 2025. Checks:
 *   1. each entry's settings hold "cashRate" and "tradeCost", both fit: false; the 18 given them default to 4% and
 *      0.02% (an entry's own fitted defaults stay: the SMA entries #33-#38 earn 0% on cash);
 *   2. an entry given them by withCostAndCash, at a cost of 0 and no interest, trades as its text before them did,
 *      row for row, with a lump sum and with monthly contributions and a withdrawal;
 *   3. at the defaults each of those pays a fee on every row that moves money (a rebalance when its weight
 *      moves) and on no other, and the cost alone ends it lower;
 *   4. a close held in cash earns a day of the interest: (1 + 4%)^(1/252);
 *   5. each of those cards gives what its defaults make now (COST_CASH_RESULTS in js/strategy-library.js);
 *   6. each of their rows says what it holds (cash, shares, the fund), so the drawdown is taken at every daily close:
 *      the holdings add up to the row's value, and from a log of month ends (as the map's and Fit's runs keep) the
 *      daily drawdown is the one of a log of every day. On the rows alone it was not (Composer TQQQ-RSI at 77:
 *      46.0% against 54.8%).
 *
 *   node tests/library-cost-cash.cjs
 */
const { CODE, data, strategyOf, settingsOf, defaultsOf } = require('./library-harness.cjs');

let failures = 0;
const ck = (name, ok, detail) => {
  if (ok) return;
  failures++;
  console.log('  FAIL  ' + name + (detail ? '   ' + detail : ''));
};
const { COST_CASH_BASE } = CODE;
const strategy = text => new Function('"use strict"; return (' + text + '\n);')();
const { dates } = data, at = d => dates.findIndex(x => x >= d);
const A = at('2010-01-04') - 1, END = at('2026-01-01') - 1;
const monthly = Object.fromEntries(dates.slice(A + 1, END + 1).filter((d, k, all) => k === 0 || all[k - 1].slice(0, 7) !== d.slice(0, 7)).map(d => [d, 2000]));
const withMoney = { ...monthly, '2020-06-15': -40000 };
const run = (st, settings = {}, contributions = {}) => st.run(data, { ...defaultsOf(st), ...settings, initial: 100000, contributions, startIdx: A, endIdx: END, dailyDisplay: true }).log;
const sameRows = (a, b) => a.length === b.length && a.every((r, k) => Math.abs(r.value - b[k].value) <= 1e-6 * Math.max(1, Math.abs(r.value)) && r.held === b[k].held && r.action === b[k].action && r.note === b[k].note);
const TRADES = ['buy', 'sell', 'switch', 'rebalance'];
const CENT = 0.005;   // a fee under half a cent is float residue: $0.00 in the log

// ---- 1. Every entry has both settings, frozen ----
const ids = Object.keys(CODE).map(Number);
for (const n of ids) {
  const by = Object.fromEntries(settingsOf(strategyOf(n)).map(p => [p.id, p]));
  ck(`#${n} has a cash interest setting, frozen`, by.cashRate && by.cashRate.fit === false, by.cashRate ? 'fit ' + by.cashRate.fit : 'none');
  ck(`#${n} has a trading cost setting, frozen`, by.tradeCost && by.tradeCost.fit === false, by.tradeCost ? 'fit ' + by.tradeCost.fit : 'none');
}

// ---- 2 and 3. The entries given them ----
const added = Object.keys(COST_CASH_BASE).map(Number);
ck('withCostAndCash gave them to the 18 entries written without', added.length === 18, added.join(', '));
for (const n of added) {
  const was = strategy(COST_CASH_BASE[n]), now = strategyOf(n), free = { tradeCost: 0, cashRate: 0 }, d = defaultsOf(now);
  ck(`#${n} defaults: 4% interest, 0.02% cost`, d.cashRate === 4 && d.tradeCost === 0.02, `${d.cashRate}%, ${d.tradeCost}%`);
  ck(`#${n} at cost 0 and no interest trades as before: lump sum`, sameRows(run(now, free), run(was)));
  ck(`#${n} at cost 0 and no interest trades as before: contributions and a withdrawal`, sameRows(run(now, free, withMoney), run(was, {}, withMoney)));
  const log = run(now);
  let lastWeight = null;
  const moves = log.map((r) => { if (r.action !== 'rebalance') return TRADES.includes(r.action); const moved = r.weight !== lastWeight; lastWeight = r.weight; return moved; });
  const wrong = log.filter((r, k) => (moves[k] ? !(r.fee > 0) : r.fee >= CENT && r.action !== 'contribution' && r.action !== 'start'));
  ck(`#${n} at the defaults: a fee on every row that moves money and on no other`, log.some(r => TRADES.includes(r.action)) && wrong.length === 0, wrong.slice(0, 3).map(r => `${r.date} ${r.action} fee ${r.fee}`).join('; '));
  const costOnly = run(now, { cashRate: 0 }), base = run(now, free);
  ck(`#${n} the cost alone ends it lower`, costOnly.at(-1).value < base.at(-1).value, `${costOnly.at(-1).value} against ${base.at(-1).value}`);
}

// ---- 4. A close in cash earns a day of the interest ----
{
  const log = run(strategyOf(1), { tradeCost: 0 }), day = Math.pow(1.04, 1 / 252) - 1;
  const k = log.findIndex((r, j) => j > 0 && /^cash$/i.test(r.held) && /^cash$/i.test(log[j - 1].held) && r.action === 'hold' && log[j - 1].action === 'hold');
  ck('Faber in cash: a close earns (1 + 4%)^(1/252)', k > 0 && Math.abs(log[k].value / log[k - 1].value - 1 - day) < 1e-12, k > 0 ? `${log[k].value / log[k - 1].value - 1} against ${day}` : 'no two closes in cash');
}

// ---- 5. The cards' numbers ----
{
  const fs = require('fs'), path = require('path'), vm = require('vm');
  const stub = new Proxy(function () {}, { get: () => stub, apply: () => stub });   // the page's DOM, which the file touches at load
  const page = { console, window: {}, document: stub, localStorage: stub, setTimeout: () => 0 };
  vm.createContext(page);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'strategy-library.js'), 'utf8') + '\nthis.RESULTS = COST_CASH_RESULTS; this.LIBRARY = STRATEGY_LIBRARY;', page);
  ck('a card number for each entry given them', Object.keys(page.RESULTS).map(Number).sort((a, b) => a - b).join() === added.slice().sort((a, b) => a - b).join(), Object.keys(page.RESULTS).join());
  for (const n of added) {
    const log = run(strategyOf(n)), yrs = (Date.parse(log.at(-1).date) - Date.parse(log[0].date)) / (365.25 * 864e5);
    let peak = 0, fall = 0; log.forEach(r => { peak = Math.max(peak, r.value); fall = Math.max(fall, 1 - r.value / peak); });
    const cagr = +((Math.pow(log.at(-1).value / log[0].value, 1 / yrs) - 1) * 100).toFixed(1), dd = Math.round(fall * 100), [saidCagr, saidDd] = page.RESULTS[n] || [];
    const card = page.LIBRARY.find(e => e.n === n).reported;
    ck(`#${n} its card gives its defaults' ${cagr.toFixed(1)}% and ${dd}%`, saidCagr === cagr && saidDd === dd && card.includes(`: ${cagr.toFixed(1)}% a year, max drawdown ${dd}% (2010–2025)`), `card ${saidCagr}%, ${saidDd}%`);
  }
}

// ---- 6. Each row says what it holds; the drawdown is taken at every daily close ----
{
  const { buildCustomDDControls, computeDailyMaxDrawdownMulti } = require('../js/metrics.js');
  const days = dates.map((date, i) => Object.assign({ date }, ...['tqqq', 'qqq', 'spy', 'qld', 'sso', 'spxl', 'sqqq', 'gld', 'soxl', 'soxx', 'soxs'].map(f => ({ [f]: data[f][i] }))));
  const fund = r => String(r.held).toLowerCase().replace(/\s*\+\s*cash$/, '');
  const fallOf = log => { let peak = 0, fall = 0; log.forEach(r => { peak = Math.max(peak, r.value); fall = Math.max(fall, 1 - r.value / peak); }); return fall * 100; };
  for (const n of added) {
    const st = strategyOf(n), go = extra => st.run(data, { ...defaultsOf(st), initial: 80000, contributions: monthly, startIdx: A, endIdx: END, ...extra }).log;
    const sparse = go({}), everyDay = go({ dailyDisplay: true });
    const off = sparse.find(r => !(typeof r.cash === 'number' && typeof r.shares === 'number')
      || Math.abs(r.cash + r.shares * (fund(r) === 'cash' ? 0 : data[fund(r)][at(r.date)]) - r.value) > 1e-6 * Math.max(1, r.value));
    ck(`#${n} each row's cash and shares add up to its value`, !off, off ? JSON.stringify({ date: off.date, held: off.held, cash: off.cash, shares: off.shares, value: off.value }) : '');
    const controls = buildCustomDDControls(sparse), daily = controls && computeDailyMaxDrawdownMulti(controls, days);
    ck(`#${n} from month-end rows the drawdown at the daily closes is the every-day log's`, daily && Math.abs(daily.pct * 100 - fallOf(everyDay)) < 0.15,   // pct is a share of 1
      `${daily ? (daily.pct * 100).toFixed(2) : 'none'}% against ${fallOf(everyDay).toFixed(2)}% (the rows alone: ${fallOf(sparse).toFixed(2)}%)`);
  }
}

console.log(failures ? `\n${failures} check(s) failed` : `library cost and cash: all checks passed (${ids.length} strategies, ${added.length} given them)`);
process.exit(failures ? 1 : 0);
