'use strict';
// A: what the lead is made of (2010-2025). B: does any measure predict forward returns on its own?
const fs = require('fs'), path = require('path');
const { data } = require('./harness.cjs');
const dates = data.dates, n = dates.length;
const from = dates.findIndex(d => d >= '2010-01-01'), to = dates.findIndex(d => d > '2025-12-31') - 1;
const lg = (a) => a.map(v => v > 0 ? Math.log(v) : NaN);
// Measures for a pair (lev, idx) over lookback L with the geometric-mean base over ±W days, at every day i.
function measures(lev, idx, L, W) {
  const LT = lg(lev), LQ = lg(idx), out = { growth: [], residual3x: [], indexOnly: [], decay: [], ratioMed: [], idxGrowth: [], decayRate63: [] };
  const sq = new Float64Array(n + 1); for (let i = 1; i < n; i++) { const r = (idx[i] > 0 && idx[i - 1] > 0) ? Math.log(idx[i] / idx[i - 1]) : 0; sq[i + 1] = sq[i] + r * r; }
  const ratio = lev.map((v, i) => v > 0 && idx[i] > 0 ? v / idx[i] : NaN);
  for (let i = 0; i < n; i++) {
    const a = i - L - W, b = i - L + W; let ok = i >= L + W && lev[i] > 0 && idx[i] > 0;
    let bT = 0, bQ = 0; if (ok) { let c = 0; for (let j = a; j <= b; j++) { if (!(lev[j] > 0 && idx[j] > 0)) { ok = false; break; } bT += LT[j]; bQ += LQ[j]; c++; } bT /= c; bQ /= c; }
    if (!ok) { for (const k in out) out[k].push(NaN); continue; }
    const gT = Math.exp(LT[i] - bT), gQ = Math.exp(LQ[i] - bQ);
    out.growth.push((gT / gQ - 1) * 100); out.residual3x.push((gT / gQ ** 3 - 1) * 100); out.indexOnly.push((gQ * gQ - 1) * 100); out.idxGrowth.push((gQ - 1) * 100);
    out.decay.push((Math.exp(-3 * (sq[i + 1] - sq[i + 1 - L])) - 1) * 100);
    out.decayRate63.push(-300 * (sq[i + 1] - sq[i + 1 - 63]) * (252 / 63));
    const w = []; for (let j = i - L + 1; j <= i; j++) if (ratio[j] === ratio[j]) w.push(ratio[j]); w.sort((x, y) => x - y); const med = w[w.length >> 1];
    out.ratioMed.push((ratio[i] / med - 1) * 100);
  }
  return out;
}
const pearson = (x, y) => { const idx = x.map((v, i) => i).filter(i => x[i] === x[i] && y[i] === y[i]); const mx = idx.reduce((s, i) => s + x[i], 0) / idx.length, my = idx.reduce((s, i) => s + y[i], 0) / idx.length; let sxy = 0, sxx = 0, syy = 0; for (const i of idx) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; } return sxy / Math.sqrt(sxx * syy); };
const rank = (v) => { const idx = v.map((x, i) => i).filter(i => v[i] === v[i]).sort((a, b) => v[a] - v[b]); const r = v.map(() => NaN); idx.forEach((i, k) => { r[i] = k; }); return r; };
const spearman = (x, y) => pearson(rank(x.map((v, i) => y[i] === y[i] ? v : NaN)), rank(y.map((v, i) => x[i] === x[i] ? v : NaN)));
const fwd = (series, h) => series.map((v, i) => (i + h < n && v > 0 && series[i + h] > 0) ? (series[i + h] / v - 1) * 100 : NaN);
// Block bootstrap of the Spearman correlation: resample 63-day blocks of the (measure, forward) pairs, 300 draws, two-sided p for rho = 0 via the sign flip of blocks? Simpler: a circular-shift null, the measure shifted by a random offset 500 times.
const shiftNull = (x, y, draws = 400) => { const real = spearman(x, y); const idx = x.map((v, i) => i).filter(i => x[i] === x[i] && y[i] === y[i]); const xs = idx.map(i => x[i]), ys = idx.map(i => y[i]); let beat = 0; let s = 12345; const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; for (let d = 0; d < draws; d++) { const k = 300 + Math.floor(rnd() * (xs.length - 600)); const sh = xs.map((v, i) => xs[(i + k) % xs.length]); if (Math.abs(spearman(sh, ys)) >= Math.abs(real)) beat++; } return { rho: +real.toFixed(3), p: +(beat / draws).toFixed(3) }; };
const slice = (arr) => arr.slice(from, to + 1);
const report = {};
for (const [name, lev, idx, L, W] of [['TQQQ vs QQQ (550, ±65)', data.tqqq, data.qqq, 550, 65], ['SOXL vs SOXX (380)', data.soxl, data.soxx, 380, 0]]) {
  const M = measures(lev, idx, L, W), R = {};
  // A: decomposition. The current lead against the index's move alone and against the decay.
  R.decomposition = { corrLeadVsIndexOnly: +pearson(slice(M.growth), slice(M.indexOnly)).toFixed(3), corrLeadVsDecay: +pearson(slice(M.growth), slice(M.decay)).toFixed(3), corrLeadVsResidual: +pearson(slice(M.growth), slice(M.residual3x)).toFixed(3), corrIndexOnlyVsDecay: +pearson(slice(M.indexOnly), slice(M.decay)).toFixed(3) };
  const q = (arr, p) => { const v = slice(arr).filter(x => x === x).sort((a, b) => a - b); return +v[Math.floor(p * (v.length - 1))].toFixed(1); };
  R.ranges = Object.fromEntries(Object.keys(M).map(k => [k, [q(M[k], .05), q(M[k], .5), q(M[k], .95)]]));
  // B: forward returns of the leveraged fund (and SOXL minus TQQQ for the SOXL pair) by measure, Spearman with a shift null; plus decile means for h = 126.
  R.forward = {};
  const target = name.startsWith('SOXL') ? { 'SOXL fwd': lev, 'SOXL-TQQQ fwd': null } : { 'TQQQ fwd': lev };
  for (const h of [21, 63, 126, 252]) {
    const fT = fwd(lev, h), fTq = fwd(data.tqqq, h);
    for (const k of Object.keys(M)) {
      const x = slice(M[k]);
      const y = slice(fT); R.forward[`${k} h${h} ${Object.keys(target)[0]}`] = shiftNull(x, y);
      if (name.startsWith('SOXL')) { const y2 = slice(fT).map((v, i) => v - slice(fTq)[i]); R.forward[`${k} h${h} SOXL-TQQQ fwd`] = shiftNull(x, y2); }
    }
  }
  // Decile means of the 126-day forward return by measure.
  R.deciles126 = {};
  const f126 = slice(fwd(lev, 126));
  for (const k of Object.keys(M)) { const x = slice(M[k]); const idx = x.map((v, i) => i).filter(i => x[i] === x[i] && f126[i] === f126[i]).sort((a, b) => x[a] - x[b]); const d = []; for (let j = 0; j < 10; j++) { const part = idx.slice(Math.floor(j * idx.length / 10), Math.floor((j + 1) * idx.length / 10)); d.push(+(part.reduce((s, i) => s + f126[i], 0) / part.length).toFixed(1)); } R.deciles126[k] = d; }
  report[name] = R;
}
fs.mkdirSync(path.join(__dirname, 'out'), { recursive: true }); fs.writeFileSync(path.join(__dirname, 'out/partAB.json'), JSON.stringify(report, null, 1));
for (const [name, R] of Object.entries(report)) {
  console.log('==', name); console.log(' decomposition', JSON.stringify(R.decomposition)); console.log(' ranges p5/p50/p95', JSON.stringify(R.ranges));
  console.log(' Spearman with forward return (shift-null p):'); for (const [k, v] of Object.entries(R.forward)) if (/h126|h252/.test(k)) console.log('   ', k.padEnd(40), JSON.stringify(v));
  console.log(' decile means of the 126-day forward return (low measure -> high):'); for (const [k, d] of Object.entries(R.deciles126)) console.log('   ', k.padEnd(12), d.join(' '));
}
