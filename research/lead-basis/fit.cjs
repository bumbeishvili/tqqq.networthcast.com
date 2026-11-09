'use strict';
// Fits a lead basis's thresholds the way the app's Fit does (coordinate descent over option grids,
// passes until nothing moves), with random restarts, on real engine runs ($100K lump sum).
//   node fit.cjs --n 50 --lead tqqq --basis residual3x --mode insample --starts 16 --out x.json
//   modes: insample (fit 2010-2025, then 2026 holdout, halves, plateau), walkforward (6-year fits,
//   one test year each 2016-2026, plus the two halves fitted on each other), surrogate (the lead
//   series circularly shifted by random offsets, fitted the same way: how much CAGR the search
//   alone finds when the lead carries no information).
const fs = require('fs'), path = require('path');
const { run, strategyOf, defaultsOf, data, idxOf, idxBefore } = require('./harness.cjs');
const { BASIS_CODE } = require('./basis.cjs');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i < 0 ? d : process.argv[i + 1]; };
const N = +arg('n', 50), LEAD = arg('lead', 'tqqq'), BASIS = arg('basis', 'growth'), MODE = arg('mode', 'insample');
const STARTS = +arg('starts', 16), TIER = arg('tier', 'lead'), SEED = +arg('seed', 7);
const SURROGATES = +arg('surrogates', 20), PASSES = +arg('passes', 4), CONSTRAIN = +arg('constrain', 0), WINDOW = +arg('window', 6);   // walk-forward: years fitted before each test year
const KERNEL = arg('kernel', LEAD === 'tqqq' ? 'box' : 'point');   // start kernel (basis.cjs): box/point = the library's own, ema, tri
const KERNEL_FIXED = KERNEL === 'box' || KERNEL === 'point' ? {} : { [LEAD === 'tqqq' ? 'startKernel' : 'soxlStartKernel']: KERNEL };
const SPREADS = [0.1, 0.15, 0.25, 0.5, 0.75, 1];   // tri: half-width as a fraction of the lookback (0.1 and 0.15 added after both first fits picked 0.25, the narrowest then offered)
const EXTRA_FIXED = JSON.parse(arg('fixed', '{}'));
const VOTE = (arg('vote', '') || '').trim();   // --vote "450,475,...": the TQQQ lead voted across these horizons (vote.cjs); the lookback and start dims leave the space
const VOTEMODE = arg('votemode', 'median');    // median | majority
const VOTE_FIXED = VOTE ? { voteMode: VOTEMODE, voteLookbacks: VOTE.split(',').map(Number) } : {};
const SCALE = arg('scale', '');   // --scale smooth|vol|sigma: the scale-free leads of scale.cjs (smooth adds the leadSmooth dim; vol = volatility clock; sigma = sigma units)
const SCALE_FIXED = SCALE === 'vol' ? { leadClock: 'vol' } : SCALE === 'sigma' ? { leadUnits: 'sigma' } : {};   // --fixed '{"soxlStartKernel":"tri",...}': settings held at these values through the fit (the other lead's kernel and fitted values)
const code = VOTE ? require('./vote.cjs').VOTE_CODE[N] : SCALE ? require('./scale.cjs').SCALE_CODE[N] : BASIS_CODE[N];
const OUT = arg('out', `out/${N}-${LEAD}-${BASIS}${KERNEL === 'box' || KERNEL === 'point' ? '' : '-' + KERNEL}-${MODE}.json`);
const basisKey = LEAD === 'tqqq' ? 'leadBasis' : 'soxlLeadBasis', shiftKey = LEAD === 'tqqq' ? 'leadShift' : 'soxlLeadShift';
const FIT_FROM = '2010-01-01', FIT_TO = '2025-12-31';
let seed = SEED; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const optionValues = (id) => strategyOf(code).params.find(p => p.id === id).options.map(o => (o && typeof o === 'object') ? o.value : o);
// Quantile grid of the basis's lead over the fit period at the default lookback: 199 values from p0.5 to p99.5, 1 decimal.
function quantileGrid(key) {
  const r = run(code, { [basisKey]: BASIS, ...KERNEL_FIXED, ...EXTRA_FIXED, ...VOTE_FIXED, ...SCALE_FIXED }, FIT_FROM, FIT_TO);
  const v = r.log.map(x => x[key]).filter(x => typeof x === 'number' && isFinite(x)).sort((a, b) => a - b);
  const out = []; for (let k = 1; k <= 199; k++) { const q = +v[Math.round(k / 200 * (v.length - 1))].toFixed(1); if (!out.length || out[out.length - 1] !== q) out.push(q); }
  return out;
}
const SPACE = [];
if (LEAD === 'tqqq') {
  const G = quantileGrid('leadPct');
  if (!VOTE) SPACE.push({ id: 'lookbackDays', values: [252, 280, 300, 320, 340, 360, 380, 400, 420, 440, 460, 480, 500, 510, 520, 530, 540, 550, 560, 570, 580, 590, 600, 620, 640, 660, 680, 700, 720, 756, 780, 800, 840, 880, 920, 960, 1008] });
  if (!VOTE && KERNEL === 'box') SPACE.push({ id: 'startAvgDays', values: [0, 10, 20, 40, 65, 90, 120] });
  if (SCALE === 'smooth') SPACE.push({ id: 'leadSmooth', values: [1, 2, 3, 5, 10, 20] });
  if (VOTE && VOTEMODE === 'winner') {
    SPACE.push({ id: 'voteSelWindow', values: [126, 252, 378, 504, 756, 1008] });
    SPACE.push({ id: 'voteSelHyst', values: [1, 1.02, 1.05, 1.1, 1.2] });
  }
  if (KERNEL === 'tri') SPACE.push({ id: 'startSpread', values: SPREADS });
  SPACE.push({ id: 'topLead', values: G.concat([9999]), lead: true });
  SPACE.push({ id: 'backLead', values: G, lead: true });
  SPACE.push({ id: 'floorLead', values: [-9999].concat(G), lead: true });
  SPACE.push({ id: 'reentryLead', values: G, lead: true });
  SPACE.push({ id: 'deepLead', values: [-9999].concat(G), lead: true });
  if (TIER === 'full') for (const id of ['topDays', 'floorHold', 'reentryCloses', 'overPct', 'overWindow', 'sqqqMaxDays', 'deepGuard', 'nfciVeto']) SPACE.push({ id, values: optionValues(id) });
} else {
  const G = quantileGrid('soxlLead');
  SPACE.push({ id: 'soxlLeadDays', values: optionValues('soxlLeadDays') });
  if (KERNEL === 'tri') SPACE.push({ id: 'soxlStartSpread', values: SPREADS });
  SPACE.push({ id: 'soxlLeadEnter', values: G, lead: true });
  SPACE.push({ id: 'soxlLeadExit', values: G, lead: true });
}
const DEFAULTS = defaultsOf(code);
const nearest = (values, x) => values.reduce((b, v) => (typeof v === 'number' && typeof x === 'number' && Math.abs(v - x) < Math.abs(b - x) ? v : b), values[0]);
const defaultStart = () => Object.fromEntries(SPACE.map(s => [s.id, typeof DEFAULTS[s.id] === 'number' ? nearest(s.values, DEFAULTS[s.id]) : DEFAULTS[s.id]]));
const randomStart = () => { for (;;) { const p = Object.fromEntries(SPACE.map(s => [s.id, s.values[Math.floor(rnd() * s.values.length)]])); if (!CONSTRAIN || LEAD !== 'soxl' || !(p.soxlLeadEnter > p.soxlLeadExit)) return p; } };
// One fit: coordinate descent from `start` over [from, to]; extra params fixed (the basis, a shift).
function fit(start, from, to, fixed, passes = PASSES) {
  const memo = new Map();
  // --constrain 1: the SOXL band keeps its meaning, entry level at or under the exit level (an inverted band flips SOXL on and off day by day).
  const allowed = (p) => !CONSTRAIN || LEAD !== 'soxl' || !(p.soxlLeadEnter > p.soxlLeadExit);
  const score = (p) => { const k = JSON.stringify(SPACE.map(s => p[s.id])); if (!memo.has(k)) { if (!allowed(p)) memo.set(k, { cagr: -1e9, dd: NaN }); else { const r = run(code, { ...fixed, ...p }, from, to); memo.set(k, { cagr: isFinite(r.cagr) ? r.cagr : -1e9, dd: r.dd }); } } return memo.get(k); };
  let cur = { ...start }, best = score(cur);
  for (let pass = 1; pass <= passes; pass++) {
    let moved = false;
    for (const s of SPACE) {
      let pick = cur[s.id], pickScore = best;
      for (const v of s.values) { if (v === cur[s.id]) continue; const sc = score({ ...cur, [s.id]: v }); if (sc.cagr > pickScore.cagr + 1e-9) { pick = v; pickScore = sc; } }
      if (pick !== cur[s.id]) { cur[s.id] = pick; best = pickScore; moved = true; }
    }
    if (!moved) break;
  }
  return { params: cur, cagr: best.cagr, dd: best.dd, evaluations: memo.size };
}
function multiFit(from, to, fixed, starts) {
  const results = []; let bestFit = null;
  for (let k = 0; k < starts; k++) {
    const t0 = Date.now(), f = fit(k === 0 ? defaultStart() : randomStart(), from, to, fixed);
    results.push({ cagr: +f.cagr.toFixed(2), dd: +f.dd.toFixed(2), params: f.params, ms: Date.now() - t0 });
    if (!bestFit || f.cagr > bestFit.cagr) bestFit = f;
    process.stderr.write(`  start ${k}: ${f.cagr.toFixed(1)}% dd ${f.dd.toFixed(1)} (${f.evaluations} runs, ${((Date.now() - t0) / 1000).toFixed(0)} s)\n`);
  }
  return { best: bestFit, starts: results };
}
const evalOn = (params, from, to, fixed) => { const r = run(code, { ...fixed, ...params }, from, to); return { cagr: +r.cagr.toFixed(2), dd: +r.dd.toFixed(2) }; };
// Each lead threshold moved one and two grid steps either way, the rest fixed: the worst neighbour.
function plateau(params, from, to, fixed) {
  const out = {};
  for (const s of SPACE.filter(s => s.lead)) {
    const k = s.values.indexOf(params[s.id]); const vals = [];
    for (const d of [-2, -1, 1, 2]) { const v = s.values[k + d]; if (v != null && typeof v === 'number' && Math.abs(v) < 9000) vals.push(evalOn({ ...params, [s.id]: v }, from, to, fixed).cagr); }
    out[s.id] = { at: params[s.id], neighbours: vals };
  }
  return out;
}
const fixed = { [basisKey]: BASIS, ...KERNEL_FIXED, ...EXTRA_FIXED, ...VOTE_FIXED, ...SCALE_FIXED };
const bh = (fund, from, to) => { const a = idxOf(from), b = idxBefore(to); const yrs = (Date.parse(data.dates[b]) - Date.parse(data.dates[a])) / (365.25 * 86400000); return +((Math.pow(data[fund][b] / data[fund][a], 1 / yrs) - 1) * 100).toFixed(1); };
const out = { n: N, lead: LEAD, basis: BASIS, kernel: KERNEL, vote: VOTE_FIXED, scale: SCALE, fixed: EXTRA_FIXED, mode: MODE, tier: TIER, constrain: CONSTRAIN, window: WINDOW, starts: STARTS, space: SPACE.map(s => ({ id: s.id, count: s.values.length, min: s.values.filter(v => typeof v === 'number' && Math.abs(v) < 9000)[0], max: s.values.filter(v => typeof v === 'number' && Math.abs(v) < 9000).slice(-1)[0] })), bhTqqq2010_2025: bh('tqqq', FIT_FROM, FIT_TO) };
const t0 = Date.now();
if (MODE === 'insample') {
  out.asShipped = evalOn({}, FIT_FROM, FIT_TO, fixed);
  const m = multiFit(FIT_FROM, FIT_TO, fixed, STARTS);
  out.fit = { cagr: +m.best.cagr.toFixed(2), dd: +m.best.dd.toFixed(2), params: m.best.params, starts: m.starts };
  out.holdout2026 = evalOn(m.best.params, '2026-01-01', '2026-12-31', fixed);
  out.halves = { h1: evalOn(m.best.params, '2010-01-01', '2017-12-31', fixed), h2: evalOn(m.best.params, '2018-01-01', '2025-12-31', fixed) };
  out.plateau = plateau(m.best.params, FIT_FROM, FIT_TO, fixed);
} else if (MODE === 'walkforward') {
  out.folds = [];
  const chain = [];
  for (let y = Math.max(2016, 2010 + WINDOW); y <= 2026; y++) {
    const m = multiFit(`${y - WINDOW}-01-01`, `${y - 1}-12-31`, fixed, STARTS);
    const test = evalOn(m.best.params, `${y}-01-01`, `${y}-12-31`, fixed);
    const r = run(code, { ...fixed, ...m.best.params }, `${y}-01-01`, `${y}-12-31`);
    chain.push({ from: r.log[0].date, to: r.log[r.log.length - 1].date, factor: r.log[r.log.length - 1].value / r.log[0].value });
    const bhY = bh('tqqq', `${y}-01-01`, `${y}-12-31`);
    out.folds.push({ year: y, fitCagr: +m.best.cagr.toFixed(1), fitDd: +m.best.dd.toFixed(1), params: m.best.params, test, bhTqqq: bhY });
    process.stderr.write(`fold ${y}: fit ${m.best.cagr.toFixed(1)} -> test ${test.cagr} (dd ${test.dd}), B&H TQQQ ${bhY}\n`);
  }
  const yrs = (Date.parse(chain[chain.length - 1].to) - Date.parse(chain[0].from)) / (365.25 * 86400000);
  out.chained = { from: chain[0].from, to: chain[chain.length - 1].to, cagr: +((Math.pow(chain.reduce((f, c) => f * c.factor, 1), 1 / yrs) - 1) * 100).toFixed(1), bhTqqq: bh('tqqq', chain[0].from, chain[chain.length - 1].to) };
  const h1 = multiFit('2010-01-01', '2017-12-31', fixed, STARTS), h2 = multiFit('2018-01-01', '2025-12-31', fixed, STARTS);
  out.halves = { fitH1: { cagr: +h1.best.cagr.toFixed(1), params: h1.best.params, testH2: evalOn(h1.best.params, '2018-01-01', '2025-12-31', fixed) }, fitH2: { cagr: +h2.best.cagr.toFixed(1), params: h2.best.params, testH1: evalOn(h2.best.params, '2010-01-01', '2017-12-31', fixed) } };
} else if (MODE === 'surrogate') {
  out.surrogates = [];
  const m = data.dates.length - 700;
  for (let k = 0; k < SURROGATES; k++) {
    const shift = 600 + Math.floor(rnd() * (m - 1200));
    const f = multiFit(FIT_FROM, FIT_TO, { ...fixed, [shiftKey]: shift }, STARTS);
    out.surrogates.push({ shift, cagr: +f.best.cagr.toFixed(1), dd: +f.best.dd.toFixed(1), params: f.best.params });
    process.stderr.write(`surrogate ${k} (shift ${shift}): ${f.best.cagr.toFixed(1)}%\n`);
  }
  const c = out.surrogates.map(s => s.cagr).sort((a, b) => a - b);
  out.surrogateSummary = { n: c.length, min: c[0], median: c[Math.floor(c.length / 2)], p90: c[Math.floor(0.9 * (c.length - 1))], max: c[c.length - 1] };
}
out.seconds = Math.round((Date.now() - t0) / 1000);
fs.mkdirSync(path.join(__dirname, 'out'), { recursive: true });
fs.writeFileSync(path.isAbsolute(OUT) ? OUT : path.join(__dirname, OUT), JSON.stringify(out, null, 1));
console.log(JSON.stringify({ n: N, lead: LEAD, basis: BASIS, kernel: KERNEL, mode: MODE, seconds: out.seconds, fit: out.fit && { cagr: out.fit.cagr, dd: out.fit.dd }, holdout: out.holdout2026, chained: out.chained, surrogates: out.surrogateSummary }));
