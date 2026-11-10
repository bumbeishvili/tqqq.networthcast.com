'use strict';
// The app's Fit (Best CAGR) in Node: each setting in turn tries every option with the others held and keeps the
// best; passes repeat until one changes nothing (at most 4); then each numeric pick tries the values between it
// and the options next to it. Start 0 is the shipped settings; further starts redraw a few settings at random first.
//   node fitapp.cjs <n> --from 2009-12-31 --to 2025-12-31 --starts 5 --seed 3 --label x [--start JSON] [--redraw 4]
const fs = require('fs'), path = require('path'), L = require('./lib.cjs');
const { CODE, NAMES, idxOf, idxBefore, runOn, data, statsOfLog } = L;
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i < 0 ? d : process.argv[i + 1]; };
const n = +process.argv[2], FROM = arg('from', L.FIT_FROM), TO = arg('to', L.FIT_TO), STARTS = +arg('starts', 1), SEED = +arg('seed', 3), REDRAW = +arg('redraw', 4);
const label = arg('label', `${n}-${FROM.slice(0, 4)}-${TO.slice(0, 4)}`), START = JSON.parse(arg('start', '{}'));
const code = CODE[n], defaults = { ...L.defaultsOf(code), ...START }, s = idxOf(FROM), e = idxBefore(TO);
const SKIP = new Set(['soxlPile', 'pileHandover', 'pileFloor', 'asset']);   // no deposits in these runs; the traded fund stays TQQQ
const space = L.fitIds(code).filter(id => !SKIP.has(id)).map(id => ({ id, values: L.optionValues(code, id) }));
const memo = new Map(); let runs = 0;
const measure = (p) => { const k = space.map(x => p[x.id]).join('|'); if (!memo.has(k)) { runs++; let st; try { st = statsOfLog(runOn(data, code, p, s, e)); } catch (err) { st = { cagr: -1e9, dd: 100, end: 0 }; } memo.set(k, { cagr: isFinite(st.cagr) ? st.cagr : -1e9, dd: st.dd }); } return memo.get(k); };
const better = (a, b) => a.cagr > b.cagr + 1e-9 || (Math.abs(a.cagr - b.cagr) <= 1e-9 && a.dd < b.dd - 1e-9);
function between(sp, picked) {
  if (!sp.values.every(v => typeof v === 'number')) return [];
  const plain = sp.values.filter(v => Math.abs(v) < 999).sort((a, b) => a - b), k = plain.indexOf(picked); if (k < 0) return [];
  const whole = plain.every(Number.isInteger), out = new Set();
  for (const nb of [plain[k - 1], plain[k + 1]]) { if (nb == null) continue; const gap = nb - picked;
    if (whole) { const c = Math.min(Math.abs(gap) - 1, 20); for (let i = 1; i <= c; i++) out.add(Math.round(picked + gap * i / (c + 1))); }
    else for (let i = 1; i < 5; i++) out.add(+(picked + gap * i / 5).toFixed(3)); }
  out.delete(picked); return [...out];
}
function fit(start) {
  const cur = { ...start }; let best = measure(cur);
  const sweep = (sp, values) => { let pick = null, pb = best; for (const v of values) { if (v === cur[sp.id]) continue; const r = measure({ ...cur, [sp.id]: v }); if (better(r, pb)) { pick = v; pb = r; } } if (pick === null) return false; cur[sp.id] = pick; best = pb; return true; };
  for (let round = 1; round <= 4; round++) { let changed = false; for (const sp of space) if (sweep(sp, sp.values)) changed = true; if (!changed) break; }
  for (const sp of space) sweep(sp, between(sp, cur[sp.id]));
  return { params: cur, cagr: best.cagr, dd: best.dd };
}
let seed = SEED; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const results = [], t0 = Date.now();
for (let k = 0; k < STARTS; k++) {
  const start = { ...defaults };
  if (k > 0) for (let j = 0; j < REDRAW; j++) { const sp = space[Math.floor(rnd() * space.length)]; start[sp.id] = sp.values[Math.floor(rnd() * sp.values.length)]; }
  const f = fit(start), changed = Object.fromEntries(space.filter(sp => f.params[sp.id] !== L.defaultsOf(code)[sp.id]).map(sp => [sp.id, f.params[sp.id]]));
  results.push({ start: k, cagr: f.cagr, dd: f.dd, changed });
  console.log(`start ${k}: ${f.cagr.toFixed(1)}% DD ${f.dd.toFixed(1)} | ${JSON.stringify(changed)} | ${runs} runs, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  fs.writeFileSync(path.join(__dirname, 'out', `fitapp-${label}.json`), JSON.stringify({ n, from: FROM, to: TO, shipped: measure(defaults), results }));
}
const top = results.reduce((a, b) => b.cagr > a.cagr ? b : a);
console.log(`== ${NAMES[n]} ${FROM}..${TO}: shipped ${measure(defaults).cagr.toFixed(1)}% -> best ${top.cagr.toFixed(1)}% DD ${top.dd.toFixed(1)} (start ${top.start})`);
