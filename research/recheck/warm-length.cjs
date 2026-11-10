'use strict';
// How long the memory before the Entry has to be: for sampled entry days, the holdings over the next 400 days with a
// warm-up of k windows against a warm-up over the whole history.
const L = require('./lib.cjs');
const { CODE, data, idxOf, runOn } = L;
const withWarm = (code, expr) => { const a = 'WARM = 3 * W;'; if (code.split(a).length !== 2) throw new Error('WARM anchor'); return code.split(a).join(`WARM = ${expr};`); };
const SETS = [[48, {}, 'NFCI + Mon'], [49, { exitPct: -3, confirmDays: 5, bbPct: -34 }, 'Buy-back + Mon, new defaults'], [49, {}, 'Buy-back + Mon, +10/4/-32']];
const spans = [['2010-01-04', '2024-12-31', 5], ['1975-01-02', '2009-12-31', 10]];
for (const [n, params, name] of SETS) {
  const ref = withWarm(CODE[n], '100000');
  for (const [a, b, stepDays] of spans) {
    const s = idxOf(a), e = idxOf(b), entries = []; for (let i = s; i <= e; i += stepDays) entries.push(i);
    const refHeld = entries.map(i => runOn(data, ref, params, i, Math.min(i + 400, data.dates.length - 1)).map(r => r.held));
    const cells = [];
    for (const k of ['0', '1 * W', '2 * W', '3 * W', '5 * W', '8 * W']) {
      const code = withWarm(CODE[n], k); let differ = 0, days = 0, worst = 0;
      entries.forEach((i, j) => { const h = runOn(data, code, params, i, Math.min(i + 400, data.dates.length - 1)).map(r => r.held); let d = 0; for (let x = 0; x < h.length; x++) if (h[x] !== refHeld[j][x]) d++; if (d) { differ++; days += d; worst = Math.max(worst, d); } });
      cells.push(`${k.replace(' * W', 'W')}: ${differ} (${days}d, worst ${worst})`);
    }
    console.log(`${name.padEnd(30)} entries ${a.slice(0, 4)}-${b.slice(0, 4)} (${entries.length}): differing from an all-history memory | ${cells.join(' | ')}`);
  }
}
