/*
 * p.dailyDisplay in the Strategy Library's code (js/strategy-library-code.js).
 * Pure Node — no browser/server. The app runs every custom strategy a second
 * time with p.dailyDisplay set to feed the signal chart's zoom (see
 * customDetailLog in js/saved-configs.js). That run must log every trading
 * day and nothing else may differ: same trades, same values on the days the
 * ordinary run logs.
 *
 * It also covers upgradeDailyDisplay, which teaches a saved copy made before
 * the flag existed to honour it, and leaves everything else untouched.
 *
 *   node tests/library-daily-display.cjs
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
const DEPOSITS = Object.fromEntries(
  data.dates.slice(START + 1, END + 1)
    .filter((date, k) => date.slice(0, 7) !== data.dates[START + k].slice(0, 7))
    .map(date => [date, 1000]));
const defaultOf = param => (param.default && typeof param.default === 'object' && 'value' in param.default) ? param.default.value : param.default;
function run(code, flags) {
  const strategy = new Function('"use strict"; return (' + code + '\n);')();
  const params = Object.fromEntries((strategy.params || []).filter(param => param.id != null).map(param => [param.id, defaultOf(param)]));
  const result = strategy.run(data, {
    ...params, initial: 10000, monthly: 1000, annualRaise: 0, contributions: DEPOSITS,
    startIdx: START, endIdx: END, entryDate: data.dates[START], exitDate: data.dates[END], ...flags,
  });
  return Array.isArray(result) ? result : result.log;
}
const isTrade = row => row.action !== 'hold' && row.action !== 'contribution';
const tradesOf = log => log.filter(isTrade).map(row => row.date + ' ' + row.action + ' ' + row.held).join('\n');
const sameRow = (a, b) => a.value === b.value && a.held === b.held && a.action === b.action && a.cash === b.cash;

// A copy saved before the flag existed: the cadence variable under its old
// name `monthEnd` without the flag, so it logs at the display cadence whatever
// p says, and without the Faber strategy's own calendar line, which came with
// the flag (an old Faber copy keys its rule off the cadence variable).
const FLAG_IN_CADENCE_LINE = 'const logDay = p.dailyDisplay\n        || (';
const FABER_CALENDAR_LINE = /\n\s*const monthEnd = i === p\.endIdx \|\| data\.dates\[i \+ 1\]\.slice\(0, 7\) !== month;\n/;
const oldCopyOf = code => {
  if (!code.includes(FLAG_IN_CADENCE_LINE)) throw new Error('library cadence line changed; update this test');
  return code.replace(FLAG_IN_CADENCE_LINE, 'const monthEnd = (').replace(/\|\| logDay/g, '|| monthEnd').replace(FABER_CALENDAR_LINE, '\n')
    .replace(/^\s*\/\/.*dailyDisplay.*\n/gm, '');   // the comment naming the flag came with it too
};
const checkDetailRun = (tag, code, flags) => {
  const ordinary = run(code, flags);
  const detailed = run(code, { ...flags, dailyDisplay: true });
  ck(`${tag} the detail run logs every trading day`, detailed.length === END - START + 1, `${detailed.length} rows for ${END - START + 1} days`);
  ck(`${tag} the detail run logs more than the ordinary run`, detailed.length > ordinary.length, `${ordinary.length} → ${detailed.length}`);
  ck(`${tag} the trades are identical`, tradesOf(ordinary) === tradesOf(detailed));
  const byDate = new Map(detailed.map(row => [row.date, row]));
  const differing = ordinary.filter(row => !byDate.has(row.date) || !sameRow(row, byDate.get(row.date)));
  ck(`${tag} every ordinary row appears unchanged in the detail run`, differing.length === 0, differing.slice(0, 3).map(r => r.date).join(', '));
};

Object.keys(CODE).map(Number).sort((a, b) => a - b).forEach(n => {
  ck(`#${n} the current code needs no upgrade`, CODE.upgradeSavedCode(CODE[n]) === CODE[n]);
  const old = oldCopyOf(CODE[n]);
  ck(`#${n} an old copy ignores the flag`, run(old, { dailyDisplay: true }).length === run(old, {}).length);
  const upgraded = CODE.upgradeDailyDisplay(old);
  ck(`#${n} the upgrade only adds the flag to the row condition`, upgraded !== old && upgraded.replace(/p\.dailyDisplay \|\| /g, '') === old);
  ck(`#${n} the upgrade is idempotent`, CODE.upgradeDailyDisplay(upgraded) === upgraded);
  [{ weeklyDisplay: false }, { weeklyDisplay: true }].forEach(flags => {
    checkDetailRun(`#${n}${flags.weeklyDisplay ? ' (weekly axis)' : ''}`, CODE[n], flags);
    checkDetailRun(`#${n} upgraded old copy${flags.weeklyDisplay ? ' (weekly axis)' : ''}`, upgraded, flags);
  });
});
ck('a strategy whose params object is not `p` is left alone', CODE.upgradeDailyDisplay('({ run(data, params) { const monthEnd = 1; if (contributed !== 0 || x) {} } })').includes('if (contributed !== 0 || x)'));
ck('a strategy without the library cadence line is left alone', CODE.upgradeDailyDisplay('({ run(data, p) { if (contributed !== 0 || x) {} } })').includes('if (contributed !== 0 || x)'));

if (failures) { console.log(`library daily display: ${failures} check(s) failed`); process.exit(1); }
console.log(`library daily display: all checks passed (${Object.keys(CODE).length} strategies)`);
