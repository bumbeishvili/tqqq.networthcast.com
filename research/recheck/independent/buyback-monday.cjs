'use strict';
// Independent implementation of library strategy #49 "Buy-back + Turnaround Monday".
//
// Written from the card's rules text (js/strategy-library.js: entry n: 45 plus the Monday
// paragraph turnaroundMondayRules('SPY', 'close')), the settings' text/tip sentences of CODE[45]
// and the comment block above withTurnaroundMonday. The library's run() was read only after the
// first comparison disagreed (see compare.cjs / report.cjs).
//
// TEXT  = my reading of the rules text at every point it leaves open.
// CODE  = what the library's run() turned out to do at those points.
// Each flag below is one such point, so a discrepancy's effect is measured by flipping one flag.
const L = require('../lib.cjs');

const SETTINGS = {
  window: 250,      // "its 250-day median" / "The line covers the last {} days."
  overPct: 55,      // "When it closes 55% above its 250-day median, switch to SQQQ."
  exitPct: 10,      // "Sell line: 10% above the median."
  confirmDays: 4,   // "Buy back after four closes in a row above it."
  dipReentry: 50,   // "a line half way back from the low toward the median"
  bbPct: -32,       // "Buy-back line: 32% below the median."
  bbSlice: 100,     // "buys TQQQ with all the money"
  sliceStop: 20,    // "sold if the price falls 20% under its buy price"
  sliceCap: 1,      // "it happens once per sold-out stretch"
  cashRate: 4,      // cash earns 4% a year, compounded per trading day
  tradeCost: 0.02,  // each buy and each sell costs 0.02% of the amount traded
  initial: 100000,
};

const TEXT = {
  // "the low" in "a line half way back from the low toward the median":
  //   'price' = the lowest closing price of the sold-out stretch; line = low + f * (today's median - low)
  //   'pct'   = the lowest close-vs-median percentage of the stretch; line = today's median * (1 + thatPct * (1 - f))
  lowBasis: 'price',
  // dipReentry f: "How far the price must climb from its low toward the center line" = share of the way
  // from the low to the median ('fromLow'). 'mirrored' puts the line at f of the low's depth instead
  // (the same line at the default 50%, the opposite end at any other value). Only read with lowBasis 'pct'.
  dipDirection: 'fromLow',
  // The half-way line when the stretch's low is still above the median (possible because the sell line
  // sits 10% above it): 'formula' applies the same formula (a line under the low), 'sellLine' waits for
  // the sell line ("Deeper corrections are bought back sooner").
  dipWhenLowAboveMedian: 'formula',
  // "when the rules want cash and SPY closes down on a Monday, buy TQQQ": false = any down Monday.
  // true = only a down Monday that comes after SPY has closed up since the previous down Monday
  // (the rule run on SPY alone, one trade at a time).
  mondayNeedsFreshSignal: false,
  // "it happens once per sold-out stretch": true = the stretch that follows "a close back under it sells
  // everything" is a sold-out stretch like any other (a slice at its first fresh close at or under the line).
  // false = no slice in a stretch that began with that sale.
  sliceAfterFailedBuyBack: true,
  // "After buying back below the sell line, the buy-back line works as the sell line until a close above
  // the sell line": true = a buy-back whose own close is above the sell line leaves the sell line live.
  // false = after any buy-back the buy-back line is the sell line until a later close at or above the sell line.
  sellLineLiveAfterBuyBackAboveIt: true,
  // A close that is both the sale (under the sell line) and at or under the buy-back line, and the
  // entry day of a run that starts at or under the buy-back line: true = that close buys the slice at once.
  sliceOnSaleDay: false,
};
const CODE = { ...TEXT, lowBasis: 'pct', dipDirection: 'mirrored', mondayNeedsFreshSignal: true, sliceAfterFailedBuyBack: false,
  sellLineLiveAfterBuyBackAboveIt: false, sliceOnSaleDay: true };

const median = (arr) => {
  const s = Array.from(arr).sort((a, b) => a - b), n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
};
const isMonday = (date) => new Date(date + 'T00:00:00Z').getUTCDay() === 1;

// The base rules (card n: 45). step(i) returns what the rules want at day i's close: 'tqqq' | 'sqqq' | 'cash'.
// The run starts blank: on its first day it acts as if TQQQ had been held with the sell line live.
function makeBase(d, S, F) {
  const px = d.tqqq, f = S.dipReentry / 100;
  // 'high': in the market, the sell line sells. 'low': bought back, the buy-back line sells. 'out': sold out.
  let mode = 'high';
  let lowPx = NaN, lowRel = NaN, crash = false, count = 0, sliceHeld = false, slicePx = NaN, slicesUsed = 0, prevUnder = false;
  const linesAt = (i) => {
    const M = median(px.slice(Math.max(0, i + 1 - S.window), i + 1));   // the last 250 closes, today's included
    return { M, over: M * (1 + S.overPct / 100), sell: M * (1 + S.exitPct / 100), bb: M * (1 + S.bbPct / 100) };
  };
  const dipLine = (ln) => {
    if (!(f > 0)) return ln.sell;                                        // "0% waits for the sell line"
    if (F.dipWhenLowAboveMedian === 'sellLine' && !(lowRel < 0)) return ln.sell;
    const line = F.lowBasis === 'price' ? lowPx + f * (ln.M - lowPx) : ln.M * (1 + lowRel * (F.dipDirection === 'mirrored' ? f : 1 - f));
    return Math.min(ln.sell, Math.max(ln.bb, line));                     // "never below the buy-back line" (column tip)
  };
  const sellOut = (c, ln, failed) => {
    mode = 'out'; count = 0; crash = false; sliceHeld = false; slicePx = NaN;
    slicesUsed = failed && !F.sliceAfterFailedBuyBack ? S.sliceCap : 0;
    lowPx = c; lowRel = c / ln.M - 1;
  };
  function step(i) {
    const c = px[i], ln = linesAt(i), under = c <= ln.bb;               // "at or under" the buy-back line
    let event = '', sold = '';
    if (mode === 'low') {
      if (c >= ln.sell) mode = 'high';                                   // "until a close above the sell line"
      else if (c < ln.bb) { sellOut(c, ln, true); sold = 'failed'; event = 'sell: closed back under the buy-back line'; }
    }
    if (mode === 'high' && !sold && !(c > ln.over) && c < ln.sell) { sellOut(c, ln, false); sold = 'sellLine'; event = 'sell: closed under the sell line'; }
    let want, line = NaN;
    if (mode === 'out') {
      if (!sold) {
        if (c < lowPx) lowPx = c;
        if (c / ln.M - 1 < lowRel) lowRel = c / ln.M - 1;
        line = crash ? ln.bb : dipLine(ln);
        count = c > line ? count + 1 : 0;
      }
      if (!sold && count >= S.confirmDays) {                             // "four closes in a row above the line buy back"
        event = 'buy back: ' + S.confirmDays + ' closes above ' + (crash ? 'the buy-back line' : line >= ln.sell * 0.999999 ? 'the sell line' : 'the re-entry line');
        mode = (c >= ln.sell && F.sellLineLiveAfterBuyBackAboveIt) || line >= ln.sell * 0.999999 ? 'high' : 'low';
        sliceHeld = false;
      } else {
        if (under) crash = true;                                         // "A crash is a close -32% from the line."
        const fresh = under && !prevUnder;                               // "A new slice needs a close above the line and another under it"
        if (sliceHeld && c < slicePx * (1 - S.sliceStop / 100)) { sliceHeld = false; event = 'sell: slice stop'; }
        else if (!sliceHeld && fresh && S.bbSlice > 0 && slicesUsed < S.sliceCap && (!sold || (sold === 'sellLine' && F.sliceOnSaleDay))) {
          sliceHeld = true; slicePx = c; slicesUsed++; event = (event ? event + '; ' : '') + 'buy: slice at the buy-back line';
        }
      }
    }
    want = mode === 'out' ? (sliceHeld ? 'tqqq' : 'cash') : mode === 'high' && c > ln.over ? 'sqqq' : 'tqqq';
    prevUnder = under;
    return { want, sig: { c, ...ln, mode, line, count: mode === 'out' ? count : NaN, crash: mode === 'out' && crash, slice: sliceHeld, lowRel: mode === 'out' ? lowRel : NaN, event } };
  }
  return { step };
}

// The whole strategy: the base rules, Turnaround Monday in the base's idle cash, and the shared execution
// conventions (trade at the deciding close; fund-to-fund takes two closes; 0.02% per buy and per sell; cash at 4%).
function simulate(startIdx, endIdx, flags = TEXT, settings = {}, d = L.data) {
  const F = { ...TEXT, ...flags }, S = { ...SETTINGS, ...settings };
  const cost = S.tradeCost / 100, dayRate = Math.pow(1 + S.cashRate / 100, 1 / 252);
  const base = makeBase(d, S, F);
  let held = 'cash', shares = 0, cash = S.initial;
  let tm = false;          // a Monday trade is open in this account
  let spyTrade = false;    // SPY alone: between a down Monday close and the first up close after it
  const rows = [];
  for (let i = startIdx; i <= endIdx; i++) {
    if (held === 'cash') cash *= dayRate;
    const { want: baseWant, sig } = base.step(i);
    const spyDown = d.spy[i] < d.spy[i - 1], spyUp = d.spy[i] > d.spy[i - 1], monday = isMonday(d.dates[i]);
    if (spyTrade && spyUp) spyTrade = false;
    const fresh = !spyTrade && monday && spyDown;
    if (monday && spyDown) spyTrade = true;
    let tmEvent = '';
    if (baseWant !== 'cash') { if (tm) tmEvent = 'Monday trade ends: the rules want ' + baseWant; tm = false; }   // "or until the rules want something else"
    else if (tm && spyUp) { tm = false; tmEvent = 'Monday trade ends: SPY closed up'; }                            // "until SPY first closes up"
    else if (!tm && (F.mondayNeedsFreshSignal ? fresh : monday && spyDown) && held !== 'sqqq') {                    // "Money still in SQQQ that Monday sits it out"
      tm = true; tmEvent = held === 'tqqq' ? 'Monday trade: keeps TQQQ' : 'Monday trade: buys TQQQ';
    }
    const want = baseWant === 'cash' && tm ? 'tqqq' : baseWant;
    let action = 'hold', fee = 0;
    if (held !== want) {
      if (held !== 'cash') {            // sell today; a fund-to-fund switch buys at the next close what the rules then want
        const gross = shares * d[held][i]; fee = gross * cost; cash += gross - fee; action = 'sell ' + held; shares = 0; held = 'cash';
      } else {                          // from cash: buy today
        fee = cash * cost; shares = (cash - fee) / d[want][i]; cash = 0; held = want; action = 'buy ' + want;
      }
    }
    const value = cash + (held === 'cash' ? 0 : shares * d[held][i]);
    rows.push({ i, date: d.dates[i], held: held.toUpperCase(), shares, cash, value, action, fee, baseWant, tm, tmEvent, ...sig });
  }
  return rows;
}

module.exports = { simulate, makeBase, TEXT, CODE, SETTINGS, median, isMonday };
