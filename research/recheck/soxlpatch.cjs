'use strict';
// Research copies of NFCI + Monday (#48) and Buy-back + Monday (#49) with Mon Turns' "SOXL instead of TQQQ" lead
// rule: while the rules themselves hold TQQQ (not a Monday trade), hold SOXL from a close with SOXL's lead over
// SOXX under soxlLeadEnter until the first close with it over soxlLeadExit. The lead and its state run over the
// whole history from 1994-05-04, as in Mon Turns. soxlLeadShift moves the lead series in time (the luck test).
const L = require('./lib.cjs');
const once = (text, find, repl, what) => { const at = text.indexOf(find); if (at < 0 || text.indexOf(find, at + 1) >= 0) throw new Error('soxlpatch: ' + what + ' must appear exactly once'); return text.slice(0, at) + repl + text.slice(at + find.length); };
const SETUP = `    const soxlRule = p.soxlRule !== false, SOXL_FROM = "1994-05-04", LD = Math.max(1, Math.round(+p.soxlLeadDays || 380));
    const leadIn = p.soxlLeadEnter == null ? -15 : +p.soxlLeadEnter, leadOut = p.soxlLeadExit == null ? 90 : +p.soxlLeadExit, sh = Math.round(+p.soxlLeadShift || 0);
    const soxlOnAt = new Uint8Array(data.dates.length), soxlLeadArr = new Float64Array(data.dates.length).fill(NaN);
    for (let i = LD; i < data.dates.length; i++) { const s0 = data.soxl[i - LD], x0 = data.soxx[i - LD]; if (s0 > 0 && x0 > 0 && data.soxl[i] > 0 && data.soxx[i] > 0 && data.dates[i - LD] >= SOXL_FROM) soxlLeadArr[i] = ((data.soxl[i] / s0) / (data.soxx[i] / x0) - 1) * 100; }
    if (soxlRule) { let on = false; const first = soxlLeadArr.findIndex(v => v === v), span = data.dates.length - first;
      for (let i = first; i <= p.endIdx; i++) { const v = sh ? soxlLeadArr[first + (((i - first - sh) % span) + span) % span] : soxlLeadArr[i]; if (!(v === v)) continue; if (!on && v < leadIn) on = true; else if (on && v > leadOut) on = false; soxlOnAt[i] = on ? 1 : 0; } }
`;
function patch(code, hookFind, hookRepl) {
  let t = once(code, '    const tmIn = new Uint8Array(p.endIdx + 1);', SETUP + '    const tmIn = new Uint8Array(p.endIdx + 1);', 'the Monday setup');
  return once(t, hookFind, hookRepl, 'the Monday hook');
}
const C48 = patch(L.CODE[48], '        want = tmHold(i, want);\n', '        const rulesT = want === p.asset; want = tmHold(i, want);\n        if (rulesT && soxlOnAt[i] === 1 && data.soxl[i] > 0) want = "soxl";\n');
const C49 = patch(L.CODE[49], '        want = tmHold(i, want);\n', '        const rulesT = want === p.asset && _frac >= 1; want = tmHold(i, want);\n        if (rulesT && soxlOnAt[i] === 1 && data.soxl[i] > 0) want = "soxl";\n');
module.exports = { C48, C49 };
if (require.main === module) {
  for (const [name, code, n] of [['NFCI + Mon', C48, 48], ['Buy-back + Mon', C49, 49]]) {
    const off = L.stat(code, { soxlRule: false }), base = L.stat(L.CODE[n], {});
    console.log(`${name}: rule off ${off.cagr.toFixed(2)}% (library ${base.cagr.toFixed(2)}%)`);
    for (const [lbl, pr] of [["Mon Turns' settings 380/-15/90", {}], ["Fit's settings 380/-33/101", { soxlLeadEnter: -33, soxlLeadExit: 101 }], ['the first fitted pick 400/0/20', { soxlLeadDays: 400, soxlLeadEnter: 0, soxlLeadExit: 20 }]]) {
      const a = L.stat(code, pr), h1 = L.stat(code, pr, '2009-12-31', '2017-12-29'), h2 = L.stat(code, pr, '2017-12-29', '2025-12-31'), y = L.runLog(code, pr, '2025-12-31', L.LAST), yb = L.runLog(L.CODE[n], {}, '2025-12-31', L.LAST);
      const days = L.runLog(code, pr).filter(r => r.held === 'SOXL').length;
      console.log(`  ${lbl.padEnd(32)} ${a.cagr.toFixed(1)}% DD ${a.dd.toFixed(1)} w12 ${a.w12.toFixed(0)} | halves ${h1.cagr.toFixed(0)} / ${h2.cagr.toFixed(0)} | 2026 ${((y[y.length - 1].value / y[0].value - 1) * 100).toFixed(0)}% (without ${((yb[yb.length - 1].value / yb[0].value - 1) * 100).toFixed(0)}%) | SOXL days ${days}`);
    }
  }
}
