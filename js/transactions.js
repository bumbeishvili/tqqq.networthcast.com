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
      state: _txStateFromRows(parsed.rows, parsed.source || 'upload', parsed.sheetUrl || null),
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

const _TX_AMOUNT_HEADER_RE = /amount|value|invested|contribution|deposit|cash/i;
const _TX_DATE_HEADER_RE = /date/i;

// Splits raw text into a table without deciding which column is which —
// parseTransactionText uses this plus _txAutoDetectCols/_txRowsFromCols below
// so the modal's column pickers can recompute rows from the same table when
// the user overrides the auto-detected columns, without re-splitting the text.
function _txParseRaw(text) {
  const lines = String(text || '').split(/\r?\n/).map(l => l.trim()).filter(l => l.length);
  if (!lines.length) return { headers: null, dataRows: [] };
  const sep = _txSniffDelimiter(lines[0]);
  const split = (line) => line.split(sep).map(c => c.trim().replace(/^"|"$/g, ''));
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
  return { dateCol, amountCol };
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
function _txRowsFromCols(dataRows, dateCol, amountCol) {
  const rows = [];
  let skipped = 0;
  for (const cells of dataRows) {
    const date = _txParseDate(cells[dateCol]);
    const amount = _txParseAmount(cells[amountCol]);
    if (date == null || amount == null) { skipped++; continue; }
    rows.push({ date, amount });
  }
  const byDate = new Map();
  for (const r of rows) byDate.set(r.date, (byDate.get(r.date) || 0) + r.amount);
  const merged = Array.from(byDate, ([date, amount]) => ({ date, amount }))
    .sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  return { rows: merged, skipped, total: merged.reduce((s, r) => s + r.amount, 0) };
}

// Parses pasted/uploaded/fetched text into { rows, skipped, total, headers,
// dataRows, dateCol, amountCol } — the last four let the modal show which
// columns were picked and let the user override them (js/transactions.js's
// #tx-date-col/#tx-amount-col selects) without re-parsing the text.
function parseTransactionText(text) {
  const { headers, dataRows } = _txParseRaw(text);
  if (!dataRows.length) return { rows: [], skipped: 0, total: 0, headers: null, dataRows: [], dateCol: 0, amountCol: 1 };
  const { dateCol, amountCol } = _txAutoDetectCols(headers, dataRows);
  return { ..._txRowsFromCols(dataRows, dateCol, amountCol), headers, dataRows, dateCol, amountCol };
}

// Turns transaction rows (sorted ascending) into { initial, entryDate, rows,
// schedule, total, source, sheetUrl }. The FIRST row is the seed lump sum
// (`initial`) and sets the entry date — matching how every engine already
// treats day one specially (the "new month" contribution trigger never fires
// on the first day). Everything from the second row on is the contribution
// schedule, in the exact { byDate, byMonth, list } shape buildFormulaSchedule
// (js/simulate.js) already produces.
function _txStateFromRows(rows, source, sheetUrl) {
  if (!rows || !rows.length) return null;
  const [first, ...rest] = rows;
  const byDate = new Map(), byMonth = new Map(), list = [], priceDateByMonth = new Map();
  for (const r of rest) {
    byDate.set(r.date, (byDate.get(r.date) || 0) + r.amount);
    const month = r.date.slice(0, 7);
    byMonth.set(month, (byMonth.get(month) || 0) + r.amount);
    list.push(r);
    // `rest` is ascending, so the last write per month wins — the most
    // recent real transaction date in that month is what 9sig's
    // contribDeployPct portion prices at (js/simulate.js applyContribAtPrice).
    priceDateByMonth.set(month, r.date);
  }
  return {
    initial: first.amount,
    entryDate: first.date,
    rows,
    schedule: { byDate, byMonth, list, priceDateByMonth },
    total: rows.reduce((s, r) => s + r.amount, 0),
    source: source || 'upload',
    sheetUrl: sheetUrl || null,
  };
}

// 'Date\tAmount' + one row per line — the inverse of parseTransactionText's
// default shape, used to seed the paste textarea when editing an existing
// upload-sourced history.
function _txRowsToTsv(rows) {
  return 'Date\tAmount\n' + rows.map(r => `${r.date}\t${r.amount}`).join('\n');
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

// opts: { prefillText, prefillUrl, editMode } — all optional. Passing
// prefillUrl auto-triggers a load (editing a sheet-sourced history should
// show its current data immediately, not require an extra click).
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
    _txFetchSheet(opts.prefillUrl);
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
function renderTxModal() {
  const modal = document.getElementById('tx-modal');
  if (!modal) return;
  const p = _txParsedPreview;
  const previewHtml = !p ? '' : (!p.rows.length
    ? `<div class="custom-error">No valid rows found — check the date/amount columns.</div>`
    : `<div class="tx-preview-stats">
         <b>${p.rows.length}</b> row${p.rows.length === 1 ? '' : 's'}
         ${p.skipped ? `, <b>${p.skipped}</b> skipped` : ''} ·
         <b>${fmtFull(Math.round(p.total))}</b> total ·
         ${fmtDayMonthYear(p.rows[0].date)} → ${fmtDayMonthYear(p.rows[p.rows.length - 1].date)}
       </div>
       <div class="tx-preview-table-wrap"><table class="tx-preview-table">
         <thead><tr><th>Date</th><th>Amount</th></tr></thead>
         <tbody>${p.rows.slice(0, 200).map(r => `<tr><td>${fmtDayMonthYear(r.date)}</td><td>${fmtFull(Math.round(r.amount))}</td></tr>`).join('')}</tbody>
       </table></div>`);
  // Lets the user override which parsed column is the date vs. the value —
  // auto-detection (_txAutoDetectCols) can pick wrong on a sheet with extra
  // columns (category, notes, running balance, …). Shown whenever there's a
  // parsed table with 2+ columns, for both a bad guess and a correct one you
  // just want to confirm.
  const colCount = (p && p.dataRows && p.dataRows.length) ? (p.headers ? p.headers.length : p.dataRows[0].length) : 0;
  const colPickerHtml = colCount < 2 ? '' : `
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
    </div>`;
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
      ${colPickerHtml}
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
async function _txFetchSheet(url) {
  _txModalLoading = true;
  _txModalError = null;
  renderTxModal();
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    const parsed = parseTransactionText(text);
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
  // Re-opens the modal pre-filled with the active/stashed history — as pasted
  // rows for an 'upload' source (so you can add/remove/edit lines directly),
  // or as the URL field (auto-loaded) for a 'sheet' source, since raw rows
  // from a live sheet aren't something you'd hand-edit here.
  if (e.target.closest('#tx-edit-btn')) {
    const s = window._txSchedule || window._txScheduleStash;
    if (!s) return;
    if (s.source === 'sheet' && s.sheetUrl) openTxModal({ prefillUrl: s.sheetUrl, editMode: true });
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
      _txParsedPreviewSource === 'sheet' ? _txParsedPreviewUrl : null);
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
  // Non-destructive: switches to slider mode but keeps the parsed history in
  // _txScheduleStash (+ localStorage) so #tx-switch-banner can bring it back
  // without a re-upload.
  if (e.target.closest('#tx-switch-to-sliders-btn')) {
    window._txSchedule = null;
    persistTransactions();
    // Reverts entry date too — same "use quarter default" behavior the
    // exact-date picker's own clear link uses (js/date-picker.js).
    const el = document.getElementById('entry-exact-date');
    if (el) el.value = '';
    toggleContribMode();
    if (typeof saveSliders === 'function') saveSliders();
    if (typeof render === 'function') render();
    return;
  }
  // Reactivates the stashed history from slider mode — the counterpart to
  // #tx-switch-to-sliders-btn above.
  if (e.target.closest('#tx-switch-banner')) {
    if (!window._txScheduleStash) return;
    window._txSchedule = window._txScheduleStash;
    persistTransactions();
    applyTxEntryDate();
    toggleContribMode();
    if (typeof saveSliders === 'function') saveSliders();
    if (typeof render === 'function') render();
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
  // Click-outside-to-close for the modal overlay itself.
  if (e.target.id === 'tx-modal') { closeTxModal(); return; }
});

document.addEventListener('input', (e) => {
  if (e.target.id === 'tx-paste-area') {
    _txPasteAreaValue = e.target.value;
    _txParsedPreview = e.target.value.trim() ? parseTransactionText(e.target.value) : null;
    _txParsedPreviewSource = 'upload';
    _txParsedPreviewUrl = null;
    renderTxModal();
    // Re-focus + restore cursor since renderTxModal rebuilds the textarea.
    const ta = document.getElementById('tx-paste-area');
    if (ta) { ta.value = e.target.value; ta.focus(); }
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
  if (e.target.id === 'tx-date-col' || e.target.id === 'tx-amount-col') {
    if (!_txParsedPreview || !_txParsedPreview.dataRows) return;
    const dateCol = +document.getElementById('tx-date-col').value;
    const amountCol = +document.getElementById('tx-amount-col').value;
    const result = _txRowsFromCols(_txParsedPreview.dataRows, dateCol, amountCol);
    _txParsedPreview = { ..._txParsedPreview, ...result, dateCol, amountCol };
    renderTxModal();
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
  else renderTxSwitchBanner();
  // Entry is pinned to the first transaction while a schedule is active — the
  // exact-day picker would otherwise let it drift away from that date, the
  // same desync the entry slider lock (js/controls.js's entryLocked()) exists
  // to prevent.
  const entryPickBtn = document.getElementById('entry-date-pick');
  if (entryPickBtn) entryPickBtn.disabled = active;
}
function renderTxSummary() {
  const el = document.getElementById('tx-summary-text');
  if (!el || !window._txSchedule) return;
  const s = window._txSchedule;
  const n = s.rows.length;
  const base = `<b>${n}</b> transaction${n === 1 ? '' : 's'} · <b>${fmtFull(Math.round(s.total))}</b> total · since ${fmtDayMonthYear(s.entryDate)}`;
  el.innerHTML = s.source === 'sheet' ? `${base}<br><span class="tx-sheet-tag">synced from a linked Google Sheet</span>` : base;
  const editBtn = document.getElementById('tx-edit-btn');
  if (editBtn) {
    const label = s.source === 'sheet' ? 'Change the linked sheet' : 'Edit transactions';
    editBtn.title = label;
    editBtn.setAttribute('aria-label', label);
  }
}
// Shown in slider mode only when a previously-uploaded history is stashed
// (switched off, not deleted) — one click brings it back without a re-upload.
function renderTxSwitchBanner() {
  const el = document.getElementById('tx-switch-banner');
  if (!el) return;
  const s = window._txScheduleStash;
  const show = !window._txSchedule && !!s;
  el.hidden = !show;
  if (show) el.textContent = `Switch to your ${s.rows.length} saved transaction${s.rows.length === 1 ? '' : 's'}`;
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
    const parsed = parseTransactionText(text);
    if (!parsed.rows.length) throw new Error('empty sheet');
    const fresh = _txStateFromRows(parsed.rows, 'sheet', cur.sheetUrl);
    window._txScheduleStash = fresh;
    persistTransactions();
    if (wasActive) {
      window._txSchedule = fresh;
      applyTxEntryDate();
      toggleContribMode();
      if (typeof saveSliders === 'function') saveSliders();
      if (typeof render === 'function') render();
    } else {
      renderTxSwitchBanner(); // row count in the banner text may have changed
    }
  } catch (e) {
    // Background sync — nothing to surface for a failure, just keep the cache.
  }
}
