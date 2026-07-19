// Preview dropdowns for the 9sig panel.
//
// Each listed <select> is replaced by a custom trigger button + popup. When
// the popup opens, every option value is run through the 9sig simulation —
// holding ALL other params at their current UI values — and the final
// portfolio value is drawn as a proportional bar next to the option. That
// lets the user scan a whole selector's range and pick the value (or value
// range) that performs best, without changing one knob at a time.
//
// The native <select> stays in the DOM (hidden) as the single source of
// truth. Picking a row writes the value back to it and dispatches 'change',
// so all existing wiring (render, save, share, restore) is untouched.

(function () {
  // Every previewable <select>, with how its option value overrides the right
  // strategy's param bag. `kind` picks the simulation engine:
  //   '9sig' → simulate(), final = log total
  //   'sma'  → simulateSMA(), final = smaPoints value
  //   'bh'   → Buy & Hold; all four underlyings' finals come from ONE 9sig sim
  //            (no per-option resim), so no `apply` is needed.
  const PREVIEW_SELECTS = {
    'select-9sig-cash':       { kind: '9sig', apply: (p, v) => { p.cashPct = (+v || 0) / 100; } },
    'select-9sig-underlying': { kind: '9sig', apply: (p, v) => { p.underlyingCol = v === 'qqq' ? 2 : v === 'spy' ? 3 : v === 'qld' ? 4 : v === 'sso' ? 5 : v === 'spxl' ? 6 : 1; } },
    'select-9sig-cashrate':   { kind: '9sig', apply: (p, v) => { p.cashRate = (+v || 0) / 100; } },
    'select-9sig-period':     { kind: '9sig', apply: (p, v) => { p.rebalancePeriod = v; } },
    'select-9sig-growth':     { kind: '9sig', apply: (p, v) => { p.qGrowth = (+v || 0) / 100; } },
    'select-9sig-crashdrop':  { kind: '9sig', apply: (p, v) => { p.crashDropPct = +v; } },
    'select-9sig-crashwin':   { kind: '9sig', apply: (p, v) => { p.crashLookbackMonths = +v; } },
    'select-9sig-spike':      { kind: '9sig', apply: (p, v) => { p.spikeTriggerPct = +v; } },
    'select-9sig-buypower':   { kind: '9sig', apply: (p, v) => { p.buyThrottlePct = +v; } },
    'select-9sig-park-asset': { kind: '9sig', apply: (p, v) => { p.parkAsset = v; } },
    'select-9sig-deploy':     { kind: '9sig', apply: (p, v) => { p.contribDeployPct = (+v || 0) / 100; } },
    'select-9sig-target-compound': { kind: '9sig', apply: (p, v) => { p.targetFromPrevTarget = v === 'target'; } },
    'select-9sig-rebalance-point': { kind: '9sig', apply: (p, v) => { p.rebalPct = +v || 0; } },
    'select-9sig-spike-target': { kind: '9sig', apply: (p, v) => { p.spikeResetPct = v; } },
    'select-9sig-cost':       { kind: '9sig', apply: (p, v) => { p.tradeCostPct = +v || 0; } },
    'select-bh-underlying':   { kind: 'bh' },
    'select-sma-underlying':  { kind: 'sma', apply: (p, v) => { p.underlyingCol = v === 'qqq' ? 2 : v === 'spy' ? 3 : v === 'qld' ? 4 : v === 'sso' ? 5 : v === 'spxl' ? 6 : 1; } },
    'select-sma-asset':       { kind: 'sma', apply: (p, v) => { p.smaAsset = v; } },
    'select-sma-window':      { kind: 'sma', apply: (p, v) => { p.smaWindow = +v; } },
    'select-sma-cashrate':    { kind: 'sma', apply: (p, v) => { p.cashRate = (+v || 0) / 100; } },
    'select-sma-entry-buf':   { kind: 'sma', apply: (p, v) => { p.entryBufferPct = +v; } },
    'select-sma-exit-buf':    { kind: 'sma', apply: (p, v) => { p.exitBufferPct = +v; } },
    'select-sma-rsi-oh':      { kind: 'sma', apply: (p, v) => { p.rsiOverheatThreshold = +v; } },
    'select-sma-rsi-cool':    { kind: 'sma', apply: (p, v) => { p.rsiCoolThreshold = +v; } },
    'select-sma-out-asset':   { kind: 'sma', apply: (p, v) => { p.outAsset = v; } },
    'select-sma-dca-in':      { kind: 'sma', apply: (p, v) => { p.dcaInMonths = +v; } },
    'select-sma-dca-to-out':  { kind: 'sma', apply: (p, v) => { p.dcaToOutMonths = +v; } },
    'select-sma-bg-gtfo':     { kind: 'sma', apply: (p, v) => { p.bgGtfoPct = +v; } },
    'select-sma-bg-asset':    { kind: 'sma', apply: (p, v) => { p.bgAsset = v; } },
    'select-sma-bg-window':   { kind: 'sma', apply: (p, v) => { p.bgWindow = +v; } },
    'select-sma-cost':        { kind: 'sma', apply: (p, v) => { p.tradeCostPct = +v; } },
    'select-sma-rsi-oh-window':   { kind: 'sma', apply: (p, v) => { p.rsiOhWindow = +v; } },
    'select-sma-rsi-cool-window': { kind: 'sma', apply: (p, v) => { p.rsiCoolWindow = +v; } },
    'select-sma-confirm-buy':     { kind: 'sma', apply: (p, v) => { p.confirmBuySteps = +v; } },
    'select-sma-confirm-sell':    { kind: 'sma', apply: (p, v) => { p.confirmSellSteps = +v; } },
    'select-sma-settle':          { kind: 'sma', apply: (p, v) => { p.settleDays = +v; } },
  };
  const PREVIEW_SELECT_IDS = Object.keys(PREVIEW_SELECTS);

  // Shared base params (initial / monthly / raise / window), incl. the
  // "enter at quarter start" entry shift — mirrors chart.js render().
  function readBaseParams() {
    let entryIdx = +document.getElementById('slider-entry').value;
    let exitIdx  = +document.getElementById('slider-exit').value;
    const maxIdx = quarterlyData.length - 1;
    if (!Number.isFinite(entryIdx) || entryIdx < 0) entryIdx = 0;
    if (!Number.isFinite(exitIdx)  || exitIdx  < 0) exitIdx  = maxIdx;
    if (entryIdx > maxIdx) entryIdx = maxIdx;
    if (exitIdx  > maxIdx) exitIdx  = maxIdx;
    return {
      initial:     sliderToInitial(+document.getElementById('slider-initial').value),
      monthly:     sliderToMonthly(+document.getElementById('slider-monthly').value),
      annualRaise: +document.getElementById('slider-raise').value / 100,
      simEntryIdx: entryIdx > 0 ? entryIdx - 1 : entryIdx,
      exitIdx,
    };
  }
  const _num = (id, d) => { const el = document.getElementById(id); const n = el ? +el.value : NaN; return Number.isFinite(n) ? n : d; };
  const _str = (id, d) => { const el = document.getElementById(id); return el && el.value != null ? el.value : d; };

  function read9sigParams() {
    return Object.assign(readBaseParams(), {
      baselineRate:  sliderToRate(+document.getElementById('slider-rate').value) / 100,
      cashRate:      _num('select-9sig-cashrate', 0) / 100,
      underlyingCol: (function () { const v = _str('select-9sig-underlying', 'tqqq'); return v === 'qqq' ? 2 : v === 'spy' ? 3 : v === 'qld' ? 4 : v === 'sso' ? 5 : v === 'spxl' ? 6 : 1; })(),
      qGrowth:       _num('select-9sig-growth', 9) / 100,
      crashDropPct:  _num('select-9sig-crashdrop', 30),
      crashLookbackMonths: _num('select-9sig-crashwin', 24),
      spikeTriggerPct: _num('select-9sig-spike', 100),
      rebalancePeriod: _str('select-9sig-period', 'quarterly'),
      cashPct:       _num('select-9sig-cash', 40) / 100,
      contribDeployPct: (+((document.getElementById('select-9sig-deploy') || {}).value) || 0) / 100,
      targetFromPrevTarget: ((document.getElementById('select-9sig-target-compound') || {}).value) === 'target',
      rebalPct: _num('select-9sig-rebalance-point', 0),
      buyThrottlePct: _num('select-9sig-buypower', 90),
      parkAsset: _str('select-9sig-park-asset', 'cash'),
      spikeResetPct: _str('select-9sig-spike-target', 'auto'),
      tradeCostPct: _num('select-9sig-cost', 0),
    });
  }

  function readSmaParams() {
    return Object.assign(readBaseParams(), {
      cashRate:      _num('select-sma-cashrate', 0) / 100,
      underlyingCol: (function () { const v = _str('select-sma-underlying', 'tqqq'); return v === 'qqq' ? 2 : v === 'spy' ? 3 : v === 'qld' ? 4 : v === 'sso' ? 5 : v === 'spxl' ? 6 : 1; })(),
      smaAsset:      _str('select-sma-asset', 'qqq'),
      smaWindow:     _num('select-sma-window', 200),
      entryBufferPct: _num('select-sma-entry-buf', 0),
      exitBufferPct:  _num('select-sma-exit-buf', 0),
      rsiOverheatThreshold: _num('select-sma-rsi-oh', 0),
      rsiCoolThreshold: _num('select-sma-rsi-cool', 0),
      outAsset: _str('select-sma-out-asset', 'cash'),
      dcaInMonths: _num('select-sma-dca-in', 0),
      dcaToOutMonths: _num('select-sma-dca-to-out', 0),
      bgGtfoPct:  _num('select-sma-bg-gtfo', 0),
      bgAsset:    _str('select-sma-bg-asset', 'qqq'),
      bgWindow:   _num('select-sma-bg-window', 0),
      tradeCostPct: _num('select-sma-cost', 0),
      rsiOhWindow: _num('select-sma-rsi-oh-window', 10),
      rsiCoolWindow: _num('select-sma-rsi-cool-window', 10),
      rebalanceCheck: 'daily',
      confirmBuySteps: _num('select-sma-confirm-buy', 0),
      confirmSellSteps: _num('select-sma-confirm-sell', 0),
      settleDays: _num('select-sma-settle', 0),
    });
  }

  function nineSigFinal(p) {
    let _qd;
    if (p.rebalPct > 0 && typeof buildEnvelopeQData === 'function' && typeof PERIOD_DAYS !== 'undefined') {
      const pd = PERIOD_DAYS[p.rebalancePeriod] || 63;
      const off = Math.round(p.rebalPct / 100 * (pd - 1));
      const eD = quarterlyData[p.simEntryIdx] && quarterlyData[p.simEntryIdx][0];
      const xD = quarterlyData[p.exitIdx] && quarterlyData[p.exitIdx][0];
      const q = buildEnvelopeQData(p.rebalancePeriod, off, eD, xD);
      if (q && q.length >= 2) _qd = q;
    }
    const r = simulate(p.initial, p.monthly, p.cashRate, p.simEntryIdx, p.exitIdx, p.annualRaise, {
      ...(_qd ? { qData: _qd } : {}),
      qGrowth: p.qGrowth, underlyingCol: p.underlyingCol, crashDropPct: p.crashDropPct,
      crashLookbackMonths: p.crashLookbackMonths, spikeTriggerPct: p.spikeTriggerPct,
      rebalancePeriod: p.rebalancePeriod, cashPct: p.cashPct, contribDeployPct: p.contribDeployPct,
      targetFromPrevTarget: p.targetFromPrevTarget,
      buyThrottlePct: p.buyThrottlePct, parkAsset: p.parkAsset, spikeResetPct: p.spikeResetPct, tradeCostPct: p.tradeCostPct, baselineRate: p.baselineRate, skipBH: true,
    });
    return (r.log && r.log.length) ? r.log[r.log.length - 1].total : 0;
  }
  function smaFinal(p) {
    const r = simulateSMA(p.initial, p.monthly, p.cashRate, p.simEntryIdx, p.exitIdx, p.annualRaise, {
      smaAsset: p.smaAsset, smaWindow: p.smaWindow, underlyingCol: p.underlyingCol,
      entryBufferPct: p.entryBufferPct, exitBufferPct: p.exitBufferPct,
      rsiOverheatThreshold: p.rsiOverheatThreshold, rsiCoolThreshold: p.rsiCoolThreshold,
      outAsset: p.outAsset, dcaInMonths: p.dcaInMonths, dcaToOutMonths: p.dcaToOutMonths,
      bgGtfoPct: p.bgGtfoPct, bgAsset: p.bgAsset, bgWindow: p.bgWindow, tradeCostPct: p.tradeCostPct,
      rsiOhWindow: p.rsiOhWindow, rsiCoolWindow: p.rsiCoolWindow,
      rebalanceCheck: p.rebalanceCheck, confirmBuySteps: p.confirmBuySteps, confirmSellSteps: p.confirmSellSteps, settleDays: p.settleDays,
    });
    return (r.smaPoints && r.smaPoints.length) ? r.smaPoints[r.smaPoints.length - 1].value : 0;
  }
  // One 9sig sim (no skipBH) yields all four Buy & Hold finals at once.
  function bhFinals() {
    const p = read9sigParams();
    const r = simulate(p.initial, p.monthly, p.cashRate, p.simEntryIdx, p.exitIdx, p.annualRaise, {
      qGrowth: p.qGrowth, underlyingCol: p.underlyingCol, crashDropPct: p.crashDropPct,
      crashLookbackMonths: p.crashLookbackMonths, spikeTriggerPct: p.spikeTriggerPct,
      rebalancePeriod: p.rebalancePeriod, cashPct: p.cashPct, contribDeployPct: p.contribDeployPct,
      buyThrottlePct: p.buyThrottlePct, parkAsset: p.parkAsset, baselineRate: p.baselineRate,
    });
    const lastVal = (arr) => (arr && arr.length) ? arr[arr.length - 1].value : 0;
    return { tqqq: lastVal(r.bhPoints), qqq: lastVal(r.qqqPoints), spy: lastVal(r.spyPoints), qld: lastVal(r.qldPoints), sso: lastVal(r.ssoPoints), spxl: lastVal(r.spxlPoints) };
  }

  // Final values for every option of `select`, by its preview kind.
  function totalsFor(select) {
    const spec = PREVIEW_SELECTS[select.id];
    const opts = Array.from(select.options);
    if (spec.kind === 'bh') {
      const f = bhFinals();
      return opts.map(o => f[o.value] || 0);
    }
    const read = spec.kind === 'sma' ? readSmaParams : read9sigParams;
    const run  = spec.kind === 'sma' ? smaFinal : nineSigFinal;
    const base = read();
    return opts.map(o => {
      const p = Object.assign({}, base);
      try { spec.apply(p, o.value); return run(p); } catch (e) { return 0; }
    });
  }

  // ---- popup singleton ----------------------------------------------------
  let openState = null; // { select, popup, trigger }

  function closePopup() {
    if (!openState) return;
    openState.popup.remove();
    openState.trigger.classList.remove('pdrop-open');
    openState = null;
    document.removeEventListener('mousedown', onDocDown, true);
    document.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('resize', onReposition);
    window.removeEventListener('scroll', onScroll, true);
  }
  // Position the fixed popup under (or above) its trigger, clamped to the
  // viewport. Called on open and again whenever the page/panel scrolls or
  // resizes, so the popup stays glued to the trigger instead of closing.
  function positionPopup(popup, trigger) {
    const r = trigger.getBoundingClientRect();
    const pw = Math.max(r.width, 260);
    let left = r.left;
    if (left + pw > window.innerWidth - 8) left = window.innerWidth - 8 - pw;
    if (left < 8) left = 8;
    popup.style.left = left + 'px';
    popup.style.minWidth = pw + 'px';
    popup.style.top = '';
    popup.style.bottom = '';
    const maxH = 340;
    const below = window.innerHeight - r.bottom - 8;
    if (below < 180 && r.top > below) {
      popup.style.bottom = (window.innerHeight - r.top + 4) + 'px';
      popup.style.maxHeight = Math.min(maxH, r.top - 8) + 'px';
    } else {
      popup.style.top = (r.bottom + 4) + 'px';
      popup.style.maxHeight = Math.min(maxH, below) + 'px';
    }
  }
  // On page/panel scroll, keep the popup glued to its trigger rather than
  // closing it (a wheel gesture over a non-scrollable popup scrolls the
  // panel behind it, which used to dismiss the popup on the first scroll).
  // The popup's own internal list scroll is ignored. Close only if the
  // trigger has scrolled out of view entirely.
  function onScroll(e) {
    if (!openState) return;
    if (e.target === openState.popup || (openState.popup.contains && openState.popup.contains(e.target))) return;
    const r = openState.trigger.getBoundingClientRect();
    const offscreen = r.bottom < 0 || r.top > window.innerHeight || (r.width === 0 && r.height === 0);
    if (offscreen) { closePopup(); return; }
    positionPopup(openState.popup, openState.trigger);
  }
  function onReposition() {
    if (openState) positionPopup(openState.popup, openState.trigger);
  }
  function onDocDown(e) {
    if (openState && !openState.popup.contains(e.target) && e.target !== openState.trigger && !openState.trigger.contains(e.target)) {
      closePopup();
    }
  }
  function onKeyDown(e) { if (e.key === 'Escape') closePopup(); }

  function optionText(select, value) {
    const o = Array.from(select.options).find(o => o.value === value);
    return o ? o.textContent : value;
  }

  function openPopup(select, trigger) {
    if (openState && openState.select === select) { closePopup(); return; }
    closePopup();
    const popup = document.createElement('div');
    popup.className = 'pdrop-popup';
    // Build a row per option immediately (bars filled after compute).
    const opts = Array.from(select.options);
    popup.innerHTML = `<div class="pdrop-head">final value if chosen</div>` + opts.map(o =>
      `<div class="pdrop-row${o.value === select.value ? ' selected' : ''}" data-value="${o.value}">
         <span class="pdrop-rlabel">${o.textContent}</span>
         <span class="pdrop-track"><span class="pdrop-fill"></span></span>
         <span class="pdrop-rval">…</span>
       </div>`).join('');
    document.body.appendChild(popup);

    // Lock every row's label column to the widest label so all bar tracks
    // line up (each row is its own grid, so without this they'd size apart).
    let maxLabelW = 0;
    popup.querySelectorAll('.pdrop-rlabel').forEach(el => { maxLabelW = Math.max(maxLabelW, el.offsetWidth); });
    if (maxLabelW > 0) popup.style.setProperty('--pdrop-label-w', Math.ceil(maxLabelW) + 'px');

    // Position under (or above) the trigger, clamped to the viewport.
    positionPopup(popup, trigger);

    trigger.classList.add('pdrop-open');
    openState = { select, popup, trigger };

    // Row click → write back to the native select.
    popup.addEventListener('click', (e) => {
      const row = e.target.closest('.pdrop-row');
      if (!row) return;
      const v = row.dataset.value;
      if (select.value !== v) {
        setSelectValue(select, v);
        // render() (via the change handler) rebuilds the panel, which moves
        // the <select>; renderStrategyPanelBody snapshots + restores the value
        // across that move, so it sticks. We just sync the trigger label.
        select.dispatchEvent(new Event('change', { bubbles: true }));
        syncTrigger(select);
      }
      closePopup();
    });

    // Scroll the selected row into view within the popup's own scroll only,
    // so we never nudge an ancestor (which the scroll handler would react to).
    const sel = popup.querySelector('.pdrop-row.selected');
    if (sel) {
      const target = sel.offsetTop - (popup.clientHeight - sel.offsetHeight) / 2;
      popup.scrollTop = Math.max(0, target);
    }

    document.addEventListener('mousedown', onDocDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('resize', onReposition);
    window.addEventListener('scroll', onScroll, true);

    // Compute totals after the popup paints so the click feels instant.
    setTimeout(() => {
      if (!openState || openState.popup !== popup) return; // closed/changed
      let totals;
      try { totals = totalsFor(select); } catch (e) { return; }
      const rows = Array.from(popup.querySelectorAll('.pdrop-row'));
      const maxT = Math.max(0, ...totals);
      // Highlight EVERY row tied for the top, not just the first. Ties are
      // judged on the shown value so the colouring always matches what the
      // user reads — if two bars display the same number, both go green.
      const maxLabel = fmt(Math.round(maxT));
      // Plateau detection: mark rows as "same as above" ONLY when they're part
      // of a genuine flat run (3+ consecutive identical values) — e.g. a
      // bubble-insurance threshold too high to ever trigger across a whole
      // range. A lone duplicate (just two equal adjacent rows) isn't a plateau
      // and a solitary "=" reads as a glitch, so it's left unmarked.
      const labels = totals.map(t => fmt(Math.round(t)));
      const isPlateauRepeat = new Array(labels.length).fill(false);
      for (let a = 0; a < labels.length;) {
        let b = a;
        while (b + 1 < labels.length && labels[b + 1] === labels[a]) b++;
        if (b - a + 1 >= 3) for (let k = a + 1; k <= b; k++) isPlateauRepeat[k] = true;
        a = b + 1;
      }
      rows.forEach((row, i) => {
        const t = totals[i];
        const pct = maxT > 0 ? Math.max(1.5, (t / maxT) * 100) : 0;
        const fill = row.querySelector('.pdrop-fill');
        const val  = row.querySelector('.pdrop-rval');
        fill.style.width = pct + '%';
        val.textContent = labels[i];
        if (maxT > 0 && labels[i] === maxLabel) row.classList.add('best');
        row.classList.toggle('pdrop-repeat', isPlateauRepeat[i]);
      });
    }, 0);
  }

  // Update the trigger's displayed label from the select's current value.
  // The trigger is re-found from the select's wrapper so this is robust to
  // panel rebuilds that move the nodes around.
  function syncTrigger(select) {
    const wrap = select.closest('.pdrop');
    const trigger = wrap && wrap.querySelector('.pdrop-trigger');
    if (!trigger) return;
    const labelEl = trigger.querySelector('.pdrop-trigger-label');
    if (labelEl) labelEl.textContent = optionText(select, select.value);
  }

  // Set a select's value durably: update both the property AND the `selected`
  // attribute so the choice survives DOM moves (re-inserting a <select> whose
  // option still carries the original `selected` attribute can otherwise snap
  // it back to that default).
  function setSelectValue(select, v) {
    select.value = v;
    Array.from(select.options).forEach(o => {
      if (o.value === v) o.setAttribute('selected', '');
      else o.removeAttribute('selected');
    });
  }

  // Wrap one native select with a trigger button. The select stays in the
  // DOM (hidden) and authoritative.
  function enhance(select) {
    if (!select || select.dataset.pdropEnhanced) return;
    select.dataset.pdropEnhanced = '1';

    const wrap = document.createElement('span');
    wrap.className = 'pdrop';
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'pdrop-trigger inline-select';
    trigger.innerHTML = `<span class="pdrop-trigger-label"></span><span class="pdrop-caret">▾</span>`;

    select.parentNode.insertBefore(wrap, select);
    wrap.appendChild(select);
    wrap.appendChild(trigger);
    select.classList.add('pdrop-native-hidden');

    syncTrigger(select);
    trigger.addEventListener('click', (e) => { e.preventDefault(); openPopup(select, trigger); });
    // Keep the trigger text in sync if the value changes elsewhere (URL
    // restore, analytics dispatch, panel rebuild, etc.).
    select.addEventListener('change', () => syncTrigger(select));
  }

  function init() {
    PREVIEW_SELECT_IDS.forEach(id => enhance(document.getElementById(id)));
  }
  // Lets other code (e.g. init.js after URL/localStorage restore, which sets
  // select values WITHOUT dispatching 'change') refresh every trigger label.
  window.refreshPreviewTriggers = function () {
    PREVIEW_SELECT_IDS.forEach(id => { const s = document.getElementById(id); if (s) syncTrigger(s); });
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
