'use strict';
// Runs a library strategy's code in Node the way tests/library-daily-display.cjs does: the real
// data files, the real engine text, $100K lump sum, every day logged, CAGR and max drawdown from the log.
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..', '..');   // the repo root: data/ and js/ are read from it
vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'js/data.js'), 'utf8'));
const CODE = require(path.join(ROOT, 'js/strategy-library-code.js'));
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
const idxOf = date => data.dates.findIndex(d => d >= date);
const idxBefore = date => { const k = data.dates.findIndex(d => d > date); return k < 0 ? data.dates.length - 1 : k - 1; };   // a date past the data: its last row
const defaultOf = param => (param.default && typeof param.default === 'object' && 'value' in param.default) ? param.default.value : param.default;
const compiled = new Map();
function strategyOf(code) {
  if (!compiled.has(code)) compiled.set(code, new Function('"use strict"; return (' + code + '\n);')());
  return compiled.get(code);
}
function defaultsOf(code) {
  return Object.fromEntries((strategyOf(code).params || []).filter(p => p.id != null).map(p => [p.id, defaultOf(p)]));
}
// Runs code with params over [from, to] (dates, inclusive) and returns { cagr, dd, end, log }.
function run(code, params, from, to, money = {}) {
  const strategy = strategyOf(code);
  const startIdx = typeof from === 'number' ? from : idxOf(from), endIdx = typeof to === 'number' ? to : idxBefore(to);
  const result = strategy.run(data, {
    ...defaultsOf(code), ...params, initial: money.initial == null ? 100000 : money.initial, monthly: 0, annualRaise: 0, contributions: {},
    startIdx, endIdx, entryDate: data.dates[startIdx], exitDate: data.dates[endIdx], dailyDisplay: true,
  });
  const log = Array.isArray(result) ? result : result.log;
  return { ...stats(log), log };
}
function stats(log) {
  const vals = log.map(r => r.value).filter(v => typeof v === 'number' && isFinite(v));
  if (vals.length < 2) return { cagr: NaN, dd: NaN, end: NaN };
  const first = log[0], last = log[log.length - 1];
  const years = (Date.parse(last.date) - Date.parse(first.date)) / (365.25 * 86400000);
  const cagr = (Math.pow(last.value / first.value, 1 / years) - 1) * 100;
  let peak = -Infinity, dd = 0;
  for (const v of vals) { if (v > peak) peak = v; const d = 1 - v / peak; if (d > dd) dd = d; }
  return { cagr, dd: dd * 100, end: last.value, years };
}
module.exports = { CODE, data, daily, run, stats, defaultsOf, strategyOf, idxOf, idxBefore };
if (require.main === module) {
  for (const n of [47, 50, 52]) {
    const t0 = Date.now(); const r = run(CODE[n], {}, '2010-01-01', '2025-12-31');
    console.log(`#${n} 2010-2025: CAGR ${r.cagr.toFixed(1)}% DD ${r.dd.toFixed(1)}% rows ${r.log.length} in ${Date.now() - t0} ms`);
  }
}
