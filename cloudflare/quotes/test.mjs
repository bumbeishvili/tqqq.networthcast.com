// Drives the worker's handler directly in Node (no wrangler): the origin rules, the
// routes, the symbol checks, the cache and the TSV layout, with real calls to Yahoo
// for the data.
//   node cloudflare/quotes/test.mjs
// With --offline, Yahoo is replaced by a canned chart answer (three 1-minute bars
// from the 09:30 open on 2026-11-05 New York time, a trailing bar 27 seconds into
// the third minute as Yahoo stamps its latest trade, one bar after the close, and
// with the extended-hours bars an after-hours print at 16:10), and the clock is
// pinned to that Thursday afternoon, so the checks are the same at any real hour
// and need no network (the deploy workflow runs it this way).
import worker from './src/worker.mjs';

const OFFLINE = process.argv.includes('--offline');
// Offline, the stub plays three Yahoo moods per symbol: fresh (the default), stale with
// Nasdaq answering (SOXL), stale with Nasdaq failing (SPY); the session clock is pinned
// to a weekday afternoon so the staleness rule is live in the test.
const STALE = { SOXL: 'nasdaq', SPY: 'nasdaq-down' };
const SESSION_CLOCK = Date.UTC(2026, 10, 5, 18, 30);   // 13:30 EST, a Thursday
let nowFixed = SESSION_CLOCK;
let FULLDAY = null;   // the chart meta's fulldayPrice for TQQQ (the overnight print) when set
let CHART_DAY = 0;   // days the Yahoo chart stub's bars are moved on from Thursday 11/5 (1: Friday's bars, as Yahoo serves them all weekend)
if (OFFLINE) {
  const open = Date.UTC(2026, 10, 5, 14, 30) / 1000;   // 2026-11-05 09:30 EST
  // Both clocks the worker reads stand at nowFixed: Date.now() and new Date() with
  // no argument (sessionNow), so the checks read the same at any hour of the real day.
  const RealDate = Date;
  globalThis.Date = class extends RealDate {
    constructor(...args) { super(...(args.length ? args : [nowFixed])); }
    static now() { return nowFixed; }
  };
  globalThis.fetch = async (url) => {
    const u = new URL(url);
    if (u.hostname === 'data.alpaca.markets') {
      if (globalThis.__alpacaDown) return new Response('forbidden', { status: 403 });
      if (/\/bars$/.test(u.pathname)) {
        // two sessions of 1-minute IEX bars: 11/4 (two bars) and 11/5 from 09:30 (three bars, the last in progress)
        const iso = t => new Date(t * 1000).toISOString();
        const bars = [[open - 86400, 40], [open - 86400 + 60, 40.5], [open, 41], [open + 60, 41.5], [open + 120, 42]].map(([t, c]) => ({ t: iso(t), o: c - 0.25, h: c + 0.25, l: c - 0.5, c, v: 777, n: 9, vw: c }));
        return Response.json({ bars, symbol: u.pathname.split('/')[3], next_page_token: null });
      }
      const symbols = (u.searchParams.get('symbols') || '').split(','), trades = {};
      for (const sym of symbols) trades[sym] = { t: new Date(nowFixed - 5000).toISOString().replace('.000Z', '.123456789Z'), p: 40 + sym.length + 0.75, s: 100, x: 'V' };
      return Response.json({ trades });
    }
    if (u.hostname === 'api.nasdaq.com') {
      const symbol = u.pathname.split('/')[3];
      if (STALE[symbol] === 'nasdaq-down') return new Response('blocked', { status: 403 });
      return Response.json({ data: { marketStatus: 'Open', primaryData: { lastSalePrice: '$44.50', lastTradeTimestamp: 'Nov 5, 2026 1:29 PM ET', isRealTime: true } } });
    }
    const symbol = decodeURIComponent(u.pathname.split('/').pop()), prePost = u.searchParams.get('includePrePost') === 'true';
    const tradeAt = STALE[symbol] ? SESSION_CLOCK / 1000 - 70 * 60 : SESSION_CLOCK / 1000 - 30;   // a stale Yahoo print is 70 minutes old, a fresh one 30 seconds
    const px = 40 + symbol.length, TRAIL = 3, POST = 5, day = open + CHART_DAY * 86400, close = day + 6.5 * 3600;
    // Three session minutes, the trailing print and the 16:00 bar. With the extended-hours
    // bars: an after-hours print at 16:10 as well, except for GLD, whose answer stops before the close.
    const session = [day, day + 60, day + 120, day + 147, close];
    const ts = !prePost ? session : symbol === 'GLD' ? session.slice(0, 4) : session.concat([close + 600]);
    const col = (v, trail, post) => ts.map((_, k) => k === TRAIL ? trail : k === POST ? post : v);
    return Response.json({ chart: { result: [{ meta: { regularMarketPrice: px + 0.25, chartPreviousClose: px - 1, regularMarketTime: tradeAt, exchangeTimezoneName: 'America/New_York', ...(FULLDAY && symbol === 'TQQQ' ? { fulldayPrice: FULLDAY } : {}),
      currentTradingPeriod: { pre: { start: day - 5.5 * 3600, end: day }, regular: { start: day, end: close }, post: { start: close, end: close + 4 * 3600 } } },
      timestamp: ts, indicators: { quote: [{ open: col(px - 0.5, px + 0.25, px - 0.5), high: col(px + 0.5, px + 0.25, px - 0.5), low: col(px - 1, px + 0.25, px - 1), close: col(px, px + 0.25, px - 0.75), volume: col(1000, 0, 10) }] } }], error: null } });
  };
  console.log('offline: Yahoo replaced by a canned chart answer');
}

const BASE = 'https://tqqq-quotes.example.workers.dev';
const ctx = { waitUntil: p => p };
const call = (path, { origin, method = 'GET', env = {} } = {}) => worker.fetch(new Request(BASE + path, { method, headers: origin ? { Origin: origin } : {} }), env, ctx);
let failed = 0;
const check = (name, ok, detail = '') => { console.log((ok ? 'ok   ' : 'FAIL ') + name + (detail ? '  ' + detail : '')); if (!ok) failed++; };

const site = 'https://tqqq.networthcast.com', local = 'http://127.0.0.1:5500';

let r = await call('/quotes', { origin: site }); let b = await r.json();
const n = Object.keys(b.quotes || {}).length, prices = Object.values(b.quotes || {}).map(q => q.price);
check('site origin: /quotes answers 200 with ten quotes', r.status === 200 && n === 10 && prices.every(p => p > 0), r.status + ' ' + n + ' quotes, TQQQ ' + JSON.stringify(b.quotes && b.quotes.TQQQ));
check('site origin: CORS header names the origin', r.headers.get('Access-Control-Allow-Origin') === site && r.headers.get('Vary') === 'Origin');
check('first call was a cache miss', r.headers.get('X-Cache') === 'MISS');

if (OFFLINE) {
  const soxl = b.quotes.SOXL, spy = b.quotes.SPY, tqqq = b.quotes.TQQQ;
  check('stale Yahoo + Nasdaq open: Nasdaq price and time, Yahoo prior close kept, source nasdaq', soxl.source === 'nasdaq' && soxl.price === 44.5 && soxl.time === '2026-11-05T18:29:00.000Z' && soxl.prevClose === 43 && soxl.yahooTime && !soxl.stale, JSON.stringify(soxl));
  check('stale Yahoo + Nasdaq failing: Yahoo quote marked stale', spy.source === 'yahoo' && spy.stale === true && spy.price === 43.25, JSON.stringify(spy));
  check('fresh Yahoo: untouched, no source field', tqqq.source === undefined && tqqq.stale === undefined, JSON.stringify(tqqq));
  check('in session: no extended-hours field', tqqq.extended === undefined);
  // After the close: the latest after-hours print, its time and its change against the close; the regular quote as it was.
  nowFixed = Date.UTC(2026, 10, 5, 21, 10);   // 16:10 EST; the session's cache entries have aged out
  let rp = await call('/quotes?symbols=TQQQ,GLD', { origin: site }); let bp = await rp.json();
  const pt = bp.quotes.TQQQ, pg = bp.quotes.GLD;
  check('after the close: extended names the post-session print, its time and its change against the close; the regular price kept', pt.price === 44.25 && pt.source === undefined && pt.extended && pt.extended.session === 'post' && pt.extended.price === 43.25 && pt.extended.time === '2026-11-05T21:10:00.000Z' && Math.abs(pt.extended.changePct - (43.25 / 44.25 - 1) * 100) < 1e-9, JSON.stringify(pt));
  check('after the close, a fund with no print after it: no extended field', pg.extended === undefined && pg.price === 43.25, JSON.stringify(pg));
  // After midnight the bars are still Thursday's: the after-hours print stands, classified by its own clock.
  nowFixed = Date.UTC(2026, 10, 6, 6, 30);   // 01:30 EST, Friday
  rp = await call('/quotes?symbols=TQQQ,GLD', { origin: site }); bp = await rp.json();
  check('after midnight: Thursday\'s after-hours print still named, with its own time', bp.quotes.TQQQ.extended && bp.quotes.TQQQ.extended.session === 'post' && bp.quotes.TQQQ.extended.price === 43.25 && bp.quotes.TQQQ.extended.time === '2026-11-05T21:10:00.000Z', JSON.stringify(bp.quotes.TQQQ.extended));
  check('after midnight: a fund whose last bar is a session bar has no extended field', bp.quotes.GLD.extended === undefined, JSON.stringify(bp.quotes.GLD.extended));
  // Overnight: the meta's fulldayPrice differs from the last bar, so it is the print, timed when read.
  FULLDAY = 44.9; nowFixed = Date.UTC(2026, 10, 6, 6, 32);   // two minutes on: the cache entry has aged out
  rp = await call('/quotes?symbols=TQQQ,GLD', { origin: site }); bp = await rp.json();
  const on = bp.quotes.TQQQ.extended;
  check('overnight: fulldayPrice is the print, session overnight, timed when read, change against the regular price', on && on.session === 'overnight' && on.price === 44.9 && on.time === '2026-11-06T06:32:00.000Z' && Math.abs(on.changePct - (44.9 / 44.25 - 1) * 100) < 1e-9, JSON.stringify(on));
  check('overnight: a fund without a fulldayPrice has no extended field', bp.quotes.GLD.extended === undefined, JSON.stringify(bp.quotes.GLD.extended));
  // 20:02 Thursday with fulldayPrice at the last bar: nothing has traded overnight yet, the after-hours print stands.
  FULLDAY = 43.25; nowFixed = Date.UTC(2026, 10, 6, 1, 2);   // 20:02 EST, Thursday
  rp = await call('/quotes?symbols=TQQQ', { origin: site }); bp = await rp.json();
  check('20:02 with fulldayPrice at the last bar: the after-hours print stands', bp.quotes.TQQQ.extended && bp.quotes.TQQQ.extended.session === 'post' && bp.quotes.TQQQ.extended.price === 43.25 && bp.quotes.TQQQ.extended.time === '2026-11-05T21:10:00.000Z', JSON.stringify(bp.quotes.TQQQ.extended));
  // A feed still serving Thursday's bars on Friday evening: a session has opened since, so the bar is no print.
  FULLDAY = null; nowFixed = Date.UTC(2026, 10, 6, 21, 30);   // 16:30 EST, Friday
  rp = await call('/quotes?symbols=TQQQ', { origin: site }); bp = await rp.json();
  check('Friday evening with Thursday\'s bars: a session has opened since, no extended field', bp.quotes.TQQQ.extended === undefined, JSON.stringify(bp.quotes.TQQQ.extended));
  // The weekend, with Friday's bars as Yahoo serves them: Friday's after-hours print stands until Monday's open;
  // Saturday night has no overnight session, so a differing fulldayPrice is not a print; Sunday night it is.
  CHART_DAY = 1; FULLDAY = 44.9;
  const friPost = { session: 'post', price: 43.25, time: '2026-11-06T21:10:00.000Z' };
  const sameAs = (x, want) => !!x && x.session === want.session && x.price === want.price && x.time === want.time;
  nowFixed = Date.UTC(2026, 10, 8, 2, 0);   // 21:00 EST, Saturday
  rp = await call('/quotes?symbols=TQQQ', { origin: site }); bp = await rp.json();
  check('Saturday night: no overnight session, Friday\'s after-hours print stands', sameAs(bp.quotes.TQQQ.extended, friPost), JSON.stringify(bp.quotes.TQQQ.extended));
  nowFixed = Date.UTC(2026, 10, 8, 14, 0);   // 09:00 EST, Sunday
  rp = await call('/quotes?symbols=TQQQ', { origin: site }); bp = await rp.json();
  check('Sunday: Friday\'s after-hours print still stands', sameAs(bp.quotes.TQQQ.extended, friPost), JSON.stringify(bp.quotes.TQQQ.extended));
  nowFixed = Date.UTC(2026, 10, 9, 2, 0);   // 21:00 EST, Sunday
  rp = await call('/quotes?symbols=TQQQ', { origin: site }); bp = await rp.json();
  check('Sunday night: fulldayPrice is the overnight print', sameAs(bp.quotes.TQQQ.extended, { session: 'overnight', price: 44.9, time: '2026-11-09T02:00:00.000Z' }), JSON.stringify(bp.quotes.TQQQ.extended));
  CHART_DAY = 0; FULLDAY = null; nowFixed = SESSION_CLOCK;
  // with Alpaca keys: its trade is the in-session price for every symbol, Yahoo's prior close kept; a down Alpaca falls back to the path above
  const KEYS = { ALPACA_API_KEY: 'k', ALPACA_API_SECRET: 's' };
  let ra = await call('/quotes?symbols=TQQQ,SOXL,SPY&x=alpaca', { origin: site, env: KEYS }); let ba = await ra.json();
  const at = ba.quotes.TQQQ, as = ba.quotes.SOXL;
  check('alpaca keys: price and time from the IEX trade, source alpaca, prior close from Yahoo', at.source === 'alpaca' && at.price === 44.75 && at.time === '2026-11-05T18:29:55.123Z' && at.prevClose === 43 && at.yahooTime, JSON.stringify(at));
  check('alpaca keys: a stale Yahoo symbol takes the Alpaca trade before Nasdaq', as.source === 'alpaca' && as.price === 44.75, JSON.stringify(as));
  globalThis.__alpacaDown = true;
  ra = await call('/quotes?symbols=TQQQ,SOXL&x=alpaca-down', { origin: site, env: KEYS }); ba = await ra.json();
  check('alpaca down: fresh Yahoo stands, stale Yahoo goes to Nasdaq', ba.quotes.TQQQ.source === undefined && ba.quotes.SOXL.source === 'nasdaq', JSON.stringify(ba.quotes));
  globalThis.__alpacaDown = false;
}
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
check('tsv: 200 as tab-separated text, from Yahoo without keys', r.status === 200 && /^text\/tab-separated-values/.test(r.headers.get('Content-Type')) && r.headers.get('X-Cache') === 'MISS' && r.headers.get('X-Source') === 'yahoo');
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

// The Alpaca bars last: the cache key is the route and its parameters, keys or not, so these run on
// symbols the Yahoo checks above did not touch.
if (OFFLINE) {
  const KEYS = { ALPACA_API_KEY: 'k', ALPACA_API_SECRET: 's' };
  let ra, ba;
  // bars from Alpaca: the latest session only for 1d, the pipeline's TSV layout, X-Source on both forms; Yahoo when Alpaca is down
  ra = await call('/bars/QQQ?range=1d&interval=1m&format=tsv', { origin: site, env: KEYS }); const tsvA = await ra.text(); const linesA = tsvA.trim().split('\n');
  check('alpaca bars tsv: X-Source alpaca, three rows of 11/5 only, IEX volume as given', ra.headers.get('X-Source') === 'alpaca' && linesA.length === 4 && linesA[1] === '11/5/2026 09:30:00\t40.7500\t41.2500\t40.5000\t41.0000\t777' && linesA[3].startsWith('11/5/2026 09:32:00\t'), linesA.join(' | '));
  ra = await call('/bars/QQQ?range=1d&interval=1m', { origin: site, env: KEYS }); ba = await ra.json();
  check('alpaca bars json: source alpaca, three bars, ISO times', ba.source === 'alpaca' && ra.headers.get('X-Source') === 'alpaca' && ba.bars.length === 3 && ba.bars[0].t === '2026-11-05T14:30:00.000Z', JSON.stringify(ba.bars[0]));
  ra = await call('/bars/QQQ?range=5d&interval=5m', { origin: site, env: KEYS }); ba = await ra.json();
  check('alpaca bars 5d: both sessions', ba.bars.length === 5, ba.bars.length + ' bars');
  globalThis.__alpacaDown = true;
  ra = await call('/bars/SPY?range=1d&interval=1m&format=tsv', { origin: site, env: KEYS }); const tsvY = await ra.text();
  check('alpaca down: bars from Yahoo, X-Source yahoo', ra.headers.get('X-Source') === 'yahoo' && tsvY.trim().split('\n').length === 4, 'status ' + ra.status + ' source ' + ra.headers.get('X-Source') + ' cache ' + ra.headers.get('X-Cache') + ' | ' + tsvY.slice(0, 160).replace(/\n/g, ' / '));
  globalThis.__alpacaDown = false;
}
console.log(failed ? failed + ' check(s) failed' : 'all checks passed');
process.exit(failed ? 1 : 0);
