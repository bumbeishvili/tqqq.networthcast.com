#!/usr/bin/env node
'use strict';
// Data for the desktop widget (widget/tqqq.widget/index.jsx): your portfolio as
// the strategy in your share link runs it on your own deposits, TQQQ today, and
// the strategy's last six months of lines and trades. It runs the site's own
// code from this checkout against the live data files on the site and prints
// one JSON object. A failure prints { "error": "..." } so the widget shows it
// instead of going blank.
//
//   node widget/widget-data.cjs <config.json>
//
// config.json (widget/install.sh puts it next to the installed widget):
//   shareLink  the site's Share link: your strategy and its settings, and your
//              deposits when a transaction history is loaded on the site
//   siteUrl    where the data files are served from
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const zlib = require('zlib');
// Node's fetch tries the site's IPv6 address first and, on a network without
// IPv6, waits out a 10-second timeout per file before failing; curl falls back
// to IPv4 at once. Asking for IPv4 first matches curl.
require('dns').setDefaultResultOrder('ipv4first');

const ROOT = path.resolve(__dirname, '..');
const LIB = require(path.join(ROOT, 'js', 'strategy-library-code.js'));
const WIDGET_ENTRY = 50;   // the strategy the widget tracks: TQQQ vs QQQ + Turnaround Monday
const SIGNAL_MONTHS = 6;
const CACHE_DIR = path.join(os.homedir(), 'Library', 'Caches', 'tqqq-widget');
// The files js/init.js loads, in the argument order of buildDaily (js/data.js).
const PRICE_FILES = [['qqq', 'synthetic-qqq.tsv'], ['tqqq', 'synthetic-tqqq.tsv'], ['spy', 'spy.tsv'], ['qld', 'synthetic-qld.tsv'],
  ['sso', 'synthetic-sso.tsv'], ['spxl', 'synthetic-spxl.tsv'], ['sqqq', 'synthetic-sqqq.tsv']];

// ---- fetching -------------------------------------------------------------
// GitHub Pages answers If-None-Match with 304, so a refresh that finds nothing
// new downloads nothing. Offline, the last copy is used and says so.
async function fetchCached(url, warnings) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const file = path.join(CACHE_DIR, url.replace(/^https?:\/\//, '').replace(/[^\w.-]+/g, '_'));
  const etagFile = file + '.etag';
  const cached = fs.existsSync(file);
  try {
    const headers = cached && fs.existsSync(etagFile) ? { 'If-None-Match': fs.readFileSync(etagFile, 'utf8') } : {};
    const res = await fetch(url, { headers });
    if (res.status === 304 && cached) return fs.readFileSync(file, 'utf8');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    fs.writeFileSync(file, text);
    const etag = res.headers.get('etag');
    if (etag) fs.writeFileSync(etagFile, etag);
    return text;
  } catch (err) {
    if (!cached) throw new Error(`${url}: ${err.message}`);
    warnings.push(`Offline: showing the copy from ${fs.statSync(file).mtime.toLocaleString()}`);
    return fs.readFileSync(file, 'utf8');
  }
}

// ---- the site's code --------------------------------------------------------
// The source of one declaration, `function name(…) {…}` or `const name = …;`,
// at any depth: it ends at the first line that closes it at its own indent.
function declaration(src, name) {
  const lines = src.split('\n');
  const head = new RegExp(`^(\\s*)(?:function ${name}\\s*\\(|const ${name}\\s*=)`);
  const at = lines.findIndex(l => head.test(l));
  if (at < 0) throw new Error(`${name} is missing from the site code`);
  const indent = head.exec(lines[at])[1];
  if (/;\s*$/.test(lines[at])) return lines[at];
  for (let j = at + 1; j < lines.length; j++) {
    if (lines[j].startsWith(indent + '}') || lines[j].startsWith(indent + ']')) return lines.slice(at, j + 1).join('\n');
  }
  throw new Error(`${name} has no end in the site code`);
}
// The site's browser scripts run as-is in a sandbox whose DOM swallows every
// call: their top-level listeners and canvas badges touch nothing. Helpers
// that live in browser-only files are lifted out by name, so the widget runs
// exactly the code the page runs.
function siteContext() {
  const inert = new Proxy(function () {}, {
    get: (t, k) => (k === Symbol.toPrimitive ? () => '' : inert), apply: () => inert, construct: () => inert, set: () => true,
  });
  const storage = { getItem: () => null, setItem() {}, removeItem() {} };
  const ctx = vm.createContext({ console, document: inert, localStorage: storage, sessionStorage: storage, matchMedia: () => inert,
    navigator: { userAgent: 'node', platform: 'MacIntel' }, setTimeout, clearTimeout, setInterval, clearInterval,
    TextEncoder, TextDecoder, atob, btoa, URL, URLSearchParams });
  ctx.window = ctx;
  for (const f of ['js/data.js', 'js/utils.js', 'js/transactions.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  const lift = (file, names) => { const src = fs.readFileSync(path.join(ROOT, file), 'utf8'); return names.map(n => declaration(src, n)).join('\n'); };
  vm.runInContext([
    'let _customDataCache = null;',
    lift('js/saved-configs.js', ['sanitize', 'asMod', 'evalMod', 'coerceCustomVal', 'buildCustomData']),
    lift('js/signal-chart.js', ['customTradeShare', 'CUSTOM_MINI_COLORS', 'LINE_COLOR_FLOORS', 'customLineColor']),
    lift('js/chart.js', ['CUSTOM_EVENT_STYLE', 'customActionKind']),
  ].join('\n'), ctx, { filename: 'widget-helpers' });
  return ctx;
}

// ---- the share link -----------------------------------------------------------
// The personal payloads ride the fragment (fragment first, then the query, as
// js/init.js reads them), deflated and base64url-encoded by packSharePayload.
function readShareLink(link) {
  if (!link) return { cfgs: [], txRows: null, entrySlider: null };
  const url = new URL(link);
  const frag = new URLSearchParams(url.hash.replace(/^#/, ''));
  const param = k => (frag.has(k) ? frag.get(k) : url.searchParams.get(k));
  const unpack = s => zlib.inflateRawSync(Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64')).toString('utf8');
  const json = (packed, plain) => (packed ? unpack(packed) : plain ? decodeURIComponent(plain) : null);
  const cfgJson = json(param('scz'), param('sc'));
  const txJson = json(param('txz'), param('tx'));
  return { cfgs: cfgJson ? JSON.parse(cfgJson) : [], txRows: txJson ? JSON.parse(txJson) : null, entrySlider: url.searchParams.get('e') };
}
// WIDGET_ENTRY, with the settings and colour of its copy in the link when the
// link has one, else at the library's defaults; js/widget-page.js picks the
// same. A library copy runs the current library code, as the site does for a
// shared copy (withCurrentCustomCode).
function pickStrategy(cfgs) {
  // An unedited library strategy arrives by its number (`lib`, the site's
  // sharedConfigOf), an edited one with its code.
  const customs = (Array.isArray(cfgs) ? cfgs : [])
    .map(c => (c && c.type === 'custom' && c.lib != null && LIB[c.lib] ? { ...c, code: LIB[c.lib] } : c))
    .filter(c => c && c.type === 'custom' && c.code);
  const cfg = customs.find(c => LIB.libraryEntryOf(c.code) === WIDGET_ENTRY);
  if (!cfg) return { name: null, color: '#e879f9', params: {}, code: LIB[WIDGET_ENTRY], fromLink: false };
  return { name: cfg.name || null, color: cfg.color || '#e879f9', params: cfg.params || {}, code: LIB[WIDGET_ENTRY], fromLink: true };
}

// ---- small helpers ------------------------------------------------------------
const round = (v, d = 2) => (Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : null);
const monthsBefore = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() - n); return d.toISOString().slice(0, 10); };
// "10/21/2026 09:30:00" → { date: '2026-10-21', minute: 0 } (minutes after 09:30).
function intradayStamp(s) {
  const [d, t] = s.trim().split(' ');
  const [m, day, y] = d.split('/');
  const [hh, mm] = t.split(':').map(Number);
  return { date: `${y}-${m.padStart(2, '0')}-${day.padStart(2, '0')}`, minute: hh * 60 + mm - (9 * 60 + 30), time: t.slice(0, 5) };
}

// ---- the three panels -----------------------------------------------------------
function portfolioPanel(log, money) {
  if (!money.fromTransactions) return null;
  const last = log[log.length - 1], prev = log[log.length - 2];
  const from = monthsBefore(last.date, SIGNAL_MONTHS);
  const dayChange = prev ? last.value - prev.value - (+last.contributed || 0) : null;
  const actual = money.actualPoints.length ? money.actualPoints[money.actualPoints.length - 1] : null;
  return {
    entryDate: money.entryDate, asOf: last.date, holding: last.held,
    value: round(last.value), invested: round(last.invested),
    gain: round(last.value - last.invested), gainPct: round((last.value / last.invested - 1) * 100),
    dayChange: round(dayChange), dayChangePct: prev ? round(dayChange / prev.value * 100) : null,
    series: log.filter(r => r.date >= from).map(r => [r.date, round(r.value)]),
    actual: actual ? { date: actual.date, value: round(actual.value) } : null,
  };
}
function intradayPanel(text, data) {
  const rows = text.trim().split(/\r?\n/);
  const cols = rows[0].split('\t');
  const at = name => cols.indexOf(name);
  if (at('Date') < 0 || at('Close') < 0) throw new Error('intraday file has no Date/Close columns');
  const bars = rows.slice(1).map(l => l.split('\t')).map(c => ({ ...intradayStamp(c[at('Date')]), close: +c[at('Close')] })).filter(b => b.close > 0);
  if (!bars.length) return null;
  const date = bars[bars.length - 1].date;
  const day = bars.filter(b => b.date === date);
  // The previous session's close: the last daily close before the bars' date.
  let i = data.dates.length - 1;
  while (i > 0 && data.dates[i] >= date) i--;
  const prevClose = data.tqqq[i], last = day[day.length - 1].close;
  const todayInNewYork = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
  return {
    date, isToday: date === todayInNewYork, prevClose: round(prevClose), last: round(last), change: round(last - prevClose), changePct: round((last / prevClose - 1) * 100),
    high: round(Math.max(...day.map(b => b.close))), low: round(Math.min(...day.map(b => b.close))), lastTime: day[day.length - 1].time,
    points: day.map(b => [b.minute, round(b.close, 3)]),
  };
}
function signalPanel(ctx, res, log, strat, closesNeeded) {
  const last = log[log.length - 1];
  const from = monthsBefore(last.date, SIGNAL_MONTHS);
  const at = log.findIndex(r => r.date >= from);
  const win = log.slice(at);
  const cfgLike = { color: strat.color };
  const lines = (res.lines || []).map((ln, i) => ({ key: ln.key, label: ln.label, color: ctx.customLineColor(cfgLike, i),
    values: win.map(r => (Number.isFinite(r[ln.key]) && r[ln.key] > 0 ? round(r[ln.key], 3) : null)),
    last: Number.isFinite(last[ln.key]) && last[ln.key] > 0 ? round(last[ln.key]) : null }));
  const style = vm.runInContext('CUSTOM_EVENT_STYLE', ctx);
  const trades = [];
  win.forEach((r, k) => {
    const kind = ctx.customActionKind(r.action);
    if (!style[kind]) return;
    trades.push({ i: k, date: r.date, kind, color: style[kind].color, held: r.held, note: r.note || '',
      part: kind === 'buy' ? ctx.customTradeShare(log, at + k) : null });
  });
  return {
    dates: win.map(r => r.date), lines, trades,
    price: round(last.assetPrice), band: last.zone || null, holding: last.held,
    closes: Number.isFinite(last.closesAbove) ? { count: last.closesAbove, needed: closesNeeded } : null,
    slice: last.slice || null,
    lastTrade: (() => { for (let j = log.length - 1; j >= 0; j--) if (style[ctx.customActionKind(log[j].action)]) return { date: log[j].date, note: log[j].note || '' }; return null; })(),
  };
}

// ---- main ------------------------------------------------------------------------
async function main() {
  const configPath = process.argv[2];
  if (!configPath) throw new Error('usage: widget-data.cjs <config.json>');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const site = String(config.siteUrl || 'https://tqqq.networthcast.com').replace(/\/+$/, '');
  const warnings = [];
  const get = f => fetchCached(`${site}/data/${f}`, warnings);
  const ctx = siteContext(), HL_FUNDS = vm.runInContext('HIGH_LOW_FUNDS', ctx);
  const [priceTexts, nfciText, intradayText, updatedText, highLowTexts] = await Promise.all([
    Promise.all(PRICE_FILES.map(([, f]) => get(f))), get('nfci.tsv'), get('intraday/tqqq-today-1m.tsv'), get('last-updated.txt'),
    Promise.all(HL_FUNDS.map(f => get(f + '-hl.tsv'))),
  ]);

  ctx.__series = priceTexts.map(t => ctx.parseDataFile(t));
  ctx.__nfci = ctx.parseDataFile(nfciText);
  ctx.__highLow = Object.fromEntries(HL_FUNDS.map((f, k) => [f, ctx.parseHighLowFile(highLowTexts[k])]));
  // The same globals js/init.js fills on page load.
  vm.runInContext(`daily = buildDaily(...__series);
    nfciDaily = buildNfciDaily(daily, __nfci);
    highLowDaily = buildHighLowDaily(daily, __highLow);
    dailyDateToIdx = new Map(daily.map((d, i) => [d.date, i]));`, ctx);
  const data = vm.runInContext('buildCustomData()', ctx);
  const lastIdx = data.dates.length - 1;

  // Money in: your transaction history from the link, else the site's default
  // entry (the first quarter ending in 2010, or the link's entry slider) with
  // $10,000 and no deposits, which drives the signal panels only.
  const link = readShareLink(config.shareLink);
  const strat = pickStrategy(link.cfgs);
  let money;
  if (Array.isArray(link.txRows) && link.txRows.length) {
    const state = ctx._txStateFromRows(link.txRows, 'upload');
    money = { fromTransactions: true, initial: state.initial, entryDate: state.entryDate, contributions: Object.fromEntries(state.schedule.byDate), actualPoints: state.actualPoints || [] };
  } else {
    const quarters = vm.runInContext('lastOfPeriod(daily, getQuarter).map(d => d.date)', ctx);
    const slider = link.entrySlider != null && quarters[+link.entrySlider] ? +link.entrySlider : quarters.findIndex(d => d >= '2010-01-01');
    money = { fromTransactions: false, initial: 10000, entryDate: quarters[slider], contributions: {}, actualPoints: [] };
  }
  const entryIdx = vm.runInContext(`dailyDateToIdx.get(${JSON.stringify(money.entryDate)})`, ctx);
  if (entryIdx == null) throw new Error(`entry date ${money.entryDate} is not a trading day in the data`);

  ctx.__code = strat.code;
  const mod = vm.runInContext('evalMod(__code)', ctx);
  const p = { initial: money.initial, monthly: 0, annualRaise: 0, contributions: money.contributions,
    startIdx: entryIdx, endIdx: lastIdx, entryDate: data.dates[entryIdx], exitDate: data.dates[lastIdx], dailyDisplay: true };
  for (const sp of mod.params || []) if (sp && sp.id != null) p[sp.id] = ctx.coerceCustomVal(sp, sp.id in strat.params ? strat.params[sp.id] : sp.default);
  const res = mod.run(data, p);
  const log = Array.isArray(res) ? res : res.log;
  if (!Array.isArray(log) || log.length < 2) throw new Error('the strategy returned no log');

  return {
    generated: new Date().toISOString(), dataUpdated: updatedText.trim(), warnings,
    strategy: { name: strat.name || mod.name, color: strat.color, fromLink: strat.fromLink },
    portfolio: portfolioPanel(log, money),
    portfolioMissing: money.fromTransactions ? null : (config.shareLink ? 'Your share link has no transaction history. Load it on the site, then copy the Share link again.' : 'Paste your Share link into config.json to see your portfolio.'),
    intraday: intradayPanel(intradayText, data),
    signal: signalPanel(ctx, res, log, strat, p.confirmDays || null),
  };
}

main().then(out => process.stdout.write(JSON.stringify(out)))
  .catch(err => process.stdout.write(JSON.stringify({ error: err && err.message ? err.message : String(err) })));
