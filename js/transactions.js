// js/transactions.js — real transaction-history import. Lets the user upload,
// paste, or link a live Google Sheet of their own (date, amount) contribution
// log and use it as the app's contribution schedule instead of the Initial
// Investment / Monthly Contribution formula — every strategy backtests
// against real money on real days instead of a smooth synthetic curve. See
// the plan this shipped from: entry date snaps to the first transaction,
// same shape as buildFormulaSchedule (js/simulate.js) so every consumer
// already wired for that shape (9sig/SMA/Buy & Hold/Invested Compounded/
// custom strategies) works with real data unchanged.

// ===== State ===============================================================
// The ACTIVE parsed history — every consumer (chart.js, saved-configs.js,
// preview-dropdown.js) reads this and treats it as "use real transactions"
// vs. "use the slider formula". null when the app is in slider mode.
//   { initial, entryDate, rows: [{date,amount}] (ALL, incl. the first),
//     schedule: {byDate,byMonth,list} (rows[1:] — the first row IS `initial`,
//     not a contribution), total, source: 'upload'|'sheet', sheetUrl }
window._txSchedule = null;
// The last-uploaded history, kept around even while switched OFF (i.e. even
// when _txSchedule is null) so "switch back to my transactions" doesn't
// require re-uploading/re-pasting. Same shape as _txSchedule. Both are set
// together on confirm; only _txSchedule gets nulled by the sliders toggle.
window._txScheduleStash = null;
const LS_TX_KEY = 'tqqq_transactions_v1';

function persistTransactions() {
  try {
    if (window._txScheduleStash) {
      localStorage.setItem(LS_TX_KEY, JSON.stringify({
        initial: window._txScheduleStash.initial,
        entryDate: window._txScheduleStash.entryDate,
        rows: window._txScheduleStash.rows,
        total: window._txScheduleStash.total,
        source: window._txScheduleStash.source,
        sheetUrl: window._txScheduleStash.sheetUrl || null,
        dateCol: window._txScheduleStash.dateCol,
        amountCol: window._txScheduleStash.amountCol,
        actualCol: window._txScheduleStash.actualCol,
        showActual: window._txScheduleStash.showActual !== false,
        active: !!window._txSchedule,
      }));
    } else {
      localStorage.removeItem(LS_TX_KEY);
    }
  } catch (e) {}
}
// Returns { state, active } — state is the parsed schedule (always restored
// into the stash so switching back works), active tells the caller whether
// it should also go live as _txSchedule. `active` defaults to true for
// records written before the switch feature existed (no `active` field).
function loadTransactionsFromStorage() {
  try {
    const raw = localStorage.getItem(LS_TX_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.rows) || !parsed.rows.length) return null;
    return {
      state: _txStateFromRows(parsed.rows, parsed.source || 'upload', parsed.sheetUrl || null, parsed.dateCol, parsed.amountCol, parsed.actualCol, parsed.showActual),
      active: parsed.active !== false,
    };
  } catch (e) { return null; }
}

// ===== Parsing ==============================================================

function _txSniffDelimiter(line) { return line.includes('\t') ? '\t' : ','; }

// Loose date parser: 'YYYY-MM-DD' first (the app's own format), then
// 'M/D/YYYY' (matches parseDataFile's vendor format, js/data.js), then a
// generic Date.parse fallback for anything else a spreadsheet export might
// produce. Returns 'YYYY-MM-DD' or null.
function _txParseDate(s) {
  s = String(s == null ? '' : s).trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return m[1] + '-' + m[2].padStart(2, '0') + '-' + m[3].padStart(2, '0');
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return m[3] + '-' + m[1].padStart(2, '0') + '-' + m[2].padStart(2, '0');
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) {
    return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
  }
  return null;
}

// '$1,234.56' / '(500)' / '-500' -> 1234.56 / -500 / -500. Null when nothing
// numeric survives.
function _txParseAmount(s) {
  s = String(s == null ? '' : s).trim();
  if (!s) return null;
  const neg = /^\(.*\)$/.test(s);
  const n = parseFloat(s.replace(/[()$,\s]/g, ''));
  if (!Number.isFinite(n)) return null;
  return neg ? -Math.abs(n) : n;
}

const _TX_AMOUNT_HEADER_RE = /transaction|amount|value|invested|contribution|deposit|cash/i;
const _TX_DATE_HEADER_RE = /date/i;
// The optional "actual portfolio value" column — a LEVEL (what the account is
// worth on that date), not a flow. Drawn as the "My portfolio" line so the
// user can compare what IS against what they contributed and what the
// strategies say could have been.
const _TX_ACTUAL_HEADER_RE = /total|balance|portfolio|net.?worth/i;

// Splits raw text into a table without deciding which column is which —
// parseTransactionText uses this plus _txAutoDetectCols/_txRowsFromCols below
// so the modal's column pickers can recompute rows from the same table when
// the user overrides the auto-detected columns, without re-splitting the text.
// Delimiter-splitting that respects double-quoted fields — Google Sheets
// quotes any cell whose formatted value contains the delimiter itself (e.g.
// a thousands-separated total exported as "95,565"), and a naive
// line.split(',') cuts straight through it (that exact cell parsed as 95).
// Doubled quotes inside a quoted field ("") unescape to one quote, per CSV.
function _txSplitLine(line, sep) {
  const out = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = false;
      } else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === sep) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out.map(c => c.trim());
}
function _txParseRaw(text) {
  const lines = String(text || '').split(/\r?\n/).map(l => l.trim()).filter(l => l.length);
  if (!lines.length) return { headers: null, dataRows: [] };
  const sep = _txSniffDelimiter(lines[0]);
  const split = (line) => _txSplitLine(line, sep);
  const first = split(lines[0]);
  // A header cell "looks like text" if it doesn't parse as either a date or
  // a number — a genuine data row's cells should parse as one or the other.
  const looksLikeHeader = first.some(c => _TX_DATE_HEADER_RE.test(c)) ||
    first.every(c => _txParseDate(c) == null && _txParseAmount(c) == null);
  return {
    headers: looksLikeHeader ? first : null,
    dataRows: (looksLikeHeader ? lines.slice(1) : lines).map(split),
  };
}

// Best-guess date/amount column indices. A header row with a column matching
// /date/i wins regardless of position; the amount column is the best keyword
// match, or (when that's ambiguous) whichever non-date column parses as a
// number on the most sample rows — covers sheets with extra columns
// (category, notes, running balance, …) that a fixed 0/1 guess gets wrong.
function _txAutoDetectCols(headers, dataRows) {
  const colCount = headers ? headers.length : ((dataRows[0] || []).length);
  let dateCol = 0, amountCol = 1;
  if (headers) {
    const dc = headers.findIndex(c => _TX_DATE_HEADER_RE.test(c));
    dateCol = dc === -1 ? 0 : dc;
    const amountCandidates = headers
      .map((c, i) => ({ i, c }))
      .filter(({ i, c }) => i !== dateCol && _TX_AMOUNT_HEADER_RE.test(c));
    amountCol = amountCandidates.length ? amountCandidates[0].i : _txBestNumericCol(dataRows, dateCol, colCount);
  } else if (colCount > 2) {
    amountCol = _txBestNumericCol(dataRows, dateCol, colCount);
  }
  if (amountCol === dateCol) amountCol = dateCol === 0 ? Math.min(1, colCount - 1) : 0;
  // Optional actual-portfolio-value column — headers only (a headerless
  // paste has no way to say which extra number is a running total; the
  // picker still lets the user choose one manually). null = feature off.
  let actualCol = null;
  if (headers) {
    const idx = headers.findIndex((c, i) => i !== dateCol && i !== amountCol && _TX_ACTUAL_HEADER_RE.test(c));
    if (idx !== -1) actualCol = idx;
  }
  return { dateCol, amountCol, actualCol };
}
function _txBestNumericCol(dataRows, dateCol, colCount) {
  let best = -1, bestScore = -1;
  for (let c = 0; c < colCount; c++) {
    if (c === dateCol) continue;
    let score = 0;
    for (let i = 0; i < Math.min(dataRows.length, 20); i++) {
      if (_txParseAmount((dataRows[i] || [])[c]) != null) score++;
    }
    if (score > bestScore) { bestScore = score; best = c; }
  }
  return best === -1 ? (dateCol === 0 ? 1 : 0) : best;
}

// Maps a raw table to { rows: [{date, amount}], skipped, total } using
// explicit column indices — the shared tail of both auto-detection and a
// manual column-picker override (js/transactions.js's #tx-date-col/
// #tx-amount-col). rows are aggregated (same-day duplicates summed) and
// sorted ascending.
function _txRowsFromCols(dataRows, dateCol, amountCol, actualCol) {
  const rows = [];
  let skipped = 0;
  for (const cells of dataRows) {
    const date = _txParseDate(cells[dateCol]);
    const amount = _txParseAmount(cells[amountCol]);
    if (date == null || amount == null) { skipped++; continue; }
    const row = { date, amount };
    if (actualCol != null) {
      const actual = _txParseAmount(cells[actualCol]);
      if (actual != null) row.actual = actual;
    }
    rows.push(row);
  }
  // Same-day merge: amounts SUM (two deposits on one day are both real money);
  // `actual` takes the LAST reading of the day — it's a level, not a flow.
  const byDate = new Map();
  for (const r of rows) {
    const prev = byDate.get(r.date);
    const merged = { date: r.date, amount: (prev ? prev.amount : 0) + r.amount };
    const actual = (r.actual != null) ? r.actual : (prev ? prev.actual : undefined);
    if (actual != null) merged.actual = actual;
    byDate.set(r.date, merged);
  }
  const merged = Array.from(byDate.values())
    .sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  return { rows: merged, skipped, total: merged.reduce((s, r) => s + r.amount, 0) };
}

// Maps raw text to { rows, skipped, total, headers, dataRows, dateCol,
// amountCol } using explicit column indices when given (and still in range
// for this parse — a sheet whose layout changed falls back to auto-detect
// rather than silently reading the wrong columns), else auto-detecting.
// The one path both a fresh parse and "reapply the columns I already
// picked" (refreshTxFromSheet, an edit re-fetch) go through, so a stored
// column choice actually survives a background resync or page reload
// instead of being silently re-guessed from scratch every time.
function _txParseWithCols(text, dateCol, amountCol, actualCol) {
  const { headers, dataRows } = _txParseRaw(text);
  if (!dataRows.length) return { rows: [], skipped: 0, total: 0, headers: null, dataRows: [], dateCol: 0, amountCol: 1, actualCol: null };
  const colCount = headers ? headers.length : (dataRows[0] || []).length;
  let dc = dateCol, ac = amountCol, xc = actualCol;
  if (dc == null || ac == null || dc < 0 || ac < 0 || dc >= colCount || ac >= colCount || dc === ac) {
    ({ dateCol: dc, amountCol: ac, actualCol: xc } = _txAutoDetectCols(headers, dataRows));
  }
  // The actual column is optional and validated independently of date/amount —
  // a stored choice that no longer fits the sheet's layout falls back to
  // auto-detect rather than silently reading a wrong column.
  if (xc != null && (xc < 0 || xc >= colCount || xc === dc || xc === ac)) {
    xc = _txAutoDetectCols(headers, dataRows).actualCol;
  }
  return { ..._txRowsFromCols(dataRows, dc, ac, xc), headers, dataRows, dateCol: dc, amountCol: ac, actualCol: xc != null ? xc : null };
}
// Parses pasted/uploaded/fetched text into { rows, skipped, total, headers,
// dataRows, dateCol, amountCol } — the last four let the modal show which
// columns were picked and let the user override them (js/transactions.js's
// #tx-date-col/#tx-amount-col selects) without re-parsing the text. Always
// auto-detects columns; _txParseWithCols is the variant that reapplies a
// previously-chosen column pair instead.
function parseTransactionText(text) {
  return _txParseWithCols(text, null, null, null);
}

// Turns transaction rows (sorted ascending) into { initial, entryDate, rows,
// schedule, total, source, sheetUrl, dateCol, amountCol }. The FIRST row is
// the seed lump sum (`initial`) and sets the entry date — matching how every
// engine already treats day one specially (the "new month" contribution
// trigger never fires on the first day). Everything from the second row on
// is the contribution schedule, in the exact { byDate, byMonth, list } shape
// buildFormulaSchedule (js/simulate.js) already produces. dateCol/amountCol
// (the column indices chosen when `rows` was built, upload or sheet) are
// carried along purely so a 'sheet' source can re-fetch+re-map its raw CSV
// later (refreshTxFromSheet, editing) without re-guessing which column is
// which — `rows` itself no longer has any column concept once mapped.
// A real transaction can be dated on a weekend or market holiday (payday
// deposits, bank transfers). Every consumer of the schedule keys strictly off
// TRADING days (`daily`/`dailyDateToIdx`) — an unsnapped weekend date matches
// nothing and the money silently vanishes from every engine (this dropped
// $5,685 of a real user history: Saturday deposits, a Presidents'-Day one, …
// and made Invested Compounded end BELOW the invested total). Snap to the
// NEXT trading day — the first day the market could actually see the money —
// mirroring how a real brokerage sweeps a weekend deposit in on Monday.
// Returns null for a date past the end of the data (nothing to snap to).
function _txSnapToTradingDay(dateStr) {
  if (typeof dailyDateToIdx === 'undefined' || !dailyDateToIdx ||
      typeof daily === 'undefined' || !daily || !daily.length) return dateStr;
  if (dailyDateToIdx.has(dateStr)) return dateStr;
  if (dateStr > daily[daily.length - 1].date) return null;
  let lo = 0, hi = daily.length - 1, ans = null;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (daily[m].date >= dateStr) { ans = daily[m].date; hi = m - 1; }
    else lo = m + 1;
  }
  return ans;
}
function _txStateFromRows(rows, source, sheetUrl, dateCol, amountCol, actualCol, showActual) {
  if (!rows || !rows.length) return null;
  const [first, ...rest] = rows;
  const byDate = new Map(), byMonth = new Map(), list = [], priceDateByMonth = new Map();
  for (const r of rest) {
    // Trading-day snap (see _txSnapToTradingDay). Snapping is monotonic, so
    // ascending order survives; two transactions snapping onto the same
    // Monday merge via the += below, same as same-day duplicates always did.
    const d = _txSnapToTradingDay(r.date);
    if (d == null) continue; // dated past the end of the data — nothing to simulate
    byDate.set(d, (byDate.get(d) || 0) + r.amount);
    const month = d.slice(0, 7);
    byMonth.set(month, (byMonth.get(month) || 0) + r.amount);
    list.push({ date: d, amount: r.amount });
    // `rest` is ascending, so the last write per month wins — the most
    // recent real transaction date in that month is what 9sig's
    // contribDeployPct portion prices at (js/simulate.js applyContribAtPrice).
    priceDateByMonth.set(month, d);
  }
  // The optional per-row `actual` readings (real portfolio value that day) →
  // the "My portfolio" chart line (js/saved-configs.js appendConfigDatasets).
  // Same trading-day snap as the flows; a level's same-day merge is
  // last-reading-wins. Includes the FIRST row too — unlike the flow schedule
  // (where row one is the `initial` lump handled separately), a value reading
  // on day one is a real first point of the line.
  const actualByDate = new Map();
  for (const r of rows) {
    if (r.actual == null || !isFinite(r.actual)) continue;
    let d = _txSnapToTradingDay(r.date);
    // A reading dated past the end of the market data (sheets often carry a
    // trailing "as of now" calculated row, dated a day or two ahead) is
    // still the LATEST known value of the account. Unlike a FLOW — which the
    // sim genuinely can't place on a day the market hasn't traded — a level
    // just gets clamped back to the last data day instead of dropped.
    if (d == null && typeof daily !== 'undefined' && daily && daily.length) d = daily[daily.length - 1].date;
    if (d == null) continue;
    actualByDate.set(d, r.actual); // ascending input → last reading per day wins
  }
  const actualPoints = Array.from(actualByDate, ([date, value]) => ({ date, value }))
    .sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  return {
    initial: first.amount,
    entryDate: _txSnapToTradingDay(first.date) || first.date,
    rows,
    schedule: { byDate, byMonth, list, priceDateByMonth },
    actualPoints,
    total: rows.reduce((s, r) => s + r.amount, 0),
    source: source || 'upload',
    sheetUrl: sheetUrl || null,
    dateCol: (dateCol != null ? dateCol : null),
    amountCol: (amountCol != null ? amountCol : null),
    actualCol: (actualCol != null ? actualCol : null),
    showActual: showActual !== false,
  };
}

// Re-derives the transaction view for an arbitrary chart ENTRY date without
// touching the underlying data. Three cases, per the user's spec:
//  - entry ≤ first transaction: the run starts with $0 at the entry and every
//    transaction (the former `initial` included) lands as a dated flow when
//    its day comes — lines sit at zero until real money arrives.
//  - entry mid-history: everything before the entry is absorbed into ONE
//    initial lump at the entry, valued at the PORTFOLIO's actual reading
//    there (forward-filled from the latest reading at-or-before it); with no
//    actual-value column, the Invested-Compounded balance at the cutoff
//    (contributions compounded at `baselineAnnualRate`, mirroring
//    js/simulate.js's once-per-month `investedCompounded` stepping) stands
//    in. Transactions after the entry stay dated flows.
//  - the default (entry == first transaction's day) reproduces the schedule
//    byte-for-byte: initial = first amount, flows = the rest.
// Returns { initial, schedule, actualPoints, entryDate } — the same shapes
// _txStateFromRows produces, so every consumer swaps in transparently.
function txEffectiveForEntry(state, entryDate, baselineAnnualRate) {
  if (!state) return null;
  const E = entryDate || state.entryDate;
  const buildSchedule = (rows) => {
    const byDate = new Map(), byMonth = new Map(), list = [], priceDateByMonth = new Map();
    for (const r of rows) {
      byDate.set(r.date, (byDate.get(r.date) || 0) + r.amount);
      const month = r.date.slice(0, 7);
      byMonth.set(month, (byMonth.get(month) || 0) + r.amount);
      list.push({ date: r.date, amount: r.amount });
      priceDateByMonth.set(month, r.date);
    }
    return { byDate, byMonth, list, priceDateByMonth };
  };
  // All flows on their SNAPPED dates, first row included (as {date, amount}).
  const allFlows = [{ date: state.entryDate, amount: state.initial }, ...state.schedule.list];
  if (E < state.entryDate) {
    // Earlier entry: $0 start, everything is a dated flow.
    return { initial: 0, schedule: buildSchedule(allFlows), actualPoints: state.actualPoints || [], entryDate: E };
  }
  if (E === state.entryDate) {
    return { initial: state.initial, schedule: state.schedule, actualPoints: state.actualPoints || [], entryDate: E };
  }
  // Mid-history entry: initial lump at E.
  let initial = null;
  const pts = state.actualPoints || [];
  if (pts.length && pts[0].date <= E) {
    // Latest actual reading at-or-before E (forward-fill).
    let v = null;
    for (const p of pts) { if (p.date <= E) v = p.value; else break; }
    initial = v;
  }
  if (initial == null) {
    // Invested-Compounded fallback: balance compounded once per calendar
    // month (matching the engine's month-row stepping), flows added on their
    // dates, up to E.
    const mr = (baselineAnnualRate || 0) / 12;
    let bal = 0;
    let month = state.entryDate.slice(0, 7);
    for (let fi = 0; fi < allFlows.length && allFlows[fi].date <= E; fi++) {
      const f = allFlows[fi];
      const fMonth = f.date.slice(0, 7);
      while (month < fMonth) { bal *= (1 + mr); month = _txNextMonth(month); }
      bal += f.amount;
    }
    const eMonth = E.slice(0, 7);
    while (month < eMonth) { bal *= (1 + mr); month = _txNextMonth(month); }
    initial = bal;
  }
  const laterFlows = allFlows.filter(f => f.date > E);
  const laterPts = pts.filter(p => p.date >= E);
  // Anchor the portfolio line at the cutoff itself so it starts exactly at
  // the entry with the lump value (when readings existed before E).
  if (pts.length && pts[0].date <= E && (!laterPts.length || laterPts[0].date !== E)) {
    laterPts.unshift({ date: E, value: initial });
  }
  return { initial, schedule: buildSchedule(laterFlows), actualPoints: laterPts, entryDate: E };
}
function _txNextMonth(ym) {
  let y = +ym.slice(0, 4), m = +ym.slice(5, 7);
  m++; if (m > 12) { m = 1; y++; }
  return y + '-' + String(m).padStart(2, '0');
}

// 'Date\tAmount' + one row per line — the inverse of parseTransactionText's
// default shape, used to seed the paste textarea when editing an existing
// upload-sourced history.
function _txRowsToTsv(rows) {
  const hasActual = rows.some(r => r.actual != null);
  if (!hasActual) return 'Date\tAmount\n' + rows.map(r => `${r.date}\t${r.amount}`).join('\n');
  return 'Date\tAmount\tTotal\n' + rows.map(r => `${r.date}\t${r.amount}\t${r.actual != null ? r.actual : ''}`).join('\n');
}

function _txColLabel(i, headers) {
  return (headers && headers[i]) ? headers[i] : `Column ${i + 1}`;
}
function _txEscHtml(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ===== Modal ================================================================

let _txParsedPreview = null;            // { rows, skipped, total } — last successful parse, pending confirm
let _txParsedPreviewSource = 'upload';  // 'upload' | 'sheet' — where _txParsedPreview came from
let _txParsedPreviewUrl = null;         // sheet URL when _txParsedPreviewSource === 'sheet'
let _txModalError = null;               // sheet-fetch error shown in the modal, if any
let _txModalLoading = false;            // sheet fetch in flight
let _txModalEditMode = false;           // opened via the edit button — only changes the modal title
let _txPasteAreaValue = '';             // mirrors the textarea across re-renders (renderTxModal rebuilds the DOM)
let _txSheetUrlValue = '';              // mirrors the URL input across re-renders, same reason
let _txModalTab = 'upload';             // 'upload' | 'sheet' — which panel is showing

// opts: { prefillText, prefillUrl, dateCol, amountCol, editMode } — all
// optional. Passing prefillUrl auto-triggers a load (editing a sheet-sourced
// history should show its current data immediately, not require an extra
// click); dateCol/amountCol, when given alongside it, reapply the schedule's
// already-chosen columns instead of re-auto-detecting them.
function openTxModal(opts) {
  opts = opts || {};
  closeTxModal();
  _txModalEditMode = !!opts.editMode;
  _txModalTab = opts.prefillUrl ? 'sheet' : 'upload';
  _txPasteAreaValue = opts.prefillText || '';
  _txSheetUrlValue = opts.prefillUrl || '';
  if (_txPasteAreaValue) {
    _txParsedPreview = parseTransactionText(_txPasteAreaValue);
    _txParsedPreviewSource = 'upload';
    _txParsedPreviewUrl = null;
  }
  const overlay = document.createElement('div');
  overlay.className = 'sc-modal-overlay';
  overlay.id = 'tx-modal';
  document.body.appendChild(overlay);
  renderTxModal();
  if (opts.prefillUrl) {
    _txFetchSheet(opts.prefillUrl, (opts.dateCol != null && opts.amountCol != null) ? { dateCol: opts.dateCol, amountCol: opts.amountCol, actualCol: opts.actualCol } : null);
  } else {
    const ta = overlay.querySelector('#tx-paste-area');
    if (ta) ta.focus();
  }
}
function closeTxModal() {
  const modal = document.getElementById('tx-modal');
  if (modal) modal.remove();
  _txParsedPreview = null;
  _txParsedPreviewSource = 'upload';
  _txParsedPreviewUrl = null;
  _txModalError = null;
  _txModalLoading = false;
  _txModalEditMode = false;
  _txPasteAreaValue = '';
  _txSheetUrlValue = '';
  _txModalTab = 'upload';
}
// The parse-dependent parts of the modal (preview + column pickers), built
// separately from renderTxModal so typing in the paste textarea can refresh
// JUST these in place (updateTxParsedUI below) without rebuilding the whole
// modal — a full rebuild recreates the textarea, which threw away the caret
// and scroll position on every keystroke and dumped the user back at the top
// of a long paste.
function _txPreviewHtml(p) {
  const hasActual = !!(p && p.actualCol != null && p.rows.some(r => r.actual != null));
  return !p ? '' : (!p.rows.length
    ? `<div class="custom-error">No valid rows found — check the date/amount columns.</div>`
    : `<div class="tx-preview-stats">
         <b>${p.rows.length}</b> row${p.rows.length === 1 ? '' : 's'}
         ${p.skipped ? `, <b>${p.skipped}</b> skipped` : ''} ·
         <b>${fmtFull(Math.round(p.total))}</b> total ·
         ${fmtDayMonthYear(p.rows[0].date)} → ${fmtDayMonthYear(p.rows[p.rows.length - 1].date)}
       </div>
       <div class="tx-preview-table-wrap"><table class="tx-preview-table">
         <thead><tr><th>Date</th><th>Amount</th>${hasActual ? '<th>Portfolio value</th>' : ''}</tr></thead>
         <tbody>${p.rows.slice(0, 200).map(r => `<tr><td>${fmtDayMonthYear(r.date)}</td><td>${fmtFull(Math.round(r.amount))}</td>${hasActual ? `<td>${r.actual != null ? fmtFull(Math.round(r.actual)) : '—'}</td>` : ''}</tr>`).join('')}</tbody>
       </table></div>`);
}
// Lets the user override which parsed column is the date vs. the value —
// auto-detection (_txAutoDetectCols) can pick wrong on a sheet with extra
// columns (category, notes, running balance, …). Shown whenever there's a
// parsed table with 2+ columns, for both a bad guess and a correct one you
// just want to confirm.
function _txColPickerHtml(p) {
  const colCount = (p && p.dataRows && p.dataRows.length) ? (p.headers ? p.headers.length : p.dataRows[0].length) : 0;
  return colCount < 2 ? '' : `
    <div class="tx-col-picker">
      <label>Date column
        <select id="tx-date-col" class="inline-select">
          ${Array.from({ length: colCount }, (_, i) => `<option value="${i}" ${p.dateCol === i ? 'selected' : ''}>${_txEscHtml(_txColLabel(i, p.headers))}</option>`).join('')}
        </select>
      </label>
      <label>Value column
        <select id="tx-amount-col" class="inline-select">
          ${Array.from({ length: colCount }, (_, i) => `<option value="${i}" ${p.amountCol === i ? 'selected' : ''}>${_txEscHtml(_txColLabel(i, p.headers))}</option>`).join('')}
        </select>
      </label>
      <label>Portfolio value column
        <select id="tx-actual-col" class="inline-select" title="Optional: a column with your account's ACTUAL total value on that date — drawn as the 'My portfolio' line so you can compare what is against what the strategies say could have been.">
          <option value="" ${p.actualCol == null ? 'selected' : ''}>— none —</option>
          ${Array.from({ length: colCount }, (_, i) => `<option value="${i}" ${p.actualCol === i ? 'selected' : ''}>${_txEscHtml(_txColLabel(i, p.headers))}</option>`).join('')}
        </select>
      </label>
    </div>`;
}
// In-place refresh of everything that depends on the parsed preview, leaving
// the rest of the modal DOM (crucially the paste textarea) untouched.
function updateTxParsedUI() {
  const p = _txParsedPreview;
  const preview = document.getElementById('tx-preview');
  if (preview) preview.innerHTML = _txPreviewHtml(p);
  const pickerSlot = document.getElementById('tx-col-picker-slot');
  if (pickerSlot) pickerSlot.innerHTML = _txColPickerHtml(p);
  const confirmBtn = document.querySelector('#tx-modal [data-tx-confirm]');
  if (confirmBtn) confirmBtn.disabled = !(p && p.rows.length);
}
function renderTxModal() {
  const modal = document.getElementById('tx-modal');
  if (!modal) return;
  const p = _txParsedPreview;
  const previewHtml = _txPreviewHtml(p);
  const colPickerHtml = _txColPickerHtml(p);
  const uploadTabHtml = `
    <div class="builder-help">One transaction per line: date, then amount.<br>The earliest one sets your entry date and starting balance.</div>
    <input type="file" id="tx-file-input" accept=".csv,.tsv,.txt" style="margin-bottom:8px">
    <textarea id="tx-paste-area" class="builder-textarea" placeholder="Date&#9;Amount&#10;2019-01-03&#9;10000&#10;2019-02-01&#9;500&#10;2019-03-01&#9;500">${_txEscHtml(_txPasteAreaValue)}</textarea>`;
  const sheetTabHtml = `
    <div class="builder-help">Paste a published Google Sheets CSV link.<br>It re-syncs automatically on every page load.</div>
    <div class="tx-sheet-row">
      <input type="url" id="tx-sheet-url" class="tx-sheet-url-input" placeholder="Public Google Sheets CSV link (File → Share → Publish to web → CSV)" value="${_txEscHtml(_txSheetUrlValue)}">
      <button type="button" class="sc-modal-btn" id="tx-sheet-fetch-btn" ${_txModalLoading ? 'disabled' : ''}>${_txModalLoading ? 'Loading…' : 'Load'}</button>
    </div>
    ${_txModalError ? `<div class="custom-error">${_txEscHtml(_txModalError)}</div>` : ''}`;
  modal.innerHTML = `
    <div class="builder-modal">
      <div class="sc-modal-title">${_txModalEditMode ? 'Edit transaction history' : 'Transaction history'}</div>
      <div class="tx-tabs">
        <button type="button" class="tx-tab-btn ${_txModalTab === 'upload' ? 'active' : ''}" data-tx-tab="upload">Upload</button>
        <button type="button" class="tx-tab-btn ${_txModalTab === 'sheet' ? 'active' : ''}" data-tx-tab="sheet">Live sheet</button>
      </div>
      ${_txModalTab === 'upload' ? uploadTabHtml : sheetTabHtml}
      <div id="tx-col-picker-slot">${colPickerHtml}</div>
      <div id="tx-preview">${previewHtml}</div>
      <div class="builder-actions">
        <button type="button" class="sc-modal-btn" data-tx-cancel>Cancel</button>
        <button type="button" class="sc-modal-btn primary" data-tx-confirm ${p && p.rows.length ? '' : 'disabled'}>Use this history</button>
      </div>
    </div>`;
}

// Fetches a CSV/TSV URL (a Google Sheets "Publish to web" CSV export link)
// and parses it exactly like pasted text. Populates the modal's preview on
// success, or _txModalError on network/CORS failure or an empty response.
// preferredCols ({dateCol, amountCol}), when given, re-applies a previously
// chosen column pair instead of auto-detecting — used when re-opening the
// modal to edit an existing sheet-sourced history, so the picker doesn't
// silently reset to a fresh (possibly wrong) guess.
async function _txFetchSheet(url, preferredCols) {
  _txModalLoading = true;
  _txModalError = null;
  renderTxModal();
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    const parsed = _txParseWithCols(text, preferredCols ? preferredCols.dateCol : null, preferredCols ? preferredCols.amountCol : null, preferredCols ? preferredCols.actualCol : null);
    // Only a hard failure when there's no table at all — a wrong column
    // guess (0 valid rows but a real table) still needs to reach the modal
    // so the date/value pickers render and the user can correct it.
    if (!parsed.dataRows.length) throw new Error('No data found in that link.');
    _txParsedPreview = parsed;
    _txParsedPreviewSource = 'sheet';
    _txParsedPreviewUrl = url;
  } catch (err) {
    _txParsedPreview = null;
    _txModalError = 'Could not load that link — ' + (err && err.message ? err.message : "check it's a public CSV export URL.");
  }
  _txModalLoading = false;
  if (document.getElementById('tx-modal')) renderTxModal(); // still open? (not cancelled mid-fetch)
}

function _txHandlePastedText(text) {
  _txPasteAreaValue = text;
  _txParsedPreview = text.trim() ? parseTransactionText(text) : null;
  _txParsedPreviewSource = 'upload';
  _txParsedPreviewUrl = null;
  renderTxModal();
  const ta = document.getElementById('tx-paste-area');
  if (ta) ta.value = text;
}

// ===== Wiring ================================================================

document.addEventListener('click', (e) => {
  if (e.target.closest('#tx-upload-btn')) { openTxModal(); return; }
  // Eye toggle for the "My portfolio" line (renderTxSummary). Both the live
  // state and the stash carry the flag so it survives the sliders toggle and
  // persists via persistTransactions' whitelist.
  if (e.target.closest('#tx-actual-toggle')) {
    // Compute the flipped value ONCE — _txSchedule and _txScheduleStash are
    // usually the SAME object, so flipping each in a loop toggles it twice
    // (a no-op, which is exactly how v1 of this handler failed).
    const cur = window._txSchedule || window._txScheduleStash;
    const next = cur ? cur.showActual === false : true;
    if (window._txSchedule) window._txSchedule.showActual = next;
    if (window._txScheduleStash) window._txScheduleStash.showActual = next;
    persistTransactions();
    if (typeof render === 'function') render();
    renderTxSummary();
    return;
  }
  // Re-opens the modal pre-filled with the active/stashed history — as pasted
  // rows for an 'upload' source (so you can add/remove/edit lines directly),
  // or as the URL field (auto-loaded) for a 'sheet' source, since raw rows
  // from a live sheet aren't something you'd hand-edit here.
  if (e.target.closest('#tx-edit-btn')) {
    const s = window._txSchedule || window._txScheduleStash;
    if (!s) return;
    if (s.source === 'sheet' && s.sheetUrl) openTxModal({ prefillUrl: s.sheetUrl, editMode: true, dateCol: s.dateCol, amountCol: s.amountCol, actualCol: s.actualCol });
    else openTxModal({ prefillText: _txRowsToTsv(s.rows), editMode: true });
    return;
  }
  if (e.target.closest('#tx-sheet-fetch-btn')) {
    const urlInput = document.getElementById('tx-sheet-url');
    const url = urlInput && urlInput.value.trim();
    if (url) _txFetchSheet(url);
    return;
  }
  const tabBtn = e.target.closest('[data-tx-tab]');
  if (tabBtn) {
    _txModalTab = tabBtn.dataset.txTab;
    renderTxModal();
    const ta = document.getElementById('tx-paste-area');
    if (ta) ta.focus();
    return;
  }
  if (e.target.closest('[data-tx-cancel]')) { closeTxModal(); return; }
  if (e.target.closest('[data-tx-confirm]')) {
    if (!_txParsedPreview || !_txParsedPreview.rows.length) return;
    const state = _txStateFromRows(_txParsedPreview.rows, _txParsedPreviewSource,
      _txParsedPreviewSource === 'sheet' ? _txParsedPreviewUrl : null,
      _txParsedPreview.dateCol, _txParsedPreview.amountCol, _txParsedPreview.actualCol);
    window._txSchedule = state;
    window._txScheduleStash = state;
    persistTransactions();
    closeTxModal();
    applyTxEntryDate();
    toggleContribMode();
    if (typeof saveSliders === 'function') saveSliders();
    if (typeof render === 'function') render();
    return;
  }
  // Single shared toggle, same DOM position in both states (index.html) so
  // repeatedly clicking it to compare doesn't require re-aiming the mouse.
  // Non-destructive either direction — the stash always survives, only
  // _txSchedule (which one is ACTIVE) flips.
  if (e.target.closest('#tx-mode-toggle-btn')) {
    if (window._txSchedule) {
      // -> slider mode. Reverts entry date too — same "use quarter default"
      // behavior the exact-date picker's own clear link uses (date-picker.js).
      window._txSchedule = null;
      const el = document.getElementById('entry-exact-date');
      if (el) el.value = '';
    } else if (window._txScheduleStash) {
      // -> reactivate the stashed history. The entry stays wherever the user
      // has it — txEffectiveForEntry derives the right view for any entry.
      window._txSchedule = window._txScheduleStash;
    } else {
      return;
    }
    persistTransactions();
    toggleContribMode();
    if (typeof saveSliders === 'function') saveSliders();
    if (typeof render === 'function') render();
    // A linked Google Sheet only auto-refreshes once at page startup
    // (js/init.js) — without this, switching back to a sheet-sourced history
    // mid-session showed whatever was last cached instead of the sheet's
    // current data, and only a full page reload picked up the latest rows.
    // No-ops for an upload-sourced (pasted) history; fire-and-forget, same as
    // the startup call — it re-renders itself once the fetch resolves.
    if (window._txSchedule && typeof refreshTxFromSheet === 'function') refreshTxFromSheet();
    return;
  }
  // Permanent delete — the only action that actually discards the stash.
  if (e.target.closest('#tx-delete-btn')) {
    window._txSchedule = null;
    window._txScheduleStash = null;
    persistTransactions();
    const el = document.getElementById('entry-exact-date');
    if (el) el.value = '';
    toggleContribMode();
    if (typeof saveSliders === 'function') saveSliders();
    if (typeof render === 'function') render();
    return;
  }
  // Click-outside-to-close for the modal overlay itself — but ONLY when the
  // press also STARTED on the overlay. When a drag begins inside the content
  // (resizing the paste textarea by its grip, or selecting text) and the
  // mouse is released over the dimmed backdrop, the browser dispatches the
  // click on the overlay (the common ancestor of mousedown/mouseup targets);
  // without this guard that closed the modal and threw away everything the
  // user had pasted (closeTxModal clears _txPasteAreaValue).
  if (e.target.id === 'tx-modal') { if (_txOverlayPressStarted) closeTxModal(); return; }
});
// See the outside-click guard above — records whether each press began on
// the overlay itself (true = a real backdrop click, eligible to close).
let _txOverlayPressStarted = false;
document.addEventListener('mousedown', (e) => {
  _txOverlayPressStarted = !!(e.target && e.target.id === 'tx-modal');
});

document.addEventListener('input', (e) => {
  if (e.target.id === 'tx-paste-area') {
    _txPasteAreaValue = e.target.value;
    _txParsedPreview = e.target.value.trim() ? parseTransactionText(e.target.value) : null;
    _txParsedPreviewSource = 'upload';
    _txParsedPreviewUrl = null;
    // In-place refresh of the parse-dependent parts only — a full
    // renderTxModal() here rebuilt the textarea mid-typing, losing the
    // caret and scroll position on every keystroke (a long paste dumped
    // the user back at the top after each edit).
    updateTxParsedUI();
    return;
  }
  if (e.target.id === 'tx-sheet-url') {
    _txSheetUrlValue = e.target.value; // no live parsing — click Load to fetch
    return;
  }
});

document.addEventListener('change', (e) => {
  if (e.target.id === 'tx-file-input') {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => _txHandlePastedText(String(reader.result || ''));
    reader.readAsText(file);
    return;
  }
  // Manual column override — recompute from the already-parsed table rather
  // than re-parsing the text/re-fetching the sheet.
  if (e.target.id === 'tx-date-col' || e.target.id === 'tx-amount-col' || e.target.id === 'tx-actual-col') {
    if (!_txParsedPreview || !_txParsedPreview.dataRows) return;
    const dateCol = +document.getElementById('tx-date-col').value;
    const amountCol = +document.getElementById('tx-amount-col').value;
    const actualRaw = (document.getElementById('tx-actual-col') || {}).value;
    const actualCol = (actualRaw === '' || actualRaw == null) ? null : +actualRaw;
    const result = _txRowsFromCols(_txParsedPreview.dataRows, dateCol, amountCol, actualCol);
    _txParsedPreview = { ..._txParsedPreview, ...result, dateCol, amountCol, actualCol };
    // In-place, same as typing — a full renderTxModal() would rebuild the
    // paste textarea and lose its scroll position under the user.
    updateTxParsedUI();
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && document.getElementById('tx-modal')) closeTxModal();
});

// Sets #entry-exact-date to the first transaction's date, reusing the exact
// entry/exit date-picker's own plumbing (js/date-picker.js, js/chart.js) —
// entryDateForSim already prefers this override over the coarse slider.
function applyTxEntryDate() {
  if (!window._txSchedule) return;
  const el = document.getElementById('entry-exact-date');
  if (!el) return;
  el.value = window._txSchedule.entryDate;
  const sliderEl = document.getElementById('slider-entry');
  if (sliderEl && typeof quarterIdxForDate === 'function') {
    sliderEl.value = quarterIdxForDate(window._txSchedule.entryDate);
    if (window._dualRange && typeof window._dualRange.updateUI === 'function') window._dualRange.updateUI();
  }
}

// Swaps the sidebar between the default sliders and the active-transactions
// summary. Called on confirm/clear and once at startup (restoring from
// localStorage/share link).
function toggleContribMode() {
  const defaultEl = document.getElementById('contrib-default-controls');
  const activeEl = document.getElementById('contrib-tx-active');
  if (!defaultEl || !activeEl) return;
  const active = !!window._txSchedule;
  defaultEl.hidden = active;
  activeEl.hidden = !active;
  if (active) renderTxSummary();
  renderTxModeToggle();
  // The entry date is freely adjustable even while a schedule is active —
  // txEffectiveForEntry re-derives the initial/flows for whatever entry the
  // user picks — so the exact-day picker stays enabled.
  const entryPickBtn = document.getElementById('entry-date-pick');
  if (entryPickBtn) entryPickBtn.disabled = false;
}
function renderTxSummary() {
  const el = document.getElementById('tx-summary-text');
  if (!el || !window._txSchedule) return;
  const s = window._txSchedule;
  const n = s.rows.length;
  // Deliberately terse: no "since <date>" (the Entry display under the chart
  // already shows it) and no heading (the block's content is self-explaining).
  const rows = [
    `<span class="tx-summary-row"><b>${n}</b>&nbsp;transactions · <b>${fmtFull(Math.round(s.total))}</b>&nbsp;invested</span>`,
  ];
  if (s.source === 'sheet') rows.push(`<span class="tx-summary-row tx-sheet-tag">synced from Google Sheet</span>`);
  // The "My portfolio" line (the file's actual-value column, drawn on the
  // chart by js/saved-configs.js's appendConfigDatasets): color dot, its
  // money-weighted CAGR + flow-adjusted DD (window._actualMetrics), and an
  // eye toggle — same stroked SVG eye as the legend chips / saved-config
  // pills, never an emoji glyph (renders as a jarring photorealistic eye).
  if (s.actualPoints && s.actualPoints.length) {
    const m = window._actualMetrics;
    const on = s.showActual !== false;
    const eyeSvg = on
      ? '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>'
      : '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-10-7-10-7a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 10 7 10 7a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/>';
    const stats = (on && m && Number.isFinite(m.cagr))
      ? `<span class="tx-actual-stat"><b class="${m.cagr >= 0 ? 'tx-actual-pos' : 'tx-actual-neg'}">${m.cagr >= 0 ? '+' : ''}${m.cagr.toFixed(1)}%</b></span>` +
        (Number.isFinite(m.maxDD) && m.maxDD > 0 ? `<span class="tx-actual-stat">DD <b class="tx-actual-neg">-${m.maxDD.toFixed(1)}%</b></span>` : '')
      : '';
    rows.push(`<span class="tx-summary-row tx-actual-row">
      <button type="button" id="tx-actual-toggle" class="tx-actual-eye" title="${on ? 'Hide' : 'Show'} the My portfolio line" aria-label="${on ? 'Hide' : 'Show'} the My portfolio line">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${eyeSvg}</svg>
      </button>
      <span class="tx-actual-dot"></span><span class="tx-actual-name">My portfolio</span>${stats}</span>`);
  }
  el.innerHTML = rows.join('');
  const editBtn = document.getElementById('tx-edit-btn');
  if (editBtn) {
    const label = s.source === 'sheet' ? 'Change the linked sheet' : 'Edit transactions';
    editBtn.title = label;
    editBtn.setAttribute('aria-label', label);
  }
}
// Single shared slider-mode <-> transaction-history toggle (index.html's
// #tx-mode-toggle-btn, always the same DOM position in either mode). Label
// and meaning flip with state: "Switch to sliders" while a history is
// active, "Switch to your N saved transactions" while one is stashed but
// off, hidden entirely when there's no history to toggle to at all.
function renderTxModeToggle() {
  const btn = document.getElementById('tx-mode-toggle-btn');
  if (!btn) return;
  if (window._txSchedule) {
    btn.hidden = false;
    btn.textContent = 'Switch to sliders';
  } else if (window._txScheduleStash) {
    const n = window._txScheduleStash.rows.length;
    btn.hidden = false;
    // "saved" dropped deliberately — at 3-digit transaction counts it wraps
    // the button to two lines (measured: 54px vs. the single-line 37px).
    btn.textContent = `Switch to your ${n} transaction${n === 1 ? '' : 's'}`;
  } else {
    btn.hidden = true;
  }
}

// Auto-refresh entry point (js/init.js), called once after startup restore
// and initial render. Silently re-fetches a linked Google Sheet's current
// data and swaps it in, preserving whichever state (active vs. stashed) was
// already restored. A failed fetch (offline, CORS, sheet no longer public)
// just leaves the last cached rows in place — this never blocks or breaks
// the initial render, and there's no UI for a background sync failure.
async function refreshTxFromSheet() {
  const cur = window._txScheduleStash;
  if (!cur || cur.source !== 'sheet' || !cur.sheetUrl) return;
  const wasActive = !!window._txSchedule;
  try {
    const res = await fetch(cur.sheetUrl, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    // Reapplies the column choice already stored on `cur` instead of
    // re-auto-detecting — this was the actual bug: every background resync
    // (including the one on plain page refresh) re-ran auto-detection from
    // scratch, silently discarding whatever column the user had picked and
    // going back to whichever wrong column auto-detect landed on before.
    const parsed = _txParseWithCols(text, cur.dateCol, cur.amountCol, cur.actualCol);
    if (!parsed.rows.length) throw new Error('empty sheet');
    const fresh = _txStateFromRows(parsed.rows, 'sheet', cur.sheetUrl, parsed.dateCol, parsed.amountCol, parsed.actualCol, cur.showActual);
    window._txScheduleStash = fresh;
    persistTransactions();
    if (wasActive) {
      window._txSchedule = fresh;
      // Entry deliberately untouched — a background re-sync must not move
      // the user's chosen entry (txEffectiveForEntry handles any entry).
      toggleContribMode();
      if (typeof saveSliders === 'function') saveSliders();
      if (typeof render === 'function') render();
    } else {
      renderTxModeToggle(); // row count in the toggle's label may have changed
    }
  } catch (e) {
    // Background sync — nothing to surface for a failure, just keep the cache.
  }
}
