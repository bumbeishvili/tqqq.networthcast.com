'use strict';
// The drift stress (the user, 2026-11-09: "still defend against my worry"): eras the 2010+ tuning
// never saw. Per era, at the shipped thresholds: the whole single-lookback curve (was 550 the right
// horizon there?), and the vote variants against fixed 550 - if the winner mechanism defends against
// a mis-specified horizon, it should recover toward each era's own optimum without being told.
// Everything at shipped thresholds; the winner at its default window (504) and no hysteresis, since
// its fitted knobs come from the 2010-2025 fit and would leak here.
const fs = require('fs');
const { CODE, run } = require('./harness.cjs');
const { VOTE_CODE } = require('./vote.cjs');
const LS = [252, 280, 300, 320, 340, 360, 380, 400, 420, 440, 460, 480, 500, 510, 520, 530, 540, 550, 560, 570, 580, 590, 600, 620, 640, 660, 680, 700, 720, 756, 780, 800, 840, 880, 920, 960, 1008];
const NARROW = [450, 475, 500, 525, 550, 575, 600, 625, 650], WIDE = [380, 443, 505, 568, 630, 693, 755, 818, 880];
const ERAS = [['1953-01-02', '1982-12-31'], ['1983-01-03', '2009-12-31'], ['2010-01-01', '2026-12-31']];
const out = { eras: {} };
for (const [a, b] of ERAS) {
  const tag = a.slice(0, 4) + '-' + b.slice(0, 4), era = { curve: [] };
  for (const L of LS) { const r = run(CODE[52], { lookbackDays: L }, a, b); era.curve.push({ L, cagr: +r.cagr.toFixed(1), dd: +r.dd.toFixed(1) }); }
  const sorted = era.curve.slice().sort((x, y) => y.cagr - x.cagr);
  era.bestL = sorted[0]; era.rankOf550 = sorted.findIndex(x => x.L === 550) + 1;
  era.at550 = era.curve.find(x => x.L === 550);
  for (const [vtag, P] of [
    ['median narrow', { voteMode: 'median', voteLookbacks: NARROW }],
    ['median wide', { voteMode: 'median', voteLookbacks: WIDE }],
    ['majority narrow', { voteMode: 'majority', voteLookbacks: NARROW }],
    ['majority wide', { voteMode: 'majority', voteLookbacks: WIDE }],
    ['winner narrow', { voteMode: 'winner', voteLookbacks: NARROW, voteSelWindow: 504 }],
    ['winner wide', { voteMode: 'winner', voteLookbacks: WIDE, voteSelWindow: 504 }],
  ]) { const r = run(VOTE_CODE[52], P, a, b); era[vtag] = { cagr: +r.cagr.toFixed(1), dd: +r.dd.toFixed(1) }; }
  out.eras[tag] = era;
  console.log(tag, 'best single L', JSON.stringify(era.bestL), '| 550:', JSON.stringify(era.at550), 'rank', era.rankOf550 + '/' + LS.length,
    '| winner wide', JSON.stringify(era['winner wide']), '| winner narrow', JSON.stringify(era['winner narrow']),
    '| majority wide', JSON.stringify(era['majority wide']), '| median wide', JSON.stringify(era['median wide']));
}
// Where the wide winner spends its days, by decade, and how often it switches horizon.
const tr = {};
run(VOTE_CODE[52], { voteMode: 'winner', voteLookbacks: WIDE, voteSelWindow: 504, voteTrace: tr }, '1960-01-04', '2026-12-31');
const byDecade = {};
let switches = 0, prev = null, first = null, last = null;
for (const [d, L] of Object.entries(tr)) {
  const dec = d.slice(0, 3) + '0s';
  (byDecade[dec] = byDecade[dec] || {})[L] = (byDecade[dec][L] || 0) + 1;
  if (prev != null && L !== prev) switches++;
  prev = L; if (!first) first = d; last = d;
}
out.occupancy = { first, last, switches, byDecade };
console.log('wide winner: horizon days by decade (switches total ' + switches + ')');
for (const [dec, counts] of Object.entries(byDecade)) {
  const total = Object.values(counts).reduce((a, x) => a + x, 0);
  const top = Object.entries(counts).sort((x, y) => y[1] - x[1]).slice(0, 3).map(([L, c]) => L + 'd ' + Math.round(100 * c / total) + '%').join(' ');
  console.log(' ', dec, top);
}
fs.writeFileSync('out/era-stress.json', JSON.stringify(out, null, 1));
