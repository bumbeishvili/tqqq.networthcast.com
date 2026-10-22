// js/widget-page.js — the desktop widget page (widget.html): your portfolio as
// your strategy runs it on your own deposits, TQQQ's intraday chart, and the
// strategy's signal chart, all drawn by the site's own code. The strategy and
// the deposits arrive in the URL fragment exactly as a Share link carries them
// (scz / txz, see SHARE_FRAGMENT_PARAMS in js/controls.js), so they never reach
// a server. The Übersicht widget in widget/tqqq.widget frames this page.
(function widgetPage() {
  const REFRESH_MS = 15 * 60 * 1000;          // the data files change about once an hour in market hours
  const FALLBACK_ENTRY = 45;                   // library strategy shown when the link carries no custom one
  const DEFAULT_COLOR = '#e879f9';             // a library copy's colour when the link gives none
  const SUB_SHOWN_KEY = 'tqqq-widget-sub-shown';   // which signal lines are hidden, per viewer
  const $ = id => document.getElementById(id);
  const hasLink = /(?:^|[#&])(?:scz|sc|txz|tx)=/.test(location.hash) || /[?&](?:scz|sc|txz|tx)=/.test(location.search);

  // A share link's payloads: the fragment first, then the query, as js/init.js reads them.
  const fragment = new URLSearchParams(location.hash.replace(/^#/, ''));
  const query = new URLSearchParams(location.search);
  const param = k => (fragment.has(k) ? fragment.get(k) : query.get(k));
  async function payload(packedKey, plainKey) {
    const packed = param(packedKey), plain = param(plainKey);
    const json = packed ? await unpackSharePayload(packed) : plain ? decodeURIComponent(plain) : null;
    return json ? JSON.parse(json) : null;
  }

  let cfg = null, lines = [], log = [];

  // ---- market data: the same files and derived globals js/init.js sets up ----
  async function loadMarketData() {
    const [qqq, tqqq, spy, qld, sso, spxl, sqqq, nfci] = await Promise.all([
      loadQQQDaily(), loadTQQQDaily(), loadSPYDaily(), loadQLDDaily(), loadSSODaily(), loadSPXLDaily(),
      loadSQQQDaily().catch(() => []), loadNFCIWeekly().catch(() => []),
    ]);
    daily = buildDaily(qqq, tqqq, spy, qld, sso, spxl, sqqq);
    nfciDaily = buildNfciDaily(daily, nfci);
    quarterlyData = lastOfPeriod(daily, getQuarter).map(d => [d.date, d.tqqq, d.qqq, d.spy, d.qld, d.sso, d.spxl, d.sqqq]);
    monthlyData = lastOfPeriod(daily, getMonth).map(d => [d.date, d.tqqq, d.qqq, d.spy, d.qld, d.sso, d.spxl, d.sqqq]);
    dailyDateToIdx = new Map(daily.map((d, i) => [d.date, i]));
    // A refresh brings new rows: the worker gets the rebuilt data on its next job.
    _customDataCache = null;
    _customDataSent = false;
  }
  async function loadStamp() {
    const res = await fetch('data/last-updated.txt', { cache: 'no-store' });
    if (!res.ok) return '';
    const t = new Date((await res.text()).trim());
    if (Number.isNaN(t.getTime())) return '';
    const pad = n => String(n).padStart(2, '0');
    return `Updated ${t.getDate()} ${_LOG_MONTHS[t.getMonth()]} ${t.getFullYear()}, ${pad(t.getHours())}:${pad(t.getMinutes())}`;
  }

  // ---- the strategy: the buy-back copy in the link, else its first custom
  // strategy, else the library's. A library copy runs the current library code,
  // as the site does for a shared copy (withCurrentCustomCode).
  function readSubShown() { try { return JSON.parse(localStorage.getItem(SUB_SHOWN_KEY)) || {}; } catch (e) { return {}; } }
  function pickStrategy(cfgs) {
    const customs = (Array.isArray(cfgs) ? cfgs : []).filter(c => c && c.type === 'custom' && c.code);
    const shared = customs.find(c => libraryEntryOf(c.code) === FALLBACK_ENTRY) || customs[0];
    const base = shared ? withCurrentCustomCode([shared])[0]
      : { type: 'custom', name: null, params: {}, color: DEFAULT_COLOR, code: STRATEGY_CODE[FALLBACK_ENTRY] };
    return { ...base, id: 'widget-strategy', color: base.color || DEFAULT_COLOR, subShown: readSubShown() };
  }
  // The money the strategy runs on: your transaction history from the link
  // (first deposit to today), else the site's default range with its $10,000.
  function moneyContext(txRows) {
    const last = daily[daily.length - 1].date;
    if (Array.isArray(txRows) && txRows.length) {
      const state = _txStateFromRows(txRows, 'upload');
      return { fromTransactions: true, ctx: { initial: state.initial, monthly: 0, annualRaise: 0, entryDateOverride: state.entryDate, exitDateOverride: last, contribSchedule: state.schedule }, actualPoints: state.actualPoints || [] };
    }
    const linked = param('e');
    const qi = linked != null && quarterlyData[+linked] ? +linked : Math.max(0, quarterlyData.findIndex(r => r[0] >= '2010-01-01'));
    return { fromTransactions: false, ctx: { initial: 10000, monthly: 0, annualRaise: 0, entryDateOverride: quarterlyData[qi][0], exitDateOverride: last, contribSchedule: null }, actualPoints: [] };
  }
  // One run in the site's sandboxed worker, logging every day (p.dailyDisplay).
  function runStrategy(globals) {
    return new Promise((resolve, reject) => postCustomJob(cfg, cfg.params || {}, { ...globals, dailyDisplay: true }, (msg, err) => {
      if (err || !msg) reject(new Error(err === 'timeout' ? 'The strategy took too long to run.' : String(err || 'The strategy did not run.')));
      else resolve(msg);
    }));
  }

  // ---- drawing ----
  const fullDate = iso => { const [y, m, d] = iso.split('-'); return `${+d} ${_LOG_MONTHS[+m - 1]} ${y}`; };
  const signedMoney = v => (v >= 0 ? '+' : '−') + fmtFull(Math.abs(v));
  const signedPct = v => { const a = Math.abs(v); return (v >= 0 ? '+' : '−') + (a >= 100 ? Math.round(a).toLocaleString('en-US') : a.toFixed(1)) + '%'; };
  const toneClass = v => (v >= 0 ? 'positive' : 'negative');
  function portfolioHtml(money) {
    if (!money.fromTransactions) {
      return `<div class="wp-note">${hasLink ? 'This share link has no transaction history. Load yours on the site, then copy the Share link again.' : 'Add your Share link to the widget’s config.json to see your portfolio.'}</div>`;
    }
    const last = log[log.length - 1], prev = log[log.length - 2];
    const today = prev ? last.value - prev.value - (+last.contributed || 0) : 0;
    const gain = last.value - last.invested;
    const actual = money.actualPoints.length ? money.actualPoints[money.actualPoints.length - 1] : null;
    return `<div class="custom-stats">
        <div class="custom-stat"><span>Value</span><b>${fmtFull(last.value)}</b></div>
        <div class="custom-stat"><span>Today</span><b class="${toneClass(today)}">${signedMoney(today)} (${signedPct(prev ? today / prev.value * 100 : 0)})</b></div>
        <div class="custom-stat"><span>Since ${fullDate(money.ctx.entryDateOverride)}</span><b class="${toneClass(gain)}">${signedMoney(gain)} (${signedPct(gain / last.invested * 100)})</b></div>
      </div>
      <div class="wp-note">${fmtFull(last.invested)} invested · holding ${_escHtml(String(last.held || ''))}${actual ? ` · last recorded ${fmtFull(actual.value)} on ${fullDate(actual.date)}` : ''}</div>`;
  }
  // The chart's host hook (js/signal-chart.js): redraw just the svg from the
  // current rows, width and zoom, as the strategy panel does.
  function redrawSignalChart() {
    const host = $('wp-signal');
    if (!host || !host.clientWidth || !cfg || !lines.length) return;
    const html = buildCustomLinesChartHtml(cfg, lines, log, host.clientWidth);
    if (!html) return;
    const svg = host.querySelector('.custom-lines-chart');
    if (!svg) { host.innerHTML = html; return; }
    const tpl = document.createElement('div');
    tpl.innerHTML = html;
    svg.replaceWith(tpl.firstElementChild);
  }
  function drawChips() { $('wp-chips').innerHTML = buildCustomLineChipsHtml(cfg, lines); }
  // The page's height for the Übersicht widget, which sizes its frame to it.
  // Measured from the card: a framed document is never shorter than its frame.
  function reportSize() {
    if (window.parent === window) return;
    const bottomPad = parseFloat(getComputedStyle(document.body).paddingBottom) || 0;
    window.parent.postMessage({ type: 'tqqq-widget-size', height: Math.ceil($('wp-card').getBoundingClientRect().bottom + bottomPad) }, '*');
  }
  function showError(message) {
    const el = $('wp-error');
    el.textContent = message;
    el.hidden = !message;
    reportSize();
  }

  // Line chips toggle the lines here the way they do in the strategy panel,
  // remembered per viewer (js/saved-configs.js's handler only knows saved strategies).
  document.addEventListener('click', e => {
    const chip = e.target && e.target.closest && e.target.closest('.cfg-sub-chip');
    if (!chip || !cfg || chip.getAttribute('data-config-id') !== cfg.id) return;
    const key = chip.getAttribute('data-config-sub');
    cfg.subShown = { ...(cfg.subShown || {}), [key]: chip.classList.contains('legend-hidden') };
    try { localStorage.setItem(SUB_SHOWN_KEY, JSON.stringify(cfg.subShown)); } catch (err) { /* storage unavailable: the toggle lasts for this view */ }
    drawChips();
    redrawSignalChart();
  });
  setMiniChartHost(redrawSignalChart);
  if (_miniChartResizeObs) _miniChartResizeObs.observe($('wp-signal'));
  window.addEventListener('resize', reportSize);
  $('wp-intraday').addEventListener('load', reportSize);

  let cfgs = null, txRows = null;
  async function refresh() {
    try {
      await loadMarketData();
      if (!cfg) {
        [cfgs, txRows] = await Promise.all([payload('scz', 'sc'), payload('txz', 'tx')]);
        cfg = pickStrategy(cfgs);
      }
      const money = moneyContext(txRows);
      const [msg, stamp] = await Promise.all([runStrategy(computeCustomGlobals(cfg, money.ctx)), loadStamp()]);
      if (!Array.isArray(msg.log) || msg.log.length < 2) throw new Error('The strategy returned no rows.');
      log = msg.log;
      lines = Array.isArray(msg.lines) ? msg.lines : [];
      $('wp-title').textContent = cfg.name || msg.name || 'TQQQ';
      $('wp-stamp').textContent = stamp;
      $('wp-portfolio').innerHTML = portfolioHtml(money);
      drawChips();
      redrawSignalChart();
      showError('');
    } catch (err) {
      showError(err && err.message ? err.message : String(err));
    }
    reportSize();
  }
  refresh();
  setInterval(refresh, REFRESH_MS);
})();
