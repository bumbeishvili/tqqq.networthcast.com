'use strict';
// Fit when the deep buy does not fire (a crash that bottoms a little higher than the level): how the re-entry
// settings decide the damage. Deep buy level pushed out of reach (-40, then Off) against re-entry speeds.
const L = require('./lib.cjs'), code = L.CODE[53];
const row = (p) => { const a = L.stat(code, p), y = L.runLog(code, p, '2025-12-31', L.LAST); return `${a.cagr.toFixed(1).padStart(6)}% DD ${a.dd.toFixed(1)} w12 ${a.w12.toFixed(0).padStart(4)} | 2026 ${((y[y.length - 1].value / y[0].value - 1) * 100).toFixed(0)}%`; };
const RE = [[65, 44], [65, 10], [45, 20], [35, 10], [25, 5], [15, 5], [25, 1]];
for (const [name, base] of [['shipped (deep buy -32.5)', {}], ['deep buy -30.5', { deepLead: -30.5 }], ['deep buy -34 (misses March 2020 by 0.6)', { deepLead: -34 }], ['deep buy -40 (misses both)', { deepLead: -40 }], ['deep buy Off', { deepLead: -9999 }]]) {
  console.log(name);
  for (const [lead, closes] of RE) console.log(`   re-entry ${lead}% x ${closes} closes: ${row({ ...base, reentryLead: lead, reentryCloses: closes })}`);
}
console.log('floor scan at re-entry 65x44 (shipped) and 25x5:');
for (const [lead, closes] of [[65, 44], [25, 5]]) { let line = ''; for (let f = 0; f <= 14; f += 1) line += `${f}:${L.stat(code, { floorLead: f, reentryLead: lead, reentryCloses: closes }).cagr.toFixed(0)} `; console.log(`   ${lead}x${closes}: ${line}`); }
