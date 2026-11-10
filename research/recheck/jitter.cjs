'use strict';
// Joint jitter: every tunable number moved at once by a random amount inside a box around the settings
// (near box = up to the second small step of score.cjs STEPS, wide box = up to the third). Each draw is one
// "slightly different choice in every dropdown". Reports the spread of 2010-2025 CAGR over the draws, and the
// sleeve portfolio that holds all the draws at once (equal money, never rebalanced / rebalanced daily).
//   node jitter.cjs <n> [paramsJSON] [label] [draws]
const fs = require('fs'), path = require('path'), L = require('./lib.cjs');
const { CODE, NAMES, data, idxOf, idxBefore, runOn, statsOfLog, statsOfValues, weightsOf, replay, rng } = L, { STEPS } = require('./score.cjs');
const INT = new Set(['lookbackDays', 'startAvgDays', 'topDays', 'reentryCloses', 'overWindow', 'sqqqMaxDays', 'soxlLeadDays', 'window', 'belowGate', 'confirmDays']);
const MIN = { topDays: 1, reentryCloses: 1, confirmDays: 1, belowGate: 0, sqqqMaxDays: 2, startAvgDays: 0, deepGuard: 5, nfciVeto: 0.1, nfciTh: 0.05, dipReentry: 0 };
function draws(code, params, count, boxStep, seed = 77) {
  const defaults = L.defaultsOf(code), base = { ...defaults, ...params }, r = rng(seed);
  const ids = L.fitIds(code).filter(id => STEPS[id] && typeof base[id] === 'number' && Math.abs(base[id]) < 999);
  return Array.from({ length: count }, () => { const p = { ...params }; for (const id of ids) { const w = STEPS[id][Math.min(boxStep, STEPS[id].length - 1)]; let v = base[id] + (2 * r() - 1) * w; v = INT.has(id) ? Math.round(v) : +v.toFixed(1); if (MIN[id] != null && v < MIN[id]) v = MIN[id]; p[id] = v; } return p; });
}
function evaluate(code, members, from = L.FIT_FROM, to = L.FIT_TO) {
  const s = idxOf(from), e = idxBefore(to), dates = data.dates.slice(s, e + 1), logs = members.map(p => runOn(data, code, p, s, e));
  const each = logs.map(statsOfLog);
  const sleeves = (K) => {
    const part = logs.slice(0, K), never = dates.map((_, t) => part.reduce((a, lg) => a + lg[t].value / lg[0].value, 0) / K);
    const ws = part.map(weightsOf), avg = dates.map((_, t) => { const w = {}; for (const m of ws) for (const [f, x] of Object.entries(m[t])) w[f] = (w[f] || 0) + x / K; return w; });
    return { never: statsOfValues(dates, never), daily: statsOfValues(dates, replay(dates, avg, { startIdx: s })) };
  };
  return { each, sleeves };
}
module.exports = { draws, evaluate };
if (require.main === module) {
  const n = +process.argv[2], params = JSON.parse(process.argv[3] || '{}'), label = process.argv[4] || String(n), COUNT = +(process.argv[5] || 120);
  const code = CODE[n], q = (a, f) => { const b = [...a].sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.round(f * (b.length - 1)))]; };
  const centre = statsOfLog(L.runLog(code, params)); const out = { n, params, centre: { cagr: centre.cagr, dd: centre.dd } };
  console.log(`== ${NAMES[n]} ${JSON.stringify(params)}: at the settings ${centre.cagr.toFixed(1)}% DD ${centre.dd.toFixed(1)}`);
  for (const [name, boxStep] of [['near', 1], ['wide', 2]]) {
    const ev = evaluate(code, draws(code, params, COUNT, boxStep)), c = ev.each.map(x => x.cagr), d = ev.each.map(x => x.dd);
    const row = { p5: q(c, 0.05), p25: q(c, 0.25), median: q(c, 0.5), p75: q(c, 0.75), max: q(c, 1), min: q(c, 0), ddMedian: q(d, 0.5), ddWorst: q(d, 1) };
    const sl = Object.fromEntries([5, 10, 20, COUNT].map(K => [K, ev.sleeves(K)]));
    out[name] = { ...row, sleeves: Object.fromEntries(Object.entries(sl).map(([K, v]) => [K, { never: { cagr: v.never.cagr, dd: v.never.dd, w12: v.never.w12 }, daily: { cagr: v.daily.cagr, dd: v.daily.dd, w12: v.daily.w12 } }])) };
    console.log(` ${name} box, ${COUNT} draws: CAGR min ${row.min.toFixed(0)} p5 ${row.p5.toFixed(0)} p25 ${row.p25.toFixed(0)} median ${row.median.toFixed(0)} p75 ${row.p75.toFixed(0)} max ${row.max.toFixed(0)} | DD median ${row.ddMedian.toFixed(0)} worst ${row.ddWorst.toFixed(0)}`);
    console.log('   sleeves: ' + Object.entries(sl).map(([K, v]) => `${K}: never rebalanced ${v.never.cagr.toFixed(1)}% DD ${v.never.dd.toFixed(1)} w12 ${v.never.w12.toFixed(0)}; daily ${v.daily.cagr.toFixed(1)}% DD ${v.daily.dd.toFixed(1)} w12 ${v.daily.w12.toFixed(0)}`).join(' | '));
  }
  fs.writeFileSync(path.join(__dirname, 'out', `jitter-${label}.json`), JSON.stringify(out));
}
