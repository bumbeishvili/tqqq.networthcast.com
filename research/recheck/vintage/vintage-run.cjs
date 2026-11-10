'use strict';
// The same strategies on older NFCI vintages (what the backtest showed when that vintage was the data file).
// Needs full-<date>.csv beside this file, one per vintage:
//   curl -s 'https://alfred.stlouisfed.org/graph/alfredgraph.csv?id=NFCI&vintage_date=2025-04-09&cosd=1971-01-01&coed=2025-04-09' -o full-2025-04-09.csv
const fs = require('fs'), L = require('../lib.cjs');
const { CODE, data, NAMES, idxOf, idxBefore, runOn, statsOfLog } = L;
const cur = data.nfci;
for (const v of ['current', '2023-03-29', '2024-08-07', '2025-04-09']) {
  let nf = cur;
  if (v !== 'current') {
    const rows = fs.readFileSync(`${__dirname}/full-${v}.csv`, 'utf8').trim().split('\n').slice(1).map(l => l.split(',')).filter(r => r[1] !== '.' && r[1] !== '').map(r => [r[0], +r[1]]);
    const avail = rows.map(([d, x]) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + 7); return [t.toISOString().slice(0, 10), x]; });
    nf = new Array(data.dates.length); let j = 0, c = NaN;
    for (let i = 0; i < data.dates.length; i++) { while (j < avail.length && avail[j][0] <= data.dates[i]) { c = avail[j][1]; j++; } nf[i] = c; }
    // past the vintage's end the current file continues (the comparison is about history)
    const lastAvail = avail[avail.length - 1][0]; for (let i = 0; i < data.dates.length; i++) if (data.dates[i] > lastAvail) nf[i] = cur[i];
  }
  const d = { ...data, nfci: nf }, s = idxOf('2009-12-31'), e = idxBefore('2025-12-31');
  const maxSince = Math.max(...nf.slice(s, e + 1));
  const cells = [48, 50, 53].map(n => { const log = runOn(d, CODE[n], {}, s, e), st = statsOfLog(log); const y20 = log.filter(r => r.date >= '2019-12-31' && r.date <= '2020-12-31'); return `${NAMES[n]} ${st.cagr.toFixed(1)}% DD ${st.dd.toFixed(1)} (2020: ${((y20[y20.length - 1].value / y20[0].value - 1) * 100).toFixed(0)}%)`; });
  console.log(`vintage ${v.padEnd(10)} max NFCI 2010-25 ${maxSince.toFixed(2)} | ${cells.join(' | ')}`);
}
