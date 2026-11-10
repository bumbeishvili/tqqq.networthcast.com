'use strict';
// Real-time NFCI: for every Friday from 2011-05-27 on, the series as ALFRED had it that day (the last weeks only).
// The reading for the week ending Friday d is published the next Wednesday; the app starts using it on Friday d+7,
// so the value known on that Friday is the one a live strategy read. Saved per as-of day; resumable.
const { execFileSync } = require('child_process'), fs = require('fs'), path = require('path');
const OUT = path.join(__dirname, 'asof.json'), done = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {};
const iso = (t) => new Date(t).toISOString().slice(0, 10);
const END = Date.parse(process.argv[2] || '2026-11-06');
let n = 0, failed = 0;
for (let t = Date.parse('2011-05-27'); t <= END; t += 7 * 864e5) {
  const asof = iso(t); if (done[asof]) continue;
  const from = iso(t - 42 * 864e5);
  let text = '';
  for (let attempt = 1; attempt <= 3 && !/^\d{4}-\d{2}-\d{2},/m.test(text); attempt++) {
    try { text = execFileSync('curl', ['-sS', '--max-time', '40', `https://alfred.stlouisfed.org/graph/alfredgraph.csv?id=NFCI&vintage_date=${asof}&cosd=${from}&coed=${asof}`], { encoding: 'utf8' }); } catch (e) { text = ''; }
  }
  const rows = text.trim().split('\n').slice(1).map(l => l.split(',')).filter(r => /^\d{4}-\d{2}-\d{2}$/.test(r[0]) && r[1] !== '.' && r[1] !== '');
  if (!rows.length) { failed++; console.log('no rows for', asof); continue; }
  done[asof] = Object.fromEntries(rows.map(r => [r[0], +r[1]]));
  if (++n % 25 === 0) { fs.writeFileSync(OUT, JSON.stringify(done)); console.log(asof, 'saved', Object.keys(done).length); }
}
fs.writeFileSync(OUT, JSON.stringify(done)); console.log('finished:', Object.keys(done).length, 'as-of days,', failed, 'failed');
