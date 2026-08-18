// Initialize: load CSV, derive data, set slider max, restore state, render
(async function init() {
  let QQQ_DAILY, TQQQ_DAILY, SPY_DAILY, QLD_DAILY, SSO_DAILY, SPXL_DAILY, SQQQ_DAILY;
  try {
    [QQQ_DAILY, TQQQ_DAILY, SPY_DAILY, QLD_DAILY, SSO_DAILY, SPXL_DAILY, SQQQ_DAILY] = await Promise.all([
      loadQQQDaily(), loadTQQQDaily(), loadSPYDaily(), loadQLDDaily(), loadSSODaily(), loadSPXLDaily(),
      // SQQQ is a first-class column (0-filled on failure): every engine
      // guards zero prices, so a fetch failure degrades SQQQ options to
      // empty/zero lines instead of blanking the app.
      loadSQQQDaily().catch(() => []),
    ]);
  } catch(e) {
    console.error('Failed to load data:', e);
    // render() never runs on this path, so the loading spinner (index.html)
    // would otherwise spin forever with no explanation.
    const loadingText = document.getElementById('chart-loading-text');
    if (loadingText) {
      loadingText.textContent = 'Could not load market data — try refreshing the page.';
      loadingText.classList.add('is-error');
    }
    const spinner = document.querySelector('#chart-loading .chart-loading-spinner');
    if (spinner) spinner.style.display = 'none';
    return;
  }
  daily = buildDaily(QQQ_DAILY, TQQQ_DAILY, SPY_DAILY, QLD_DAILY, SSO_DAILY, SPXL_DAILY, SQQQ_DAILY);
  // "Last updated" freshness note in the header subtitle — the actual
  // wall-clock time the data was last fetched (written by
  // .github/workflows/update-data.yml into this file in the SAME commit as
  // the data it describes), not just the most recent trading day the data
  // covers. `cache: 'no-store'` because this specific file needs to always
  // reflect the live repo state, unlike the ?v=-busted JS/CSS assets which
  // only change on a real code deploy.
  fetch('data/last-updated.txt', { cache: 'no-store' }).then(r => r.ok ? r.text() : null).then(stamp => {
    const wrap = document.getElementById('data-through');
    const el = document.getElementById('data-fetched-at');
    if (!wrap || !el || !stamp) return;
    // The file is UTC ISO-8601; `new Date()` parses that reliably and its
    // getDate()/getHours()/etc. read back in the VIEWER'S local time zone —
    // that conversion is the whole point of fetching a UTC stamp.
    const d = new Date(stamp.trim());
    if (Number.isNaN(d.getTime())) return;
    const pad2 = (n) => n < 10 ? '0' + n : '' + n;
    el.textContent = d.getDate() + ' ' + _LOG_MONTHS[d.getMonth()] + ', ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
    wrap.removeAttribute('hidden');
    // Exposed so other "as of" stamps (e.g. a custom strategy's signal-metrics
    // panel) can show the same fetch time without re-fetching or reformatting.
    window._dataFetchedAt = d;
  }).catch(() => {});
  quarterlyData = lastOfPeriod(daily, getQuarter).map(d => [d.date, d.tqqq, d.qqq, d.spy, d.qld, d.sso, d.spxl, d.sqqq]);
  monthlyData = lastOfPeriod(daily, getMonth).map(d => [d.date, d.tqqq, d.qqq, d.spy, d.qld, d.sso, d.spxl, d.sqqq]);
  dailyDateToIdx = new Map(daily.map((d, i) => [d.date, i]));
  // Pre-index monthly entries per quarter so simulate()'s hot inner loops
  // become O(2-3) lookups instead of O(monthlyData.length) scans.
  precomputePeriodSeries();
  precomputeMonthlyByQuarter();
  precomputeSMASeries();
  recomputeEarliestQIdx();
  const maxQIdx = quarterlyData.length - 1;
  document.getElementById('slider-exit').value = maxQIdx;
  // Default the entry to Q1 2010 (the TQQQ era — real 3× funds launched then).
  // The first quarter ending on/after 2010-01-01 is Q1 2010; fall back to the
  // earliest quarter if the data starts later.
  let defaultEntryIdx = quarterlyData.findIndex(r => r[0] >= '2010-01-01');
  if (defaultEntryIdx < 0) defaultEntryIdx = 0;
  document.getElementById('slider-entry').value = defaultEntryIdx;
  window._dualRange.setMax(maxQIdx);

  // Restore saved state: URL params > localStorage > defaults
  const params = new URLSearchParams(window.location.search);
  // A shared link carries the app version it was made with (`v`). Upgrade its
  // params to the current scheme before reading anything, so old links keep
  // resolving correctly. `isSharedLink` (any `v` present) also tells us this
  // is someone else's config — we suppress the "reset saved data" prompt so
  // the recipient can't accidentally wipe + reload away the shared params.
  const isSharedLink = params.get('v') !== null;
  // Only migrate when the URL actually carries params. A bare load has none,
  // and a migration is meaningless there — but several steps are of the form
  // "set this key if the link omits it", so on an empty query string they
  // happily inject values and those then override the HTML defaults. That is
  // exactly how the new canonical SMA defaults got clobbered back to the old
  // SPY/SPXL set. Gating on `v` alone would be wrong: legacy pre-versioning
  // links carry params but no `v`, and they still need the older steps.
  const hasAnyParam = Array.from(params.keys()).length > 0;
  if (hasAnyParam && typeof migrateSharedLink === 'function') migrateSharedLink(params);
  const urlMap = { i: 'slider-initial', m: 'slider-monthly', a: 'slider-raise', r: 'slider-rate', e: 'slider-entry', x: 'slider-exit' };
  let hasUrlParams = false;
  for (const [key, sliderId] of Object.entries(urlMap)) {
    const val = params.get(key);
    if (val !== null) {
      // URL `r` is always the rate %, regardless of slider-curve format.
      // URL `r` is the rate %, and `m` is monthly dollars, regardless of the
      // slider curve — convert each back to its slider position.
      const sliderVal = sliderId === 'slider-rate' ? rateToSlider(+val)
        : sliderId === 'slider-monthly' ? monthlyToSlider(+val)
        : val;
      document.getElementById(sliderId).value = sliderVal;
      hasUrlParams = true;
    }
  }

  // Buy & Hold underlying
  if (params.get('bu') !== null) { document.getElementById('select-bh-underlying').value = params.get('bu'); hasUrlParams = true; }
  // SMA strategy params
  if (params.get('sa')  !== null) { document.getElementById('select-sma-asset').value       = params.get('sa');  hasUrlParams = true; }
  if (params.get('sw')  !== null) { document.getElementById('select-sma-window').value      = params.get('sw');  hasUrlParams = true; }
  if (params.get('su')  !== null) { document.getElementById('select-sma-underlying').value  = params.get('su');  hasUrlParams = true; }
  if (params.get('seb') !== null) { document.getElementById('select-sma-entry-buf').value   = params.get('seb'); hasUrlParams = true; }
  if (params.get('sxb') !== null) { document.getElementById('select-sma-exit-buf').value    = params.get('sxb'); hasUrlParams = true; }
  if (params.get('sro') !== null) { document.getElementById('select-sma-rsi-oh').value      = params.get('sro'); hasUrlParams = true; }
  if (params.get('srow') !== null) { document.getElementById('select-sma-rsi-oh-window').value = params.get('srow'); hasUrlParams = true; }
  if (params.get('src') !== null) { document.getElementById('select-sma-rsi-cool').value    = params.get('src'); hasUrlParams = true; }
  if (params.get('srcw') !== null) { document.getElementById('select-sma-rsi-cool-window').value = params.get('srcw'); hasUrlParams = true; }
  if (params.get('scb') !== null) { document.getElementById('select-sma-confirm-buy').value  = params.get('scb'); hasUrlParams = true; }
  if (params.get('scs') !== null) { document.getElementById('select-sma-confirm-sell').value = params.get('scs'); hasUrlParams = true; }
  if (params.get('ssd') !== null) { document.getElementById('select-sma-settle').value        = params.get('ssd'); hasUrlParams = true; }
  if (params.get('scr') !== null) { document.getElementById('select-sma-cashrate').value    = params.get('scr'); hasUrlParams = true; }
  if (params.get('soa') !== null) { document.getElementById('select-sma-out-asset').value   = params.get('soa'); hasUrlParams = true; }
  if (params.get('sdi') !== null) { document.getElementById('select-sma-dca-in').value      = params.get('sdi'); hasUrlParams = true; }
  if (params.get('sdo') !== null) { document.getElementById('select-sma-dca-to-out').value  = params.get('sdo'); hasUrlParams = true; }
  if (params.get('sbg') !== null) { document.getElementById('select-sma-bg-gtfo').value     = params.get('sbg'); hasUrlParams = true; }
  if (params.get('sbga') !== null) { document.getElementById('select-sma-bg-asset').value   = params.get('sbga'); hasUrlParams = true; }
  if (params.get('sbgw') !== null) { document.getElementById('select-sma-bg-window').value  = params.get('sbgw'); hasUrlParams = true; }
  if (params.get('stc') !== null) { document.getElementById('select-sma-cost').value        = params.get('stc'); hasUrlParams = true; }
  // 9sig underlying + signal-line growth
  if (params.get('nu') !== null) { document.getElementById('select-9sig-underlying').value = params.get('nu'); hasUrlParams = true; }
  if (params.get('ng') !== null) { document.getElementById('select-9sig-growth').value     = params.get('ng'); hasUrlParams = true; }
  if (params.get('nc') !== null) { document.getElementById('select-9sig-crashdrop').value  = params.get('nc'); hasUrlParams = true; }
  if (params.get('ncw') !== null){ document.getElementById('select-9sig-crashwin').value   = params.get('ncw'); hasUrlParams = true; }
  if (params.get('ns') !== null) { document.getElementById('select-9sig-spike').value      = params.get('ns'); hasUrlParams = true; }
  if (params.get('np') !== null) { document.getElementById('select-9sig-period').value     = params.get('np'); hasUrlParams = true; }
  if (params.get('nh') !== null) { document.getElementById('select-9sig-cash').value       = params.get('nh'); hasUrlParams = true; }
  if (params.get('nr') !== null) { document.getElementById('select-9sig-cashrate').value   = params.get('nr'); hasUrlParams = true; }
  if (params.get('nbp') !== null){ document.getElementById('select-9sig-buypower').value    = params.get('nbp'); hasUrlParams = true; }
  if (params.get('nd') !== null) { const nd = params.get('nd'); document.getElementById('select-9sig-deploy').value = nd === '1' ? '50' : nd; hasUrlParams = true; }  // legacy '1' = 50%
  if (params.get('tc') !== null) { const tc = params.get('tc'); document.getElementById('select-9sig-target-compound').value = (tc === '1' || tc === 'target') ? 'target' : 'holding'; hasUrlParams = true; }
  if (params.get('npa') !== null) { document.getElementById('select-9sig-park-asset').value = params.get('npa'); hasUrlParams = true; }
  // Toggles
  if (params.get('l')  !== null) { setLogScale(params.get('l') === '1'); hasUrlParams = true; }
  if (params.get('if') !== null) { const b = document.getElementById('chart-inflation-toggle'); if (b) b.setAttribute('aria-pressed', params.get('if') === '1' ? 'true' : 'false'); hasUrlParams = true; }
  if (params.get('rp') !== null) { const el = document.getElementById('select-9sig-rebalance-point'); if (el) el.value = params.get('rp'); hasUrlParams = true; }
  if (params.get('srp') !== null) { const el = document.getElementById('select-9sig-spike-target'); if (el) el.value = params.get('srp'); hasUrlParams = true; }
  if (params.get('ntc') !== null) { const el = document.getElementById('select-9sig-cost'); if (el) el.value = params.get('ntc'); hasUrlParams = true; }
  // Exact-day entry/exit override (calendar picker)
  if (params.get('ed') !== null) { const el = document.getElementById('entry-exact-date'); if (el) el.value = params.get('ed'); hasUrlParams = true; }
  if (params.get('xd') !== null) { const el = document.getElementById('exit-exact-date');  if (el) el.value = params.get('xd'); hasUrlParams = true; }
  // Analytics modal pre-state (modal is opened after render() so the chart exists).
  // as/ab reference a saved/custom strategy as `cfg:<index-into-activeCfgs>`
  // (js/controls.js's share-builder — same array serialized as scz/sc) rather
  // than a raw config id: a raw id is only ever valid in the SENDER's own
  // localStorage (importSharedConfigs always mints a fresh id on import), so
  // resolving it has to wait until _sharedCfgArr exists further below — same
  // "id doesn't survive the round-trip" problem spc/resolveSharedConfigId
  // already solves for the open-panel restore. The plain (non-cfg) case —
  // '9sig', 'bh-tqqq', 'compounded', 'custom', etc. — needs no resolution and
  // is set immediately.
  const asRaw = params.get('as'), abRaw = params.get('ab');
  if (asRaw && !asRaw.startsWith('cfg:')) analyticsStrategy = asRaw;
  if (abRaw && !abRaw.startsWith('cfg:')) analyticsBaseline = abRaw;
  if (params.get('act')) {
    const v = parseAmount(params.get('act'));
    if (Number.isFinite(v) && v > 0) analyticsCustomTarget = v;
  }
  if (params.get('acp')) {
    const v = parseFloat(params.get('acp'));
    if (Number.isFinite(v)) analyticsCustomGrowthPct = v;
  }
  if (params.get('anp')) {
    const v = parseInt(params.get('anp'), 10);
    if (Number.isFinite(v) && v > 0) analyticsYearMin = v;
  }
  if (params.get('amp')) {
    const v = parseInt(params.get('amp'), 10);
    if (Number.isFinite(v) && v > 0) analyticsYearMax = v;
  }

  // Skip the localStorage restore when there's an APP_VERSION mismatch — old
  // state can reference controls/values that no longer exist and poison the
  // UI. The "new version — reset saved data" button (shown below) lets the
  // user wipe + reload to commit the new defaults.
  const skipLS = (typeof _storageVersionMismatch !== 'undefined') && _storageVersionMismatch;
  if (!hasUrlParams && !skipLS) {
    try {
      const saved = JSON.parse(localStorage.getItem(LS_KEY));
      if (saved) {
        SLIDER_IDS.forEach(id => {
          if (saved[id] == null) return;
          // Top pills are canonical — never restore their per-strategy knobs
          // from localStorage (only global investment inputs + date range).
          if (typeof _isStrategyParamId === 'function' && _isStrategyParamId(id)) return;
          const el = document.getElementById(id);
          if (el.type === 'checkbox') {
            el.checked = saved[id] === '1' || saved[id] === true;
            return;
          }
          // localStorage `slider-rate` is the rate %, not the slider position.
          // localStorage stores semantic values for rate (%) and monthly ($),
          // not slider positions, so curve changes stay backward-compatible.
          const v = id === 'slider-rate' ? rateToSlider(+saved[id])
            : id === 'slider-monthly' ? monthlyToSlider(+saved[id])
            : saved[id];
          el.value = v;
        });
        if (saved['toggle-log-scale'] != null) setLogScale(!!saved['toggle-log-scale']);
        if (saved['toggle-inflation'] != null) { const b = document.getElementById('chart-inflation-toggle'); if (b) b.setAttribute('aria-pressed', saved['toggle-inflation'] ? 'true' : 'false'); }
      }
    } catch(e) {}
  }
  window._dualRange.updateUI();
  // Apply the restored 9sig growth-% to the static "9sig" labels in the
  // analytics modal before first render (e.g. URL ?ng=15 → "15sig").
  if (typeof refresh9sigDisplayLabels === 'function') refresh9sigDisplayLabels();
  if (typeof update9sigCashSpans      === 'function') update9sigCashSpans();
  if (typeof updateSmaCashRateVisibility === 'function') updateSmaCashRateVisibility();
  if (typeof syncBgSmaWindowLabel === 'function') syncBgSmaWindowLabel();
  if (typeof updateDeployAvailability === 'function') updateDeployAvailability();
  // Don't offer the localStorage "reset saved data" prompt when viewing a
  // shared link — clicking it would reload to a clean URL and lose the link.
  if (!isSharedLink && typeof showResetVersionButtonIfNeeded === 'function') showResetVersionButtonIfNeeded();
  // Restore set select values directly (no 'change' dispatch) — refresh the
  // preview-dropdown trigger labels so they show the restored values.
  if (typeof window.refreshPreviewTriggers === 'function') window.refreshPreviewTriggers();
  // Saved strategies carried in a share link (`sc`) — merged in; custom ones
  // are flagged untrusted (their code won't run until the user clicks Run).
  // `scz` is the compressed form (current links); `sc` is the older plain one.
  const scz = params.get('scz');
  const sc = params.get('sc');
  // Kept so the `spc` restore below can resolve which of these was the open one.
  let _sharedCfgArr = null;
  if (typeof importSharedConfigs === 'function') {
    let json = null;
    if (scz && typeof unpackSharePayload === 'function') json = await unpackSharePayload(scz);
    else if (sc) { try { json = decodeURIComponent(sc); } catch (e) { json = null; } }
    if (json) {
      try {
        const arr = JSON.parse(json);
        importSharedConfigs(arr);
        if (Array.isArray(arr)) _sharedCfgArr = arr;
      } catch (e) {}
    }
  }
  // Resolve any cfg:<index> analytics selection (see the asRaw/abRaw comment
  // above) now that _sharedCfgArr — the same array those indices point
  // into — and the freshly-imported savedConfigs both exist.
  const resolveAnalyticsCfgKey = (raw) => {
    if (!raw || !raw.startsWith('cfg:') || !_sharedCfgArr) return null;
    const idx = parseInt(raw.slice(4), 10);
    if (!Number.isInteger(idx) || idx < 0 || idx >= _sharedCfgArr.length) return null;
    if (typeof resolveSharedConfigId !== 'function') return null;
    const cid = resolveSharedConfigId(_sharedCfgArr[idx]);
    return cid ? 'cfg:' + cid : null;
  };
  if (asRaw && asRaw.startsWith('cfg:')) {
    const resolved = resolveAnalyticsCfgKey(asRaw);
    if (resolved) analyticsStrategy = resolved;
  }
  if (abRaw && abRaw.startsWith('cfg:')) {
    const resolved = resolveAnalyticsCfgKey(abRaw);
    if (resolved) analyticsBaseline = resolved;
  }

  // Real transaction history (js/transactions.js) — a share link's `txz`/`tx`
  // wins over localStorage, same precedence as the `scz`/`sc` saved-configs
  // restore right above.
  if (typeof _txStateFromRows === 'function') {
    const txz = params.get('txz');
    const tx = params.get('tx');
    let txJson = null;
    if (txz && typeof unpackSharePayload === 'function') txJson = await unpackSharePayload(txz);
    else if (tx) { try { txJson = decodeURIComponent(tx); } catch (e) { txJson = null; } }
    let txRows = null;
    if (txJson) { try { txRows = JSON.parse(txJson); } catch (e) { txRows = null; } }
    if (Array.isArray(txRows) && txRows.length) {
      // A shared link always opens with its transactions active — that's the
      // whole point of sharing it.
      const state = _txStateFromRows(txRows, 'upload');
      window._txSchedule = state;
      window._txScheduleStash = state;
    } else if (typeof loadTransactionsFromStorage === 'function') {
      const loaded = loadTransactionsFromStorage();
      if (loaded) {
        window._txScheduleStash = loaded.state;
        window._txSchedule = loaded.active ? loaded.state : null;
      }
    }
    // NOTE: applyTxEntryDate() deliberately NOT called here — the entry is
    // freely adjustable in transaction mode now (txEffectiveForEntry), and
    // the user's chosen entry was already restored above from the URL/saved
    // sliders; snapping it back to the first transaction would clobber it.
    // The first-transaction default is still applied ON IMPORT (the modal
    // confirm / sheet-load paths in js/transactions.js).
    if (typeof toggleContribMode === 'function') toggleContribMode();
  }
  render();
  // A sheet-linked transaction history re-syncs on every load (fire-and-forget,
  // after the first paint already used the cached copy above) — see
  // refreshTxFromSheet() in js/transactions.js.
  if (typeof refreshTxFromSheet === 'function') refreshTxFromSheet();

  // Apply post-render shared state: dataset visibility + analytics modal.
  // Precedence: URL `hd` > localStorage `hidden-datasets` > chart defaults.
  // We override the chart's per-dataset `hidden: true` defaults explicitly
  // so a saved "show TQQQ Holding" state survives a refresh.
  const applyHiddenList = (hiddenList) => {
    if (!chart || !Array.isArray(hiddenList)) return;
    const hiddenSet = new Set(hiddenList.map(Number).filter(Number.isFinite));
    // 9sig (0, + subs 1/5/6) and SMA (8) have no legend chips anymore — the
    // Strategy Library is their home — so a stored "visible" state must not
    // resurrect a line the user can no longer toggle off.
    const CHIPLESS_BASE = new Set([0, 1, 5, 6, 8]);
    chart.data.datasets.forEach((ds, i) => {
      if (ds._isShift || ds._configLine) return; // saved-config visibility comes from config.hidden
      chart.setDatasetVisibility(i, !CHIPLESS_BASE.has(i) && !hiddenSet.has(i));
    });
    chart.update();
    if (typeof refreshAllLegends === 'function') refreshAllLegends();
  };
  const hd = params.get('hd');
  // `hd=` (empty) is a deliberate "nothing hidden" — distinct from no
  // param at all, which means "fall back to localStorage / defaults".
  if (hd !== null && chart) {
    applyHiddenList(hd === '' ? [] : hd.split(','));
  } else if (chart && !skipLS) {
    try {
      const saved = JSON.parse(localStorage.getItem(LS_KEY));
      if (saved && Array.isArray(saved['hidden-datasets'])) {
        applyHiddenList(saved['hidden-datasets']);
      }
    } catch(e) {}
  }
  if (params.get('am') === '1') {
    // refreshAnalyticsPickers() (called inside toggleAnalytics() below)
    // repopulates both sentence dropdowns from analyticsStrategy/Baseline, so
    // we only need to mirror the Custom Target / Growth input visibility
    // here (refresh doesn't fire the baseline change handler that normally
    // does). skipAutoPick below is what actually keeps the URL-restored
    // as/ab selection from being overwritten.
    const customInput = document.getElementById('analytics-baseline-custom-input');
    const pctInput    = document.getElementById('analytics-baseline-pct-input');
    if (customInput) customInput.setAttribute('hidden', '');
    if (pctInput)    pctInput.setAttribute('hidden', '');
    if (analyticsBaseline === 'custom' && customInput) {
      customInput.removeAttribute('hidden');
      customInput.value = fmtFull(analyticsCustomTarget);
    } else if (analyticsBaseline === 'custom-pct' && pctInput) {
      pctInput.removeAttribute('hidden');
      pctInput.value = String(analyticsCustomGrowthPct);
      const pctDisplay = document.getElementById('analytics-baseline-pct-display');
      if (pctDisplay) {
        pctDisplay.removeAttribute('hidden');
        pctDisplay.textContent = (analyticsCustomGrowthPct >= 0 ? '+' : '') + analyticsCustomGrowthPct + '%';
      }
    }
    // Only skip the chart-based auto-pick when the link actually carried an
    // explicit selection to preserve — if it didn't (analytics was open on
    // its own auto-picked default when shared), auto-picking here matches
    // what would have happened live anyway.
    toggleAnalytics({ skipAutoPick: !!(asRaw || abRaw) });
  }

  // A pinned chart range-selection (js/chart.js's drag-to-select, held with
  // Shift so it stays visible). Shared as exact dates rather than label
  // indices (see js/controls.js's share-builder), re-resolved here against
  // whatever the chart's ACTUAL label grid is post-render — a no-op if the
  // dates don't land on it (e.g. a display-grain or entry/exit difference)
  // rather than pinning a wrong-looking range.
  const rf = params.get('rf'), rt = params.get('rt');
  if (rf && rt && typeof pinRangeSelection === 'function') pinRangeSelection(rf, rt);

  // Reopen the strategy sidebar that was open when the link was shared.
  // `spc` (a specific saved/custom strategy) wins over `sp` (a base panel):
  // openConfigForEdit opens the right panel itself and also loads the strategy's
  // params into the sidebar, which plain openPanelByKey would not.
  const spcRaw = params.get('spc');
  const spcIdx = spcRaw != null ? parseInt(spcRaw, 10) : NaN;
  let opened = false;
  if (_sharedCfgArr && Number.isInteger(spcIdx) && spcIdx >= 0 && spcIdx < _sharedCfgArr.length
      && typeof resolveSharedConfigId === 'function' && typeof openConfigForEdit === 'function') {
    const cid = resolveSharedConfigId(_sharedCfgArr[spcIdx]);
    if (cid) { openConfigForEdit(cid); opened = true; }
  }
  if (!opened) {
    const base = params.get('sp');
    if (base && typeof openPanelByKey === 'function') openPanelByKey(base);
  }
})();
