'use strict';
// Ken French's daily 49-industry value-weighted returns (CRSP, from 1926-07-01), the repo's daily data, and the
// updater's leveraged-fund step, for testing proxies of the semiconductor index before May 1994.
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '..');   // the repo root
// The French file is not committed (21 MB; _raw/ is git-ignored). Fetch it once from the repo root:
//   mkdir -p _raw/french && cd _raw/french && curl -sLO https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/ftp/49_Industry_Portfolios_daily_CSV.zip && unzip -o 49_Industry_Portfolios_daily_CSV.zip
const H = require(path.join(ROOT, 'research/lead-basis/harness.cjs'));
const lines = fs.readFileSync(path.join(ROOT, '_raw', 'french', '49_Industry_Portfolios_Daily.csv'), 'utf8').split(/\r?\n/);
const start = lines.findIndex(l => /Average Value Weighted Returns/.test(l)), cols = lines[start + 1].split(',').map(s => s.trim());
const french = new Map();   // 'YYYY-MM-DD' -> { Chips: 0.0123, ... } (fractions; missing = NaN)
for (let k = start + 2; k < lines.length; k++) { const p = lines[k].split(','); if (!/^\d{8}$/.test(p[0].trim())) break; const d = p[0].trim(), o = {}; for (let c = 1; c < cols.length; c++) { const v = +p[c]; o[cols[c]] = v <= -99 ? NaN : v / 100; } french.set(`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`, o); }
const rates = new Map(fs.readFileSync(path.join(ROOT, 'data/short-rates.tsv'), 'utf8').trim().split('\n').slice(1).map(l => { const [d, v] = l.split('\t'); const [m, dd, y] = d.split(' ')[0].split('/'); return [`${y}-${m.padStart(2, '0')}-${dd.padStart(2, '0')}`, +v]; }));
const rateDates = [...rates.keys()].sort();
function rateOn(date) { let lo = 0, hi = rateDates.length - 1; if (date < rateDates[0]) return rates.get(rateDates[0]); while (lo < hi) { const m = (lo + hi + 1) >> 1; if (rateDates[m] <= date) lo = m; else hi = m - 1; } return rates.get(rateDates[lo]); }
// The updater's step for a leveraged fund over one day: 1 + L x ret - (L-1) x (rate + spread)/252 - fee/252, rate of the earlier day.
const step = (ret, prevDate, L, feeYr, spread) => 1 + L * ret - (L - 1) * (rateOn(prevDate) / 100 + spread) / 252 - feeYr / 252;
const SOXL = { L: 3, fee: 0.0075, spread: -0.0181 }, SOXX = { L: 1, fee: 0.0035, spread: 0 };
function ols(y, X) {   // y: n, X: n x k (with a column of ones if wanted) -> { b, r2 }
  const n = y.length, k = X[0].length, A = Array.from({ length: k }, () => new Float64Array(k + 1));
  for (let i = 0; i < n; i++) for (let a = 0; a < k; a++) { for (let b = 0; b < k; b++) A[a][b] += X[i][a] * X[i][b]; A[a][k] += X[i][a] * y[i]; }
  for (let a = 0; a < k; a++) { let p = a; for (let r = a + 1; r < k; r++) if (Math.abs(A[r][a]) > Math.abs(A[p][a])) p = r; [A[a], A[p]] = [A[p], A[a]]; for (let r = 0; r < k; r++) if (r !== a) { const f = A[r][a] / A[a][a]; for (let c = a; c <= k; c++) A[r][c] -= f * A[a][c]; } }
  const b = A.map((row, a) => row[k] / row[a]), my = y.reduce((s, v) => s + v, 0) / n; let sse = 0, sst = 0;
  for (let i = 0; i < n; i++) { let f = 0; for (let a = 0; a < k; a++) f += b[a] * X[i][a]; sse += (y[i] - f) ** 2; sst += (y[i] - my) ** 2; }
  return { b, r2: 1 - sse / sst };
}
const corr = (a, b) => { const n = a.length, ma = a.reduce((s, v) => s + v, 0) / n, mb = b.reduce((s, v) => s + v, 0) / n; let x = 0, y = 0, z = 0; for (let i = 0; i < n; i++) { x += (a[i] - ma) * (b[i] - mb); y += (a[i] - ma) ** 2; z += (b[i] - mb) ** 2; } return x / Math.sqrt(y * z); };
const sd = (a) => { const m = a.reduce((s, v) => s + v, 0) / a.length; return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1)); };
// Until 2026-11-10 the committed SOXX file had a 3x level break at SOXX's launch day (the prefix was not re-anchored
// after the November 2026 split). A file that still has it is joined here; the rebuilt file passes through unchanged.
const kBreak = H.data.dates.indexOf('2001-07-13'), broken = H.data.soxx[kBreak] / H.data.soxx[kBreak - 1] < 0.5;
const soxxJoined = H.data.soxx.map((v, i) => broken && i < kBreak ? v / 3 : v);
module.exports = { H, data: { ...H.data, soxx: soxxJoined }, french, cols, rateOn, step, SOXL, SOXX, ols, corr, sd, ROOT };
if (require.main === module) {
  const d = H.data.dates, missing = d.filter(x => x <= '2026-09-30' && !french.has(x)), fd = [...french.keys()], extra = fd.filter(x => x >= d[0] && !d.includes(x));
  console.log('French columns:', cols.slice(1).join(' '));
  console.log('French days', fd.length, fd[0], '..', fd[fd.length - 1], '| repo days', d.length, d[0], '..', d[d.length - 1]);
  console.log('repo days to 2026-09-30 missing in French:', missing.length, missing.slice(0, 12).join(' '), '| French days from 1953 missing in the repo:', extra.length, extra.slice(0, 12).join(' '));
  const chips = fd.filter(x => !(french.get(x).Chips === french.get(x).Chips)); console.log('days with no Chips return:', chips.length, chips.slice(0, 3).join(' '));
}
