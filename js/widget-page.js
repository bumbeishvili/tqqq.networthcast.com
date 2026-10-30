// js/widget-page.js — the desktop widget page (widget.html): three charts and
// nothing else. Across the top, your portfolio from your transaction sheet,
// what you have put in and the profit; below it, TQQQ intraday and the strategy's
// signal chart, side by side at one height. All three are the site's own
// charts (js/signal-chart.js and the intraday page), interactions included.
//
// The strategy and the deposits arrive in the URL fragment exactly as a Share
// link carries them (scz / txz, see SHARE_FRAGMENT_PARAMS in js/controls.js),
// so they never reach a server. A live sheet can stand in for the deposits:
// #sheet=<published CSV link>&date=<column>&amount=<column>&value=<column>,
// the columns named as in the sheet's header row; the browser reads it from
// Google directly on every refresh. The intraday chart's settings ride along
// as similar=1|0, from=YYYY-MM-DD and log=1|0. The Übersicht widget in
// widget/tqqq.widget frames this page.
(function widgetPage() {
  const REFRESH_MS = 5 * 60 * 1000;           // re-reads the sheet and the market data; the data files change hourly
  const WIDGET_ENTRY = 50;                     // the strategy the widget tracks: TQQQ vs QQQ + Turnaround Monday
  const DEFAULT_COLOR = '#e879f9';             // a library copy's colour when the link gives none
  const PORTFOLIO_PX = 190;                    // height of the top chart
  const BOTTOM_PX = 240;                       // height of the signal chart
  const INTRADAY_AXIS_PX = 20;                 // the intraday page's room under its plot (its embed marginBottom)
  const DEFAULT_START_MONEY = 10000;           // the site's default starting amount
  // Lines the signal chart leaves out, by the strategy's line key: the
  // buy-back strategy's center line, its 250-day median at the defaults.
  const HIDDEN_SIGNAL_LINES = ['medianPrice'];
  // The top chart's three lines wear the main chart's colours for the same
  // lines (js/saved-configs.js's TX_ACTUAL_COLOR / TX_INVESTED_COLOR /
  // TX_PROFIT_COLOR): teal, slate and the palette's purple (js/signal-chart.js's
  // CUSTOM_MINI_COLORS; its turn in the palette would be red, which reads as a
  // loss). By colorSeparation every pair is at least 25 apart as seen and 16
  // in the worst colour-blind view; the indigo Invested had before sat 18 and
  // 9 from the purple, and looked alike.
  // The signal chart's line names drop a trailing percent setting:
  // "Sell line (-3%)" reads "Sell line" in the widget.
  const PERCENT_SETTING = /\s*\([^)]*%\)\s*$/;
  // Shorter names for the narrow label column, which stacks a name's words:
  // "Overextended" reads "Over" over "extend" (the user's wording). TQQQ vs
  // QQQ + Turnaround Monday has eleven labels in four panels, so its long
  // names go to one or two words each; the panel titles say what they are of.
  const DISPLAY_NAMES = { Overextended: 'Over extend', 'TQQQ vs prior close': 'Day', "Prior day's high": 'High',
    "Prior day's low": 'Low', 'TQQQ ahead of QQQ': 'Lead', 'Credit veto': 'Veto' };
  const displayName = label => {
    const name = String(label).replace(PERCENT_SETTING, '');
    return DISPLAY_NAMES[name] || name;
  };
  // The top chart wears the main chart's "My portfolio" colour.
  const PORTFOLIO = { id: 'widget-portfolio', color: TX_ACTUAL_COLOR };
  const $ = id => document.getElementById(id);
  // A colour from styles.css's tokens.
  const tokenColor = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  // A share link's payloads: the fragment first, then the query, as js/init.js reads them.
  const fragment = new URLSearchParams(location.hash.replace(/^#/, ''));
  const query = new URLSearchParams(location.search);
  // Filling the screen (the widget's fillScreen, fill=1): the card takes the
  // whole frame, its two rows split the height in the fixed layout's
  // proportions, and each chart is as tall as its tile.
  const FILL = fragment.get('fill') === '1';
  const chartPx = (host, fixedPx) => (FILL ? host.clientHeight : fixedPx);
  const param = k => (fragment.has(k) ? fragment.get(k) : query.get(k));
  async function payload(packedKey, plainKey) {
    const packed = param(packedKey), plain = param(plainKey);
    const json = packed ? await unpackSharePayload(packed) : plain ? decodeURIComponent(plain) : null;
    return json ? JSON.parse(json) : null;
  }

  // The live sheet, read with the site's own parser (js/transactions.js) and
  // the columns the widget names. A named column the sheet lacks is an error,
  // not a guess.
  const sheet = fragment.get('sheet') ? { url: fragment.get('sheet'), date: fragment.get('date'), amount: fragment.get('amount'), value: fragment.get('value') } : null;
  async function sheetRows(spec) {
    if (!spec.date || !spec.amount) throw new Error('The widget names a sheet but not its date and amount columns.');
    const res = await fetch(spec.url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`The sheet could not be loaded (HTTP ${res.status}).`);
    const text = await res.text();
    const { headers } = _txParseRaw(text);
    const column = (name, role) => {
      const i = headers ? headers.findIndex(h => h.trim().toLowerCase() === String(name).trim().toLowerCase()) : -1;
      if (i < 0) throw new Error(`The sheet has no "${name}" column for the ${role}.`);
      return i;
    };
    const parsed = _txParseWithCols(text, column(spec.date, 'date'), column(spec.amount, 'amount'), spec.value ? column(spec.value, 'portfolio value') : null);
    if (!parsed.rows.length) throw new Error('The sheet has no rows with both a date and an amount.');
    return parsed.rows;
  }

  // ---- market data: the same files and derived globals js/init.js sets up ----
  async function loadMarketData() {
    const [qqq, tqqq, spy, qld, sso, spxl, sqqq, nfci, highLow] = await Promise.all([
      loadQQQDaily(), loadTQQQDaily(), loadSPYDaily(), loadQLDDaily(), loadSSODaily(), loadSPXLDaily(),
      loadSQQQDaily().catch(() => []), loadNFCIWeekly().catch(() => []), Promise.all(HIGH_LOW_FUNDS.map(loadHighLow)),
    ]);
    daily = buildDaily(qqq, tqqq, spy, qld, sso, spxl, sqqq);
    nfciDaily = buildNfciDaily(daily, nfci);
    highLowDaily = buildHighLowDaily(daily, Object.fromEntries(HIGH_LOW_FUNDS.map((f, k) => [f, highLow[k]])));
    quarterlyData = lastOfPeriod(daily, getQuarter).map(d => [d.date, d.tqqq, d.qqq, d.spy, d.qld, d.sso, d.spxl, d.sqqq]);
    monthlyData = lastOfPeriod(daily, getMonth).map(d => [d.date, d.tqqq, d.qqq, d.spy, d.qld, d.sso, d.spxl, d.sqqq]);
    dailyDateToIdx = new Map(daily.map((d, i) => [d.date, i]));
    // A refresh brings new rows: the worker gets the rebuilt data on its next job.
    _customDataCache = null;
    _customDataSent = false;
  }

  // ---- the strategy: WIDGET_ENTRY, with the settings and colour of its copy in
  // the link when the link has one (the user, 2026-10-30: "make sure widget
  // tracks the new strategy"). Other strategies in the link are not shown. A
  // library copy runs the current library code, as the site does for a shared
  // copy (withCurrentCustomCode).
  function pickStrategy(cfgs) {
    const customs = (Array.isArray(cfgs) ? cfgs : []).filter(c => c && c.type === 'custom' && c.code);
    const shared = customs.find(c => libraryEntryOf(c.code) === WIDGET_ENTRY);
    const base = shared ? withCurrentCustomCode([shared])[0]
      : { type: 'custom', name: null, params: {}, color: DEFAULT_COLOR, code: STRATEGY_CODE[WIDGET_ENTRY] };
    return { ...base, id: 'widget-strategy', color: base.color || DEFAULT_COLOR, subShown: Object.fromEntries(HIDDEN_SIGNAL_LINES.map(key => [key, false])) };
  }
  // The site's default money: its $10,000 from the given day to today.
  function defaultMoney(entryDate) {
    return { initial: DEFAULT_START_MONEY, monthly: 0, annualRaise: 0, entryDateOverride: entryDate, exitDateOverride: daily[daily.length - 1].date, contribSchedule: null };
  }
  // The money the strategy runs on: your transaction history (first deposit to
  // today), else the site's default range with its $10,000.
  function moneyContext(txRows) {
    if (Array.isArray(txRows) && txRows.length) {
      const state = _txStateFromRows(txRows, 'upload');
      return { fromTransactions: true, ctx: { initial: state.initial, monthly: 0, annualRaise: 0, entryDateOverride: state.entryDate, exitDateOverride: daily[daily.length - 1].date, contribSchedule: state.schedule }, actualPoints: state.actualPoints || [] };
    }
    const linked = param('e');
    const qi = linked != null && quarterlyData[+linked] ? +linked : Math.max(0, quarterlyData.findIndex(r => r[0] >= '2010-01-01'));
    return { fromTransactions: false, ctx: defaultMoney(quarterlyData[qi][0]), actualPoints: [] };
  }
  // One run in the site's sandboxed worker, logging every day (p.dailyDisplay).
  function runStrategy(globals) {
    return new Promise((resolve, reject) => postCustomJob(cfg, cfg.params || {}, { ...globals, dailyDisplay: true }, (msg, err) => {
      if (err || !msg) reject(new Error(err === 'timeout' ? 'The strategy took too long to run.' : String(err || 'The strategy did not run.')));
      else resolve(msg);
    }));
  }
  // The top line's change over the latest session, a percent after its value,
  // unlabelled like the main chart's day-change badges. Your sheet records no
  // positions, so the move is the strategy's: its value from the previous
  // session's close to the latest, less that session's deposit (the log's
  // contributed). Applied to the line's latest value, it is your account's
  // move if it holds what the strategy holds. A log that is not daily at its
  // end has no session move: no badge.
  function sessionBadge(latestValue) {
    const last = log[log.length - 1], prev = log[log.length - 2];
    const session = daily[daily.length - 1].date;
    if (last.date !== session || prev.date !== daily[daily.length - 2].date) return null;
    if (typeof last.contributed !== 'number' || !(prev.value > 0)) return null;
    const ratio = (last.value - last.contributed) / prev.value;
    const change = computeDayChange(latestValue, latestValue / ratio);
    if (!change) return null;
    return { text: fmtDayChangePct(change), color: tokenColor(change.pct >= 0 ? '--green-text' : '--red-text') };
  }
  // The top chart: every reading of your portfolio's value, what you had put
  // in by that day, and the profit between the two. Without readings (a
  // history with no value column) it shows the strategy run on your deposits
  // instead.
  function portfolioSeries(money, txRows) {
    const chart = (valueKey, valueLabel, rows) => ({
      lines: [
        { key: valueKey, label: valueLabel, badge: sessionBadge(rows[rows.length - 1][valueKey]) },
        { key: 'invested', label: 'Invested', color: TX_INVESTED_COLOR },
        { key: 'profit', label: 'Profit', color: TX_PROFIT_COLOR },
      ],
      rows,
    });
    if (money.actualPoints.length >= 2) {
      const flows = [...txRows].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
      let next = 0, invested = 0;
      const rows = money.actualPoints.map(p => {
        while (next < flows.length && flows[next].date <= p.date) invested += flows[next++].amount;
        return { date: p.date, actual: p.value, invested, profit: p.value - invested };
      });
      return chart('actual', 'Portfolio', rows);
    }
    if (money.fromTransactions) return chart('value', 'Strategy on your deposits', log.map(r => ({ ...r, profit: r.value - r.invested })));
    return { lines: [], rows: [] };
  }

  // ---- drawing ----
  // Two runs of the strategy per refresh. `log` is yours, on your money from
  // your first deposit: the day's change and the top line without a value
  // column. `signalLog` covers the whole history in the data on the site's
  // default money: the signal chart, so how far back it reaches never depends
  // on your sheet. That chart rests on your period (its home view) and zooms
  // and pans across the whole history.
  let cfg = null, lines = [], log = [], signalLog = [], portfolio = { lines: [], rows: [] };
  // Every chart's text is sized as on the signal chart, the narrowest of them.
  // `view` adds the chart's own options: a linear scale, a home view.
  function chartHtml(chartCfg, chartLines, rows, host, heightPx, view) {
    const width = host.clientWidth;
    return width && chartLines.length ? buildCustomLinesChartHtml(chartCfg, chartLines, rows, width, { aspect: heightPx / width, textWidth: $('wp-signal').clientWidth || width, compact: true, ...view }) : '';
  }
  // The intraday page draws at its own type size and is scaled up like the
  // signal chart's text (the square root of the chart's width over
  // MINI_TEXT_REF_W, js/signal-chart.js), so on a wide screen the two read at
  // one size. Its frame is drawn at the box's size over that scale and
  // transformed up to fill the box.
  function intradayScale() {
    return Math.sqrt(Math.max(1, $('wp-signal').clientWidth / MINI_TEXT_REF_W));
  }
  function sizeIntraday(visualPx) {
    const s = intradayScale(), box = $('wp-intraday-box'), frame = $('wp-intraday');
    box.style.height = Math.round(visualPx) + 'px';
    frame.style.width = (box.clientWidth / s) + 'px';
    frame.style.height = (visualPx / s) + 'px';
    frame.style.transform = `scale(${s})`;
  }
  // The intraday frame ends where the signal chart's plot ends plus the room
  // the intraday page keeps under its own plot (scaled with it), so the two
  // plots end level.
  function alignIntraday() {
    const svg = $('wp-signal').querySelector('.custom-lines-chart');
    const d = svg && window._miniCharts[svg.getAttribute('data-mini-id')];
    if (!d) return;
    const scale = svg.getBoundingClientRect().height / d.H;
    sizeIntraday((d.H - d.padB) * scale + INTRADAY_AXIS_PX * intradayScale());
  }
  // Swap in just the svg, as the strategy panel does, so the page never jumps.
  function place(host, html) {
    const svg = host.querySelector('.custom-lines-chart');
    if (!html || !svg) { host.innerHTML = html; return; }
    const tpl = document.createElement('div');
    tpl.innerHTML = html;
    svg.replaceWith(tpl.firstElementChild);
  }
  // The charts' host hook (js/signal-chart.js): redraw one chart by id, or both.
  function redraw(id) {
    if (!id || id === PORTFOLIO.id) {
      place($('wp-portfolio'), portfolio.lines.length ? chartHtml(PORTFOLIO, portfolio.lines, portfolio.rows, $('wp-portfolio'), chartPx($('wp-portfolio'), PORTFOLIO_PX), { scale: 'linear' })
        : '<div class="wp-note">Add your sheet to the widget’s config.json to see your portfolio here.</div>');
    }
    // The signal chart draws once its run is in; a resize can come first.
    if (cfg && signalLog.length && (!id || id === cfg.id)) {
      const home = { t0: Date.parse(log[0].date), t1: Date.parse(signalLog[signalLog.length - 1].date) };
      place($('wp-signal'), chartHtml(cfg, lines, signalLog, $('wp-signal'), chartPx($('wp-signal'), BOTTOM_PX), { home }));
      alignIntraday();
    }
  }
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

  // Übersicht passes the mouse to a widget only after its own page sees the
  // pointer move over that widget, and moves inside a frame never reach the
  // page around it. Left alone, only hover works here, and clicks, drags and
  // scrolls land on the desktop behind the widget. So every move in this page,
  // and in the intraday frame inside it, is passed to the page around it as a
  // move over the frame. The pass happens inside the move's own handler, so a
  // pointer that has left is never reported inside afterwards. A page from
  // another site than Übersicht's cannot reach its host (frameElement is null
  // there), so this works only in the local copy the widget shows by default.
  function relayPointerMoves(win, frameEl) {
    const View = frameEl.ownerDocument.defaultView;
    win.addEventListener('mousemove', e => {
      // A scaled frame (the intraday one) maps its pixels to the page's by its scale.
      const box = frameEl.getBoundingClientRect();
      const sx = frameEl.offsetWidth ? box.width / frameEl.offsetWidth : 1, sy = frameEl.offsetHeight ? box.height / frameEl.offsetHeight : 1;
      frameEl.dispatchEvent(new View.MouseEvent('mousemove', {
        bubbles: true, view: View,
        clientX: box.left + (frameEl.clientLeft + e.clientX) * sx, clientY: box.top + (frameEl.clientTop + e.clientY) * sy,
        screenX: e.screenX, screenY: e.screenY, buttons: e.buttons,
        altKey: e.altKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey, shiftKey: e.shiftKey,
      }));
    });
  }

  if (FILL) {
    document.documentElement.classList.add('wp-fill');
    $('wp-top').style.flexGrow = PORTFOLIO_PX;
    $('wp-bottom').style.flexGrow = BOTTOM_PX;
  }
  setMiniChartHost(redraw);
  // The panel's range runs need the main chart's money settings, which this
  // page has none of: a dragged range here shows the lines' changes only.
  setMiniRangeSim(null);
  if (_miniChartResizeObs) { _miniChartResizeObs.observe($('wp-portfolio')); _miniChartResizeObs.observe($('wp-signal')); }
  window.addEventListener('resize', reportSize);
  if (window.frameElement) relayPointerMoves(window, window.frameElement);
  // The intraday page in its compact mode, as tall as the signal chart, with
  // the widget's settings for it.
  const intraday = new URLSearchParams({ embed: 'widget' });
  for (const key of ['similar', 'from', 'log']) if (fragment.get(key)) intraday.set(key, fragment.get(key));
  if (query.get('data')) intraday.set('data', query.get('data'));
  sizeIntraday(chartPx($('wp-signal'), BOTTOM_PX));
  $('wp-intraday').addEventListener('load', reportSize);
  $('wp-intraday').addEventListener('load', () => relayPointerMoves($('wp-intraday').contentWindow, $('wp-intraday')));
  $('wp-intraday').src = 'experiments/tqqq-intraday.html?' + intraday.toString();

  let cfgs = null, txRows = null;
  async function refresh() {
    try {
      await loadMarketData();
      if (!cfg) {
        [cfgs, txRows] = await Promise.all([payload('scz', 'sc'), sheet ? null : payload('txz', 'tx')]);
        cfg = pickStrategy(Array.isArray(cfgs) ? expandLibraryShares(cfgs) : cfgs);
      }
      if (sheet) txRows = await sheetRows(sheet);   // the sheet is re-read on every refresh
      const money = moneyContext(txRows);
      const [mine, history] = await Promise.all([
        runStrategy(computeCustomGlobals(cfg, money.ctx)),
        runStrategy(computeCustomGlobals(cfg, defaultMoney(daily[0].date))),
      ]);
      if ([mine, history].some(run => !Array.isArray(run.log) || run.log.length < 2)) throw new Error('The strategy returned no rows.');
      log = mine.log;
      signalLog = history.log;
      lines = Array.isArray(history.lines) ? history.lines.map(ln => ({ ...ln, label: displayName(ln.label) })) : [];
      portfolio = portfolioSeries(money, txRows || []);
      redraw();
      showError('');
    } catch (err) {
      showError(err && err.message ? err.message : String(err));
    }
    reportSize();
  }
  refresh();
  setInterval(refresh, REFRESH_MS);
})();
