'use strict';
// Fit, robust climb and sleeves as functions over any window, for the out-of-sample experiments.
const L = require('./lib.cjs'), { STEPS } = require('./score.cjs'), J = require('./jitter.cjs');
const { CODE, data, idxOf, idxBefore, runOn, statsOfLog, statsOfValues, weightsOf, replay } = L;
const SKIP = new Set(['soxlPile', 'pileHandover', 'pileFloor', 'asset']);
const MIN = { topDays: 1, reentryCloses: 1, confirmDays: 1, belowGate: 0, sqqqMaxDays: 2, startAvgDays: 0, deepGuard: 5, nfciVeto: 0.1, nfciTh: 0.05, dipReentry: 0 }, MAX = { dipReentry: 100 };
const okv = (id, v) => !(MIN[id] != null && v < MIN[id]) && !(MAX[id] != null && v > MAX[id]);
// A memoised CAGR/DD measure of `code` over [from, to].
function measurer(code, from, to) {
  const s = idxOf(from), e = idxBefore(to), memo = new Map(), ids = L.fitIds(code);
  const f = (p) => { const k = ids.map(id => p[id]).join('|'); if (!memo.has(k)) { let st; try { st = statsOfLog(runOn(data, code, p, s, e)); } catch (err) { st = { cagr: -1e9, dd: 100 }; } memo.set(k, { cagr: isFinite(st.cagr) ? st.cagr : -1e9, dd: st.dd }); } return memo.get(k); };
  f.runs = () => memo.size; return f;
}
// The app's Fit (Best CAGR) from `start` (a full settings object).
function fit(code, start, m) {
  const space = L.fitIds(code).filter(id => !SKIP.has(id)).map(id => ({ id, values: L.optionValues(code, id) }));
  const better = (a, b) => a.cagr > b.cagr + 1e-9 || (Math.abs(a.cagr - b.cagr) <= 1e-9 && a.dd < b.dd - 1e-9);
  const between = (sp, picked) => { if (!sp.values.every(v => typeof v === 'number')) return []; const plain = sp.values.filter(v => Math.abs(v) < 999).sort((a, b) => a - b), k = plain.indexOf(picked); if (k < 0) return []; const whole = plain.every(Number.isInteger), out = new Set();
    for (const nb of [plain[k - 1], plain[k + 1]]) { if (nb == null) continue; const gap = nb - picked; if (whole) { const c = Math.min(Math.abs(gap) - 1, 20); for (let i = 1; i <= c; i++) out.add(Math.round(picked + gap * i / (c + 1))); } else for (let i = 1; i < 5; i++) out.add(+(picked + gap * i / 5).toFixed(3)); }
    out.delete(picked); return [...out]; };
  const cur = { ...start }; let best = m(cur);
  const sweep = (sp, values) => { let pick = null, pb = best; for (const v of values) { if (v === cur[sp.id]) continue; const r = m({ ...cur, [sp.id]: v }); if (better(r, pb)) { pick = v; pb = r; } } if (pick === null) return false; cur[sp.id] = pick; best = pb; return true; };
  for (let round = 1; round <= 4; round++) { let changed = false; for (const sp of space) if (sweep(sp, sp.values)) changed = true; if (!changed) break; }
  for (const sp of space) sweep(sp, between(sp, cur[sp.id]));
  return { params: cur, cagr: best.cagr, dd: best.dd };
}
// Start k > 0: the settings with `redraw` of them redrawn at random.
function perturbed(code, base, rnd, redraw = 4) {
  const space = L.fitIds(code).filter(id => !SKIP.has(id)).map(id => ({ id, values: L.optionValues(code, id) })), p = { ...base };
  for (let j = 0; j < redraw; j++) { const sp = space[Math.floor(rnd() * space.length)]; p[sp.id] = sp.values[Math.floor(rnd() * sp.values.length)]; }
  return p;
}
const numericIds = (code, p) => L.fitIds(code).filter(id => STEPS[id] && typeof p[id] === 'number' && Math.abs(p[id]) < 999);
// Worst near neighbour (every tunable number one and two small steps either way) and the CAGR at p.
function nearScore(code, p, m) {
  const base = m(p); let worst = Infinity, worstAt = '';
  for (const id of numericIds(code, p)) for (const st of STEPS[id].slice(0, 2)) for (const sg of [-1, 1]) { const v = +(p[id] + sg * st).toFixed(4); if (!okv(id, v)) continue; const c = m({ ...p, [id]: v }).cagr; if (c < worst) { worst = c; worstAt = `${id} ${sg * st > 0 ? '+' : ''}${sg * st}`; } }
  return { score: worst + 0.3 * base.cagr, worst, worstAt, cagr: base.cagr, dd: base.dd };
}
// Hill-climb on worst near neighbour + 0.3 x CAGR; the CAGR may fall at most `loss` under the start's, the drawdown rise 2 points.
function climb(code, start, m, { loss = 0.06, passes = 8, log = null } = {}) {
  let cur = { ...start }, best = nearScore(code, cur, m); const base0 = best.cagr, dd0 = best.dd, ids = numericIds(code, cur);
  for (let pass = 1; pass <= passes; pass++) {
    let moved = 0;
    for (const id of ids) {
      let pick = null, pickS = best;
      for (const st of STEPS[id].slice(0, 3)) for (const sg of [-1, 1]) { const v = +(cur[id] + sg * st).toFixed(4); if (!okv(id, v)) continue; const cand = { ...cur, [id]: v }, b = m(cand); if (b.cagr < base0 * (1 - loss) || b.dd > dd0 + 2) continue; const sc = nearScore(code, cand, m); if (sc.score > pickS.score + 0.05) { pick = cand; pickS = sc; } }
      if (pick) { if (log) log(`  pass ${pass} ${id} ${cur[id]} -> ${pick[id]}: ${pickS.cagr.toFixed(1)}% worst ${pickS.worst.toFixed(1)} (${pickS.worstAt})`); cur = pick; best = pickS; moved++; }
    }
    if (!moved) break;
  }
  return { params: cur, ...best };
}
// Sleeves: K near-box draws around p, equal money, never rebalanced; and the draws' own spread. Over [from, to].
function sleeves(code, p, from, to, { K = 20, box = 1, seed = 77 } = {}) {
  const members = J.draws(code, p, K, box, seed), s = idxOf(from), e = idxBefore(to), dates = data.dates.slice(s, e + 1);
  const logs = members.map(mp => runOn(data, code, mp, s, e)), each = logs.map(lg => statsOfLog(lg).cagr).sort((a, b) => a - b);
  const never = dates.map((_, t) => logs.reduce((a, lg) => a + lg[t].value / lg[0].value, 0) / K), st = statsOfValues(dates, never);
  return { cagr: st.cagr, dd: st.dd, w12: st.w12, growth: never[never.length - 1], median: each[Math.floor(K / 2)], min: each[0], max: each[K - 1] };
}
const evalOn = (code, p, from, to) => { const lg = L.runLog(code, p, from, to), st = statsOfLog(lg); return { cagr: st.cagr, dd: st.dd, growth: lg[lg.length - 1].value / lg[0].value }; };
module.exports = { measurer, fit, perturbed, nearScore, climb, sleeves, evalOn, numericIds };
