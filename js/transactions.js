// js/transactions.js — real transaction-history import. Lets the user upload
// or paste their own (date, amount) contribution log and use it as the app's
// contribution schedule instead of the Initial Investment / Monthly
// Contribution formula — every strategy backtests against real money on
// real days instead of a smooth synthetic curve. See the plan this shipped
// from: entry date snaps to the first transaction, same shape as
// buildFormulaSchedule (js/simulate.js) so every consumer already wired for
// that shape (9sig/SMA/Buy & Hold/Invested Compounded/custom strategies)
// works with real data unchanged.

// ===== State ===============================================================
// The ACTIVE parsed history — every consumer (chart.js, saved-configs.js,
// preview-dropdown.js) reads this and treats it as "use real transactions"
// vs. "use the slider formula". null when the app is in slider mode.
//   { initial, entryDate, rows: [{date,amount}] (ALL, incl. the first),
//     schedule: {byDate,byMonth,list} (rows[1:] — the first row IS `initial`,
//     not a contribution), total, source }
window._txSchedule = null;
// The last-uploaded history, kept around even while switched OFF (i.e. even
// when _txSchedule is null) so "switch back to my transactions" doesn't
// require re-uploading/re-pasting. Same shape as _txSchedule. Both are set
// together on upload; only _txSchedule gets nulled by the sliders toggle.
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
    return { state: _txStateFromRows(parsed.rows, parsed.source || 'upload'), active: parsed.active !== false };
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

// Parses pasted/uploaded text into { rows: [{date, amount}], skipped, total }.
// rows are aggregated (same-day duplicates summed) and sorted ascending.
//
// Header rules: a header row with a column matching /date/i wins regardless
// of position; the amount column is the best keyword match, or the sole
// remaining column when there are exactly two. No header (or no /date/i
// match) falls back to column 0 = date, column 1 = amount.
function parseTransactionText(text) {
  const lines = String(text || '').split(/\r?\n/).map(l => l.trim()).filter(l => l.length);
  if (!lines.length) return { rows: [], skipped: 0, total: 0 };
  const sep = _txSniffDelimiter(lines[0]);
  const split = (line) => line.split(sep).map(c => c.trim().replace(/^"|"$/g, ''));

  const first = split(lines[0]);
  // A header cell "looks like text" if it doesn't parse as either a date or
  // a number — a genuine data row's cells should parse as one or the other.
  const looksLikeHeader = first.some(c => _TX_DATE_HEADER_RE.test(c)) ||
    first.every(c => _txParseDate(c) == null && _txParseAmount(c) == null);

  let dateCol = 0, amountCol = 1, dataStart = 0;
  if (looksLikeHeader) {
    dataStart = 1;
    let dc = first.findIndex(c => _TX_DATE_HEADER_RE.test(c));
    if (dc === -1) dc = 0;
    dateCol = dc;
    const amountCandidates = first
      .map((c, i) => ({ i, c }))
      .filter(({ i, c }) => i !== dateCol && _TX_AMOUNT_HEADER_RE.test(c));
    if (amountCandidates.length) amountCol = amountCandidates[0].i;
    else if (first.length === 2) amountCol = dateCol === 0 ? 1 : 0;
    else amountCol = -1; // resolved per-row below (best numeric column)
  }

  const rows = [];
  let skipped = 0;
  for (let i = dataStart; i < lines.length; i++) {
    const cells = split(lines[i]);
    const date = _txParseDate(cells[dateCol]);
    let amtCol = amountCol;
    if (amtCol === -1) amtCol = cells.findIndex((c, ci) => ci !== dateCol && _txParseAmount(c) != null);
    const amount = amtCol >= 0 ? _txParseAmount(cells[amtCol]) : null;
    if (date == null || amount == null) { skipped++; continue; }
    rows.push({ date, amount });
  }

  const byDate = new Map();
  for (const r of rows) byDate.set(r.date, (byDate.get(r.date) || 0) + r.amount);
  const merged = Array.from(byDate, ([date, amount]) => ({ date, amount }))
    .sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);

  return { rows: merged, skipped, total: merged.reduce((s, r) => s + r.amount, 0) };
}

// Turns transaction rows (sorted ascending) into { initial, entryDate, rows,
// schedule, total, source }. The FIRST row is the seed lump sum (`initial`)
// and sets the entry date — matching how every engine already treats day
// one specially (the "new month" contribution trigger never fires on the
// first day). Everything from the second row on is the contribution
// schedule, in the exact { byDate, byMonth, list } shape
// buildFormulaSchedule (js/simulate.js) already produces.
function _txStateFromRows(rows, source) {
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
  };
}

// ===== Modal ================================================================

let _txParsedPreview = null; // { rows, skipped, total } — last successful parse, pending confirm

function openTxModal() {
  closeTxModal();
  const overlay = document.createElement('div');
  overlay.className = 'sc-modal-overlay';
  overlay.id = 'tx-modal';
  document.body.appendChild(overlay);
  renderTxModal();
  const ta = overlay.querySelector('#tx-paste-area');
  if (ta) ta.focus();
}
function closeTxModal() {
  const modal = document.getElementById('tx-modal');
  if (modal) modal.remove();
  _txParsedPreview = null;
}
function renderTxModal() {
  const modal = document.getElementById('tx-modal');
  if (!modal) return;
  const p = _txParsedPreview;
  const previewHtml = !p ? '' : (!p.rows.length
    ? `<div class="custom-error">No valid rows found — check the date/amount columns.</div>`
    : `<div class="builder-help" style="margin-bottom:8px">
         <b>${p.rows.length}</b> row${p.rows.length === 1 ? '' : 's'} parsed
         ${p.skipped ? `, <b>${p.skipped}</b> skipped` : ''} ·
         total <b>${fmtFull(Math.round(p.total))}</b> ·
         ${fmtDayMonthYear(p.rows[0].date)} → ${fmtDayMonthYear(p.rows[p.rows.length - 1].date)}
       </div>
       <div class="tx-preview-table-wrap"><table class="tx-preview-table">
         <thead><tr><th>Date</th><th>Amount</th></tr></thead>
         <tbody>${p.rows.slice(0, 200).map(r => `<tr><td>${fmtDayMonthYear(r.date)}</td><td>${fmtFull(Math.round(r.amount))}</td></tr>`).join('')}</tbody>
       </table></div>`);
  modal.innerHTML = `
    <div class="builder-modal">
      <div class="sc-modal-title">Use your real transaction history</div>
      <div class="builder-help">Upload a file or paste rows below — one transaction per line, tab or comma separated. The first column is treated as the date and the second as the amount invested, unless a header row names a "Date" column explicitly. The earliest transaction becomes your entry date and starting balance; every later one replaces the Monthly Contribution schedule.</div>
      <input type="file" id="tx-file-input" accept=".csv,.tsv,.txt" style="margin-bottom:10px">
      <textarea id="tx-paste-area" class="builder-textarea" placeholder="Date&#9;Amount&#10;2019-01-03&#9;10000&#10;2019-02-01&#9;500&#10;2019-03-01&#9;500"></textarea>
      <div id="tx-preview">${previewHtml}</div>
      <div class="builder-actions">
        <button type="button" class="sc-modal-btn" data-tx-cancel>Cancel</button>
        <button type="button" class="sc-modal-btn primary" data-tx-confirm ${p && p.rows.length ? '' : 'disabled'}>Use this history</button>
      </div>
    </div>`;
}

function _txHandlePastedText(text) {
  _txParsedPreview = text.trim() ? parseTransactionText(text) : null;
  renderTxModal();
  const ta = document.getElementById('tx-paste-area');
  if (ta) ta.value = text;
}

// ===== Wiring ================================================================

document.addEventListener('click', (e) => {
  if (e.target.closest('#tx-upload-btn')) { openTxModal(); return; }
  if (e.target.closest('[data-tx-cancel]')) { closeTxModal(); return; }
  if (e.target.closest('[data-tx-confirm]')) {
    if (!_txParsedPreview || !_txParsedPreview.rows.length) return;
    const state = _txStateFromRows(_txParsedPreview.rows, 'upload');
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
    _txParsedPreview = e.target.value.trim() ? parseTransactionText(e.target.value) : null;
    renderTxModal();
    // Re-focus + restore cursor since renderTxModal rebuilds the textarea.
    const ta = document.getElementById('tx-paste-area');
    if (ta) { ta.value = e.target.value; ta.focus(); }
  }
});

document.addEventListener('change', (e) => {
  if (e.target.id === 'tx-file-input') {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => _txHandlePastedText(String(reader.result || ''));
    reader.readAsText(file);
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
  el.innerHTML = `<b>${n}</b> transaction${n === 1 ? '' : 's'} · <b>${fmtFull(Math.round(s.total))}</b> total · since ${fmtDayMonthYear(s.entryDate)}`;
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
