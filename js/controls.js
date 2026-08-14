// Slider max is set in init() after data loads

const SLIDER_IDS = ['slider-initial','slider-monthly','slider-raise','slider-rate','slider-entry','slider-exit','entry-exact-date','exit-exact-date','select-bh-underlying','select-sma-asset','select-sma-window','select-sma-underlying','select-9sig-underlying','select-9sig-growth','select-9sig-crashdrop','select-9sig-crashwin','select-9sig-spike','select-9sig-period','select-9sig-cash','select-9sig-cashrate','select-9sig-buypower','select-9sig-deploy','select-9sig-target-compound','select-9sig-park-asset','select-9sig-rebalance-point','select-9sig-spike-target','select-9sig-cost','select-sma-cashrate','select-sma-entry-buf','select-sma-exit-buf','select-sma-rsi-oh','select-sma-rsi-oh-window','select-sma-rsi-cool','select-sma-rsi-cool-window','select-sma-confirm-buy','select-sma-confirm-sell','select-sma-settle','select-sma-out-asset','select-sma-dca-in','select-sma-dca-to-out','select-sma-bg-gtfo','select-sma-bg-asset','select-sma-bg-window','select-sma-cost'];
const LS_KEY = '9sig-sliders';
// Bump APP_VERSION whenever a backwards-incompatible change ships (a control
// id is renamed, a default flips, a strategy is dropped). On mismatch we
// reveal a "new version — reset saved data" button in the header instead of
// nuking storage silently; the user clicks it when they're ready to load
// the new defaults. If they've never visited before (no stored version),
// we just record the current one without prompting.
const APP_VERSION = 28; // bumped when SMA defaults moved to the canonical rule (QQQ signal, cash when out, no buffers); old links pin to the previous SPY/SPXL/0.9/1.6 set
// NOTE: APP_VERSION drives shared-link migration + the localStorage reset
// prompt; bump it only on a breaking param/data change that needs a migration.
// Separately, when you change any js/*.js or styles.css, bump the ?v= cache-bust
// query on the <script>/<link> tags in index.html (its own monotonic counter,
// now ahead of APP_VERSION) so returning browsers fetch the new files.
const LS_VERSION_KEY = '9sig-app-version';
// '9sig-saved-configs' holds user-saved strategies (saved-configs.js). Base
// line-colour overrides and the alternate-runs toggle are session-only, so the
// top pills stay canonical across refreshes. Cleared on a version reset.
// 'tqqq_transactions_v1' (js/transactions.js's LS_TX_KEY — literal here, not
// the identifier, since this file loads before transactions.js) holds the
// real transaction history; a version bump that changes its stored shape
// needs this cleared too, same as the other two, or a returning user keeps
// loading a shape the new code doesn't fully understand.
const LS_KEYS = [LS_KEY, '9sig-saved-configs', 'tqqq_transactions_v1'];

// The top legend pills are canonical reference strategies (9sig, SMA 200,
// Buy & Hold, Invested Compounded). We do NOT persist their per-strategy knobs
// — on reload they always return to canonical defaults; customizations live in
// saved strategies instead. These ids (the union of saved-configs' per-type
// param lists) are skipped on both save and restore.
function _isStrategyParamId(id) {
  if (typeof CONFIG_PARAM_IDS === 'undefined') return false;
  for (const k in CONFIG_PARAM_IDS) {
    if (CONFIG_PARAM_IDS[k].indexOf(id) !== -1) return true;
  }
  return false;
}
let _storageVersionMismatch = false;
(function detectStorageVersion() {
  try {
    const stored = localStorage.getItem(LS_VERSION_KEY);
    if (stored == null) {
      // First-time visitor — no warning, just stamp the current version.
      localStorage.setItem(LS_VERSION_KEY, String(APP_VERSION));
    } else if (stored !== String(APP_VERSION)) {
      _storageVersionMismatch = true;
    }
  } catch (e) {}
})();
function showResetVersionButtonIfNeeded() {
  if (!_storageVersionMismatch) return;
  const btn = document.getElementById('reset-version-btn');
  if (btn) btn.hidden = false;
}

// === Shared-link versioning =============================================
// Ordered list of shared-link migrations. Each entry upgrades the params of
// a link stamped with version `from` toward the current APP_VERSION. When
// someone opens an older link, migrateSharedLink() runs every applicable
// step in order so the link keeps resolving to the same configuration (or an
// intentional redirect target) even after the param scheme changes.
//
// To add one: append { from: <oldVersion>, migrate(params) { ... } } and
// mutate `params` (a URLSearchParams) in place — rename keys, remap values,
// set defaults for newly-required params, or rewrite to a canonical link.
const LINK_MIGRATIONS = [
  // v24: pre-1953 price data was dropped — exactly 60 quarters removed from the
  // front of the series, so every quarter index shifted down by 60. Older links
  // encoded entry/exit (e/x) as indices into the old 1938-based array, so remap
  // them; clamp at 0 for links that pointed into the now-dropped 1938–1952 span.
  { from: 23, migrate(p) {
      for (const k of ['e', 'x']) {
        if (!p.has(k)) continue;
        const v = parseInt(p.get(k), 10);
        if (Number.isFinite(v)) p.set(k, String(Math.max(0, v - 60)));
      }
    } },
  // v25: the SMA "ease into your trades" dropdowns (sdi = buy ease, sdo = backup
  // ease) changed from a MONTH count to a TRADING-DAY count (the engine now
  // spreads the buy per trading day). Convert old month values to the nearest new
  // option: 1mo → 20 days, N mo → N×21 trading days, capped at 6 months (126).
  { from: 24, migrate(p) {
      const conv = (raw) => {
        const v = parseInt(raw, 10);
        if (!Number.isFinite(v) || v <= 0) return 0;
        if (v === 1) return 20;               // ~1 month ≈ 21 days → nearest option
        return Math.min(126, v * 21);         // 2–6 mo land exactly on options; >6 mo clamps
      };
      for (const k of ['sdi', 'sdo']) if (p.has(k)) p.set(k, String(conv(p.get(k))));
    } },
  // v26: the bubble brake got its own moving-average window (sbgw). Before this it
  // always reused the primary signal window (sw). Old links have no sbgw, so mirror
  // sw into it to preserve the original coupled behavior.
  { from: 25, migrate(p) {
      if (!p.has('sbgw') && p.has('sw')) p.set('sbgw', p.get('sw'));
    } },
  // v27: the 9sig spike reset target (srp) became its own dropdown. Before this it
  // always reset back to the starting stock weight (100 − cash%). Old links have no
  // srp, so pin it to the stock weight they implied (cash key nh, default 40).
  { from: 26, migrate(p) {
      if (!p.has('srp')) {
        const cash = p.has('nh') ? parseFloat(p.get('nh')) : 40;
        const stock = Number.isFinite(cash) ? Math.max(0, Math.min(100, 100 - cash)) : 60;
        p.set('srp', String(stock));
      }
    } },
  // v28 (SMA defaults → canonical rule) deliberately has NO migration. The top
  // SMA pill is a canonical reference line built from the HTML defaults at load
  // and frozen against the sidebar knobs (freezeBaseForEditing), so a shared
  // link's sa/soa/seb/sxb never drove it — no old link ever rendered a custom
  // base SMA to preserve. Pinning them would only leave the panel controls
  // disagreeing with the chart. Base-strategy customisation lives in saved
  // strategies, which carry their own params.
];

// Upgrade a shared link's params from the version it was stamped with up to
// the current APP_VERSION. Mutates `params` in place; returns true if it
// changed anything. A link with no `v` is treated as version 0 (legacy,
// pre-versioning).
function migrateSharedLink(params) {
  let linkV = parseInt(params.get('v'), 10);
  if (!Number.isFinite(linkV)) linkV = 0;
  if (linkV >= APP_VERSION) return false;
  let changed = false;
  for (const step of LINK_MIGRATIONS) {
    if (step.from >= linkV && step.from < APP_VERSION) { step.migrate(params); changed = true; }
  }
  params.set('v', String(APP_VERSION));
  return changed;
}
function resetStorageForNewVersion() {
  // Hide the button right away so the click reads as confirmed even if the
  // navigation below takes a beat. Without this the button sits visible
  // until the reload paints, which looks like nothing happened.
  const btn = document.getElementById('reset-version-btn');
  if (btn) btn.hidden = true;
  try {
    for (const k of LS_KEYS) localStorage.removeItem(k);
    localStorage.setItem(LS_VERSION_KEY, String(APP_VERSION));
  } catch (e) {}
  // Reload with a clean URL. `location.replace()` (not `href = pathname`)
  // because assigning the same URL is a no-op when there's no ?query to
  // strip — replace() always navigates and also removes the stale entry
  // from history so back-button can't bounce the user to the pre-reset URL.
  window.location.replace(window.location.pathname);
}

function saveSliders() {
  const vals = {};
  SLIDER_IDS.forEach(id => {
    // Canonical top pills: don't persist per-strategy knobs (see above).
    if (_isStrategyParamId(id)) return;
    const el = document.getElementById(id);
    // Checkboxes store as '1'/'0' (the .value property of a checkbox is the
    // form-submission value, not the checked state).
    let v = (el.type === 'checkbox') ? (el.checked ? '1' : '0') : el.value;
    // Persist the rate as its actual percentage value rather than the raw
    // slider position — keeps storage stable across slider-curve changes and
    // backward-compatible with the old linear slider (which also stored %).
    if (id === 'slider-rate') v = String(sliderToRate(+v));
    if (id === 'slider-monthly') v = String(sliderToMonthly(+v));
    vals[id] = v;
  });
  vals['toggle-log-scale'] =
    document.getElementById('chart-log-toggle').getAttribute('aria-pressed') === 'true';
  vals['toggle-inflation'] =
    (document.getElementById('chart-inflation-toggle') || {}).getAttribute &&
    document.getElementById('chart-inflation-toggle').getAttribute('aria-pressed') === 'true';
  // Per-line visibility (legend-chip eye toggles). Persisted so a plain page
  // refresh restores the same hidden/visible mix the user left things in.
  if (typeof chart !== 'undefined' && chart) {
    const hidden = [];
    chart.data.datasets.forEach((ds, i) => {
      if (ds._isShift || ds._configLine) return; // saved-config visibility lives in its own store
      if (!chart.isDatasetVisible(i)) hidden.push(i);
    });
    vals['hidden-datasets'] = hidden;
  }
  try { localStorage.setItem(LS_KEY, JSON.stringify(vals)); } catch(e) {}
}

// Regular sliders (not entry/exit — those are handled by dual-range)
['slider-initial','slider-monthly','slider-raise','slider-rate'].forEach(id => {
  document.getElementById(id).addEventListener('input', () => {
    // Snap the cash-rate slider to 0.5% increments. The slider itself runs
    // 0-1000 on a quadratic curve, so we round the *rate* (not the slider
    // position) and write back the slider position that matches.
    if (id === 'slider-rate') {
      const el = document.getElementById('slider-rate');
      const snappedRate = Math.round(sliderToRate(+el.value) * 2) / 2;
      const snappedPos  = rateToSlider(snappedRate);
      if (snappedPos !== +el.value) el.value = String(snappedPos);
    }
    if (id === 'slider-monthly') updateDeployAvailability();
    saveSliders();
    render();
  });
});

// Arrow-key stepping for the logarithmic monthly-contribution slider. A single
// slider position (step=1) barely moves the dollar amount at the low end — many
// positions round to the same $ tier — so plain arrow keys feel dead. Intercept
// them and step by one dollar tier per press so each key visibly changes it.
(function () {
  const el = document.getElementById('slider-monthly');
  if (!el || typeof sliderToMonthly !== 'function') return;
  const stepSize = (v) => v < 1500 ? 50 : v < 10000 ? 100 : v < 100000 ? 1000 : 10000;
  el.addEventListener('keydown', (e) => {
    const dir = (e.key === 'ArrowRight' || e.key === 'ArrowUp') ? 1
              : (e.key === 'ArrowLeft'  || e.key === 'ArrowDown') ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    const cur  = sliderToMonthly(+el.value);
    const next = dir > 0 ? cur + stepSize(cur)
                         : Math.max(0, cur - stepSize(Math.max(0, cur - 1)));
    el.value = String(monthlyToSlider(next));
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
})();

// Same fix for the logarithmic initial-investment slider — arrow keys step by
// one dollar tier so each press visibly changes the amount.
(function () {
  const el = document.getElementById('slider-initial');
  if (!el || typeof sliderToInitial !== 'function') return;
  const stepSize = (v) => v < 10000 ? 100 : v < 100000 ? 1000 : v < 1000000 ? 10000 : v < 10000000 ? 100000 : 1000000;
  el.addEventListener('keydown', (e) => {
    const dir = (e.key === 'ArrowRight' || e.key === 'ArrowUp') ? 1
              : (e.key === 'ArrowLeft'  || e.key === 'ArrowDown') ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    const cur  = sliderToInitial(+el.value);
    const next = dir > 0 ? cur + stepSize(cur)
                         : Math.max(0, cur - stepSize(Math.max(0, cur - 1)));
    let ns = initialToSlider(next);
    // The log slider is coarse near $0–$100 (a dollar tier can round back to the
    // same position). Nudge the position until the DISPLAYED amount actually
    // moves in the chosen direction, so a press is never dead.
    let guard = 0;
    while (guard++ < 2000 && ns >= 0 && ns <= 1000 &&
           ((dir > 0 && sliderToInitial(ns) <= cur) || (dir < 0 && sliderToInitial(ns) >= cur))) {
      ns += dir;
    }
    el.value = String(Math.max(0, Math.min(1000, ns)));
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
})();
['select-bh-underlying','select-sma-asset','select-sma-window','select-sma-underlying','select-9sig-underlying','select-9sig-growth','select-9sig-crashdrop','select-9sig-crashwin','select-9sig-spike','select-9sig-period','select-9sig-cash','select-9sig-cashrate','select-9sig-buypower','select-9sig-deploy','select-9sig-target-compound','select-9sig-park-asset','select-9sig-rebalance-point','select-9sig-spike-target','select-9sig-cost','select-sma-cashrate','select-sma-entry-buf','select-sma-exit-buf','select-sma-rsi-oh','select-sma-rsi-oh-window','select-sma-rsi-cool','select-sma-rsi-cool-window','select-sma-confirm-buy','select-sma-confirm-sell','select-sma-settle','select-sma-out-asset','select-sma-dca-in','select-sma-dca-to-out','select-sma-bg-gtfo','select-sma-bg-asset','select-sma-bg-window','select-sma-cost'].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('change', () => {
    saveSliders();
    // Any 9sig knob change can flip the strategy name between "9sig" (all
    // defaults) and "sig" (tweaked), so refresh the display labels for the
    // whole 9sig group, not just growth.
    if (id.startsWith('select-9sig-') && typeof refresh9sigDisplayLabels === 'function') {
      refresh9sigDisplayLabels();
    }
    if (id === 'select-9sig-cash' || id === 'select-9sig-park-asset') update9sigCashSpans();
    if (id === 'select-sma-out-asset') updateSmaCashRateVisibility();
    if (id === 'select-sma-window') syncBgSmaWindowLabel();
    render();
  });
});

// The bubble brake measures its ticker against the SAME moving-average window as
// the main SMA signal, so echo that window count into the "above its N-day
// average" label whenever the window changes (and on load).
function syncBgSmaWindowLabel() {
  const win = (document.getElementById('select-sma-window') || {}).value;
  const label = document.getElementById('bg-sma-window-label');
  if (win && label) label.textContent = win;
}

// Update the inline "(100−x)%" stock-share and spike-reset-target spans
// when the user picks a different initial cash %. Also retitles the
// safety-side label and hides the cash-rate row when the safety side is
// parked as a non-cash asset (the cash rate doesn't apply in that mode).
function update9sigCashSpans() {
  const cashP = +((document.getElementById('select-9sig-cash') || {}).value) || 0;
  const stockP = 100 - cashP;
  const a = document.getElementById('9sig-stock-pct');
  if (a) a.textContent = stockP + '%';
  const park = ((document.getElementById('select-9sig-park-asset') || {}).value) || 'cash';
  const rateRow = document.getElementById('9sig-cashrate-row');
  if (rateRow) rateRow.style.display = park === 'cash' ? '' : 'none';
}

// The SMA cash-interest line only makes sense when you actually sit in cash
// after a sell. If you hold QQQ/SPY instead, there's no idle cash to earn
// interest — so hide the rate line entirely rather than show a dead control.
function updateSmaCashRateVisibility() {
  const out = ((document.getElementById('select-sma-out-asset') || {}).value) || 'cash';
  const line = document.getElementById('sma-cashrate-line');
  if (line) line.style.display = out === 'cash' ? '' : 'none';
}

// The "Deploy 50% of each contribution" toggle only does anything when there
// ARE monthly contributions to split. With $0 monthly it's a no-op, which
// reads as "the checkbox is broken" — so disable + dim it (and surface a
// hint) whenever monthly is 0.
function updateDeployAvailability() {
  const monthly = sliderToMonthly(+((document.getElementById('slider-monthly') || {}).value || 0));
  const cb = document.getElementById('select-9sig-deploy');
  if (!cb) return;
  const hasMonthly = monthly > 0;
  cb.disabled = !hasMonthly;
  const wrap = cb.closest('.adaptive-line') || cb.closest('label');
  if (wrap) {
    wrap.style.opacity = hasMonthly ? '' : '0.45';
    wrap.style.cursor  = hasMonthly ? 'pointer' : 'not-allowed';
    wrap.title = hasMonthly ? '' : 'Set a Monthly Contribution above $0 — this only splits new contributions, not the initial amount.';
  }
}

// Position info-icon tooltips with position:fixed (anchored to the icon
// via JS-set CSS vars) so they escape any overflow:auto ancestor — the
// strategy-panel-body would otherwise clip a tooltip near its top edge
// and the tooltip would appear hidden behind the panel header. We also
// clamp the horizontal anchor by the tooltip's worst-case half-width so
// it can't spill past either viewport edge.
function positionInfoTip(e) {
  const icon = e.target.closest && e.target.closest('.info-icon[data-tip]');
  if (!icon) return;
  const r = icon.getBoundingClientRect();
  // Half the tooltip's CSS max-width — wider for [data-tip-wide] (380px).
  const HALF_W = icon.hasAttribute('data-tip-wide') ? 190 : 130;
  const PAD    = 8;
  const minCx  = HALF_W + PAD;
  const maxCx  = window.innerWidth - HALF_W - PAD;
  let cx = r.left + r.width / 2;
  if (maxCx > minCx) cx = Math.max(minCx, Math.min(maxCx, cx));
  icon.style.setProperty('--tip-left', cx + 'px');
  icon.style.setProperty('--tip-top',  (r.top - 6) + 'px');
}
document.addEventListener('mouseover', positionInfoTip);
document.addEventListener('focusin',   positionInfoTip);


// Draggable resize handle on the strategy panel — like a code-editor split.
// Width persists in its own localStorage key (separate from LS_KEY so it
// survives version resets — it's a harmless UI preference). Clamped so the
// panel can't get uselessly narrow or eat the whole viewport.
const PANEL_WIDTH_KEY = '9sig-panel-width';
const PANEL_MIN_W = 280;
const panelMaxW = () => Math.round(window.innerWidth * 0.98);
function applyPanelWidth(w) {
  const content = document.querySelector('.strategy-panel-content');
  if (!content) return;
  const clamped = Math.max(PANEL_MIN_W, Math.min(panelMaxW(), w));
  content.style.width = clamped + 'px';
}
(function initPanelResizer() {
  const resizer = document.getElementById('strategy-panel-resizer');
  const content = document.querySelector('.strategy-panel-content');
  if (!resizer || !content) return;
  // Restore a saved width on load.
  try {
    const saved = parseFloat(localStorage.getItem(PANEL_WIDTH_KEY));
    if (Number.isFinite(saved)) applyPanelWidth(saved);
  } catch (e) {}

  let startX = 0, startW = 0, dragging = false;
  const onMove = (e) => {
    if (!dragging) return;
    const w = startW + (e.clientX - startX);
    applyPanelWidth(w);
    e.preventDefault();
  };
  const onUp = () => {
    if (!dragging) return;
    dragging = false;
    content.classList.remove('is-resizing');
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    try { localStorage.setItem(PANEL_WIDTH_KEY, String(parseInt(content.style.width, 10) || 360)); } catch (e) {}
  };
  resizer.addEventListener('mousedown', (e) => {
    dragging = true;
    startX = e.clientX;
    startW = content.getBoundingClientRect().width;
    content.classList.add('is-resizing');
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    e.preventDefault();
  });
  // Keep within bounds if the window shrinks.
  window.addEventListener('resize', () => {
    if (content.style.width) applyPanelWidth(parseInt(content.style.width, 10) || 360);
  });
})();

// In-chart "log" pill is the sole source-of-truth for the logarithmic
// Y-axis state — its aria-pressed attribute holds the boolean.
const logPill = document.getElementById('chart-log-toggle');
const isLogScale = () => logPill.getAttribute('aria-pressed') === 'true';
const setLogScale = (on) => logPill.setAttribute('aria-pressed', on ? 'true' : 'false');
logPill.addEventListener('click', () => {
  setLogScale(!isLogScale());
  saveSliders();
  render();
});

// In-chart "real $" pill toggles inflation-adjustment of every line.
const inflPill = document.getElementById('chart-inflation-toggle');
if (inflPill) inflPill.addEventListener('click', () => {
  inflPill.setAttribute('aria-pressed', inflPill.getAttribute('aria-pressed') === 'true' ? 'false' : 'true');
  saveSliders();
  render();
});


// Dual-range slider for period
(function initDualRange() {
  const container = document.getElementById('period-range');
  const fill = container.querySelector('.fill');
  const thumbs = container.querySelectorAll('.thumb');
  const entryThumb = thumbs[0];
  const exitThumb = thumbs[1];
  const entryInput = document.getElementById('slider-entry');
  const exitInput = document.getElementById('slider-exit');
  let maxVal = 108; // updated in init()

  function getMax() { return maxVal; }
  function setMax(v) { maxVal = v; updateUI(); }

  // The entry thumb used to be LOCKED while a real transaction history was
  // active (the schedule assumed its fixed first-transaction start). The
  // schedule is now re-derived for whatever entry the user picks
  // (js/transactions.js's txEffectiveForEntry: earlier entry → $0 start with
  // transactions landing later; mid-history entry → the portfolio's actual
  // value at the cutoff becomes the initial lump), so the entry side is free
  // again. Kept as a function in case a future mode needs to re-lock it.
  function entryLocked() { return false; }

  // The quarter axis is warped so recent quarters get more of the track. Same
  // idea as the monthly-contribution slider's log mapping, just anchored at the
  // right edge instead of the left: it's distance-from-today (in quarters) that
  // goes through the log, so the resolution piles up where you actually aim.
  // On a linear bar one quarter is 0.93% of the track everywhere, and picking
  // "last quarter" means hitting a 3px target.
  //
  // SOFT tames log's near-vertical slope at d=0. Straight log(1+d) would hand
  // the single newest quarter ~15% of the track; dividing by a softening scale
  // (~8 quarters over a 27-year range) brings that to 4.4% while still giving
  // the last 5 years 47% of the bar. The oldest quarters keep 0.32% each —
  // about a third of linear, still wide enough to grab.
  const SOFT = 0.075;                                   // fraction of full range
  function softScale() { return Math.max(1, getMax() * SOFT); }
  function valToPercent(v) {
    const max = getMax();
    if (max <= 0) return 0;
    const s = softScale();
    const d = Math.min(Math.max(max - v, 0), max);      // quarters before today
    return 100 * (1 - Math.log(1 + d / s) / Math.log(1 + max / s));
  }
  function percentToVal(p) {
    const max = getMax();
    if (max <= 0) return 0;
    const s = softScale();
    const q = Math.min(Math.max(p, 0), 100) / 100;
    const d = s * (Math.exp((1 - q) * Math.log(1 + max / s)) - 1);
    return Math.round(Math.min(Math.max(max - d, 0), max));
  }

  function updateUI() {
    const e = +entryInput.value, x = +exitInput.value;
    const ep = valToPercent(e), xp = valToPercent(x);
    entryThumb.style.left = ep + '%';
    exitThumb.style.left = xp + '%';
    fill.style.left = ep + '%';
    fill.style.width = (xp - ep) + '%';
    entryThumb.classList.toggle('thumb-locked', entryLocked());
    entryThumb.title = entryLocked() ? 'Entry is set by your uploaded transactions — clear them to adjust' : '';
  }

  // `side` identifies which thumb actually moved this time ('entry' or
  // 'exit') — only THAT side's exact-day override (js/date-picker.js) gets
  // cleared, so dragging just the entry thumb doesn't silently drop an exit
  // date you deliberately picked, and vice versa. Omitted for the paths that
  // shift BOTH thumbs together (fill-drag, step/keyboard/play) — both
  // positions actually changed there, so both overrides go stale.
  function onChanged(side) {
    const eEl = document.getElementById('entry-exact-date');
    const xEl = document.getElementById('exit-exact-date');
    if ((side === 'entry' || side == null) && eEl && eEl.value) eEl.value = '';
    if ((side === 'exit'  || side == null) && xEl && xEl.value) xEl.value = '';
    saveSliders();
    render();
  }

  // Thumb dragging
  function startThumbDrag(thumb, isEntry) {
    return function(e) {
      if (isEntry && entryLocked()) return;
      e.preventDefault();
      const rect = container.getBoundingClientRect();
      function onMove(ev) {
        const clientX = ev.touches ? ev.touches[0].clientX : ev.clientX;
        const pct = ((clientX - rect.left) / rect.width) * 100;
        let val = percentToVal(pct);
        if (isEntry) {
          val = Math.min(val, +exitInput.value - 1);
          val = Math.max(val, 0);
          entryInput.value = val;
        } else {
          val = Math.max(val, +entryInput.value + 1);
          val = Math.min(val, getMax());
          exitInput.value = val;
        }
        updateUI();
        onChanged(isEntry ? 'entry' : 'exit');
      }
      function onUp() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.removeEventListener('touchmove', onMove);
        document.removeEventListener('touchend', onUp);
      }
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      document.addEventListener('touchmove', onMove, { passive: false });
      document.addEventListener('touchend', onUp);
    };
  }

  entryThumb.addEventListener('mousedown', startThumbDrag(entryThumb, true));
  entryThumb.addEventListener('touchstart', startThumbDrag(entryThumb, true), { passive: false });
  exitThumb.addEventListener('mousedown', startThumbDrag(exitThumb, false));
  exitThumb.addEventListener('touchstart', startThumbDrag(exitThumb, false), { passive: false });

  // Fill bar dragging (moves both thumbs together)
  fill.addEventListener('mousedown', startFillDrag);
  fill.addEventListener('touchstart', startFillDrag, { passive: false });

  function startFillDrag(e) {
    if (entryLocked()) return; // fill-drag moves both thumbs, including the pinned entry
    e.preventDefault();
    const rect = container.getBoundingClientRect();
    const startX = e.touches ? e.touches[0].clientX : e.clientX;
    const startEntry = +entryInput.value;
    const startExit = +exitInput.value;
    const span = startExit - startEntry;

    // Track the drag in PERCENT, not in quarters. A pixel delta is only a fixed
    // number of quarters on a linear axis; with the log warp above, converting
    // pixels straight to quarters would slide the bar at a different rate than
    // the thumbs move, so the fill would drift out from under the cursor. Going
    // through percent keeps the grabbed edge pinned to the pointer, and the
    // window keeps its span in quarters (what you expect when dragging a range).
    const startEntryPct = valToPercent(startEntry);
    function onMove(ev) {
      const clientX = ev.touches ? ev.touches[0].clientX : ev.clientX;
      const dx = clientX - startX;
      const dPct = (dx / rect.width) * 100;
      let newEntry = percentToVal(startEntryPct + dPct);
      let newExit = newEntry + span;
      if (newEntry < 0) { newEntry = 0; newExit = span; }
      if (newExit > getMax()) { newExit = getMax(); newEntry = getMax() - span; }
      entryInput.value = newEntry;
      exitInput.value = newExit;
      updateUI();
      onChanged();
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onUp);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onUp);
  }

  // Click on track to jump nearest thumb
  container.querySelector('.track').addEventListener('click', function(e) {
    const rect = container.getBoundingClientRect();
    const pct = ((e.clientX - rect.left) / rect.width) * 100;
    const val = percentToVal(pct);
    const entry = +entryInput.value, exit = +exitInput.value;
    let side;
    if (!entryLocked() && Math.abs(val - entry) < Math.abs(val - exit)) {
      entryInput.value = Math.min(val, exit - 1);
      side = 'entry';
    } else if (entryLocked() && Math.abs(val - entry) < Math.abs(val - exit)) {
      return; // click landed nearer the pinned entry thumb — ignore rather than move it
    } else {
      exitInput.value = Math.max(val, entry + 1);
      side = 'exit';
    }
    updateUI();
    onChanged(side);
  });

  // Shift the entire range by `dir` quarters; returns true if it actually
  // moved, false at boundary (used to auto-stop the play buttons).
  function step(dir) {
    if (entryLocked()) return false; // shifts both thumbs, including the pinned entry
    const newEntry = +entryInput.value + dir;
    const newExit = +exitInput.value + dir;
    if (newEntry < 0 || newExit > getMax()) return false;
    entryInput.value = newEntry;
    exitInput.value = newExit;
    updateUI();
    onChanged();
    return true;
  }

  // Keyboard: arrow keys move the whole range when container is focused
  container.setAttribute('tabindex', '0');
  container.style.outline = 'none';
  container.addEventListener('keydown', function(e) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    step(e.key === 'ArrowRight' ? 1 : -1);
  });

  // Focus container when any part is interacted with
  container.addEventListener('mousedown', () => container.focus());

  // Play buttons: clicking toggles auto-advance in that direction. Clicking
  // the active button again stops; clicking the opposite button switches
  // direction. Auto-stops when the range hits a boundary.
  const playLeft = document.getElementById('period-play-left');
  const playRight = document.getElementById('period-play-right');
  const PLAY_INTERVAL_MS = 750;
  let playTimer = null;
  let playDir = 0;

  const ICON_LEFT = '◀', ICON_RIGHT = '▶', ICON_STOP = '■';

  function stopPlay() {
    if (playTimer) { clearInterval(playTimer); playTimer = null; }
    playDir = 0;
    playLeft.setAttribute('aria-pressed', 'false');
    playRight.setAttribute('aria-pressed', 'false');
    playLeft.textContent = ICON_LEFT;
    playRight.textContent = ICON_RIGHT;
  }
  function startPlay(dir) {
    stopPlay();
    playDir = dir;
    const btn = dir < 0 ? playLeft : playRight;
    btn.setAttribute('aria-pressed', 'true');
    btn.textContent = ICON_STOP;
    if (!step(dir)) { stopPlay(); return; } // immediate first step, halt if at boundary
    playTimer = setInterval(() => { if (!step(dir)) stopPlay(); }, PLAY_INTERVAL_MS);
  }
  playLeft.addEventListener('click', () => playDir === -1 ? stopPlay() : startPlay(-1));
  playRight.addEventListener('click', () => playDir === 1 ? stopPlay() : startPlay(1));

  // Expose for init()
  window._dualRange = { updateUI, setMax, step, stopPlay };
})();

// Share: encode the full UI state into URL params so the receiver lands on
// the exact same view. Includes sliders, strategy params, toggles, envelope
// opacity, dataset visibility (per-line legend toggles), and the analytics
// modal state (open + selected strategy + selected baseline).
async function shareConfig() {
  const get = (id) => document.getElementById(id);
  const params = new URLSearchParams();
  // Snapshot the pinned range NOW, before any await below — the click that
  // fired this function also bubbles to js/chart.js's outside-click-dismiss
  // listener, which clears the pinned selection as soon as this function's
  // first await yields. Read any later, it's already gone (this is exactly
  // how the rf/rt params silently went missing from shared links).
  const pinnedRange = (typeof getPinnedRangeDates === 'function') ? getPinnedRangeDates() : null;

  // Stamp the app version the link was created with. On load, migrateSharedLink()
  // (see init.js) can detect an older `v` and upgrade/redirect the params so the
  // link keeps producing the same result even after the param scheme changes.
  params.set('v', String(APP_VERSION));

  // Core sliders (existing keys — keep stable so old links keep working)
  params.set('i', get('slider-initial').value);
  params.set('m', String(sliderToMonthly(+get('slider-monthly').value)));
  params.set('a', get('slider-raise').value);
  // Share the rate as percent (matches old-format share URLs and is stable
  // across slider-curve changes).
  params.set('r', String(sliderToRate(+get('slider-rate').value)));
  params.set('e', get('slider-entry').value);
  params.set('x', get('slider-exit').value);
  // Exact-day entry/exit override (calendar picker) — only present when set,
  // so an untouched link is byte-identical to before this feature existed.
  if (get('entry-exact-date') && get('entry-exact-date').value) params.set('ed', get('entry-exact-date').value);
  if (get('exit-exact-date')  && get('exit-exact-date').value)  params.set('xd', get('exit-exact-date').value);

  // Buy & Hold consolidated chip — which underlying it tracks.
  if (get('select-bh-underlying')) params.set('bu', get('select-bh-underlying').value);

  // SMA strategy params (signal asset + window + underlying + buffers/RSI/dip-ladder)
  if (get('select-sma-asset'))       params.set('sa',  get('select-sma-asset').value);
  if (get('select-sma-window'))      params.set('sw',  get('select-sma-window').value);
  if (get('select-sma-underlying'))  params.set('su',  get('select-sma-underlying').value);
  if (get('select-sma-entry-buf'))   params.set('seb', get('select-sma-entry-buf').value);
  if (get('select-sma-exit-buf'))    params.set('sxb', get('select-sma-exit-buf').value);
  if (get('select-sma-rsi-oh'))         params.set('sro',  get('select-sma-rsi-oh').value);
  if (get('select-sma-rsi-oh-window'))  params.set('srow', get('select-sma-rsi-oh-window').value);
  if (get('select-sma-rsi-cool'))       params.set('src',  get('select-sma-rsi-cool').value);
  if (get('select-sma-rsi-cool-window')) params.set('srcw', get('select-sma-rsi-cool-window').value);
  if (get('select-sma-confirm-buy'))    params.set('scb',  get('select-sma-confirm-buy').value);
  if (get('select-sma-confirm-sell'))   params.set('scs',  get('select-sma-confirm-sell').value);
  if (get('select-sma-settle'))         params.set('ssd',  get('select-sma-settle').value);
  if (get('select-sma-cashrate'))    params.set('scr', get('select-sma-cashrate').value);
  if (get('select-sma-out-asset'))   params.set('soa', get('select-sma-out-asset').value);
  if (get('select-sma-dca-in'))      params.set('sdi', get('select-sma-dca-in').value);
  if (get('select-sma-dca-to-out'))  params.set('sdo', get('select-sma-dca-to-out').value);
  if (get('select-sma-bg-gtfo'))     params.set('sbg', get('select-sma-bg-gtfo').value);
  if (get('select-sma-bg-asset'))    params.set('sbga', get('select-sma-bg-asset').value);
  if (get('select-sma-bg-window'))   params.set('sbgw', get('select-sma-bg-window').value);
  if (get('select-sma-cost'))        params.set('stc', get('select-sma-cost').value);

  // 9sig: underlying + signal-line growth + rule customization
  if (get('select-9sig-underlying')) params.set('nu', get('select-9sig-underlying').value);
  if (get('select-9sig-growth'))     params.set('ng', get('select-9sig-growth').value);
  if (get('select-9sig-crashdrop'))  params.set('nc', get('select-9sig-crashdrop').value);
  if (get('select-9sig-crashwin'))   params.set('ncw', get('select-9sig-crashwin').value);
  if (get('select-9sig-spike'))      params.set('ns', get('select-9sig-spike').value);
  if (get('select-9sig-period'))     params.set('np', get('select-9sig-period').value);
  if (get('select-9sig-cash'))       params.set('nh', get('select-9sig-cash').value);
  if (get('select-9sig-cashrate'))   params.set('nr', get('select-9sig-cashrate').value);
  if (get('select-9sig-buypower'))   params.set('nbp', get('select-9sig-buypower').value);
  if (get('select-9sig-deploy'))     params.set('nd', get('select-9sig-deploy').value);
  if (get('select-9sig-target-compound')) params.set('tc', get('select-9sig-target-compound').value);
  if (get('select-9sig-park-asset')) params.set('npa', get('select-9sig-park-asset').value);

  // Toggles
  params.set('l',
    document.getElementById('chart-log-toggle').getAttribute('aria-pressed') === 'true' ? '1' : '0');
  if (document.getElementById('chart-inflation-toggle'))
    params.set('if',
      document.getElementById('chart-inflation-toggle').getAttribute('aria-pressed') === 'true' ? '1' : '0');
  if (get('select-9sig-rebalance-point')) params.set('rp', get('select-9sig-rebalance-point').value);
  if (get('select-9sig-spike-target')) params.set('srp', get('select-9sig-spike-target').value);
  if (get('select-9sig-cost')) params.set('ntc', get('select-9sig-cost').value);

  // Dataset visibility — captures per-line legend toggles. Always set, even
  // if empty, so the URL is fully authoritative. Recipient code treats `hd=`
  // (empty) as "nothing hidden" and skips the localStorage fallback.
  if (typeof chart !== 'undefined' && chart) {
    const hidden = [];
    chart.data.datasets.forEach((ds, i) => {
      if (ds._isShift || ds._configLine) return; // ignore envelope-shift + saved-config datasets
      if (!chart.isDatasetVisible(i)) hidden.push(i);
    });
    params.set('hd', hidden.join(','));
  }

  // Only strategies currently ACTIVE (not toggled off via the eye icon) are
  // shared — an inactive strategy the sender isn't even looking at shouldn't
  // ride along in every link, bloating the URL and handing the recipient a
  // strategy (possibly its full source) the sender never meant to send.
  const activeCfgs = (typeof getSavedConfigs === 'function') ? getSavedConfigs().filter(c => !c.hidden) : [];

  // Open strategy sidebar (which chip's detail panel is showing), by stable key.
  // `sp` covers the four BASE panels; `spc` covers a saved/custom strategy's own
  // panel, as an index into `activeCfgs` — same array, same order, as what
  // gets serialised into `sc`/`scz` below. If the open panel belongs to a
  // HIDDEN strategy, it's simply not in activeCfgs (findIndex → -1 → `spc`
  // stays unset) — there's no shared entry for the recipient to open anyway.
  // A saved base-type strategy sets both: `sp` opens the right panel shape even
  // if the strategy itself fails to resolve on arrival.
  if (typeof getOpenPanelKey === 'function') {
    const pk = getOpenPanelKey();
    if (pk) params.set('sp', pk);
  }
  if (typeof openSavedConfigIndex === 'function') {
    const ci = openSavedConfigIndex(activeCfgs);
    if (ci >= 0) params.set('spc', String(ci));
  }

  // Saved strategies, including custom ones (code + description). SECURITY:
  // shared custom code is never trusted on arrival — it arrives `_transient`
  // (nothing is written to the recipient's localStorage until they click
  // Save) and, like all custom code, ALWAYS runs inside a locked-down Web
  // Worker sandbox (no DOM, storage, cookies, or network), so running someone
  // else's strategy is safe.
  if (activeCfgs.length) {
    const lean = activeCfgs.map(c => {
      const o = { type: c.type, name: c.name, params: c.params || {}, color: c.color };
      if (c.type === 'custom') { o.code = c.code || ''; o.desc = c.desc || ''; }
      return o;
    });
    // `scz` is the deflated payload (see packSharePayload) — a custom
    // strategy's source is long enough that the plain form blows the URL
    // length limit. `sc` stays as the fallback for browsers without
    // CompressionStream, and old links carrying it still load.
    try {
      const json = JSON.stringify(lean);
      const packed = await packSharePayload(json);
      if (packed) params.set('scz', packed);
      else params.set('sc', encodeURIComponent(json));
    } catch (e) {}
  }

  // Real transaction history (js/transactions.js) — same tier of data as
  // saved strategies above: personal, so it rides the same compressed-payload
  // pattern (`txz` deflated, `tx` plain fallback) rather than a plain `t=...`.
  if (window._txSchedule && window._txSchedule.rows && window._txSchedule.rows.length) {
    try {
      const json = JSON.stringify(window._txSchedule.rows);
      const packed = await packSharePayload(json);
      if (packed) params.set('txz', packed);
      else params.set('tx', encodeURIComponent(json));
    } catch (e) {}
  }

  // Analytics modal state. A saved/custom strategy's analyticsStrategy/
  // Baseline value is 'cfg:<local id>' ('cfg:' matches js/analytics.js's
  // CFG_KEY_PREFIX, inlined here rather than referenced cross-file since
  // controls.js loads before analytics.js) — that id only exists in THIS
  // browser's localStorage. On arrival, importSharedConfigs always mints a
  // fresh id, so sharing the raw id can never resolve — same problem
  // spc/resolveSharedConfigId (js/saved-configs.js) already solves for the
  // open-panel restore, and the same fix: share a POSITION in activeCfgs,
  // the same array serialized into scz/sc just below, and let js/init.js
  // resolve it back to a real id after import.
  const shareAnalyticsKey = (key) => {
    if (!key || key.indexOf('cfg:') !== 0) return key;
    const idx = activeCfgs.findIndex(c => c.id === key.slice(4));
    return idx >= 0 ? 'cfg:' + idx : null; // null = hidden/unresolvable — drop the param
  };
  if (typeof isAnalyticsOpen === 'function' && isAnalyticsOpen()) {
    params.set('am', '1');
  }
  if (typeof analyticsStrategy !== 'undefined' && analyticsStrategy && analyticsStrategy !== '9sig') {
    const sharedStrategy = shareAnalyticsKey(analyticsStrategy);
    if (sharedStrategy) params.set('as', sharedStrategy);
  }
  if (typeof analyticsBaseline !== 'undefined' && analyticsBaseline && analyticsBaseline !== 'compounded') {
    const sharedBaseline = shareAnalyticsKey(analyticsBaseline);
    if (sharedBaseline) {
      params.set('ab', sharedBaseline);
      // For 'custom' also share the dollar target; for 'custom-pct' share the
      // growth percentage. Otherwise the receiver falls back to defaults.
      if (analyticsBaseline === 'custom' && typeof analyticsCustomTarget === 'number' && analyticsCustomTarget > 0) {
        params.set('act', String(Math.round(analyticsCustomTarget)));
      }
      if (analyticsBaseline === 'custom-pct' && typeof analyticsCustomGrowthPct === 'number') {
        params.set('acp', String(analyticsCustomGrowthPct));
      }
    }
  }
  if (typeof analyticsYearMin !== 'undefined' && analyticsYearMin != null) {
    params.set('anp', String(analyticsYearMin));
  }
  if (typeof analyticsYearMax !== 'undefined' && analyticsYearMax != null) {
    params.set('amp', String(analyticsYearMax));
  }

  // A pinned chart range-selection (drag-to-select, held with Shift so it
  // stays visible — js/chart.js), snapshotted at the top of this function
  // (see the comment there for why it can't be read here). Shared as the two
  // exact dates, not label indices — the recipient's chart may resolve to a
  // different label grid (a different display grain, or a shifted
  // entry/exit), so js/init.js's pinRangeSelection() re-resolves these dates
  // against whatever labels actually exist there instead of trusting a
  // positional index.
  if (pinnedRange) { params.set('rf', pinnedRange[0]); params.set('rt', pinnedRange[1]); }

  const url = window.location.origin + window.location.pathname + '?' + params.toString();

  const toast = document.getElementById('share-toast');
  // Servers and chat apps start rejecting URLs around 8k characters. The
  // payload is compressed, so this only trips with a pile of long custom
  // strategies — say so rather than handing over a link that 414s.
  const tooLong = url.length > 8000;
  if (toast) toast.textContent = tooLong
    ? 'Link copied — but it is very long (' + Math.round(url.length / 1000) + 'k chars) and some apps may cut it off'
    : 'Link copied to clipboard';
  navigator.clipboard.writeText(url).then(() => {
    if (!toast) return;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), tooLong ? 4000 : 2000);
  }).catch(() => {
    prompt('Copy this link:', url);
  });
}


