// The SMA strategy as code (js/strategy-library-code.js smaStrategyCode) against
// the app's SMA engine run directly (js/simulate.js simulateSMA), the way a saved
// SMA strategy's line was computed: every library SMA entry and random settings,
// on quarter windows and exact days, with and without monthly deposits, weekly
// sampling on and off. Every line point, the final value, the daily-revalued
// drawdown and the trade days must be identical.   node tests/sma-code-parity.cjs
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
for (const f of ['data.js', 'simulate.js', 'metrics.js']) vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'js', f), 'utf8'));
const CODE = require(path.join(ROOT, 'js/strategy-library-code.js'));
const read = f => JSON.stringify(fs.readFileSync(path.join(ROOT, 'data', f), 'utf8'));
// The page's globals, as js/init.js and js/data.js build them.
vm.runInThisContext(`
  daily = buildDaily(${['synthetic-qqq', 'synthetic-tqqq', 'spy', 'synthetic-qld', 'synthetic-sso', 'synthetic-spxl', 'synthetic-sqqq'].map(f => `parseDataFile(${read(f + '.tsv')})`).join(', ')});
  quarterlyData = periodRows(daily, getQuarter); monthlyData = periodRows(daily, getMonth);
  dailyDateToIdx = new Map(daily.map((d, i) => [d.date, i]));
  precomputeSMASeries();`);
const data = { dates: daily.map(d => d.date), ...Object.fromEntries(['tqqq', 'qqq', 'spy', 'qld', 'sso', 'spxl', 'sqqq'].map(t => [t, daily.map(d => t === 'sqqq' ? d.sqqq || 0 : d[t])])) };
const qIdx = date => quarterlyData.findIndex(r => r[0] >= date);
const valueOf = v => (v && typeof v === 'object') ? v.value : v;
const strategyOf = code => new Function('"use strict"; return (' + code + '\n)')();

function compare(s, settings, win, money, weekly) {
  let qa, qb, entryDate, exitDate, over = {};
  if (win.exact) { entryDate = win.from; exitDate = win.to; qa = qIdx(win.from); qb = qIdx(win.to); over = { entryDateOverride: entryDate, exitDateOverride: exitDate }; }
  else { qa = qIdx(win.from) - 1; qb = win.to ? qIdx(win.to) : quarterlyData.length - 1; entryDate = quarterlyData[qa][0]; exitDate = quarterlyData[qb][0]; }
  const d = settings, { initial, monthly, raise } = money;
  const nat = simulateSMA(initial, monthly, d.cashRate / 100, qa, qb, raise, {
    ...over, smaAsset: d.signal, smaWindow: d.window, underlyingCol: SMA_ASSET_COL[d.fund], entryBufferPct: d.entryBuf, exitBufferPct: d.exitBuf,
    rsiOverheatThreshold: d.rsiSell, rsiCoolThreshold: d.rsiBuy, outAsset: d.outAsset, dcaInMonths: d.easeIn, dcaToOutMonths: d.easeOut,
    bgGtfoPct: d.brakePct, bgAsset: d.brakeAsset, bgWindow: d.brakeWindow, tradeCostPct: d.tradeCost, rsiOhWindow: d.rsiSellWindow,
    rsiCoolWindow: d.rsiBuyWindow, rebalanceCheck: 'daily', confirmBuySteps: d.confirmBuy, confirmSellSteps: d.confirmSell, settleDays: d.settleDays,
    emitDD: true, sampleWeekly: weekly });
  const res = s.run(data, { ...d, initial, monthly, annualRaise: raise, startIdx: dailyDateToIdx.get(entryDate), endIdx: dailyDateToIdx.get(exitDate),
    entryDate, exitDate, contributions: buildCustomContributions(monthly, raise, entryDate, exitDate), weeklyDisplay: weekly });
  const byDay = new Map(res.log.map(r => [r.date, r.value]));   // the line as the chart reads it: each day's row
  const pointsSame = nat.smaPoints.every(pt => byDay.get(pt.date) === pt.value);
  const ddSame = computeDailyMaxDrawdownMulti(nat.ddControls, daily).pct === computeDailyMaxDrawdownMulti(res.holdings, daily).pct;
  const natTradeDays = new Set(nat.smaLog.filter(e => !['CONTRIB', 'END', 'START'].includes(e.action)).map(e => e.date)).size;
  const codeTradeDays = res.log.filter(r => ['buy', 'sell', 'switch', 'ease-in'].includes(r.action)).length;
  return pointsSame && ddSame && natTradeDays === codeTradeDays && res.log.at(-1).value === nat.smaPoints.at(-1).value;
}

const WINDOWS = [{ from: '2010-01-01' }, { from: '1990-01-01', to: '2025-12-31' }, { exact: true, from: '2014-06-02', to: '2021-09-30' }];
const MONEY = [{ initial: 10000, monthly: 0, raise: 0 }, { initial: 10000, monthly: 500, raise: 0.05 }];
let cases = 0, failures = 0;
const check = (tag, s, settings, win, money, weekly) => { cases++; if (!compare(s, settings, win, money, weekly)) { failures++; console.log('  FAIL  ' + tag); } };
for (const n of CODE.SMA_LIBRARY_NUMBERS) {
  const s = strategyOf(CODE[n]), d = Object.fromEntries(s.params.filter(q => q.id).map(q => [q.id, valueOf(q.default)]));
  WINDOWS.forEach(w => MONEY.forEach(m => [false, true].forEach(weekly => check(`#${n} ${JSON.stringify(w)} monthly ${m.monthly} weekly ${weekly}`, s, d, w, m, weekly))));
}
// Random settings, each drawn from its dropdown's options.
let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const base = strategyOf(CODE[43]);
for (let k = 0; k < 60; k++) {
  const d = Object.fromEntries(base.params.filter(q => q.id).map(q => [q.id, valueOf(q.options[Math.floor(rnd() * q.options.length)])]));
  check(`random ${JSON.stringify(d)}`, base, d, WINDOWS[k % 3], MONEY[k % 2], k % 4 < 2);
}
if (failures) { console.log(`sma code parity: ${failures} of ${cases} differ`); process.exit(1); }
console.log(`sma code parity: all ${cases} cases identical`);
