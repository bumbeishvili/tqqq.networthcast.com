'use strict';
// Bookkeeping audit: every day's account value must follow from yesterday's holdings, today's closes,
// cash interest and the fee on today's trade. Run on the strategies' own daily logs, checked independently.
const L = require('./lib.cjs');
const { CODE, data, NAMES, idxOf, idxBefore, runLog } = L;
for (const n of [48, 49, 50, 53, 52]) {
  for (const [from, to] of [['2009-12-31', L.LAST], ['1994-12-30', '2009-12-31']]) {
    const log = runLog(CODE[n], {}, from, to), s = idxOf(from);
    const p = { ...L.defaultsOf(CODE[n]) }, dayRate = Math.pow(1 + p.cashRate / 100, 1 / 252) - 1, cost = p.tradeCost / 100;
    let worst = 0, worstAt = '', feeSum = 0, feeBad = 0, feeBadAt = '', rows = 0, interestDays = 0;
    for (let k = 1; k < log.length; k++) {
      const a = log[k - 1], b = log[k], i = s + k;
      if (b.date !== data.dates[i]) throw new Error('date mismatch ' + b.date + ' vs ' + data.dates[i]);
      const fund = String(a.held).toLowerCase();
      const pxNow = fund === 'cash' ? 0 : data[fund][i];
      // Two cash conventions exist in the library: interest every day on whatever cash there is (stretch family),
      // or only while the whole account is in cash (NFCI, buy-back). Both are tried; the closer one is the code's.
      const grossA = a.shares * pxNow + a.cash * (1 + dayRate) - b.fee, grossB = a.shares * pxNow + (fund === 'cash' ? a.cash * (1 + dayRate) : a.cash) - b.fee;
      const errA = Math.abs(grossA / b.value - 1), errB = Math.abs(grossB / b.value - 1), err = Math.min(errA, errB);
      if (err > worst) { worst = err; worstAt = b.date; }
      // The fee against what was traded: the value that changed hands at this close.
      const heldNow = String(b.held).toLowerCase(), sold = fund !== 'cash' && (heldNow !== fund || b.shares < a.shares - 1e-9) ? (heldNow !== fund ? a.shares : a.shares - b.shares) * pxNow : 0;
      const bought = heldNow !== 'cash' && (heldNow !== fund || b.shares > a.shares + 1e-9) ? (heldNow !== fund ? b.shares : b.shares - a.shares) * data[heldNow][i] : 0;
      const expectFee = cost * sold + cost * bought / (1 - cost);
      feeSum += b.fee; rows++;
      const fe = Math.abs(b.fee - expectFee) / Math.max(1e-9, b.value);
      if (fe > feeBad) { feeBad = fe; feeBadAt = b.date; }
      if (b.price && heldNow !== 'cash' && Math.abs(b.price / data[heldNow][i] - 1) > 1e-12) throw new Error('price mismatch ' + b.date);
    }
    console.log(`${NAMES[n].padEnd(20)} ${from}..${to}: ${rows} days, worst value error ${worst.toExponential(1)} (${worstAt}), worst fee error ${feeBad.toExponential(1)} of the account (${feeBadAt}), fees ${(feeSum / log[log.length - 1].value * 100).toFixed(3)}% of the end value`);
  }
}
