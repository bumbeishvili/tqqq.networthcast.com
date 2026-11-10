'use strict';
// A settings change on the periods outside the 2010 horizon, for the record: 1953, 1983, 2005 starts.
const L = require('./lib.cjs'), n = +process.argv[2], sets = JSON.parse(process.argv[3]);
for (const [name, p] of Object.entries(sets)) {
  const cells = [['1953-01-02', L.LAST], ['1982-12-31', L.LAST], ['1994-12-30', '2009-12-31'], ['2004-12-31', L.LAST], ['2009-12-31', '2025-12-31'], ['2025-12-31', L.LAST]].map(([a, b]) => { const s = L.stat(L.CODE[n], p, a, b); return `${a.slice(0, 4)}-${b.slice(0, 4)}: ${s.cagr.toFixed(1)}% DD ${s.dd.toFixed(0)}`; });
  console.log(name.padEnd(26), cells.join(' | '));
}
