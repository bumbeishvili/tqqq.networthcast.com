'use strict';
// data/nfci.tsv with first-published readings: rows before the first live reading (2011-05-20) as the file has them
// today; from then, each week's value from the first Friday file that contains it (the Friday the app starts using it).
const fs = require('fs'), path = require('path');
const FILE = path.join(__dirname, '..', '..', '..', 'data', 'nfci.tsv');   // run once, on a file that still holds FRED's revised history; a second run on its own output changes nothing
const asof = JSON.parse(fs.readFileSync(path.join(__dirname, 'asof.json'), 'utf8'));
const cur = fs.readFileSync(FILE, 'utf8').trim().split('\n').slice(1).map(l => { const [d, v] = l.split('\t'); const [m, dd, y] = d.split(' ')[0].split('/'); return { iso: `${y}-${m.padStart(2, '0')}-${dd.padStart(2, '0')}`, label: d, v: +v }; });
const first = new Map();   // observation date -> { v, seen } from the earliest as-of file holding it
const days = Object.keys(asof).sort();
let lastSeen = '';
for (const a of days) for (const [obs, v] of Object.entries(asof[a]).sort()) { if (obs > lastSeen) { if (lastSeen || obs === Object.keys(asof[a]).sort().pop()) first.set(obs, { v, seen: a }); } }
// walk again properly: an observation is new in file a when it is later than every observation of the files before
first.clear(); lastSeen = '';
for (const a of days) { const obs = Object.keys(asof[a]).sort(); const newest = obs[obs.length - 1]; for (const o of obs) if (o > lastSeen && (lastSeen !== '' || o === newest)) first.set(o, { v: asof[a][o], seen: a }); if (newest > lastSeen) lastSeen = newest; }
const firstObs = [...first.keys()].sort()[0];
const lag = [...first.entries()].map(([o, x]) => (Date.parse(x.seen) - Date.parse(o)) / 864e5);
console.log(`as-of files ${days.length} (${days[0]}..${days[days.length - 1]}); first-published readings ${first.size}, ${firstObs}..${[...first.keys()].sort().pop()}; days from a week's end to the file it first shows in: min ${Math.min(...lag)} max ${Math.max(...lag)}, over 7 in ${lag.filter(x => x > 7).length}`);
const missing = cur.filter(r => r.iso >= firstObs && !first.has(r.iso)).map(r => r.iso); console.log('weeks in today\'s file from then with no first-published value:', missing.length, missing.slice(0, 8).join(' '));
const extra = [...first.keys()].filter(o => !cur.some(r => r.iso === o)); console.log('first-published weeks not in today\'s file:', extra.length, extra.slice(0, 8).join(' '));
let maxGap = 0, maxAt = '', maxRt = -9, maxRtAt = '', changed = 0;
const out = cur.map(r => { if (r.iso < firstObs || !first.has(r.iso)) return `${r.label}\t${r.v.toFixed(4)}`; const x = first.get(r.iso).v; const g = Math.abs(x - r.v); if (g > maxGap) { maxGap = g; maxAt = r.iso; } if (x > maxRt) { maxRt = x; maxRtAt = r.iso; } if (x.toFixed(4) !== r.v.toFixed(4)) changed++; return `${r.label}\t${x.toFixed(4)}`; });
console.log(`rows ${out.length}; changed ${changed}; largest move from today's value ${maxGap.toFixed(3)} (${maxAt}); highest first-published reading ${maxRt} (${maxRtAt})`);
if (process.argv[2] === '--write') { fs.writeFileSync(FILE, 'Date\tRate\n' + out.join('\n') + '\n'); console.log('written'); }
