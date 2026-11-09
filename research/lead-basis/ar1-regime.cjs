'use strict';
// The arXiv 2504.20116 idea as a test: does the rolling AR(1) of QQQ's daily returns (momentum when
// positive, mean reversion when negative) predict TQQQ's forward return or its forward shortfall
// against 3x QQQ? Spearman rank correlation with a circular-shift null (200 shifts of the signal).
//   node ar1-regime.cjs
const { data } = require('./harness.cjs');
const Q = data.qqq, T = data.tqqq, n = data.dates.length;
const r = new Float64Array(n); for (let i = 1; i < n; i++) r[i] = Q[i] > 0 && Q[i - 1] > 0 ? Math.log(Q[i] / Q[i - 1]) : 0;
const ar1 = (W) => { const out = new Float64Array(n).fill(NaN); for (let i = W + 1; i < n; i++) { let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0; for (let k = i - W + 1; k <= i; k++) { const x = r[k - 1], y = r[k]; sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y; } const cx = sxx - sx * sx / W, cy = syy - sy * sy / W, cxy = sxy - sx * sy / W; out[i] = cx > 0 && cy > 0 ? cxy / Math.sqrt(cx * cy) : NaN; } return out; };
const fwd = (arr, h) => (i) => i + h < n && arr[i] > 0 ? arr[i + h] / arr[i] - 1 : NaN;
const rank = (v) => { const idx = v.map((x, i) => [x, i]).sort((a, b) => a[0] - b[0]); const out = new Array(v.length); idx.forEach(([, i], k) => out[i] = k); return out; };
const spearman = (x, y) => { const rx = rank(x), ry = rank(y), m = x.length; let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0; for (let i = 0; i < m; i++) { sx += rx[i]; sy += ry[i]; sxx += rx[i] * rx[i]; syy += ry[i] * ry[i]; sxy += rx[i] * ry[i]; } return (sxy - sx * sy / m) / Math.sqrt((sxx - sx * sx / m) * (syy - sy * sy / m)); };
const i0 = data.dates.findIndex(d => d >= '2010-01-01'), i1 = data.dates.findIndex(d => d > '2025-12-31') - 1;
const SAMPLE = 21;   // one point every month, so the rows are nearly independent
for (const W of [60, 90, 120, 250]) {
  const phi = ar1(W);
  for (const h of [21, 63, 126, 252]) {
    const fT = fwd(T, h), fQ = fwd(Q, h);
    const xs = [], yT = [], yGap = [];
    for (let i = i0; i + h <= i1; i += SAMPLE) { const p = phi[i], a = fT(i), b = fQ(i); if (p === p && a === a && b === b) { xs.push(p); yT.push(a); yGap.push(a - 3 * b); } }
    const rhoT = spearman(xs, yT), rhoG = spearman(xs, yGap);
    // null: the signal shifted in time against the same outcomes
    let moreT = 0, moreG = 0; const S = 200;
    for (let s = 1; s <= S; s++) { const sh = Math.floor(s * xs.length / (S + 1)); const xsh = xs.map((_, k) => xs[(k + sh) % xs.length]); if (Math.abs(spearman(xsh, yT)) >= Math.abs(rhoT)) moreT++; if (Math.abs(spearman(xsh, yGap)) >= Math.abs(rhoG)) moreG++; }
    console.log(`AR1 window ${String(W).padStart(3)} -> ${String(h).padStart(3)}-day forward: TQQQ return rho ${rhoT.toFixed(2)} (p ${(moreT / S).toFixed(2)}) | TQQQ minus 3xQQQ rho ${rhoG.toFixed(2)} (p ${(moreG / S).toFixed(2)}) | n ${xs.length}`);
  }
}
const phi = ar1(90); const vals = []; for (let i = i0; i <= i1; i++) if (phi[i] === phi[i]) vals.push(phi[i]); vals.sort((a, b) => a - b);
console.log('AR1(90) of QQQ daily returns 2010-2025: p10', vals[Math.floor(vals.length * 0.1)].toFixed(2), 'median', vals[Math.floor(vals.length * 0.5)].toFixed(2), 'p90', vals[Math.floor(vals.length * 0.9)].toFixed(2), '| share positive', (vals.filter(v => v > 0).length / vals.length).toFixed(2));
