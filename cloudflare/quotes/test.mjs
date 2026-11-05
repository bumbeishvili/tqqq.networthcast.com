// Drives the worker's handler directly in Node (no wrangler): the origin rules, the
// routes, the symbol checks, the cache and the TSV layout, with real calls to Yahoo
// for the data.
//   node cloudflare/quotes/test.mjs
// With --offline, Yahoo is replaced by a canned chart answer (three 1-minute bars
// from the 09:30 open on 2026-11-05 New York time, a trailing bar 27 seconds into
// the third minute as Yahoo stamps its latest trade, and one bar after the close),
// so the checks are the same but need no network (the deploy workflow runs it this way).
import worker from './src/worker.mjs';

const OFFLINE = process.argv.includes('--offline');
if (OFFLINE) {
  const open = Date.UTC(2026, 10, 5, 14, 30) / 1000;   // 2026-11-05 09:30 EST
  globalThis.fetch = async (url) => {
    const symbol = decodeURIComponent(new URL(url).pathname.split('/').pop());
    const px = 40 + symbol.length, ts = [open, open + 60, open + 120, open + 147, open + 6.5 * 3600], TRAIL = 3;
    const col = (v, trail) => ts.map((_, k) => k === TRAIL ? trail : v);
    return Response.json({ chart: { result: [{ meta: { regularMarketPrice: px + 0.25, chartPreviousClose: px - 1, regularMarketTime: open + 147, exchangeTimezoneName: 'America/New_York' },
      timestamp: ts, indicators: { quote: [{ open: col(px - 0.5, px + 0.25), high: col(px + 0.5, px + 0.25), low: col(px - 1, px + 0.25), close: col(px, px + 0.25), volume: col(1000, 0) }] } }], error: null } });
  };
  console.log('offline: Yahoo replaced by a canned chart answer');
}

const BASE = 'https://tqqq-quotes.example.workers.dev';
const ctx = { waitUntil: p => p };
const call = (path, { origin, method = 'GET' } = {}) => worker.fetch(new Request(BASE + path, { method, headers: origin ? { Origin: origin } : {} }), {}, ctx);
let failed = 0;
const check = (name, ok, detail = '') => { console.log((ok ? 'ok   ' : 'FAIL ') + name + (detail ? '  ' + detail : '')); if (!ok) failed++; };

const site = 'https://tqqq.networthcast.com', local = 'http://127.0.0.1:5500';

let r = await call('/quotes', { origin: site }); let b = await r.json();
const n = Object.keys(b.quotes || {}).length, prices = Object.values(b.quotes || {}).map(q => q.price);
check('site origin: /quotes answers 200 with ten quotes', r.status === 200 && n === 10 && prices.every(p => p > 0), r.status + ' ' + n + ' quotes, TQQQ ' + JSON.stringify(b.quotes && b.quotes.TQQQ));
check('site origin: CORS header names the origin', r.headers.get('Access-Control-Allow-Origin') === site && r.headers.get('Vary') === 'Origin');
check('first call was a cache miss', r.headers.get('X-Cache') === 'MISS');

r = await call('/quotes', { origin: local }); b = await r.json();
check('localhost:5500 origin: 200, served from the cache', r.status === 200 && r.headers.get('X-Cache') === 'HIT' && r.headers.get('Access-Control-Allow-Origin') === local);
r = await call('/quotes', { origin: 'http://localhost:8766' });
check('localhost on another port: allowed', r.status === 200);
r = await call('/quotes', { origin: 'https://evil.example.com' });
check('other site: 403 and no CORS header', r.status === 403 && !r.headers.get('Access-Control-Allow-Origin'));
r = await call('/quotes', { origin: 'https://tqqq.networthcast.com.evil.example' });
check('look-alike host: 403', r.status === 403);
r = await call('/quotes', { origin: 'http://tqqq.networthcast.com' });
check('plain http on the site host: 403 (the site is https)', r.status === 403);
r = await call('/quotes');
check('no Origin header (address bar, curl): 403', r.status === 403);
r = await call('/quotes', { origin: site, method: 'OPTIONS' });
check('preflight from the site: 204 with the CORS headers', r.status === 204 && r.headers.get('Access-Control-Allow-Methods') === 'GET, OPTIONS');
r = await call('/quotes', { origin: site, method: 'POST' });
check('POST: 405', r.status === 405);
r = await call('/quotes?symbols=TQQQ,NOPE', { origin: site }); b = await r.json();
check('unknown symbol: 400 naming it', r.status === 400 && /NOPE/.test(b.error));
r = await call('/quotes?symbols=soxl,%20TQQQ', { origin: site }); b = await r.json();
check('subset, any case and spacing: the two quotes only', r.status === 200 && Object.keys(b.quotes).sort().join() === 'SOXL,TQQQ');
r = await call('/bars/TQQQ?range=1d&interval=1m', { origin: site }); b = await r.json();
const bar = (b.bars || [])[0];
check('bars: 200 with 1-minute bars carrying t/o/h/l/c/v', r.status === 200 && (b.bars || []).length > 0 && bar && ['t', 'o', 'h', 'l', 'c', 'v'].every(k => k in bar), (b.bars || []).length + ' bars, first ' + JSON.stringify(bar));
const jsonBars = (b.bars || []).length;

// the TSV layout of data/intraday/tqqq-today-1m.tsv
r = await call('/bars/TQQQ?range=1d&interval=1m&format=tsv', { origin: site }); const tsv = await r.text();
const lines = tsv.trim().split('\n'), rowRe = /^\d{1,2}\/\d{1,2}\/\d{4} \d{2}:\d{2}:\d{2}\t\d+\.\d{4}\t\d+\.\d{4}\t\d+\.\d{4}\t\d+\.\d{4}\t\d+$/;
const stampOf = line => line.split('\t')[0], clockOf = line => stampOf(line).split(' ')[1];
const minuteOf = line => { const [h, m] = clockOf(line).split(':'); return +h * 60 + +m; };
check('tsv: 200 as tab-separated text', r.status === 200 && /^text\/tab-separated-values/.test(r.headers.get('Content-Type')) && r.headers.get('X-Cache') === 'MISS');
check('tsv: header line as the committed file', lines[0] === 'Date\tOpen\tHigh\tLow\tClose\tVolume');
check('tsv: every row "M/D/YYYY HH:MM:SS" + four 4-decimal prices + integer volume', lines.length > 1 && lines.slice(1).every(l => rowRe.test(l)), (lines.length - 1) + ' rows, first ' + JSON.stringify(lines[1]) + ', last ' + JSON.stringify(lines[lines.length - 1]));
check('tsv: rows inside 09:30-15:59 New York only', lines.slice(1).every(l => minuteOf(l) >= 9 * 60 + 30 && minuteOf(l) <= 15 * 60 + 59));
check('tsv: one row per minute, stamped on the minute', lines.slice(1).every(l => clockOf(l).endsWith(':00')) && new Set(lines.slice(1).map(stampOf)).size === lines.length - 1);
check('tsv: no more rows than JSON bars (the close print after 15:59 drops out)', lines.length - 1 <= jsonBars);
if (OFFLINE) {
  check('tsv offline: the three session minutes from 09:30 on 11/5/2026, the 16:00 bar dropped', lines.length === 4 && lines[1].startsWith('11/5/2026 09:30:00\t') && lines[3].startsWith('11/5/2026 09:32:00\t'), lines.slice(1).map(l => l.split('\t')[0]).join(' | '));
  check('tsv offline: 4-decimal prices and the volume as written by the pipeline', lines[1] === '11/5/2026 09:30:00\t43.5000\t44.5000\t43.0000\t44.0000\t1000', lines[1]);
  check('tsv offline: the trailing bar updated its minute (close 44.25, open/high/low/volume kept)', lines[3] === '11/5/2026 09:32:00\t43.5000\t44.5000\t43.0000\t44.2500\t1000', lines[3]);
}
r = await call('/bars/TQQQ?range=1d&interval=1m&format=tsv', { origin: local });
check('tsv: second call served from the cache with its type', r.status === 200 && r.headers.get('X-Cache') === 'HIT' && /^text\/tab-separated-values/.test(r.headers.get('Content-Type')));
r = await call('/bars/TQQQ?format=csv', { origin: site });
check('bars with an unknown format: 400', r.status === 400);

r = await call('/bars/TQQQ?range=1mo&interval=1d', { origin: site });
check('bars with a range outside the list: 400', r.status === 400);
r = await call('/bars/AAPL', { origin: site });
check('bars for a symbol outside the list: 400', r.status === 400);
r = await call('/nothing', { origin: site });
check('unknown route: 404', r.status === 404);

console.log(failed ? failed + ' check(s) failed' : 'all checks passed');
process.exit(failed ? 1 : 0);
