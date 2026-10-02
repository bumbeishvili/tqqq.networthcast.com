/*
 * Withdrawal handling in the Strategy Library's code (js/strategy-library-code.js).
 * Pure Node — no browser/server. Runs every library strategy on the repo's own
 * price history with deposits and withdrawals, and checks the money: a
 * withdrawal is paid from cash first, then by selling what is held at that
 * day's close, and the account never borrows or goes below zero.
 *
 * It also covers upgradeWithdrawalHandling, which gives the same rule to a
 * saved copy of a library strategy made before the rule existed.
 *
 *   node tests/library-withdrawals.cjs
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'js/data.js'), 'utf8'));   // parseDataFile, buildDaily, buildNfciDaily
const CODE = require(path.join(ROOT, 'js/strategy-library-code.js'));
const upgradeWithdrawalHandling = CODE.upgradeWithdrawalHandling;

let failures = 0;
const ck = (name, ok, detail) => {
  if (ok) return;
  failures++;
  console.log('  FAIL  ' + name + (detail ? '   ' + detail : ''));
};

// ---- data: the same arrays the app hands a custom strategy (buildCustomData) ----
const TICKERS = ['tqqq', 'qqq', 'spy', 'qld', 'sso', 'spxl', 'sqqq'];
const series = file => parseDataFile(fs.readFileSync(path.join(ROOT, 'data', file), 'utf8'));
const daily = buildDaily(series('synthetic-qqq.tsv'), series('synthetic-tqqq.tsv'), series('spy.tsv'),
  series('synthetic-qld.tsv'), series('synthetic-sso.tsv'), series('synthetic-spxl.tsv'), series('synthetic-sqqq.tsv'));
const data = {
  dates: daily.map(d => d.date),
  nfci: buildNfciDaily(daily, series('nfci.tsv')),
  ...Object.fromEntries(TICKERS.map(t => [t, daily.map(d => d[t] || 0)])),
};

// A fixed stretch of settled history, so the daily data refresh cannot move the results.
const START = data.dates.findIndex(d => d >= '2015-01-02');
const END = data.dates.findIndex(d => d > '2025-12-31') - 1;
const INITIAL = 10000, MONTHLY = 1000, WITHDRAWAL = 20000;
const firstDayOnOrAfter = date => data.dates[data.dates.findIndex(d => d >= date)];
const DEPOSITS = Object.fromEntries(
  data.dates.slice(START + 1, END + 1)
    .filter((date, k) => date.slice(0, 7) !== data.dates[START + k].slice(0, 7))
    .map(date => [date, MONTHLY]));
const withWithdrawals = (dates, amount) =>
  dates.reduce((schedule, date) => ({ ...schedule, [date]: (schedule[date] || 0) - amount }), DEPOSITS);

// ---- running a strategy ----
// The strategies log sparsely and most do not log their cash balance, so the
// test rewrites two things in the source before running it: every row also
// carries the strategy's own `cash` variable, and a row is pushed every day.
const withCashOnEveryRow = code => code.replace(/log\.push\(\{/g, 'log.push({ __cash: cash, ');
const loggingEveryDay = code => withCashOnEveryRow(code).replace(/if \(contributed !== 0 \|\|/g, 'if (true ||');
const defaultOf = param => (param.default && typeof param.default === 'object' && 'value' in param.default) ? param.default.value : param.default;
function run(code, contributions) {
  const strategy = new Function('"use strict"; return (' + code + '\n);')();
  const params = Object.fromEntries((strategy.params || []).filter(param => param.id != null).map(param => [param.id, defaultOf(param)]));
  const result = strategy.run(data, {
    ...params, initial: INITIAL, monthly: MONTHLY, annualRaise: 0, contributions,
    startIdx: START, endIdx: END, entryDate: data.dates[START], exitDate: data.dates[END],
  });
  return { log: Array.isArray(result) ? result : result.log, tradeCost: (params.tradeCost || 0) / 100 };
}
const holdings = row => row.value - row.__cash;
const strategyIds = Object.keys(CODE).map(Number).sort((a, b) => a - b);

// ---- 1. Several withdrawals: no borrowing, ever ----
{
  const schedule = withWithdrawals(['2017-06-15', '2019-06-14', '2021-06-15', '2023-06-15', '2025-06-16'].map(firstDayOnOrAfter), 25000);
  strategyIds.forEach(n => {
    const { log } = run(withCashOnEveryRow(CODE[n]), schedule);
    const minCash = Math.min(...log.map(row => row.__cash));
    const maxExposure = Math.max(...log.filter(row => row.value > 1).map(row => holdings(row) / row.value));
    ck(`#${n} cash never negative across five withdrawals`, minCash >= -1e-6, 'min cash ' + minCash);
    ck(`#${n} never holds more than the account is worth`, maxExposure <= 1 + 1e-9, 'max exposure ' + maxExposure);
    ck(`#${n} every value is a finite, non-negative number`, log.every(row => Number.isFinite(row.value) && row.value >= -1e-6));
  });
}

// ---- 2. One withdrawal on a quiet day: exactly that money leaves ----
// Picked per strategy from its own run: a day it neither trades nor receives
// money, once while fully invested and once while fully in cash.
{
  let investedCases = 0, cashCases = 0;
  strategyIds.forEach(n => {
    const everyDay = loggingEveryDay(CODE[n]);
    const { log: plain, tradeCost } = run(everyDay, DEPOSITS);
    const quietDay = isWanted => plain.findIndex((row, k) => k > 0 && row.action === 'hold' && !DEPOSITS[row.date] &&
      row.value > 3 * WITHDRAWAL && isWanted(row) && isWanted(plain[k - 1]));
    const fullyInvested = row => holdings(row) > 0.999 * row.value;
    const fullyInCash = row => row.__cash > 0.999 * row.value;

    [['invested', quietDay(fullyInvested)], ['in cash', quietDay(fullyInCash)]].filter(([, k]) => k > 0).forEach(([state, k]) => {
      const { log: withdrawn } = run(everyDay, withWithdrawals([plain[k].date], WITHDRAWAL));
      const before = plain[k], after = withdrawn[k];
      const fall = before.value - after.value;
      ck(`#${n} ${state}: nothing changes before the withdrawal day`, Math.abs(plain[k - 1].value - withdrawn[k - 1].value) < 1e-9);
      ck(`#${n} ${state}: cash is not negative afterwards`, after.__cash >= -1e-9, 'cash ' + after.__cash);
      if (state === 'invested') {
        investedCases++;
        // The sale is sized so its proceeds after the trading cost cover the withdrawal.
        ck(`#${n} invested: value falls by the withdrawal plus the sale's cost`, Math.abs(fall - WITHDRAWAL / (1 - tradeCost)) < 1e-6 * WITHDRAWAL, 'fell ' + fall);
        ck(`#${n} invested: holdings were sold to pay it`, holdings(before) - holdings(after) > 0.99 * WITHDRAWAL);
      } else {
        cashCases++;
        ck(`#${n} in cash: value falls by exactly the withdrawal`, Math.abs(fall - WITHDRAWAL) < 1e-6 * WITHDRAWAL, 'fell ' + fall);
        ck(`#${n} in cash: cash paid it and nothing was sold`, Math.abs((before.__cash - after.__cash) - WITHDRAWAL) < 1e-6 * WITHDRAWAL);
      }
    });
  });
  ck('every strategy was checked while invested', investedCases === strategyIds.length, investedCases + ' of ' + strategyIds.length);
  ck('some strategies were checked while in cash', cashCases > 0);
}

// ---- 3. A withdrawal bigger than the whole account empties it ----
{
  const day = firstDayOnOrAfter('2020-06-15');
  strategyIds.forEach(n => {
    const { log } = run(loggingEveryDay(CODE[n]), withWithdrawals([day], 1e9));
    const k = log.findIndex(row => row.date === day);
    ck(`#${n} overdraw: the account is empty that day`, Math.abs(log[k].value) < 1e-6, 'value ' + log[k].value);
    ck(`#${n} overdraw: nothing is negative afterwards`, log.slice(k).every(row => row.value >= -1e-6 && row.__cash >= -1e-6));
    ck(`#${n} overdraw: later deposits build it back`, log.at(-1).value > MONTHLY);
  });
}

// ---- 4. upgradeWithdrawalHandling: saved copies made before the rule existed ----
{
  // A pre-rule copy is the library text with the withdrawal block taken out.
  const WITHDRAWAL_BLOCK = /\n {8}\/\/ A withdrawal: cash pays first[\s\S]*?\n {8}\}(?=\n {6}\})/;
  // What the code editor does to a copy on blur, as far as matching goes: it re-wraps and re-indents.
  const rewrapped = code => code.replace(/; (?=[a-z]+ [+=])/g, ';\n            ').replace(/, (?=[a-zA-Z]+ = )/g, ',\n        ');
  strategyIds.forEach(n => {
    const preRule = CODE[n].replace(WITHDRAWAL_BLOCK, '');
    ck(`#${n} the library text contains the withdrawal block once`, preRule !== CODE[n] && !WITHDRAWAL_BLOCK.test(preRule));
    ck(`#${n} a pre-rule copy upgrades to exactly the library text`, upgradeWithdrawalHandling(preRule) === CODE[n]);
    ck(`#${n} current text is left alone`, upgradeWithdrawalHandling(CODE[n]) === CODE[n]);
    ck(`#${n} re-wrapping moves the money line across several lines`, !rewrapped(preRule).includes('cash += amt; contributed = amt;'));
    const reflowed = upgradeWithdrawalHandling(rewrapped(preRule));
    ck(`#${n} a re-wrapped pre-rule copy is upgraded too`, reflowed !== rewrapped(preRule) && reflowed.includes('A withdrawal: cash pays first'));
    const schedule = withWithdrawals([firstDayOnOrAfter('2021-06-15')], 25000);
    ck(`#${n} the re-wrapped upgrade runs like the library text`,
      JSON.stringify(run(reflowed, schedule).log.map(row => row.value)) === JSON.stringify(run(CODE[n], schedule).log.map(row => row.value)));
  });
  const unrelated = '{ name: "mine", run(data, p) { let cash = p.initial; const amt = 5; cash += amt; return { log: [] }; } }';
  ck('code that does not keep library-style books is returned unchanged', upgradeWithdrawalHandling(unrelated) === unrelated);
}

console.log(failures ? `\n${failures} check(s) failed` : `library withdrawals: all checks passed (${strategyIds.length} strategies)`);
process.exit(failures ? 1 : 0);
