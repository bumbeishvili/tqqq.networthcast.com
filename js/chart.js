let chart = null;
// How many horizontal gridlines / y-axis labels to draw. Applied both as
// Chart.js's maxTicksLimit (linear) and as an explicit thinning pass after the
// log-scale "nice value" filter, which runs too late for maxTicksLimit to bind.
const Y_TICKS = 8;
// Axis-only money formatting: fmt() pads to a fixed width so columns of numbers
// line up in the tables and tooltips, but on the axis that padding is just
// noise — "$5.000M" says nothing "$5M" doesn't. Trims trailing zeros while
// keeping significant decimals ("$1.500M" → "$1.5M", "$160.3K" unchanged).
// Deliberately NOT applied anywhere else, so table alignment is untouched.
function fmtAxis(v) {
  return String(fmt(v))
    .replace(/(\.\d*[1-9])0+([A-Za-z]*)$/, '$1$2')   // 1.500M → 1.5M
    .replace(/\.0+([A-Za-z]*)$/, '$1');              // 10.00M → 10M
}
// Latest rebalance-log data, surfaced inside the 9sig side panel's table.
// Populated on every render(); cleared when there's not enough data to sim.
let _logData = null;

// ── SMA action markers ────────────────────────────────────────────────────
// Symbols drawn on the SMA line at each real trade (not money-in events).
// Each event type gets its own shape + colour so they're tellable apart, and
// hovering one shows the trade detail. `_smaMarkers` caches on-screen hit-boxes.
const SMA_EVENT_STYLE = {
  ENTER:      { color: "#00b929", shape: "triUp",   label: 'Buy' },
  EXIT:       { color: "#ff2d2e", shape: "triDown", label: 'Sell' },
  'BG-GTFO':  { color: "#b06000", shape: "diamond", label: 'Bubble → cash' },
  'BG-CLEAR': { color: "#023aff", shape: "square",  label: 'Bubble over' },
};
let _smaMarkers = [];
let _smaHoverKey = null;
let _smaLogHideContrib = false; // "hide monthly contributions" checkbox state (sticky across re-renders)

// Toggle the monthly-contribution rows in the SMA transaction log. Flips a class
// on the table wrap (CSS hides .log-row-contrib rows) — no full re-render needed,
// and the state is remembered so it survives the panel re-rendering.
function toggleSmaLogContrib(hide) {
  _smaLogHideContrib = !!hide;
  const body = document.getElementById('strategy-panel-body');
  if (body) body.querySelectorAll('.quarter-table-wrap').forEach(w => w.classList.toggle('hide-contrib', _smaLogHideContrib));
}
let _smaLogHideEase = false; // "hide ease-in slices" checkbox state (collapses DCA-ADD rows)
function toggleSmaLogEase(hide) {
  _smaLogHideEase = !!hide;
  const body = document.getElementById('strategy-panel-body');
  if (body) body.querySelectorAll('.quarter-table-wrap').forEach(w => w.classList.toggle('hide-dca', _smaLogHideEase));
}

// ── Custom-strategy action markers ────────────────────────────────────────
// A custom strategy writes its own log, so the app can't know its internal
// state names. The build prompt pins a small action vocabulary instead — "buy",
// "sell", "switch", "rebalance", "ease-in", "contribution", "hold", "start",
// "end" — and everything here keys off the LEADING word, so a row labelled
// "buy — 3 of 5 slices" still reads as a buy. Only the four trade kinds below
// get a chart symbol; money-in and snapshot rows would just be noise.
const CUSTOM_EVENT_STYLE = {
  buy:       { color: "#00b929", shape: "triUp",   label: 'Buy' },
  sell:      { color: "#ff2d2e", shape: "triDown", label: 'Sell' },
  switch:    { color: "#023aff", shape: "diamond", label: 'Switch' },
  rebalance: { color: "#b06000", shape: "square",  label: 'Rebalance' },
};
// Classify a free-text action into one of the vocabulary kinds. Tolerant on
// purpose: strategies come from an LLM, so near-misses ("exit", "rotate",
// "deposit", "DCA slice") must still land in the right bucket.
function customActionKind(action) {
  const s = String(action == null ? '' : action).trim().toLowerCase();
  if (!s) return 'hold';
  if (/^(contrib|deposit|\+)/.test(s)) return 'contribution';
  if (/^(ease|dca|slice|tranche)/.test(s)) return 'ease';
  if (/^(start|init|open)/.test(s)) return 'start';
  if (/^(end|final)/.test(s)) return 'end';
  if (/^(switch|swap|rotate)/.test(s)) return 'switch';
  if (/^(rebal|trim|adjust)/.test(s)) return 'rebalance';
  if (/^(sell|exit|park)/.test(s)) return 'sell';
  if (/^(buy|enter)/.test(s)) return 'buy';
  if (s.includes('contribution')) return 'contribution';
  if (s.includes('sell')) return 'sell';
  if (s.includes('buy')) return 'buy';
  return 'hold';
}
// Human label for a custom row's action: the strategy's own text when it wrote
// more than the bare keyword, otherwise the kind's stock label.
function customActionLabel(action) {
  const raw = String(action == null ? '' : action).trim();
  const st = CUSTOM_EVENT_STYLE[customActionKind(raw)];
  if (!raw) return 'Hold';
  if (/[\s—:\-]/.test(raw.slice(1)) && raw.length > (st ? st.label.length + 2 : 6)) {
    return raw.charAt(0).toUpperCase() + raw.slice(1);
  }
  return st ? st.label : raw.charAt(0).toUpperCase() + raw.slice(1);
}
// Gain since the previous log row, with any contribution that landed on this
// row removed — so it reads as the holding's own return, like the SMA log's (%).
function customLogGain(log, i) {
  const cur = log[i], prev = i > 0 ? log[i - 1] : null;
  if (!cur || !prev) return null;
  const pv = +prev.value, cv = +cur.value;
  if (!(pv > 0) || !Number.isFinite(cv) || cur.date === prev.date) return null;
  const contrib = Number.isFinite(+cur.contributed) ? +cur.contributed : 0;
  return (cv - pv - contrib) / pv * 100;
}
// The log rows that earn a chart symbol, in log order.
function customMarkerEvents(log) {
  const out = [];
  if (!log) return out;
  for (let i = 0; i < log.length; i++) {
    const r = log[i];
    if (!r || r.date == null || !(+r.value > 0)) continue;
    const st = CUSTOM_EVENT_STYLE[customActionKind(r.action)];
    if (st) out.push({ i: i, row: r, st: st });
  }
  return out;
}

// --- Inflation adjustment ("real $" toggle) ----------------------------------
// When on, every dollar line is expressed in constant start-of-view dollars:
// each point is divided by (1 + rate)^(years since the first label), so the
// chart shows real growth rather than the slice that's just prices rising.
const INFLATION_RATE = 0.03; // ~US long-run average CPI (deflate ~3%/yr)
const _YEAR_MS = 365.25 * 86400000;
function inflationOn() {
  const b = document.getElementById('chart-inflation-toggle');
  return !!b && b.getAttribute('aria-pressed') === 'true';
}
// Deflation multiplier for a date relative to a base date (1 when off / at base).
function inflFactor(date, baseDate) {
  if (!inflationOn() || !baseDate || !date) return 1;
  const years = (Date.parse(date) - Date.parse(baseDate)) / _YEAR_MS;
  return years > 0 ? 1 / Math.pow(1 + INFLATION_RATE, years) : 1;
}
// Deflate every dollar line in place (called each render on freshly-built data,
// so it never compounds). Base date = the first (leftmost) label on screen.
function applyInflationToChart(chart) {
  if (!inflationOn()) return;
  const labels = (chart.data && chart.data.labels) || [];
  if (!labels.length) return;
  const base = labels[0];
  const f = labels.map(d => inflFactor(d, base));
  for (const ds of chart.data.datasets) {
    if (ds && Array.isArray(ds.data)) ds.data = ds.data.map((v, i) => (typeof v === 'number' ? v * (f[i] || 1) : v));
  }
}

// Hover hit-test for the SMA markers: on mousemove over the canvas, find the
// nearest marker within a small radius and show/refresh its detail tooltip.
// While a marker tooltip is up it takes precedence over Chart.js's line hover
// tooltip (hidden here and in externalTooltip) so the two never stack.
// Show the marker detail tooltip anchored above a given marker ({x,y} in canvas
// pixels). Shared by canvas hover and transaction-log row hover.
function showSmaMarkerTooltip(m) {
  const tt = document.getElementById('marker-tooltip');
  if (!tt || !chart) return;
  // Marker tooltip wins over the line tooltip — hide that so the two don't stack.
  const lineTip = document.getElementById('custom-tooltip');
  if (lineTip) lineTip.style.display = 'none';
  const rect = chart.canvas.getBoundingClientRect();
  tt.innerHTML = (m.kind === 'custom') ? customMarkerTooltipHtml(m) : smaMarkerTooltipHtml(m);
  tt.style.display = 'block';
  // Position above the marker, clamped to the viewport.
  const tw = tt.offsetWidth || 180, th = tt.offsetHeight || 80;
  let left = rect.left + m.x - tw / 2;
  left = Math.max(8, Math.min(window.innerWidth - tw - 8, left));
  let top = rect.top + m.y - th - 12;
  if (top < 8) top = rect.top + m.y + 14;
  tt.style.left = left + 'px';
  tt.style.top = top + 'px';
}
function hideSmaMarkerTooltip() {
  const tt = document.getElementById('marker-tooltip');
  if (tt) tt.style.display = 'none';
}
function handleSmaMarkerHover(e) {
  if (!chart) return;
  const rect = chart.canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left, my = e.clientY - rect.top;
  let hit = null, best = 11;
  for (const m of _smaMarkers) {
    const d = Math.hypot(mx - m.x, my - m.y);
    if (d < best) { best = d; hit = m; }
  }
  const newKey = hit ? hit.key : null;
  if (newKey !== _smaHoverKey) {
    _smaHoverKey = newKey;
    if (chart.draw) chart.draw(); // redraw to grow the hovered symbol
  }
  if (hit) showSmaMarkerTooltip(hit);
  else hideSmaMarkerTooltip();
}

function drawSmaMarker(cx, x, y, style, hovered) {
  const r = hovered ? 7 : 5;
  cx.beginPath();
  switch (style.shape) {
    case 'triUp':   cx.moveTo(x, y - r); cx.lineTo(x - r, y + r * 0.85); cx.lineTo(x + r, y + r * 0.85); cx.closePath(); break;
    case 'triDown': cx.moveTo(x, y + r); cx.lineTo(x - r, y - r * 0.85); cx.lineTo(x + r, y - r * 0.85); cx.closePath(); break;
    case 'diamond': cx.moveTo(x, y - r); cx.lineTo(x + r, y); cx.lineTo(x, y + r); cx.lineTo(x - r, y); cx.closePath(); break;
    case 'square':  cx.rect(x - r * 0.8, y - r * 0.8, r * 1.6, r * 1.6); break;
    default:        cx.arc(x, y, r, 0, Math.PI * 2);
  }
  cx.fillStyle = style.color;
  cx.lineWidth = hovered ? 2 : 1.5;
  cx.strokeStyle = hovered ? "#383874" : "rgba(255,255,255,0.9)";
  cx.fill();
  cx.stroke();
}

// Pixel x for an arbitrary date on the category axis: find the two labels that
// bracket it and interpolate between their pixels, so an event lands on its
// real date rather than snapping to the nearest label.
function chartXForDate(c, date) {
  const labs = c.data.labels, xs = c.scales.x;
  let i = 0;
  while (i + 1 < labs.length && labs[i + 1] <= date) i++;
  if (i >= labs.length - 1) return xs.getPixelForValue(labs.length - 1);
  const x0 = xs.getPixelForValue(i), x1 = xs.getPixelForValue(i + 1);
  const t0 = Date.parse(labs[i]), t1 = Date.parse(labs[i + 1]), t = Date.parse(date);
  const frac = t1 > t0 ? (t - t0) / (t1 - t0) : 0;
  return x0 + (x1 - x0) * Math.max(0, Math.min(1, frac));
}
// Inverse of the above for a plain label index (not an arbitrary date) — the
// nearest label index for a canvas-relative pixel x, used by the chart's
// drag-to-select-a-range feature. Category-axis getValueForPixel already
// returns the nearest index; this just clamps it to a valid range.
function chartIndexForPixel(c, px) {
  const labs = c.data.labels;
  if (!labs || !labs.length) return 0;
  const xs = c.scales.x;
  const v = (xs && typeof xs.getValueForPixel === 'function') ? xs.getValueForPixel(px) : 0;
  const i = Math.round(v);
  return Math.max(0, Math.min(labs.length - 1, Number.isFinite(i) ? i : 0));
}
// Markers cluster wherever trades bunch up (both legs of a switch on one day,
// or several trades within a few days at nearly the same portfolio value), so
// they'd stack. Keep x exact and fan the clashing ones vertically: search
// 0, +step, −step, +2·step… for the nearest free slot. `placed` is the
// already-drawn {x, y} list in ascending x.
function spreadMarkerY(placed, x, baseY, area) {
  const MIN = 6; // min center-to-center gap (px); markers are ~10px across
  const clashes = (y) => {
    for (let j = placed.length - 1; j >= 0; j--) {
      if (placed[j].x < x - MIN) break; // x-sorted → nothing further left can clash
      if (Math.hypot(placed[j].x - x, y - placed[j].y) < MIN) return true;
    }
    return false;
  };
  if (!clashes(baseY)) return baseY;
  for (let k = 1; k <= 24; k++) {
    const half = Math.ceil(k / 2) * MIN;
    const cand = baseY + (k % 2 ? half : -half);
    if (cand < area.top + 5 || cand > area.bottom - 5) continue; // stay on-plot
    if (!clashes(cand)) return cand;
  }
  return baseY;
}

function smaMarkerLabel(ev, ulName) {
  const st = SMA_EVENT_STYLE[ev.action];
  if (!st) return ev.action;
  if (ev.action === 'ENTER') return 'Buy ' + ulName;
  if (ev.action === 'EXIT')  return 'Sell ' + ulName;
  return st.label;
}

// A mini SVG of the marker's own shape, so the tooltip visually ties to the
// exact symbol on the chart (same shape + colour).
function markerShapeSvg(shape, color) {
  const inner = {
    triUp:   '<polygon points="7,1.5 12.5,11.5 1.5,11.5"/>',
    triDown: '<polygon points="7,12.5 1.5,2.5 12.5,2.5"/>',
    diamond: '<polygon points="7,1 13,7 7,13 1,7"/>',
    square:  '<rect x="2" y="2" width="10" height="10" rx="1.5"/>',
  }[shape] || '<circle cx="7" cy="7" r="5.5"/>';
  return `<svg viewBox="0 0 14 14" width="15" height="15" style="fill:${color};stroke:rgba(56,56,116,0.35);stroke-width:1">${inner}</svg>`;
}
// Small stroked row icon for the tooltip metrics.
function mtIco(paths) {
  return `<svg class="mt-ico" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
}
function smaMarkerTooltipHtml(m) {
  const ev = m.ev, st = m.st;
  const smaLog = _logData && _logData.smaLog;
  const i = (m.i != null) ? m.i : (smaLog ? smaLog.indexOf(ev) : -1);
  // Same label + gain the table shows for this row, so the tooltip mirrors it.
  const info = (smaLog && i >= 0) ? smaLogRowInfo(smaLog, i, m.ulName)
                                  : { label: smaMarkerLabel(ev, m.ulName), gain: null };
  const held  = (ev.held || ev.state || '').toString().toUpperCase();
  // Deflate to real $ (matching the chart) when the toggle is on.
  const _f = inflFactor(ev.date, chart && chart.data && chart.data.labels && chart.data.labels[0]);
  const total = Math.round((ev.total || 0) * _f);
  const invested = Math.round((ev.invested || 0) * _f);
  const profit = total - invested;
  const date = (typeof fmtLogDate === 'function') ? fmtLogDate(ev.date) : ev.date;
  const gainPill = info.gain != null
    ? `<span class="mt-gain" style="color:${info.gain >= 0 ? 'var(--green-text)' : 'var(--red-text)'};background:${info.gain >= 0 ? 'rgba(0,185,41,0.14)' : 'rgba(255,45,46,0.12)'}">${info.gain >= 0 ? '▲ ' : '▼ '}${Math.abs(info.gain).toFixed(1)}%</span>`
    : '';
  const ICON = {
    box:     '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>',
    dollar:  STAT_ICONS.dollar,
    deposit: '<path d="M12 3v13"/><polyline points="7 11 12 16 17 11"/><line x1="4" y1="21" x2="20" y2="21"/>',
    trend:   profit >= 0 ? STAT_ICONS.trendUp : STAT_ICONS.trendDown,
  };
  const pc = profit >= 0 ? 'var(--green)' : 'var(--red)';
  return `
    <div class="mt-head">
      <span class="mt-shape">${markerShapeSvg(st.shape, st.color)}</span>
      <div class="mt-htext">
        <div class="mt-title" style="color:${st.color}">${info.label}</div>
        <div class="mt-sub">${i >= 0 ? '#' + i + ' · ' : ''}${date}</div>
      </div>
      ${gainPill}
    </div>
    <div class="mt-rows">
      <div class="mt-row"><span class="mt-k">${mtIco(ICON.box)}Holding</span><b>${held}</b></div>
      <div class="mt-row mt-strong"><span class="mt-k">${mtIco(ICON.dollar)}Portfolio</span><b>${fmtFull(total)}</b></div>
      <div class="mt-row"><span class="mt-k">${mtIco(ICON.deposit)}Invested</span><b>${fmtFull(invested)}</b></div>
      <div class="mt-row"><span class="mt-k">${mtIco(ICON.trend)}Profit</span><b style="color:${pc}">${profit >= 0 ? '+' : '−'}${fmtFull(Math.abs(profit))}</b></div>
    </div>`;
}

// Same tooltip, for a custom strategy's action point. The row is whatever the
// strategy logged, so every line is conditional: we show the standard keys it
// filled in (holding, price, cash, portfolio, invested) and skip the rest.
function customMarkerTooltipHtml(m) {
  const r = m.row, st = m.st;
  const log = (window._customLogs || {})[window._openCustomCfgId] || [];
  const gain = customLogGain(log, m.i);
  const labels = chart && chart.data && chart.data.labels;
  const _f = inflFactor(r.date, labels && labels[0]);
  const num = (v) => (Number.isFinite(+v) ? +v : null);
  const total = num(r.value) != null ? Math.round(num(r.value) * _f) : null;
  const invested = num(r.invested) != null ? Math.round(num(r.invested) * _f) : null;
  const cash = num(r.cash) != null ? Math.round(num(r.cash) * _f) : null;
  const price = num(r.price);
  const held = (r.held != null && r.held !== '') ? String(r.held).toUpperCase() : null;
  const date = (typeof fmtLogDate === 'function') ? fmtLogDate(r.date) : r.date;
  const gainPill = gain != null
    ? `<span class="mt-gain" style="color:${gain >= 0 ? 'var(--green-text)' : 'var(--red-text)'};background:${gain >= 0 ? 'rgba(0,185,41,0.14)' : 'rgba(255,45,46,0.12)'}">${gain >= 0 ? '▲ ' : '▼ '}${Math.abs(gain).toFixed(1)}%</span>`
    : '';
  const ICON = {
    box:     '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>',
    tag:     '<path d="M20.59 13.41 13.42 20.6a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/>',
    dollar:  STAT_ICONS.dollar,
    deposit: '<path d="M12 3v13"/><polyline points="7 11 12 16 17 11"/><line x1="4" y1="21" x2="20" y2="21"/>',
  };
  const rows = [];
  if (held) rows.push(`<div class="mt-row"><span class="mt-k">${mtIco(ICON.box)}Holding</span><b>${held}</b></div>`);
  if (price != null && price > 0) rows.push(`<div class="mt-row"><span class="mt-k">${mtIco(ICON.tag)}Price</span><b>${fmtLogPrice(price)}</b></div>`);
  if (total != null) rows.push(`<div class="mt-row mt-strong"><span class="mt-k">${mtIco(ICON.dollar)}Portfolio</span><b>${fmtFull(total)}</b></div>`);
  if (cash != null && cash > 0) rows.push(`<div class="mt-row"><span class="mt-k">${mtIco(ICON.dollar)}Cash</span><b>${fmtFull(cash)}</b></div>`);
  if (invested != null) {
    rows.push(`<div class="mt-row"><span class="mt-k">${mtIco(ICON.deposit)}Invested</span><b>${fmtFull(invested)}</b></div>`);
    if (total != null) {
      const profit = total - invested;
      const pc = profit >= 0 ? 'var(--green)' : 'var(--red)';
      const ico = profit >= 0 ? STAT_ICONS.trendUp : STAT_ICONS.trendDown;
      rows.push(`<div class="mt-row"><span class="mt-k">${mtIco(ico)}Profit</span><b style="color:${pc}">${profit >= 0 ? '+' : '−'}${fmtFull(Math.abs(profit))}</b></div>`);
    }
  }
  const note = (r.note != null && r.note !== '') ? `<div class="mt-note">${String(r.note).replace(/[<>&]/g, '')}</div>` : '';
  return `
    <div class="mt-head">
      <span class="mt-shape">${markerShapeSvg(st.shape, st.color)}</span>
      <div class="mt-htext">
        <div class="mt-title" style="color:${st.color}">${customActionLabel(r.action)}</div>
        <div class="mt-sub">#${m.i} · ${date}</div>
      </div>
      ${gainPill}
    </div>
    <div class="mt-rows">${rows.join('')}</div>
    ${note}`;
}

// Build the compact legend chips that sit above the chart. Each chip
// combines an eye-toggle, color dot, dataset name, and (when available)
// the strategy's annualized CAGR. Click toggles dataset visibility, which
// re-renders the legend so the chip's hidden-style stays in sync.
// Main legend order: only the six "primary" strategies. The three 9sig
// supporting lines (TQQQ holding / target / cash) live inside the 9sig
// side-panel instead — see SUB_LEGEND below.
const LEGEND_ORDER = [
  0,  // 9sig
  8,  // SMA
  2,  // Buy & Hold — dataset 2's label + data swap based on
      // #select-bh-underlying (TQQQ / QQQ / SPY).
  7,  // Invested Compounded
];
// Datasets 3 (B&H QQQ), 4 (B&H SPY), 9 (B&H QLD), 10 (B&H SSO),
// and 12 (B&H SPXL) stay in the chart structure so dataset indices don't shift,
// but their chips are hidden — the consolidated dataset 2 chip serves as the
// single B&H entry, with the underlying picked via the sidebar selector.
// When a strategy chip's "more" is clicked, its panel can show nested
// chips for related sub-series. Currently only 9sig has any.
// 9sig sub-series names follow the chosen assets: "TQQQ holding", "TQQQ target",
// and the park fund ("QQQ") or "Cash" when parking in cash.
function nineSigSubLabels() {
  const ul = String(((document.getElementById('select-9sig-underlying') || {}).value) || 'tqqq').toUpperCase();
  const park = String(((document.getElementById('select-9sig-park-asset') || {}).value) || 'cash').toLowerCase();
  return {
    holding: ul + ' holding',
    target: ul + ' target',
    cash: park === 'cash' ? 'Cash' : park.toUpperCase()
  };
}

const SUB_LEGEND = {
  0: [1, 5, 6], // 9sig → TQQQ Holding, TQQQ Target, 9sig Cash
};

// Rounds to n significant figures without ever switching to scientific
// notation (unlike Number.prototype.toPrecision, which does past a few
// digits) — used for the range-select label's %, which can span single
// digits to several thousand percent, so a plain toFixed(k) either shows
// false decimal precision on a big move or rounds a small one to nothing.
function roundToSigFigs(v, n) {
  if (!v) return 0;
  const magnitude = Math.pow(10, n - Math.ceil(Math.log10(Math.abs(v))));
  return Math.round(v * magnitude) / magnitude;
}
// How much time a drag-selected range spans, in the coarsest units that
// still read naturally — "1 year 2 months", "1 month", "1 week", "3 days" —
// rather than a raw day count. Calendar-aware (years/months come from actual
// calendar fields, not a fixed 365/30-day approximation), so e.g. exactly
// one calendar year always reads as "1 year" regardless of leap years.
function formatRangeDuration(fromDate, toDate) {
  const from = new Date(fromDate + 'T00:00:00Z');
  const to = new Date(toDate + 'T00:00:00Z');
  let years = to.getUTCFullYear() - from.getUTCFullYear();
  let months = to.getUTCMonth() - from.getUTCMonth();
  if (to.getUTCDate() < from.getUTCDate()) months--;
  if (months < 0) { years--; months += 12; }
  const plural = (n, unit) => `${n} ${unit}${n === 1 ? '' : 's'}`;
  if (years > 0) return months > 0 ? `${plural(years, 'year')} ${plural(months, 'month')}` : plural(years, 'year');
  if (months > 0) return plural(months, 'month');
  const totalDays = Math.round((to - from) / 86400000);
  const weeks = Math.floor(totalDays / 7);
  return weeks > 0 ? plural(weeks, 'week') : plural(Math.max(totalDays, 0), 'day');
}
// Drag-to-select-a-range's per-line % change (see chart.canvas's mousedown/
// mousemove/mouseup handlers, chart creation). EVERY visible line gets a
// value — not just the 4 LEGEND_ORDER ones (that scoping was v1's mistake:
// a saved or custom/library-derived strategy's line never got a value even
// though it's drawn right there on the chart). A hidden line is skipped
// (nothing to show), and a line missing/non-finite/<=0 data at either
// endpoint is skipped too (same guard computeDayChange already uses for the
// day-change badge — reused directly here since the math is identical, just
// start/end instead of yesterday/today).
function computeRangeChangeByIdx(c, startIdx, endIdx) {
  const out = {};
  c.data.datasets.forEach((ds, i) => {
    if (!ds || ds._isShift || !c.isDatasetVisible(i)) return;
    const delta = computeDayChange(ds.data[endIdx], ds.data[startIdx]);
    if (delta) out[i] = delta;
  });
  return out;
}
// Build legend-chip HTML for a list of dataset indices. Used by both the
// main top-of-chart legend and the strategy side-panel's nested chips.
function buildLegendChipsHtml(indices, opts) {
  if (!chart) return '';
  const includeMore = !(opts && opts.noMore);
  const cagrMap = window._cagrByDatasetIdx || {};
  const metrics = window._strategyMetrics || {};
  // Drag-to-select-a-range override: while a selection is active, the top
  // row shows that range's % change instead of full-period CAGR (same row,
  // same positive/negative coloring — just a different source number and
  // label). Only ever set for LEGEND_ORDER's indices (computeRangeChangeByIdx),
  // so a sub-chip (e.g. a 9sig sub-series) never picks one up by accident.
  const rangeMap = window._rangeChangeByIdx || null;
  const out = [];
  for (const i of indices) {
    const ds = chart.data.datasets[i];
    if (!ds || ds._isShift) continue;
    const isHidden = !chart.isDatasetVisible(i);
    const dotColor = typeof ds.borderColor === 'string' ? ds.borderColor : "#7a7aa6";
    const rangeDelta = rangeMap && rangeMap[i];
    const primaryLabel = rangeDelta ? 'Range' : 'CAGR';
    const primaryVal = rangeDelta ? rangeDelta.pct : cagrMap[i];
    const m = metrics[i];
    // Two-line metrics block: CAGR (or Range, see above) row on top, max
    // drawdown below. Each row is "label value" so users can tell them apart
    // at a glance. Only rendered for main-strategy chips that have computed
    // metrics.
    let metricsHtml = '';
    if (primaryVal !== undefined && Number.isFinite(primaryVal)) {
      const primarySign = primaryVal >= 0 ? '+' : '';
      const primaryCls  = primaryVal >= 0 ? 'positive' : 'negative';
      const primaryStr  = `${primarySign}${primaryVal.toFixed(1)}%`;
      let ddRow = '';
      if (m && Number.isFinite(m.maxDD)) {
        const ddStr = fmtDD(m.maxDD);
        const ddRange = (typeof fmtDDRange === 'function') ? fmtDDRange(m.ddPeak, m.ddTrough) : '';
        const rangeHtml = ddRange ? `<span class="legend-metric-range">${ddRange}</span>` : '';
        ddRow = `
          <div class="legend-metric-row">
            <span class="legend-metric-label">DD</span>
            <span class="legend-metric-value negative">${ddStr}</span>
            ${rangeHtml}
          </div>`;
      }
      metricsHtml = `
        <div class="legend-metrics">
          <div class="legend-metric-row">
            <span class="legend-metric-label">${primaryLabel}</span>
            <span class="legend-metric-value ${primaryCls}">${primaryStr}</span>
          </div>
          ${ddRow}
        </div>`;
    }
    const moreBtn = includeMore
      ? `<button type="button" class="legend-more" aria-label="Open details panel" title="Open details panel">
           <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/><polyline points="17 9 14 12 17 15"/></svg>
         </button>`
      : '';
    out.push(
      `<div class="legend-chip${isHidden ? ' legend-hidden' : ''}" data-idx="${i}" role="button" tabindex="0" title="Click eye/name to toggle">
        <svg class="legend-eye" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          ${isHidden
            ? '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-10-7-10-7a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 10 7 10 7a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/>'
            : '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>'}
        </svg>
        <span class="legend-dot" style="background:${dotColor}"></span>
        <span class="legend-name">${ds.label}</span>
        ${metricsHtml}
        ${moreBtn}
      </div>`
    );
  }
  return out.join('');
}

function renderChartLegend() {
  const host = document.getElementById('chart-legend');
  if (!host || !chart) return;
  host.innerHTML = buildLegendChipsHtml(LEGEND_ORDER);
}

let _currentPanelIdx = null;

// Strategy rules panel for 9sig — recomputed each time it's rendered so it
// reflects the user's current underlying, growth %, 30-down threshold, and
// spike-reset trigger. Plain-English version designed so a non-technical
// reader can follow it without referencing the original Jason Kelly book.
function buildNineSigRulesHtml() {
  const ul   = ((document.getElementById('select-9sig-underlying') || {}).value || 'tqqq').toUpperCase();
  const g    = +((document.getElementById('select-9sig-growth')    || {}).value) || 9;
  const name = (typeof nineSigName === 'function') ? nineSigName() : (g + 'sig');
  const cd   = +((document.getElementById('select-9sig-crashdrop') || {}).value) || 30;
  const sp   = +((document.getElementById('select-9sig-spike')     || {}).value);
  const cashP  = +((document.getElementById('select-9sig-cash') || {}).value) || 0;
  const stockP = 100 - cashP;
  const bp     = +((document.getElementById('select-9sig-buypower') || {}).value) || 90;

  const crashRule = cd >= 100
    ? `<span style="color:var(--text-muted)">(30-down protection: off at ${cd}%)</span>`
    : `When ${ul} is more than <b>${cd}%</b> below its 2-year high, <b>skip selling for up to two quarters in a row</b> — don't dump in a crash. After two skips, sell anyway.`;
  const spikeRule = sp <= 0
    ? `<span style="color:var(--text-muted)">(Spike-reset: off)</span>`
    : `If ${ul} <b>gains more than ${sp}% in a single quarter</b> and you still hold ≥${stockP}% in it, hard-rebalance back to ${stockP}/${cashP} — lock in the windfall.`;

  return `
    <div class="strategy-panel-section-label">${name} explained</div>
    <div class="strategy-rules">
      <div style="margin-bottom:10px;color:var(--text)">
        <b>The idea:</b> each quarter, ${ul} should grow by ${g}%. If it grew faster, sell the excess to cash. If slower, buy more with cash. That's it.
      </div>

      <div style="margin-top:14px;font-weight:600;color:var(--text)">How it actually works</div>
      <div style="margin-top:6px">
        <b>1. Start.</b> Put ${stockP}% of your money in ${ul}, ${cashP}% in cash. Write down the value of the ${ul} side — that's your <b>target</b>.
      </div>
      <div style="margin-top:6px">
        <b>2. Every quarter, before deciding anything:</b>
        <ul style="margin:4px 0 0 18px;padding:0">
          <li>Grow the target by <b>${g}%</b>.</li>
          <li>If you added new cash this quarter (monthly contributions), raise the target by <b>half</b> of that new cash too.</li>
        </ul>
      </div>
      <div style="margin-top:6px">
        <b>3. Now check ${ul} against the target:</b>
        <ul style="margin:4px 0 0 18px;padding:0">
          <li><b>${ul} worth more than target?</b> Sell the excess back to cash.</li>
          <li><b>${ul} worth less than target?</b> Buy more from cash to close the gap.</li>
          <li><b>Equal?</b> Hold.</li>
        </ul>
      </div>

      <div style="margin-top:14px;font-weight:600;color:var(--text)">Safety rails</div>
      <div style="margin-top:6px">
        &bull; <b>${bp}% buying power.</b> A buy never spends more than ${bp}% of your cash${bp < 100 ? ' — you keep some spare cash' : ''}.
      </div>
      <div style="margin-top:6px">
        &bull; <b>30-down no-sell.</b> ${crashRule}
      </div>
      <div style="margin-top:6px">
        &bull; <b>Spike reset.</b> ${spikeRule}
      </div>

      <div style="margin-top:14px;font-size:11px;color:var(--text-muted);line-height:1.5">
        Monthly contributions always go straight to cash (never directly into ${ul}) — the quarterly rebalance is what moves money into stock. The target rising by half of new cash keeps it honest: half of every dollar you add is "expected" to flow into ${ul} eventually.
      </div>
    </div>
  `;
}

// Inline icon set (Feather-style, stroke = currentColor) for the metric cards.
const STAT_ICONS = {
  trendUp:   '<path d="M22 7l-8.5 8.5-5-5L2 17"/><path d="M16 7h6v6"/>',
  trendDown: '<path d="M22 17l-8.5-8.5-5 5L2 7"/><path d="M16 17h6v-6"/>',
  dollar:    '<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
  flag:      '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/>',
  clock:     '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  sliders:   '<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>',
  activity:  '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>',
  shield:    '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
};
function statIcon(name) {
  return `<span class="strategy-stat-icon"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${STAT_ICONS[name] || ''}</svg></span>`;
}
// One metric card: icon + label head, big value, optional sub-line. `tip`
// adds a hover-info (?) next to the label using the shared .info-icon tooltip.
// `delta` is an optional { text, tone } badge shown next to the value — e.g.
// a custom strategy reporting how much a reading moved since yesterday.
// `tone` is a pre-resolved CSS class ('positive'/'negative'/''), same as
// `valueCls` — callers resolve raw tone strings ('good'/'bad'/...) before
// passing them in, so this stays a plain rendering function.
function statCard(label, icon, value, valueCls, sub, tip, delta) {
  const info = tip ? ` <span class="info-icon" tabindex="0" data-tip="${tip}">ⓘ</span>` : '';
  const deltaHtml = delta && delta.text ? ` <span class="strategy-stat-delta ${delta.tone || ''}">${delta.text}</span>` : '';
  return `<div class="strategy-stat">
      <div class="strategy-stat-head"><span class="strategy-stat-label">${label}${info}</span>${statIcon(icon)}</div>
      <div class="strategy-stat-value ${valueCls || ''}">${value}${deltaHtml}</div>
      ${sub ? `<div class="strategy-stat-range">${sub}</div>` : ''}
    </div>`;
}

// Live signal dashboard for the SMA strategy — reads the current control
// values and reports where the signal stands as of the most recent trading
// day: the signal asset vs its moving average, how long it's been on that
// side, the RSI gauges, and the bubble-insurance gauge. Recomputed whenever the
// SMA panel re-renders, so it tracks whatever knobs the user is turning.
function buildSignalMetricsHtml() {
  if (typeof daily === 'undefined' || !daily || !daily.length) return '';
  if (typeof smaAtDailyByKey === 'undefined' || !smaAtDailyByKey) return '';
  const g = (id) => (document.getElementById(id) || {}).value;
  const smaAsset = (g('select-sma-asset') || 'qqq').toLowerCase();
  const win      = +g('select-sma-window') || 200;
  const ohWin    = +g('select-sma-rsi-oh-window') || 10;
  const coolWin  = +g('select-sma-rsi-cool-window') || 10;
  const rsiOh    = +g('select-sma-rsi-oh') || 0;
  const rsiCool  = +g('select-sma-rsi-cool') || 0;
  const bgAsset  = (g('select-sma-bg-asset') || 'qqq').toLowerCase();
  const bgGtfo   = +g('select-sma-bg-gtfo') || 0;
  // The bubble brake has its OWN moving-average window; fall back to the main SMA
  // window when unset (mirrors the engine's `bgWindow = +opts.bgWindow || smaWindow`).
  const bgWin    = +g('select-sma-bg-window') || win;
  const entryBuf = +g('select-sma-entry-buf') || 0;
  const exitBuf  = +g('select-sma-exit-buf') || 0;

  const di = daily.length - 1;
  const dateStr = daily[di].date;
  const smaArr = smaAtDailyByKey[smaAsset + '_' + win];
  if (!smaArr || smaArr[di] == null) return '';
  const price = daily[di][smaAsset];
  const sma   = smaArr[di];
  const pct   = (price / sma - 1) * 100;
  const above = price > sma;
  // Consecutive trading days the signal asset has been on its current side.
  let days = 0;
  for (let j = di; j >= 0; j--) {
    const s = smaArr[j]; if (s == null) break;
    if ((daily[j][smaAsset] > s) === above) days++; else break;
  }
  // Entry/exit buffer bands — how far the price still is from the trigger.
  const enterAt = sma * (1 + entryBuf / 100);
  const exitAt  = sma * (1 - exitBuf / 100);

  const AN = smaAsset.toUpperCase();
  const red = (t) => `<span style="color:var(--red)">${t}</span>`;

  const rsiCard = (label, w, thr, cmp, tip) => {
    const arr = (typeof rsiAtDailyByKey !== 'undefined' && rsiAtDailyByKey) ? rsiAtDailyByKey[smaAsset + '_' + w] : null;
    const v = arr && arr[di] != null ? arr[di] : null;
    const vStr = v == null ? '—' : v.toFixed(1);
    let sub;
    if (thr <= 0) sub = 'off';
    else if (v == null) sub = '';
    else { const hit = cmp === 'above' ? v >= thr : v <= thr; sub = hit ? red(`${cmp} ${thr} · hit`) : `${cmp} ${thr}`; }
    return statCard(`RSI(${w}) · ${label}`, 'activity', vStr, '', sub, tip);
  };

  const cards = [];
  cards.push(statCard(`${AN} vs ${win}-day avg`, above ? 'trendUp' : 'trendDown',
    `${above ? '▲' : '▼'} ${above ? '+' : '−'}${Math.abs(pct).toFixed(2)}%`,
    above ? 'positive' : 'negative',
    `${fmtLogPrice(price)} vs ${fmtLogPrice(sma)} avg`,
    `The signal ticker's latest close vs its ${win}-day moving average.&#10;&#10;Above the average = the trend rule leans IN (hold the 3× fund); below = OUT. This is the core buy/sell signal.`));
  cards.push(statCard(`Days ${above ? 'above' : 'below'} avg`, 'clock', String(days), '',
    `since ${AN} last crossed`,
    `How many trading days in a row ${AN} has stayed on its current side of the moving average — i.e. how long the current trend signal has held without flipping.`));
  if (entryBuf > 0 || exitBuf > 0) cards.push(statCard('Buffer bands', 'sliders',
    `+${entryBuf}% / −${exitBuf}%`, '',
    `buy &gt; ${fmtLogPrice(enterAt)} · sell &lt; ${fmtLogPrice(exitAt)}`,
    `The price gates your buffers create: you only BUY once price is ${entryBuf}% above the average, and only SELL once it is ${exitBuf}% below. This dead-zone stops flip-flopping right at the line.`));
  cards.push(rsiCard('sell', ohWin, rsiOh, 'above',
    `Relative Strength Index over ${ohWin} days on ${AN} — a 0–100 momentum gauge.&#10;&#10;How it's calculated:&#10;1. Each day, take the close-to-close change; split into up moves and down moves.&#10;2. Keep a ${ohWin}-day average of each, Wilder-smoothed: newAvg = (prevAvg × ${ohWin - 1} + today) ÷ ${ohWin}.&#10;3. RS = avg gain ÷ avg loss.&#10;4. RSI = 100 − 100 ÷ (1 + RS).&#10;&#10;50 = ups & downs balanced · above ~70 = ran up fast · below ~30 = sold off hard.&#10;&#10;Sell rule: exit when RSI climbs above your overheat level${rsiOh > 0 ? ` (${rsiOh})` : ''}.`));
  cards.push(rsiCard('buy', coolWin, rsiCool, 'below',
    `Relative Strength Index over ${coolWin} days on ${AN} — a 0–100 momentum gauge.&#10;&#10;How it's calculated:&#10;1. Each day, take the close-to-close change; split into up moves and down moves.&#10;2. Keep a ${coolWin}-day average of each, Wilder-smoothed: newAvg = (prevAvg × ${coolWin - 1} + today) ÷ ${coolWin}.&#10;3. RS = avg gain ÷ avg loss.&#10;4. RSI = 100 − 100 ÷ (1 + RS).&#10;&#10;50 = balanced · above ~70 = overbought · below ~30 = oversold.&#10;&#10;Buy rule: wait until RSI cools below your level${rsiCool > 0 ? ` (${rsiCool})` : ''} before re-entering, so you don't buy an overheated top.`));

  const bgArr = smaAtDailyByKey[bgAsset + '_' + bgWin];
  if (bgArr && bgArr[di] != null) {
    const bp = daily[di][bgAsset], bs = bgArr[di];
    const babove = (bp / bs - 1) * 100;
    const armed = bgGtfo > 0 && babove >= bgGtfo;
    const sub = armed ? red('⚠ armed — would sell to cash')
              : (bgGtfo > 0 ? `to cash at +${bgGtfo}%` : 'off');
    cards.push(statCard(`${bgAsset.toUpperCase()} vs ${bgWin}-day avg`, 'shield',
      `${babove >= 0 ? '+' : '−'}${Math.abs(babove).toFixed(2)}%`,
      armed ? 'negative' : (babove >= 0 ? 'positive' : 'negative'), sub,
      `The bubble-insurance gauge: how far ${bgAsset.toUpperCase()} sits above its own ${bgWin}-day average.&#10;&#10;${bgGtfo > 0 ? `When it reaches +${bgGtfo}%, the brake sells everything to cash — no matter what the main signal says.` : 'The brake is off (no cash trigger set).'}`));
  }

  // --- "Right now" decision -------------------------------------------------
  // Fold every live signal into the single action a fresh lump sum would take
  // today, and show what each metric is individually pushing toward. Mirrors the
  // engine's evalSignal + bodyguard for an entry from flat.
  const primary = (g('select-sma-underlying') || smaAsset).toLowerCase();
  const backup  = (g('select-sma-out-asset') || 'cash').toLowerCase();
  const easeIn  = +g('select-sma-dca-in') || 0;
  const P = primary.toUpperCase();
  const B = backup === 'cash' ? 'cash' : backup.toUpperCase();
  const rk = (w) => (typeof rsiAtDailyByKey !== 'undefined' && rsiAtDailyByKey) ? rsiAtDailyByKey[smaAsset + '_' + w] : null;
  const ohA = rk(ohWin), clA = rk(coolWin);
  const ohV = ohA && ohA[di] != null ? ohA[di] : null;
  const clV = clA && clA[di] != null ? clA[di] : null;
  const bgPct = (bgArr && bgArr[di] != null) ? (daily[di][bgAsset] / bgArr[di] - 1) * 100 : null;
  const pctStr = (v) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}%`;

  const trendIn = pct > entryBuf;
  const hot     = rsiOh > 0 && ohV != null && ohV >= rsiOh;
  const blocked = rsiCool > 0 && clV != null && clV >= rsiCool;
  const armed   = bgGtfo > 0 && bgPct != null && bgPct >= bgGtfo;

  const rV = (v, d = 1) => v == null ? '—' : v.toFixed(d);
  const reasons = [];
  reasons.push({ lean: trendIn ? 'buy' : 'out', name: 'Trend',
    val: `${AN} ${pctStr(pct)} vs ${win}d`, tag: trendIn ? `in · ${P}` : `out · ${B}` });
  if (rsiOh > 0) reasons.push({ lean: hot ? 'out' : 'buy', name: 'Overheat',
    val: `RSI(${ohWin}) ${rV(ohV)}`, tag: hot ? `sell ≥${rsiOh}` : 'clear' });
  if (rsiCool > 0) reasons.push({ lean: blocked ? 'out' : 'buy', name: 'Re-entry',
    val: `RSI(${coolWin}) ${rV(clV)}`, tag: blocked ? `wait <${rsiCool}` : 'open' });
  if (bgGtfo > 0) reasons.push({ lean: armed ? 'cash' : 'buy', name: 'Bubble',
    val: `${bgAsset.toUpperCase()} ${bgPct == null ? '—' : pctStr(bgPct)}`, tag: armed ? `cash +${bgGtfo}%` : 'off' });

  let action, cls, note;
  if (armed) { action = 'Move to cash'; cls = 'cash'; note = 'the bubble brake overrides the trend'; }
  else if (trendIn && !hot && !blocked) { action = `Buy ${P}`; cls = 'buy'; note = easeIn > 1 ? `eased in over ${easeIn} trading days` : 'all at once'; }
  else { const inCash = B === 'cash'; action = inCash ? 'Stay in cash' : `Buy ${B}`; cls = 'hold'; note = inCash ? 'buy signal is off' : 'the backup fund — buy signal is off'; }

  const decisionHtml = `
    <div class="strategy-panel-section-label" style="margin-top:22px">Right now</div>
    <div class="signal-decision">
      <div class="sd-hero sd-${cls}">
        <span class="sd-hero-lead">Lump sum today</span>
        <span class="sd-hero-action">${action}</span>
        ${note ? `<span class="sd-hero-note">${note}</span>` : ''}
      </div>
      <div class="sd-signals">${reasons.map(r => `<div class="sd-sig sd-lean-${r.lean}"><span class="sd-dot"></span><span class="sd-sig-name">${r.name}</span><span class="sd-sig-val">${r.val}</span><span class="sd-sig-tag">${r.tag}</span></div>`).join('')}</div>
    </div>`;

  return `
    <div class="strategy-panel-section-label" style="margin-top:24px">Signal metrics <span style="font-weight:400;text-transform:none;letter-spacing:0;color:var(--text-muted)">· as of ${fmtLogDate(dateStr)}</span></div>
    <div class="strategy-stats">${cards.join('')}</div>
    ${decisionHtml}`;
}

// One smaLog row → { label, gain%, colour-class }. Shared by the transaction-log
// TABLE and the chart marker TOOLTIP so both always read identically. `label`
// names both legs of a trade (what was sold / bought); `gain` is the holding's
// own return since the previous action (null when it isn't meaningful — the
// second leg of a same-day switch); `ac` is the sell/buy/hold colour class.
function smaLogRowInfo(smaLog, i, ulName) {
  const l = smaLog[i];
  const prev = i > 0 ? smaLog[i - 1] : null;
  const held = (l.held || l.state || '').toString().toUpperCase();
  const from = prev ? (prev.held || prev.state || '').toString().toUpperCase() : '';
  const swap = (a, b) => a === 'CASH' ? `Buy ${b}`
                       : b === 'CASH' ? `Sell ${a} → cash`
                       : `Sell ${a} → buy ${b}`;
  const LABEL = {
    START: 'Start', ENTER: 'Buy ' + ulName, EXIT: 'Sell ' + ulName,
    'BG-GTFO': 'Bubble → cash', 'BG-CLEAR': 'Bubble over', END: 'End of range',
  };
  let label;
  switch (l.action) {
    case 'CONTRIB':  label = '+ ' + fmtFull(Math.round(l.contribAmt || 0)); break;
    case 'DCA-ADD':  label = `Buy more ${held}`; break; // an ease top-up slice
    case 'ENTER':
    case 'EXIT':     label = swap(from, held); break;
    case 'BG-GTFO':  label = `Bubble: sell ${from} → cash`; break;
    case 'BG-CLEAR': label = `Bubble over: buy ${held}`; break;
    default:         label = LABEL[l.action] || l.action; // START / END
  }
  let gain = null;
  // Skip the (%) when the previous row is the SAME day — that's the other leg of
  // a switch (sell then buy), so the gain would span a zero-length interval.
  if (prev && prev.total > 0 && l.date !== prev.date) {
    const contrib = (l.invested || 0) - (prev.invested || 0);
    gain = (l.total - prev.total - contrib) / prev.total * 100;
  }
  const ac = (l.action === 'EXIT' || l.action === 'BG-GTFO') ? 'action-sell'
           : (l.action === 'ENTER' || l.action === 'DCA-ADD') ? 'action-buy' : 'action-hold';
  return { label, gain, ac };
}

// Event-driven log table for the SMA strategy. Shows one row per actual
// trade (ENTER / EXIT) — not one row per quarter — because SMA only does
// something when the signal flips. Most quarters would just be noise.
function buildSmaLogTableHtml(smaLog) {
  if (!smaLog || smaLog.length === 0) return '';
  // The leveraged ETF the SMA strategy holds when "in" (TQQQ).
  const ulName = ((document.getElementById('select-sma-underlying') || {}).value || 'tqqq').toUpperCase();
  const rows = smaLog.map((l, i) => {
    // Action label, gain %, and colour class come from the shared helper so the
    // table and the chart marker tooltip always read identically.
    const { label: actionLabel, gain, ac } = smaLogRowInfo(smaLog, i, ulName);
    let gainCell = '';
    if (gain != null) {
      const gc = gain >= 0 ? 'action-buy' : 'action-sell';
      gainCell = ` <span class="${gc}">(${gain >= 0 ? '+' : '−'}${Math.abs(gain).toFixed(1)}%)</span>`;
    }
    // Trade rows have a chart marker (keyed by this row's index, i); tag them so
    // hovering the row can highlight that action point on the chart. START / END
    // rows have no marker. CONTRIB rows are tagged separately so the "hide
    // monthly" checkbox can collapse them.
    const hasMarker = !!(SMA_EVENT_STYLE[l.action] && l.total > 0);
    const cls = hasMarker ? 'log-row-mk'
              : l.action === 'CONTRIB' ? 'log-row-contrib'
              : l.action === 'DCA-ADD' ? 'log-row-dca' : '';
    const trAttr = (cls ? ` class="${cls}"` : '') + (hasMarker ? ` data-mkey="${i}"` : '');
    // Fee paid on this row's trade. Sub-$1 fees keep 2 decimals; $0 shows a dash.
    const feeStr = !l.fee ? '—' : l.fee >= 1 ? fmtFull(Math.round(l.fee)) : '$' + l.fee.toFixed(2);
    // Allocation mix: what % sits in the fund you hold (primary TQQQ or the backup)
    // vs cash. Mid-ease you're split, e.g. "58% SPXL · 42% cash".
    const mixTot = l.total || 0;
    const pctFund = mixTot > 0 ? (l.stockVal || 0) / mixTot * 100 : 0;
    const pctCash = mixTot > 0 ? (l.cash || 0) / mixTot * 100 : 0;
    const mixParts = [];
    if (pctFund >= 0.5) mixParts.push(`${Math.round(pctFund)}% ${(l.held || '').toUpperCase()}`);
    if (pctCash >= 0.5) mixParts.push(`${Math.round(pctCash)}% cash`);
    const mixStr = mixParts.length ? mixParts.join(' · ') : (mixTot > 0 ? '100% cash' : '—');
    return `<tr${trAttr}>
      <td>${i}</td>
      <td>${fmtLogDate(l.date)}</td>
      <td class="${ac}">${actionLabel}${gainCell}</td>
      <td>${(l.held || l.state).toUpperCase()}</td>
      <td class="log-mix">${mixStr}</td>
      <td>${l.shares > 0 ? fmtLogPrice(l.stockVal / l.shares) : '—'}</td>
      <td>${fmtLogShares(l.shares)}</td>
      <td>${fmtFull(Math.round(l.stockVal))}</td>
      <td>${fmtFull(Math.round(l.cash))}</td>
      <td>${fmtFull(Math.round(l.total))}</td>
      <td>${fmtFull(l.invested)}</td>
      <td>${feeStr}</td>
    </tr>`;
  }).join('');
  const contribCount = smaLog.filter(l => l.action === 'CONTRIB').length;
  const easeCount = smaLog.filter(l => l.action === 'DCA-ADD').length;
  const totalFee = smaLog.reduce((s, l) => s + (l.fee || 0), 0);
  // Share of calendar time spent in each holding — weighted by the days between
  // events (the holding is constant between two log rows). Uses the same
  // held-asset resolution as the Holding column.
  const holdMs = {}; let holdTot = 0;
  for (let i = 0; i < smaLog.length - 1; i++) {
    const a = (smaLog[i].held || smaLog[i].state || 'cash').toUpperCase();
    const dt = Date.parse(smaLog[i + 1].date) - Date.parse(smaLog[i].date);
    if (dt > 0) { holdMs[a] = (holdMs[a] || 0) + dt; holdTot += dt; }
  }
  const holdChips = holdTot > 0 ? Object.entries(holdMs).sort((a, b) => b[1] - a[1]).map(([a, ms]) => {
    const yrs = ms / 31557600000; // 365.25 d
    return `<span style="margin-right:16px;white-space:nowrap"><b style="color:var(--text)">${a}</b> ${(ms / holdTot * 100).toFixed(1)}% <span style="opacity:.55">(${yrs >= 1 ? yrs.toFixed(1) + 'y' : Math.round(yrs * 12) + 'mo'})</span></span>`;
  }).join('') : '';
  const holdSummary = holdChips ? `<div style="font-size:12px;color:var(--text-muted);margin-top:10px"><span style="font-weight:600;color:var(--text);margin-right:8px">Time in each holding:</span>${holdChips}</div>` : '';
  const contribToggle = contribCount > 0 ? `
    <label class="log-contrib-toggle">
      <input type="checkbox" onchange="toggleSmaLogContrib(this.checked)" ${_smaLogHideContrib ? 'checked' : ''}>
      Hide monthly contributions (${contribCount})
    </label>` : '';
  const easeToggle = easeCount > 0 ? `
    <label class="log-contrib-toggle">
      <input type="checkbox" onchange="toggleSmaLogEase(this.checked)" ${_smaLogHideEase ? 'checked' : ''}>
      Hide ease-in slices (${easeCount})
    </label>` : '';
  return `
    <div class="log-section">
    ${logSectionHeaderHtml('SMA Transaction Log')}
    <div style="display:flex;gap:16px;flex-wrap:wrap">${contribToggle}${easeToggle}</div>
    <div class="quarter-table-wrap${_smaLogHideContrib ? ' hide-contrib' : ''}${_smaLogHideEase ? ' hide-dca' : ''}">
      <table>
        <thead>
          <tr>
            <th># <span class="info-icon" tabindex="0" data-tip="Event number. Start is 0 (your opening position), then each row — every trade and every monthly contribution — counts up, so the last number is the total number of events over this window.">ⓘ</span></th>
            <th>Date <span class="info-icon" tabindex="0" data-tip="The trading day this row happened on.&#10;&#10;The log only lists days the strategy actually did something — most days it just holds and aren't shown.">ⓘ</span></th>
            <th>Action <span class="info-icon" tabindex="0" data-tip="What the strategy did on this day:&#10;&#10;• Start — your very first position&#10;• Sell A → cash — sold your holding out to cash&#10;• Buy B — bought into B&#10;A switch shows as TWO rows on the same day — a sell then a buy — because it's two real trades, each paying the trading cost.&#10;• Buy more B — an ease slice: when a buy is spread out, each daily slice is its own trade (its own fee). The 'Hide ease-in slices' box collapses these.&#10;• + $X — a monthly contribution went in&#10;• Bubble: sell A → cash — the bubble brake sold everything to cash&#10;• Bubble over: buy B — the brake let go and bought back in&#10;• End of range — a final snapshot at the end of your dates (no trade); its Total matches the chart's endpoint&#10;&#10;The (%) in brackets is the gain or loss since the PREVIOUS action — how much the position you were holding earned over that stretch. Contributions added in between are removed, so it's the holding's own return: green for up, red for down.">ⓘ</span></th>
            <th>Holding <span class="info-icon" tabindex="0" data-tip="What you actually owned right after this trade:&#10;&#10;• ${ulName} — the 3× fund, fully invested&#10;• QQQ / SPY — a plain, un-leveraged fund (much safer)&#10;• CASH — sitting out of the market&#10;&#10;This can differ from the trend signal: when the bubble brake fires, the trend may still say 'in' while you're actually parked in cash.">ⓘ</span></th>
            <th>Mix <span class="info-icon" tabindex="0" data-tip="How the money is split right now, as percentages: how much sits in your primary fund (${ulName}) or backup fund vs cash.&#10;&#10;Mid-ease you're partly deployed — e.g. '58% SPXL · 42% cash' as the backup buy fills in slice by slice.">ⓘ</span></th>
            <th>Fund Price <span class="info-icon" tabindex="0" data-tip="The closing price of the fund you were actually holding on this day — whatever is in the Holding column (your primary fund when in-trend, your backup fund when out).&#10;&#10;Blank (—) on cash rows. Fund Price × Fund Shares always equals Stock Val.">ⓘ</span></th>
            <th>Fund Shares <span class="info-icon" tabindex="0" data-tip="How many shares of the fund in the Holding column you held after this trade.&#10;&#10;0 only when you were fully in cash — so this reads 0 on every bubble-brake and sell-to-cash row. It's non-zero whenever you hold any fund, primary or backup.">ⓘ</span></th>
            <th>Stock Val <span class="info-icon" tabindex="0" data-tip="The dollar value of whatever fund you were holding at this point — everything in the portfolio except cash.">ⓘ</span></th>
            <th>Cash <span class="info-icon" tabindex="0" data-tip="How much was sitting in cash after this trade, earning the cash interest rate until it's put back to work.">ⓘ</span></th>
            <th>Total <span class="info-icon" tabindex="0" data-tip="Your entire portfolio value that day: fund value + cash. This is the number the strategy's line plots on the chart.">ⓘ</span></th>
            <th>Invested <span class="info-icon" tabindex="0" data-tip="Total money you had put in by this date — your starting amount plus every contribution so far.&#10;&#10;Total minus Invested is your profit.">ⓘ</span></th>
            <th>Fee <span class="info-icon" tabindex="0" data-tip="The trading cost paid on THIS row's trade (your fee % × the amount traded). Sells and every buy slice each pay it.&#10;&#10;Contributions, Start snapshot, and End of range pay nothing (—).">ⓘ</span></th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    ${holdSummary}
    </div>
  `;
}

// Per-share price formatter — synthetic prices span tiny (1953) to large.
function fmtLogPrice(p) {
  if (!Number.isFinite(p) || p <= 0) return '–';
  if (p >= 1000) return '$' + p.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (p >= 1)    return '$' + p.toFixed(2);
  if (p >= 0.01) return '$' + p.toFixed(4);
  return '$' + p.toPrecision(2);
}
// Share-count formatter (a quantity, not dollars — no $).
function fmtLogShares(n) {
  if (!Number.isFinite(n)) return '–';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(2) + 'K';
  if (n >= 1)   return n.toFixed(2);
  return n.toFixed(4);
}

// Tooltip shown on a log's last (current-period) row. That period hasn't
// closed yet, so its values are the latest daily snapshot and move until the
// period ends.
const LOG_LATEST_TIP = "Latest reading, and this period hasn't closed yet. The price is a snapshot taken only a couple of hours into the trading day, so it can move a lot over the remaining ~6 hours and may not match the actual close. It refreshes with each next day's data.";
function latestBadge(isLast) {
  return isLast ? ` <span class="info-icon" tabindex="0" data-tip="${LOG_LATEST_TIP}">ⓘ</span>` : '';
}

// Per-period "new money in" for a log: first period = the initial lump sum,
// later periods = the contributions that landed during that period (derived
// from the running cumulative `invested`). All strategies share the same
// contribution schedule, so this is computed once from the 9sig log.
function newMoneyPerPeriod(log) {
  return log.map((l, i) => (i === 0 ? l.invested : l.invested - log[i - 1].invested));
}

// Generic per-period log for strategies without a bespoke table (Buy & Hold,
// Invested Compounded). Columns: Date · Type · New $ · Value. `typeFor(i, nm)`
// returns the row's Type label; `valueAt(i)` the portfolio value that period.
function buildSimpleLogTableHtml(title, log, valueAt, typeFor) {
  if (!log || !log.length) return '';
  const nm = newMoneyPerPeriod(log);
  const last = log.length - 1;
  const rows = log.map((l, i) => `<tr${i === last ? ' class="log-latest"' : ''}>
      <td>${i}</td>
      <td>${fmtLogDate(l.date)}</td>
      <td>${typeFor(i, nm[i])}${latestBadge(i === last)}</td>
      <td>${nm[i] > 0 ? fmtFull(Math.round(nm[i])) : '—'}</td>
      <td>${fmtFull(Math.round(valueAt(i)))}</td>
    </tr>`).join('');
  return `
    <div class="log-section">
    ${logSectionHeaderHtml(title)}
    <div class="quarter-table-wrap">
      <table>
        <thead><tr><th># <span class="info-icon" tabindex="0" data-tip="Row number — the first row is 0, then each counts up.">ⓘ</span></th><th>Date</th><th>Type</th><th>New $</th><th>Value</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    </div>
  `;
}

// Buy & Hold log. Columns: Date · Type · New $ · {UL} Price · {UL} Shares ·
// Value. `series` is the selected underlying's point array (carries price +
// shares per period). With no contributions the intermediate rows are just
// the price path, so we collapse to the buy (first) and latest (last) rows.
function buildBuyHoldLogTableHtml(title, log, series, ulName) {
  if (!log || !log.length || !series || !series.length) return '';
  const nm = newMoneyPerPeriod(log);
  const n = log.length;
  const last = n - 1;
  const hasContrib = nm.some((m, i) => i > 0 && m > 0);
  const indices = hasContrib ? log.map((_, i) => i) : (n > 1 ? [0, last] : [0]);
  const rows = indices.map(i => {
    const s = series[i] || {};
    const type = i === 0 ? 'Initial buy'
               : hasContrib ? (nm[i] > 0 ? 'Monthly investment' : 'Hold')
               : 'Latest';
    return `<tr${i === last ? ' class="log-latest"' : ''}>
      <td>${i}</td>
      <td>${fmtLogDate(log[i].date)}</td>
      <td>${type}${latestBadge(i === last)}</td>
      <td>${nm[i] > 0 ? fmtFull(Math.round(nm[i])) : '—'}</td>
      <td>${fmtLogPrice(s.price)}</td>
      <td>${fmtLogShares(s.shares)}</td>
      <td>${fmtFull(Math.round(s.value || 0))}</td>
    </tr>`;
  }).join('');
  return `
    <div class="log-section">
    ${logSectionHeaderHtml(title)}
    <div class="quarter-table-wrap">
      <table>
        <thead><tr><th># <span class="info-icon" tabindex="0" data-tip="Row number in the full price history (the initial buy is 0). When there are no contributions the table collapses to just the first and last rows, so the numbers can jump.">ⓘ</span></th><th>Date</th><th>Type</th><th>New $</th><th>${ulName} Price</th><th>${ulName} Shares</th><th>Value</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    </div>
  `;
}

function buildLogTableHtml(d) {
  if (!d || !d.log || !d.log.length) return '';
  // Column names follow whichever underlying the 9sig run trades (TQQQ).
  const ulName = ((document.getElementById('select-9sig-underlying') || {}).value || 'tqqq').toUpperCase();
  const nm = newMoneyPerPeriod(d.log);
  const fmtPrice = fmtLogPrice;
  const fmtShares = fmtLogShares;
  const lastIdx = d.log.length - 1;
  const rows = d.log.map((l, i) => {
    const ac = l.action.startsWith('SELL') ? 'action-sell' : l.action.startsWith('BUY') ? 'action-buy' : 'action-hold';
    const shares = l.price > 0 ? l.tqqqVal / l.price : 0;
    const type = i === 0 ? 'Initial' : 'Rebalance';
    return `<tr${i === lastIdx ? ' class="log-latest"' : ''}>
      <td>${i}</td>
      <td>${fmtLogDate(l.date)}</td>
      <td>${type}${latestBadge(i === lastIdx)}</td>
      <td>${nm[i] > 0 ? fmtFull(Math.round(nm[i])) : '—'}</td>
      <td>${fmtPrice(l.price)}</td>
      <td>${fmtShares(shares)}</td>
      <td>${fmtFull(Math.round(l.tqqqVal))}</td>
      <td style="color:#d9631a">${fmtFull(Math.round(l.target))}</td>
      <td>${fmtFull(Math.round(l.cash))}</td>
      <td>${fmtFull(Math.round(l.total))}</td>
      <td>${!l.fee ? '—' : (l.fee >= 1 ? fmtFull(Math.round(l.fee)) : '+$' + l.fee.toFixed(2))}</td>
      <td class="${ac} log-action">${l.action}</td>
    </tr>`;
  }).join('');
  return `
    <div class="log-section">
    ${logSectionHeaderHtml('Rebalance Log')}
    <div class="quarter-table-wrap">
      <table>
        <thead>
          <tr>
            <th># <span class="info-icon" tabindex="0" data-tip="Row number. The initial position is 0, then each rebalance counts up — so the last number is the total number of rebalances.">ⓘ</span></th>
            <th>Date</th>
            <th>Type</th>
            <th>New $</th>
            <th>${ulName} Price</th>
            <th>${ulName} Shares</th>
            <th>${ulName} Val</th>
            <th>Target</th>
            <th>Cash</th>
            <th>Total Portfolio</th>
            <th>Fee <span class="info-icon" tabindex="0" data-tip="The trading cost (your fee % × the dollars traded) paid on this rebalance — sells, buys, spike resets, and any contribution deployed straight into stock. A rebalance that only HOLDs pays nothing (—).">ⓘ</span></th>
            <th class="log-action">Action</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    </div>
  `;
}

// Render the 4-stat grid (CAGR / Start / End / Max DD) for one dataset idx.
// Stats come from window._strategyMetrics, populated each render(). Returns
// an empty string when there are no metrics for the idx.
function renderStatsGrid(idx) {
  let m = (window._strategyMetrics || {})[idx];
  // When a saved strategy is open for editing, the panel describes THAT strategy,
  // not the canonical base line — show its own metrics instead. (The top legend
  // chip keeps reading _strategyMetrics, so it still shows the canonical base.)
  const ecid = window._editingConfigId;
  if (ecid && typeof getSavedConfigs === 'function') {
    const cfg = getSavedConfigs().find(c => c.id === ecid);
    if (cfg && cfg.type !== 'custom' && PANEL_IDX_BY_KEY[cfg.type] === idx) {
      const cm = (window._configMetrics || {})[ecid];
      if (cm) m = { cagr: cm.cagr, start: cm.start, end: cm.end, maxDD: cm.maxDD, ddPeak: cm.ddPeak, ddTrough: cm.ddTrough };
    }
  }
  if (!m) return '';
  const cagrSign = m.cagr >= 0 ? '+' : '';
  const cagrCls  = m.cagr >= 0 ? 'positive' : 'negative';
  const cagrStr  = Number.isFinite(m.cagr) ? `${cagrSign}${m.cagr.toFixed(1)}%` : '–';
  const ddStr    = fmtDD(m.maxDD);
  const ddRange  = (typeof fmtDDRange === 'function') ? fmtDDRange(m.ddPeak, m.ddTrough) : '';
  const ddRangeHtml = ddRange ? `<div class="strategy-stat-range">${ddRange}</div>` : '';
  return `
    <div class="strategy-stats">
      ${statCard('CAGR', m.cagr >= 0 ? 'trendUp' : 'trendDown', cagrStr, cagrCls, '',
        'Money-weighted annual growth rate (IRR).&#10;&#10;Each contributed dollar is weighted by how long it was actually invested, so early money counts for more than a simple end÷start rate would give.')}
      ${statCard('Starting Balance', 'dollar', fmtFull(Math.round(m.start)), '', '',
        'Your position value at the start of the selected date range — the initial amount put to work here.')}
      ${statCard('Ending Balance', 'flag', fmtFull(Math.round(m.end)), '', '',
        'Portfolio value at the end of the selected date range. This is where the strategy line lands on the chart.')}
      ${statCard('Max Drawdown', 'trendDown', ddStr, 'negative', ddRange || '',
        'The worst peak-to-trough drop over the range, revalued at every daily close (so intra-quarter crashes count). The dates below show when it happened.')}
    </div>
  `;
}

// Map of dataset idx → IDs of "live" control blocks that get appended into
// the panel body for that strategy. The actual elements live in a hidden
// host outside the panel so they keep their state/listeners across the
// frequent body re-renders fired by refreshAllLegends().
const PANEL_LIVE_CONTROLS = {
  0: ['9sig-controls', 'what-if-controls'],  // 9sig sidebar: strategy knobs + "what if" experiments (envelope + deploy)
  2: ['bh-controls'],                        // Buy & Hold sidebar: underlying selector (consolidated chip)
  7: ['invested-controls'],                  // Invested Compounded sidebar: the cash interest-rate slider
  8: ['sma-controls'],                       // SMA sidebar: asset + window + underlying selectors
};
const ALL_LIVE_CONTROL_IDS = Array.from(
  new Set(Object.values(PANEL_LIVE_CONTROLS).flat())
);

// Move any currently-injected live control nodes back to their hidden
// hosts. Must be called before replacing innerHTML, otherwise the children
// would be discarded along with the body's old contents.
function detachLiveControls() {
  for (const id of ALL_LIVE_CONTROL_IDS) {
    const node = document.getElementById(id);
    if (!node) continue;
    const host = document.getElementById(id + '-host');
    if (host && node.parentNode !== host) host.appendChild(node);
  }
}

// While a range input that lives INSIDE the panel is being dragged, its
// continuous `input` events fire render() → refreshAllLegends() → this
// function, which would detach + re-prepend the control mid-drag and break
// the drag. Suppress the rebuild during the drag; a final rebuild runs on
// release (see the mouseup/touchend handlers below).
let _suppressPanelRebuild = false;
function _onPanelControlDragStart(e) {
  const t = e.target;
  if (t && t.closest && t.closest('.strategy-panel-content')
      && t.matches && t.matches('input[type="range"]')) {
    _suppressPanelRebuild = true;
  }
}
function _onPanelControlDragEnd() {
  if (!_suppressPanelRebuild) return;
  _suppressPanelRebuild = false;
  if (_currentPanelIdx !== null) renderStrategyPanelBody(_currentPanelIdx);
}
document.addEventListener('mousedown', _onPanelControlDragStart);
document.addEventListener('mouseup', _onPanelControlDragEnd);
document.addEventListener('touchstart', _onPanelControlDragStart, { passive: true });
document.addEventListener('touchend', _onPanelControlDragEnd);

function renderStrategyPanelBody(idx) {
  const body = document.getElementById('strategy-panel-body');
  if (!body || !chart) return;
  // Don't clobber the panel while a slider inside it is being dragged.
  if (_suppressPanelRebuild) return;
  // Snapshot every live-control <select> value before the DOM moves below.
  // Re-inserting a <select> reverts it to its `selected`-attribute default
  // in some browsers, which would silently undo the user's last pick (the
  // chart already rendered with the new value, but the select + its preview
  // trigger would snap back). We restore the snapshot after re-attaching.
  const _selSnap = [];
  for (const id of ALL_LIVE_CONTROL_IDS) {
    const node = document.getElementById(id);
    if (node) node.querySelectorAll('select').forEach(s => _selSnap.push([s, s.value]));
  }
  // Preserve scroll position across the innerHTML rebuild — otherwise toggling
  // a sub-series chip (or any re-render) snaps the sidebar back to the top.
  const _scrollTop = body.scrollTop;
  // Detach hosted controls before clobbering innerHTML.
  detachLiveControls();
  let html = '';
  // Line-color picker + save/update bar for saved strategies (saved-configs.js).
  // Appear right under the live controls (which get prepended below).
  if (PANEL_KEY_BY_IDX[idx] != null) {
    if (typeof buildColorPickerHtml === 'function') html += buildColorPickerHtml(PANEL_KEY_BY_IDX[idx]);
    if (typeof buildPanelSaveBarHtml === 'function') html += buildPanelSaveBarHtml(PANEL_KEY_BY_IDX[idx]);
  }
  // Sub-series chips (9sig's Holding/Target/Cash). When editing a SAVED 9sig the
  // chips toggle THAT strategy's own breakdown lines (per-strategy, persistent —
  // see buildConfigSubChipsHtml); otherwise they toggle the main's datasets 1/5/6.
  const subs = SUB_LEGEND[idx];
  const editingSavedOfType = window._editingConfigId && typeof getSavedConfigs === 'function'
    && getSavedConfigs().find(c => c.id === window._editingConfigId && c.type === PANEL_KEY_BY_IDX[idx]);
  if (subs && subs.length) {
    const chipsHtml = editingSavedOfType && typeof buildConfigSubChipsHtml === 'function'
      ? buildConfigSubChipsHtml(editingSavedOfType)
      : buildLegendChipsHtml(subs, { noMore: true });
    html += `
      <div class="strategy-panel-section-label">Sub-series</div>
      <div class="legend-chip-group">${chipsHtml}</div>
    `;
  }
  html += renderStatsGrid(idx);
  // 9sig-specific content: log first, then the "explained" rules block
  // (rules are reference material; the live log is what the user usually
  // wants to scan after tweaking the controls).
  if (idx === 0) {
    html += buildLogTableHtml(_logData);
    html += `<div class="strategy-rules-wrap" style="margin-top:24px">${buildNineSigRulesHtml()}</div>`;
  }
  // Buy & Hold (idx 2): per-period log of the selected underlying's value.
  // No rebalancing — Type is "Monthly investment" when a contribution lands,
  // else "Hold".
  if (idx === 2 && _logData && _logData.log) {
    const bhKey = ((document.getElementById('select-bh-underlying') || {}).value) || 'tqqq';
    const bhSeries = bhKey === 'qqq'  ? _logData.qqqPoints
                   : bhKey === 'spy'  ? _logData.spyPoints
                   : bhKey === 'qld'  ? _logData.qldPoints
                   : bhKey === 'sso'  ? _logData.ssoPoints
                   : bhKey === 'spxl' ? _logData.spxlPoints
                   :                    _logData.bhPoints;
    html += buildBuyHoldLogTableHtml('Buy & Hold Log', _logData.log, bhSeries, bhKey.toUpperCase());
  }
  // Invested Compounded (idx 7): contributions parked in interest-bearing cash.
  if (idx === 7 && _logData && _logData.log) {
    html += buildSimpleLogTableHtml('Invested Compounded Log', _logData.log,
      (i) => _logData.log[i].investedCompounded,
      (i, m) => i === 0 ? 'Initial' : (m > 0 ? 'Monthly investment' : 'Interest'));
  }
  // SMA-specific content: live signal dashboard + event-driven transaction log.
  if (idx === 8) {
    html += buildSignalMetricsHtml();
    if (_logData && _logData.smaLog) html += buildSmaLogTableHtml(_logData.smaLog);
  }
  body.innerHTML = html;
  // Re-attach live control nodes for this idx (if any). Configuration
  // controls live at the TOP of the panel — above stats/rules/log — so they
  // don't get buried under long content like the rebalance log.
  const liveIds = PANEL_LIVE_CONTROLS[idx];
  if (liveIds) {
    // Reverse so successive prepends preserve the declared order.
    for (const id of [...liveIds].reverse()) {
      const node = document.getElementById(id);
      if (node) body.prepend(node);
    }
  }
  // Restore any <select> values the DOM moves reverted.
  for (const [s, v] of _selSnap) { if (s.value !== v) s.value = v; }
  // Preview-dropdown trigger labels read the (now-correct) select values.
  if (typeof window.refreshPreviewTriggers === 'function') window.refreshPreviewTriggers();
  // Restore the pre-rebuild scroll position.
  body.scrollTop = _scrollTop;
}

// Strategy detail side panel — opens when a legend chip's more-button is
// clicked. Title is the strategy name; body shows nested chips for any
// sub-series defined in SUB_LEGEND (e.g. 9sig's TQQQ holding/target/cash).
// ── Detail-panel emphasis ─────────────────────────────────────────────────
// When a strategy's detail sidebar is open, make its line stand out: double its
// stroke width and dim every OTHER line to 50% opacity. Dimming the border
// colour also dims that line's endpoint dot + label (they read borderColor).
function withAlpha(color, a) {
  if (typeof color !== 'string') return color;
  if (color[0] === '#') {
    let h = color.slice(1);
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${a})`;
  }
  const m = color.match(/rgba?\(([^)]+)\)/);
  if (m) { const p = m[1].split(',').map(s => s.trim()); return `rgba(${p[0]},${p[1]},${p[2]},${a})`; }
  return color;
}
// Which dataset does the open detail panel belong to? -1 = no panel open.
function activePanelDatasetIdx() {
  if (!chart || !chart.data) return -1;
  // Editing a saved/custom config → its OWN line is the active one (the base
  // line the shared sidebar sits on may be hidden). Match the main config line,
  // not its sub-series / envelope ghosts.
  const cid = window._editingConfigId || window._openCustomCfgId;
  if (cid) {
    const i = chart.data.datasets.findIndex(d => d && d._configId === cid && !d._configSub && !d._isShift);
    if (i >= 0) return i;
  }
  if (typeof _currentPanelIdx !== 'undefined' && _currentPanelIdx != null) return _currentPanelIdx;
  return -1;
}
function applyPanelEmphasis(doUpdate) {
  if (!chart || !chart.data) return;
  const ds = chart.data.datasets;
  const activeIdx = activePanelDatasetIdx();
  const active = activeIdx >= 0;
  ds.forEach((d, i) => {
    if (!d) return;
    // Refresh the canonical colour whenever the line isn't currently dimmed, so
    // line-colour overrides get picked up. Width isn't touched elsewhere, so
    // capture it just once.
    if (!d._emphDimmed && typeof d.borderColor === 'string') d._emphBaseC = d.borderColor;
    if (d._emphBaseW == null) d._emphBaseW = (d.borderWidth != null ? d.borderWidth : 1);
    const isActive = active && i === activeIdx;
    const isDim = active && !isActive;
    // The active SMA line, while the SMA panel is open, is fully replaced by the
    // detailed quarter+transaction overlay drawn in the marker plugin — so hide
    // its coarse smooth Chart.js line (0 width). The overlay draws at 2× itself.
    // Applies whether the active line is the base SMA (idx 8) or a saved SMA
    // config's own line — both open panel idx 8. A custom strategy's panel does
    // the same thing with its own log-detail overlay.
    const hideCoarse = isActive && ((typeof _currentPanelIdx !== 'undefined' && _currentPanelIdx === 8) || !!window._openCustomCfgId);
    d.borderWidth = hideCoarse ? 0 : (isActive ? d._emphBaseW * 2 : d._emphBaseW);
    if (d._emphBaseC) d.borderColor = isDim ? withAlpha(d._emphBaseC, 0.5) : d._emphBaseC;
    d._emphDimmed = isDim;
  });
  if (doUpdate !== false && chart.update) chart.update('none');
}

function openStrategyPanel(idx) {
  const panel = document.getElementById('strategy-panel');
  const title = document.getElementById('strategy-panel-title');
  if (!panel) return;
  window._openCustomCfgId = null; // a base panel is opening, not a custom one
  const ds = chart && chart.data.datasets[idx];
  if (title && ds) title.textContent = ds.label;
  _currentPanelIdx = idx;
  renderStrategyPanelBody(idx);
  panel.classList.add('is-open');
  panel.setAttribute('aria-hidden', 'false');
  applyPanelEmphasis();
}
// Open the custom-strategy editor panel (code + generated controls + log).
function openCustomPanel(cfgId) {
  const panel = document.getElementById('strategy-panel');
  if (!panel) return;
  _currentPanelIdx = null;
  window._openCustomCfgId = cfgId;
  window._editingConfigId = cfgId;
  const cfg = (typeof getSavedConfigs === 'function') ? getSavedConfigs().find(c => c.id === cfgId) : null;
  const title = document.getElementById('strategy-panel-title');
  if (title && cfg) title.textContent = cfg.name;
  if (typeof renderCustomPanelBody === 'function') renderCustomPanelBody(cfgId);
  panel.classList.add('is-open');
  panel.setAttribute('aria-hidden', 'false');
  applyPanelEmphasis();
}
function closeStrategyPanel() {
  const panel = document.getElementById('strategy-panel');
  if (!panel) return;
  // Closing the panel means nothing is being edited — so the base lines must go
  // back to their fixed canonical state. Reset whichever base type's knobs were
  // loaded in the sidebar (a saved strategy left its params there) so the base
  // line doesn't keep showing those edits once the panel is gone.
  const openKey = getOpenPanelKey();
  if (openKey && typeof resetBaseControlsToCanonical === 'function') resetBaseControlsToCanonical(openKey);
  window._editingConfigId = null;
  window._pendingConfigName = null;
  window._openCustomCfgId = null;
  _currentPanelIdx = null;
  panel.classList.remove('is-open');
  panel.setAttribute('aria-hidden', 'true');
  if (openKey && typeof render === 'function') render();
  applyPanelEmphasis(); // restore all lines to full width/opacity
}
// Gated close: when a BASE panel has edits that differ from canonical defaults,
// closing would silently reset them — so warn first. Editing a saved strategy
// auto-syncs live, so no warning is needed there.
function attemptCloseStrategyPanel() {
  const key = getOpenPanelKey();
  const editingSaved = window._editingConfigId
    && typeof getSavedConfigs === 'function'
    && getSavedConfigs().some(c => c.id === window._editingConfigId && c.type === key);
  const dirty = key && !editingSaved
    && typeof captureParams === 'function'
    && typeof captureDefaultParams === 'function'
    && typeof paramsEqual === 'function'
    && !paramsEqual(captureParams(key), captureDefaultParams(key), key);
  if (!dirty) { closeStrategyPanel(); return; }
  showUnsavedDialog(key,
    () => { if (typeof saveConfigFromType === 'function') saveConfigFromType(key); closeStrategyPanel(); },
    () => closeStrategyPanel());
}

// Stable keys for the openable strategy panels, so a share link can capture
// which sidebar was open without depending on dataset indices (which shift
// between versions). Used by shareConfig (controls.js) + restore (init.js).
const PANEL_KEY_BY_IDX = { 0: '9sig', 2: 'bh', 7: 'invested', 8: 'sma' };
const PANEL_IDX_BY_KEY = { '9sig': 0, 'bh': 2, 'invested': 7, 'sma': 8 };
function getOpenPanelKey() {
  return (_currentPanelIdx != null) ? (PANEL_KEY_BY_IDX[_currentPanelIdx] || null) : null;
}
function openPanelByKey(key) {
  const idx = PANEL_IDX_BY_KEY[key];
  if (idx != null) openStrategyPanel(idx);
}

// Re-render whichever legend surface(s) need updating after a visibility
// toggle — main legend always; the side panel's nested chips when open.
function refreshAllLegends() {
  renderChartLegend();
  if (_currentPanelIdx !== null) renderStrategyPanelBody(_currentPanelIdx);
  if (window._openCustomCfgId && typeof renderCustomPanelBody === 'function') renderCustomPanelBody(window._openCustomCfgId);
  if (typeof renderSavedConfigPills === 'function') renderSavedConfigPills();
}

// The x-axis date grain is the FINEST rebalance period among the 9sig strategies
// that will actually be drawn — the main 9sig (if its line is visible) plus every
// visible saved 9sig. Coarser strategies step-resample onto it without losing
// detail, and (crucially) it doesn't flip when the main resets on save/close.
// `livePeriod` is the edited strategy's own period (the main line uses it when the
// main is the one being drawn; otherwise the main is canonical/hidden).
const _PERIOD_RANK = { weekly: 0, monthly: 1, quarterly: 2, yearly: 3 };
function _finerPeriod(a, b) {
  if (!a) return b;
  if (!b) return a;
  return (_PERIOD_RANK[a] ?? 2) <= (_PERIOD_RANK[b] ?? 2) ? a : b;
}
// Whole-year span between two 'YYYY-MM-DD' dates — used only to decide the
// chart's sampling floor below, so an approximate 365.25-day year is fine.
function _yearsSpan(entryDate, exitDate) {
  if (!entryDate || !exitDate) return Infinity;
  const a = new Date(entryDate + 'T00:00:00Z'), b = new Date(exitDate + 'T00:00:00Z');
  return (b - a) / (365.25 * 24 * 3600 * 1000);
}
function chartDisplayPeriod(livePeriod, spanYears) {
  let p = null;
  // Main 9sig line: its period is the live (draft) period when we're editing the
  // main, or canonical quarterly when a saved strategy is being edited.
  const mainVisible = chart ? chart.isDatasetVisible(0) : false;
  if (mainVisible) p = window._editingConfigId ? 'quarterly' : livePeriod;
  if (typeof getSavedConfigs === 'function') {
    for (const c of getSavedConfigs()) {
      if (c.type === '9sig' && !c.hidden) {
        p = _finerPeriod(p, (c.params && c.params['select-9sig-period']) || 'quarterly');
      }
    }
  }
  // Floor the x-axis at QUARTERLY normally, or WEEKLY for a short (<10y)
  // window — a coarser strategy is still drawn/hovered at the floor's
  // resolution via the sim's sampleQuarterly/sampleWeekly snapshots (see
  // js/simulate.js). Go finer than the floor only when an even-finer
  // strategy (monthly / weekly) is actually visible.
  const floor = (spanYears != null && spanYears < 10) ? 'weekly' : 'quarterly';
  return _finerPeriod(p || livePeriod || floor, floor);
}
// The chart's minimum plottable value is 1. Values below 1 (e.g. a strategy fully
// out of cash → Cash = 0) are raised to 1 so they always render: on a log axis 0
// can't be plotted (log of 0 is undefined) and the line would vanish; 1 keeps it
// continuous at the very bottom ("simulate zero"). Real gaps (null) are left alone.
const CHART_MIN = 1;
function clampChartMin(chart) {
  if (!chart || !chart.data) return;
  for (const ds of chart.data.datasets) {
    const d = ds.data;
    if (!d) continue;
    for (let i = 0; i < d.length; i++) {
      if (typeof d[i] === 'number' && d[i] < CHART_MIN) d[i] = CHART_MIN;
    }
  }
}
// Single delegated click handler — the legend HTML gets replaced on every
// render, so attaching here once on document avoids leaks/duplicate
// listeners while still working after re-renders.
document.addEventListener('click', (e) => {
  // More-button click → open the side panel for this strategy. Check this
  // first so we don't also fire the visibility toggle.
  const moreBtn = e.target.closest('.legend-more');
  if (moreBtn) {
    const chip = moreBtn.closest('.legend-chip[data-idx]');
    // Opening a base strategy's sidebar means we're editing the live config,
    // not a saved one — clear the saved-config edit target + any pending name.
    window._editingConfigId = null;
    window._pendingConfigName = null;
    if (chip) {
      const idx = +chip.dataset.idx;
      // "Open sig tqqq" = start from a clean canonical copy: reset this type's
      // knob controls so the base line doesn't inherit a saved strategy's params
      // that may still be loaded in the sidebar from a previous edit.
      const key = PANEL_KEY_BY_IDX[idx];
      if (key && typeof resetBaseControlsToCanonical === 'function') resetBaseControlsToCanonical(key);
      // The main strategy may have been auto-hidden by a previous save — re-show
      // it so you're not editing an invisible line.
      if (key && typeof setBaseStrategyVisibility === 'function') setBaseStrategyVisibility(key, true);
      openStrategyPanel(idx);
      if (typeof render === 'function') render();
    }
    return;
  }
  // Side-panel close button → close. Clicking the backdrop does NOT close
  // the panel: the user can keep tweaking strategy knobs in the sidebar and
  // see the chart update behind it without losing the panel each time they
  // click on the chart area. Use the × button or Esc to dismiss.
  if (e.target.closest('.strategy-panel-close')) {
    attemptCloseStrategyPanel();
    return;
  }
  // Anywhere else on the chip → toggle dataset visibility.
  const chip = e.target.closest('.legend-chip[data-idx]');
  if (!chip || !chart) return;
  const idx = +chip.dataset.idx;
  if (!Number.isFinite(idx)) return;
  const nextVisible = !chart.isDatasetVisible(idx);
  chart.setDatasetVisibility(idx, nextVisible);
  // Re-showing the MAIN strategy resets it to its defaults — it's a fixed
  // canonical reference, not a place edits persist. Skip when a saved strategy of
  // this type is being edited (the base is already frozen canonical and its
  // controls belong to that saved strategy, so resetting would corrupt it).
  let forceRender = false;
  const baseKey = PANEL_KEY_BY_IDX[idx];
  if (nextVisible && baseKey != null) {
    const editingSavedOfType = window._editingConfigId
      && typeof getSavedConfigs === 'function'
      && getSavedConfigs().some(c => c.id === window._editingConfigId && c.type === baseKey);
    if (!editingSavedOfType && typeof resetBaseControlsToCanonical === 'function') {
      resetBaseControlsToCanonical(baseKey);
      forceRender = true;
    }
  }
  // When the user hides a parent chip, cascade-hide its sub-series too —
  // otherwise the orphaned Holding/Target/Cash lines would stay on the
  // chart with no parent line to anchor them. Showing the parent does NOT
  // auto-reveal sub-series (they're hidden by default and toggled via the
  // side panel).
  if (!nextVisible) {
    const subs = SUB_LEGEND[idx];
    if (subs) for (const sIdx of subs) chart.setDatasetVisibility(sIdx, false);
  }
  // The main 9sig's visibility changes which strategies the x-axis grain is
  // computed from (chartDisplayPeriod), so the chart must be fully recomputed.
  if (idx === 0) forceRender = true;
  // If we're going to render() anyway, do NOT also run an animated chart.update()
  // first: when the label count changes (e.g. 17↔62) the in-flight animated
  // update fights render()'s update('none') and leaves stale, looped line paths
  // ("going back in time"). Persist + render once, cleanly.
  if (forceRender) {
    if (typeof saveSliders === 'function') saveSliders();
    render();
    return;
  }
  // Snap (no animation) rather than animate. An animated toggle animates the
  // line's points and the y-axis bounds on separate tracks, so a just-shown line
  // — especially on a rapid hide→show before the prior animation settles — is
  // drawn at its true values while the viewport hasn't grown to fit it yet, and
  // it overflows off-screen. update('none') recomputes the scale and redraws in
  // one synchronous pass, so the line and its viewport are always in sync.
  chart.update('none');
  refreshAllLegends();
  // Persist so a plain page refresh keeps the same legend visibility mix.
  if (typeof saveSliders === 'function') saveSliders();
  // If the just-toggled dataset has a limited history (e.g. SMA),
  // re-render so the date-range floor recomputes and the slider snaps
  // forward if it was sitting before the new floor.
  if (typeof DATASET_IDX_TO_STRATEGY_KEY !== 'undefined') {
    const stratKey = DATASET_IDX_TO_STRATEGY_KEY[idx];
    const e = (stratKey != null && typeof earliestQIdxOf === 'function') ? earliestQIdxOf(stratKey) : 0;
    if (e > 0) render();
  }
});

// Esc closes the side panel too.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const panel = document.getElementById('strategy-panel');
  if (panel && panel.classList.contains('is-open')) attemptCloseStrategyPanel();
});

// Desktop-only: size .chart-container to fill whatever vertical space is
// actually left below the fold, without pushing the page tall enough to
// scroll. A pure-CSS stretch chain (body → grid → flex → flex-grow) turned
// out to fight itself — nested auto-height containers don't reliably clamp
// to "available space, no more" — so this measures the real rendered layout
// instead. It's exact in one pass: nothing above or below the chart depends
// on the chart's OWN height, only on how much taller/shorter it makes the
// page, so "how far is the entry/exit block's bottom edge from where it
// should end" IS the exact amount to grow or shrink the chart by.
let _chartFitRaf = null;
function fitChartHeight() {
  if (_chartFitRaf) return; // coalesce bursts (resize, rapid render() calls)
  _chartFitRaf = requestAnimationFrame(() => {
    _chartFitRaf = null;
    if (window.innerWidth <= 900) return; // mobile/tablet keep their fixed 420px
    const container = document.querySelector('.chart-container');
    const controlGroup = document.querySelector('.right-col .control-group');
    if (!container || !controlGroup) return;
    const bodyPadBottom = parseFloat(getComputedStyle(document.body).paddingBottom) || 0;
    const target = window.innerHeight - bodyPadBottom - 4; // 4px margin against sub-pixel rounding
    const delta = target - controlGroup.getBoundingClientRect().bottom;
    const current = container.getBoundingClientRect().height;
    const next = Math.max(420, Math.min(1100, current + delta));
    if (Math.abs(next - current) < 1) return; // avoid redundant style writes
    document.documentElement.style.setProperty('--chart-fit-height', next + 'px');
  });
}
window.addEventListener('resize', fitChartHeight);

// The ~15 select-sma-* knobs simulateSMA() needs beyond asset/window/underlying
// (those three differ by caller — see below). Both the main chart's live SMA
// line (render(), this file) and the analytics heatmap's SMA runs
// (js/analytics.js's _smaParamsForAnalytics) read this same set with the same
// defaults — shared here so a newly-added select-sma-* control (see CLAUDE.md's
// "Adding a new configurable control" checklist) only needs updating in one
// place, not two independently-typed copies that can quietly drift apart —
// the same failure shape this session already found and fixed three times
// (customSig, the param-bar preview cache, slRunCode).
function readSmaBaseOpts() {
  return {
    entryBufferPct:       +((document.getElementById('select-sma-entry-buf') || {}).value) || 0,
    exitBufferPct:        +((document.getElementById('select-sma-exit-buf')  || {}).value) || 0,
    rsiOverheatThreshold: +((document.getElementById('select-sma-rsi-oh')   || {}).value) || 0,
    rsiCoolThreshold:     +((document.getElementById('select-sma-rsi-cool') || {}).value) || 0,
    outAsset:       ((document.getElementById('select-sma-out-asset') || {}).value) || 'cash',
    dcaInMonths:    +((document.getElementById('select-sma-dca-in')      || {}).value) || 0,
    dcaToOutMonths: +((document.getElementById('select-sma-dca-to-out')  || {}).value) || 0,
    bgGtfoPct:      +((document.getElementById('select-sma-bg-gtfo')     || {}).value) || 0,
    bgAsset:        ((document.getElementById('select-sma-bg-asset')     || {}).value) || 'qqq',
    bgWindow:       +((document.getElementById('select-sma-bg-window')   || {}).value) || 0,
    tradeCostPct:   +((document.getElementById('select-sma-cost')        || {}).value) || 0,
    rsiOhWindow:    +((document.getElementById('select-sma-rsi-oh-window')   || {}).value) || 10,
    rsiCoolWindow:  +((document.getElementById('select-sma-rsi-cool-window') || {}).value) || 10,
    rebalanceCheck: 'daily',
    confirmBuySteps:  +((document.getElementById('select-sma-confirm-buy')  || {}).value) || 0,
    confirmSellSteps: +((document.getElementById('select-sma-confirm-sell') || {}).value) || 0,
    settleDays:       +((document.getElementById('select-sma-settle')       || {}).value) || 0,
  };
}

// The select-9sig-* knobs simulate() needs, shared the same way readSmaBaseOpts()
// is above — chart.js's live 9sig line, analytics.js's heatmap 9sig runs, and
// preview-dropdown.js's bar previews all read this same set with the same
// defaults. underlyingCol and rebalancePeriod are deliberately NOT here: each
// caller derives them differently (chart.js's rebalancePeriod freezes to
// canonical quarterly while a saved config is being edited — analytics.js and
// preview-dropdown.js have no such concept — so folding it into the shared
// object would paper over a real behavioral difference, not just syntax).
function read9sigBaseOpts() {
  const crashDropPct    = +((document.getElementById('select-9sig-crashdrop') || {}).value);
  const spikeTriggerPct = +((document.getElementById('select-9sig-spike')     || {}).value);
  return {
    qGrowth:             +((document.getElementById('select-9sig-growth') || {}).value) / 100 || 0.09,
    crashDropPct:        Number.isFinite(crashDropPct) ? crashDropPct : 30,
    crashLookbackMonths: +((document.getElementById('select-9sig-crashwin') || {}).value) || 24,
    spikeTriggerPct:     Number.isFinite(spikeTriggerPct) ? spikeTriggerPct : 100,
    cashPct:             (+((document.getElementById('select-9sig-cash') || {}).value) || 0) / 100,
    contribDeployPct:    (+((document.getElementById('select-9sig-deploy') || {}).value) || 0) / 100,
    targetFromPrevTarget: ((document.getElementById('select-9sig-target-compound') || {}).value) === 'target',
    buyThrottlePct:      +((document.getElementById('select-9sig-buypower') || {}).value) || 90,
    parkAsset:           ((document.getElementById('select-9sig-park-asset') || {}).value) || 'cash',
    spikeResetPct:       ((document.getElementById('select-9sig-spike-target') || {}).value) || 'auto',
    tradeCostPct:        +((document.getElementById('select-9sig-cost') || {}).value) || 0,
  };
}

function render() {
  if (!quarterlyData) return; // data not loaded yet
  // Live-edit: mirror sidebar changes into the open saved strategy before the
  // config lines are computed, so its line/label track the dropdowns instantly.
  if (typeof syncEditingConfig === 'function') syncEditingConfig();
  // The chart's x-axis grain must not flip when the main strategy resets on save.
  // Capture the EDITED strategy's period now (controls, before the freeze swaps
  // them to canonical); chartPeriod() below picks the finest grain among visible
  // 9sig strategies so the axis stays stable and represents them all.
  const _livePeriod = ((document.getElementById('select-9sig-period') || {}).value) || 'quarterly';
  // …then freeze the base line of the edited type to its canonical defaults so
  // the fixed top pill doesn't track the controls (which now belong to the saved
  // strategy). Restored just before the panel/legends are rebuilt below.
  if (typeof freezeBaseForEditing === 'function') freezeBaseForEditing();
  let initial = sliderToInitial(+document.getElementById('slider-initial').value);
  const monthly = sliderToMonthly(+document.getElementById('slider-monthly').value);
  const annualRaise = +document.getElementById('slider-raise').value / 100;
  // A real uploaded transaction history (js/transactions.js) overrides the
  // Initial Investment slider with its own first (earliest) transaction, and
  // hands every engine its own real contribution schedule below instead of
  // the monthly/annualRaise formula. `monthly`/`annualRaise` stay as read —
  // harmless once `contribSchedule` is passed, since every engine prefers
  // opts.schedule over recomputing its own formula-based one.
  if (window._txSchedule) initial = window._txSchedule.initial;
  const contribSchedule = window._txSchedule ? window._txSchedule.schedule : undefined;
  // `rate` is the Invested Compounded baseline rate (the slider in that
  // sidebar). 9sig and SMA each have their own parked-cash rate now.
  const rate = sliderToRate(+document.getElementById('slider-rate').value) / 100;
  const nineSigCashRate = (+((document.getElementById('select-9sig-cashrate') || {}).value) || 0) / 100;
  const smaCashRate     = (+((document.getElementById('select-sma-cashrate')  || {}).value) || 0) / 100;
  const logScale = document.getElementById('chart-log-toggle').getAttribute('aria-pressed') === 'true';
  let entryIdx = +document.getElementById('slider-entry').value;
  let exitIdx = +document.getElementById('slider-exit').value;

  // Clamp to valid range — saved values from a prior dataset may be stale.
  const maxIdx = quarterlyData.length - 1;
  if (!Number.isFinite(entryIdx) || entryIdx < 0) entryIdx = 0;
  if (!Number.isFinite(exitIdx)  || exitIdx  < 0) exitIdx  = maxIdx;
  if (entryIdx > maxIdx) entryIdx = maxIdx;
  if (exitIdx  > maxIdx) exitIdx  = maxIdx;

  // Strategy-aware floor: if a limited-history series is visible, bump the
  // entry forward so the chart doesn't show "$0 until first data point" for
  // that line.
  const floorIdx = (typeof effectiveEntryMinQIdx === 'function') ? effectiveEntryMinQIdx() : 0;
  if (entryIdx < floorIdx) entryIdx = floorIdx;

  if (entryIdx >= exitIdx) {
    exitIdx  = Math.min(entryIdx + 1, maxIdx);
    entryIdx = Math.min(entryIdx, exitIdx - 1);
    if (entryIdx < 0) entryIdx = 0;
  }
  document.getElementById('slider-entry').value = entryIdx;
  document.getElementById('slider-exit').value  = exitIdx;
  // "Enter at quarter start" shift: the slider pick maps to a quarter's LAST
  // trading day in quarterlyData; we want deployment to happen at the END of
  // the prior quarter (= effective START of the chosen quarter) so the picked
  // quarter actually runs through the strategy. Applied once here and passed
  // to every sim (main + envelope + SMA) so all return arrays stay aligned to
  // the same x-axis. The unshifted `entryIdx` is kept for the display label.
  const simEntryIdx = entryIdx > 0 ? entryIdx - 1 : entryIdx;
  // Update the dual-range UI in case clamping moved the entry handle.
  if (window._dualRange && typeof window._dualRange.updateUI === 'function') {
    window._dualRange.updateUI();
  }

  // Exact-day override (calendar picker, js/date-picker.js). Cleared
  // automatically the instant the coarse slider is dragged — see
  // initDualRange()'s onChanged() in controls.js.
  let entryOverride = (document.getElementById('entry-exact-date') || {}).value || '';
  let exitOverride  = (document.getElementById('exit-exact-date')  || {}).value || '';
  // Defensive: a restored/shared value might point at a non-trading day or an
  // inverted range (hand-edited URL, stale localStorage from a shorter data
  // window). Silently fall back to quarter-snapped rather than breaking render.
  if (entryOverride && (!dailyDateToIdx || !dailyDateToIdx.has(entryOverride))) entryOverride = '';
  if (exitOverride  && (!dailyDateToIdx || !dailyDateToIdx.has(exitOverride)))  exitOverride  = '';
  if (entryOverride && exitOverride && entryOverride >= exitOverride) { entryOverride = ''; exitOverride = ''; }
  const entryDateForSim = entryOverride || (quarterlyData[simEntryIdx] && quarterlyData[simEntryIdx][0]);
  const exitDateForSim  = exitOverride  || (quarterlyData[exitIdx]    && quarterlyData[exitIdx][0]);
  // Day-over-day change badge (endLabelPlugin) only makes sense when the chart
  // is actually showing the most recent data — a historical exit date has no
  // "since yesterday" to speak of. prevTradingDayDate stays null (and the
  // badge stays off) if there's under 2 days of daily data, or if the entry
  // date is at/after "yesterday" (buildExactRangeQData's own eIdx>=xIdx guard
  // would return [] for that range anyway — checked explicitly here instead
  // of relying on that to degrade gracefully downstream).
  const prevTradingDayDate = (typeof daily !== 'undefined' && daily && daily.length >= 2)
    ? daily[daily.length - 2].date : null;
  let isLatestDaySelected = !!(prevTradingDayDate && typeof daily !== 'undefined' && daily &&
    exitDateForSim === daily[daily.length - 1].date);
  if (isLatestDaySelected && entryDateForSim >= prevTradingDayDate) isLatestDaySelected = false;
  const entryPickBtn = document.getElementById('entry-date-pick');
  const exitPickBtn  = document.getElementById('exit-date-pick');
  if (entryPickBtn) entryPickBtn.classList.toggle('is-active', !!entryOverride);
  if (exitPickBtn)  exitPickBtn.classList.toggle('is-active', !!exitOverride);

  document.getElementById('disp-initial').textContent = fmtFull(initial);
  document.getElementById('disp-monthly').textContent = fmtFull(monthly);
  // Annual increase is now a dropdown that shows its own value — no separate display.
  const _dispRaise = document.getElementById('disp-raise');
  if (_dispRaise) { const raiseVal = annualRaise * 100; _dispRaise.textContent = (raiseVal % 1 === 0 ? raiseVal.toFixed(0) : raiseVal.toFixed(1)) + '%'; }
  const rv = (rate * 100);
  // Rate is always 0.5%-snapped (see sliderToRate), so 1 decimal place is enough.
  document.getElementById('disp-rate').textContent = rv.toFixed(1) + '%';
  document.getElementById('disp-entry').textContent = entryOverride ? fmtDayMonthYear(entryOverride) : qLabel(quarterlyData[entryIdx][0]);
  document.getElementById('disp-exit').textContent  = exitOverride  ? fmtDayMonthYear(exitOverride)  : qLabel(quarterlyData[exitIdx][0]);

  // Per-strategy underlying + 9sig signal-growth from their side-panel selects.
  // SMA has its own selector because its only relationship to the leveraged
  // ETF is "hold it or not".
  // Column index in quarterlyData: 1=TQQQ, 4=QLD, 5=SSO, 6=SPXL. ulColFromVal
  // is the canonical asset->column mapping (js/saved-configs.js) — this used
  // to be its own reimplementation of the same ternary chain.
  const ulSel = (id) => ulColFromVal((document.getElementById(id) || {}).value);
  const sigUlCol = ulSel('select-9sig-underlying');
  const smaUlCol = ulSel('select-sma-underlying');
  // qGrowth, crashDropPct, crashLookbackMonths, spikeTriggerPct, cashPct,
  // contribDeployPct, targetFromPrevTarget, buyThrottlePct, parkAsset,
  // spikeResetPct, tradeCostPct — see read9sigBaseOpts() above.
  const _sig9Base = read9sigBaseOpts();
  // Two distinct periods, deliberately decoupled for correctness:
  //   • mainPeriod  — the period the MAIN 9sig line is actually SIMULATED at:
  //     its own live period (or canonical quarterly while a saved config is
  //     being edited). This must NOT depend on what else is visible, or the main
  //     line + its metrics would be computed at the wrong rebalance frequency.
  //   • displayGrain — the FINEST rebalance period among the visible 9sig lines.
  //     Used only for the shared x-axis so no visible strategy loses detail; a
  //     coarser line is step-resampled onto it (identity when the grains match).
  const mainPeriod   = window._editingConfigId ? 'quarterly' : _livePeriod;
  const displayGrain = chartDisplayPeriod(_livePeriod, _yearsSpan(entryDateForSim, exitDateForSim));

  // Rebalance point: % of the way through each period where the check happens
  // (0 = start, 100 = end). Maps to a trading-day offset and shifts the schedule
  // via buildEnvelopeQData(). Only builds a custom schedule when > 0 so the
  // default keeps the fast period-boundary path.
  const _rebalPct = (+((document.getElementById('select-9sig-rebalance-point') || {}).value) || 0);
  let _rebalQData = null;
  if (_rebalPct > 0 && typeof buildEnvelopeQData === 'function' && typeof PERIOD_DAYS !== 'undefined') {
    const _pd = PERIOD_DAYS[mainPeriod] || 63;
    const _off = Math.round(_rebalPct / 100 * (_pd - 1));
    const _q = buildEnvelopeQData(mainPeriod, _off, entryDateForSim, exitDateForSim);
    if (_q && _q.length >= 2) _rebalQData = _q;
  }
  // Exact-day override qData — only when the rebalance-point feature above
  // hasn't already claimed qData (that path is itself already anchored at
  // entryDateForSim/exitDateForSim, so it's automatically day-exact too).
  let _exactQData = null;
  if (!_rebalQData && (entryOverride || exitOverride) && typeof buildExactRangeQData === 'function') {
    const _q2 = buildExactRangeQData(mainPeriod, entryDateForSim, exitDateForSim);
    if (_q2 && _q2.length >= 2) _exactQData = _q2;
  }

  const sigOpts = {
    ..._sig9Base,
    schedule: contribSchedule,
    ...(_rebalQData ? { qData: _rebalQData } : _exactQData ? { qData: _exactQData } : {}),
    ...((entryOverride || exitOverride) ? { entryDateOverride: entryDateForSim, exitDateOverride: exitDateForSim } : {}),
    underlyingCol: sigUlCol,
    rebalancePeriod: mainPeriod,
    // mainPeriod coarser than the shared axis grain → ask the sim for
    // in-between value snapshots at that grain so the line/hover don't lose
    // resolution. Mutually exclusive: displayGrain is only ever one or the
    // other (js/chart.js's chartDisplayPeriod floors at weekly for a <10y
    // window, quarterly otherwise).
    sampleQuarterly: displayGrain === 'quarterly' && mainPeriod === 'yearly',
    sampleWeekly: displayGrain === 'weekly' && mainPeriod !== 'weekly',
    // Invested Compounded baseline (computed inside this sim) uses the global
    // rate; the 9sig parked cash uses its own rate (passed as the 3rd arg).
    baselineRate: rate,
  };
  const { log, bhPoints, qqqPoints, spyPoints, qldPoints, ssoPoints, spxlPoints, totalContributed,
          samplePoints, bhSample, qqqSample, spySample, qldSample, ssoSample, spxlSample } = simulate(initial, monthly, nineSigCashRate, simEntryIdx, exitIdx, annualRaise, sigOpts);
  // For each line, the points fed to the chart: the quarter-end snapshots when
  // the run is coarser than the axis (yearly), else the rebalance-grain points.
  // Driven by the SAME sampleQuarterly/sampleWeekly flags passed to simulate()
  // above, not by whether samp happens to be non-empty — a duck-typed check
  // would silently fall back to the coarser pts if the sampling path ever
  // breaks, hiding a bug instead of surfacing it as a visibly wrong line.
  const wantsSample = sigOpts.sampleQuarterly || sigOpts.sampleWeekly;
  const pick = (samp, pts) => wantsSample ? samp : pts;
  const sigPts = pick(samplePoints, log);
  const bhPtsD = pick(bhSample, bhPoints);
  const qqqPtsD = pick(qqqSample, qqqPoints);
  const spyPtsD = pick(spySample, spyPoints);
  const qldPtsD = pick(qldSample, qldPoints);
  const ssoPtsD = pick(ssoSample, ssoPoints);
  const spxlPtsD = pick(spxlSample, spxlPoints);

  // Shared x-axis. When the display grain matches the main's own period (the
  // common case) the labels ARE the main log's dates and every series maps 1:1
  // (byte-identical to before). When a finer-period strategy is visible, the
  // axis dates come from a dates-only sim at the finer grain and each line is
  // step-resampled onto them — so lines stay aligned without ever changing the
  // period a strategy is computed at.
  const sameGrain = (displayGrain === mainPeriod);
  // sigOpts.qData (rebalance-point / exact-date-override) is built at
  // mainPeriod's grain — dropped here so this dates-only sim resolves its own
  // qData from periodDataByName[displayGrain] instead of silently inheriting
  // mainPeriod's (coarser) dates. Left in, this collapsed the whole shared
  // axis to mainPeriod's resolution any time an exact-date override was
  // active — e.g. every transaction-history-backed run (js/transactions.js's
  // applyTxEntryDate always sets the exact-date override), never weekly.
  // entryDateOverride/exitDateOverride stay, so the exact entry/exit dates
  // are still honored via simulate()'s own re-derivation into that qData.
  const { qData: _sigOptsQData, ...sigOptsForLabels } = sigOpts;
  const labels = sameGrain
    ? log.map(l => l.date)
    : simulate(initial, monthly, nineSigCashRate, simEntryIdx, exitIdx, annualRaise,
        Object.assign({}, sigOptsForLabels, { rebalancePeriod: displayGrain, skipBH: true, sampleQuarterly: false, sampleWeekly: false })).log.map(l => l.date);
  const onLabels = (arr, valOf) => sameGrain
    ? arr.map(valOf)
    : resampleByDate((arr || []).map(a => ({ date: a.date, value: valOf(a) })), labels);

  // SMA timing strategy: same entry/exit window, same contributions, just
  // a different in/out rule. Independent of 9sig's quarterly rebalance —
  // it lives off the precomputed SMA-at-monthly map keyed by asset+window.
  const smaAsset  = (document.getElementById('select-sma-asset')  || {}).value || 'qqq';
  const smaWindow = +((document.getElementById('select-sma-window') || {}).value) || 200;
  const smaOpts = {
    smaAsset, smaWindow, underlyingCol: smaUlCol,
    schedule: contribSchedule,
    ...readSmaBaseOpts(),
    ...((entryOverride || exitOverride) ? { entryDateOverride: entryDateForSim, exitDateOverride: exitDateForSim } : {}),
    emitDD: true, // dense per-step multi-asset control points for an accurate max-drawdown
    // smaPoints (the chart-rendered series) is otherwise only pushed on
    // quarter-end dates regardless of window length — this fills it out to
    // weekly resolution on a <10y window, same idea as 9sig's sampleWeekly.
    sampleWeekly: displayGrain === 'weekly',
  };
  const { smaPoints, smaLog, ddControls: smaDdControls } = simulateSMA(initial, monthly, smaCashRate, simEntryIdx, exitIdx, annualRaise, smaOpts);

  if (log.length < 1) {
    if (chart) { chart.destroy(); chart = null; }
    _logData = null;
    if (typeof restoreBaseAfterEditing === 'function') restoreBaseAfterEditing();
    refreshAllLegends();
    return;
  }

  const finalLog = log[log.length - 1];
  const finalBH = bhPoints[bhPoints.length - 1].value;
  const finalQQQ = qqqPoints[qqqPoints.length - 1].value;
  const finalSPY = spyPoints[spyPoints.length - 1].value;
  const finalQLD  = qldPoints  && qldPoints.length  ? qldPoints[qldPoints.length - 1].value   : 0;
  const finalSSO  = ssoPoints  && ssoPoints.length  ? ssoPoints[ssoPoints.length - 1].value   : 0;
  const finalSPXL = spxlPoints && spxlPoints.length ? spxlPoints[spxlPoints.length - 1].value : 0;
  const finalSMA  = smaPoints  && smaPoints.length  ? smaPoints[smaPoints.length - 1].value   : 0;
  const years = log.length > 1 ? (new Date(log[log.length-1].date) - new Date(log[0].date)) / (365.25*86400000) : 1;
  // Simple end/start growth — kept for the sub-series fallback (their CAGR is the
  // annualized growth of their own balance, not a contribution-based return).
  const cagr = (end, start) => years > 0 && start > 0 ? (Math.pow(end / start, 1 / years) - 1) * 100 : 0;
  // #2 Money-weighted (IRR) return for the headline strategies: weights each
  // contributed dollar by how long it was invested, instead of pretending the
  // whole `totalContributed` was deposited on day one. Same contribution
  // schedule for every strategy — only the final value differs.
  const _mw = (finalValue) => moneyWeightedCAGR(
    initial, monthly, annualRaise, log[0].date, finalLog.date,
    years, finalValue, (typeof monthlyData !== 'undefined' ? monthlyData : null), totalContributed,
    contribSchedule);
  const ret9 = _mw(finalLog.total);
  const retBH = _mw(finalBH);
  const retQQQ = _mw(finalQQQ);
  const retSPY = _mw(finalSPY);
  const retQLD  = _mw(finalQLD);
  const retSSO  = _mw(finalSSO);
  const retSPXL = _mw(finalSPXL);
  const retSMA  = _mw(finalSMA);
  const retInv = _mw(finalLog.investedCompounded);

  // Consolidated Buy & Hold chip (dataset 2) — picks one of the four B&H
  // series based on #select-bh-underlying. We swap the dataset's data + CAGR
  // here so the legend chip and chart line reflect the user's choice without
  // requiring any new dataset indices.
  const bhKey = ((document.getElementById('select-bh-underlying') || {}).value) || 'tqqq';
  // Legend chip / chart line / panel header all read this single label —
  // "Buy & Hold" is intentionally generic (the active underlying is visible
  // via the sidebar selector itself).
  const bhPicked =
    bhKey === 'qqq'  ? { series: qqqPoints,         ret: retQQQ }  :
    bhKey === 'spy'  ? { series: spyPoints,         ret: retSPY }  :
    bhKey === 'qld'  ? { series: qldPoints || [],   ret: retQLD }  :
    bhKey === 'sso'  ? { series: ssoPoints || [],   ret: retSSO }  :
    bhKey === 'spxl' ? { series: spxlPoints || [],  ret: retSPXL } :
                       { series: bhPoints,          ret: retBH }   ;

  // Static, plain strategy labels — they don't encode (or change with) the
  // chosen parameters. The active underlying / window / rate are visible via the
  // sidebar selectors instead.
  const LBL_9SIG = '9sig';
  const LBL_SMA  = 'SMA';
  // Buy & Hold spells out the underlying it's actually holding (default TQQQ →
  // "Buy & Hold TQQQ"; follows #select-bh-underlying when switched).
  const LBL_BH   = 'Buy & Hold ' + bhKey.toUpperCase();
  const LBL_INV  = 'Invested Compounded';
  bhPicked.label = LBL_BH;

  // CAGR per dataset index. Dataset 2 reads from whichever B&H series the
  // user selected (consolidated chip — see bhKey / bhPicked above).
  window._cagrByDatasetIdx = {
    0: ret9,
    2: bhPicked.ret,
    7: retInv,
    8: retSMA,
  };

  // Day-over-day change badge (drawn by endLabelPlugin, gated on
  // isLatestDaySelected computed above near exitDateForSim). Each line's
  // "yesterday" side is today's END-STATE HOLDINGS marked at the previous
  // trading day's close — repriceAtPrevTradingDay (js/utils.js) explains why
  // a reprice, not a second exit-shifted simulation (the engines' month-row
  // contribution walk makes an exit-shifted sim drop the whole current
  // month, which then masquerades as a one-day move). Stored as raw
  // yesterday VALUES (deflated to real $ when the inflation toggle is on) —
  // endLabelPlugin's dayChangeFor diffs each against whatever TODAY value
  // the chart is actually drawing, so both sides are always in the same
  // (nominal or deflated) units. Invested Compounded gets no badge: it's a
  // monthly-stepped synthetic baseline with no meaningful close-to-close
  // daily change.
  window._ydayValueByIdx = {};
  if (isLatestDaySelected) {
    const defl = inflationOn() ? inflFactor(prevTradingDayDate, labels[0]) : 1;
    const _ulKeys = { 1: 'tqqq', 2: 'qqq', 3: 'spy', 4: 'qld', 5: 'sso', 6: 'spxl' };
    const _todayRow = daily[daily.length - 1];
    // 9sig: shares from the final snapshot row; park side is either plain
    // cash or park-asset shares re-derived from the row's (already
    // park-repriced) cash mirror at today's park price.
    const sigUlKey = _ulKeys[sigUlCol] || 'tqqq';
    const sigShares = finalLog.price > 0 ? finalLog.tqqqVal / finalLog.price : 0;
    const parkKey = (_sig9Base.parkAsset || 'cash').toLowerCase();
    let y9 = null;
    if (parkKey === 'cash') {
      y9 = repriceAtPrevTradingDay({ [sigUlKey]: sigShares }, finalLog.cash);
    } else if (_todayRow[parkKey] > 0) {
      const h = { [sigUlKey]: sigShares };
      h[parkKey] = (h[parkKey] || 0) + finalLog.cash / _todayRow[parkKey];
      y9 = repriceAtPrevTradingDay(h, 0);
    }
    if (y9 != null) window._ydayValueByIdx[0] = y9 * defl;
    // Consolidated Buy & Hold: pure shares, no cash. (bhKeyName is declared
    // further below — normalize bhKey locally instead of reordering.)
    const _bhK = ['qqq', 'spy', 'qld', 'sso', 'spxl'].includes(bhKey) ? bhKey : 'tqqq';
    const bhLast = bhPicked.series[bhPicked.series.length - 1];
    if (bhLast && bhLast.shares > 0) {
      const yBh = repriceAtPrevTradingDay({ [_bhK]: bhLast.shares }, 0);
      if (yBh != null) window._ydayValueByIdx[2] = yBh * defl;
    }
    // SMA: full multi-asset end state from the drawdown control points
    // (emitDD is always on for the main SMA line).
    const smaCtlLast = smaDdControls && smaDdControls.length ? smaDdControls[smaDdControls.length - 1] : null;
    if (smaCtlLast) {
      const ySma = repriceAtPrevTradingDay(smaCtlLast.h, smaCtlLast.cash);
      if (ySma != null) window._ydayValueByIdx[8] = ySma * defl;
    }
  }

  // Chart. Series come from the display points (quarter snapshots for a yearly
  // run, else rebalance-grain), step-resampled onto the shared x-axis.
  const totalD = onLabels(sigPts, l => l.total);
  const tqqqValD = onLabels(sigPts, l => l.tqqqVal);
  const cashD = onLabels(sigPts, l => l.cash);
  const bhD = onLabels(bhPtsD, b => b.value);
  const qqqD = onLabels(qqqPtsD, q => q.value);
  const spyD = onLabels(spyPtsD, s => s.value);
  const qldD = onLabels(qldPtsD, p => p.value);
  const ssoD = onLabels(ssoPtsD, p => p.value);
  const spxlD = onLabels(spxlPtsD, p => p.value);
  // smaPoints are snapshotted at quarter-ends, but the chart x-axis follows
  // the 9sig rebalancePeriod grain (labels). Step-resample onto labels so the
  // SMA line aligns and its endpoint matches the stats/preview, which read
  // smaPoints[last]. For each label date take the latest smaPoint at-or-before
  // it; if labels start before the first smaPoint, hold the first value.
  let _smaJ = 0;
  const smaAligned = labels.map(d => {
    if (!smaPoints || !smaPoints.length) return null;
    while (_smaJ + 1 < smaPoints.length && smaPoints[_smaJ + 1].date <= d) _smaJ++;
    return smaPoints[_smaJ];
  });
  const smaD  = smaAligned.map(p => p ? p.value : null);
  const smaStates = smaAligned.map(p => p ? p.state : null);
  const invD = onLabels(sigPts, l => l.investedCompounded);
  const targetD = onLabels(sigPts, l => l.target);
  // Data fed into the consolidated B&H slot (dataset 2) — display points for the
  // selected underlying (quarter snapshots for a yearly run, else rebalance grain).
  const bhActiveD = onLabels(
    bhKey === 'qqq' ? qqqPtsD : bhKey === 'spy' ? spyPtsD : bhKey === 'qld' ? qldPtsD : bhKey === 'sso' ? ssoPtsD : bhKey === 'spxl' ? spxlPtsD : bhPtsD,
    p => p.value);

  // Per-dataset stats shown inside the strategy side panel (CAGR / starting
  // balance / ending balance / max drawdown). Main strategies reuse their
  // money-weighted CAGR (vs total contributed); sub-series fall back to the
  // annualized growth rate of their own balance.
  const seriesByIdx = {
    0: totalD, 1: tqqqValD, 2: bhActiveD,
    5: targetD, 6: cashD, 7: invD, 8: smaD,
  };
  const mainCagrIdx = window._cagrByDatasetIdx;
  // #3 Daily-sampled drawdown: revalue each holding at every daily close
  // (between rebalances shares & cash are constant) so an intra-period crash
  // counts. Reconstruct "control points" per dataset from the sims that produced
  // them. Step series (Target/Cash) and the deterministic Invested baseline
  // keep their rebalance-grain drawdown — they don't move between rebalances.
  const dailyRows = (typeof daily !== 'undefined' && daily) ? daily : null;
  const UL_KEY = { 1: 'tqqq', 2: 'qqq', 3: 'spy', 4: 'qld', 5: 'sso', 6: 'spxl' };
  const sigKey = UL_KEY[sigUlCol] || 'tqqq';
  const bhKeyName = bhKey === 'qqq' ? 'qqq' : bhKey === 'spy' ? 'spy' : bhKey === 'qld' ? 'qld' : bhKey === 'sso' ? 'sso' : bhKey === 'spxl' ? 'spxl' : 'tqqq';
  const dailyDDByIdx = {};
  if (dailyRows) {
    const sigCtl = log.map(l => ({ date: l.date, shares: l.price > 0 ? l.tqqqVal / l.price : 0, cash: l.cash }));
    dailyDDByIdx[0] = computeDailyMaxDrawdown(sigCtl, dailyRows, sigKey);
    dailyDDByIdx[1] = computeDailyMaxDrawdown(
      log.map(l => ({ date: l.date, shares: l.price > 0 ? l.tqqqVal / l.price : 0, cash: 0 })), dailyRows, sigKey);
    if (bhPicked.series && bhPicked.series.length && bhPicked.series[0].shares != null) {
      dailyDDByIdx[2] = computeDailyMaxDrawdown(
        bhPicked.series.map(pt => ({ date: pt.date, shares: pt.shares, cash: 0 })), dailyRows, bhKeyName);
    }
    if (smaDdControls && smaDdControls.length) {
      // The SMA strategy can hold the leveraged fund, a different out-asset (e.g.
      // SPXL), and cash at once. Revalue each real per-asset holding at its own
      // daily price — the single-asset path mis-valued the summed share count
      // (which becomes the SPXL count when out) against the TQQQ price.
      dailyDDByIdx[8] = computeDailyMaxDrawdownMulti(smaDdControls, dailyRows);
    }
  }
  window._strategyMetrics = {};
  for (const [idxStr, series] of Object.entries(seriesByIdx)) {
    if (!series || !series.length) continue;
    const i     = +idxStr;
    const start = series[0];
    const end   = series[series.length - 1];
    const cagrVal = mainCagrIdx[i] !== undefined
      ? mainCagrIdx[i]
      : (years > 0 && start > 0 ? (Math.pow(end / start, 1 / years) - 1) * 100 : 0);
    const dd = dailyDDByIdx[i] !== undefined ? dailyDDByIdx[i] : computeMaxDrawdown(series, labels);
    window._strategyMetrics[i] = {
      cagr:  cagrVal,
      start,
      end,
      maxDD:    dd.pct * 100,
      ddPeak:   dd.peakDate,
      ddTrough: dd.troughDate,
    };
  }
  // Shared context for saved-config lines (saved-configs.js). They reuse the
  // global initial/monthly/date-range; only their own strategy knobs are frozen.
  // entryDateOverride/exitDateOverride: previously NOT threaded through to
  // custom/saved strategies at all — computeCustomGlobals only ever saw the
  // coarse quarter-snapped date, a pre-existing gap. A real transaction
  // history relies on the exact-date override to set the entry date, so this
  // needed fixing for custom strategies to see the same entry date the main
  // chart already does.
  const cfgCtx = {
    initial, monthly, annualRaise, simEntryIdx, exitIdx, labels, years, totalContributed,
    ...((entryOverride || exitOverride) ? { entryDateOverride: entryDateForSim, exitDateOverride: exitDateForSim } : {}),
    contribSchedule,
    // The chart's shared x-axis grain (js/chart.js's chartDisplayPeriod) — a
    // saved 9sig config coarser than this needs the same sampleQuarterly/
    // sampleWeekly synthetic snapshots the main line requests above, or its
    // line loses resolution relative to everything else sharing this axis.
    displayGrain,
    // Day-over-day change badge (see isLatestDaySelected/prevTradingDayDate
    // above, near exitDateForSim, and endLabelPlugin which draws it) —
    // entryDateForSim passed unconditionally (not just when an override is
    // active) since computeConfigSeries needs the exact entry date regardless
    // to build its own "yesterday" qData.
    isLatestDaySelected, prevTradingDayDate, entryDateForSim,
  };
  if (chart) {
    // externalTooltip (defined once, at chart creation below) is a stable
    // callback Chart.js keeps calling on every render — it can't close over
    // THIS render's displayGrain, so the current value is stashed on the
    // chart instance instead and read fresh from there on each hover.
    chart._displayGrain = displayGrain;
    // Same "stable callback needs this render's value" reason as
    // _displayGrain above — endLabelPlugin reads these fresh each draw.
    chart._isLatestDaySelected = isLatestDaySelected;
    chart._prevTradingDayDate = prevTradingDayDate;
    // Strip saved-config datasets up front so the envelope length math below
    // (which assumes datasets end at the envelope block) stays correct.
    if (typeof removeConfigDatasets === 'function') removeConfigDatasets(chart);
    chart.data.labels = labels;
    // Strategy labels are static plain names (no parameter encoding).
    const subLbl = nineSigSubLabels();
    chart.data.datasets[0].label = LBL_9SIG;
    chart.data.datasets[1].label = subLbl.holding;
    chart.data.datasets[2].label = LBL_BH; // consolidated B&H chip
    chart.data.datasets[5].label = subLbl.target;
    chart.data.datasets[6].label = subLbl.cash;
    chart.data.datasets[7].label = LBL_INV;
    chart.data.datasets[8].label = LBL_SMA;
    chart.data.datasets[0].data = totalD;
    chart.data.datasets[1].data = tqqqValD;
    chart.data.datasets[2].data = bhActiveD;
    // Datasets 3 (B&H QQQ), 4 (B&H SPY), 9 (B&H QLD), 10 (B&H SSO) are kept
    // zeroed and hidden — dataset 2 above serves as the consolidated B&H slot now.
    chart.data.datasets[3].data = []; chart.data.datasets[3].hidden = true;
    chart.data.datasets[4].data = []; chart.data.datasets[4].hidden = true;
    chart.data.datasets[5].data = targetD;
    chart.data.datasets[6].data = cashD;
    chart.data.datasets[7].data = invD;
    chart.data.datasets[8].data = smaD;
    chart.data.datasets[8]._smaStates = smaStates;
    chart.data.datasets[9].data = []; chart.data.datasets[9].hidden = true;
    chart.data.datasets[10].data = []; chart.data.datasets[10].hidden = true;
    chart.data.datasets[11].data = []; chart.data.datasets[11].hidden = true;
    if (typeof appendConfigDatasets === 'function') appendConfigDatasets(chart, cfgCtx);
    if (typeof applyBaseColorOverrides === 'function') applyBaseColorOverrides(chart);
    if (typeof applyNineSigFamily === 'function') applyNineSigFamily(chart);
    applyInflationToChart(chart); // deflate all lines to real $ when the toggle is on
    chart.options.scales.y.type = logScale ? 'logarithmic' : 'linear';
    chart.options.scales.y.beginAtZero = !logScale;
    // Linear is anchored at 0; the log axis auto-scales (dynamic min). Values below
    // 1 are raised to 1 (clampChartMin) so zeros still plot on log instead of being
    // dropped (log of 0 is undefined) — the dynamic min then includes them.
    chart.options.scales.y.min = logScale ? undefined : 0;
    clampChartMin(chart);
    applyPanelEmphasis(false); // keep the open panel's line emphasized across re-renders
    chart.update('none');
  } else {
  const ctx = document.getElementById('mainChart').getContext('2d');

  // Hue map — Orion light theme (each chosen for contrast on a white plot area):
  //   0  9sig          teal        #45818e
  //   1  9sig Holding  deep blue   #023aff
  //   2  B&H TQQQ      red         #ff2d2e
  //   3  B&H QQQ       green       #00b929
  //   4  B&H SPY       pink        #ff708b
  //   5  9sig Target   orange      #d9631a
  //   6  9sig Cash     dark amber  #b06000
  //   7  Invested Comp faint navy  rgba(56,56,116,0.35)
  //   8  SMA           purple-deep #c64eff
  //  10  B&H QLD       teal        #0891b2
  //  11  B&H SSO       violet      #7c3aed
  //  12  B&H SPXL      rose        #e11d48
  const lineColors = ["#45818e", "#023aff", "#ff2d2e", "#00b929", "#ff708b", "#d9631a", "#b06000", "#bf9000", "#c64eff", "#0891b2", "#7c3aed", "#e11d48"];
  // Day-over-day change badge colors — mirror styles.css's --green-text/
  // --red-text. Hardcoded to match this file's existing convention for canvas
  // colors (lineColors above); there's no CSS-custom-property-reading idiom
  // anywhere else in this file, and no theme toggle to keep in sync with.
  const DELTA_POS_COLOR = '#067d21';
  const DELTA_NEG_COLOR = '#c81e1f';
  // Range-select midpoint label (rangeSelectPlugin below) — the % draws
  // bigger than the "(from → to)" part, since it's the number that actually
  // answers "how much did this move."
  const RANGE_PCT_FONT = '700 10px "JetBrains Mono", monospace';
  const RANGE_REST_FONT = '600 8px "JetBrains Mono", monospace';
  const _sub = nineSigSubLabels();
  const lineNames  = [LBL_9SIG, _sub.holding, LBL_BH, 'B&H QQQ', 'B&H SPY', _sub.target, _sub.cash, LBL_INV, LBL_SMA, 'B&H QLD', 'B&H SSO', 'B&H SPXL'];
  // Match the borderDash on the corresponding chart dataset; null = solid.
  //   2 B&H TQQQ   [6,3]       medium dash
  //   3 B&H QQQ    [8,4]       long dash
  //   4 B&H SPY    [2,5]       sparse dots
  //  10 B&H QLD    [5,2,2,2]   dash-dot
  //  11 B&H SSO    [5,2,2,2]   dash-dot
  //  12 B&H SPXL   [5,2,2,2]   dash-dot
  const lineDashes = [null, [2,2], [6,3], [8,4], [2,5], [4,4], null, [3,3], null, [5,2,2,2], [5,2,2,2], [5,2,2,2]];

  // Touch / coarse-pointer detection — once at chart creation time. On those
  // devices Chart.js's tap-to-show tooltip is followed by an immediate
  // opacity=0 dismissal as soon as the finger lifts, so we make the tooltip
  // sticky and require an explicit close (× button or tap outside) instead.
  const isTouchChart = !!(window.matchMedia && window.matchMedia('(hover: none)').matches);
  let chartTooltipPinned = false;

  // Drag-to-select a range on the chart (mouse/desktop only for v1 — a touch
  // drag would fight the page's own scroll and needs its own deliberate
  // gesture design, a separate follow-up). rangeSelectStart/End are label
  // INDICES (not pixels) once resolved. Releasing the mouse normally clears
  // it (a live preview, not something that persists until dismissed);
  // holding Shift at release pins it instead (see the mouseup handler
  // below). null start = no selection at all.
  let rangeSelectStart = null, rangeSelectEnd = null, rangeSelectDragging = false;
  let rangeSelectRAF = null;
  const hasRangeSelection = () => rangeSelectStart != null && rangeSelectEnd != null;
  const clearRangeSelection = () => {
    if (!hasRangeSelection() && !rangeSelectDragging) return;
    rangeSelectStart = null; rangeSelectEnd = null; rangeSelectDragging = false;
    window._rangeChangeByIdx = null;
    renderChartLegend();
    if (chart) chart.update('none');
  };
  // Exposed so js/controls.js's share-link builder can read a pinned
  // selection (there's nothing to read if the closure vars above stay
  // private to this render() call) and js/init.js can restore one on load —
  // same "stash on chart / expose a function" split this file already uses
  // for chart._displayGrain and similar cross-scope needs.
  window.getPinnedRangeDates = () => {
    if (!hasRangeSelection() || !chart || !chart.data) return null;
    const labels = chart.data.labels;
    const lo = Math.min(rangeSelectStart, rangeSelectEnd), hi = Math.max(rangeSelectStart, rangeSelectEnd);
    return (labels[lo] && labels[hi]) ? [labels[lo], labels[hi]] : null;
  };
  window.pinRangeSelection = (fromDate, toDate) => {
    if (!chart || !chart.data || !chart.data.labels) return false;
    const labels = chart.data.labels;
    const i1 = labels.indexOf(fromDate), i2 = labels.indexOf(toDate);
    // Exact dates may not land on the CURRENT chart's label grid (e.g. the
    // display grain floored coarser than it was for the sharer, or the
    // entry/exit range shifted) — no-op rather than pinning a wrong range.
    if (i1 < 0 || i2 < 0) return false;
    rangeSelectStart = i1; rangeSelectEnd = i2; rangeSelectDragging = false;
    window._rangeChangeByIdx = computeRangeChangeByIdx(chart, Math.min(i1, i2), Math.max(i1, i2));
    renderChartLegend();
    chart.update('none');
    return true;
  };

  const externalTooltip = (context) => {
    const { chart: c, tooltip } = context;
    const el = document.getElementById('custom-tooltip');
    // An action-point marker tooltip takes precedence: while one is up, keep the
    // line hover tooltip hidden so the two never stack on top of each other.
    if (_smaHoverKey !== null) { el.style.display = 'none'; return; }
    // Same idea for an active/in-progress range selection — its shaded
    // overlay + legend-chip readout would visually collide with the normal
    // hover tooltip otherwise.
    if (rangeSelectDragging || hasRangeSelection()) { el.style.display = 'none'; return; }
    if (tooltip.opacity === 0) {
      if (isTouchChart && chartTooltipPinned) return; // stay open until dismissed
      el.style.display = 'none';
      return;
    }
    if (isTouchChart) chartTooltipPinned = true;

    const idx = tooltip.dataPoints?.[0]?.dataIndex;
    if (idx == null) return;

    const ds = c.data.datasets;
    const date = c.data.labels[idx];

    const rgba = (col, a) => {
      if (col.startsWith('rgba')) return col.replace(/,\s*[\d.]+\s*\)$/, `,${a})`);
      const m = col.match(/^#([0-9a-f]{6})$/i);
      if (!m) return col;
      const n = parseInt(m[1], 16);
      return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
    };

    // Iterate every real dataset (skip the envelope `_shift_*` ghosts). Prefer
    // each dataset's live borderColor/borderDash so colour overrides + the
    // shared 9sig-family colour show up here; fall back to the init arrays.
    const colorFor = (i) => (typeof ds[i].borderColor === 'string' ? ds[i].borderColor : null) || lineColors[i] || "#7a7aa6";
    const dashFor  = (i) => ds[i].borderDash || lineDashes[i] || null;
    const items = ds
      .map((d, i) => ({ i, n: d.label, v: d.data ? d.data[idx] : null, col: colorFor(i), dash: dashFor(i) }))
      .filter(({ i, v }) => !ds[i]._isShift && c.isDatasetVisible(i) && v != null && !Number.isNaN(v))
      .sort((a, b) => b.v - a.v);
    const maxV = Math.max(0, ...items.map(it => it.v));

    const rows = items.map(({ n, v, col, dash }) => {
      const pct = maxV > 0 ? Math.max(0, (v / maxV) * 100) : 0;
      const dashAttr = dash ? `stroke-dasharray="${dash.join(',')}"` : '';
      const sample = `<svg width="20" height="4" style="flex-shrink:0;overflow:visible">
        <line x1="0" y1="2" x2="20" y2="2" stroke="${col}" stroke-width="2" stroke-linecap="round" ${dashAttr}/>
      </svg>`;
      return `
        <div class="tt-row" style="position:relative">
          <div style="position:absolute;left:0;top:2px;bottom:2px;width:${pct}%;background:${rgba(col, 0.20)};border-radius:3px;pointer-events:none"></div>
          <div class="tt-row-left" style="position:relative;z-index:1">
            ${sample}
            <span class="tt-name">${n}</span>
          </div>
          <span class="tt-val" style="position:relative;z-index:1">${fmtFull(Math.round(v))}</span>
        </div>
      `;
    }).join('');

    // A quarter label collapses every weekly (or monthly) point in the same
    // quarter down to the same "Q# YYYY" text, hiding exactly the date detail
    // the finer axis exists to show — use the real date whenever the shared
    // axis is finer than quarterly; qLabel stays for the genuinely
    // quarter-grain case, where each point really is a quarter boundary.
    // Reads c._displayGrain (stashed fresh each render), NOT the displayGrain
    // closed over at chart-creation time — externalTooltip itself is only
    // ever defined once, so a closed-over value would stay frozen at
    // whatever it was on the very first render.
    const ttDateLabel = c._displayGrain === 'quarterly' ? qLabel(date) : fmtDayMonthYear(date);
    el.innerHTML = `<button class="tt-close" type="button" aria-label="Close" data-tt-close>&times;</button><div class="tt-date">${ttDateLabel}</div>${rows}`;

    el.style.display = 'block';
    const panelRect = c.canvas.closest('.panel').getBoundingClientRect();
    const canvasRect = c.canvas.getBoundingClientRect();
    // Measured, not assumed: the box has no max-width and a long strategy
    // name (e.g. "Median overextension (250d) — SQQQ park") can render wider
    // than the 240px this math used to assume, so the "does it overflow"
    // check was sometimes wrong on its own terms even before the missing
    // left-edge clamp below.
    const ttWidth = el.offsetWidth || 240;
    const ttHeight = el.offsetHeight || 0;
    let left = tooltip.caretX + canvasRect.left - panelRect.left + 14;
    let top = tooltip.caretY + canvasRect.top - panelRect.top - 40;
    if (left + ttWidth > panelRect.width) left = tooltip.caretX + canvasRect.left - panelRect.left - ttWidth - 14;
    // The flip above assumes there's room to the LEFT of the tap point too —
    // on a narrow mobile panel there often isn't, and this had no floor, so
    // the box could render with a chunk of itself past the left edge of the
    // screen (this is what "tooltip goes outside of screen" was: not
    // clipped/scrollable, just genuinely positioned off-viewport).
    if (left < 10) left = 10;
    if (top < 0) top = 10;
    // Same idea vertically: with many visible lines the row list can get tall
    // enough that the tooltip's bottom edge lands past the viewport — and
    // since it's absolutely positioned (not clipped), that grows the PAGE's
    // scrollable height instead of just being an offscreen tooltip. Clamp
    // against the viewport (converted into panel-relative coords, since
    // `top` is measured from the panel), not just the panel's own bounds.
    const viewportBottomInPanel = window.innerHeight - panelRect.top - 10;
    if (top + ttHeight > viewportBottomInPanel) top = Math.max(10, viewportBottomInPanel - ttHeight);
    el.style.left = left + 'px';
    el.style.top = top + 'px';
  };

  // Wire the tooltip's close button and outside-tap dismissal once. The
  // tooltip element is stable so we can attach listeners here at chart
  // creation time rather than on every render.
  const ttEl = document.getElementById('custom-tooltip');
  const dismissChartTooltip = () => {
    chartTooltipPinned = false;
    if (ttEl) ttEl.style.display = 'none';
  };
  if (ttEl && !ttEl._closeWired) {
    ttEl._closeWired = true;
    ttEl.addEventListener('click', (e) => {
      if (e.target && e.target.closest && e.target.closest('[data-tt-close]')) {
        dismissChartTooltip();
      }
    });
    if (isTouchChart) {
      document.addEventListener('click', (e) => {
        if (!chartTooltipPinned) return;
        if (e.target.closest('#custom-tooltip')) return;
        if (e.target.closest('#mainChart'))      return;
        dismissChartTooltip();
      });
    }
  }

  // Plugin: draw end-of-line labels directly on canvas
  // Day-over-day change for dataset i's end label. Every source caches a raw
  // YESTERDAY value — window._ydayValueByIdx for the native lines (fixed
  // indices, populated fresh every render()), window._configDayChange for
  // saved 9sig/sma/bh configs, window._customYesterdayResults for custom/
  // library-derived ones (filled in asynchronously by a worker round-trip) —
  // and the delta is computed HERE, at draw time, against whatever TODAY
  // value the chart is actually drawing. That keeps both sides of the diff
  // in the same units (the chart's values are deflated in place when the
  // inflation toggle is on; a precomputed nominal-today delta silently mixed
  // nominal and real dollars), and a today-value change between the
  // yesterday-fetch and this draw self-corrects instead of showing a stale
  // pairing.
  const dayChangeFor = (i, ds, todayVal) => {
    if (window._ydayValueByIdx && (i in window._ydayValueByIdx)) {
      return computeDayChange(todayVal, window._ydayValueByIdx[i]);
    }
    const cfgId = ds && ds._configId;
    if (!cfgId) return null;
    if (window._configDayChange && (cfgId in window._configDayChange)) {
      return computeDayChange(todayVal, window._configDayChange[cfgId]);
    }
    const cy = window._customYesterdayResults && window._customYesterdayResults[cfgId];
    if (cy && !cy.error) return computeDayChange(todayVal, cy.value);
    return null;
  };
  const deltaLabelText = (delta) => {
    const sign = delta.pct >= 0 ? '+' : '';
    return `(${sign}${delta.pct.toFixed(1)}% · ${sign}${fmtFull(delta.abs)})`;
  };
  const endLabelPlugin = {
    id: 'endLabels',
    // Size the reserved right margin to whatever the widest current label
    // actually needs, measured with the same fonts afterDraw renders with.
    // A fixed pixel guess (the old approach) works until a longer strategy
    // name shows up — library additions and user-typed custom-strategy names
    // are unbounded, so a hardcoded number is guaranteed to clip again
    // eventually. Runs every layout pass, before the chart area is computed,
    // so the wider margin takes effect in the same pass it's measured in.
    beforeLayout(c) {
      const lastIdx = c.data.labels.length - 1;
      if (lastIdx < 0) return;
      const cx = c.ctx;
      // Compact mode (narrow viewports): name only, no $ value line — a
      // full label (name + value) doesn't fit next to a phone-width plot,
      // but the plot NEEDS some identification directly on the lines. Fully
      // suppressing labels left the chart as unlabeled colored squiggles —
      // the legend chips are a separate scroll away, not a substitute for
      // "which line is which" while actually looking at the lines.
      const compact = window.innerWidth <= 600;
      let maxW = 0;
      c.data.datasets.forEach((ds, i) => {
        if (ds._isShift || !c.isDatasetVisible(i)) return;
        const val = ds.data[lastIdx];
        if (typeof val !== 'number' || !isFinite(val)) return;
        cx.font = compact ? '600 8px "Open Sans", sans-serif' : '600 9px "Open Sans", sans-serif';
        maxW = Math.max(maxW, cx.measureText((ds.label || lineNames[i] || '').toUpperCase()).width);
        if (!compact) {
          cx.font = '500 11px "JetBrains Mono", monospace';
          let rowW = cx.measureText(fmtFull(Math.round(val))).width;
          // Delta badge draws inline right after the value on the same row —
          // its width adds to that row's total instead of getting its own line.
          if (c._isLatestDaySelected) {
            const delta = dayChangeFor(i, ds, val);
            if (delta) {
              cx.font = '600 9px "JetBrains Mono", monospace';
              rowW += 5 + cx.measureText(deltaLabelText(delta)).width;
            }
          }
          maxW = Math.max(maxW, rowW);
        }
      });
      if (maxW === 0) return;
      // 8px gap from the plot edge to the text, 8px breathing room past it;
      // clamped so one absurdly long custom-strategy name can't eat the plot.
      // Compact mode's ceiling is lower than desktop's — it's only ever one
      // short line of text, not name-over-value — but still needs to clear
      // "INVESTED COMPOUNDED" (the longest built-in name) at the smaller 8px
      // font without silently clipping it against the canvas edge the same
      // way an under-sized fixed margin did before this whole plugin existed.
      c.options.layout.padding.right = compact
        ? Math.max(40, Math.min(130, Math.round(maxW) + 12))
        : Math.max(100, Math.min(260, Math.round(maxW) + 16));
    },
    afterDraw(c) {
      const { ctx: cx, chartArea: area } = c;
      if (!area) return;
      // Park the "deinflated $" pill just inside the plot's top-left corner, so
      // it clears the y-axis value labels no matter how wide they get.
      const inflBtn = document.getElementById('chart-inflation-toggle');
      if (inflBtn) {
        const bx = Math.round(area.left + 4), by = Math.round(area.top + 4);
        if (inflBtn._lx !== bx || inflBtn._ly !== by) {
          inflBtn.style.left = bx + 'px'; inflBtn.style.top = by + 'px';
          inflBtn._lx = bx; inflBtn._ly = by;
        }
      }
      // Compact mode below — see the matching comment in beforeLayout.
      const compact = window.innerWidth <= 600;
      const lastIdx = c.data.labels.length - 1;
      if (lastIdx < 0) return;

      const items = c.data.datasets.map((ds, i) => {
        if (ds._isShift) return null;
        if (!c.isDatasetVisible(i)) return null;
        const meta = c.getDatasetMeta(i);
        const pt = meta.data[lastIdx];
        if (!pt) return null;
        const val = ds.data[lastIdx];
        // Position from the SCALE, not from pt.y. pt.y is the ANIMATED pixel,
        // and (as the visibility-toggle comment below notes) point positions and
        // y-axis bounds animate on separate tracks — so during the entry
        // animation a label laid out from pt.y lands against a viewport that has
        // not finished growing. That put low-value lines like Invested
        // Compounded at the TOP of the stack on first paint, with a long leader
        // line back down to the real point, until any interaction forced a
        // settled redraw. getPixelForValue is the settled position at all times.
        const ys = c.scales.y;
        let y = pt.y;
        if (ys && typeof ys.getPixelForValue === 'function' && typeof val === 'number' && isFinite(val)) {
          // Log scales have no pixel for <= 0; keep the animated value there.
          if (!(ys.type === 'logarithmic' && val <= 0)) {
            const py = ys.getPixelForValue(val);
            if (isFinite(py)) y = py;
          }
        }
        // Prefer the live dataset label + borderColor so dynamic names
        // ("15sig", "SMA 150"), colour overrides, and the shared 9sig-family
        // colour all show without a chart rebuild. Fall back to the init arrays.
        const color = (typeof ds.borderColor === 'string' ? ds.borderColor : null) || lineColors[i] || "#7a7aa6";
        return { y, origY: y, i, color, name: ds.label || lineNames[i], val };
      }).filter(Boolean);

      // Sort by y position and de-overlap. Compact mode only ever draws one
      // line of text (name, no value), so it needs much less vertical room
      // between neighbors than the name-over-value desktop layout.
      items.sort((a, b) => a.y - b.y);
      const gap = compact ? 13 : 26;
      // Push down pass
      for (let k = 1; k < items.length; k++) {
        if (items[k].y - items[k - 1].y < gap) {
          items[k].y = items[k - 1].y + gap;
        }
      }
      // Push up pass if overflowing bottom
      for (let k = items.length - 1; k >= 0; k--) {
        const maxY = area.bottom - 5 - (items.length - 1 - k) * gap;
        if (items[k].y > maxY) items[k].y = maxY;
      }
      // Final clamp
      items.forEach(it => {
        if (it.y < area.top + 10) it.y = area.top + 10;
        if (it.y > area.bottom - 5) it.y = area.bottom - 5;
      });

      cx.save();
      const x = area.right + 8;
      const activeI = activePanelDatasetIdx(); // -1 when no detail panel is open
      items.forEach(it => {
        const isActive = it.i === activeI;
        // Connector line from chart edge to label
        cx.beginPath();
        cx.strokeStyle = it.color;
        cx.lineWidth = 1;
        cx.setLineDash([2, 2]);
        // Anchor the connector to the same settled position the label was laid
        // out from — reading the animated point here would draw the leader from
        // somewhere the line isn't yet.
        const origY = it.origY;
        cx.moveTo(area.right, origY);
        cx.lineTo(x - 2, it.y);
        cx.stroke();
        cx.setLineDash([]);

        // Dot at line end — the emphasized strategy gets a bigger one.
        cx.beginPath();
        cx.arc(area.right, origY, isActive ? 5 : 3, 0, Math.PI * 2);
        cx.fillStyle = it.color;
        cx.fill();

        if (compact) {
          // Name only, vertically centered on the line — there's no value
          // line underneath to share the row with.
          cx.font = '600 8px "Open Sans", sans-serif';
          cx.fillStyle = it.color;
          cx.globalAlpha = 0.88;
          cx.textBaseline = 'middle';
          cx.fillText(it.name.toUpperCase(), x, it.y);
          cx.globalAlpha = 1;
          return;
        }

        // Label name
        cx.font = '600 9px "Open Sans", sans-serif';
        cx.fillStyle = it.color;
        cx.globalAlpha = 0.88;   // light theme: 0.7 washed labels out on white
        cx.textBaseline = 'bottom';
        cx.fillText(it.name.toUpperCase(), x, it.y - 1);
        cx.globalAlpha = 1;

        // Value
        cx.font = '500 11px "JetBrains Mono", monospace';
        cx.fillStyle = it.color;
        cx.textBaseline = 'top';
        const valStr = fmtFull(Math.round(it.val));
        cx.fillText(valStr, x, it.y + 1);

        // Day-over-day change badge — inline right after the value, only
        // when the chart is actually showing the latest available day (a
        // historical exit date has no "since yesterday" to speak of).
        if (c._isLatestDaySelected) {
          const delta = dayChangeFor(it.i, c.data.datasets[it.i], it.val);
          if (delta) {
            const valW = cx.measureText(valStr).width;
            cx.font = '600 9px "JetBrains Mono", monospace';
            cx.fillStyle = delta.pct >= 0 ? DELTA_POS_COLOR : DELTA_NEG_COLOR;
            cx.globalAlpha = 0.95;
            cx.fillText(deltaLabelText(delta), x + valW + 5, it.y + 2);
            cx.globalAlpha = 1;
          }
        }
      });
      cx.restore();
    }
  };

  // Draw the SMA action markers on top of the line, and cache their hit-boxes
  // for hover. Positioned by interpolating each event's date between the two
  // category labels that bracket it (x) and its portfolio value (y).
  const smaMarkerPlugin = {
    id: 'smaMarkers',
    afterDatasetsDraw(c) {
      _smaMarkers = [];
      const SMA_IDX = 8;
      // Markers + detailed line appear only while the SMA panel is open — the
      // base SMA panel OR a saved SMA config (both open panel idx 8). Draw them
      // against whichever line is the active one (base 8, or the config's own
      // line, which is what's visible when a saved strategy is open).
      if (typeof _currentPanelIdx === 'undefined' || _currentPanelIdx !== SMA_IDX) return;
      const TARGET = activePanelDatasetIdx();
      if (TARGET < 0 || !c.isDatasetVisible || !c.isDatasetVisible(TARGET)) return;
      const log = _logData && _logData.smaLog;
      const labs = c.data.labels;
      if (!log || !log.length || !labs || !labs.length) return;
      const xs = c.scales.x, ys = c.scales.y, area = c.chartArea;
      const ulName = ((document.getElementById('select-sma-underlying') || {}).value || 'tqqq').toUpperCase();
      // Same interpolation as the standalone chartXForDate(c, date) above —
      // aliased locally since this plugin calls it in a tight loop.
      const xForDate = (date) => chartXForDate(c, date);
      const cx = c.ctx;
      cx.save();

      // When the SMA panel is open, overlay a DETAILED line that threads through
      // the quarterly points AND every logged event (trades, contributions, the
      // end snapshot). The base Chart.js line only has quarter-grain points, so
      // between quarters it draws straight; this shows the real transaction-level
      // kinks. Drawn in the SMA line's own colour/width so it reads as the line.
      if (c.data.datasets[TARGET]) {
        const smaDs = c.data.datasets[TARGET];
        const arr = smaDs.data || [];
        const pts = [];
        for (let i = 0; i < labs.length; i++) if (arr[i] != null) pts.push({ x: xs.getPixelForValue(i), v: arr[i] });
        for (const ev of log) if (ev.total > 0) pts.push({ x: xForDate(ev.date), v: ev.total * inflFactor(ev.date, labs[0]) });
        pts.sort((a, b) => a.x - b.x);
        if (pts.length > 1) {
          cx.beginPath();
          cx.moveTo(pts[0].x, ys.getPixelForValue(pts[0].v));
          for (let k = 1; k < pts.length; k++) cx.lineTo(pts[k].x, ys.getPixelForValue(pts[k].v));
          cx.strokeStyle = (typeof smaDs.borderColor === 'string' ? smaDs.borderColor : "#ff708b");
          // Coarse line is hidden (width 0 while this panel is open), so size the
          // overlay from the stored base width at the same 2× emphasis.
          cx.lineWidth = (smaDs._emphBaseW || 2) * 2;
          cx.lineJoin = 'round';
          cx.stroke();
        }
      }

      const hoveredKey = _smaHoverKey;
      // Markers cluster wherever trades bunch up — a switch's two legs on one day,
      // or several trades within a few days at nearly the same portfolio value —
      // so they'd stack on top of each other. Keep each marker's x (its date)
      // exact, and when one would land too close to an already-placed marker, fan
      // it vertically around the line: search 0, +step, −step, +2·step… for the
      // nearest free slot. Dates stay honest; overlaps spread up/down the line.
      const MIN = 6;     // min center-to-center gap (px). Markers are ~10px across,
                         // so this lets them overlap by ~half — fine, and it keeps
                         // clusters compact instead of fanning far up/down the line.
      const placed = []; // {x, y} already drawn this pass, in ascending x (date order)
      let win = 0;       // sliding-window start: placed[<win] are >MIN px left of px
      // Only markers within MIN px horizontally can clash — and placed is x-sorted
      // (dates are chronological), so we scan just the window [win, end).
      const clashes = (y) => {
        for (let j = win; j < placed.length; j++) {
          if (Math.hypot(placed[j].x - clashX, y - placed[j].y) < MIN) return true;
        }
        return false;
      };
      let clashX = 0;
      let hovered = null; // draw the highlighted marker LAST so it sits on top
      for (let li = 0; li < log.length; li++) {
        const ev = log[li];
        const st = SMA_EVENT_STYLE[ev.action];
        if (!st || !(ev.total > 0)) continue; // skip START / CONTRIB / END / money-in
        const px = xForDate(ev.date);
        if (px < area.left - 2 || px > area.right + 2) continue;
        const basePy = ys.getPixelForValue(ev.total * inflFactor(ev.date, labs[0]));
        if (!(basePy >= area.top - 2 && basePy <= area.bottom + 2)) continue;
        clashX = px;
        while (win < placed.length && placed[win].x < px - MIN) win++;
        let py = basePy;
        for (let k = 1; k <= 24 && clashes(py); k++) {
          const half = Math.ceil(k / 2) * MIN;
          const cand = basePy + (k % 2 ? half : -half); // +MIN, −MIN, +2MIN, −2MIN…
          if (cand < area.top + 5 || cand > area.bottom - 5) continue; // stay on-plot
          if (!clashes(cand)) { py = cand; break; }
        }
        // Key by the smaLog row index — unique even when a switch puts two
        // same-date, same-action (EXIT) legs on the chart, and it matches the
        // table row's data-mkey so row hover can highlight this exact marker.
        const key = String(li);
        if (key === hoveredKey) hovered = { px, py, st }; // defer — draw on top below
        else drawSmaMarker(cx, px, py, st, false);
        _smaMarkers.push({ x: px, y: py, ev, st, ulName, key, i: li });
        placed.push({ x: px, y: py });
      }
      // The highlighted marker draws last (over any overlapping neighbours) and
      // enlarged with a white outline so it clearly stands out of a cluster.
      if (hovered) drawSmaMarker(cx, hovered.px, hovered.py, hovered.st, true);
      cx.restore();
    }
  };

  // The same treatment for a custom strategy while ITS panel is open: a
  // transaction-detail overlay threaded through the logged rows, plus a symbol
  // at every trade row. The two plugins never both draw — the SMA one needs
  // panel idx 8, this one needs an open custom panel (which sets idx to null).
  const customMarkerPlugin = {
    id: 'customMarkers',
    afterDatasetsDraw(c) {
      const cfgId = window._openCustomCfgId;
      if (!cfgId) return;
      const TARGET = activePanelDatasetIdx();
      if (TARGET < 0 || !c.isDatasetVisible || !c.isDatasetVisible(TARGET)) return;
      const log = (window._customLogs || {})[cfgId] || [];
      const labs = c.data.labels;
      if (!log.length || !labs || !labs.length) return;
      const xs = c.scales.x, ys = c.scales.y, area = c.chartArea, cx = c.ctx;
      const ds = c.data.datasets[TARGET];
      cx.save();

      // Detail line — the Chart.js line only carries label-grain points, so it
      // draws straight between them; this threads through every logged row so
      // the real transaction-level kinks show. Its coarse line is hidden
      // (width 0) while the panel is open, so draw at the same 2× emphasis.
      const pts = [];
      const arr = (ds && ds.data) || [];
      for (let i = 0; i < labs.length; i++) if (arr[i] != null) pts.push({ x: xs.getPixelForValue(i), v: arr[i] });
      for (const r of log) if (+r.value > 0 && r.date != null) pts.push({ x: chartXForDate(c, r.date), v: +r.value * inflFactor(r.date, labs[0]) });
      pts.sort((a, b) => a.x - b.x);
      if (pts.length > 1 && ds) {
        cx.beginPath();
        cx.moveTo(pts[0].x, ys.getPixelForValue(pts[0].v));
        for (let k = 1; k < pts.length; k++) cx.lineTo(pts[k].x, ys.getPixelForValue(pts[k].v));
        cx.strokeStyle = (typeof ds.borderColor === 'string' ? ds.borderColor : "#c64eff");
        cx.lineWidth = (ds._emphBaseW || 2) * 2;
        cx.lineJoin = 'round';
        cx.stroke();
      }

      const hoveredKey = _smaHoverKey;
      const placed = [];
      let hovered = null; // the highlighted marker draws last, on top of its cluster
      for (const ev of customMarkerEvents(log)) {
        const px = chartXForDate(c, ev.row.date);
        if (px < area.left - 2 || px > area.right + 2) continue;
        const basePy = ys.getPixelForValue(+ev.row.value * inflFactor(ev.row.date, labs[0]));
        if (!(basePy >= area.top - 2 && basePy <= area.bottom + 2)) continue;
        const py = spreadMarkerY(placed, px, basePy, area);
        const key = String(ev.i);
        if (key === hoveredKey) hovered = { px, py, st: ev.st };
        else drawSmaMarker(cx, px, py, ev.st, false);
        _smaMarkers.push({ x: px, y: py, st: ev.st, key, i: ev.i, row: ev.row, kind: 'custom' });
        placed.push({ x: px, y: py });
      }
      if (hovered) drawSmaMarker(cx, hovered.px, hovered.py, hovered.st, true);
      cx.restore();
    }
  };

  // Shaded overlay for the chart's drag-to-select-a-range feature (see the
  // mousedown/mousemove/mouseup handlers below, chart creation). Reads the
  // SAME rangeSelectStart/End closure variables those handlers set — this
  // plugin only draws, it never computes the selection itself.
  const rangeSelectPlugin = {
    id: 'rangeSelect',
    afterDraw(c) {
      if (!hasRangeSelection() && !rangeSelectDragging) return;
      if (rangeSelectStart == null || rangeSelectEnd == null) return;
      const area = c.chartArea;
      if (!area) return;
      const xs = c.scales.x;
      const lo = Math.min(rangeSelectStart, rangeSelectEnd);
      const hi = Math.max(rangeSelectStart, rangeSelectEnd);
      const x1 = xs.getPixelForValue(lo), x2 = xs.getPixelForValue(hi);
      const cx = c.ctx;
      cx.save();
      cx.fillStyle = 'rgba(134, 118, 255, 0.12)'; // same purple family as the app's accent
      cx.fillRect(Math.min(x1, x2), area.top, Math.abs(x2 - x1) || 1, area.bottom - area.top);
      cx.strokeStyle = 'rgba(134, 118, 255, 0.5)';
      cx.lineWidth = 1;
      cx.beginPath();
      cx.moveTo(x1, area.top); cx.lineTo(x1, area.bottom);
      cx.moveTo(x2, area.top); cx.lineTo(x2, area.bottom);
      cx.stroke();
      cx.restore();

      // Start/end dates at the top of the shaded region, each pinned to its
      // OWN boundary line (not one combined label centered over the whole
      // range) — same pill styling as the per-line labels below, date-only,
      // so each reads as that boundary's own header. On a narrow selection
      // the two pills (each naturally centered on x1/x2) would collide —
      // detected and, if so, spread symmetrically around the range's
      // midpoint with a fixed gap instead of letting them overlap.
      cx.save();
      cx.font = '600 9px "JetBrains Mono", monospace';
      const rH = 15, rY = area.top + 8, rPadX = 5, rGap = 4;
      const startLabel = fmtDayMonthYear(c.data.labels[lo]);
      const endLabel = fmtDayMonthYear(c.data.labels[hi]);
      const stw = cx.measureText(startLabel).width, etw = cx.measureText(endLabel).width;
      const srw = stw + rPadX * 2, erw = etw + rPadX * 2;
      let scx = x1, ecx = x2;
      if (x1 + srw / 2 + rGap > x2 - erw / 2) {
        const midX = (x1 + x2) / 2;
        scx = midX - rGap / 2 - srw / 2;
        ecx = midX + rGap / 2 + erw / 2;
      }
      [[startLabel, stw, srw, scx], [endLabel, etw, erw, ecx]].forEach(([dLabel, dtw, drw, dx]) => {
        const drx = dx - drw / 2, dry = rY - rH / 2;
        cx.fillStyle = 'rgba(255,255,255,0.92)';
        cx.strokeStyle = 'rgba(134, 118, 255, 0.6)';
        cx.lineWidth = 1;
        if (typeof cx.roundRect === 'function') {
          cx.beginPath(); cx.roundRect(drx, dry, drw, rH, 6); cx.fill(); cx.stroke();
        } else {
          cx.fillRect(drx, dry, drw, rH); cx.strokeRect(drx, dry, drw, rH);
        }
        cx.fillStyle = '#5b4fc4';
        cx.textAlign = 'center';
        cx.textBaseline = 'middle';
        cx.fillText(dLabel, dx, rY + 1);
      });

      // How much time the range covers ("1 year 2 months", "1 week", …) —
      // centered under the two date pills, its own row so it never has to
      // compete with them for horizontal room on a narrow selection.
      const durLabel = formatRangeDuration(c.data.labels[lo], c.data.labels[hi]);
      cx.font = '600 9px "JetBrains Mono", monospace';
      const durMidX = (x1 + x2) / 2;
      const durTw = cx.measureText(durLabel).width;
      const durY = rY + rH + 8;
      const durRx = durMidX - durTw / 2 - rPadX, durRy = durY - rH / 2, durRw = durTw + rPadX * 2;
      cx.fillStyle = 'rgba(255,255,255,0.92)';
      cx.strokeStyle = 'rgba(134, 118, 255, 0.6)';
      cx.lineWidth = 1;
      if (typeof cx.roundRect === 'function') {
        cx.beginPath(); cx.roundRect(durRx, durRy, durRw, rH, 6); cx.fill(); cx.stroke();
      } else {
        cx.fillRect(durRx, durRy, durRw, rH); cx.strokeRect(durRx, durRy, durRw, rH);
      }
      cx.fillStyle = '#5b4fc4';
      cx.textAlign = 'center';
      cx.textBaseline = 'middle';
      cx.fillText(durLabel, durMidX, durY + 1);
      cx.restore();

      // Per-line readout: a circle where each visible legend line crosses
      // each boundary (its actual value at the range's start/end), a
      // straight chord connecting that line's own two circles (the net
      // move, not the squiggly path between), and that line's own % change
      // labeled at the chord's midpoint. window._rangeChangeByIdx is kept
      // fresh by the mousedown/mousemove/mouseup handlers below (recomputed
      // on every drag tick before this draw runs) — this plugin only draws
      // it, same "computed elsewhere, read fresh here" split as the shaded
      // region above.
      const rangeMap = window._rangeChangeByIdx;
      if (!rangeMap) return;
      const ys = c.scales.y;
      if (!ys) return;

      // Pass 1: chords + circles at each line's REAL value positions (these
      // must never move — they mark actual data points), while collecting
      // each label's natural midpoint for pass 2's de-overlap. All labels
      // share the same x (the range's midpoint), so overlap is a
      // one-dimensional vertical stacking problem — same push-apart idea
      // endLabelPlugin already uses for its own end-of-line labels.
      cx.save();
      const mx = (x1 + x2) / 2;
      const items = [];
      for (const key of Object.keys(rangeMap)) {
        const i = +key;
        const delta = rangeMap[i];
        if (!delta) continue;
        const ds = c.data.datasets[i];
        if (!ds || !c.isDatasetVisible(i)) continue;
        const v1 = ds.data[lo], v2 = ds.data[hi];
        if (typeof v1 !== 'number' || !isFinite(v1) || typeof v2 !== 'number' || !isFinite(v2)) continue;
        const py1 = ys.getPixelForValue(v1), py2 = ys.getPixelForValue(v2);
        if (!isFinite(py1) || !isFinite(py2)) continue; // log scale has no pixel for <=0
        const color = (typeof ds.borderColor === 'string' ? ds.borderColor : null) || lineColors[i] || '#7a7aa6';

        // Chord: the straight net-change line between this line's own two
        // circles, distinct from (and drawn over) its actual squiggly path.
        cx.strokeStyle = color;
        cx.lineWidth = 1.5;
        cx.setLineDash([4, 3]);
        cx.beginPath();
        cx.moveTo(x1, py1);
        cx.lineTo(x2, py2);
        cx.stroke();
        cx.setLineDash([]);

        // Circles at each boundary crossing.
        [[x1, py1], [x2, py2]].forEach(([px, py]) => {
          cx.beginPath();
          cx.arc(px, py, 4, 0, Math.PI * 2);
          cx.fillStyle = color;
          cx.fill();
          cx.lineWidth = 1.5;
          cx.strokeStyle = '#fff';
          cx.stroke();
        });

        // Label text — leads with the % change at 3 significant figures
        // (roundToSigFigs above — a plain toFixed(1) either shows false
        // decimal precision on a big move like 1578.466% or rounds a small
        // one to nothing; this reads as a clean "1580%"), then the actual
        // from/to values in brackets, e.g. "+1580% ($205K → $3.4M)". The %
        // draws in a bigger font than the from/to part — it's the number
        // that actually answers "how much did this move," the bracket is
        // supporting detail.
        const pctSign = delta.pct >= 0 ? '+' : '-';
        const pctStr = roundToSigFigs(Math.abs(delta.pct), 3);
        const pctText = `${pctSign}${pctStr}%`;
        const restText = ` (${fmtFull(v1)} → ${fmtFull(v2)})`;
        cx.font = RANGE_PCT_FONT;
        const pctW = cx.measureText(pctText).width;
        cx.font = RANGE_REST_FONT;
        const restW = cx.measureText(restText).width;
        items.push({ my: (py1 + py2) / 2, pctText, pctW, restText, restW, tw: pctW + restW, color, pos: delta.pct >= 0 });
      }

      // Pass 2: de-overlap the label Y positions, then draw the pills.
      const LABEL_H = 14, LABEL_GAP = LABEL_H + 2;
      items.sort((a, b) => a.my - b.my);
      for (let k = 1; k < items.length; k++) {
        if (items[k].my - items[k - 1].my < LABEL_GAP) items[k].my = items[k - 1].my + LABEL_GAP;
      }
      for (let k = items.length - 1; k >= 0; k--) {
        const maxY = area.bottom - 5 - (items.length - 1 - k) * LABEL_GAP;
        if (items[k].my > maxY) items[k].my = maxY;
      }
      const padX = 4;
      items.forEach(it => {
        const rx = mx - it.tw / 2 - padX, ry = it.my - LABEL_H / 2, rw = it.tw + padX * 2;
        cx.fillStyle = 'rgba(255,255,255,0.92)';
        cx.strokeStyle = it.color;
        cx.lineWidth = 1;
        if (typeof cx.roundRect === 'function') {
          cx.beginPath(); cx.roundRect(rx, ry, rw, LABEL_H, 6); cx.fill(); cx.stroke();
        } else {
          cx.fillRect(rx, ry, rw, LABEL_H); cx.strokeRect(rx, ry, rw, LABEL_H);
        }
        // Text color is green/red by sign (matches the day-change badge's
        // convention) — the pill's border stays the line's own color so
        // it's still clear which line a label belongs to when several are
        // stacked close together.
        cx.fillStyle = it.pos ? DELTA_POS_COLOR : DELTA_NEG_COLOR;
        cx.textAlign = 'left';
        cx.textBaseline = 'middle';
        const segStartX = mx - it.tw / 2;
        cx.font = RANGE_PCT_FONT;
        cx.fillText(it.pctText, segStartX, it.my + 1);
        cx.font = RANGE_REST_FONT;
        cx.fillText(it.restText, segStartX + it.pctW, it.my + 1);
      });
      cx.restore(); // also resets textAlign/textBaseline for whatever draws next
    }
  };

  chart = new Chart(ctx, {
    type: 'line',
    plugins: [endLabelPlugin, smaMarkerPlugin, customMarkerPlugin, rangeSelectPlugin],
    data: {
      labels,
      datasets: [
        {
          label: LBL_9SIG,
          data: totalD,
          borderColor: "#45818e",
          backgroundColor: 'transparent',
          fill: false,
          tension: 0.3,
          pointRadius: 0,
          pointHitRadius: 10,
          borderWidth: 2.5,
          hidden: true
        },
        {
          label: nineSigSubLabels().holding,
          data: tqqqValD,
          borderColor: "#023aff",
          backgroundColor: 'transparent',
          fill: false,
          tension: 0.3,
          pointRadius: 0,
          pointHitRadius: 10,
          borderWidth: 1.5,
          borderDash: [2, 2],
          hidden: true
        },
        {
          // Consolidated Buy & Hold slot — label + data swap based on
          // #select-bh-underlying. Default = TQQQ.
          label: bhPicked.label,
          data: bhActiveD,
          borderColor: "#ff2d2e",
          backgroundColor: 'transparent',
          fill: false,
          tension: 0.3,
          pointRadius: 0,
          pointHitRadius: 10,
          borderWidth: 2,
          borderDash: [6, 3]
        },
        {
          label: 'B&H QQQ',
          data: [],
          borderColor: "#00b929",
          backgroundColor: 'transparent',
          fill: false,
          tension: 0.3,
          pointRadius: 0,
          pointHitRadius: 10,
          borderWidth: 2,
          borderDash: [8, 4],
          hidden: true
        },
        {
          label: 'B&H SPY',
          data: [],
          borderColor: "#ff708b",
          backgroundColor: 'transparent',
          fill: false,
          tension: 0.3,
          pointRadius: 0,
          pointHitRadius: 10,
          borderWidth: 2,
          borderDash: [2, 5],
          hidden: true
        },
        {
          label: nineSigSubLabels().target,
          data: targetD,
          borderColor: "#d9631a",
          backgroundColor: 'transparent',
          fill: false,
          tension: 0,
          pointRadius: 0,
          pointHitRadius: 10,
          borderWidth: 1.5,
          borderDash: [4, 4],
          hidden: true
        },
        {
          label: nineSigSubLabels().cash,
          data: cashD,
          borderColor: "#b06000",
          backgroundColor: "rgba(176,96,0,0.05)",
          fill: true,
          tension: 0.3,
          pointRadius: 0,
          pointHitRadius: 10,
          borderWidth: 1.5,
          hidden: true
        },
        {
          label: LBL_INV,
          data: invD,
          borderColor: '#bf9000',
          backgroundColor: 'transparent',
          fill: false,
          tension: 0,
          pointRadius: 0,
          pointHitRadius: 10,
          borderWidth: 1.5,
          borderDash: [3, 3]
        },
        {
          label: LBL_SMA,
          data: smaD,
          borderColor: "#c64eff",
          backgroundColor: 'transparent',
          fill: false,
          tension: 0.3,
          pointRadius: 0,
          pointHitRadius: 10,
          borderWidth: 2,
          hidden: true,
          _smaStates: smaStates
        },
        {
          label: 'B&H QLD',
          data: [],
          borderColor: '#06b6d4',
          backgroundColor: 'transparent',
          fill: false,
          tension: 0.3,
          pointRadius: 0,
          pointHitRadius: 10,
          borderWidth: 2,
          borderDash: [5, 2, 2, 2],
          hidden: true,
        },
        {
          label: 'B&H SSO',
          data: [],
          borderColor: '#c084fc',
          backgroundColor: 'transparent',
          fill: false,
          tension: 0.3,
          pointRadius: 0,
          pointHitRadius: 10,
          borderWidth: 2,
          borderDash: [5, 2, 2, 2],
          hidden: true,
        },
        {
          label: 'B&H SPXL',
          data: [],
          borderColor: '#f43f5e',
          backgroundColor: 'transparent',
          fill: false,
          tension: 0.3,
          pointRadius: 0,
          pointHitRadius: 10,
          borderWidth: 2,
          borderDash: [5, 2, 2, 2],
          hidden: true,
        },
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      // Snap rather than animate — the same reasoning as the visibility-toggle
      // update('none') below. Chart.js animates point positions and y-axis
      // bounds on separate tracks, so during any animated frame the lines, the
      // viewport and the end-of-line labels all disagree about where a value
      // sits. Every one of those frames is a chance to paint a line or label
      // somewhere it doesn't belong, and it self-corrects on the next
      // interaction — which is exactly the "crazy on refresh, fine once I touch
      // it" behaviour. With animation off there is no intermediate state to get
      // wrong: data, scale and labels are always mutually consistent.
      animation: false,
      interaction: { mode: 'index', intersect: false },
      // Reserve space on the right edge for the end-of-line strategy labels.
      // This is just the seed value for the very first layout pass — the
      // endLabels plugin's beforeLayout hook measures the actual current
      // labels (name+value on desktop, name-only "compact" mode on phone
      // width) and overwrites this every render, so it stays correct as
      // strategies/names change. See that plugin for the real sizing logic.
      // left/bottom clear the "log" pill, which CSS parks in the plot's
      // bottom-left corner: padding.left pushes chartArea.left right so the
      // first date label moves off it, padding.bottom lifts chartArea.bottom so
      // the "$0" label rises above it.
      layout: { padding: { right: window.innerWidth <= 600 ? 50 : 140, left: 26, bottom: 12 } },
      plugins: {
        legend: { display: false }, // replaced with custom #chart-legend chips
        tooltip: {
          enabled: false,
          external: externalTooltip
        }
      },
      scales: {
        x: {
          ticks: {
            color: '#383874',
            font: { size: 10 },
            // Fewer ticks on narrow viewports: 10 labels across a ~350px-wide
            // mobile plot forces a steep rotation, and the resulting label
            // height ate into the LOG toggle's fixed bottom-left position
            // (they sit only a few px apart — see .chart-log-toggle CSS).
            maxTicksLimit: window.innerWidth <= 600 ? 6 : 10,
            callback: function(val) {
              const d = this.getLabelForValue(val);
              return d ? d.substring(0, 7) : '';
            }
          },
          grid: { color: "rgba(197,193,236,0.3)" }, border: { color: "#c5c1ec" }
        },
        y: {
          type: logScale ? 'logarithmic' : 'linear',
          beginAtZero: !logScale,
          min: logScale ? undefined : 0, // linear anchored at 0; log auto-scales
          ticks: {
            color: '#383874',
            font: { family: 'JetBrains Mono', size: 10 },
            // Four gridlines is enough to read a level off; eleven turned the
            // axis into a ruler competing with the lines it's measuring.
            maxTicksLimit: Y_TICKS,
            callback: v => fmtAxis(v)
          },
          // On log scale, Chart.js generates a tick at every 1..9 × 10^n which
          // is way too dense. Keep only "nice" ticks (1, 2, 5 × 10^n) so the
          // axis stays readable.
          afterBuildTicks: (scale) => {
            if (document.getElementById('chart-log-toggle').getAttribute('aria-pressed') !== 'true') return;
            scale.ticks = scale.ticks.filter(t => {
              const v = t.value;
              if (v <= 0) return false;
              const exp = Math.floor(Math.log10(v));
              const m = v / Math.pow(10, exp);
              return Math.abs(m - 1) < 0.05 || Math.abs(m - 2) < 0.05 || Math.abs(m - 5) < 0.05;
            });
            // maxTicksLimit is applied while ticks are GENERATED, so the filter
            // above can still leave more than Y_TICKS on a log axis. Thin what
            // survives, evenly, always keeping the first and last.
            if (scale.ticks.length > Y_TICKS) {
              const src = scale.ticks, out = [];
              for (let k = 0; k < Y_TICKS; k++) {
                out.push(src[Math.round(k * (src.length - 1) / (Y_TICKS - 1))]);
              }
              scale.ticks = out.filter((t, k, a) => a.indexOf(t) === k);
            }
          },
          grid: { color: "rgba(197,193,236,0.3)" }, border: { color: "#c5c1ec" }
        }
      }
    }
  });
  // See the matching assignment in the `if (chart)` branch above — this is
  // the first-creation half of the same stash.
  chart._displayGrain = displayGrain;
  chart._isLatestDaySelected = isLatestDaySelected;
  chart._prevTradingDayDate = prevTradingDayDate;
  // First successful chart creation — the loading overlay (index.html) has
  // done its job. This branch only runs once per page load (subsequent
  // render() calls take the `if (chart)` update path above), so no separate
  // "have we hidden it yet" flag is needed.
  document.getElementById('chart-loading')?.setAttribute('hidden', '');
  if (typeof appendConfigDatasets === 'function') appendConfigDatasets(chart, cfgCtx);
  if (typeof applyBaseColorOverrides === 'function') applyBaseColorOverrides(chart);
  if (typeof applyNineSigFamily === 'function') applyNineSigFamily(chart);
  applyInflationToChart(chart); // deflate all lines to real $ when the toggle is on
  clampChartMin(chart);
  chart.update('none');
  // SMA action-marker hover (chart is created exactly once, so attach here).
  chart.canvas.addEventListener('mousemove', handleSmaMarkerHover);
  chart.canvas.addEventListener('mouseleave', () => {
    const tt = document.getElementById('marker-tooltip');
    if (tt) tt.style.display = 'none';
    if (_smaHoverKey !== null) { _smaHoverKey = null; if (chart.draw) chart.draw(); }
  });

  // Drag-to-select a range on the chart: click-drag the plot area to shade a
  // range and show each visible legend-chip line's % change over exactly
  // that window (buildLegendChipsHtml's rangeOverride). Mouse/desktop only —
  // see the isTouchChart comment above for why touch isn't wired up here.
  // mousedown is canvas-scoped (only a press that actually starts inside the
  // chart begins a selection); mousemove/mouseup are document-scoped, the
  // same pattern this file already uses for panel-control dragging
  // (_onPanelControlDragStart/End) — a drag should keep tracking even if the
  // pointer leaves the canvas mid-gesture, and definitely finish on mouseup
  // wherever that lands.
  chart.canvas.addEventListener('mousedown', (e) => {
    if (isTouchChart || !chart.chartArea) return;
    const rect = chart.canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const area = chart.chartArea;
    if (mx < area.left || mx > area.right || my < area.top || my > area.bottom) return;
    rangeSelectDragging = true;
    rangeSelectStart = chartIndexForPixel(chart, mx);
    rangeSelectEnd = rangeSelectStart;
  });
  const updateRangeSelectionLive = () => {
    if (rangeSelectRAF) return;
    rangeSelectRAF = requestAnimationFrame(() => {
      rangeSelectRAF = null;
      if (!hasRangeSelection()) return;
      window._rangeChangeByIdx = computeRangeChangeByIdx(chart,
        Math.min(rangeSelectStart, rangeSelectEnd), Math.max(rangeSelectStart, rangeSelectEnd));
      renderChartLegend();
      chart.update('none');
    });
  };
  document.addEventListener('mousemove', (e) => {
    if (!rangeSelectDragging || !chart.chartArea) return;
    const rect = chart.canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const area = chart.chartArea;
    const clampedX = Math.max(area.left, Math.min(area.right, mx));
    // Whether this counts as "a real drag" at mouseup is judged by comparing
    // the RESOLVED indices (below), not by tracking raw pixel movement here —
    // robust regardless of how few/coalesced the intermediate mousemove
    // events turn out to be (a fast real drag, or a testing tool that
    // synthesizes sparse move events, both still land on the right label).
    rangeSelectEnd = chartIndexForPixel(chart, clampedX);
    updateRangeSelectionLive();
  });
  // Releasing the mouse normally clears the selection — the readout is a
  // live-while-dragging preview, not something you have to dismiss. Holding
  // Shift at release keeps it pinned instead (e.g. to read the numbers at
  // leisure or grab a screenshot) — dismissed later via Escape, a click
  // outside the chart, or starting a fresh drag.
  document.addEventListener('mouseup', (e) => {
    if (!rangeSelectDragging) return;
    rangeSelectDragging = false;
    if (rangeSelectStart === rangeSelectEnd) {
      // Resolved to the same label as the start — a plain click or a
      // sub-pixel nudge, not a real drag. Clears instead of leaving a
      // zero-width selection pinned.
      clearRangeSelection();
      return;
    }
    if (e.shiftKey) {
      // Recompute once more so the pinned selection definitely reflects the
      // final mouse position even if the last rAF-throttled update was
      // still pending.
      window._rangeChangeByIdx = computeRangeChangeByIdx(chart,
        Math.min(rangeSelectStart, rangeSelectEnd), Math.max(rangeSelectStart, rangeSelectEnd));
      renderChartLegend();
      chart.update('none');
      return;
    }
    clearRangeSelection();
  });
  // Escape dismisses a pinned selection (shift-drag) or cancels an
  // in-progress one (released some other way, or the user wants out before
  // letting go).
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && (hasRangeSelection() || rangeSelectDragging)) clearRangeSelection();
  });
  // A click entirely outside the chart also dismisses a pinned selection —
  // same outside-tap-dismiss idea as the custom tooltip's own dismissal.
  // The Share buttons are exempt: sharing a pinned range is the main reason
  // to pin one (shareConfig() carries it as rf/rt), so the click that shares
  // it must not simultaneously dismiss it.
  document.addEventListener('click', (e) => {
    if (!hasRangeSelection()) return;
    if (e.target && e.target.closest && (e.target.closest('#mainChart') || e.target.closest('#share-btn') || e.target.closest('#analytics-share'))) return;
    clearRangeSelection();
  });

  // Reverse link: hovering a transaction-log row highlights that trade's action
  // point on the chart. Rows carry data-mkey = their smaLog index, which is the
  // marker's key, so we just set _smaHoverKey and redraw. Delegated on the
  // (static) panel body so it survives the table being re-rendered.
  const panelBody = document.getElementById('strategy-panel-body');
  if (panelBody) {
    const setRowHover = (key) => {
      if (_smaHoverKey === key) return;
      _smaHoverKey = key;
      // Redraw first so the marker plugin rebuilds _smaMarkers with fresh screen
      // positions, then show that marker's tooltip (or hide it on row-leave / a
      // marker that isn't currently on-screen).
      if (chart && chart.draw) chart.draw();
      if (key == null) { hideSmaMarkerTooltip(); return; }
      const m = _smaMarkers.find(mk => mk.key === key);
      if (m) showSmaMarkerTooltip(m);
      else hideSmaMarkerTooltip();
    };
    panelBody.addEventListener('mouseover', (ev) => {
      const row = ev.target.closest('tr[data-mkey]');
      if (row) setRowHover(row.getAttribute('data-mkey'));
    });
    panelBody.addEventListener('mouseout', (ev) => {
      const row = ev.target.closest('tr[data-mkey]');
      // Ignore moves between cells of the same row; only clear on actually leaving.
      if (row && !(ev.relatedTarget && row.contains(ev.relatedTarget))) setRowHover(null);
    });
  }
  } // end else (first render)

  // Stash latest data for the side-panel log tables. Normally this is the
  // canonical base simulation; but when a saved strategy is open for editing the
  // panel describes THAT strategy, so swap in its (separately computed) sim.
  _logData = { log, bhPoints, qqqPoints, spyPoints, qldPoints, ssoPoints, spxlPoints, smaLog };
  if (window._editingConfigId && window._editingConfigSim) {
    const cs = window._editingConfigSim;
    _logData = {
      log:        cs.log        || log,
      bhPoints:   cs.bhPoints   || bhPoints,
      qqqPoints:  cs.qqqPoints  || qqqPoints,
      spyPoints:  cs.spyPoints  || spyPoints,
      qldPoints:  cs.qldPoints  || qldPoints,
      ssoPoints:  cs.ssoPoints  || ssoPoints,
      spxlPoints: cs.spxlPoints || spxlPoints,
      smaLog:     cs.smaLog     || smaLog,
    };
  }
  // The marker plugin reads _logData.smaLog, which is only finalized here —
  // after the chart's update/draw above ran with the PREVIOUS render's data.
  // Repaint once so the markers reflect this render's events (no one-frame lag).
  if (chart && chart.draw) chart.draw();

  // Base line is drawn — put the user's in-progress edits back on the controls
  // before the sidebar/legends rebuild from them (so the panel shows the edits,
  // not the canonical values we briefly swapped in for the base simulation).
  if (typeof restoreBaseAfterEditing === 'function') restoreBaseAfterEditing();
  // disp-rate is computed early (during the brief base-sim freeze it can read the
  // canonical rate); re-sync it to the slider's restored value so the Invested
  // panel's % label always matches its slider — even while editing that config.
  const _drEl = document.getElementById('disp-rate');
  if (_drEl) { const _rr = sliderToRate(+document.getElementById('slider-rate').value); _drEl.textContent = _rr.toFixed(1) + '%'; }

  // Compact legend chips (eye + name + CAGR) above the chart. Also re-renders
  // the open side panel if any (so its log table stays in sync with sliders).
  refreshAllLegends();

  if (typeof refreshAnalytics === 'function') refreshAnalytics();

  fitChartHeight();
}

