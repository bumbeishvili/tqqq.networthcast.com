'use strict';
// Scratch copies of the library code with one behaviour changed each, to size the findings of the independent audits.
const L = require('./lib.cjs');
const once = (text, find, repl, what) => { const at = text.indexOf(find); if (at < 0 || text.indexOf(find, at + 1) >= 0) throw new Error('patch: ' + what + ' must appear exactly once'); return text.slice(0, at) + repl + text.slice(at + find.length); };
// (1) Monday entry as the card words it: any Monday close under the level with the rules in cash opens a trade,
//     also while the rule's own earlier Monday trade has had no exit close yet.
const mondayText = (code) => {
  let t = once(code, '      tmIn[i] = inT ? 1 : 0;\n', '      tmIn[i] = inT ? 1 : 0; tmMon[i] = (wd === 1 && c > 0 && prev > 0 && c < tmLevel(tmLow, i - 1)) ? 1 : 0;\n', 'the Monday loop');
  t = once(t, '    const tmIn = new Uint8Array(p.endIdx + 1);', '    const tmMon = new Uint8Array(p.endIdx + 1);\n    const tmIn = new Uint8Array(p.endIdx + 1);', 'the Monday array');
  return once(t, '&& tmIn[i] && !(i > p.startIdx && tmIn[i - 1])) {', '&& tmIn[i] && (tmMon[i] === 1 || !(i > p.startIdx && tmIn[i - 1]))) {', 'the Monday entry');
};
// (2) Buy-back: a buy-back whose own close is at or above the sell line leaves the sell line live.
const sellLive = (code) => {
  let t = once(code, '{ state = "normal"; sellArmed = false; why = closesTxt + " above " + bbTxt; }', '{ state = "normal"; sellArmed = sigM >= pExit; why = closesTxt + " above " + bbTxt; }', 'the crash buy-back');
  return once(t, 'sellArmed = pReenter >= pExit * 0.999999;', 'sellArmed = pReenter >= pExit * 0.999999 || sigM >= pExit;', 'the re-entry');
};
// (3) Buy-back: the half-way line only for lows under the centre line; a correction that stayed above it waits for the sell line.
const halfwayBelowOnly = (code) => once(code, 'const pReenter = dipF > 0 ? Math.min(pExit, Math.max(pBuyBack, med * (1 + lowRel * dipF))) : pExit;', 'const pReenter = dipF > 0 && lowRel < 0 ? Math.min(pExit, Math.max(pBuyBack, med * (1 + lowRel * dipF))) : pExit;', 'the re-entry line');
module.exports = { mondayText, sellLive, halfwayBelowOnly };
if (require.main === module) {
  const row = (code, p = {}) => { const a = L.stat(code, p), y = L.runLog(code, p, '2025-12-31', L.LAST); return `${a.cagr.toFixed(2)}% DD ${a.dd.toFixed(1)} w12 ${a.w12.toFixed(0)} | 2026 ${((y[y.length - 1].value / y[0].value - 1) * 100).toFixed(1)}%`; };
  for (const n of L.FOUR) { const base = L.runLog(L.CODE[n], {}, '2009-12-31', L.LAST), alt = L.runLog(mondayText(L.CODE[n]), {}, '2009-12-31', L.LAST); const diff = base.filter((r, k) => r.held !== alt[k].held);
    console.log(`${L.NAMES[n].padEnd(20)} library ${row(L.CODE[n])} | Monday entry as worded ${row(mondayText(L.CODE[n]))} | days held differently since 2010: ${diff.length}${diff.length ? ' (first ' + diff[0].date + ', ' + [...new Set(diff.map(r => r.date.slice(0, 7)))].join(' ') + ')' : ''}`); }
  const c49 = L.CODE[49], old = { exitPct: -3, confirmDays: 5, bbPct: -34 };
  console.log('Buy-back + Mon, shipped settings:'); console.log('  library                               ', row(c49)); console.log('  sell line live at a buy-back above it ', row(sellLive(c49))); console.log('  half-way line only for lows under the centre', row(halfwayBelowOnly(c49))); console.log('  both                                  ', row(halfwayBelowOnly(sellLive(c49))));
  console.log('Buy-back + Mon, sell -3 / 5 closes / buy-back -34 / all the money:'); console.log('  library                               ', row(c49, old)); console.log('  sell line live at a buy-back above it ', row(sellLive(c49), old)); console.log('  half-way line only for lows under the centre', row(halfwayBelowOnly(c49), old)); console.log('  both + Monday entry as worded         ', row(mondayText(halfwayBelowOnly(sellLive(c49))), old));
}
