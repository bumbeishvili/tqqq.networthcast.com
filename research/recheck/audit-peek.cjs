'use strict';
// No-peeking audit: cut the data after a day and run to that day; every row up to it must equal the
// full-history run's row (holdings, value and every logged signal). A rule that read a later price would differ.
const L = require('./lib.cjs');
const { CODE, data, NAMES, idxOf, idxBefore, runOn, truncated } = L;
const IGNORE = new Set(['action', 'note', 'firedBy']);   // the last row is marked "end" and words may differ on it
const same = (a, b) => (a === b) || (typeof a === 'number' && typeof b === 'number' && (Number.isNaN(a) && Number.isNaN(b) || Math.abs(a - b) <= 1e-12 * Math.max(1, Math.abs(a), Math.abs(b)))) || (a == null && b == null);
const r = L.rng(11);
for (const n of [48, 49, 50, 53]) {
  for (const from of ['2009-12-31', '1996-01-02']) {
    const s = idxOf(from), e = idxBefore(L.LAST), full = runOn(data, CODE[n], {}, s, e);
    let cuts = 0, diffs = 0, first = '';
    for (let c = 0; c < 60; c++) {
      const k = s + 30 + Math.floor(r() * (e - s - 30));
      const part = runOn(truncated(k), CODE[n], {}, s, k); cuts++;
      if (part.length !== k - s + 1) throw new Error('row count');
      for (let j = 0; j < part.length; j++) {
        const A = full[j], B = part[j];
        for (const key of new Set([...Object.keys(A), ...Object.keys(B)])) {
          if (IGNORE.has(key)) continue;
          if (!same(A[key], B[key])) { diffs++; if (!first) first = `${B.date} ${key}: full ${A[key]} vs cut ${B[key]} (cut at ${data.dates[k]})`; }
        }
        // the trade actions too, except on the last row
        if (j < part.length - 1 && A.action !== B.action) { diffs++; if (!first) first = `${B.date} action: full ${A.action} vs cut ${B.action}`; }
      }
    }
    console.log(`${NAMES[n].padEnd(20)} from ${from}: ${cuts} cut dates, ${diffs} differing cells${first ? ' — first: ' + first : ''}`);
  }
}
