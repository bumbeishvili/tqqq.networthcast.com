'use strict';
// Text surgery on the library code: a `leadBasis` for the TQQQ-vs-QQQ lead (#47 and its derivatives
// #50, #52) and a `soxlLeadBasis` for the SOXL-vs-SOXX lead (#52), plus `leadShift` / `soxlLeadShift`
// (a circular shift of the lead series over its defined days: the surrogate for the luck test).
// Bases, all in percent, high = ahead or calm, low = behind or stressed:
//   growth      the current lead: leveraged growth / index growth - 1
//   residual3x  leveraged growth / index growth^3 - 1 (against a frictionless 3x from the same base)
//   indexOnly   index growth^2 - 1 (the lead with no decay at all: the index's move alone)
//   decay       exp(-3 * sum of squared daily index log returns over the lookback) - 1 (the decay alone)
//   ratioMed    (lev/index) / its median over the lookback - 1
// Start kernels (`startKernel` / `soxlStartKernel`): where the growth starts from.
//   box    the library's own: the geometric mean close over ±W days around L back (the SOXL lead: the close LD back, "point")
//   ema    an exponential average of all earlier closes, mean lag L (the weight fades by L/(L+1) a day; no first day)
//   tri    a triangle of starts peaking L back, half-width round(startSpread * L), zero weight at both ends
const { CODE } = require('./harness.cjs');
const once = (text, find, repl, what) => {
  const at = text.indexOf(find);
  if (at < 0 || text.indexOf(find, at + 1) >= 0) throw new Error(what + ' must appear exactly once');
  return text.slice(0, at) + repl + text.slice(at + find.length);
};
const ROLLING_MEDIAN = (name) => `    const ${name} = (vals, win) => {
      const out = new Float64Array(vals.length).fill(NaN), buf = [];
      const lb = (v) => { let lo = 0, hi = buf.length; while (lo < hi) { const m = (lo + hi) >> 1; if (buf[m] < v) lo = m + 1; else hi = m; } return lo; };
      for (let i = 0; i < vals.length; i++) {
        if (vals[i] > 0) buf.splice(lb(vals[i]), 0, vals[i]);
        if (i - win >= 0 && vals[i - win] > 0) { const k = lb(vals[i - win]); if (buf[k] === vals[i - win]) buf.splice(k, 1); }
        if (buf.length >= win && vals[i] > 0) { const c = buf.length; out[i] = c % 2 ? buf[(c - 1) >> 1] : (buf[c / 2 - 1] + buf[c / 2]) / 2; }
      }
      return out;
    };
`;
const SHIFT = (arr, from, key) => `    if (p.${key}) { const s0 = ${from}, m = n - s0, sh = ((Math.round(+p.${key}) % m) + m) % m; const copy = ${arr}.slice(); for (let i = s0; i < n; i++) ${arr}[i] = copy[s0 + ((i - s0 + sh) % m)]; }
`;
function withLeadBasis(code) {
  let t = code;
  const LOOP_HEAD = '    for (let i = L + W; i < n; i++) {\n      const a = i - L - W, b = i - L + W + 1;\n';
  t = once(t, LOOP_HEAD, ROLLING_MEDIAN('rollingMedianLead') + `    const LEAD_BASIS = p.leadBasis || "growth";
    const KERNEL = p.startKernel || "box";
    const kBaseT = new Float64Array(n).fill(NaN), kBaseQ = new Float64Array(n).fill(NaN);
    if (KERNEL === "ema") {
      const lam = L / (L + 1); let eT = NaN, eQ = NaN, seen = 0;
      for (let i = 0; i < n; i++) {
        if (seen >= 3 * L) { kBaseT[i] = Math.exp(eT); kBaseQ[i] = Math.exp(eQ); }   // day i's base: earlier closes only
        if (T[i] > 0 && Q[i] > 0) { const lt = Math.log(T[i]), lq = Math.log(Q[i]); if (seen === 0) { eT = lt; eQ = lq; } else { eT = lam * eT + (1 - lam) * lt; eQ = lam * eQ + (1 - lam) * lq; } seen++; }
      }
    } else if (KERNEL === "tri") {
      const S = Math.max(1, Math.min(L, Math.round((+p.startSpread || 1) * L)));
      const sT = new Float64Array(n + 1), sQ = new Float64Array(n + 1);   // prefix sums of (day index) * log close
      for (let i = 0; i < n; i++) { const ok = T[i] > 0 && Q[i] > 0; sT[i + 1] = sT[i] + (ok ? i * Math.log(T[i]) : 0); sQ[i + 1] = sQ[i] + (ok ? i * Math.log(Q[i]) : 0); }
      // weights S - |s - c| over starts s in [c - S + 1, c + S - 1], c = i - L; they sum to S * S
      const triSum = (P1, P2, c, s1, s2) => (S - c) * (P1[c + 1] - P1[s1]) + (P2[c + 1] - P2[s1]) + (S + c) * (P1[s2 + 1] - P1[c + 1]) - (P2[s2 + 1] - P2[c + 1]);
      for (let i = L + S; i < n; i++) {
        const c = i - L, s1 = c - S + 1, s2 = c + S - 1;
        if (s1 < 0 || priced[s2 + 1] - priced[s1] !== s2 - s1 + 1) continue;
        kBaseT[i] = Math.exp(triSum(logT, sT, c, s1, s2) / (S * S)); kBaseQ[i] = Math.exp(triSum(logQ, sQ, c, s1, s2) / (S * S));
      }
    } else if (KERNEL !== "box") throw new Error("unknown start kernel " + KERNEL);
    const rq2 = new Float64Array(n + 1);   // prefix sum of QQQ's squared daily log returns
    for (let i = 1; i < n; i++) { const ok = Q[i] > 0 && Q[i - 1] > 0, r = ok ? Math.log(Q[i] / Q[i - 1]) : 0; rq2[i + 1] = rq2[i] + r * r; }
    const tqRatio = new Float64Array(n); for (let i = 0; i < n; i++) tqRatio[i] = T[i] > 0 && Q[i] > 0 ? T[i] / Q[i] : 0;
    const tqMed = LEAD_BASIS === "ratioMed" ? rollingMedianLead(tqRatio, L) : null;
    const leadAt = (i) => LEAD_BASIS === "growth" ? (Math.exp(Math.log(gT[i]) - Math.log(gQ[i])) - 1) * 100
      : LEAD_BASIS === "residual3x" ? (gT[i] / (gQ[i] * gQ[i] * gQ[i]) - 1) * 100
      : LEAD_BASIS === "indexOnly" ? (gQ[i] * gQ[i] - 1) * 100
      : LEAD_BASIS === "decay" ? (Math.exp(-3 * (rq2[i + 1] - rq2[i + 1 - L])) - 1) * 100
      : LEAD_BASIS === "ratioMed" ? (tqMed[i] > 0 ? (tqRatio[i] / tqMed[i] - 1) * 100 : NaN)
      : (() => { throw new Error("unknown lead basis " + LEAD_BASIS); })();
` + LOOP_HEAD, 'the lead loop head');
  t = once(t, '      gT[i] = T[i] / baseT[i]; gQ[i] = Q[i] / baseQ[i];\n',
    '      if (KERNEL !== "box") { if (!(kBaseT[i] > 0)) continue; baseT[i] = kBaseT[i]; baseQ[i] = kBaseQ[i]; }\n      gT[i] = T[i] / baseT[i]; gQ[i] = Q[i] / baseQ[i];\n', 'the growth line');
  t = once(t, '      lead[i] = (Math.exp(Math.log(gT[i]) - Math.log(gQ[i])) - 1) * 100;\n    }\n',
    '      lead[i] = leadAt(i);\n    }\n' + SHIFT('lead', 'L + W', 'leadShift'), 'the lead line');
  return t;
}
const SOXL_BLOCK = `    const soxlLead = new Float64Array(n).fill(NaN), soxlBase = new Float64Array(n).fill(NaN);   // soxlBase: the SOXL price at a lead of 0% today
    if (data.soxl && data.soxx) {
      let on = false;
      for (let i = LD; i <= p.endIdx; i++) {
        const s0 = data.soxl[i - LD], x0 = data.soxx[i - LD];
        if (!(s0 > 0 && x0 > 0 && data.soxl[i] > 0 && data.soxx[i] > 0) || dates[i - LD] < SOXL_FROM) continue;
        soxlBase[i] = s0 * (data.soxx[i] / x0);
        soxlLead[i] = (data.soxl[i] / soxlBase[i] - 1) * 100;
        if (!on && soxlLead[i] < leadIn) on = true; else if (on && soxlLead[i] > leadOut) on = false;
        if (soxlWhen === "lead") soxlOnAt[i] = on && (!SC || data.soxl[i] > soxlConf[i]) ? 1 : 0;
      }
    }
`;
function withSoxlLeadBasis(code) {
  return once(code, SOXL_BLOCK, `    const soxlLead = new Float64Array(n).fill(NaN), soxlBase = new Float64Array(n).fill(NaN);   // soxlBase: the SOXL price at a lead of 0% today
    if (data.soxl && data.soxx) {
${ROLLING_MEDIAN('rollingMedianSx')}      const SB = p.soxlLeadBasis || "growth";
      const SK = p.soxlStartKernel || "point";
      const kBaseS = new Float64Array(n).fill(NaN), kBaseX = new Float64Array(n).fill(NaN);
      if (SK === "ema") {
        const lam = LD / (LD + 1); let eS = NaN, eX = NaN, seen = 0;
        for (let i = 0; i < n; i++) {
          if (seen >= 3 * LD) { kBaseS[i] = Math.exp(eS); kBaseX[i] = Math.exp(eX); }
          if (data.soxl[i] > 0 && data.soxx[i] > 0 && dates[i] >= SOXL_FROM) { const ls = Math.log(data.soxl[i]), lx = Math.log(data.soxx[i]); if (seen === 0) { eS = ls; eX = lx; } else { eS = lam * eS + (1 - lam) * ls; eX = lam * eX + (1 - lam) * lx; } seen++; }
        }
      } else if (SK === "tri") {
        const S = Math.max(1, Math.min(LD, Math.round((+p.soxlStartSpread || 1) * LD)));
        const lS = new Float64Array(n + 1), lX = new Float64Array(n + 1), sS = new Float64Array(n + 1), sX = new Float64Array(n + 1), pr = new Int32Array(n + 1);
        for (let i = 0; i < n; i++) { const ok = data.soxl[i] > 0 && data.soxx[i] > 0 && dates[i] >= SOXL_FROM, a = ok ? Math.log(data.soxl[i]) : 0, b = ok ? Math.log(data.soxx[i]) : 0; lS[i + 1] = lS[i] + a; lX[i + 1] = lX[i] + b; sS[i + 1] = sS[i] + i * a; sX[i + 1] = sX[i] + i * b; pr[i + 1] = pr[i] + (ok ? 1 : 0); }
        const triSum = (P1, P2, c, s1, s2) => (S - c) * (P1[c + 1] - P1[s1]) + (P2[c + 1] - P2[s1]) + (S + c) * (P1[s2 + 1] - P1[c + 1]) - (P2[s2 + 1] - P2[c + 1]);
        for (let i = LD + S; i < n; i++) {
          const c = i - LD, s1 = c - S + 1, s2 = c + S - 1;
          if (s1 < 0 || pr[s2 + 1] - pr[s1] !== s2 - s1 + 1) continue;
          kBaseS[i] = Math.exp(triSum(lS, sS, c, s1, s2) / (S * S)); kBaseX[i] = Math.exp(triSum(lX, sX, c, s1, s2) / (S * S));
        }
      } else if (SK !== "point") throw new Error("unknown SOXL start kernel " + SK);
      const rx2 = new Float64Array(n + 1);
      for (let i = 1; i < n; i++) { const ok = data.soxx[i] > 0 && data.soxx[i - 1] > 0, r = ok ? Math.log(data.soxx[i] / data.soxx[i - 1]) : 0; rx2[i + 1] = rx2[i] + r * r; }
      const sxRatio = new Float64Array(n); for (let i = 0; i < n; i++) sxRatio[i] = data.soxl[i] > 0 && data.soxx[i] > 0 ? data.soxl[i] / data.soxx[i] : 0;
      const sxMed = SB === "ratioMed" ? rollingMedianSx(sxRatio, LD) : null;
      for (let i = LD; i <= p.endIdx; i++) {
        const s0 = SK === "point" ? data.soxl[i - LD] : kBaseS[i], x0 = SK === "point" ? data.soxx[i - LD] : kBaseX[i];
        if (!(s0 > 0 && x0 > 0 && data.soxl[i] > 0 && data.soxx[i] > 0) || dates[i - LD] < SOXL_FROM) continue;
        soxlBase[i] = s0 * (data.soxx[i] / x0);
        const gS = data.soxl[i] / s0, gX = data.soxx[i] / x0;
        soxlLead[i] = SB === "growth" ? (data.soxl[i] / soxlBase[i] - 1) * 100
          : SB === "residual3x" ? (gS / (gX * gX * gX) - 1) * 100
          : SB === "indexOnly" ? (gX * gX - 1) * 100
          : SB === "decay" ? (Math.exp(-3 * (rx2[i + 1] - rx2[i + 1 - LD])) - 1) * 100
          : SB === "ratioMed" ? (sxMed[i] > 0 ? (sxRatio[i] / sxMed[i] - 1) * 100 : NaN)
          : (() => { throw new Error("unknown SOXL lead basis " + SB); })();
      }
${SHIFT('soxlLead', 'LD', 'soxlLeadShift').replace(/^    /, '      ')}      let on = false;
      for (let i = LD; i <= p.endIdx; i++) {
        if (!(soxlLead[i] === soxlLead[i])) continue;
        if (!on && soxlLead[i] < leadIn) on = true; else if (on && soxlLead[i] > leadOut) on = false;
        if (soxlWhen === "lead") soxlOnAt[i] = on && (!SC || data.soxl[i] > soxlConf[i]) ? 1 : 0;
      }
    }
`, 'the SOXL lead block');
}
const BASIS_CODE = {
  47: withLeadBasis(CODE[47]),
  50: withLeadBasis(CODE[50]),
  52: withSoxlLeadBasis(withLeadBasis(CODE[52])),
};
module.exports = { BASIS_CODE, withLeadBasis, withSoxlLeadBasis, BASES: ['growth', 'residual3x', 'indexOnly', 'decay', 'ratioMed'], KERNELS: ['box', 'ema', 'tri'] };
if (require.main === module) {
  const { run } = require('./harness.cjs');
  const same = (a, b) => a.length === b.length && a.every((r, k) => r.value === b[k].value && r.held === b[k].held && r.action === b[k].action);
  for (const n of [47, 50, 52]) {
    const t0 = Date.now();
    const a = run(CODE[n], {}, '2010-01-01', '2025-12-31'), b = run(BASIS_CODE[n], {}, '2010-01-01', '2025-12-31');
    console.log(`#${n} parity (growth): ${same(a.log, b.log) ? 'identical' : 'DIFFERENT'}  CAGR ${a.cagr.toFixed(2)} vs ${b.cagr.toFixed(2)}  ${Date.now() - t0} ms`);
    for (const basis of ['residual3x', 'indexOnly', 'decay', 'ratioMed']) {
      const r = run(BASIS_CODE[n], { leadBasis: basis }, '2010-01-01', '2025-12-31');
      const leads = r.log.map(x => x.leadPct).filter(v => typeof v === 'number');
      const q = p => leads.slice().sort((x, y) => x - y)[Math.floor(p * (leads.length - 1))];
      console.log(`   ${basis.padEnd(10)} at current thresholds: CAGR ${r.cagr.toFixed(1)} DD ${r.dd.toFixed(1)}  lead p5/p50/p95 ${q(.05).toFixed(1)} / ${q(.5).toFixed(1)} / ${q(.95).toFixed(1)}`);
    }
    if (n === 52) for (const basis of ['growth', 'residual3x', 'indexOnly', 'decay', 'ratioMed']) {
      const r = run(BASIS_CODE[52], { soxlLeadBasis: basis }, '2010-01-01', '2025-12-31');
      const leads = r.log.map(x => x.soxlLead).filter(v => typeof v === 'number');
      const q = p => leads.slice().sort((x, y) => x - y)[Math.floor(p * (leads.length - 1))];
      console.log(`   SOXL ${basis.padEnd(10)} at current thresholds: CAGR ${r.cagr.toFixed(1)} DD ${r.dd.toFixed(1)}  lead p5/p50/p95 ${q(.05).toFixed(1)} / ${q(.5).toFixed(1)} / ${q(.95).toFixed(1)}`);
    }
    const sh = run(BASIS_CODE[n], { leadShift: 1200 }, '2010-01-01', '2025-12-31');
    console.log(`   shifted lead (1200 days): CAGR ${sh.cagr.toFixed(1)} DD ${sh.dd.toFixed(1)}`);
  }
}
