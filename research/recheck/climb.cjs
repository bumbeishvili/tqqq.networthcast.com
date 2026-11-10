'use strict';
// Robust re-centring by hill-climb: maximise  (worst near neighbour) + 0.3 x (CAGR at the settings)  on 2010-2025,
// where the near neighbours are every tunable number moved one and two small steps either way (score.cjs STEPS).
// One setting at a time, pass after pass. CAGR may not fall more than LOSS% under the start, DD not rise 2 points.
//   node climb.cjs <n> [paramsJSON] [label] [loss%]
const fs = require('fs'), path = require('path'), L = require('./lib.cjs');
const { CODE, NAMES, stat } = L, { STEPS } = require('./score.cjs');
const n = +process.argv[2], start = JSON.parse(process.argv[3] || '{}'), label = process.argv[4] || String(n), LOSS = +(process.argv[5] || 6) / 100;
const code = CODE[n], defaults = L.defaultsOf(code);
const MIN = { topDays: 1, reentryCloses: 1, confirmDays: 1, belowGate: 0, sqqqMaxDays: 2, startAvgDays: 0, deepGuard: 5, nfciVeto: 0.1, nfciTh: 0.05, dipReentry: 0 }, MAX = { dipReentry: 100 };
const ids = L.fitIds(code).filter(id => STEPS[id] && typeof defaults[id] === 'number' && Math.abs(defaults[id]) < 999);
const memo = new Map();
const run1 = (p) => { const k = ids.map(id => p[id]).join('|'); if (!memo.has(k)) { const s = stat(code, p); memo.set(k, { cagr: s.cagr, dd: s.dd }); } return memo.get(k); };
const full = (p) => ({ ...Object.fromEntries(ids.map(id => [id, defaults[id]])), ...p });
const okv = (id, v) => !(MIN[id] != null && v < MIN[id]) && !(MAX[id] != null && v > MAX[id]);
function S(p) {
  const base = run1(p); let worst = Infinity, worstAt = '';
  for (const id of ids) for (const s of STEPS[id].slice(0, 2)) for (const sg of [-1, 1]) { const v = +(p[id] + sg * s).toFixed(4); if (!okv(id, v)) continue; const c = run1({ ...p, [id]: v }).cagr; if (c < worst) { worst = c; worstAt = `${id} ${sg > 0 ? '+' : ''}${sg * s}`; } }
  return { score: worst + 0.3 * base.cagr, worst, worstAt, cagr: base.cagr, dd: base.dd };
}
let cur = full(start), best = S(cur); const base0 = best.cagr, dd0 = best.dd;
console.log(`== ${NAMES[n]} start: ${best.cagr.toFixed(1)}% DD ${best.dd.toFixed(1)}, worst near neighbour ${best.worst.toFixed(1)} (${best.worstAt})`);
for (let pass = 1; pass <= 8; pass++) {
  let moved = 0;
  for (const id of ids) {
    let pick = null, pickS = best;
    for (const s of STEPS[id].slice(0, 3)) for (const sg of [-1, 1]) {
      const v = +(cur[id] + sg * s).toFixed(4); if (!okv(id, v)) continue;
      const cand = { ...cur, [id]: v }, b = run1(cand); if (b.cagr < base0 * (1 - LOSS) || b.dd > dd0 + 2) continue;
      const sc = S(cand); if (sc.score > pickS.score + 0.05) { pick = cand; pickS = sc; }
    }
    if (pick) { console.log(`  pass ${pass} ${id.padEnd(14)} ${cur[id]} -> ${pick[id]}: ${pickS.cagr.toFixed(1)}% DD ${pickS.dd.toFixed(1)}, worst ${pickS.worst.toFixed(1)} (${pickS.worstAt})`); cur = pick; best = pickS; moved++; }
  }
  if (!moved) break;
}
const changed = Object.fromEntries(ids.filter(id => cur[id] !== defaults[id]).map(id => [id, cur[id]]));
console.log(`  result: ${best.cagr.toFixed(1)}% DD ${best.dd.toFixed(1)}, worst near neighbour ${best.worst.toFixed(1)} (${best.worstAt}); changed ${JSON.stringify(changed)}; ${memo.size} runs`);
fs.writeFileSync(path.join(__dirname, 'out', `climb-${label}.json`), JSON.stringify({ n, start, loss: LOSS, params: changed, cagr: best.cagr, dd: best.dd, worst: best.worst }));
