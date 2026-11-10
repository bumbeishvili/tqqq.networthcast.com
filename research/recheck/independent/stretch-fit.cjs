'use strict';
// An implementation of library strategies #50 ("TQQQ vs QQQ + Turnaround Monday") and #53
// ("SOXL, TQQQ, QQQ - 1983 fit") written from their rules text: the cards in js/strategy-library.js
// and each setting's sentence in js/strategy-library-code.js. One engine, parameterised by the
// settings. Every point the text leaves open is a named entry in CHOICES: the value here is the
// plain reading of the text, and each can be flipped to see which reading the library's run follows.

const CHOICES = {
  // --- the signal ---
  startMean: 'arithmetic',        // "their average price": the plain average of the closes ('geometric': the average of their logs)
  medianIncludesToday: true,      // the N-day median covers today's close and the N-1 before it
  // --- the stretch rules ---
  ceilingFirstDay: 'signal',      // day 1 of "SQQQ for up to N days" is the close that reaches the ceiling ('next': the close after)
  floorOnAgain: 'firstClose',     // after a deep buy the floor is back on at the first close at the re-entry lead ('inARow': after the closes in a row)
  sameCloseChain: true,           // a close that ends one state can start the next (back from the ceiling and under the floor at once)
  overRule: 'always',             // the overextended line holds SQQQ whatever the stretch rules hold ('insteadOfTqqq': only in place of TQQQ)
  // --- the defences ---
  capFirstDay: 'want',            // day 1 of "at most N days in a row" is the first close the rules want SQQQ ('next': the close after)
  deepPrice: 'signalClose',       // the deep buy's price is TQQQ's close on the day the deep-buy lead is reached ('buyClose': the close it is bought at)
  guardRearms: 'newPrice',        // a deep buy bought back above the median is guarded again, from its new price ('oldPrice': from the first price; 'off': not again)
  guardInclusive: true,           // "falls 25%": a close at or under price x 0.75 sells
  guardEndsAtFloorOn: true,       // a guarded-out deep buy is bought back once the lead is at the re-entry level, median or not
  // --- Turnaround Monday ---
  mondayStarts: 'everySignal',    // any Monday close under the prior low while the rules want cash buys ('ruleFlat': only
                                  // when the Monday rule, followed on its own, is not already in a trade the account missed)
  mondayRuleFrom: 'history',      // with 'ruleFlat': the Monday rule is followed from the start of the history ('entry': from the entry)
  mondayNeedsCashOrTqqq: true,    // a Monday trade starts only on money in cash or in TQQQ at that close (false: SOXL money too)
  mondayBuys: 'tqqq',             // a Monday trade buys TQQQ whatever the SOXL rule says ('soxlRule': SOXL while that rule is in)
  vetoBlocksMonday: false,        // the credit veto leaves cash the Monday rule trades (true: no Monday trade under a veto)
  // --- SOXL instead of TQQQ ---
  soxlStateAlwaysRuns: true,      // the SOXL lead's in/out state moves at every close (false: only at closes where the rules hold TQQQ)
  // --- the entry ---
  warmFrom: 'history',            // the rules run from the first close with a lead (a number: that many closes before the entry)
  entryAccount: 'longRunning',    // the entry holds what a long-running account holds after that close's trade ('blank': the account
                                  // holds nothing before the entry and buys what the rules want at that close)
};

const WEEKDAY_MONDAY = 1;
const weekdayOf = (date) => new Date(date + 'T00:00:00Z').getUTCDay();
const hasNumber = (x) => typeof x === 'number' && Number.isFinite(x);

// One result per distinct argument list, per data object.
const caches = new WeakMap();
function cached(data, key, build) {
  if (!caches.has(data)) caches.set(data, new Map());
  const store = caches.get(data);
  if (!store.has(key)) store.set(key, build());
  return store.get(key);
}

// The average close over a block of days, plain or geometric.
function blockMean(values, from, to, kind) {
  const block = Array.from(values.slice(from, to + 1));
  const sum = block.reduce((total, v) => total + (kind === 'geometric' ? Math.log(v) : v), 0);
  return kind === 'geometric' ? Math.exp(sum / block.length) : sum / block.length;
}

function medianOf(values) {
  const sorted = Float64Array.from(values).sort();
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// The first index holding a real quote: the data carries the first quote back over the days before it.
function firstRealIdx(values) {
  const firstMove = values.findIndex((v, i) => i > 0 && v !== values[i - 1]);
  return firstMove - 1;
}

// TQQQ's lead over QQQ at every close, in percent: each fund's growth from its start price (the
// average close from lookback+avg to lookback-avg days ago), TQQQ's divided by QQQ's, minus one.
const stretchLeads = (data, lookback, avg, meanKind) => cached(data, `lead:${lookback}:${avg}:${meanKind}`, () =>
  data.dates.map((_, i) => {
    const from = i - lookback - avg, to = i - lookback + avg;
    if (from < 0) return null;
    const growthT = data.tqqq[i] / blockMean(data.tqqq, from, to, meanKind), growthQ = data.qqq[i] / blockMean(data.qqq, from, to, meanKind);
    return { lead: (growthT / growthQ - 1) * 100, growthT: (growthT - 1) * 100, growthQ: (growthQ - 1) * 100 };
  }));

// TQQQ's median close over the window at every close.
const medians = (data, window, includesToday) => cached(data, `median:${window}:${includesToday}`, () =>
  data.dates.map((_, i) => {
    const end = includesToday ? i : i - 1, start = end - window + 1;
    return start < 0 ? null : medianOf(data.tqqq.slice(start, end + 1));
  }));

// SOXL's lead over SOXX at every close, in percent: growth over `days` trading days from the one
// close that far back, SOXL's divided by SOXX's, minus one. Null until both ends are real quotes.
const soxlLeads = (data, days) => cached(data, `soxl:${days}`, () => {
  const firstReal = Math.max(firstRealIdx(data.soxl), firstRealIdx(data.soxx));
  return data.dates.map((_, i) => {
    const back = i - days;
    return back < firstReal ? null : ((data.soxl[i] / data.soxl[back]) / (data.soxx[i] / data.soxx[back]) - 1) * 100;
  });
});

// Runs the rules from the warm-up start to exitIdx and the money from entryIdx.
// Returns one row per close from entryIdx on.
function simulate(data, settings, entryIdx, exitIdx, choiceOverrides = {}) {
  const s = settings, c = { ...CHOICES, ...choiceOverrides };
  const { dates, tqqq, nfci, tqqqHigh, tqqqLow } = data;
  const priceOf = { tqqq: data.tqqq, sqqq: data.sqqq, soxl: data.soxl };

  const leads = stretchLeads(data, s.lookbackDays, s.startAvgDays, c.startMean);
  const median = medians(data, s.overWindow, c.medianIncludesToday);
  const soxlRule = s.soxlWhen === 'lead';
  const soxlLead = soxlRule ? soxlLeads(data, s.soxlLeadDays) : null;

  const firstLeadIdx = leads.findIndex(l => l !== null);
  const warmIdx = c.warmFrom === 'history' ? firstLeadIdx : Math.max(firstLeadIdx, entryIdx - c.warmFrom);
  const cost = s.tradeCost / 100, cashFactor = Math.pow(1 + s.cashRate / 100, 1 / 252);

  // Turnaround Monday's two signals at every close, and the rule followed on its own: in a trade
  // from a Monday close under the prior day's low until the first close over the prior day's high.
  const levelBefore = (levels, i) => (hasNumber(levels[i - 1]) ? levels[i - 1] : tqqq[i - 1]);   // the prior close where there is no high or low
  const mondaySignalAt = (i) => i > 0 && weekdayOf(dates[i]) === WEEKDAY_MONDAY && tqqq[i] < levelBefore(tqqqLow, i);
  const mondayExitAt = (i) => i > 0 && tqqq[i] > levelBefore(tqqqHigh, i);
  const ruleFrom = c.mondayRuleFrom === 'entry' ? entryIdx : 1;
  const ruleIn = new Uint8Array(dates.length);
  for (let i = ruleFrom, inTrade = false; i <= exitIdx; i++) {
    if (inTrade) { if (mondayExitAt(i)) inTrade = false; } else if (mondaySignalAt(i)) inTrade = true;
    ruleIn[i] = inTrade ? 1 : 0;
  }
  const ruleOpenedAt = (i) => ruleIn[i] === 1 && (i === ruleFrom || ruleIn[i - 1] === 0);

  // The SOXL lead's in/out step at one close: in from a close under the entry level, out at one over the exit level.
  const soxlStep = (inside, i) => {
    const lead = soxlLead[i];
    if (lead === null) return inside;
    if (!inside && lead < s.soxlLeadEnter) return true;
    if (inside && lead > s.soxlLeadExit) return false;
    return inside;
  };
  let soxlInside = false;
  if (soxlRule && c.soxlStateAlwaysRuns) for (let i = 0; i < warmIdx; i++) soxlInside = soxlStep(soxlInside, i);

  // The stretch rules' memory.
  let mode = 'normal';           // normal | aside (ceiling) | broken (floor) | deep (deep buy, floor off)
  let asideDays = 0;             // closes since the ceiling was reached, that close counted
  let reentryRun = 0;            // closes in a row at the re-entry lead
  let deepBuyPrice = null;       // the deep buy's price, for the guard
  let deepPricePending = false;  // deepPrice 'buyClose': waiting for the close the deep buy is bought at
  let guardOut = false;          // the guard sold the deep buy
  let guardArmed = false;        // the guard watches the deep buy
  let sqqqRun = 0;               // closes in a row the rules have wanted SQQQ
  let mondayOpen = false;        // the account is in a Turnaround Monday trade
  let held = 'cash';
  // The money.
  let cash = 0, shares = 0;

  const rows = [];
  for (let i = warmIdx; i <= exitIdx; i++) {
    const lead = leads[i].lead, close = tqqq[i], med = median[i];
    if (i === entryIdx && c.entryAccount === 'blank') { held = 'cash'; mondayOpen = false; }

    // --- The stretch rules on today's lead ---
    let moved = false;
    if (mode === 'aside') {
      asideDays += 1;
      const back = s.backLead >= s.topLead ? lead < s.topLead : lead <= s.backLead;
      if (back) { mode = 'normal'; moved = true; }
    } else if (mode === 'broken') {
      if (lead <= s.deepLead) {
        mode = 'deep'; guardOut = false; guardArmed = true; moved = true;
        deepBuyPrice = close; deepPricePending = c.deepPrice === 'buyClose';
      } else {
        reentryRun = lead >= s.reentryLead ? reentryRun + 1 : 0;
        if (reentryRun >= s.reentryCloses) { mode = 'normal'; moved = true; }
      }
    } else if (mode === 'deep') {
      reentryRun = lead >= s.reentryLead ? reentryRun + 1 : 0;
      const floorOn = c.floorOnAgain === 'firstClose' ? lead >= s.reentryLead : reentryRun >= s.reentryCloses;
      if (floorOn && (c.guardEndsAtFloorOn || !guardOut)) { mode = 'normal'; guardOut = false; moved = true; }
      else if (s.deepGuard > 0 && !deepPricePending) {
        const line = deepBuyPrice * (1 - s.deepGuard / 100);
        if (!guardOut && guardArmed && (c.guardInclusive ? close <= line : close < line)) guardOut = true;
        else if (guardOut && med !== null && close > med) {
          guardOut = false;
          if (c.guardRearms === 'newPrice') deepBuyPrice = close;
          if (c.guardRearms === 'off') guardArmed = false;
        }
      }
    }
    if (mode === 'normal' && (c.sameCloseChain || !moved)) {
      if (lead >= s.topLead) { mode = 'aside'; asideDays = 1; }
      else if (lead < s.floorLead) { mode = 'broken'; reentryRun = 0; }
    }

    // --- What the stretch rules want at this close ---
    let want;
    if (mode === 'aside') {
      const lastSqqqDay = c.ceilingFirstDay === 'signal' ? s.topDays : s.topDays + 1;
      want = s.topHold === 'sqqq' && s.topDays > 0 && asideDays > lastSqqqDay ? 'cash' : s.topHold;
    } else if (mode === 'broken') want = s.floorHold;
    else if (mode === 'deep') want = guardOut ? 'cash' : 'tqqq';
    else want = 'tqqq';
    // Overextended: SQQQ while TQQQ closes more than overPct above its median.
    const over = s.overPct > 0 && med !== null && close > med * (1 + s.overPct / 100);
    if (over && (c.overRule === 'always' || want === 'tqqq')) want = 'sqqq';

    // Crash defence: SQQQ at most N days in a row, then cash.
    sqqqRun = want === 'sqqq' ? sqqqRun + 1 : 0;
    const lastCapDay = c.capFirstDay === 'want' ? s.sqqqMaxDays : s.sqqqMaxDays + 1;
    const capped = want === 'sqqq' && s.sqqqMaxDays > 0 && sqqqRun > lastCapDay;
    if (capped) want = 'cash';
    // Crash defence: cash instead of TQQQ while credit stress is above the veto level.
    const vetoed = want === 'tqqq' && s.nfciVeto > 0 && hasNumber(nfci[i]) && nfci[i] > s.nfciVeto;
    if (vetoed) want = 'cash';

    // --- SOXL instead of TQQQ: the lead's in/out state ---
    if (soxlRule && (c.soxlStateAlwaysRuns || want === 'tqqq')) soxlInside = soxlStep(soxlInside, i);

    // --- Turnaround Monday in the rules' cash ---
    const mondaySignal = mondaySignalAt(i), mondayExit = mondayExitAt(i);
    const mondayStart = c.mondayStarts === 'everySignal' ? mondaySignal : ruleOpenedAt(i);
    const mondayEnd = c.mondayStarts === 'everySignal' ? mondayExit : ruleIn[i] === 0;
    const moneyFree = c.mondayNeedsCashOrTqqq ? (held === 'cash' || held === 'tqqq') : held !== 'sqqq';
    if (mondayOpen && (want !== 'cash' || mondayEnd)) mondayOpen = false;
    else if (!mondayOpen && want === 'cash' && mondayStart && moneyFree && !(vetoed && c.vetoBlocksMonday)) mondayOpen = true;

    // --- What the account should hold ---
    let target = want;
    if (want === 'tqqq' && soxlRule && soxlInside) target = 'soxl';
    if (want === 'cash' && mondayOpen) target = c.mondayBuys === 'soxlRule' && soxlRule && soxlInside ? 'soxl' : 'tqqq';

    // --- One trade per close: a fund is sold today, the next one bought at the next close ---
    const heldBefore = held;
    let action = 'hold';
    if (held !== target) {
      if (held !== 'cash') { held = 'cash'; action = 'sell'; if (!s.splitDays && target !== 'cash') { held = target; action = 'switch'; } }
      else { held = target; action = 'buy'; }
    }
    if (deepPricePending && held === 'tqqq') { deepBuyPrice = close; deepPricePending = false; }

    // --- The money, from the entry on ---
    if (i < entryIdx) continue;
    if (i === entryIdx) {
      cash = s.initial;
      if (held !== 'cash') { shares = cash * (1 - cost) / priceOf[held][i]; cash = 0; }
      action = 'start';
    } else {
      cash *= cashFactor;
      if (action === 'sell' || action === 'switch') { cash += shares * priceOf[heldBefore][i] * (1 - cost); shares = 0; }
      if (action === 'buy' || action === 'switch') { shares = cash * (1 - cost) / priceOf[held][i]; cash = 0; }
    }
    const value = cash + (held === 'cash' ? 0 : shares * priceOf[held][i]);
    rows.push({
      date: dates[i], held: held.toUpperCase(), value, shares, cash, action, target, want, mode,
      lead, growthT: leads[i].growthT, growthQ: leads[i].growthQ,
      median: med, overPct: med === null ? null : (close / med - 1) * 100, over,
      sqqqRun, asideDays, reentryRun, capped, vetoed, guardOut, deepBuyPrice,
      mondayOpen, mondaySignal, mondayExit, soxlLead: soxlLead ? soxlLead[i] : null, soxlInside,
    });
  }
  return rows;
}

module.exports = { simulate, CHOICES, stretchLeads, medians, soxlLeads, firstRealIdx };
