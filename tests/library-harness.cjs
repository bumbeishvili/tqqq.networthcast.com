/*
 * What the library's Node tests share: the library's code, the price history as the
 * app hands it to a code strategy (buildCustomData), and the helpers that turn an
 * entry's text into a strategy and read its settings' defaults.
 *
 *   const { CODE, data, strategyOf, settingsOf, defaultsOf } = require('./library-harness.cjs');
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'js/data.js'), 'utf8'));   // parseDataFile, buildDaily, buildNfciDaily
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

// Library entry n as a strategy object, its settings (the entries of params with an id), and their defaults by id.
const strategyOf = n => new Function('"use strict"; return (' + CODE[n] + '\n);')();
const settingsOf = strategy => strategy.params.filter(param => param.id != null);
const defaultOf = param => (param.default && typeof param.default === 'object' && 'value' in param.default) ? param.default.value : param.default;
const defaultsOf = strategy => Object.fromEntries(settingsOf(strategy).map(param => [param.id, defaultOf(param)]));

module.exports = { CODE, data, strategyOf, settingsOf, defaultsOf };
