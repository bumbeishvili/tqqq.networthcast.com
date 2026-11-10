'use strict';
// One-setting scans around the defaults, 2010-2025: where each setting's flat stretch lies and where its cliffs are.
//   node scan.cjs <n> [paramsJSON] [label]
const fs = require('fs'), path = require('path'), L = require('./lib.cjs');
const { CODE, NAMES, stat } = L;
const n = +process.argv[2], params = JSON.parse(process.argv[3] || '{}'), label = process.argv[4] || String(n);
const code = CODE[n], base = { ...L.defaultsOf(code), ...params };
const range = (a, b, s) => { const o = []; for (let v = a; v <= b + 1e-9; v += s) o.push(+v.toFixed(3)); return o; };
const around = (v, lo, hi, s) => range(v + lo, v + hi, s);
const GRID = {
  lookbackDays: v => around(v, -60, 60, 2), startAvgDays: v => around(v, -40, 40, 2).filter(x => x >= 0),
  topLead: v => around(v, -25, 25, 1), backLead: v => around(v, -20, 20, 1), floorLead: v => around(v, -12, 12, 1), reentryLead: v => around(v, -30, 15, 2.5),
  deepLead: v => around(v, -8, 16, 0.5), topDays: v => around(v, -40, 40, 4).filter(x => x >= 1), reentryCloses: v => (v > 20 ? around(v, -40, 40, 4) : range(1, 15, 1)).filter(x => x >= 1),
  overPct: v => around(v, -12, 12, 0.5), overWindow: v => around(v, -45, 45, 3), sqqqMaxDays: v => around(v, -14, 40, 2).filter(x => x >= 2),
  soxlLeadDays: v => around(v, -100, 100, 10), soxlLeadEnter: v => around(v, -25, 25, 2.5), soxlLeadExit: v => around(v, -50, 50, 5),
  window: v => around(v, -45, 45, 3), exitPct: v => around(v, -10, 10, 0.5), slopeGate: v => around(v, -20, 20, 2), belowGate: v => range(0, 24, 2), nfciTh: v => range(0.2, 0.8, 0.05),
  confirmDays: v => range(1, 10, 1), dipReentry: v => range(0, 100, 10), bbPct: v => around(v, -10, 10, 0.5), sliceStop: v => range(5, 40, 5),
};
const out = { n, base, baseCagr: stat(code, params).cagr, scans: {} };
for (const id of L.fitIds(code)) {
  if (!GRID[id] || typeof base[id] !== 'number' || Math.abs(base[id]) >= 999) continue;
  out.scans[id] = GRID[id](base[id]).map(v => { const s = stat(code, { ...params, [id]: v }); return { v, cagr: +s.cagr.toFixed(1), dd: +s.dd.toFixed(1) }; });
}
fs.mkdirSync(path.join(__dirname, 'out'), { recursive: true }); fs.writeFileSync(path.join(__dirname, 'out', `scan-${label}.json`), JSON.stringify(out));
console.log(`== ${NAMES[n]} ${JSON.stringify(params)}: base ${out.baseCagr.toFixed(1)}%`);
// The flat stretch around the default: values in a row whose CAGR stays within TOL points of the base.
const TOL = 0.05 * out.baseCagr;
for (const [id, rows] of Object.entries(out.scans)) {
  const k0 = rows.reduce((b, r, k) => Math.abs(r.v - base[id]) < Math.abs(rows[b].v - base[id]) ? k : b, 0);
  let lo = k0, hi = k0; while (lo > 0 && rows[lo - 1].cagr >= out.baseCagr - TOL) lo--; while (hi < rows.length - 1 && rows[hi + 1].cagr >= out.baseCagr - TOL) hi++;
  const best = rows.reduce((b, r) => r.cagr > b.cagr ? r : b);
  console.log(`  ${id.padEnd(14)} default ${String(base[id]).padEnd(6)} flat (within 5%) ${rows[lo].v}..${rows[hi].v}${lo === 0 ? ' (scan edge)' : ''}${hi === rows.length - 1 ? ' (scan edge)' : ''} | below it ${lo > 0 ? rows[lo - 1].cagr : '-'}, above it ${hi < rows.length - 1 ? rows[hi + 1].cagr : '-'} | scan min ${Math.min(...rows.map(r => r.cagr))} | best ${best.cagr} at ${best.v}`);
}
