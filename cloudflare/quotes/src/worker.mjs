// Live-price proxy for tqqq.networthcast.com, a Cloudflare Worker.
//
// The site's history lives in git (data/*.tsv, refreshed by the GitHub Action);
// this worker serves what git should not: the latest price of each fund and
// today's intraday bars, read from Yahoo's chart endpoint, which sends no CORS
// header and so cannot be called from the page itself.
//
//   GET /quotes                      every fund in SYMBOLS
//   GET /quotes?symbols=TQQQ,SOXL    a subset
//   GET /bars/TQQQ?range=1d&interval=1m             intraday bars as JSON (ranges and intervals in BAR_RANGES)
//   GET /bars/TQQQ?range=1d&interval=1m&format=tsv  the same bars in the layout of data/intraday/tqqq-today-1m.tsv
//                                                   (bar open time in New York, regular session only), for the intraday page
//
// Who may call it: pages on https://tqqq.networthcast.com and pages served from
// localhost or 127.0.0.1 on any port (Live Server, the test server, the desktop
// widget's local copy). Every other Origin, and a request without one, gets 403
// and no CORS header. The Origin header is set by browsers and can be typed by
// a script, so this keeps other sites' pages out; it is not authentication. What
// bounds the upstream load is the cache: one Yahoo call per symbol per minute per
// edge location, whatever the number of visitors, plus the symbol allowlist.
//
// Caching: a Map in the isolate (always) and the Cache API (where the platform
// offers it; on a workers.dev hostname it may not store). Both hold the answer for
// QUOTE_TTL / BARS_TTL seconds; the browser may reuse a response for BROWSER_TTL.

const ORIGINS = [/^https:\/\/tqqq\.networthcast\.com$/, /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/];
const SYMBOLS = ['TQQQ', 'QQQ', 'SPY', 'QLD', 'SSO', 'SPXL', 'SQQQ', 'GLD', 'SOXL', 'SOXX'];
const BAR_RANGES = { '1d': ['1m', '5m'], '5d': ['5m'] };
const QUOTE_TTL = 60, BARS_TTL = 60, BROWSER_TTL = 20;
const UPSTREAM = 'https://query1.finance.yahoo.com/v8/finance/chart/';
const USER_AGENT = 'Mozilla/5.0 (compatible; tqqq.networthcast.com quotes proxy)';
// Yahoo's whole US feed froze for over an hour on 2026-11-05 (every symbol's last
// trade stuck at 12:10:50 ET while the market traded on). When a quote's trade time
// is more than STALE_MS old during New York session hours, Nasdaq's public quote
// feed is asked instead, and its price and time are used when it says the market
// is open and its print is newer. Yahoo's prior close stays, since the overlay's
// guard compares it with the files, and the answer says which source the price is from.
// With Alpaca keys present (below), Alpaca's trade is the price in session and this is the fallback.
const STALE_MS = 3 * 60 * 1000, NASDAQ = 'https://api.nasdaq.com/api/quote/', NASDAQ_TIMEOUT_MS = 4000;
// Alpaca's IEX feed is the live price during session hours: one call for every
// symbol, official and real-time on the free plan (IEX's own trades, which for
// these funds print many times a second). The keys are worker secrets
// (ALPACA_API_KEY, ALPACA_API_SECRET, uploaded by the deploy workflow from the
// repository's secrets); without them the Yahoo and Nasdaq path runs as before.
const ALPACA = 'https://data.alpaca.markets/v2/stocks/trades/latest', ALPACA_TIMEOUT_MS = 4000;
const NASDAQ_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const NY_PARTS = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour12: false, weekday: 'short', year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
const JSON_TYPE = 'application/json', TSV_TYPE = 'text/tab-separated-values; charset=utf-8';
// The TSV layout's session window, bar open times in New York (scripts/update_intraday_today.py).
const SESSION_OPEN_MIN = 9 * 60 + 30, SESSION_LAST_BAR_MIN = 15 * 60 + 59;
const NEW_YORK = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour12: false, year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });

const memory = new Map();   // key -> { until, text, type }

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('Origin');
    if (!ORIGINS.some(re => re.test(origin || ''))) return reply(403, { error: 'this proxy answers pages on tqqq.networthcast.com and localhost only' });
    const cors = {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Max-Age': '86400',
      'Vary': 'Origin',
    };
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'GET') return reply(405, { error: 'GET only' }, cors);
    const url = new URL(request.url);
    let route;
    if (url.pathname === '/quotes') route = quotesRoute(url);
    else if (url.pathname.startsWith('/bars/')) route = barsRoute(url);
    else return reply(404, { error: 'no such route; use /quotes or /bars/SYMBOL' }, cors);
    if (route.error) return reply(400, { error: route.error }, cors);

    const key = url.origin + route.key;
    const cached = await fromCache(key);
    if (cached) return respond(cached.text, cached.type, cors, 'HIT');
    const { ok, text, type } = await route.build(env);
    if (ok) await toCache(key, text, type, route.ttl, ctx);
    return respond(text, type, cors, 'MISS', ok ? 200 : 502);
  },
};

function quotesRoute(url) {
  const want = url.searchParams.get('symbols');
  const symbols = want ? want.split(',').map(s => s.trim().toUpperCase()).filter(Boolean) : SYMBOLS;
  const unknown = symbols.filter(s => !SYMBOLS.includes(s));
  if (unknown.length) return { error: 'unknown symbol ' + unknown.join(', ') + '; allowed: ' + SYMBOLS.join(', ') };
  const list = [...new Set(symbols)].sort();
  return {
    key: '/quotes?symbols=' + list.join(','),
    ttl: QUOTE_TTL,
    build: async (env) => {
      const quotes = {}, errors = {}, inSession = sessionNow();
      const trades = inSession ? await alpacaTrades(list, env) : {};
      await Promise.all(list.map(async symbol => {
        try {
          const q = quoteOf(await chart(symbol, '1d', '1d'));
          quotes[symbol] = trades[symbol] ? withTrade(q, trades[symbol], 'alpaca')
            : inSession && q.time && Date.now() - Date.parse(q.time) > STALE_MS ? await freshen(symbol, q) : q;
        }
        catch (e) { errors[symbol] = String(e.message || e); }
      }));
      const ok = Object.keys(errors).length === 0;
      return { ok, type: JSON_TYPE, text: JSON.stringify({ fetchedAt: new Date().toISOString(), quotes, ...(ok ? {} : { errors }) }) };
    },
  };
}

function barsRoute(url) {
  const symbol = decodeURIComponent(url.pathname.slice('/bars/'.length)).toUpperCase();
  if (!SYMBOLS.includes(symbol)) return { error: 'unknown symbol ' + symbol + '; allowed: ' + SYMBOLS.join(', ') };
  const range = url.searchParams.get('range') || '1d', interval = url.searchParams.get('interval') || '1m', format = url.searchParams.get('format') || 'json';
  if (!BAR_RANGES[range] || !BAR_RANGES[range].includes(interval)) return { error: 'range/interval must be one of ' + Object.entries(BAR_RANGES).map(([r, is]) => r + ' with ' + is.join(' or ')).join('; ') };
  if (format !== 'json' && format !== 'tsv') return { error: 'format must be json or tsv' };
  return {
    key: '/bars/' + symbol + '?range=' + range + '&interval=' + interval + '&format=' + format,
    ttl: BARS_TTL,
    build: async () => {
      let result;
      try { result = await chart(symbol, range, interval); }
      catch (e) { return { ok: false, type: JSON_TYPE, text: JSON.stringify({ fetchedAt: new Date().toISOString(), symbol, error: String(e.message || e) }) }; }
      const q = result.indicators.quote[0], ts = result.timestamp || [];
      if (format === 'tsv') {
        // One row per minute, as the pipeline's file. Yahoo's last bar is stamped with
        // the latest trade's second and can share a minute with the bar in progress;
        // it then updates that row (close, high, low) instead of adding one.
        const byMinute = new Map();
        for (let i = 0; i < ts.length; i++) {
          const c = q.close[i];
          if (c == null) continue;
          const t = ts[i] - ts[i] % 60, ny = newYork(t), minute = ny.hour * 60 + ny.minute;
          if (minute < SESSION_OPEN_MIN || minute > SESSION_LAST_BAR_MIN) continue;
          const o = q.open[i] == null ? c : q.open[i], h = q.high[i] == null ? c : q.high[i], l = q.low[i] == null ? c : q.low[i], v = q.volume[i] || 0;
          const row = byMinute.get(t);
          if (!row) byMinute.set(t, { stamp: ny.stamp, o, h, l, c, v });
          else { row.h = Math.max(row.h, h); row.l = Math.min(row.l, l); row.c = c; row.v = Math.max(row.v, v); }
        }
        const rows = ['Date\tOpen\tHigh\tLow\tClose\tVolume'];
        for (const r of byMinute.values()) rows.push(r.stamp + '\t' + [r.o, r.h, r.l, r.c].map(v => v.toFixed(4)).join('\t') + '\t' + Math.round(r.v));
        return { ok: true, type: TSV_TYPE, text: rows.join('\n') + '\n' };
      }
      const bars = [];
      for (let i = 0; i < ts.length; i++) if (q.close[i] != null) bars.push({ t: new Date(ts[i] * 1000).toISOString(), o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i], v: q.volume[i] });
      return { ok: true, type: JSON_TYPE, text: JSON.stringify({ fetchedAt: new Date().toISOString(), symbol, range, interval, timezone: result.meta.exchangeTimezoneName, bars }) };
    },
  };
}

// A bar's open time in New York: "M/D/YYYY HH:MM:SS" as the committed intraday files write it, plus the hour and minute for the session filter.
function newYork(epochSeconds) {
  const p = {};
  for (const { type, value } of NEW_YORK.formatToParts(new Date(epochSeconds * 1000))) p[type] = value;
  const hour = +p.hour % 24;   // some engines print midnight as 24
  return { hour, minute: +p.minute, stamp: p.month + '/' + p.day + '/' + p.year + ' ' + String(hour).padStart(2, '0') + ':' + p.minute + ':' + p.second };
}

// One chart call to Yahoo. The chart endpoint needs no cookie or crumb (the quote endpoint does).
async function chart(symbol, range, interval) {
  const res = await fetch(UPSTREAM + encodeURIComponent(symbol) + '?range=' + range + '&interval=' + interval + '&includePrePost=false&events=splits',
    { headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' } });
  if (!res.ok) throw new Error('upstream HTTP ' + res.status);
  const data = await res.json();
  const result = data && data.chart && data.chart.result && data.chart.result[0];
  if (!result) throw new Error((data && data.chart && data.chart.error && data.chart.error.description) || 'upstream returned no result');
  return result;
}

// The latest price and the prior close as Yahoo adjusts them today. A page that
// overlays `price` on the committed history should first check that `prevClose`
// agrees with its own last close: when they differ by more than a few percent the
// history is on another adjustment basis (a split, as SOXX on 2026-11-05) and the
// overlay must wait for the refreshed files.
function quoteOf(result) {
  const m = result.meta, q = result.indicators.quote[0], last = (result.timestamp || []).length - 1;
  const price = m.regularMarketPrice, prevClose = m.chartPreviousClose;
  const split = result.events && result.events.splits ? Object.values(result.events.splits).map(s => ({ date: new Date(s.date * 1000).toISOString().slice(0, 10), ratio: s.splitRatio })) : [];
  return {
    price,
    prevClose,
    changePct: prevClose > 0 ? (price / prevClose - 1) * 100 : null,
    time: m.regularMarketTime ? new Date(m.regularMarketTime * 1000).toISOString() : null,
    open: last >= 0 ? q.open[last] : null,
    high: last >= 0 ? q.high[last] : null,
    low: last >= 0 ? q.low[last] : null,
    volume: last >= 0 ? q.volume[last] : null,
    ...(split.length ? { splitToday: split } : {}),
  };
}

// New York session hours by the clock: a weekday, 09:30 to 16:00 (holidays included; Nasdaq's market status settles those).
function sessionNow(now = new Date()) {
  const p = {}; for (const { type, value } of NY_PARTS.formatToParts(now)) p[type] = value;
  const minute = (+p.hour % 24) * 60 + +p.minute;
  return !['Sat', 'Sun'].includes(p.weekday) && minute >= 9 * 60 + 30 && minute < 16 * 60;
}
// A New York wall-clock time ("Nov 5, 2026 1:24 PM ET", as Nasdaq writes it) as an ISO instant.
function nasdaqTimeToIso(text) {
  const m = /^([A-Z][a-z]{2}) (\d{1,2}), (\d{4}) (\d{1,2}):(\d{2}) (AM|PM) ET$/.exec(String(text || '').trim());
  if (!m || !(m[1] in MONTHS)) return null;
  const hour = (+m[4] % 12) + (m[6] === 'PM' ? 12 : 0);
  const guess = Date.UTC(+m[3], MONTHS[m[1]], +m[2], hour, +m[5]);   // the wall time read as UTC
  const p = {}; for (const { type, value } of NY_PARTS.formatToParts(new Date(guess))) p[type] = value;
  const wallAtGuess = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute);
  return new Date(guess + (guess - wallAtGuess)).toISOString();   // shift by New York's offset at that moment
}
// The latest IEX trade per symbol from Alpaca: { SYM: { price, time } }, empty without keys or on any failure.
async function alpacaTrades(symbols, env) {
  const key = env && env.ALPACA_API_KEY, secret = env && env.ALPACA_API_SECRET;
  if (!key || !secret) return {};
  try {
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), ALPACA_TIMEOUT_MS);
    const res = await fetch(ALPACA + '?feed=iex&symbols=' + encodeURIComponent(symbols.join(',')), { headers: { 'APCA-API-KEY-ID': key, 'APCA-API-SECRET-KEY': secret, 'Accept': 'application/json' }, signal: ctl.signal });
    clearTimeout(timer);
    if (!res.ok) return {};
    const trades = ((await res.json()) || {}).trades || {}, out = {};
    for (const [symbol, t] of Object.entries(trades)) if (t && t.p > 0 && t.t) out[symbol] = { price: t.p, time: new Date(t.t).toISOString() };
    return out;
  } catch (e) { return {}; }
}
// A Yahoo quote with a newer trade from another feed on it: the price and time
// change, the day's range widens if need be, the prior close stays (the overlay's
// guard compares it with the files), and the answer names the source.
function withTrade(q, trade, source) {
  if (!(trade.price > 0) || !trade.time || (q.time && Date.parse(trade.time) <= Date.parse(q.time))) return q;
  return { ...q, price: trade.price, time: trade.time, changePct: q.prevClose > 0 ? (trade.price / q.prevClose - 1) * 100 : null,
    high: Math.max(q.high || 0, trade.price) || trade.price, low: q.low > 0 ? Math.min(q.low, trade.price) : trade.price, source, yahooTime: q.time };
}
// Nasdaq's quote for a symbol whose Yahoo quote has gone stale: the price and time
// are replaced when Nasdaq reports the market open and a newer print; otherwise the
// Yahoo quote comes back marked stale. Nasdaq's feed answers browser-like requests only.
async function freshen(symbol, q) {
  const stale = { ...q, stale: true, source: 'yahoo' };
  try {
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), NASDAQ_TIMEOUT_MS);
    const res = await fetch(NASDAQ + encodeURIComponent(symbol) + '/info?assetclass=etf', { headers: { 'User-Agent': NASDAQ_UA, 'Accept': 'application/json' }, signal: ctl.signal });
    clearTimeout(timer);
    if (!res.ok) return stale;
    const data = ((await res.json()) || {}).data || {}, pd = data.primaryData || {};
    const price = parseFloat(String(pd.lastSalePrice || '').replace(/[$,]/g, '')), time = nasdaqTimeToIso(pd.lastTradeTimestamp);
    if (data.marketStatus !== 'Open' || !(price > 0) || !time || Date.parse(time) <= Date.parse(q.time)) return stale;
    return withTrade(q, { price, time }, 'nasdaq');
  } catch (e) { return stale; }
}

async function fromCache(key) {
  const hit = memory.get(key);
  if (hit && hit.until > Date.now()) return hit;
  const cache = edgeCache();
  if (!cache) return null;
  const res = await cache.match(new Request(key));
  if (!res) return null;
  const entry = { until: Date.now() + 5000, text: await res.text(), type: res.headers.get('Content-Type') || JSON_TYPE };   // a short memory copy, the edge copy keeps its own age
  memory.set(key, entry);
  return entry;
}

async function toCache(key, text, type, ttl, ctx) {
  memory.set(key, { until: Date.now() + ttl * 1000, text, type });
  const cache = edgeCache();
  if (!cache) return;
  const put = cache.put(new Request(key), new Response(text, { headers: { 'Content-Type': type, 'Cache-Control': 's-maxage=' + ttl } })).catch(() => {});
  if (ctx && ctx.waitUntil) ctx.waitUntil(put); else await put;
}

function edgeCache() { return (typeof caches !== 'undefined' && caches.default) || null; }

function respond(text, type, cors, cacheState, status = 200) {
  return new Response(text, { status, headers: { ...cors, 'Content-Type': type, 'Cache-Control': 'public, max-age=' + BROWSER_TTL, 'X-Cache': cacheState } });
}

function reply(status, body, cors = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': JSON_TYPE, 'Cache-Control': 'no-store' } });
}
