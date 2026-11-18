// Years-held window ("CAGR by years held", under "comparison grid" in the
// side panel's "advanced analytics" dropdown). One line per chosen strategy:
// for each number of years held, the median money-weighted CAGR over every
// start year that has been held that long — or the average, the best or the
// worst of them, by the sentence's first dropdown. Hover a column for all four.
//
// It is its own window with its own state (its lines, its start years), built
// on the heatmap's machinery in js/analytics.js: the same cells
// (analyticsCellPlan), one run per start-year row (analyticsRunRows), the
// same keys for a line ('9sig', 'bh-qqq', 'compounded', 'cfg:<id>') and the
// page's money sliders. js/years-held-chart.js draws the lines.
//
// A cell counts only when it is that many whole years: in at a year's end, out
// at a year's end. The data's first year starts a quarter late and the running
// year is not over, so the heatmap's cells there are short and are left out.

// The chart's last column: past it only the oldest start years are left.
const YEARS_HELD_MAX = 50;
const YEARS_HELD_MIN_HEIGHT = 300; // px, when the window leaves the plot less
// A first open draws the main chart's best visible line against this one.
const YEARS_HELD_DEFAULT_COMPARISON = 'bh-tqqq';
// What a point can show of its column's start years: the stat's key in
// yearsHeldStat -> its name in the sentence's dropdown and the tooltip.
const YEARS_HELD_MEASURES = { median: 'Median', average: 'Average', best: 'Best', worst: 'Worst' };
// The info icon's text; the start years it names come from the build.
const yearsHeldInfoText = (startYears) => `Each point is the ${YEARS_HELD_MEASURES[yearsHeldMeasure].toLowerCase()} money-weighted CAGR over the start years${startYears ? ` ${startYears[0]}–${startYears[1]}` : ''} that were held that long: in at the start of the year, out at the end of a year.`;

let yearsHeldKeys = [];        // the lines drawn, as heatmap keys, in the order added
let yearsHeldYearMin = null;   // earliest start year counted; null = the data's first
let yearsHeldYearMax = null;   // latest start year counted; null = the data's last
let yearsHeldMeasure = 'median'; // which of YEARS_HELD_MEASURES the lines show
let yearsHeldBuildEpoch = 0;
let yearsHeldRefreshTimer = null;
let _yearsHeldChart = null;
// The last finished build as drawYearsHeld took it, so a change that needs no
// new runs (what the lines show) only redraws. Null while a message stands in
// for the chart.
let _yearsHeldDrawn = null;

// The share and download buttons wear the analytics modal's icons.
for (const name of ['share', 'download']) {
  document.getElementById('years-held-' + name).innerHTML = document.getElementById('analytics-' + name).innerHTML;
}

function isYearsHeldOpen() {
  return !document.getElementById('years-held-modal').hasAttribute('hidden');
}

function toggleYearsHeld() {
  const modal = document.getElementById('years-held-modal');
  if (!isYearsHeldOpen()) {
    // One chart window at a time: a link can ask for both, and each one's
    // close and Escape assume it is alone.
    if (isAnalyticsOpen()) toggleAnalytics();
    modal.removeAttribute('hidden');
    document.body.style.overflow = 'hidden';
    // Lines whose saved strategy is gone go; with none left (a first open),
    // start from the main chart's best visible line and buy & hold TQQQ.
    yearsHeldKeys = yearsHeldKeys.filter(yearsHeldKeyExists);
    if (!yearsHeldKeys.length) {
      const picks = analyticsChartPicks(null);
      yearsHeldKeys = [...new Set([picks && picks.strategy, YEARS_HELD_DEFAULT_COMPARISON].filter(Boolean))];
    }
    ({ yearMin: yearsHeldYearMin, yearMax: yearsHeldYearMax } = yearRangeControl('years-held').show(yearsHeldYearMin, yearsHeldYearMax));
    buildYearsHeld();
  } else {
    modal.setAttribute('hidden', '');
    document.body.style.overflow = '';
    hideYearsHeldTooltip();
    yearsHeldBuildEpoch++; // stop a build still running behind the closed window
  }
}

// Escape closes the window; with a range pinned on the chart, the first
// Escape only drops the range (the chart's own listener).
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !isYearsHeldOpen()) return;
  if (_yearsHeldChart && _yearsHeldChart.hasRange()) return;
  e.stopPropagation();   // this Escape is spent: the page's other Escape handlers stay out of it
  toggleYearsHeld();
}, true);

// Called from chart.js render() after a setting changed. Debounced, like the
// heatmap's refresh: the runs start once the user stops adjusting.
function refreshYearsHeld() {
  if (!isYearsHeldOpen()) return;
  if (yearsHeldRefreshTimer) clearTimeout(yearsHeldRefreshTimer);
  yearsHeldRefreshTimer = setTimeout(buildYearsHeld, 300);
}

// ----- the lines one can draw ------------------------------------------------

// Every line on offer, grouped as the "+ add a line" dropdown lists them.
function yearsHeldChoices() {
  const builtin = Object.keys(STRATEGY_REGISTRY);
  const isFund = (k) => k.startsWith('bh-');
  return [
    { label: 'Strategies', keys: builtin.filter(k => !isFund(k)) },
    { label: 'Buy & hold', keys: builtin.filter(isFund) },
    { label: 'Saved', keys: getSavedConfigs().map(c => CFG_KEY_PREFIX + c.id) },
    { label: 'Baseline', keys: ['compounded'] },
  ];
}
function yearsHeldKeyExists(key) {
  return yearsHeldChoices().some(group => group.keys.includes(key));
}
// A line's colour: a saved strategy's own, a fund's, else the colour the main
// chart gives that built-in line.
function yearsHeldColor(key) {
  if (isCfgKey(key)) return cfgFromKey(key).color;
  if (key.startsWith('bh-')) return FUND_COLORS[key.slice(3)];
  return getBaseColor(key === 'compounded' ? 'invested' : key);
}

// The sentence: a chip per line (its colour, its name, a remove button), the
// dropdown that adds one, and the money dropdowns.
function renderYearsHeldSentence(money) {
  const chips = yearsHeldKeys.map(key => {
    const label = escA(analyticsKeyLabel(key));
    // A strategy that brings its own deposits has no line here (buildYearsHeld); its chip says so.
    const note = analyticsBringsOwnMoney(key) ? '<span class="yh-chip-note">own deposits, no line</span>' : '';
    return `<span class="yh-chip"><span class="yh-swatch" style="border-top-color:${escA(yearsHeldColor(key))}"></span>${label}${note}`
      + `<button type="button" class="yh-chip-remove" data-yh-remove="${escA(key)}" data-capture="skip" aria-label="Remove ${label}" title="Remove this line">&times;</button></span>`;
  }).join('');
  const groups = yearsHeldChoices().map(group => {
    const options = group.keys.filter(k => !yearsHeldKeys.includes(k))
      .map(k => `<option value="${escA(k)}">${escA(analyticsKeyLabel(k))}</option>`).join('');
    return options ? `<optgroup label="${escA(group.label)}">${options}</optgroup>` : '';
  }).join('');
  document.getElementById('years-held-lines').innerHTML = chips
    + `<span class="yh-add" data-capture="skip"><select id="years-held-add" class="analytics-strat-select" title="Add a strategy's line to the chart"><option value="">+ add a line</option>${groups}</select></span>`;
  document.getElementById('years-held-measure').innerHTML = Object.entries(YEARS_HELD_MEASURES)
    .map(([key, label]) => `<option value="${key}"${key === yearsHeldMeasure ? ' selected' : ''}>${label}</option>`).join('');
  renderMoneySlots('years-held', money.initial, money.monthly, money.annualRaise);
}

// "[Median] CAGR by years held": what the lines show. Every build keeps all
// four numbers per column, so this only redraws; a build still running draws
// the new choice when it lands.
document.addEventListener('change', (e) => {
  if (!e.target || e.target.id !== 'years-held-measure') return;
  yearsHeldMeasure = e.target.value;
  hideYearsHeldTooltip();
  if (_yearsHeldDrawn) drawYearsHeld(..._yearsHeldDrawn);
});

// "+ add a line"
document.addEventListener('change', (e) => {
  if (!e.target || e.target.id !== 'years-held-add' || !e.target.value) return;
  yearsHeldKeys.push(e.target.value);
  buildYearsHeld();
});
// Take a line off the chart: its chip's × and the × after its label on the chart.
function removeYearsHeldLine(key) {
  yearsHeldKeys = yearsHeldKeys.filter(k => k !== key);
  buildYearsHeld();
}
document.addEventListener('click', (e) => {
  const remove = e.target && e.target.closest && e.target.closest('[data-yh-remove]');
  if (remove) removeYearsHeldLine(remove.dataset.yhRemove);
});
// The money dropdowns move the page's own sliders, as the heatmap's do.
document.addEventListener('change', (e) => {
  if (!e.target || !e.target.classList || !e.target.classList.contains('metric-select')) return;
  if (!e.target.closest('#years-held-modal')) return;
  setMoneySlider(e.target.dataset.metricKey, parseFloat(e.target.value));
  buildYearsHeld();
});
// The start-years slider.
document.addEventListener('input', (e) => {
  const isMin = e.target && e.target.id === 'years-held-year-min-input';
  const isMax = e.target && e.target.id === 'years-held-year-max-input';
  if (!isMin && !isMax) return;
  ({ yearMin: yearsHeldYearMin, yearMax: yearsHeldYearMax } = yearRangeControl('years-held').read(isMin));
  buildYearsHeld();
});

// ----- the numbers -----------------------------------------------------------

// A quarter row that closes a year: a December row with a later row after it.
// The data's last row is the running quarter, complete or not.
function isYearEndQuarter(qIdx) {
  return qIdx < quarterlyData.length - 1 && quarterlyData[qIdx][0].substring(5, 7) === '12';
}

// One start-year row's CAGRs: for each of its whole-year cells, the
// money-weighted CAGR (%) of a value series over the row's contributions.
// Returns [{ period, year, cagr }]; a cell with no value or no solvable
// return is left out (the caller counts those).
function yearsHeldRowCagrs(heldCells, entryIdx, values, contributions) {
  const { times, amounts, startDate } = contributions;
  const out = [];
  let count = 0;       // contributions paid in by the cell's end — only grows along the row
  let guess = 0.1;     // each cell's search starts from the one before it
  for (const c of heldCells) {
    const years = _yearsSpan(startDate, quarterlyData[c.exitIdx][0]);
    while (count < times.length && times[count] <= years) count++;
    const cagr = moneyWeightedReturnOfContributions(times, amounts, count, values[c.exitIdx - entryIdx], years, guess);
    if (cagr == null) continue;
    guess = cagr / 100;
    out.push({ period: c.period, year: c.year, cagr });
  }
  return out;
}

// Median, average, best and worst CAGR of one column's start years, with the
// start years behind the two extremes.
function yearsHeldStat(samples) {
  const best = d3.greatest(samples, s => s.cagr), worst = d3.least(samples, s => s.cagr);
  return {
    median: d3.median(samples, s => s.cagr),
    average: d3.mean(samples, s => s.cagr),
    best: best.cagr, bestYear: best.year,
    worst: worst.cagr, worstYear: worst.year,
    count: samples.length,
  };
}

async function buildYearsHeld() {
  if (!quarterlyData) return;
  const epoch = ++yearsHeldBuildEpoch;
  const progEl = document.getElementById('years-held-progress');
  const progBar = document.getElementById('years-held-progress-bar');
  const progText = document.getElementById('years-held-progress-text');
  const money = _analyticsMoneyInputs();
  const keys = yearsHeldKeys.slice(); // the lines this build draws, held for its whole run
  renderYearsHeldSentence(money);
  hideYearsHeldTooltip();

  const plot = mountYearsHeld();
  const stop = (message) => { progEl.setAttribute('hidden', ''); showYearsHeldMessage(plot, message); };
  if (typeof d3 === 'undefined') { stop('D3 still loading — try again in a moment.'); return; }
  if (!keys.length) { stop('Add a line to draw.'); return; }
  const plan = analyticsCellPlan(yearsHeldYearMin, yearsHeldYearMax, keys);
  if (!plan) { stop('Not enough data.'); return; }

  // A saved strategy that brings its own deposits (money: "own") answers to
  // those, not to the sentence's entry amount and monthly investment, so its
  // return against them means nothing: it gets no line. One already known to
  // (the main chart ran it) is not run at all; one found out during this
  // build has its numbers dropped below.
  const knewOwnMoney = keys.filter(analyticsBringsOwnMoney).length;
  const runKeys = keys.filter(key => !analyticsBringsOwnMoney(key));

  // Whole rows go to the runner, so each row's run ends where the heatmap's
  // does and a code strategy's cached runs serve both windows. Rows that start
  // off a year's end (the data's first year) hold no whole-year cell.
  const cells = plan.cells.filter(c => isYearEndQuarter(c.entryIdx));
  const samples = new Map(runKeys.map(key => [key, []]));   // key -> [{ period, year, cagr }]
  let wholeYearCells = 0;
  progEl.removeAttribute('hidden');
  const ran = await analyticsRunRows({
    cells,
    keys: runKeys,
    money,
    isCurrent: () => epoch === yearsHeldBuildEpoch,
    onProgress: (done, total) => {
      progBar.style.width = (total ? (done / total) * 100 : 0).toFixed(1) + '%';
      progText.textContent = done + ' / ' + total;
    },
    onRow: ({ rowCells, entryIdx, seriesByKey }) => {
      const held = rowCells.filter(c => c.period <= YEARS_HELD_MAX && isYearEndQuarter(c.exitIdx));
      if (!held.length) return;
      wholeYearCells += held.length;
      const startDate = quarterlyData[entryIdx][0];
      const lastDate = quarterlyData[held[held.length - 1].exitIdx][0];
      // The money paid in over the row, on the days the engines pay it in: the
      // entry amount, then each month's investment on that month's first
      // trading day (buildFormulaSchedule, js/simulate.js). Dated at the month
      // ends instead, every deposit would count as a month younger than it is
      // and the return would read too high, most of all on short holds.
      const schedule = buildFormulaSchedule(money.monthly, money.annualRaise, startDate, lastDate);
      const flows = buildContributionFlows(money.initial, money.monthly, money.annualRaise, startDate, lastDate, monthlyData, schedule);
      const contributions = { startDate, times: flows.map(f => f.t), amounts: flows.map(f => -f.cf) };
      for (const key of runKeys) samples.get(key).push(...yearsHeldRowCagrs(held, entryIdx, seriesByKey.get(key), contributions));
    },
  });
  if (!ran) return;
  progEl.setAttribute('hidden', '');

  // Each line's stats per column. An own-money strategy keeps its place in
  // the list with no numbers.
  const lines = keys.map(key => {
    const ownMoney = analyticsBringsOwnMoney(key);
    const measured = ownMoney ? [] : samples.get(key);
    const stats = new Map(d3.groups(measured, s => s.period).map(([period, list]) => [period, yearsHeldStat(list)]));
    return { id: key, label: analyticsKeyLabel(key), color: yearsHeldColor(key), stats, solved: measured.length, ownMoney };
  });
  if (lines.filter(l => l.ownMoney).length !== knewOwnMoney) renderYearsHeldSentence(money);   // its chip now says so
  const startYears = d3.extent(d3.merge(lines.filter(l => !l.ownMoney).map(l => samples.get(l.id))), s => s.year);
  _yearsHeldDrawn = [plot, lines, wholeYearCells, startYears];
  drawYearsHeld(..._yearsHeldDrawn);
}

// ----- the drawing -----------------------------------------------------------

// The plot inside the window's chart area. Mounted once; a rebuild keeps the
// drawn chart on screen until the new numbers land. Returns the plot element.
function mountYearsHeld() {
  const wrap = document.getElementById('years-held-chart');
  if (!wrap.querySelector('.years-held-plot')) wrap.innerHTML = '<div class="years-held-wrap"><div class="years-held-plot"></div></div>';
  return wrap.querySelector('.years-held-plot');
}
// A plain message in place of the chart (nothing to draw, or not yet).
function showYearsHeldMessage(plot, message) {
  _yearsHeldDrawn = null;
  plot.innerHTML = `<div class="spiral-loading">${escA(message)}</div>`;
  document.getElementById('years-held-info').dataset.tip = yearsHeldInfoText(null);
}

function drawYearsHeld(plot, lines, wholeYearCells, startYears) {
  if (!lines.some(l => l.solved)) {
    showYearsHeldMessage(plot, 'No start year has a value to measure. Check the entry amount, the monthly investment and the start years.');
    return;
  }
  // What a point is, in the sentence's info icon; a line with windows that
  // gave no value says how many were left out, and one with no line says why.
  const leftOut = lines.filter(l => l.solved < wholeYearCells).map(l => l.ownMoney
    ? ` ${l.label} brings its own deposits, so it is not measured against this window's and has no line.`
    : ` ${l.label}: ${wholeYearCells - l.solved} of ${wholeYearCells} windows had no value and are left out.`).join('');
  document.getElementById('years-held-info').dataset.tip = yearsHeldInfoText(startYears) + leftOut;

  const series = lines.filter(l => l.solved).map(l => ({
    id: l.id, label: l.label, color: l.color,
    points: [...l.stats.keys()].sort((a, b) => a - b).map(years => ({ years, value: l.stats.get(years)[yearsHeldMeasure] })),
  }));
  if (plot.querySelector('.spiral-loading')) plot.innerHTML = '';
  _yearsHeldChart = _yearsHeldChart || new YearsHeldChart();
  _yearsHeldChart
    .container(plot)
    .svgHeight(Math.max(YEARS_HELD_MIN_HEIGHT, plot.clientHeight))
    .data(series)
    .onHover((years, event) => showYearsHeldTooltip(years, event, lines))
    .onLeave(hideYearsHeldTooltip)
    .onRemove(removeYearsHeldLine)
    .rangePctFormat(fmtRangePct)            // the main chart's three-digit % (js/chart.js)
    .keepRangeOn('#years-held-download')    // a pinned range stays for the downloaded image
    .render();
}

// The tooltip for one column: how many start years it holds, then a grid with
// a row per line — its colour and name, then median, average, best and worst
// CAGR. The one the lines show (yearsHeldMeasure) is the value the hovered
// point shows, so it is the large bold one (.is-drawn). The best and the worst
// carry the start year they come from underneath.
function showYearsHeldTooltip(years, event, lines) {
  const tooltip = document.getElementById('years-held-tooltip');
  const shown = lines.filter(l => l.stats.has(years));
  if (!shown.length) { hideYearsHeldTooltip(); return; }
  const pct = (v) => (v < 0 ? '−' : '') + Math.abs(v).toFixed(1) + '%';
  const measures = Object.keys(YEARS_HELD_MEASURES);
  const drawn = (key) => key === yearsHeldMeasure ? ' is-drawn' : '';
  const startYearOf = { best: 'bestYear', worst: 'worstYear' };   // the stats that name the start year behind them
  const rows = shown.map(l => {
    const st = l.stats.get(years);
    return `<span class="yh-tt-name"><span class="yh-swatch" style="border-top-color:${escA(l.color)}"></span><span class="yh-tt-name-text">${escA(l.label)}</span></span>`
      + measures.map(key => `<span class="yh-tt-value${drawn(key)}">${pct(st[key])}${startYearOf[key] ? `<small>${st[startYearOf[key]]}</small>` : ''}</span>`).join('');
  }).join('');
  const count = d3.max(shown, l => l.stats.get(years).count);
  tooltip.innerHTML = `
    <button class="tt-close" type="button" aria-label="Close" data-tt-close>&times;</button>
    <div class="tt-period">
      <span>CAGR, held ${years} ${years === 1 ? 'year' : 'years'}</span>
      <span>${count} start ${count === 1 ? 'year' : 'years'}</span>
    </div>
    <div class="yh-tt-grid">
      <span class="yh-tt-head"></span>${measures.map(key => `<span class="yh-tt-head${drawn(key)}">${YEARS_HELD_MEASURES[key]}</span>`).join('')}
      ${rows}
    </div>
  `;
  tooltip.removeAttribute('hidden');
  positionSpiralTooltip(tooltip, event);
}
function hideYearsHeldTooltip() {
  document.getElementById('years-held-tooltip').setAttribute('hidden', '');
}
// The tooltip's close button (touch): the tooltip and the chart's crosshair go.
document.addEventListener('click', (e) => {
  if (!e.target || !e.target.closest || !e.target.closest('#years-held-tooltip [data-tt-close]')) return;
  hideYearsHeldTooltip();
  _yearsHeldChart.clearHover();
});

function downloadYearsHeld() {
  return downloadChartImage('years-held-modal', 'years-held-chart', `tqqq-cagr-by-years-held-${new Date().toISOString().slice(0, 10)}.png`);
}
