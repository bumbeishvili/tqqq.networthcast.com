'use strict';
// Robustness scorecard of one strategy at given settings, 2010-2025 ($100K lump sum).
//   node score.cjs <n> [paramsJSON] [label]   -> out/score-<label>.json and a printed summary
const fs = require('fs'), path = require('path');
const L = require('./lib.cjs');
const { CODE, data, NAMES, idxOf, idxBefore, runOn, statsOfLog, statsOfValues, weightsOf, replay, rng, gauss } = L;
// Steps in each setting's own units: the first two are "near" (a slightly different choice), the rest "far".
const STEPS = {
  lookbackDays: [3, 7, 14, 28], startAvgDays: [5, 10, 20], topLead: [1, 2, 5, 10], backLead: [1, 2, 5, 10], floorLead: [1, 2, 5], reentryLead: [1, 2, 5, 10], deepLead: [1, 2, 5],
  topDays: [2, 5, 10], reentryCloses: [1, 2, 5], overPct: [1, 2, 5], overWindow: [5, 10, 25], sqqqMaxDays: [2, 5, 10], deepGuard: [5, 10], nfciVeto: [0.1, 0.2],
  soxlLeadDays: [10, 20, 40], soxlLeadEnter: [5, 10], soxlLeadExit: [5, 10, 20],
  window: [5, 10, 25], exitPct: [1, 2, 5], slopeGate: [5, 10], belowGate: [2, 5], nfciTh: [0.1, 0.2],
  confirmDays: [1, 2], dipReentry: [10, 25], bbPct: [1, 2, 5], sliceStop: [5, 10],
};
const MIN = { topDays: 1, reentryCloses: 1, confirmDays: 1, belowGate: 0, sqqqMaxDays: 1, startAvgDays: 0, deepGuard: 5, nfciVeto: 0.1, nfciTh: 0, dipReentry: 0 };
const MAX = { dipReentry: 100 };
function neighbours(code, params) {
  const base = { ...L.defaultsOf(code), ...params }, out = [];
  for (const id of L.fitIds(code)) {
    if (!STEPS[id] || typeof base[id] !== 'number' || Math.abs(base[id]) >= 999) continue;
    STEPS[id].forEach((s, k) => { for (const sign of [-1, 1]) { const v = +(base[id] + sign * s).toFixed(4); if (MIN[id] != null && v < MIN[id]) continue; if (MAX[id] != null && v > MAX[id]) continue; out.push({ id, step: sign * s, near: k < 2, params: { ...params, [id]: v } }); } });
  }
  return out;
}
// Prices nudged at every close: QQQ by sigma (a common move), SPY 0.8 of it plus its own, SOXX its own with 0.8 correlation,
// the 3x funds three times their index. Decisions are read off this path and replayed on the true prices.
function noisyData(seed, sigma) {
  const r = rng(seed), n = data.dates.length, d = { ...data }, from = idxOf('2006-01-03');
  const f = (k) => Float64Array.from(data[k]);
  const out = { tqqq: f('tqqq'), qqq: f('qqq'), sqqq: f('sqqq'), spy: f('spy'), soxl: f('soxl'), soxx: f('soxx') };
  for (let i = from; i < n; i++) {
    const zq = gauss(r) * sigma, zs = 0.8 * zq + 0.6 * gauss(r) * sigma * 0.5, zx = (0.8 * zq / sigma + 0.6 * gauss(r)) * sigma * 1.6;
    out.qqq[i] *= Math.exp(zq); out.tqqq[i] *= Math.exp(3 * zq); out.sqqq[i] *= Math.exp(-3 * zq); out.spy[i] *= Math.exp(zs); out.soxx[i] *= Math.exp(zx); out.soxl[i] *= Math.exp(3 * zx);
  }
  return Object.assign(d, Object.fromEntries(Object.entries(out).map(([k, v]) => [k, Array.from(v)])));
}
function scorecard(code, params, { from = L.FIT_FROM, to = L.FIT_TO, seeds = 40, quick = false } = {}) {
  const s = idxOf(from), e = idxBefore(to), dates = data.dates.slice(s, e + 1);
  const base = runOn(data, code, params, s, e), st = statsOfLog(base), p = { ...L.defaultsOf(code), ...params };
  const cagrOf = (prm, a = s, b = e, d = data) => statsOfLog(runOn(d, code, prm, a, b)).cagr;
  const mid = idxBefore('2017-12-29'), out = { base: { cagr: st.cagr, dd: st.dd, w12: st.w12 } };
  out.halves = [cagrOf(params, s, mid), cagrOf(params, mid, e)];
  out.y2026 = (() => { const lg = runOn(data, code, params, idxBefore('2025-12-31'), idxBefore(L.LAST)); return (lg[lg.length - 1].value / lg[0].value - 1) * 100; })();
  // neighbourhood
  const nb = neighbours(code, params).map(x => ({ id: x.id, step: x.step, near: x.near, cagr: cagrOf(x.params) }));
  const q = (arr, f) => { const a = [...arr].sort((x, y) => x - y); return a.length ? a[Math.min(a.length - 1, Math.floor(f * (a.length - 1) + 0.5))] : NaN; };
  const near = nb.filter(x => x.near).map(x => x.cagr), all = nb.map(x => x.cagr);
  out.neighbourhood = { count: nb.length, nearMin: Math.min(...near), nearP10: q(near, 0.1), nearMedian: q(near, 0.5), allMin: Math.min(...all), allP10: q(all, 0.1), allMedian: q(all, 0.5), table: nb };
  // execution sensitivity
  const w = weightsOf(base), rp = (weights, opts) => statsOfValues(dates, replay(dates, weights, { startIdx: s, ...opts }));
  out.replayCheck = rp(w, {}).cagr;
  out.cost01 = rp(w, { cost: 0.001 }).cagr; out.cash0 = rp(w, { cashRate: 0 }).cagr; out.cash2 = rp(w, { cashRate: 2 }).cagr;
  const late = w.map((x, k) => k === 0 ? x : w[k - 1]); out.oneDayLate = rp(late, {});
  if (!quick) {
    for (const sigma of [0.001, 0.002]) {
      const res = [];
      for (let k = 0; k < seeds; k++) { const d = noisyData(1000 + k, sigma), lg = runOn(d, code, params, s, e); res.push(rp(weightsOf(lg), {}).cagr); }
      out['noise' + sigma * 1000] = { min: Math.min(...res), p10: q(res, 0.1), median: q(res, 0.5), max: Math.max(...res), all: res.map(x => +x.toFixed(1)) };
    }
    // entry dates: does a later entry hold what the long run holds?
    const r = rng(5), entries = [];
    for (let k = 0; k < 40; k++) {
      const a = s + 100 + Math.floor(r() * (e - s - 400)), lg = runOn(data, code, params, a, e);
      let diff = 0; for (let j = 0; j < lg.length; j++) if (lg[j].held !== base[a - s + j].held) diff++;
      entries.push({ date: data.dates[a], diffDays: diff, ratio: (lg[lg.length - 1].value / lg[0].value) / (base[base.length - 1].value / base[a - s].value) });
    }
    out.entries = { differing: entries.filter(x => x.diffDays > 0).length, of: entries.length, worstRatio: Math.min(...entries.map(x => x.ratio)), bestRatio: Math.max(...entries.map(x => x.ratio)), maxDiffDays: Math.max(...entries.map(x => x.diffDays)) };
  }
  // concentration: calendar years and the best one left out
  const years = {}; for (const row of base) { const y = row.date.slice(0, 4); (years[y] = years[y] || []).push(row.value); }
  const ys = Object.keys(years).sort(), yr = []; let prev = base[0].value;
  for (const y of ys) { const v = years[y][years[y].length - 1]; if (y !== ys[0] || years[y].length > 5) yr.push({ y, ret: (v / prev - 1) * 100 }); prev = v; }
  const logs = yr.map(x => Math.log(1 + x.ret / 100)), tot = logs.reduce((a, b) => a + b, 0), best = Math.max(...logs);
  out.years = yr.map(x => ({ y: x.y, ret: +x.ret.toFixed(0) }));
  out.exBestYear = (Math.exp((tot - best) / (yr.length - 1)) - 1) * 100; out.bestYearShare = best / tot * 100;
  out.yearsUnderBH = yr.filter(x => { const a = idxBefore((+x.y - 1) + '-12-31'), b = idxBefore(x.y + '-12-31'); return x.ret < (data.tqqq[b] / data.tqqq[Math.max(a, s)] - 1) * 100; }).length;
  out.losingYears = yr.filter(x => x.ret < 0).map(x => x.y + ' ' + x.ret.toFixed(0) + '%');
  out.days = base.reduce((m, x) => (m[x.held] = (m[x.held] || 0) + 1, m), {}); out.trades = base.filter(x => x.action === 'buy' || x.action === 'sell' || x.action === 'switch').length;
  return out;
}
module.exports = { scorecard, neighbours, noisyData, STEPS };
if (require.main === module) {
  const n = +process.argv[2], params = JSON.parse(process.argv[3] || '{}'), label = process.argv[4] || String(n);
  const t0 = Date.now(), sc = scorecard(CODE[n], params);
  fs.mkdirSync(path.join(__dirname, 'out'), { recursive: true }); fs.writeFileSync(path.join(__dirname, 'out', `score-${label}.json`), JSON.stringify(sc, null, 1));
  const f = (x) => x.toFixed(1);
  console.log(`== ${NAMES[n]} ${JSON.stringify(params)} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  console.log(` base ${f(sc.base.cagr)}% DD ${f(sc.base.dd)} w12 ${f(sc.base.w12)} | halves ${f(sc.halves[0])} / ${f(sc.halves[1])} | 2026 ${f(sc.y2026)}% | trades ${sc.trades} | days ${JSON.stringify(sc.days)}`);
  console.log(` neighbours (${sc.neighbourhood.count}): near min ${f(sc.neighbourhood.nearMin)} p10 ${f(sc.neighbourhood.nearP10)} median ${f(sc.neighbourhood.nearMedian)} | all min ${f(sc.neighbourhood.allMin)} p10 ${f(sc.neighbourhood.allP10)} median ${f(sc.neighbourhood.allMedian)}`);
  const byId = {}; for (const x of sc.neighbourhood.table) (byId[x.id] = byId[x.id] || []).push(x);
  for (const [id, xs] of Object.entries(byId)) console.log('   ' + id.padEnd(15) + xs.sort((a, b) => a.step - b.step).map(x => `${x.step > 0 ? '+' : ''}${x.step}:${x.cagr.toFixed(0)}`).join('  '));
  console.log(` replay check ${f(sc.replayCheck)} | cost 0.1% ${f(sc.cost01)} | cash 0% ${f(sc.cash0)} cash 2% ${f(sc.cash2)} | one day late ${f(sc.oneDayLate.cagr)} (DD ${f(sc.oneDayLate.dd)})`);
  console.log(` decision noise 0.1% QQQ: min ${f(sc.noise1.min)} p10 ${f(sc.noise1.p10)} median ${f(sc.noise1.median)} max ${f(sc.noise1.max)} | 0.2%: min ${f(sc.noise2.min)} p10 ${f(sc.noise2.p10)} median ${f(sc.noise2.median)} max ${f(sc.noise2.max)}`);
  console.log(` entry dates: ${sc.entries.differing} of ${sc.entries.of} hold something else at some point (most ${sc.entries.maxDiffDays} days), growth ratio vs the long run ${sc.entries.worstRatio.toFixed(2)}..${sc.entries.bestRatio.toFixed(2)}`);
  console.log(` years: ${sc.years.map(x => x.y.slice(2) + ':' + x.ret).join(' ')} | without the best year ${f(sc.exBestYear)}% (it carries ${f(sc.bestYearShare)}% of the log growth) | years under B&H TQQQ ${sc.yearsUnderBH} | losing years ${sc.losingYears.join(', ') || 'none'}`);
}
