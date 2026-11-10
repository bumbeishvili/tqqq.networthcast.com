'use strict';
// The Monday rule's luck test: its own trades (days the Monday version holds TQQQ where the base holds cash) moved
// to random days inside the same cash stretches, same lengths, 500 draws; how many end at least as high as the real one.
const L = require('./lib.cjs');
const { CODE, data, idxOf, idxBefore, runOn, statsOfValues, replay, rng } = L;
const hl = (code) => { const a = 'const tmHL = false,'; if (code.split(a).length !== 2) throw new Error('tmHL'); return code.split(a).join('const tmHL = true,'); };
function test(name, base, mon, params = {}) {
  const s = idxOf('2009-12-31'), e = idxBefore('2025-12-31'), dates = data.dates.slice(s, e + 1);
  const b = runOn(data, base, params, s, e).map(r => String(r.held).toLowerCase()), m = runOn(data, mon, params, s, e).map(r => String(r.held).toLowerCase());
  const W = (h) => h.map(x => x === 'cash' ? { cash: 1 } : { [x]: 1, cash: 0 });
  const cagrOf = (h) => statsOfValues(dates, replay(dates, W(h), { startIdx: s })).cagr;
  // the Monday trades: runs of days where the base is in cash and the Monday version holds TQQQ
  const trades = []; for (let i = 0; i < b.length; i++) if (b[i] === 'cash' && m[i] === 'tqqq') { if (trades.length && trades[trades.length - 1].end === i - 1) trades[trades.length - 1].end = i; else trades.push({ start: i, end: i }); }
  // cash stretches of the base
  const stretchOf = new Int32Array(b.length).fill(-1), stretches = []; for (let i = 0; i < b.length; i++) if (b[i] === 'cash') { if (i > 0 && b[i - 1] === 'cash') stretches[stretches.length - 1].end = i; else stretches.push({ start: i, end: i }); stretchOf[i] = stretches.length - 1; }
  const other = m.filter((x, i) => x !== b[i] && !(b[i] === 'cash' && x === 'tqqq')).length;
  const real = cagrOf(m), baseC = cagrOf(b), r = rng(2026); let ge = 0; const draws = [];
  for (let k = 0; k < 500; k++) {
    const h = b.slice();
    for (const t of trades) { const st = stretches[stretchOf[t.start]], len = t.end - t.start + 1, room = st.end - st.start + 1 - len; const at = st.start + Math.floor(r() * (room + 1)); for (let i = at; i < at + len && i <= st.end; i++) h[i] = 'tqqq'; }
    const c = cagrOf(h); draws.push(c); if (c >= real) ge++;
  }
  draws.sort((x, y) => x - y);
  console.log(`${name.padEnd(46)} base ${baseC.toFixed(1)}%, with Monday trades ${real.toFixed(1)}% (${trades.length} trades, ${trades.reduce((a, t) => a + t.end - t.start + 1, 0)} days; ${other} other differing days) | random placement: median ${draws[250].toFixed(1)}%, best ${draws[499].toFixed(1)}%, as good or better in ${ge} of 500`);
}
test('NFCI + Monday, prior close', CODE[44], CODE[48]);
test('NFCI + Monday, prior day\'s low and high', CODE[44], hl(CODE[48]));
test('Buy-back + Monday (SPY, prior close)', CODE[45], CODE[49]);
const more = (code, p, a, b) => { const lg = L.runLog(code, p, a, b), st = L.statsOfLog(lg); return `${st.cagr.toFixed(1)}% DD ${st.dd.toFixed(1)} w12 ${st.w12.toFixed(0)} x${(lg[lg.length - 1].value / lg[0].value).toFixed(3)}`; };
for (const [nm, code] of [['NFCI + Mon close', CODE[48]], ['NFCI + Mon low/high', hl(CODE[48])]]) console.log(nm.padEnd(22), '2010-25', more(code, {}, '2009-12-31', '2025-12-31'), '| 2010-17', more(code, {}, '2009-12-31', '2017-12-29'), '| 2018-25', more(code, {}, '2017-12-29', '2025-12-31'), '| 2026', more(code, {}, '2025-12-31', '2026-11-06'), '| 2005-25', more(code, {}, '2004-12-31', '2025-12-31'));
