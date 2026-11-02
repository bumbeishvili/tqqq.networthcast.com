// Local-only data for strategies that read funds the site does not carry
// (data/local/README.md). Downloads each series' full daily history from
// Yahoo's chart API, adjusted for dividends and splits (indexes as quoted),
// and writes <key>.tsv in the site's data format plus index.json, which the
// site's js/data.js reads when this folder exists. Never run by the daily
// updater; rerun by hand to refresh:  node data/local/fetch.cjs
const fs = require('fs'), path = require('path');
const SERIES = [
  ['vix', '^VIX'], ['vvix', '^VVIX'], ['gld', 'GLD'], ['slv', 'SLV'], ['iwm', 'IWM'], ['tlt', 'TLT'],
  ['btal', 'BTAL'], ['hyg', 'HYG'], ['mtum', 'MTUM'], ['xlf', 'XLF'], ['xlk', 'XLK'], ['xle', 'XLE'],
  ['spmo', 'SPMO'], ['uvxy', 'UVXY'], ['soxl', 'SOXL'], ['tecl', 'TECL'], ['ugl', 'UGL'], ['bil', 'BIL'],
];
const usDate = iso => { const [y, m, d] = iso.split('-'); return `${+m}/${+d}/${y} 16:00:00`; };
async function fetchSeries(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=0&period2=${Math.floor(Date.now() / 1000)}&interval=1d&events=div%2Csplit&includeAdjustedClose=true`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`${symbol}: HTTP ${res.status}`);
  const r = (await res.json()).chart.result[0], q = r.indicators.quote[0];
  const adj = (r.indicators.adjclose || [{}])[0].adjclose || q.close;
  return r.timestamp.map((ts, i) => [new Date((ts + r.meta.gmtoffset) * 1000).toISOString().slice(0, 10), adj[i]]).filter(([, v]) => v > 0);
}
(async () => {
  const index = { fetched: new Date().toISOString(), series: [] };
  for (const [key, symbol] of SERIES) {
    const rows = await fetchSeries(symbol);
    fs.writeFileSync(path.join(__dirname, key + '.tsv'), 'Date\tClose\n' + rows.map(([d, v]) => `${usDate(d)}\t${v}`).join('\n') + '\n');
    index.series.push({ key, symbol, file: key + '.tsv', from: rows[0][0], to: rows[rows.length - 1][0] });
    console.log(`${symbol.padEnd(6)} ${rows.length} days, ${rows[0][0]} .. ${rows[rows.length - 1][0]}`);
    await new Promise(r => setTimeout(r, 300));
  }
  fs.writeFileSync(path.join(__dirname, 'index.json'), JSON.stringify(index, null, 2) + '\n');
})().catch(err => { console.error(err.message); process.exit(1); });
