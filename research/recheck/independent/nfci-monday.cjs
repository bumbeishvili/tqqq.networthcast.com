'use strict';
// Independent implementation of library strategy #48 "NFCI veto + Turnaround Monday".
// Written from the card's rules text (js/strategy-library.js, n: 44 plus the Turnaround Monday
// paragraph) and the settings sentences of CODE[44], before reading the code's run().
//
// Every place where the text left a choice open is a named switch. TEXT is the reading taken
// from the words alone (fixed before the first comparison). LIBRARY is the same implementation
// with the switches set the way the library run turned out to behave; those switches were found
// by comparing day by day and then confirmed in the code.

const TEXT = {
  medianIncludesToday: true,     // "the last 250 days": today's close is one of the 250
  slopeDays: 63,                 // "over the last 3 months": 63 trading days
  slopeAnnualise: 'simple',      // "%/yr": the 3-month change times 4 ('compound' = ratio^4 - 1)
  belowCountsToday: true,        // "10+ straight days closing below it": today's close counts
  sqqqUntil: 'overLine',         // SQQQ goes back to TQQQ at the first close not 55% above the median any more
                                 // ('median' = the setting sentence taken literally: "until it closes back under the line")
  exitLineMoves: true,           // "recovers above the exit line": the line of the day (false = level frozen at the sale)
  gatesAtSaleOnly: true,         // the slope and days-below gates decide the sale; once sold only the exit line buys back
  vetoNeedsExitWhileOn: true,    // "crash exit and re-entry while it was on": the exit too happens while the veto is on
  mondayIsCalendarMonday: true,  // "on a Monday": the calendar day (false = the week's first session)
  mondayEveryDownMonday: true,   // every down Monday with the rules in cash starts a trade (false = only a Monday that
                                 // opens a trade of the rule run on TQQQ alone, i.e. no down Monday still "open" before it)
  carryState: true,              // sold-out, veto, days-below and Monday memory replayed from the start of the data
  entryDayInterest: false,       // the lump sum earns no cash interest on the entry day itself
};
const LIBRARY = { ...TEXT, slopeAnnualise: 'compound', vetoNeedsExitWhileOn: false, mondayEveryDownMonday: false, carryState: false, entryDayInterest: true };

const SETTINGS = { window: 250, overPct: 55, exitPct: -28, slopeGate: 20, belowGate: 10, nfciTh: 0.4, cashRate: 4, tradeCost: 0.02, initial: 100000 };

const weekdayOf = (date) => new Date(date + 'T00:00:00Z').getUTCDay();

function rollingMedian(values, window, includeToday) {
  return values.map((_, i) => {
    const end = includeToday ? i : i - 1, start = end - window + 1;
    if (start < 0) return NaN;
    const sorted = Float64Array.from(values.slice(start, end + 1)).sort();
    return window % 2 ? sorted[(window - 1) / 2] : (sorted[window / 2 - 1] + sorted[window / 2]) / 2;
  });
}

// The memoryless signals: the median, the two lines hung from it and the median's yearly slope.
const signalCache = new WeakMap();
function signalsOf(data, s, r) {
  const key = [s.window, s.overPct, s.exitPct, r.medianIncludesToday, r.slopeDays, r.slopeAnnualise].join('|');
  const perData = signalCache.get(data.tqqq) || new Map();
  signalCache.set(data.tqqq, perData);
  if (perData.has(key)) return perData.get(key);
  const close = data.tqqq;
  const median = rollingMedian(close, s.window, r.medianIncludesToday);
  const overLine = median.map(m => m * (1 + s.overPct / 100));
  const exitLine = median.map(m => m * (1 + s.exitPct / 100));
  const slope = median.map((m, i) => {
    const past = median[i - r.slopeDays];
    if (!(past > 0) || !(m > 0)) return NaN;
    const ratio = m / past, perYear = 252 / r.slopeDays;
    return (r.slopeAnnualise === 'compound' ? Math.pow(ratio, perYear) - 1 : (ratio - 1) * perYear) * 100;
  });
  const signals = { close, median, overLine, exitLine, slope };
  perData.set(key, signals);
  return signals;
}

const blankMemory = () => ({
  soldOut: false, exitLevel: NaN, belowRun: 0, parked: false,   // price rules
  vetoOn: false, vetoArmed: true, vetoSawExit: false,     // credit rule
  aloneOpen: false,                                       // the Monday rule run on TQQQ alone
  mondayOpen: false,                                      // a Monday trade this strategy is in
});

// One close of the rules' memory. Mutates `m`; returns what the rules want and the Monday rule's verdicts.
function stepRules(m, i, data, sig, s, r) {
  const close = sig.close[i], median = sig.median[i];
  const haveLine = median === median;
  const vetoWasOn = m.vetoOn;
  let crashExitToday = false, reentryToday = false;

  // --- price rules ---
  const runBefore = m.belowRun;
  m.belowRun = haveLine && close < median ? m.belowRun + 1 : 0;
  if (haveLine) {
    const run = r.belowCountsToday ? m.belowRun : runBefore;
    const gatesOpen = sig.slope[i] < s.slopeGate && run >= s.belowGate;
    if (!m.soldOut) {
      if (close < sig.exitLine[i] && gatesOpen) { m.soldOut = true; m.exitLevel = sig.exitLine[i]; crashExitToday = true; }
    } else {
      const level = r.exitLineMoves ? sig.exitLine[i] : m.exitLevel;
      const stillOut = r.gatesAtSaleOnly ? !(close > level) : (close < level && gatesOpen);
      if (!stillOut) { m.soldOut = false; reentryToday = true; }
    }
  }
  if (haveLine && close > sig.overLine[i]) m.parked = true;
  else if (!haveLine || r.sqqqUntil === 'overLine' || close < median) m.parked = false;
  const priceWant = m.soldOut ? 'cash' : m.parked ? 'sqqq' : 'tqqq';

  // --- credit rule: fires on a cross above the line, lifts when the NFCI calms or after the price
  //     rules' own crash exit and re-entry; a lifted veto needs a fresh cross to fire again ---
  const nfci = data.nfci[i];
  const above = nfci === nfci && nfci != null && nfci > s.nfciTh;
  let vetoFired = false, vetoLifted = null;
  if (!above) {
    if (m.vetoOn) vetoLifted = 'calm';
    m.vetoOn = false; m.vetoArmed = true; m.vetoSawExit = false;
  } else if (!m.vetoOn && m.vetoArmed) {
    m.vetoOn = true; m.vetoArmed = false; m.vetoSawExit = false; vetoFired = true;
  }
  if (m.vetoOn) {
    if (crashExitToday) m.vetoSawExit = true;
    const cycleDone = reentryToday && vetoWasOn && (m.vetoSawExit || !r.vetoNeedsExitWhileOn);
    if (cycleDone) { m.vetoOn = false; m.vetoSawExit = false; vetoLifted = 'cycle'; }
  }
  const want = m.vetoOn ? 'cash' : priceWant;

  // --- Turnaround Monday's own verdicts on TQQQ's closes ---
  const prev = i > 0 ? sig.close[i - 1] : NaN;
  const down = close < prev, up = close > prev;
  const monday = r.mondayIsCalendarMonday ? weekdayOf(data.dates[i]) === 1 : (i > 0 && weekdayOf(data.dates[i]) < weekdayOf(data.dates[i - 1]));
  let aloneEntry = false;
  if (m.aloneOpen && up) m.aloneOpen = false;
  else if (!m.aloneOpen && monday && down) { m.aloneOpen = true; aloneEntry = true; }
  const mondayEntry = r.mondayEveryDownMonday ? monday && down : aloneEntry;
  return { priceWant, want, vetoFired, vetoLifted, crashExitToday, reentryToday, down, up, monday, mondayEntry };
}

// Runs the strategy from fromIdx to toIdx (inclusive): $100,000 at the entry close, one row per trading day.
function run(data, fromIdx, toIdx, reading = TEXT, settings = {}) {
  const r = { ...TEXT, ...reading }, s = { ...SETTINGS, ...settings };
  const sig = signalsOf(data, s, r);
  const dayGrowth = Math.pow(1 + s.cashRate / 100, 1 / 252), cost = s.tradeCost / 100;
  const m = blankMemory();

  // Memory before the entry: the rules replayed with no money. In the replay a Monday trade counts as open
  // when the rules wanted cash at a qualifying Monday close and nothing has ended it since.
  if (r.carryState) {
    for (let i = 0; i < fromIdx; i++) {
      const v = stepRules(m, i, data, sig, s, r);
      if (m.mondayOpen && (v.want !== 'cash' || v.up)) m.mondayOpen = false;
      else if (!m.mondayOpen && v.want === 'cash' && v.mondayEntry) m.mondayOpen = true;
    }
  }

  let held = 'cash', shares = 0, cash = s.initial;
  const rows = [];
  for (let i = fromIdx; i <= toIdx; i++) {
    if (i > fromIdx || r.entryDayInterest) cash *= dayGrowth;
    const v = stepRules(m, i, data, sig, s, r);
    let mondayNote = '';

    // Turnaround Monday: ends when the rules want something else or at the first up close; starts at a
    // qualifying Monday close while the rules want cash, on money in cash or on TQQQ the rules are selling.
    if (m.mondayOpen && v.want !== 'cash') { m.mondayOpen = false; mondayNote = 'monday trade ended: rules want ' + v.want; }
    else if (m.mondayOpen && v.up) { m.mondayOpen = false; mondayNote = 'monday trade ended: up close'; }
    else if (!m.mondayOpen && v.want === 'cash' && v.mondayEntry) {
      if (held === 'cash') { m.mondayOpen = true; mondayNote = 'monday trade: buy'; }
      else if (held === 'tqqq') { m.mondayOpen = true; mondayNote = 'monday trade: keep'; }
      else mondayNote = 'monday signal sat out (money in SQQQ)';
    }
    const target = m.mondayOpen ? 'tqqq' : v.want;

    // One trade per day: a fund is sold today; cash buys today.
    let action = 'hold', fee = 0;
    if (target !== held) {
      if (held === 'cash') {
        fee = cash * cost; shares = (cash - fee) / data[target][i]; cash = 0; held = target; action = 'buy';
      } else {
        const gross = shares * data[held][i]; fee = gross * cost; cash = gross - fee; shares = 0; held = 'cash'; action = 'sell';
      }
    }
    const value = held === 'cash' ? cash : shares * data[held][i];
    rows.push({ date: data.dates[i], value, held: held.toUpperCase(), shares, cash, action, fee, target, want: v.want, priceWant: v.priceWant,
      soldOut: m.soldOut, vetoOn: m.vetoOn, vetoArmed: m.vetoArmed, vetoFired: v.vetoFired, vetoLifted: v.vetoLifted,
      crashExitToday: v.crashExitToday, reentryToday: v.reentryToday, mondayOpen: m.mondayOpen, mondayNote,
      close: sig.close[i], median: sig.median[i], overLine: sig.overLine[i], exitLine: sig.exitLine[i], slope: sig.slope[i], belowRun: m.belowRun, nfci: data.nfci[i] });
  }
  return rows;
}

module.exports = { TEXT, LIBRARY, SETTINGS, run, signalsOf, rollingMedian, weekdayOf };
