// The 9sig strategy as code (js/strategy-library-code.js nineSigStrategyCode)
// against the app's 9sig engine run directly (js/simulate.js simulate), the way
// a saved 9sig strategy's line was computed (js/saved-configs.js): every library
// 9sig entry and random settings, on quarter windows and exact days, with and
// without monthly deposits and with a dated deposit history, at each display
// grain. Every line point, the final value, the daily-revalued drawdown and the
// rebalance trades must be identical.   node tests/ninesig-code-parity.cjs
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
for (const f of ['data.js', 'simulate.js', 'metrics.js']) vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'js', f), 'utf8'));
const CODE = require(path.join(ROOT, 'js/strategy-library-code.js'));
const read = f => JSON.stringify(fs.readFileSync(path.join(ROOT, 'data', f), 'utf8'));
vm.runInThisContext(`
  daily = buildDaily(${['synthetic-qqq', 'synthetic-tqqq', 'spy', 'synthetic-qld', 'synthetic-sso', 'synthetic-spxl', 'synthetic-sqqq', 'synthetic-gld', 'synthetic-soxl', 'synthetic-soxx'].map(f => `parseDataFile(${read(f + '.tsv')})`).join(', ')});
  quarterlyData = periodRows(daily, getQuarter); monthlyData = periodRows(daily, getMonth);
  dailyDateToIdx = new Map(daily.map((d, i) => [d.date, i]));
  precomputePeriodSeries(); precomputeMonthlyByQuarter(); precomputeSMASeries();`);
const data = { dates: daily.map(d => d.date), ...Object.fromEntries(['tqqq', 'qqq', 'spy', 'qld', 'sso', 'spxl', 'sqqq', 'gld', 'soxl', 'soxx'].map(t => [t, daily.map(d => t === 'sqqq' || t === 'gld' || t === 'soxl' || t === 'soxx' ? d[t] || 0 : d[t])])) };
const qIdx = date => quarterlyData.findIndex(r => r[0] >= date);
const valueOf = v => (v && typeof v === 'object') ? v.value : v;
const strategyOf = code => new Function('"use strict"; return (' + code + '\n)')();
// A dated deposit history in js/transactions.js's schedule shape.
function historyOf(entryDate, exitDate) {
  const rows = data.dates.filter((d, i) => d > entryDate && d <= exitDate && i % 17 === 0).map((d, k) => ({ date: d, amount: k % 5 === 4 ? -700 : 900 }));
  const byDate = new Map(), byMonth = new Map(), list = [], priceDateByMonth = new Map();
  for (const r of rows) { byDate.set(r.date, (byDate.get(r.date) || 0) + r.amount); const m = r.date.slice(0, 7); byMonth.set(m, (byMonth.get(m) || 0) + r.amount); list.push(r); priceDateByMonth.set(m, r.date); }
  return { byDate, byMonth, list, priceDateByMonth };
}

function compare(s, d, win, money, grain) {
  let qa, qb, entryDate, exitDate, exact = !!win.exact;
  if (exact) { entryDate = win.from; exitDate = win.to; qa = qIdx(win.from); qb = qIdx(win.to); }
  else { qa = qIdx(win.from) - 1; qb = win.to ? qIdx(win.to) : quarterlyData.length - 1; entryDate = quarterlyData[qa][0]; exitDate = quarterlyData[qb][0]; }
  const history = money.history ? historyOf(entryDate, exitDate) : null;
  // Native, as js/saved-configs.js ran a saved 9sig strategy.
  const period = d.period, cd = +d.crashDrop, sp = +d.spike;
  const opts = { ...(history ? { schedule: history } : {}), ...(exact ? { entryDateOverride: entryDate, exitDateOverride: exitDate } : {}),
    qGrowth: (+d.growth) / 100 || 0.09, underlyingCol: SMA_ASSET_COL[d.fund], crashDropPct: Number.isFinite(cd) ? cd : 30, crashLookbackMonths: +d.crashWindow || 24,
    spikeTriggerPct: Number.isFinite(sp) ? sp : 100, rebalancePeriod: period, cashPct: (+d.cashPct || 0) / 100,
    contribDeployPct: String(d.deploy) === '1' ? 0.5 : (+d.deploy || 0) / 100, targetFromPrevTarget: ['target', '1'].includes(String(d.targetBase)),
    parkAsset: d.parkAsset || 'cash', buyThrottlePct: +d.buyPower || 90, spikeResetPct: String(d.spikeTarget) || 'auto', tradeCostPct: +d.tradeCost || 0 };
  const rp = +d.rebalancePoint || 0;
  if (rp > 0) { const q = buildEnvelopeQData(period, Math.round(rp / 100 * ((PERIOD_DAYS[period] || 63) - 1)), entryDate, exitDate); if (q && q.length >= 2) opts.qData = q; }
  if (!opts.qData && exact) { const q2 = buildExactRangeQData(period, entryDate, exitDate); if (q2 && q2.length >= 2) opts.qData = q2; }
  opts.sampleQuarterly = grain === 'quarterly' && period === 'yearly';
  opts.sampleWeekly = grain === 'weekly' && period !== 'weekly';
  const nat = simulate(money.initial, money.monthly, (+d.cashRate || 0) / 100, qa, qb, money.raise, opts);
  // The line as the chart draws it (js/saved-configs.js resampleByDate): the last
  // point on each date, since the engine samples a rebalance day twice (the week's
  // point, then the snapshot after the rebalance).
  const natRows = [...new Map(((opts.sampleQuarterly || opts.sampleWeekly) ? nat.samplePoints : nat.log).map(l => [l.date, l])).values()];
  const natDD = computeDailyMaxDrawdown(nat.log.map(l => ({ date: l.date, shares: l.price > 0 ? l.tqqqVal / l.price : 0, cash: l.cash })), daily, d.fund).pct;
  // Code, with the globals js/saved-configs.js computeCustomGlobals gives the sandbox.
  const res = s.run(data, { ...d, initial: money.initial, monthly: money.monthly, annualRaise: money.raise, startIdx: dailyDateToIdx.get(entryDate), endIdx: dailyDateToIdx.get(exitDate),
    entryDate, exitDate, contributions: buildCustomContributions(money.monthly, money.raise, entryDate, exitDate, history), weeklyDisplay: grain === 'weekly',
    exactWindow: exact, depositsFromHistory: !!history, displayGrain: grain });
  const byDay = new Map(res.log.map(r => [r.date, r]));
  const pointsSame = natRows.every(l => byDay.has(l.date) && byDay.get(l.date).value === l.total && byDay.get(l.date).target === l.target && byDay.get(l.date).cashValue === l.cash);
  if (!pointsSame && process.env.PARITY_DEBUG && !global.__shown) {
    global.__shown = true;
    const count = new Map(); natRows.forEach(l => count.set(l.date, (count.get(l.date) || 0) + 1));
    const bad = natRows.filter(l => !byDay.has(l.date) || byDay.get(l.date).value !== l.total || byDay.get(l.date).target !== l.target || byDay.get(l.date).cashValue !== l.cash);
    console.log('mismatches', bad.length, 'of', natRows.length, bad.slice(0, 4).map(l => `${l.date} x${count.get(l.date)} nat ${l.total.toFixed(2)}/${l.target}/${l.cash.toFixed(2)} code ${byDay.has(l.date) ? byDay.get(l.date).value.toFixed(2) + '/' + byDay.get(l.date).target + '/' + byDay.get(l.date).cashValue.toFixed(2) : 'missing'}`).join(' | '));
  }
  const ddSame = natDD === computeDailyMaxDrawdownMulti(res.holdings, daily).pct;
  const natTrades = nat.log.filter(l => /^(BUY|SELL|RESET)/.test(l.action)).length, codeTrades = res.log.filter(r => r.action === 'rebalance').length;
  const ok = pointsSame && ddSame && natTrades === codeTrades && res.log.length === new Set(natRows.map(l => l.date).concat(nat.log.map(l => l.date))).size;
  return ok ? null : { pointsSame, ddSame, natDD, codeDD: computeDailyMaxDrawdownMulti(res.holdings, daily).pct, natTrades, codeTrades, rows: res.log.length };
}

const WINDOWS = [{ from: '2010-01-01' }, { from: '1990-01-01', to: '2025-12-31' }, { exact: true, from: '2014-06-02', to: '2021-09-30' }];
const MONEY = [{ initial: 10000, monthly: 0, raise: 0 }, { initial: 10000, monthly: 500, raise: 0.05 }, { initial: 10000, monthly: 0, raise: 0, history: true }];
const GRAINS = ['quarterly', 'monthly', 'weekly'];
let cases = 0, failures = 0;
const check = (tag, s, d, w, m, g) => { cases++; const bad = compare(s, d, w, m, g); if (bad) { failures++; if (failures <= 12) console.log('  FAIL  ' + tag, JSON.stringify(bad)); } };
for (const n of CODE.NINESIG_LIBRARY_NUMBERS) {
  const s = strategyOf(CODE[n]), d = Object.fromEntries(s.params.filter(q => q.id).map(q => [q.id, valueOf(q.default)]));
  WINDOWS.forEach(w => MONEY.forEach(m => GRAINS.forEach(g => check(`#${n} ${JSON.stringify(w)} ${JSON.stringify(m)} ${g}`, s, d, w, m, g))));
}
let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const base = strategyOf(CODE[42]);
for (let k = 0; k < 60; k++) {
  const d = Object.fromEntries(base.params.filter(q => q.id).map(q => [q.id, valueOf(q.options[Math.floor(rnd() * q.options.length)])]));
  check(`random ${JSON.stringify(d)}`, base, d, WINDOWS[k % 3], MONEY[k % 3], GRAINS[k % 3]);
}
if (failures) { console.log(`9sig code parity: ${failures} of ${cases} differ`); process.exit(1); }
console.log(`9sig code parity: all ${cases} cases identical`);
