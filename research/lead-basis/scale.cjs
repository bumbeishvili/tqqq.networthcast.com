'use strict';
// Scale-free versions of the TQQQ-vs-QQQ lead, as text surgery on library #52 (research only). The user
// (2026-11-09): "we try to fit one radius curve, but there might be oval in the future, but it will
// still be the curve". Knobs read off p:
//   p.leadClock   "days" (the shipped lookback) or "vol": the window reaches back until QQQ's summed
//                 squared daily log returns hit L times a typical day's variance (measured on the
//                 1958-2009 reconstruction), so L is "days' worth of a typical market's motion". The
//                 start averaging scales with the window (±65 of 550).
//   p.leadUnits   "pct" (the shipped lead) or "sigma": the lead multiplied by sqrt(L * typical daily
//                 variance) / the window's own realized volatility, so a stretch reads the same whether
//                 the window was calm or wild. Near 1 in a typical window, so the shipped thresholds
//                 keep their meaning.
//   p.leadSmooth  k: the lead is the mean of its last k daily values (1 = as shipped).
//   p.leadShift   the luck test's circular shift of the finished lead.
// With every knob at its default the code reproduces #52 trade for trade.
const { CODE } = require('./harness.cjs');
const once = (text, find, repl, what) => {
  const at = text.indexOf(find);
  if (at < 0 || text.indexOf(find, at + 1) >= 0) throw new Error(what + ' must appear exactly once');
  return text.slice(0, at) + repl + text.slice(at + find.length);
};
function withLeadScale(code) {
  return once(code, `    for (let i = L + W; i < n; i++) {
      const a = i - L - W, b = i - L + W + 1;
      if (!(T[i] > 0 && Q[i] > 0) || priced[b] - priced[a] !== b - a) continue;
      baseT[i] = W ? Math.exp((logT[b] - logT[a]) / (b - a)) : T[i - L];
      baseQ[i] = W ? Math.exp((logQ[b] - logQ[a]) / (b - a)) : Q[i - L];
      gT[i] = T[i] / baseT[i]; gQ[i] = Q[i] / baseQ[i];
      lead[i] = (Math.exp(Math.log(gT[i]) - Math.log(gQ[i])) - 1) * 100;
    }
`, `    const CLOCK = p.leadClock || "days", UNITS = p.leadUnits || "pct", SMOOTH = Math.max(1, Math.round(+p.leadSmooth || 1));
    const rr = new Float64Array(n + 1);   // rr[k + 1] = the sum of QQQ's squared daily log returns through day k
    for (let i = 1; i < n; i++) { const ok = Q[i] > 0 && Q[i - 1] > 0, r = ok ? Math.log(Q[i] / Q[i - 1]) : 0; rr[i + 1] = rr[i] + r * r; }
    const c0 = dates.findIndex(d => d >= "1958-01-01"), c1 = dates.findIndex(d => d > "2009-12-31") - 1;
    const vBar = (rr[c1 + 1] - rr[c0]) / (c1 - c0 + 1);   // a typical day's variance, from the reconstruction before 2010
    const budget = L * vBar;
    const rawLead = new Float64Array(n).fill(NaN), winLen = new Int32Array(n);
    let s0 = 0;
    for (let i = 1; i < n; i++) {
      let Lk = L, Wk = W;
      if (CLOCK === "vol") {
        while (s0 < i - 1 && rr[i + 1] - rr[s0 + 2] >= budget) s0++;   // the latest start whose window still holds the budget
        if (!(rr[i + 1] - rr[s0 + 1] >= budget)) continue;
        Lk = i - s0; Wk = Math.round(W * Lk / L);
      }
      const a = i - Lk - Wk, b = i - Lk + Wk + 1;
      if (a < 0 || !(T[i] > 0 && Q[i] > 0) || priced[b] - priced[a] !== b - a) continue;
      baseT[i] = Wk ? Math.exp((logT[b] - logT[a]) / (b - a)) : T[i - Lk];
      baseQ[i] = Wk ? Math.exp((logQ[b] - logQ[a]) / (b - a)) : Q[i - Lk];
      gT[i] = T[i] / baseT[i]; gQ[i] = Q[i] / baseQ[i];
      let v = (Math.exp(Math.log(gT[i]) - Math.log(gQ[i])) - 1) * 100;
      if (UNITS === "sigma") { const sig = Math.sqrt(rr[i + 1] - rr[i - Lk + 1]); if (!(sig > 0)) continue; v *= Math.sqrt(Lk * vBar) / sig; }
      rawLead[i] = v; winLen[i] = Lk;
    }
    for (let i = 0; i < n; i++) {
      if (SMOOTH <= 1) { lead[i] = rawLead[i]; continue; }
      let sum = 0, ok = true;
      for (let k = i - SMOOTH + 1; k <= i; k++) { if (k < 0 || !(rawLead[k] === rawLead[k])) { ok = false; break; } sum += rawLead[k]; }
      if (ok) lead[i] = sum / SMOOTH;
    }
    if (p.leadTrace) for (let i = 0; i < n; i++) if (winLen[i]) p.leadTrace[dates[i]] = winLen[i];   // research instrumentation: the window length used
    if (p.leadShift) { let f0 = 0; while (f0 < n && !(lead[f0] === lead[f0])) f0++; const m0 = n - f0; if (m0 > 1) { const sh = ((Math.round(+p.leadShift) % m0) + m0) % m0; const copy = lead.slice(); for (let i = f0; i < n; i++) lead[i] = copy[f0 + ((i - f0 + sh) % m0)]; } }
`, 'the lead loop');
}
const SCALE_CODE = { 52: withLeadScale(CODE[52]) };
module.exports = { SCALE_CODE, withLeadScale };
if (require.main === module) {
  const { run, data } = require('./harness.cjs');
  const same = (a, b) => a.length === b.length && a.every((r, k) => r.value === b[k].value && r.held === b[k].held && r.action === b[k].action);
  const base = run(CODE[52], {}, '2010-01-01', '2025-12-31'), par = run(SCALE_CODE[52], {}, '2010-01-01', '2025-12-31');
  console.log('parity defaults 2010-25:', same(base.log, par.log) ? 'identical' : 'DIFFERENT', par.cagr.toFixed(2));
  const b53 = run(CODE[52], {}, '1953-01-02'), p53 = run(SCALE_CODE[52], {}, '1953-01-02');
  console.log('parity defaults 1953+:', same(b53.log, p53.log) ? 'identical' : 'DIFFERENT');
  const tr = {}; const vol = run(SCALE_CODE[52], { leadClock: 'vol', leadTrace: tr }, '2010-01-01', '2025-12-31');
  const lens = Object.entries(tr).filter(([d]) => d >= '2010-01-01' && d <= '2025-12-31').map(([, L]) => L).sort((a, b) => a - b);
  console.log('vol clock, L=550 budget: window length 2010-25 p10/median/p90', lens[Math.floor(lens.length * 0.1)], lens[Math.floor(lens.length * 0.5)], lens[Math.floor(lens.length * 0.9)], '| CAGR at shipped thresholds', vol.cagr.toFixed(1), 'DD', vol.dd.toFixed(1));
  const all = Object.entries(tr).map(([, L]) => L).sort((a, b) => a - b);
  console.log('vol clock window length 1958-2026 p10/median/p90', all[Math.floor(all.length * 0.1)], all[Math.floor(all.length * 0.5)], all[Math.floor(all.length * 0.9)]);
  const sig = run(SCALE_CODE[52], { leadUnits: 'sigma' }, '2010-01-01', '2025-12-31');
  const ls = sig.log.map(x => x.leadPct).filter(v => typeof v === 'number').sort((a, b) => a - b), lb = base.log.map(x => x.leadPct).filter(v => typeof v === 'number').sort((a, b) => a - b);
  const q = (arr, p) => arr[Math.floor(p * (arr.length - 1))].toFixed(0);
  console.log('sigma units at shipped thresholds: CAGR', sig.cagr.toFixed(1), 'DD', sig.dd.toFixed(1), '| lead p5/p50/p95 sigma', q(ls, .05), q(ls, .5), q(ls, .95), 'vs pct', q(lb, .05), q(lb, .5), q(lb, .95));
  for (const k of [3, 5, 10, 20]) { const sm = run(SCALE_CODE[52], { leadSmooth: k }, '2010-01-01', '2025-12-31'); console.log('smooth ' + k + ' at shipped thresholds: CAGR ' + sm.cagr.toFixed(1) + ' DD ' + sm.dd.toFixed(1)); }
  // hand check of the vol window on one day: the summed squared returns over the reported window reach the budget, and one day less does not
  const i = data.dates.indexOf('2020-03-20'), Lk = tr['2020-03-20']; let s = 0; for (let k = i - Lk + 1; k <= i; k++) s += Math.log(data.qqq[k] / data.qqq[k - 1]) ** 2; let s1 = s - Math.log(data.qqq[i - Lk + 1] / data.qqq[i - Lk]) ** 2;
  console.log('2020-03-20 vol window', Lk, 'days; budget check (>=1 and <1):', (s / (550 * ((() => { let v = 0, c = 0; const a = data.dates.findIndex(d => d >= '1958-01-01'), b = data.dates.findIndex(d => d > '2009-12-31') - 1; for (let k = a; k <= b; k++) { const r = data.qqq[k] > 0 && data.qqq[k - 1] > 0 ? Math.log(data.qqq[k] / data.qqq[k - 1]) : 0; v += r * r; c++; } return v / c; })()))).toFixed(3), (s1 / (550 * ((() => { let v = 0, c = 0; const a = data.dates.findIndex(d => d >= '1958-01-01'), b = data.dates.findIndex(d => d > '2009-12-31') - 1; for (let k = a; k <= b; k++) { const r = data.qqq[k] > 0 && data.qqq[k - 1] > 0 ? Math.log(data.qqq[k] / data.qqq[k - 1]) : 0; v += r * r; c++; } return v / c; })()))).toFixed(3));
}
