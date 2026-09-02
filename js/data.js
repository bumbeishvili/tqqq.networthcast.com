// Parse "M/D/YYYY HH:MM:SS" -> "YYYY-MM-DD", auto-detect delimiter (tab or comma)
function parseDataFile(text) {
  const lines = text.trim().split(/\r?\n/).slice(1);
  const sep = lines[0].includes('\t') ? '\t' : ',';
  return lines.map(line => {
    const [dateStr, close] = line.split(sep);
    const parts = dateStr.split(' ')[0].split('/');
    const m = parts[0].padStart(2, '0');
    const d = parts[1].padStart(2, '0');
    const y = parts[2];
    return [y + '-' + m + '-' + d, parseFloat(close)];
  });
}

// The daily GitHub Action rewrites these TSVs in place, so a fixed query
// string (the old `?v=baked`) just pinned every browser to a stale copy.
// `cache: 'no-cache'` revalidates on each load: a few bytes for a 304 when the
// file is unchanged, fresh bytes the moment the cron publishes new data.
async function loadSeries(file) {
  const resp = await fetch('data/' + file, { cache: 'no-cache' });
  if (!resp.ok) throw new Error('Failed to load ' + file + ' (HTTP ' + resp.status + ')');
  return parseDataFile(await resp.text());
}

async function loadQQQDaily()  { return loadSeries('synthetic-qqq.tsv'); }
async function loadNFCIWeekly() { return loadSeries('nfci.tsv'); }
async function loadQLDDaily()  { return loadSeries('synthetic-qld.tsv'); }
async function loadTQQQDaily() { return loadSeries('synthetic-tqqq.tsv'); }
async function loadSPYDaily()  { return loadSeries('spy.tsv'); }
async function loadSSODaily()  { return loadSeries('synthetic-sso.tsv'); }
async function loadSPXLDaily() { return loadSeries('synthetic-spxl.tsv'); }
async function loadSQQQDaily() { return loadSeries('synthetic-sqqq.tsv'); }

// Merge daily TSVs by date. The synthetic TSVs already contain synthesized
// pre-inception rows (baked by update_data.py), so this is a straight join —
// no synthesis here. monthlyData column layout:
//   [date, tqqq, qqq, spy, qld, sso, spxl]   (cols 0..6); sqqq rides on the
//   daily objects only (custom strategies read it by name, not by column).
function buildDaily(qqqDaily, tqqqDaily, spyDaily, qldDaily, ssoDaily, spxlDaily, sqqqDaily) {
  const tqqqMap = new Map(tqqqDaily.map(d => [d[0], d[1]]));
  const spyMap  = new Map(spyDaily.map(d => [d[0], d[1]]));
  const qldMap  = qldDaily  ? new Map(qldDaily.map(d  => [d[0], d[1]])) : null;
  const ssoMap  = ssoDaily  ? new Map(ssoDaily.map(d  => [d[0], d[1]])) : null;
  const spxlMap = spxlDaily ? new Map(spxlDaily.map(d => [d[0], d[1]])) : null;
  const sqqqMap = sqqqDaily ? new Map(sqqqDaily.map(d => [d[0], d[1]])) : null;
  const result = [];
  for (const [date, qqqPrice] of qqqDaily) {
    const tqqqPrice = tqqqMap.get(date);
    if (tqqqPrice != null) {
      result.push({
        date,
        qqq:  qqqPrice,
        tqqq: tqqqPrice,
        spy:  spyMap.get(date) || 0,
        qld:  qldMap  ? (qldMap.get(date)  || 0) : 0,
        sso:  ssoMap  ? (ssoMap.get(date)  || 0) : 0,
        spxl: spxlMap ? (spxlMap.get(date) || 0) : 0,
        sqqq: sqqqMap ? (sqqqMap.get(date) || 0) : 0,
      });
    }
  }
  return result;
}

let daily; // populated by init()

// Chicago Fed NFCI (weekly) aligned to daily trading days. Each weekly value
// becomes usable 7 calendar days after its observation date (the Fed publishes
// the following Wednesday for the week ending Friday), then forward-fills
// until the next release — so a backtest never reads a number before the
// market could have known it. NaN before the first usable release (1971).
let nfciDaily = null; // populated by init()
function buildNfciDaily(dailyArr, nfciRows) {
  const avail = nfciRows.map(([d, v]) => {
    const t = new Date(d + 'T00:00:00Z');
    t.setUTCDate(t.getUTCDate() + 7);
    return [t.toISOString().slice(0, 10), v];
  });
  const out = new Array(dailyArr.length);
  let j = 0, cur = NaN;
  for (let i = 0; i < dailyArr.length; i++) {
    while (j < avail.length && avail[j][0] <= dailyArr[i].date) { cur = avail[j][1]; j++; }
    out[i] = cur;
  }
  return out;
}

// === Derive quarterly and monthly from daily ===
function lastOfPeriod(daily, periodFn) {
  const groups = {};
  daily.forEach(d => {
    const key = periodFn(d.date);
    groups[key] = d; // last one wins
  });
  return Object.values(groups);
}

function getQuarter(dateStr) {
  const m = parseInt(dateStr.substring(5, 7));
  const q = m <= 3 ? 'Q1' : m <= 6 ? 'Q2' : m <= 9 ? 'Q3' : 'Q4';
  return dateStr.substring(0, 4) + '-' + q;
}

function getMonth(dateStr) {
  return dateStr.substring(0, 7);
}

function getYear(dateStr) {
  return dateStr.substring(0, 4);
}

// ISO week key for a YYYY-MM-DD date string. Used to bucket daily entries
// into trading-week groups so weekly rebalancing has stable period boundaries.
function getWeek(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  // Adjust to nearest Thursday (ISO week algorithm) then read year+week.
  const day = (d.getUTCDay() + 6) % 7;          // Mon=0 ... Sun=6
  d.setUTCDate(d.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const diff = (d - firstThursday) / 86400000;
  const week = 1 + Math.round((diff - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return d.getUTCFullYear() + '-W' + String(week).padStart(2, '0');
}

// Period-name → trading days per period. Used both for envelope-shift sizing
// (how many "rebalance-day-of-period" variants to render) and for the simulate
// loop's per-period growth-rate scaling.
const PERIOD_DAYS = { weekly: 5, monthly: 21, quarterly: 63, yearly: 252 };

let quarterlyData, monthlyData; // populated by init()
// Built on demand by precomputePeriodSeries() — same shape as quarterlyData
// (one row per period, last trading-day price in that period).
let weeklyData = null, yearlyData = null;
let periodDataByName = null;     // { weekly, monthly, quarterly, yearly }
let monthsInPeriodByName = null; // { period: [ [monthly indices], ... ] }
let dailyDateToIdx; // populated by init()
// monthlyByQuarter[qi] = indices into monthlyData whose date falls in
// (quarterlyData[qi-1].date, quarterlyData[qi].date]. Replaces simulate()'s
// hot per-quarter scan of all of monthlyData with an O(1) lookup of the 2-3
// monthly entries that actually matter for that quarter. Computed once after
// data load. Only used when simulate runs against the default quarterlyData;
// envelope-shifted runs fall back to the linear scan.
let monthlyByQuarter = null;

// Build periodData (one entry per period, last trading day in that period)
// for the named period. Mirrors the existing monthlyData / quarterlyData
// shape — same columns, same date format. Called once after `daily` loads.
function buildPeriodData(periodFn) {
  return lastOfPeriod(daily, periodFn).map(d => [d.date, d.tqqq, d.qqq, d.spy, d.qld, d.sso, d.spxl, d.sqqq]);
}

// Build the months-in-period index for the given periodData. monthsInPeriod[i]
// is the list of monthlyData indices whose date falls in
// (periodData[i-1].date, periodData[i].date]. Same semantics as the existing
// monthlyByQuarter cache — drives the contribution loop in simulate().
function buildMonthsInPeriod(periodData) {
  if (!periodData || !monthlyData) return null;
  const out = new Array(periodData.length);
  out[0] = [];
  let mIdx = 0;
  while (mIdx < monthlyData.length && monthlyData[mIdx][0] <= periodData[0][0]) mIdx++;
  for (let pi = 1; pi < periodData.length; pi++) {
    const cur = periodData[pi][0];
    const list = [];
    while (mIdx < monthlyData.length && monthlyData[mIdx][0] <= cur) {
      list.push(mIdx);
      mIdx++;
    }
    out[pi] = list;
  }
  return out;
}

function precomputePeriodSeries() {
  if (!daily || !monthlyData) return;
  weeklyData    = buildPeriodData(getWeek);
  yearlyData    = buildPeriodData(getYear);
  periodDataByName = {
    weekly:    weeklyData,
    monthly:   monthlyData,
    quarterly: quarterlyData,
    yearly:    yearlyData,
  };
  monthsInPeriodByName = {
    weekly:    buildMonthsInPeriod(weeklyData),
    monthly:   buildMonthsInPeriod(monthlyData),
    quarterly: null, // set after precomputeMonthlyByQuarter
    yearly:    buildMonthsInPeriod(yearlyData),
  };
}

function precomputeMonthlyByQuarter() {
  if (!quarterlyData || !monthlyData) { monthlyByQuarter = null; return; }
  const out = new Array(quarterlyData.length);
  out[0] = [];
  let mIdx = 0;
  // Skip months at-or-before the first quarter (they don't belong to any window).
  while (mIdx < monthlyData.length && monthlyData[mIdx][0] <= quarterlyData[0][0]) mIdx++;
  for (let qi = 1; qi < quarterlyData.length; qi++) {
    const curDate = quarterlyData[qi][0];
    const list = [];
    while (mIdx < monthlyData.length && monthlyData[mIdx][0] <= curDate) {
      list.push(mIdx);
      mIdx++;
    }
    out[qi] = list;
  }
  monthlyByQuarter = out;
  if (monthsInPeriodByName) monthsInPeriodByName.quarterly = out;
}
// Build a custom qData array for the select-9sig-rebalance-point-% feature.
// The run STARTS at the canonical entry date with the same $10K allocation
// (anchoring the chart visually), then rebalances every `period_days`
// trading days starting at `entry + dayOffset` — dayOffset comes from the
// user's chosen % through the period, so this is "rebalance N% into each
// period instead of exactly at the boundary." dayOffset=period_days
// collapses to the canonical schedule.
//
// Date-anchored rather than shifting every row's date/price back by N days:
// for periods longer than ~1 quarter, a date shift moves the entry
// backwards, so the sim would run for a window before the chart's first
// label and the line would show up far above $10K at the chart's leftmost x.
function buildEnvelopeQData(period, dayOffset, entryDate, exitDate) {
  if (!daily || !dailyDateToIdx) return [];
  const entryDailyIdx = dailyDateToIdx.get(entryDate);
  if (entryDailyIdx == null) return [];
  const periodDays = PERIOD_DAYS[period] || 63;
  const entryD = daily[entryDailyIdx];
  const rowFor = (d) => [d.date, d.tqqq, d.qqq, d.spy, d.qld, d.sso, d.spxl, d.sqqq];
  const result = [rowFor(entryD)];
  let dailyIdx = entryDailyIdx + Math.max(1, dayOffset);
  while (dailyIdx < daily.length) {
    const d = daily[dailyIdx];
    if (exitDate && d.date > exitDate) break;
    result.push(rowFor(d));
    dailyIdx += periodDays;
  }
  return result;
}

// Day-precision entry/exit override qData (calendar picker). Unlike
// buildEnvelopeQData above (which walks in fixed periodDays increments, built
// for the rebalance-point-% sensitivity feature), this keeps every
// IN-BETWEEN rebalance pinned to its real period-end date — only the two
// boundary rows shift off the period grid, to the exact day picked. Row
// shape matches buildEnvelopeQData / quarterlyData: [date, tqqq, qqq, spy,
// qld, sso, spxl].
function buildExactRangeQData(period, entryDate, exitDate) {
  if (!daily || !dailyDateToIdx) return [];
  const eIdx = dailyDateToIdx.get(entryDate);
  const xIdx = dailyDateToIdx.get(exitDate);
  if (eIdx == null || xIdx == null || eIdx >= xIdx) return [];
  const src = (periodDataByName && periodDataByName[period]) || quarterlyData;
  const rowFor = (d) => [d.date, d.tqqq, d.qqq, d.spy, d.qld, d.sso, d.spxl, d.sqqq];
  const result = [rowFor(daily[eIdx])];
  for (const p of src) { if (p[0] > entryDate && p[0] < exitDate) result.push(p); }
  result.push(rowFor(daily[xIdx]));
  return result;
}

// === Simple Moving Average precomputation ===
// Used by the SMA timing strategy: at each rebalance check, compare the
// signal asset's close to its N-day SMA on the same day. If above → hold
// TQQQ; if below → move to cash (cash bucket accrues the configured rate).
//
// We precompute the full daily SMA series for every (asset, window) pair
// the UI exposes, then sample at each monthly-data entry so the strategy
// loop is an O(months) walk with no per-step recomputation. The heatmap
// runs many simulations so this matters.
// Every moving-average window offered in the SMA dropdown (10…300 by 10). Each
// window's SMA series is precomputed per asset below, so this MUST stay in sync
// with the #select-sma-window options in index.html — a window that's offered
// but not precomputed here silently backtests to $0.
const SMA_WINDOWS = Array.from({ length: 30 }, (_, i) => (i + 1) * 10);
const SMA_ASSETS  = ['qqq', 'spy'];
// RSI periods the UI exposes: every day from 2 (very twitchy) to 30 (very
// smooth). Precomputed for each so the preview bars can sweep the whole range.
const RSI_WINDOWS = Array.from({ length: 29 }, (_, i) => i + 2); // 2,3,…,30
// Monthly-resolution signals (default rebalance grain) and daily-resolution
// signals (used when the SMA strategy checks daily). Keyed 'asset_window'.
let smaAtMonthlyByKey = null;   // { 'qqq_200': [sma per monthlyData entry, or null] }
let smaAtDailyByKey   = null;   // { 'qqq_200': [sma per daily entry, or null] }
let rsiAtMonthlyByKey = null;   // { 'qqq_10':  [rsi per monthlyData entry, or null] }
let rsiAtDailyByKey   = null;   // { 'qqq_10':  [rsi per daily entry, or null] }
// `daily` in the same row shape as monthlyData ([date, tqqq, qqq, spy, qld,
// sso, spxl]) so the SMA loop can step over days when checking daily.
let dailyRows = null;

function rollingSMA(values, window) {
  const out = new Array(values.length);
  let sum = 0;
  let count = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v > 0) { sum += v; count++; }
    if (i >= window) {
      const drop = values[i - window];
      if (drop > 0) { sum -= drop; count--; }
    }
    out[i] = count === window ? sum / window : null;
  }
  return out;
}

// Wilder-smoothed RSI. Returns array of RSI values per daily index, null
// until enough history accumulates. Default window 10 trading days — matches
// the "TFTLT" Reddit strategy's overheat threshold convention.
function rollingRSI(values, window) {
  const out = new Array(values.length).fill(null);
  if (values.length < window + 1) return out;
  let gainSum = 0, lossSum = 0;
  for (let i = 1; i <= window; i++) {
    const d = values[i] - values[i-1];
    if (d > 0) gainSum += d; else lossSum -= d;
  }
  let avgGain = gainSum / window;
  let avgLoss = lossSum / window;
  out[window] = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));
  for (let i = window + 1; i < values.length; i++) {
    const d = values[i] - values[i-1];
    const g = d > 0 ? d : 0;
    const l = d < 0 ? -d : 0;
    // Wilder's smoothing: prior average × (window-1) + new value, all over window.
    avgGain = (avgGain * (window - 1) + g) / window;
    avgLoss = (avgLoss * (window - 1) + l) / window;
    out[i] = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));
  }
  return out;
}

// Build a pair of LAZY, memoizing lookup objects (daily + monthly) for one
// indicator. Nothing is computed up front — the first time a caller reads an
// `asset_window` key (e.g. smaAtDailyByKey['qqq_200']), that asset's series is
// computed once via computeFn(dailyValues, window), cached, and returned; the
// monthly variant additionally samples it onto month-end positions. This means
// offering 30 SMA windows × 2 assets costs nothing until a window is actually
// used, and opening a preview that sweeps every window pays only for the ones
// it reads. Call sites are unchanged: they still index these like plain maps.
function makeLazyIndicator(seriesByAsset, toMonthly, computeFn) {
  const dailyBase = {};   // key -> computed daily series (shared by both proxies)
  const computeDaily = (key) => {
    if (key in dailyBase) return dailyBase[key];
    const us = String(key).lastIndexOf('_');
    if (us <= 0) return (dailyBase[key] = undefined);
    const asset = key.slice(0, us);
    const w = +key.slice(us + 1);
    if (!(w > 0) || !seriesByAsset[asset]) return (dailyBase[key] = undefined);
    return (dailyBase[key] = computeFn(seriesByAsset[asset], w));
  };
  const lazyGet = (cache, key, monthly) => {
    if (typeof key !== 'string' || key.indexOf('_') < 0) return cache[key];
    if (key in cache) return cache[key];
    const d = computeDaily(key);
    return (cache[key] = d === undefined ? undefined : (monthly ? toMonthly(d) : d));
  };
  return {
    daily:   new Proxy({}, { get: (t, k) => lazyGet(t, k, false) }),
    monthly: new Proxy({}, { get: (t, k) => lazyGet(t, k, true)  }),
  };
}

function precomputeSMASeries() {
  smaAtMonthlyByKey = null; smaAtDailyByKey = null;
  rsiAtMonthlyByKey = null; rsiAtDailyByKey = null;
  dailyRows = null;
  if (!daily || !monthlyData || !dailyDateToIdx) return;
  // Sample a full daily series onto monthlyData positions.
  const toMonthly = (dailyArr) => monthlyData.map(([date]) => {
    const idx = dailyDateToIdx.get(date);
    return idx != null ? dailyArr[idx] : null;
  });
  // All six tradeable series get a lazy SMA/RSI source, so the SMA signal (QQQ/
  // SPY) AND the bubble-insurance gauge (any ticker the user picks) can be
  // measured against their own moving average. Nothing is computed until read.
  const seriesByAsset = {
    qqq:  daily.map(d => d.qqq),  spy:  daily.map(d => d.spy),
    tqqq: daily.map(d => d.tqqq), qld:  daily.map(d => d.qld),
    sso:  daily.map(d => d.sso),  spxl: daily.map(d => d.spxl),
    sqqq: daily.map(d => d.sqqq),
  };

  const sma = makeLazyIndicator(seriesByAsset, toMonthly, rollingSMA);
  smaAtDailyByKey = sma.daily; smaAtMonthlyByKey = sma.monthly;
  const rsi = makeLazyIndicator(seriesByAsset, toMonthly, rollingRSI);
  rsiAtDailyByKey = rsi.daily; rsiAtMonthlyByKey = rsi.monthly;

  dailyRows = daily.map(d => [d.date, d.tqqq, d.qqq, d.spy, d.qld, d.sso, d.spxl, d.sqqq]);
}
