// Exact-day entry/exit calendar popup. Opened from the small calendar icon
// next to "Entry" / "Exit" (index.html); lets the user pin
// the backtest's start/end to an exact trading day instead of a quarter
// boundary. Writes into the hidden #entry-exact-date / #exit-exact-date
// inputs that render() (chart.js) reads as an override, and that
// initDualRange()'s onChanged() (controls.js) clears the moment the coarse
// quarter slider is touched again.
//
// Structurally a port of preview-dropdown.js's singleton-popup pattern
// (open/close/position/outside-click/Escape/scroll-reposition) rather than a
// new interaction model — see that file for the original.
(function () {
  const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
  // Reuses utils.js's abbreviated month names (Jan, Feb, …) so the month
  // <select> stays narrow enough to sit next to the year <select>.
  const MONTHS = _LOG_MONTHS;

  let openState = null; // { side, popup, trigger, viewYear, viewMonth }

  function closePopup() {
    if (!openState) return;
    openState.popup.remove();
    openState.trigger.classList.remove('date-pick-open');
    openState = null;
    document.removeEventListener('mousedown', onDocDown, true);
    document.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('resize', onReposition);
    window.removeEventListener('scroll', onScroll, true);
  }
  function positionPopup(popup, trigger) {
    const r = trigger.getBoundingClientRect();
    const pw = 240;
    let left = r.left;
    if (left + pw > window.innerWidth - 8) left = window.innerWidth - 8 - pw;
    if (left < 8) left = 8;
    popup.style.left = left + 'px';
    popup.style.top = '';
    popup.style.bottom = '';
    const below = window.innerHeight - r.bottom - 8;
    if (below < 260 && r.top > below) {
      popup.style.bottom = (window.innerHeight - r.top + 4) + 'px';
    } else {
      popup.style.top = (r.bottom + 4) + 'px';
    }
  }
  function onScroll(e) {
    if (!openState) return;
    if (e.target === openState.popup || (openState.popup.contains && openState.popup.contains(e.target))) return;
    const r = openState.trigger.getBoundingClientRect();
    const offscreen = r.bottom < 0 || r.top > window.innerHeight || (r.width === 0 && r.height === 0);
    if (offscreen) { closePopup(); return; }
    positionPopup(openState.popup, openState.trigger);
  }
  function onReposition() { if (openState) positionPopup(openState.popup, openState.trigger); }
  function onDocDown(e) {
    if (openState && !openState.popup.contains(e.target) && e.target !== openState.trigger && !openState.trigger.contains(e.target)) {
      closePopup();
    }
  }
  function onKeyDown(e) { if (e.key === 'Escape') closePopup(); }

  // Effective bound date on the OTHER side (override if set, else the
  // quarter-snapped default) — used to disable invalid days in this picker.
  function effectiveEntryDate() {
    const ov = (document.getElementById('entry-exact-date') || {}).value;
    if (ov) return ov;
    const idx = +((document.getElementById('slider-entry') || {}).value || 0);
    const simIdx = idx > 0 ? idx - 1 : idx;
    return quarterlyData[simIdx] && quarterlyData[simIdx][0];
  }
  function effectiveExitDate() {
    const ov = (document.getElementById('exit-exact-date') || {}).value;
    if (ov) return ov;
    const idx = +((document.getElementById('slider-exit') || {}).value || 0);
    return quarterlyData[idx] && quarterlyData[idx][0];
  }

  function ymFromDate(dateStr) {
    return { y: +dateStr.substring(0, 4), m: +dateStr.substring(5, 7) - 1 };
  }
  function pad2(n) { return n < 10 ? '0' + n : '' + n; }
  // The coarse quarter index whose quarter CONTAINS dateStr — the smallest i
  // such that quarterlyData[i][0] (that quarter's last trading day) >= dateStr.
  // Used to drag the dual-range thumb along to a picked exact day so it
  // doesn't sit frozen at its old position while the label jumps decades —
  // the slider still only has quarter resolution, but it now visibly tracks
  // the right neighborhood instead of visually disagreeing with the label.
  function quarterIdxForDate(dateStr) {
    for (let i = 0; i < quarterlyData.length; i++) {
      if (quarterlyData[i][0] >= dateStr) return i;
    }
    return quarterlyData.length - 1;
  }
  // Clamp a (year, month) pick to the loaded dataset's actual span — the year
  // select offers every year in range, but a month within the boundary
  // year(s) can still fall outside the data (e.g. picking the earliest year
  // with a month before the data's first trading month).
  function clampYearMonth(year, month) {
    const dataMin = ymFromDate(daily[0].date);
    const dataMax = ymFromDate(daily[daily.length - 1].date);
    if (year < dataMin.y || (year === dataMin.y && month < dataMin.m)) return { y: dataMin.y, m: dataMin.m };
    if (year > dataMax.y || (year === dataMax.y && month > dataMax.m)) return { y: dataMax.y, m: dataMax.m };
    return { y: year, m: month };
  }

  function renderGrid(popup, side, year, month) {
    const boundDate = side === 'entry' ? effectiveExitDate() : effectiveEntryDate();
    const dataMin = daily && daily.length ? ymFromDate(daily[0].date) : null;
    const dataMax = daily && daily.length ? ymFromDate(daily[daily.length - 1].date) : null;

    popup.querySelector('.datecal-month-select').value = String(month);
    popup.querySelector('.datecal-year-select').value = String(year);
    const prevBtn = popup.querySelector('[data-nav="-1"]');
    const nextBtn = popup.querySelector('[data-nav="1"]');
    prevBtn.disabled = !!(dataMin && (year < dataMin.y || (year === dataMin.y && month <= dataMin.m)));
    nextBtn.disabled = !!(dataMax && (year > dataMax.y || (year === dataMax.y && month >= dataMax.m)));

    const first = new Date(Date.UTC(year, month, 1));
    const startDow = first.getUTCDay();
    const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

    const cells = [];
    for (let i = 0; i < startDow; i++) cells.push('<span></span>');
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = year + '-' + pad2(month + 1) + '-' + pad2(d);
      const isTradingDay = dailyDateToIdx && dailyDateToIdx.has(dateStr);
      const valid = isTradingDay && (side === 'entry' ? (!boundDate || dateStr < boundDate) : (!boundDate || dateStr > boundDate));
      const curOverride = (document.getElementById(side === 'entry' ? 'entry-exact-date' : 'exit-exact-date') || {}).value;
      const isSel = curOverride === dateStr;
      cells.push(`<button type="button" class="datecal-day${isSel ? ' is-sel' : ''}" data-date="${dateStr}" ${valid ? '' : 'disabled'}>${d}</button>`);
    }
    popup.querySelector('.datecal-grid').innerHTML = cells.join('');
  }

  function openPopup(side, trigger) {
    if (openState && openState.side === side) { closePopup(); return; }
    closePopup();
    if (typeof daily === 'undefined' || !daily || !daily.length) return; // data not loaded yet

    const anchorDate = side === 'entry' ? effectiveEntryDate() : effectiveExitDate();
    const { y, m } = anchorDate ? ymFromDate(anchorDate) : ymFromDate(daily[daily.length - 1].date);
    const dataMinY = ymFromDate(daily[0].date).y;
    const dataMaxY = ymFromDate(daily[daily.length - 1].date).y;
    // Year select spans the whole loaded dataset — jumping straight to e.g.
    // 1980 would otherwise take ~400+ "previous month" clicks from a recent
    // default month.
    const yearOptions = [];
    for (let yr = dataMaxY; yr >= dataMinY; yr--) yearOptions.push(`<option value="${yr}">${yr}</option>`);
    const monthOptions = MONTHS.map((name, i) => `<option value="${i}">${name}</option>`).join('');

    const popup = document.createElement('div');
    popup.className = 'datecal-pop';
    popup.innerHTML = `
      <div class="datecal-head">
        <button type="button" class="datecal-nav" data-nav="-1" aria-label="Previous month">&lsaquo;</button>
        <span class="datecal-title-group">
          <select class="inline-select datecal-month-select" aria-label="Month">${monthOptions}</select>
          <select class="inline-select datecal-year-select" aria-label="Year">${yearOptions.join('')}</select>
        </span>
        <button type="button" class="datecal-nav" data-nav="1" aria-label="Next month">&rsaquo;</button>
      </div>
      <div class="datecal-weekdays">${WEEKDAYS.map(w => `<span>${w}</span>`).join('')}</div>
      <div class="datecal-grid"></div>
      <div class="datecal-footer"><button type="button" class="datecal-clear">use quarter default</button></div>
    `;
    document.body.appendChild(popup);
    positionPopup(popup, trigger);
    trigger.classList.add('date-pick-open');
    openState = { side, popup, trigger, viewYear: y, viewMonth: m };
    renderGrid(popup, side, y, m);

    popup.addEventListener('click', (e) => {
      const nav = e.target.closest('.datecal-nav');
      if (nav && !nav.disabled) {
        let { viewYear, viewMonth } = openState;
        viewMonth += (+nav.dataset.nav);
        if (viewMonth < 0) { viewMonth = 11; viewYear--; }
        else if (viewMonth > 11) { viewMonth = 0; viewYear++; }
        openState.viewYear = viewYear; openState.viewMonth = viewMonth;
        renderGrid(popup, side, viewYear, viewMonth);
        return;
      }
      const dayBtn = e.target.closest('.datecal-day');
      if (dayBtn && !dayBtn.disabled) {
        const id = side === 'entry' ? 'entry-exact-date' : 'exit-exact-date';
        document.getElementById(id).value = dayBtn.dataset.date;
        // Move the coarse slider's thumb to the quarter containing the picked
        // day — without this it stays wherever it last was, which can end up
        // nowhere near a label that just jumped decades. updateUI() only
        // repaints the thumb position from the (now-updated) hidden inputs;
        // it doesn't clear the override the way onChanged() would.
        const sliderId = side === 'entry' ? 'slider-entry' : 'slider-exit';
        document.getElementById(sliderId).value = quarterIdxForDate(dayBtn.dataset.date);
        if (window._dualRange && typeof window._dualRange.updateUI === 'function') window._dualRange.updateUI();
        closePopup();
        if (typeof saveSliders === 'function') saveSliders();
        if (typeof render === 'function') render();
        return;
      }
      if (e.target.closest('.datecal-clear')) {
        const id = side === 'entry' ? 'entry-exact-date' : 'exit-exact-date';
        document.getElementById(id).value = '';
        closePopup();
        if (typeof saveSliders === 'function') saveSliders();
        if (typeof render === 'function') render();
      }
    });

    // Month/year selects — jump straight to any year in range instead of
    // stepping through "previous month" one click at a time.
    popup.addEventListener('change', (e) => {
      if (!e.target.classList.contains('datecal-month-select') && !e.target.classList.contains('datecal-year-select')) return;
      const rawYear = +popup.querySelector('.datecal-year-select').value;
      const rawMonth = +popup.querySelector('.datecal-month-select').value;
      const { y: viewYear, m: viewMonth } = clampYearMonth(rawYear, rawMonth);
      openState.viewYear = viewYear; openState.viewMonth = viewMonth;
      renderGrid(popup, side, viewYear, viewMonth);
    });

    document.addEventListener('mousedown', onDocDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('resize', onReposition);
    window.addEventListener('scroll', onScroll, true);
  }

  document.addEventListener('click', (e) => {
    const entryBtn = e.target.closest('#entry-date-pick');
    const exitBtn = e.target.closest('#exit-date-pick');
    if (entryBtn) { openPopup('entry', entryBtn); return; }
    if (exitBtn) { openPopup('exit', exitBtn); return; }
  });
})();
