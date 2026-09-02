// Saved strategy configurations.
//
// A "saved config" is a frozen snapshot of one base strategy's knobs (9sig /
// SMA / Buy & Hold / Invested Compounded). It renders as its own independent
// chart line + a pill in the Parameters panel, with the SAME signature as the
// top legend pills (eye toggle, color dot, name, CAGR/DD) plus per-pill save +
// delete. Editing reuses the existing shared sidebar: opening a config loads
// its numbers into the live controls; saving writes the current controls back.
//
// Only the strategy-specific knobs are frozen — initial investment, monthly
// contribution and the entry/exit date range stay global and apply to every
// pill (including saved ones).

const LS_SAVED_KEY = '9sig-saved-configs';

// Strategy-knob control IDs per type. These are the values captured into a
// saved config; everything else (initial / monthly / dates) stays global.
const CONFIG_PARAM_IDS = {
  '9sig': ['select-9sig-underlying', 'select-9sig-growth', 'select-9sig-crashdrop',
           'select-9sig-crashwin', 'select-9sig-spike', 'select-9sig-period',
           'select-9sig-cash', 'select-9sig-cashrate', 'select-9sig-buypower',
           'select-9sig-deploy', 'select-9sig-target-compound','select-9sig-park-asset','select-9sig-rebalance-point','select-9sig-spike-target','select-9sig-cost'],
  'sma':  ['select-sma-asset', 'select-sma-window', 'select-sma-underlying',
           'select-sma-cashrate', 'select-sma-entry-buf', 'select-sma-exit-buf',
           'select-sma-rsi-oh', 'select-sma-rsi-cool',
           'select-sma-rsi-oh-window', 'select-sma-rsi-cool-window',
           'select-sma-confirm-buy', 'select-sma-confirm-sell', 'select-sma-settle',
           'select-sma-out-asset', 'select-sma-dca-in', 'select-sma-dca-to-out',
           'select-sma-bg-gtfo', 'select-sma-bg-asset', 'select-sma-bg-window', 'select-sma-cost'],
  'bh':   ['select-bh-underlying'],
  'invested': ['slider-rate'],
};

// Distinct-ish palette for config lines. Picked to avoid clashing too hard
// with the fixed base-strategy hues.
const CONFIG_COLORS = ['#e879f9', '#f59e0b', '#34d399', '#fb7185', '#60a5fa',
                       '#c084fc', '#f97316', '#2dd4bf', '#a78bfa', '#f43f5e',
                       '#84cc16', '#38bdf8'];

let savedConfigs = [];
// Which saved strategy (if any) is currently loaded into the shared sidebar for
// editing. When set, edits auto-save to it and the panel shows no save button
// (saved strategies can't be forked); when null, the sidebar edits the main/base
// strategy. Exposed on window so chart.js can clear it when a base panel opens.
window._editingConfigId = null;

(function loadSavedConfigs() {
  try {
    const raw = localStorage.getItem(LS_SAVED_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      // A custom strategy has no entry in CONFIG_PARAM_IDS — its params are the
      // ones its own code declares, not sidebar control ids — so it has to be
      // allowed through explicitly, or every custom strategy would be written to
      // localStorage and then dropped on the next page load.
      if (Array.isArray(arr)) savedConfigs = arr.filter(c => c && c.type && (c.type === 'custom' || CONFIG_PARAM_IDS[c.type]));
    }
  } catch (e) {}
})();

function persistSavedConfigs() {
  // Configs loaded from a share-link arrive as `_transient`: they render on
  // the chart so the recipient can see them, but they're NOT written to
  // localStorage until the user explicitly clicks "Save" on the banner. So
  // every persist filters transient entries out — only saved-for-real configs
  // end up in localStorage.
  const persistable = savedConfigs.filter(c => !c._transient);
  try { localStorage.setItem(LS_SAVED_KEY, JSON.stringify(persistable)); } catch (e) {}
}
function getSavedConfigs() { return savedConfigs; }

// --- per-line color (base strategies + saved strategies) ----------------
// Saved strategies store their colour on the config (cfg.color). Base
// strategies are canonical, so their colour override is SESSION-ONLY — it's
// kept in memory but never persisted, so a refresh restores the default hue.
const DEFAULT_BASE_COLORS = { '9sig': '#45818e', 'bh': '#ff2d2e', 'invested': '#bf9000', 'sma': '#c64eff' };
const BASE_COLOR_DATASET_IDX = { '9sig': 0, 'bh': 2, 'invested': 7, 'sma': 8 };
window._lineColorOverrides = {};
function getBaseColor(type) {
  const ov = window._lineColorOverrides || {};
  return ov[type] || DEFAULT_BASE_COLORS[type] || '#7a7aa6';
}
function setBaseColor(type, color) {
  window._lineColorOverrides = window._lineColorOverrides || {};
  window._lineColorOverrides[type] = color;
}
// Apply any base-strategy colour overrides to their datasets. Called from
// render() — only touches the main line of each base strategy.
function applyBaseColorOverrides(chart) {
  if (!chart || !chart.data) return;
  const ov = window._lineColorOverrides || {};
  for (const [type, idx] of Object.entries(BASE_COLOR_DATASET_IDX)) {
    if (ov[type] && chart.data.datasets[idx]) chart.data.datasets[idx].borderColor = ov[type];
  }
}
// 9sig's supporting lines (Holding / Target / Cash) share the 9sig line colour
// and are told apart only by stroke width + dash pattern (dotted vs long-dash
// vs dash-dot). Called from render() so it tracks the current 9sig colour.
function applyNineSigFamily(chart) {
  if (!chart || !chart.data) return;
  const color = getBaseColor('9sig'); // datasets 1/5/6 are ALWAYS the main 9sig's
  const ds = chart.data.datasets;
  if (ds[0]) ds[0].borderColor = color;                                                          // 9sig (solid, thick)
  if (ds[1]) { ds[1].borderColor = color; ds[1].borderDash = [2, 2];        ds[1].borderWidth = 1.5; }       // Holding — dotted
  if (ds[5]) { ds[5].borderColor = color; ds[5].borderDash = [9, 4];        ds[5].borderWidth = 1.5; }       // Target — long dash
  if (ds[6]) { ds[6].borderColor = color; ds[6].borderDash = [2, 4, 9, 4];  ds[6].borderWidth = 1.5; ds[6].fill = false; } // Cash — dash-dot
}
// Per-saved-9sig sub-series (Holding/Target/Cash). Like the envelope, each saved
// strategy owns its breakdown lines, drawn from ITS params and tied to it — so
// they persist correctly (no flipping to the canonical base on close). Toggled
// via cfg.subShown[key]; the main 9sig keeps its own datasets 1/5/6.
const CONFIG_SUB_DEFS = [
  { key: 'holding', label: 'Holding', src: 'tqqqVal', dash: [2, 2] },
  { key: 'target',  label: 'Target',  src: 'target',  dash: [9, 4] },
  { key: 'cash',    label: 'Cash',    src: 'cash',    dash: [2, 4, 9, 4] },
];
// Label a sub-series from the config's own chosen assets: "TQQQ holding",
// "TQQQ target", and the park fund (e.g. "QQQ") — or "Cash" when the park is cash.
function configSubLabel(def, cfg) {
  const p = (cfg && cfg.params) || {};
  const ul = String(p['select-9sig-underlying'] || 'tqqq').toUpperCase();
  const park = String(p['select-9sig-park-asset'] || 'cash').toLowerCase();
  if (def.key === 'holding') return ul + ' holding';
  if (def.key === 'target')  return ul + ' target';
  if (def.key === 'cash')    return park === 'cash' ? 'Cash' : park.toUpperCase();
  return def.label;
}
// One eye-toggle chip bound to cfg.subShown[key] (the shared .cfg-sub-chip
// click handler flips it, persists, and re-renders). `defaultOn` is what an
// unset key means: 9sig breakdown lines start hidden (main-chart clutter),
// a custom strategy's signal chart starts fully shown (it's contained).
function _configSubChipHtml(cfg, key, label, dotColor, defaultOn, lineSwatch) {
  const sv = (cfg.subShown || {})[key];
  const on = sv == null ? !!defaultOn : !!sv;
  const eyeOpen = '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>';
  const eyeOff = '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-10-7-10-7a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 10 7 10 7a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/>';
  return `<div class="legend-chip cfg-sub-chip${on ? '' : ' legend-hidden'}" data-config-id="${cfg.id}" data-config-sub="${_escHtml(key)}" role="button" tabindex="0" title="Show / hide">
    <svg class="legend-eye" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${on ? eyeOpen : eyeOff}</svg>
    <span class="${lineSwatch ? 'legend-line-swatch' : 'legend-dot'}" style="background:${dotColor || cfg.color}"></span>
    <span class="legend-name">${_escHtml(label)}</span>
  </div>`;
}
// Sub-series chips for a saved 9sig (toggle cfg.subShown[key], persisted).
function buildConfigSubChipsHtml(cfg) {
  return CONFIG_SUB_DEFS.map(def => _configSubChipHtml(cfg, def.key, configSubLabel(def, cfg), null, false)).join('');
}
// Chips for a CUSTOM strategy's declared signal lines — dots match the mini
// chart's per-series colors, and unset keys count as VISIBLE.
function buildCustomLineChipsHtml(cfg, lines) {
  return lines.map((ln, i) => _configSubChipHtml(cfg, ln.key, ln.label, customLineColor(cfg, i), true, true)).join('');
}
// Whether a custom signal line is currently shown (unset = shown).
function customLineShown(cfg, key) { return ((cfg.subShown || {})[key]) !== false; }

// The signal mini chart: the strategy's declared lines drawn in the sidebar
// panel on their own scale. These are price-scale values ($50–$80) that would
// be squashed unreadably under six-figure portfolio lines on the main chart —
// here they get a log y-axis of their own, so a constant-% trigger renders as
// a constant vertical gap and the crossings the rules fire on are visible.
// Fixed viewBox geometry, shared with the hover handler below so the
// crosshair math matches the drawing exactly. The SVG scales with the panel
// (lines and layout grow proportionally); ONLY text is compensated — font
// sizes are divided by the render scale so labels keep their pixel size at
// any panel width instead of blowing up on a wide one.
const MINI_CHART = { W: 320, H: 148, padL: 6, padT: 8, padB: 16 };
// fmt() rounds sub-$1000 values to whole dollars, which turns the low end of
// a log axis (TQQQ opened at $0.42) into a "$0" label — keep decimals on
// small prices instead.
function _miniFmtPrice(v) { return v >= 1000 ? fmt(v) : '$' + (v < 10 ? v.toFixed(2) : String(Math.round(v))); }
function buildCustomLinesChartHtml(cfg, lines, log, cw) {
  const series = [];
  lines.forEach((ln, i) => {
    if (!customLineShown(cfg, ln.key)) return;
    const pts = [];
    for (const r of log) {
      if (r && r.date != null && typeof r[ln.key] === 'number' && isFinite(r[ln.key]) && r[ln.key] > 0) {
        pts.push({ t: Date.parse(r.date), v: r[ln.key], d: String(r.date) });
      }
    }
    if (pts.length > 1) series.push({ label: ln.label, color: customLineColor(cfg, i), pts });
  });
  window._miniChartHover = null;
  if (!series.length) return '';

  const { W, H, padL, padT, padB } = MINI_CHART;
  const k = Math.max(1, (cw || W) / W);   // render scale; divide TEXT sizes by it
  // Right gutter fits "$value  series name" on one line (both descaled, JetBrains
  // Mono advance ≈ 0.6em), capped so a narrow panel keeps a usable plot area —
  // when capped, long names clip at the right edge instead of covering lines.
  const _valTxt = v => v >= 1000 ? fmt(v) : '$' + v.toFixed(2);
  const valColW = Math.max(...series.map(s => _valTxt(s.pts[s.pts.length - 1].v).length)) * (9 / k) * 0.6;
  const nameColW = Math.max(...series.map(s => s.label.length)) * (7 / k) * 0.6;
  const padR = Math.min(4 / k + valColW + 4 / k + nameColW + 2 / k, 0.45 * W);
  let t0 = Infinity, t1 = -Infinity, lo = Infinity, hi = -Infinity;
  for (const s of series) for (const p of s.pts) {
    if (p.t < t0) t0 = p.t; if (p.t > t1) t1 = p.t;
    if (p.v < lo) lo = p.v; if (p.v > hi) hi = p.v;
  }
  if (!(t1 > t0) || !(hi > 0)) return '';
  const l0 = Math.log10(lo), l1 = Math.log10(hi);
  const lPad = Math.max((l1 - l0) * 0.05, 0.01);
  const yLo = l0 - lPad, yHi = l1 + lPad;
  const xAt = t => padL + (t - t0) / (t1 - t0) * (W - padL - padR);
  const yAt = v => padT + (yHi - Math.log10(v)) / (yHi - yLo) * (H - padT - padB);
  const fmtP = _miniFmtPrice;
  // Everything the hover handler needs to resolve a cursor position back to
  // per-series values. One custom panel is open at a time, so a single slot
  // (always the most recently built chart) is enough.
  window._miniChartHover = { series, t0, t1, yLo, yHi, W, H, padR, k };

  // Horizontal gridlines at three log-spaced levels, labeled with fmt().
  let grid = '';
  for (let g = 0; g < 3; g++) {
    const lv = Math.pow(10, yLo + (yHi - yLo) * (0.15 + 0.35 * g));
    const y = yAt(lv).toFixed(1);
    grid += `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="rgba(122,122,166,0.14)" stroke-width="0.5"/>
      <text x="${padL + 1}" y="${(+y - 2).toFixed(1)}" font-family="JetBrains Mono" font-size="${(8 / k).toFixed(2)}" fill="rgba(122,122,166,0.75)" stroke="rgba(255,255,255,0.95)" stroke-width="${(2 / k).toFixed(2)}" stroke-linejoin="round" paint-order="stroke">${fmtP(lv)}</text>`;
  }
  // Year ticks along the bottom, sampled to at most ~6. Label centers are
  // clamped inside the viewBox so the first/last year never render half-cut
  // at the edges ("010" instead of "2010").
  const y0 = new Date(t0).getUTCFullYear(), y1 = new Date(t1).getUTCFullYear();
  const step = Math.max(1, Math.ceil((y1 - y0) / 6));
  const halfLbl = 10 / k; // ≈ half the (descaled) width of "2010"
  let xAxis = '';
  for (let y = y0 + 1; y <= y1; y += step) {
    const t = Date.parse(y + '-01-01');
    if (t <= t0 || t >= t1) continue;
    const lx = Math.max(halfLbl, Math.min(W - halfLbl, xAt(t)));
    xAxis += `<text x="${lx.toFixed(1)}" y="${H - 4}" text-anchor="middle" font-family="JetBrains Mono" font-size="${(8 / k).toFixed(2)}" fill="rgba(122,122,166,0.75)">${y}</text>`;
  }

  // Polylines + right-edge end labels (pushed apart when endpoints collide).
  let paths = '';
  const ends = [];
  for (const s of series) {
    let d = '';
    for (const p of s.pts) d += (d ? 'L' : 'M') + xAt(p.t).toFixed(1) + ',' + yAt(p.v).toFixed(1);
    paths += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="0.45"/>`;
    const last = s.pts[s.pts.length - 1];
    ends.push({ y: yAt(last.v), v: last.v, color: s.color, name: s.label });
  }
  // One line per series in the gutter: value column, then the name beside it,
  // both on the same baseline so neither ever covers the plot.
  ends.sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 10 / k) ends[i].y = ends[i - 1].y + 10 / k;
  let endLabels = '';
  for (const e of ends) {
    endLabels += `<text x="${(W - padR + 4 / k).toFixed(1)}" y="${(e.y + 3 / k).toFixed(1)}" font-family="JetBrains Mono" font-size="${(9 / k).toFixed(2)}" font-weight="600" fill="${e.color}" stroke="rgba(255,255,255,0.95)" stroke-width="${(2.5 / k).toFixed(2)}" stroke-linejoin="round" paint-order="stroke">${_valTxt(e.v)}</text>
      <text x="${(W - padR + 8 / k + valColW).toFixed(1)}" y="${(e.y + 3 / k).toFixed(1)}" font-family="JetBrains Mono" font-size="${(7 / k).toFixed(2)}" font-weight="600" fill="${e.color}" stroke="rgba(255,255,255,0.95)" stroke-width="${(2 / k).toFixed(2)}" stroke-linejoin="round" paint-order="stroke">${_escHtml(e.name)}</text>`;
  }


  return `<svg class="custom-lines-chart" viewBox="0 0 ${W} ${H}">${grid}${paths}${endLabels}${xAxis}</svg>`;
}

// The panel opens through a width transition (and can be resized), so the
// signal chart's first render can measure a stale width — leaving its
// width-compensated text scaled wrong. This observer re-renders JUST the
// chart svg (nothing else in the panel) once the body's real width settles.
const _miniChartResizeObs = (typeof ResizeObserver !== 'undefined') ? new ResizeObserver(() => {
  clearTimeout(window._miniChartResizeT);
  window._miniChartResizeT = setTimeout(() => {
    const id = window._openCustomCfgId;
    if (!id) return;
    const body = document.getElementById('strategy-panel-body');
    if (!body || !body.clientWidth) return;
    const svg = body.querySelector('.custom-lines-chart');
    if (!svg) return;
    const cfg = savedConfigs.find(c => c.id === id);
    const auxLines = (window._customLines || {})[id] || [];
    if (!cfg || !auxLines.length) return;
    const html = buildCustomLinesChartHtml(cfg, auxLines, (window._customLogs || {})[id] || [], body.clientWidth);
    if (!html) return;
    const tpl = document.createElement('div');
    tpl.innerHTML = html;
    svg.replaceWith(tpl.firstElementChild);
  }, 150);
}) : null;

// --- signal mini chart hover: crosshair + per-line value tooltip ---------
function _miniChartTipEl() {
  let el = document.getElementById('mini-chart-tip');
  if (!el) {
    el = document.createElement('div');
    el.id = 'mini-chart-tip';
    el.setAttribute('hidden', '');
    document.body.appendChild(el);
  }
  return el;
}
function _miniChartClearHover() {
  const g = document.querySelector('.custom-lines-chart .mini-hover');
  if (g) g.remove();
  const tip = document.getElementById('mini-chart-tip');
  if (tip) tip.setAttribute('hidden', '');
  window._miniHoverActive = false;
}
// Nearest point to time t (pts are in date order — binary search).
function _miniNearestPt(pts, t) {
  let lo = 0, hi = pts.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (pts[m].t <= t) lo = m; else hi = m; }
  return (t - pts[lo].t) <= (pts[hi].t - t) ? pts[lo] : pts[hi];
}
// Cursor position → the first series' nearest logged day. Every readout
// (hover and drag-range alike) snaps to this anchor so all rows describe
// the same real trading date.
function _miniAnchorFromEvent(svg, e, data) {
  const M = MINI_CHART;
  const rect = svg.getBoundingClientRect();
  const x = (e.clientX - rect.left) / (rect.width / data.W);
  const frac = Math.max(0, Math.min(1, (x - M.padL) / (data.W - M.padL - data.padR)));
  return _miniNearestPt(data.series[0].pts, data.t0 + frac * (data.t1 - data.t0));
}
function _miniXAt(data, t) {
  const M = MINI_CHART;
  return M.padL + (t - data.t0) / (data.t1 - data.t0) * (data.W - M.padL - data.padR);
}
// Exact-value formatter for readouts: two decimals below $1000.
function _miniFmtExact(v) { return v >= 1000 ? fmt(v) : '$' + v.toFixed(2); }
function _miniHoverGroup(svg) {
  let g = svg.querySelector('.mini-hover');
  if (!g) {
    g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', 'mini-hover');
    svg.appendChild(g);
  }
  return g;
}
function _miniPlaceTip(tip, e) {
  tip.removeAttribute('hidden');
  let left = e.clientX + 14, top = e.clientY + 12;
  if (left + tip.offsetWidth > window.innerWidth - 8) left = e.clientX - tip.offsetWidth - 12;
  if (top + tip.offsetHeight > window.innerHeight - 8) top = e.clientY - tip.offsetHeight - 10;
  tip.style.left = left + 'px';
  tip.style.top = top + 'px';
}
// Drag-to-select a range, like the main chart's: while dragging, the overlay
// shades the span, draws each line's chord between its two endpoints, and the
// tooltip shows every line's % change with the exact from → to values.
// Auto-clears on release.
document.addEventListener('mousedown', (e) => {
  const svg = e.target && e.target.closest && e.target.closest('.custom-lines-chart');
  const data = window._miniChartHover;
  if (!svg || !data || !data.series.length) return;
  window._miniDragAnchor = _miniAnchorFromEvent(svg, e, data);
  e.preventDefault(); // no text selection while dragging
});
document.addEventListener('mouseup', () => {
  if (!window._miniDragAnchor) return;
  window._miniDragAnchor = null;
  _miniChartClearHover();
});
document.addEventListener('mousemove', (e) => {
  const svg = e.target && e.target.closest && e.target.closest('.custom-lines-chart');
  if (!svg) { if (window._miniHoverActive && !window._miniDragAnchor) _miniChartClearHover(); return; }
  const data = window._miniChartHover;
  if (!data || !data.series.length) return;
  const M = MINI_CHART;
  const yAt = v => M.padT + (data.yHi - Math.log10(v)) / (data.yHi - data.yLo) * (data.H - M.padT - M.padB);
  const anchor = _miniAnchorFromEvent(svg, e, data);
  const g = _miniHoverGroup(svg);
  const tip = _miniChartTipEl();

  const drag = window._miniDragAnchor;
  if (drag && drag.t !== anchor.t) {
    // Range mode: shaded span + per-series chords, % change in the tooltip.
    let lo = drag, hi = anchor;
    if (hi.t < lo.t) { lo = anchor; hi = drag; }
    const xA = _miniXAt(data, lo.t), xB = _miniXAt(data, hi.t);
    const spans = data.series.map(s => ({ ...s, p0: _miniNearestPt(s.pts, lo.t), p1: _miniNearestPt(s.pts, hi.t) }));
    g.innerHTML = `<rect x="${xA.toFixed(1)}" y="${M.padT}" width="${(xB - xA).toFixed(1)}" height="${data.H - M.padT - M.padB}" fill="rgba(134,118,255,0.10)"/>`
      + `<line x1="${xA.toFixed(1)}" y1="${M.padT}" x2="${xA.toFixed(1)}" y2="${data.H - M.padB}" stroke="rgba(56,56,116,0.35)" stroke-width="0.3" stroke-dasharray="2,2"/>`
      + `<line x1="${xB.toFixed(1)}" y1="${M.padT}" x2="${xB.toFixed(1)}" y2="${data.H - M.padB}" stroke="rgba(56,56,116,0.35)" stroke-width="0.3" stroke-dasharray="2,2"/>`
      + spans.map(s => {
          const y0 = yAt(s.p0.v).toFixed(1), y1 = yAt(s.p1.v).toFixed(1);
          return `<line x1="${xA.toFixed(1)}" y1="${y0}" x2="${xB.toFixed(1)}" y2="${y1}" stroke="${s.color}" stroke-width="0.5" stroke-dasharray="2,1.5"/>
            <circle cx="${xA.toFixed(1)}" cy="${y0}" r="0.9" fill="${s.color}" stroke="#fff" stroke-width="0.3"/>
            <circle cx="${xB.toFixed(1)}" cy="${y1}" r="0.9" fill="${s.color}" stroke="#fff" stroke-width="0.3"/>`;
        }).join('')
      // % change at each chord's midpoint — just the percent, green/red by
      // sign, pushed apart when chords run close together.
      + (() => {
          const mids = spans.map(s => {
            const pct = s.p0.v > 0 ? (s.p1.v / s.p0.v - 1) * 100 : 0;
            return { y: (yAt(s.p0.v) + yAt(s.p1.v)) / 2 - 2, pct };
          }).sort((a, b) => a.y - b.y);
          for (let i = 1; i < mids.length; i++) if (mids[i].y - mids[i - 1].y < 5) mids[i].y = mids[i - 1].y + 5;
          const xM = (xA + xB) / 2;
          return mids.map(m => {
            const txt = (m.pct >= 0 ? '+' : '') + m.pct.toFixed(1) + '%';
            const col = m.pct >= 0 ? '#00b929' : '#dc2626';
            const tw = txt.length * 1.6;                  // ~mono glyph width at font-size 2.6
            return `<rect x="${(xM - tw / 2 - 1.5).toFixed(1)}" y="${(m.y - 3.1).toFixed(1)}" width="${(tw + 3).toFixed(1)}" height="4.1" rx="2" fill="#fff" stroke="${col}" stroke-width="0.25"/>
              <text x="${xM.toFixed(1)}" y="${m.y.toFixed(1)}" text-anchor="middle" font-family="JetBrains Mono" font-size="2.6" font-weight="700" fill="${col}">${txt}</text>`;
          }).join('');
        })();
    tip.innerHTML = `<div class="mct-date">${fmtLogDate(lo.d)} – ${fmtLogDate(hi.d)}</div>`
      + spans.map(s => {
          const pct = s.p0.v > 0 ? (s.p1.v / s.p0.v - 1) * 100 : 0;
          const cls = pct >= 0 ? 'mct-pos' : 'mct-neg';
          return `<div class="mct-row"><span class="mct-dot" style="background:${s.color}"></span>${_escHtml(s.label)}<b class="${cls}">${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%</b><span class="mct-range">${_miniFmtExact(s.p0.v)} → ${_miniFmtExact(s.p1.v)}</span></div>`;
        }).join('');
    _miniPlaceTip(tip, e);
    window._miniHoverActive = true;
    return;
  }

  // Plain hover: crosshair + values at the snapped day.
  const cx = _miniXAt(data, anchor.t);
  const hits = data.series.map(s => ({ ...s, pt: _miniNearestPt(s.pts, anchor.t) }));
  g.innerHTML = `<line x1="${cx.toFixed(1)}" y1="${M.padT}" x2="${cx.toFixed(1)}" y2="${data.H - M.padB}" stroke="rgba(56,56,116,0.35)" stroke-width="0.3" stroke-dasharray="2,2"/>`
    + hits.map(h => `<circle cx="${cx.toFixed(1)}" cy="${yAt(h.pt.v).toFixed(1)}" r="0.5" fill="${h.color}" stroke="#fff" stroke-width="0.25"/>`).join('');
  tip.innerHTML = `<div class="mct-date">${fmtLogDate(anchor.d)}</div>`
    + hits.map(h => `<div class="mct-row"><span class="mct-dot" style="background:${h.color}"></span>${_escHtml(h.label)}<b>${_miniFmtPrice(h.pt.v)}</b></div>`).join('');
  _miniPlaceTip(tip, e);
  window._miniHoverActive = true;
});
// Series colors for the signal mini chart: the strategy's own color for the
// first declared line (usually the traded fund's price), then fixed hues
// picked to stay distinguishable against it.
const CUSTOM_MINI_COLORS = ['#e11d48', '#0284c7', '#059669', '#a16207', '#7c3aed'];
function customLineColor(cfg, i) {
  return i === 0 ? cfg.color : (CUSTOM_MINI_COLORS[(i - 1) % CUSTOM_MINI_COLORS.length]);
}
// Colour the sidebar picker should show: the saved strategy's colour when one
// is being edited, otherwise the base strategy's (override or default).
function currentLineColor(type) {
  if (window._editingConfigId) {
    const cfg = savedConfigs.find(c => c.id === window._editingConfigId);
    if (cfg) return cfg.color;
  }
  return getBaseColor(type);
}
// Google Workspace standard palette (Docs / Sheets / Slides): 10 columns ×
// 8 rows — grayscale, standard saturated, 3 tint rows, 3 shade rows.
const COLOR_SWATCHES = [
  '#000000', '#434343', '#666666', '#999999', '#b7b7b7', '#cccccc', '#d9d9d9', '#efefef', '#f3f3f3', '#ffffff',
  '#980000', '#ff0000', '#ff9900', '#ffff00', '#00ff00', '#00ffff', '#4a86e8', '#0000ff', '#9900ff', '#ff00ff',
  '#e6b8af', '#f4cccc', '#fce5cd', '#fff2cc', '#d9ead3', '#d0e0e3', '#c9daf8', '#cfe2f3', '#d9d2e9', '#ead1dc',
  '#dd7e6b', '#ea9999', '#f9cb9c', '#ffe599', '#b6d7a8', '#a2c4c9', '#a4c2f4', '#9fc5e8', '#b4a7d6', '#d5a6bd',
  '#cc4125', '#e06666', '#f6b26b', '#ffd966', '#93c47d', '#76a5af', '#6d9eeb', '#6fa8dc', '#8e7cc3', '#c27ba0',
  '#a61c00', '#cc0000', '#e69138', '#f1c232', '#6aa84f', '#45818e', '#3c78d8', '#3d85c6', '#674ea7', '#a64d79',
  '#85200c', '#990000', '#b45f06', '#bf9000', '#38761d', '#134f5c', '#1155cc', '#0b5394', '#351c75', '#741b47',
  '#5b0f00', '#660000', '#783f04', '#7f6000', '#274e13', '#0c343d', '#1c4587', '#073763', '#20124d', '#4c1130',
];
let _colorPickerOriginal = null; // actual dataset border colour when the popup opened (for cancel/revert)

function buildColorPickerHtml(type) {
  const color = currentLineColor(type);
  const hex = String(color || '').replace(/^#/, '').toLowerCase();
  const swatches = COLOR_SWATCHES.map(c =>
    `<button type="button" class="lc-swatch${c.toLowerCase() === '#' + hex ? ' is-sel' : ''}" data-color="${c}" style="background:${c}" aria-label="${c}"></button>`
  ).join('');
  return `
    <div class="config-colorbar">
      <span class="config-colorbar-label">Line color</span>
      <button type="button" id="line-color-trigger" class="line-color-trigger" style="background:${color}" aria-label="Pick line color" title="Pick line color"></button>
      <div id="line-color-pop" class="line-color-pop" hidden>
        <div class="lc-swatches">${swatches}</div>
        <div class="lc-row">
          <span class="lc-hash">#</span>
          <input type="text" id="lc-hex" class="lc-hex" maxlength="6" spellcheck="false" value="${hex}" aria-label="Hex color">
          <button type="button" id="lc-ok" class="lc-ok">OK</button>
        </div>
      </div>
    </div>`;
}

// The colour the picker should display (saved strategy's, or base override/default).
function activeLineColor() {
  if (window._editingConfigId) {
    const cfg = savedConfigs.find(c => c.id === window._editingConfigId);
    if (cfg) return cfg.color;
  }
  const type = (typeof getOpenPanelKey === 'function') ? getOpenPanelKey() : null;
  return type ? getBaseColor(type) : '#7a7aa6';
}
// The actual borderColor currently on the chart for the active line (so cancel
// restores it exactly — e.g. Invested Compounded's faint default).
function currentDatasetBorderColor() {
  if (typeof chart === 'undefined' || !chart) return activeLineColor();
  if (window._editingConfigId) {
    const i = chart.data.datasets.findIndex(d => d._configId === window._editingConfigId && !d._isShift);
    if (i >= 0) return chart.data.datasets[i].borderColor;
  } else {
    const type = (typeof getOpenPanelKey === 'function') ? getOpenPanelKey() : null;
    const idx = type ? BASE_COLOR_DATASET_IDX[type] : -1;
    if (idx >= 0 && chart.data.datasets[idx]) return chart.data.datasets[idx].borderColor;
  }
  return activeLineColor();
}
function normHex(v) {
  const s = String(v || '').trim().replace(/^#/, '');
  return /^[0-9a-fA-F]{6}$/.test(s) ? ('#' + s.toLowerCase()) : null;
}
function setColorUI(hex) {
  const trig = document.getElementById('line-color-trigger');
  if (trig) trig.style.background = hex;
  const inp = document.getElementById('lc-hex');
  if (inp && normHex(inp.value) !== hex) inp.value = hex.replace(/^#/, '');
  document.querySelectorAll('#line-color-pop .lc-swatch').forEach(s =>
    s.classList.toggle('is-sel', (s.dataset.color || '').toLowerCase() === hex.toLowerCase()));
}
function openColorPopup() {
  const pop = document.getElementById('line-color-pop');
  const trig = document.getElementById('line-color-trigger');
  if (!pop || !trig) return;
  _colorPickerOriginal = currentDatasetBorderColor();
  pop.hidden = false;
  // Fixed-position + anchor to the trigger so the panel's overflow:auto can't
  // clip it; nudge back inside the viewport if it would overflow an edge.
  const r = trig.getBoundingClientRect();
  pop.style.top = (r.bottom + 6) + 'px';
  pop.style.left = r.left + 'px';
  const pr = pop.getBoundingClientRect();
  if (pr.right > window.innerWidth - 8) pop.style.left = Math.max(8, window.innerWidth - 8 - pr.width) + 'px';
  if (pr.bottom > window.innerHeight - 8) pop.style.top = Math.max(8, r.top - 6 - pr.height) + 'px';
}
function closeColorPopup(revert) {
  const pop = document.getElementById('line-color-pop');
  if (pop) pop.hidden = true;
  if (revert) {
    if (_colorPickerOriginal != null) applyColorPreview(_colorPickerOriginal);
    setColorUI(activeLineColor());
  }
  _colorPickerOriginal = null;
}
// Live preview while the user moves through the native picker — recolours the
// chart without persisting or rebuilding the panel (so the picker stays open).
function applyColorPreview(color) {
  if (typeof chart === 'undefined' || !chart) return;
  if (window._editingConfigId) {
    chart.data.datasets.forEach(ds => {
      if (ds._configId === window._editingConfigId) {
        ds.borderColor = ds._isShift ? fadeColor(color, 0.13) : color;
      }
    });
  } else {
    const type = (typeof getOpenPanelKey === 'function') ? getOpenPanelKey() : null;
    const idx = type ? BASE_COLOR_DATASET_IDX[type] : -1;
    if (idx >= 0 && chart.data.datasets[idx]) chart.data.datasets[idx].borderColor = color;
    if (type === '9sig') {
      // 9sig's supporting lines share its colour.
      [1, 5, 6].forEach(i => { if (chart.data.datasets[i]) chart.data.datasets[i].borderColor = color; });
    }
  }
  chart.update('none');
}
// Commit (persist) the chosen colour — fired by the OK button.
function commitLineColor(color) {
  if (window._editingConfigId) {
    const cfg = savedConfigs.find(c => c.id === window._editingConfigId);
    if (cfg) { cfg.color = color; persistSavedConfigs(); }
  } else {
    const type = (typeof getOpenPanelKey === 'function') ? getOpenPanelKey() : null;
    if (type) setBaseColor(type, color);
  }
  if (typeof render === 'function') render();
}

// --- params capture / apply --------------------------------------------
function captureParams(type) {
  const out = {};
  for (const id of CONFIG_PARAM_IDS[type] || []) {
    const el = document.getElementById(id);
    if (!el) continue;
    out[id] = (el.type === 'checkbox') ? (el.checked ? '1' : '0') : el.value;
  }
  return out;
}
function applyParams(type, params) {
  for (const id of CONFIG_PARAM_IDS[type] || []) {
    const el = document.getElementById(id);
    if (!el || !(id in params)) continue;
    if (el.type === 'checkbox') { el.checked = (params[id] === '1' || params[id] === true); continue; }
    el.value = params[id];
    // Keep the `selected` attribute in sync (mirrors preview-dropdown's
    // setSelectValue): re-inserting a <select> during a panel rebuild otherwise
    // snaps it back to whichever option still carries selected="".
    if (el.tagName === 'SELECT') {
      const v = String(params[id]);
      for (const o of el.options) { if (o.value === v) o.setAttribute('selected', ''); else o.removeAttribute('selected'); }
    }
  }
}
function pget(p, id, dflt) { return (p && id in p) ? p[id] : dflt; }
function ulColFromVal(v) { return v === 'qqq' ? 2 : v === 'spy' ? 3 : v === 'qld' ? 4 : v === 'sso' ? 5 : v === 'spxl' ? 6 : v === 'sqqq' ? 7 : 1; }

// Canonical (HTML-default) value of every strategy knob, snapshotted ONCE at
// load. This must NOT be re-read live: picking a value from a bar-preview
// dropdown calls setSelectValue, which sets selected="" on the chosen option —
// so afterwards `defaultSelected` would report the user's pick as the default,
// and resetting the main strategy would "reset" to the edit instead of the real
// default. Strategy knobs aren't persisted, so at load they're at their defaults.
const CANONICAL_DEFAULTS = (function captureCanonicalDefaults() {
  const out = {};
  for (const type in CONFIG_PARAM_IDS) {
    for (const id of CONFIG_PARAM_IDS[type]) {
      const el = document.getElementById(id);
      if (!el) continue;
      if (el.type === 'checkbox') { out[id] = el.defaultChecked ? '1' : '0'; }
      else if (el.tagName === 'SELECT') {
        let def = null;
        for (const o of el.options) if (o.defaultSelected) { def = o.value; break; }
        out[id] = (def != null) ? def : (el.options.length ? el.options[0].value : el.value);
      } else { out[id] = el.defaultValue; }
    }
  }
  return out;
})();
// The canonical (HTML-default) value of each control — used to reset a base
// strategy to its defaults. Served from the load-time snapshot above.
function captureDefaultParams(type) {
  const out = {};
  for (const id of CONFIG_PARAM_IDS[type] || []) {
    if (id in CANONICAL_DEFAULTS) out[id] = CANONICAL_DEFAULTS[id];
  }
  return out;
}
function paramsEqual(a, b, type) {
  for (const id of CONFIG_PARAM_IDS[type] || []) {
    if (String(a[id]) !== String(b[id])) return false;
  }
  return true;
}

// Step-resample [{date,value}] onto the chart's label dates (same approach as
// the SMA alignment in chart.js): for each label take the latest point
// at-or-before it, so a config whose rebalance grain differs from the chart
// x-axis still aligns and its endpoint matches the pill's stat.
function resampleByDate(points, labels) {
  if (!points || !points.length) return labels.map(() => null);
  let j = 0;
  return labels.map(d => {
    while (j + 1 < points.length && points[j + 1].date <= d) j++;
    return points[j].value;
  });
}

// Same step-resample, but for STALE data shown while a fresh worker run is
// pending (see computeCustomSeries). A slider/param change can move the label
// range past what the stale points actually cover — plain resampleByDate would
// forward-fill the last known value across that whole gap, drawing a flat line
// pinned at the old endpoint instead of showing "this hasn't been computed for
// the new range yet." Null outside the stale points' own date coverage instead,
// so the chart just shows a gap until the real result arrives.
function resampleByDateClamped(points, labels) {
  if (!points || !points.length) return labels.map(() => null);
  const minD = points[0].date, maxD = points[points.length - 1].date;
  let j = 0;
  return labels.map(d => {
    if (d < minD || d > maxD) return null;
    while (j + 1 < points.length && points[j + 1].date <= d) j++;
    return points[j].value;
  });
}

// ===== Custom (user / LLM-written) strategies ==========================
// A custom strategy is a saved config of type 'custom' carrying pasted JS in
// cfg.code. The code must evaluate to { name, params, run(data, p) } (or a bare
// run function). New strategies start empty — the build modal walks the user
// through describe → prompt → paste.

// Prompt the user copies into ChatGPT / Claude (their description is injected at
// the end). Deliberately exhaustive so the model has everything the app passes,
// needs and expects — leaving no room for guesswork.
const CUSTOM_PROMPT = `You are writing ONE backtest strategy for a charting app. Output a single JavaScript object and nothing else.

=== OUTPUT FORMAT (strict) ===
- Reply with the object literal inside ONE fenced code block (\`\`\`js ... \`\`\`) and NOTHING
  else — no prose or explanation before or after the block. The code block matters: chat
  interfaces mangle bare code (curly "smart" quotes, reflowed lines), and a fenced block is
  what keeps every character intact for copy-paste.
- Inside the block: the FIRST character must be {  and the LAST character must be }
- Do NOT wrap it in parentheses, assign it to a variable, or use module.exports / export default.
- Pure, synchronous, deterministic JavaScript. NOT allowed: import/require, async/await,
  fetch/XMLHttpRequest, setTimeout/setInterval, DOM access, Math.random, or any global other than
  the two arguments (data, p). Never throw — guard against missing or zero prices.
- Keep it FAST. It re-runs on every UI change, and once per dropdown option every time the user opens
  one of your dropdowns (30+ extra full runs). Carry rolling sums / incremental state forward day to
  day; never re-scan history inside the daily loop.

=== THE OBJECT SHAPE ===
{
  name: "Short human name",
  params:  [ ... ],   // the sidebar dropdowns — see PARAMS
  columns: [ ... ],   // labels + tooltips for your log's columns — see COLUMNS
  lines:   [ ... ],   // toggleable chart lines for your computed levels — see LINES
  run(data, p) {
    // build the portfolio value over time — see RETURN — and report where the
    // rules stand on the final day — see SIGNALS
    return { log: log, signals: { cards: [ ... ], decision: { ... } } };
  }
}

=== PARAMS: one dropdown per knob the DESCRIPTION actually specifies ===
Each param becomes a dropdown in the sidebar; the chosen value arrives in run() as p.<id>.
Shape:  { id, label, options: [...], default: <one of the options> }
- "id" must be a valid JS identifier. Options may be numbers, strings, or { value, label } objects
  ({ value: "tqqq", label: "TQQQ" } shows a label but passes "tqqq"). Keep labels PLAIN — the bare
  ticker. Do not decorate them ("TQQQ · 3x Nasdaq" is noise; write "TQQQ").
- For an on/off toggle use options: [true, false].
- A long list scans badly — group it: insert { section: "Label" } entries (no id) between params
  and they render as sub-headers ("Holdings", "Signal lines", "Execution & costs").

*** THE TEST EVERY PARAM MUST PASS ***
Point at the words in my description that this knob comes from. If you cannot, DO NOT ADD IT.
A short description gets a short settings list. Five well-chosen knobs beat eleven.
Never invent a mechanism just to have something to tune — every added knob is a rule I did not ask
for, silently changing what my strategy does.

*** ONE EXCEPTION — median and moving average are interchangeable ***
Whenever a rule uses a rolling MEDIAN or a MOVING AVERAGE, add one extra param that lets the user
swap the statistic, defaulting to whichever one the description names:
  { id: "stat", label: "Center line", options: [
    { value: "sma", label: "Moving average" }, { value: "median", label: "Median" } ], default: "sma" }
Compute the level with the chosen statistic over the SAME window (the example below shows a rolling
window kept as a running sum AND a sorted array, so both are cheap). This knob is wanted even though
the description names only one of the two.

Concretely, DO NOT add unless I mentioned it:
- a re-entry / buy-back threshold  → if I gave one exit rule, re-entry is simply that rule going
  false. Do not invent a separate level for it.
- a cross buffer / dead-zone / confirmation days  → only if I said "buffer", "confirm", "wait N days".
- a "signal read from" ticker  → read the signal off the traded fund. Only make this a param if I
  explicitly said to measure one thing and trade another (e.g. "SPY's 200-day, trade TQQQ").
- extra overlays, stops, filters, ease-in slices, min-hold periods  → only if named.

WHAT DOES BECOME A PARAM:
1. The traded fund. If I named one, it is the DEFAULT and the options are just the sensible
   alternatives (tqqq, qld, spxl, sso, qqq, spy — plus sqqq when hedging/inverse exposure fits
   the described strategy). In run() index by the chosen id:
     const px = data[p.asset];   (NOT data.tqqq)
2. What is held when OUT — only if the strategy has an out-state. Options must include "cash":
     options: ["cash", "qqq", "spy", "sso", "qld"], default: "cash".
   "cash" means hold dollars, buy nothing. Guard for it (data["cash"] does not exist).
3. Every threshold, window, percentage and lookback I DID state — "55% above", "250-day median",
   "300 SMA" each become a dropdown, never baked into the code as a literal.
4. "Cash interest (%/yr)" ([0,0.5,1,...,6,7,8]) — only when cash can actually be held, so parked
   money is not silently dead.
5. ALWAYS include a trading-cost dropdown, exactly this one (it matches the app's other strategies):
     { id: "tradeCost", label: "Trading cost (%)", default: 0.02,
       options: [0,0.01,0.02,0.03,0.05,0.1,0.15,0.2,0.25,0.3,0.5,0.75,1] }
   Charge it as a percentage of the dollar amount TRADED, on every leg of every trade — each sell,
   each buy, both halves of a switch, and every ease-in slice — deduct it from the proceeds (or from
   the cash being deployed), and log it as "fee" on that row. A strategy that trades often has to pay
   for it, so never leave this out and never default it to 0.

FEW KNOBS, BUT EACH ONE FINELY GRADED. Opening a dropdown re-runs the whole strategy once per option
and draws each option's final value as a bar, so the user can scan the range at a glance. That only
works if the spread is fine: aim for 15–40 options per numeric knob
([20,30,40,...,300,320,350,400] beats [100,200,300] every time); never ship a 2–3 option numeric
knob. Centre the range on the value I gave and sweep well past it in both directions, spaced tighter
near the middle and looser at the extremes, so the bars show me whether my number was actually the
right one.

=== INPUTS: data (every array has the SAME length and is aligned by index i) ===
data.dates : array of ISO "YYYY-MM-DD" strings, ascending. TRADING days only, so they are NOT
             consecutive calendar days (weekends and holidays are skipped).
data.tqqq  : daily closing price of TQQQ  (3x Nasdaq-100), synthesized back to 1953
data.qqq   : daily closing price of QQQ   (Nasdaq-100)
data.spy   : daily closing price of SPY   (S&P 500)
data.qld   : daily closing price of QLD   (2x Nasdaq-100, ProShares Ultra QQQ)
data.sso   : daily closing price of SSO   (2x S&P 500, ProShares Ultra S&P500)
data.spxl  : daily closing price of SPXL  (3x S&P 500, Direxion Daily S&P500 Bull 3x)
data.sqqq  : daily closing price of SQQQ  (-3x Nasdaq-100 INVERSE — rises when QQQ falls), synthesized back to 1953
data.nfci  : Chicago Fed National Financial Conditions Index, weekly since 1971, forward-filled onto
             trading days with a 7-day publication lag (no look-ahead). NOT a price: a z-score-like
             level where above 0 = tighter-than-average financial conditions, above +0.5 = credit
             stress. NaN before 1971 — ALWAYS guard with isFinite() before comparing.
- data[id] works for any of those ids, which is how an asset dropdown gets used.
- Prices are positive numbers; a few of the earliest values may be 0 (missing history) — guard divisions.
- The arrays span the FULL history. You MAY read indices before p.startIdx for warm-up (e.g. to seed a
  moving average), but only push LOG rows for indices within [p.startIdx, p.endIdx].

=== INPUTS: p ===
p.initial       : starting cash, available at p.startIdx (number)
p.contributions : { "YYYY-MM-DD": amount } — every day new cash lands. Always an object
                  (empty {} when the user contributes nothing at all — never null). Usually
                  one entry per calendar month (the classic monthly-DCA case), but when the
                  user has uploaded their OWN real transaction history it's whatever real
                  dates and amounts they actually deposited — could be irregular, could skip
                  months, could land mid-month. THIS is the source of truth for
                  contributions, not a formula you compute yourself. On each day you simulate:
                    var amt = p.contributions[data.dates[i]] || 0;
                    if (amt > 0) { cash += amt; contributed = amt; action = "contribution"; }
p.monthly, p.annualRaise : the sidebar's "monthly contribution" + "% raise per year"
                  SLIDER SETTINGS (numbers). When the user has uploaded a real transaction
                  history these do NOT describe it — they keep their slider values while
                  p.contributions carries the real deposits. Never use them to compute
                  contribution amounts; p.contributions already has the exact number for
                  every date and is the only source that's always correct.
p.startIdx      : first index to simulate (inclusive)
p.endIdx        : last index to simulate (inclusive)
p.entryDate     : equals data.dates[p.startIdx];   p.exitDate equals data.dates[p.endIdx]
p.weeklyDisplay : true when the chart's shared axis is at weekly resolution (a run under ~10 years),
                  false/undefined otherwise (a longer run, still monthly). Controls ONLY how often you
                  push a "hold" snapshot row — see "When to push a row" below. Don't change any trading
                  decision based on it; it's a display-density flag, not a strategy input.
p.<yourId>      : the user's chosen value for each param you declared (already typed for you:
                  number for numeric options, boolean for [true, false], string otherwise)

=== RETURN: return { log } — and make every row say as much as possible ===
"log" is an array in ASCENDING date order. "date" and "value" are the only REQUIRED keys, but a bare
log makes a useless table: fill in everything that applies, because each key becomes a column.
  date        : a string taken from data.dates (so it lines up with the chart's time axis)
  value       : TOTAL portfolio value that day = cash + market value of every holding (positive)
  action      : what happened — use the exact vocabulary below, the app keys off it
  note        : free-text detail for the row, e.g. "price 62% over median" or "3 of 5 slices"
  held        : what you own right after this row, uppercase — "TQQQ", "SPY", "CASH", or "TQQQ+CASH".
                Fill it on EVERY row: the app also colors each trade marker's outline by this
                asset (buys by what was bought, sells by what was previously held), so a
                missing/wrong held makes the chart's markers unreadable.
  price       : close price of the asset in "held" that day (0 / omit on cash rows)
  shares      : share count of that asset after the trade
  holdingsValue : dollar value of everything you hold that isn't cash
  cash        : dollars sitting in cash after this row
  invested    : cumulative money put in so far (initial + every contribution to date)
  contributed : new cash added on THIS row (0 when none)
  fee         : trading cost paid on this row, if you model one (0 when none)
- Also log the numbers the DECISION was made from, one key per asset/indicator you consulted, so the
  user can see why the rule fired — e.g. signalPrice, signalMedian, assetPrice, parkPrice, abovePct.
  Use stable key names (assetPrice, parkPrice) rather than ticker-specific ones, since the ticker is
  a dropdown.
- Number formatting follows the key name: a key containing "price" prints as a price, "share" as a
  share count, "pct" as a percentage, anything else as dollars. Name keys accordingly.

action vocabulary (lowercase, exactly these words; the app draws chart markers and filters from them):
  "start"        — the opening snapshot on your first simulated day
  "buy"          — moved cash into a fund
  "sell"         — moved a fund into cash
  "switch"       — swapped one fund straight for another
  "rebalance"    — adjusted an existing mix without fully switching
  "ease-in"      — one slice of a deliberately phased buy (many small rows)
  "contribution" — a monthly contribution landed, no trade decision
  "hold"         — periodic snapshot, nothing traded
  "end"          — final snapshot on p.endIdx
You may append detail after the word ("buy — 3 of 5 slices"); the app matches on the leading word.

When to push a row:
- ALWAYS on p.startIdx ("start") and on p.endIdx ("end").
- ALWAYS for every trade, every rebalance, and every ease-in slice.
- ALWAYS for each monthly contribution (action "contribution", contributed = the amount added).
- Plus at least one "hold" snapshot per month when p.weeklyDisplay is false/undefined — or per WEEK
  when p.weeklyDisplay is true. Skipping this on a weekly run is the single most common way a strategy
  ends up looking "blocky" next to the built-in engines: the chart step-resamples your sparse log onto
  its own weekly axis, so any week you didn't log renders as a flat line even though the real price kept
  moving. A cheap correct check inside your day loop (mirrors what the run() function already tracks):
    var monthEnd = i === p.endIdx || data.dates[i + 1].slice(0, 7) !== data.dates[i].slice(0, 7);
    var weekEnd = p.weeklyDisplay && (i === p.endIdx ||
      Math.floor((Date.parse(data.dates[i]) / 86400000 + 3) / 7) !== Math.floor((Date.parse(data.dates[i + 1]) / 86400000 + 3) / 7));
    if (contributed || action !== "hold" || monthEnd || weekEnd) { /* push the row */ }

=== COLUMNS: tooltips for your table ===
Optional but strongly wanted: a top-level "columns" array describing your log's keys. Each entry is
  { key: "<the log key>", label: "Short header", tip: "Plain-English explanation" }
The tip appears behind an ⓘ next to the column header, so write it for someone who has never read the
code: what the number means, when it's blank, and how it relates to the other columns. The app already
has tips for the standard keys (date, value, action, held, price, shares, cash, invested, contributed,
fee) — describe those only if your strategy uses them unusually, and always describe your own keys.

=== LINES: the signal mini chart for your computed levels ===
When a rule compares the price to a level you compute (a moving average, a median, an overextension
band, a stop), declare that level as a line so the user can SEE the trigger:
  lines: [ { key: "median", label: "Median (250d)" }, { key: "upper", label: "Median +55%" } ]
- "key" names a numeric field you add to every log row once the value exists (median: 405.2 — the raw
  number, same units you compare against). Rows before the warm-up simply omit the key; the line
  starts where the data does.
- Declared lines draw together in a small "Signal chart" inside the strategy's side panel, on their
  own scale — never on the main portfolio chart — each with an eye-toggle (all shown by default).
  Max 6; declare only levels a rule actually uses, in raw units, no rescaling.
- Also declare the price being compared (the traded fund's own close) as the FIRST line, so the user
  can watch it cross your levels: { key: "assetPrice", label: "TQQQ price" }.

=== SIGNALS: the live dashboard (do this — it is what users check first) ===
Return a "signals" object alongside your log describing WHERE EVERY RULE STANDS ON THE FINAL DAY of
the run, so the user can see what the strategy would do with fresh money today without reading the log.
  return { log: log, signals: { cards: [...], decision: {...} } }
Compute it from the values you already have on the last bar (p.endIdx) — no second pass.

cards: 4–6 gauges, each { label, value, sub, tip, tone, icon }
  label — short, e.g. "QQQ vs 200-day avg"
  value — the headline number as a STRING you format: "▲ +6.42%", "77", "44.4"
  sub   — the supporting line under it: "$740.86 vs $696.17 avg", "since QQQ last crossed"
  tip   — plain-English explanation for the ⓘ: what it measures and which way it pushes the decision
  tone  — "good" (green) / "bad" (red) / omit for neutral. Colour the STATE, not the sign: a gauge
          sitting safely below its sell trigger is "good" even when the number is negative.
  icon  — one of: trendUp trendDown clock sliders activity shield dollar flag
  Give one card per rule your strategy actually uses (trend, each oscillator, each override, any
  band/buffer), so every knob in your params has a visible live reading.

decision: what a lump sum would do TODAY — { action, note, tone, reasons: [...] }
  action  — the verdict in 2–4 words: "Buy TQQQ", "Stay in cash", "Move to cash"
  note    — why, in a short clause: "eased in over 15 trading days", "buy signal is off"
  tone    — "good" if the action is to be invested, "bad" if it is to sit out/de-risk
  reasons — one row per rule, each { name, val, tag, lean }:
      name "Trend" · val "QQQ +6.42% vs 200d" · tag "in · TQQQ" · lean "buy"
      lean is one of "buy" "out" "cash" "hold" and colours the row's dot.
  The decision must AGREE with the rules you coded — derive it from the same variables, don't restate
  the description.

=== HOW THE CHART USES THE LOG ===
- Every "buy" / "sell" / "switch" / "rebalance" row is drawn as a symbol on your strategy's line at
  that date, and hovering it shows that row's detail. Rows tagged "contribution", "ease-in", "hold",
  "start" and "end" get no symbol, so the chart stays readable.
- The log table lists every row with checkboxes to hide the "contribution" and "ease-in" rows.
- Hovering a table row lights up its symbol on the chart and pops the same detail — which only works
  if the row carries the fields above (held, price, value, invested…), so fill them in.

=== HOW THE SIMULATION WORKS ===
- You manage cash and holdings yourself in local variables — nothing is auto-invested.
- Trade at that day's close, data[<id>][i]. tqqq, qld, sso, spxl and sqqq are ALREADY leveraged products;
  do not invent additional borrowing or leverage. sqqq is INVERSE (-3x): it gains when the Nasdaq falls and
  bleeds badly in any rising or sideways market, so it only makes sense as a short-lived hedge leg.
- Add p.monthly of new cash at each new month (grown by p.annualRaise per calendar year).
- Decide each day using only data up to that day (no look-ahead / no future prices).

=== IF MY STRATEGY NAMES A KNOWN STRATEGY ===
- If my description references a named or published strategy (e.g. "9sig" / "9 Sig", "dual momentum",
  "HFEA", "risk parity", "200-day SMA timing", "Dalio All-Weather"), look it up — search the web if you
  have browsing — and implement its ACTUAL, correct rules and parameters. Do not guess from the name.

=== A COMPLETE, WORKING EXAMPLE (for reference — do NOT just copy it) ===
{
  name: "Trend filter (fund vs park)",
  // It implements this description: "hold TQQQ while QQQ is above its 200-day average with a 1%
  // cross buffer, park in cash otherwise". Note every param traces to those words — the signal
  // ticker is a param ONLY because the description measures QQQ but trades TQQQ, and the buffer
  // is a param ONLY because the description asks for one. Nothing else was invented.
  params: [
    { id: "asset", label: "Fund traded", default: "tqqq", options: [
      { value: "tqqq", label: "TQQQ" }, { value: "qld", label: "QLD" },
      { value: "spxl", label: "SPXL" }, { value: "sso", label: "SSO" },
      { value: "qqq",  label: "QQQ" },  { value: "spy", label: "SPY" } ] },
    { id: "park", label: "Held when out", default: "cash", options: [
      { value: "cash", label: "Cash" }, { value: "qqq", label: "QQQ" },
      { value: "spy",  label: "SPY" },  { value: "sso", label: "SSO" } ] },
    { id: "signal", label: "Signal read from", default: "qqq", options: [
      { value: "qqq", label: "QQQ" }, { value: "spy", label: "SPY" }, { value: "tqqq", label: "TQQQ" } ] },
    { id: "window", label: "Window (days)", default: 200, options: [
      20,30,40,50,60,70,80,90,100,110,120,130,140,150,160,170,180,190,200,
      210,220,230,240,250,260,270,280,300,320,350,400] },
    // The one always-wanted extra knob (see PARAMS): median and moving average
    // are interchangeable center lines, defaulting to what the description names.
    { id: "stat", label: "Center line", options: [
      { value: "sma", label: "Moving average" }, { value: "median", label: "Median" } ], default: "sma" },
    { id: "band", label: "Cross buffer (%)", default: 1, options: [
      0,0.25,0.5,0.75,1,1.25,1.5,1.75,2,2.5,3,3.5,4,4.5,5,6,7,8,10] },
    { id: "cashRate", label: "Cash interest (%/yr)", default: 4, options: [
      0,0.5,1,1.5,2,2.5,3,3.5,4,4.5,5,5.5,6,7,8] },
    { id: "tradeCost", label: "Trading cost (%)", default: 0.02, options: [
      0,0.01,0.02,0.03,0.05,0.1,0.15,0.2,0.25,0.3,0.5,0.75,1] }
  ],
  columns: [
    { key: "signalPrice", label: "Signal", tip: "Closing price of the fund the trend signal is read from — the plain index, not the leveraged fund you trade." },
    { key: "signalSma", label: "Center", tip: "The center line of the signal fund over your chosen window — moving average or median, per the Center line setting. Above it means in-trend, below means out." },
    { key: "abovePct", label: "Above line", tip: "How far the signal sits above (+) or below (−) its center line. The trade fires once this passes your cross buffer." }
  ],
  lines: [
    { key: "signalSma", label: "Center line" }  // the level the trend rule compares against — see LINES
  ],
  run(data, p) {
    const log = [];
    const sig = data[p.signal] || data.qqq;
    const W = p.window, band = (p.band || 0) / 100;
    const cost = (p.tradeCost || 0) / 100;
    const dayRate = Math.pow(1 + (p.cashRate || 0) / 100, 1 / 252) - 1;
    const priceOf = (id, i) => (id === "cash" || !data[id]) ? 0 : data[id][i];
    let cash = p.initial, shares = 0, held = "cash";
    let sma = 0, above = 0;                                   // last bar's readings, for the signals block
    let invested = p.initial, prevMonth = null;
    const y0 = parseInt(data.dates[p.startIdx].slice(0, 4), 10);
    // Rolling center line: seed once from the warm-up window, then add/drop one
    // day at a time. The window lives as a running sum (the average) AND a
    // sorted array (the median) so the Center line param is free either way.
    const useMed = p.stat === "median";
    let sum = 0, n = 0;
    const win = [];
    const lb = (v) => { let lo = 0, hi = win.length; while (lo < hi) { const m = (lo + hi) >> 1; if (win[m] < v) lo = m + 1; else hi = m; } return lo; };
    const ins = (v) => { win.splice(lb(v), 0, v); sum += v; n++; };
    const rem = (v) => { const k = lb(v); if (k < win.length && win[k] === v) { win.splice(k, 1); sum -= v; n--; } };
    for (let k = Math.max(0, p.startIdx - W + 1); k <= p.startIdx; k++) if (sig[k] > 0) ins(sig[k]);
    for (let i = p.startIdx; i <= p.endIdx; i++) {
      if (i > p.startIdx) {
        if (sig[i] > 0) ins(sig[i]);
        const out = i - W;
        if (out >= 0 && sig[out] > 0) rem(sig[out]);
      }
      const month = data.dates[i].slice(0, 7);
      let contributed = 0, action = "hold", note = "", fee = 0;
      cash *= 1 + dayRate;                                    // idle cash earns interest
      if (prevMonth !== null && month !== prevMonth && p.monthly > 0) {
        const amt = p.monthly * Math.pow(1 + (p.annualRaise || 0), parseInt(month.slice(0, 4), 10) - y0);
        cash += amt; contributed = amt; invested += amt; action = "contribution";
      }
      prevMonth = month;
      sma = n > 0 ? (useMed ? (n % 2 ? win[(n - 1) >> 1] : (win[n / 2 - 1] + win[n / 2]) / 2) : sum / n) : 0; // hoisted: the signals block below reads the last bar's values
      above = sma > 0 ? sig[i] / sma - 1 : 0;
      let want = held;
      if (sma > 0) {
        if (above > band) want = p.asset;
        else if (above < -band) want = p.park;
      }
      if (want !== held) {                                    // one leg out, one leg in
        const oldPx = priceOf(held, i);
        if (held !== "cash" && oldPx > 0) {                   // sell leg pays the cost
          const gross = shares * oldPx, f = gross * cost;
          cash += gross - f; fee += f; shares = 0;
        }
        const newPx = priceOf(want, i);
        if (want !== "cash" && newPx > 0) {                   // buy leg pays it too
          const f = cash * cost;
          shares = (cash - f) / newPx; fee += f; cash = 0;
        }
        action = held === "cash" ? "buy" : want === "cash" ? "sell" : "switch";
        note = (above >= 0 ? "+" : "−") + Math.abs(above * 100).toFixed(1) + "% vs " + (useMed ? "median" : "SMA");
        held = want;
      } else if (held !== "cash" && cash > 0 && priceOf(held, i) > 0) {
        const f = cash * cost;                                // deploying new cash is a buy
        shares += (cash - f) / priceOf(held, i); fee += f; cash = 0;
      }
      const px = priceOf(held, i);
      const stockVal = shares * px;
      const monthEnd = i === p.endIdx || data.dates[i + 1].slice(0, 7) !== month;
      if (i === p.startIdx) action = "start";
      if (i === p.endIdx) action = "end";
      if (contributed > 0 || monthEnd || action !== "hold") {
        log.push({
          date: data.dates[i], value: stockVal + cash, action: action, note: note,
          held: held.toUpperCase(), price: px, shares: shares, holdingsValue: stockVal,
          cash: cash, contributed: contributed, invested: invested, fee: fee,
          signalPrice: sig[i], signalSma: sma, abovePct: above * 100
        });
      }
    }
    // Live dashboard for the last bar — same variables the loop just used.
    const inTrend = above > band;
    const pctStr = (above >= 0 ? "+" : "−") + Math.abs(above * 100).toFixed(2) + "%";
    const A = p.asset.toUpperCase(), K = p.park === "cash" ? "cash" : p.park.toUpperCase();
    return {
      log: log,
      signals: {
        cards: [
          { label: p.signal.toUpperCase() + " vs " + p.window + "-day " + (useMed ? "median" : "avg"),
            value: (inTrend ? "▲ " : "▼ ") + pctStr, tone: inTrend ? "good" : "bad",
            icon: inTrend ? "trendUp" : "trendDown",
            sub: sig[p.endIdx].toFixed(2) + " vs " + sma.toFixed(2) + (useMed ? " median" : " avg"),
            tip: "The signal fund's last close against its " + p.window + "-day moving average. Above the average means hold " + A + "; below means move to " + K + "." },
          { label: "Cross buffer", value: "±" + (p.band || 0) + "%", icon: "sliders",
            sub: p.band ? "dead zone around the average" : "no buffer — trades on any cross",
            tip: "How far past the average the price must travel before the trade fires. A wider buffer means fewer whipsaw trades but a later entry and exit." }
        ],
        decision: {
          action: inTrend ? "Buy " + A : (K === "cash" ? "Stay in cash" : "Buy " + K),
          note: inTrend ? "price is above the average" : "trend signal is off",
          tone: inTrend ? "good" : "bad",
          reasons: [
            { name: "Trend", val: p.signal.toUpperCase() + " " + pctStr + " vs " + p.window + "d",
              tag: inTrend ? "in · " + A : "out · " + K, lean: inTrend ? "buy" : "out" }
          ]
        }
      }
    };
  }
}

=== MY STRATEGY (write code that implements THIS) ===
<<describe your strategy here>>`;

// Inject the user's plain-English description into the structured prompt.
function buildCustomPrompt(desc) {
  const d = (desc || '').trim();
  return CUSTOM_PROMPT.replace('<<describe your strategy here>>', d || '<<describe your strategy here>>');
}

let _customDataCache = null;
function buildCustomData() {
  if (_customDataCache) return _customDataCache;
  if (typeof daily === 'undefined' || !daily) return { dates: [], tqqq: [], qqq: [], spy: [], qld: [], sso: [], spxl: [], sqqq: [] };
  _customDataCache = {
    dates: daily.map(d => d.date),
    tqqq:  daily.map(d => d.tqqq),
    qqq:   daily.map(d => d.qqq),
    spy:   daily.map(d => d.spy),
    qld:   daily.map(d => d.qld),
    sso:   daily.map(d => d.sso),
    spxl:  daily.map(d => d.spxl),
    sqqq:  daily.map(d => d.sqqq || 0),
    // Chicago Fed NFCI (weekly, aligned to daily with a 7-day publication
    // lag in js/data.js). NaN before 1971 or if the fetch failed — strategy
    // code must treat non-finite as "no signal".
    nfci:  (typeof nfciDaily !== 'undefined' && nfciDaily) ? nfciDaily : daily.map(() => NaN),
  };
  return _customDataCache;
}

// === Sandboxed execution ================================================
// Custom strategy code is NEVER evaluated on the main thread. It runs inside a
// Web Worker: no DOM, no window/document, no localStorage/cookies, no access to
// the page — and we additionally remove fetch / XMLHttpRequest / WebSocket /
// importScripts, plus a wall-clock timeout that kills runaway loops. The only
// input is public market data, so even hostile shared code can't read anything
// sensitive or reach the network. That makes running a stranger's strategy safe.
//
// The function below is stringified (never called on the main thread) and runs
// inside the worker.
function customWorkerMain() {
  // Strip anything that could exfiltrate, persist, or spawn more workers.
  ['fetch', 'XMLHttpRequest', 'WebSocket', 'importScripts', 'indexedDB', 'caches',
   'Notification', 'SharedWorker', 'Worker', 'BroadcastChannel'].forEach(function (k) {
    try { self[k] = undefined; } catch (e) {}
  });
  var DATA = null;
  function sanitize(raw) {
    var s = String(raw || '').trim();
    var f = s.match(/```[a-zA-Z0-9]*\s*([\s\S]*?)```/);
    if (f) s = f[1].trim();
    s = s.replace(/^\s*(?:module\.exports\s*=|export\s+default|const\s+\w+\s*=|let\s+\w+\s*=|var\s+\w+\s*=)\s*/, '').trim();
    s = s.replace(/;\s*$/, '').trim();
    return s;
  }
  function asMod(m) {
    if (typeof m === 'function') return { name: null, run: m, params: undefined };
    if (m && typeof m.run === 'function') return { name: m.name || null, run: m.run, params: m.params, columns: m.columns, lines: m.lines };
    return null;
  }
  // Column metadata ({ key, label, tip }) the strategy declares for its log —
  // accepted either top-level on the object or on run()'s return. Sanitized to
  // plain strings here so nothing but data crosses back out of the sandbox.
  function readColumns(raw) {
    if (!Array.isArray(raw)) return null;
    var out = [];
    for (var i = 0; i < raw.length; i++) {
      var c = raw[i];
      if (!c) continue;
      if (typeof c === 'string') { out.push({ key: c }); continue; }
      if (c.key == null) continue;
      out.push({
        key: String(c.key),
        label: c.label != null ? String(c.label) : null,
        tip: c.tip != null ? String(c.tip) : (c.tooltip != null ? String(c.tooltip) : null),
      });
    }
    return out.length ? out : null;
  }
  // Auxiliary chart lines ({ key, label }) the strategy declares — each key
  // names a numeric field its log rows carry (e.g. a signal line like a
  // median and its overextension threshold). Toggled from the strategy's
  // panel like 9sig's Holding/Target/Cash. Same sanitize-to-primitives rule
  // as readColumns; capped so a runaway declaration can't flood the chart.
  function readLines(raw) {
    if (!Array.isArray(raw)) return null;
    var out = [];
    for (var i = 0; i < raw.length && out.length < 6; i++) {
      var l = raw[i];
      if (!l) continue;
      if (typeof l === 'string') { out.push({ key: l, label: l }); continue; }
      if (l.key == null) continue;
      out.push({ key: String(l.key), label: l.label != null ? String(l.label) : String(l.key) });
    }
    return out.length ? out : null;
  }
  // Live signal dashboard the strategy reports for its LAST evaluated day:
  // { cards: [{ label, value, sub, tip, tone, icon, delta: { text, tone } }],
  // decision: { action, note, tone, reasons: [{ name, val, tag, lean }] } }.
  // Same sanitize-to-primitives rule as readColumns — only plain strings (or,
  // for `delta`, a plain {text,tone} pair of strings) cross back out of the
  // sandbox.
  function readSignals(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var S = function (v) { return v == null ? null : String(v); };
    var cards = [], i, c, delta;
    if (Array.isArray(raw.cards)) {
      for (i = 0; i < raw.cards.length && cards.length < 12; i++) {
        c = raw.cards[i];
        if (!c || c.label == null) continue;
        delta = (c.delta && typeof c.delta === 'object' && c.delta.text != null)
          ? { text: S(c.delta.text), tone: S(c.delta.tone) } : null;
        cards.push({ label: S(c.label), value: S(c.value), sub: S(c.sub),
                     tip: S(c.tip), tone: S(c.tone), icon: S(c.icon), delta: delta });
      }
    }
    var d = null, reasons = [], r;
    if (raw.decision && typeof raw.decision === 'object') {
      if (Array.isArray(raw.decision.reasons)) {
        for (i = 0; i < raw.decision.reasons.length && reasons.length < 10; i++) {
          r = raw.decision.reasons[i];
          if (!r || r.name == null) continue;
          reasons.push({ name: S(r.name), val: S(r.val), tag: S(r.tag), lean: S(r.lean) });
        }
      }
      d = { action: S(raw.decision.action), note: S(raw.decision.note),
            tone: S(raw.decision.tone), reasons: reasons };
    }
    if (!cards.length && !d) return null;
    return { cards: cards, decision: d, asOf: S(raw.asOf) };
  }
  function evalMod(code) {
    var base = sanitize(code), cands = [base], t = base, k;
    for (k = 0; k < 4 && /^\(/.test(t) && /\)$/.test(t); k++) { t = t.slice(1, -1).trim(); cands.push(t); }
    var fo = Math.min.apply(null, ['{', '('].map(function (c) { var i = base.indexOf(c); return i < 0 ? Infinity : i; }));
    var lc = Math.max(base.lastIndexOf('}'), base.lastIndexOf(')'));
    if (isFinite(fo) && fo > 0 && lc > fo) cands.push(base.slice(fo, lc + 1));
    var fb = base.indexOf('{'), lb = base.lastIndexOf('}');
    if (fb >= 0 && lb > fb) cands.push(base.slice(fb, lb + 1));
    if (base.length > 4 && /^\(\{/.test(base) && /\}\)$/.test(base)) cands.push(base.slice(2, -2).trim());
    var mod = null, lastErr;
    for (var ci = 0; ci < cands.length; ci++) {
      var c = cands[ci]; if (!c) continue;
      try { var r = asMod((new Function('"use strict"; return (' + c + '\n);'))()); if (r) { mod = r; break; } } catch (e) { lastErr = e; }
      try { var r2 = asMod((new Function('"use strict";\n' + c + '\n'))()); if (r2) { mod = r2; break; } } catch (e2) { lastErr = e2; }
    }
    if (!mod) throw new Error('Could not read a strategy — it must be a function run(data, p) or an object with one (no surrounding text or code fences). ' + (lastErr ? lastErr.message : ''));
    return mod;
  }
  function coerce(sp, raw) {
    // options: [true, false] declares a toggle (CUSTOM_PROMPT's documented
    // shape) — without this check the string branch below turned the value
    // into "true"/"false", both truthy, so `if (p.myToggle)` was always on.
    var boolish = (sp.type === 'bool' || sp.type === 'boolean') ||
      (Array.isArray(sp.options) && typeof sp.options[0] === 'boolean') ||
      (typeof sp.default === 'boolean');
    if (boolish) return raw === true || raw === 'true' || raw === '1' || raw === 1;
    var numeric = (sp.type === 'number') || ('min' in sp) || ('max' in sp) || ('step' in sp) || (Array.isArray(sp.options) && typeof sp.options[0] === 'number') || (typeof sp.default === 'number');
    if (numeric) { var n = Number(raw); return isFinite(n) ? n : (sp.default != null ? sp.default : 0); }
    return raw != null ? String(raw) : (sp.default != null ? String(sp.default) : '');
  }
  self.onmessage = function (e) {
    var msg = e.data || {};
    if (msg.type === 'data') { DATA = msg.data; return; }
    if (msg.type !== 'run') return;
    var out;
    try {
      var mod = evalMod(msg.code);
      var schema = Array.isArray(mod.params) ? mod.params : [];
      try { schema = JSON.parse(JSON.stringify(schema)); } catch (e0) { schema = []; }
      var p = {}, g = msg.globals || {}, key;
      for (key in g) p[key] = g[key];
      var raw = msg.rawParams || {};
      for (var si = 0; si < schema.length; si++) {
        var sp = schema[si];
        if (sp && sp.id != null) p[sp.id] = coerce(sp, (raw && (sp.id in raw)) ? raw[sp.id] : sp.default);
      }
      var res = mod.run(DATA, p);
      var rawLog = Array.isArray(res) ? res : (res && Array.isArray(res.log) ? res.log : null);
      if (!rawLog) throw new Error('Your function must return an array of { date, value } (or { log: [...] }).');
      var log = [];
      for (var li = 0; li < rawLog.length; li++) {
        var row = rawLog[li]; if (!row || row.date == null) continue;
        var o = {}, rk;
        for (rk in row) { var rv = row[rk]; if (typeof rv === 'number' || typeof rv === 'string' || typeof rv === 'boolean') o[rk] = rv; }
        log.push(o);
      }
      out = { reqId: msg.reqId, schema: schema, name: mod.name || null, log: log,
              columns: readColumns(res && res.columns) || readColumns(mod.columns),
              signals: readSignals(res && res.signals),
              lines: readLines(res && res.lines) || readLines(mod.lines),
              totalContributed: (res && typeof res.totalContributed === 'number') ? res.totalContributed : null };
    } catch (err) {
      out = { reqId: msg.reqId, error: (err && err.message) ? err.message : String(err) };
    }
    self.postMessage(out);
  };
}

// --- main-thread orchestration of the sandbox --------------------------
window._customLogs = window._customLogs || {};
window._customErrors = window._customErrors || {};
window._customSchemas = window._customSchemas || {};
window._customColumns = window._customColumns || {}; // cfgId -> [{ key, label, tip }] the strategy declared
window._customLines = window._customLines || {};     // cfgId -> [{ key, label }] auxiliary chart lines the strategy declared
window._customSignals = window._customSignals || {}; // cfgId -> { cards, decision } live signal dashboard
window._customResults = window._customResults || {}; // cfgId -> { sig, log, schema, name, error, totalContributed }
window._customYesterdayResults = window._customYesterdayResults || {}; // cfgId -> { sig, value, error } — day-over-day change badge, see scheduleCustomYesterdayRun
const CUSTOM_TIMEOUT_MS = 4000;
let _customWorker = null, _customWorkerSeq = 0, _customDataSent = false;
const _customPending = {};   // reqId -> { cfgId, sig, timer }
const _customRunTimers = {}; // cfgId -> { sig, t }

function ensureCustomWorker() {
  if (_customWorker) return _customWorker;
  try {
    const src = '(' + customWorkerMain.toString() + ')()';
    const url = URL.createObjectURL(new Blob([src], { type: 'application/javascript' }));
    const w = new Worker(url);
    w.onmessage = onCustomWorkerMessage;
    w.onerror = function () { try { w.terminate(); } catch (e) {} _customWorker = null; _customDataSent = false; };
    _customWorker = w;
    _customDataSent = false;
  } catch (e) { _customWorker = null; }
  return _customWorker;
}
function sendCustomData() {
  const w = ensureCustomWorker();
  if (!w || _customDataSent) return;
  w.postMessage({ type: 'data', data: buildCustomData() });
  _customDataSent = true;
}
function customSig(cfg, ctx) {
  // Contribution schedule (real transaction history or its formula-derived
  // fallback) and the exact-date overrides all feed computeCustomGlobals()'s
  // `contributions`/`entryDate`/`exitDate` below — previously missing here
  // entirely, so editing a transaction's amount/date (without also changing
  // initial/monthly/annualRaise/the coarse quarter slider) left this sig
  // unchanged and the worker cache silently kept serving the stale result.
  const schedKey = (ctx.contribSchedule && ctx.contribSchedule.list)
    ? ctx.contribSchedule.list.map(r => r.date + ':' + r.amount).join(',') : '';
  // ctx.displayGrain also feeds computeCustomGlobals()'s weeklyDisplay — same
  // staleness risk as the fields above if left out (a window crossing the
  // 10y threshold without any of the other fields changing would keep
  // serving a cached result computed at the old log density).
  return [cfg.code || '', JSON.stringify(cfg.params || {}), ctx.initial, ctx.monthly, ctx.annualRaise,
    ctx.simEntryIdx, ctx.exitIdx, ctx.entryDateOverride || '', ctx.exitDateOverride || '', schedKey, ctx.displayGrain || ''].join('|');
}
function computeCustomGlobals(cfg, ctx) {
  let entryDate = null, exitDate = null, startIdx = 0, endIdx = 0;
  if (typeof quarterlyData !== 'undefined' && quarterlyData) {
    // ctx.entryDateOverride/exitDateOverride (the exact-date picker, or a real
    // transaction history's entry date) previously weren't threaded through
    // here at all — custom strategies only ever saw the coarse quarter-snapped
    // date. Fixed in js/chart.js's cfgCtx construction.
    entryDate = ctx.entryDateOverride || (quarterlyData[ctx.simEntryIdx] || [])[0];
    exitDate  = ctx.exitDateOverride  || (quarterlyData[ctx.exitIdx] || [])[0];
  }
  if (typeof dailyDateToIdx !== 'undefined' && dailyDateToIdx) {
    const s = dailyDateToIdx.get(entryDate), en = dailyDateToIdx.get(exitDate);
    if (s != null) startIdx = s;
    if (en != null) endIdx = en;
  }
  const dlen = (typeof daily !== 'undefined' && daily) ? daily.length : 0;
  if (!endIdx) endIdx = Math.max(0, dlen - 1);
  // Contribution schedule as a plain {date: amount} object — postMessage-safe
  // and simple for a strategy to index by data.dates[i] (see CUSTOM_PROMPT's
  // p.contributions docs). Real transaction history (js/transactions.js) when
  // active, else the same formula-derived schedule the built-in engines use
  // (js/simulate.js's buildFormulaSchedule) — so a strategy written against
  // p.contributions behaves identically whether or not a real history is
  // loaded. buildCustomContributions (js/simulate.js) is the shared builder —
  // also called from strategy-library.js's slRunCode, so the two can't
  // silently diverge on what p.contributions contains the way they once did.
  const contributions = buildCustomContributions(ctx.monthly, ctx.annualRaise, entryDate, exitDate, ctx.contribSchedule);
  // Tells the strategy to log at week resolution instead of just month-end —
  // see CUSTOM_PROMPT's p.weeklyDisplay docs. Without this a custom line logs
  // sparsely (once a month) and gets step-resampled onto the chart's shared
  // axis, which reads as a blocky/stepped line next to the built-in engines'
  // smooth weekly sampling once ctx.displayGrain (js/chart.js) floors at
  // weekly for a <10y window.
  const weeklyDisplay = ctx.displayGrain === 'weekly';
  return { initial: ctx.initial, monthly: ctx.monthly, annualRaise: ctx.annualRaise, startIdx, endIdx, entryDate, exitDate, contributions, weeklyDisplay };
}
// Day-over-day change badge for a custom/library-derived config (see
// js/chart.js's isLatestDaySelected/prevTradingDayDate on ctx, and
// endLabelPlugin which reads window._customYesterdayResults to draw it).
// Only called once TODAY's line for this cfg is itself settled/non-stale
// (the caller checks cached.sig === sig first) — sequences the yesterday job
// BEHIND the live line's own job on the same single-threaded worker, so a
// background delta fetch never delays the visible line's own update.
// Reuses scheduleCustomRun's existing per-cfg dedup/throttle/signature-cache/
// timeout machinery via a synthetic id, instead of a parallel job queue.
function scheduleCustomYesterdayRun(cfg, ctx) {
  if (!ctx.isLatestDaySelected || !ctx.prevTradingDayDate) return;
  if (!cfg.code || !String(cfg.code).trim()) return;
  const yesterdayCtx = Object.assign({}, ctx, { exitDateOverride: ctx.prevTradingDayDate });
  const sig = customSig(cfg, yesterdayCtx);
  const cached = window._customYesterdayResults[cfg.id];
  if (cached && cached.sig === sig) return; // already have this one
  scheduleCustomRun({ ...cfg, id: cfg.id + '::yday' }, sig, computeCustomGlobals(cfg, yesterdayCtx));
}
// Throttled (not debounced) so a slider drag updates the line WHILE you're
// still dragging, not only once you let go. A plain debounce resets its timer
// on every event, and a continuous drag fires events faster than the timer's
// delay — so the timer never actually elapses until the drag stops, which is
// exactly why custom strategies looked frozen until slide-end. A throttle
// instead fires on a steady cadence (CUSTOM_THROTTLE_MS) throughout the drag.
//
// Also skips scheduling entirely while a request for this cfg is already in
// flight, rather than queuing another one behind it — a Worker processes
// messages one at a time, so queuing here would just rebuild the same lag one
// level down (the chart "catching up" through a backlog of now-stale values
// after you stop). onCustomWorkerMessage always calls render() when the
// in-flight one resolves, which re-derives the (by-then possibly newer) sig
// and calls back in here — so the freshest value is retried automatically the
// moment the worker frees up, with no extra bookkeeping needed here.
const _customLastFireAt = {}; // cfgId -> Date.now() of the last actual worker post
const CUSTOM_THROTTLE_MS = 150;
function scheduleCustomRun(cfg, sig, globals) {
  for (const k in _customPending) if (_customPending[k].cfgId === cfg.id && _customPending[k].sig === sig) return;
  if (_customRunTimers[cfg.id] && _customRunTimers[cfg.id].sig === sig) return;
  for (const k in _customPending) if (_customPending[k].cfgId === cfg.id) return; // busy — let it resolve, render() will retry
  if (_customRunTimers[cfg.id]) clearTimeout(_customRunTimers[cfg.id].t);
  const wait = Math.max(0, CUSTOM_THROTTLE_MS - (Date.now() - (_customLastFireAt[cfg.id] || 0)));
  _customRunTimers[cfg.id] = { sig, t: setTimeout(function () {
    delete _customRunTimers[cfg.id];
    _customLastFireAt[cfg.id] = Date.now();
    runCustomInWorker(cfg, sig, globals);
  }, wait) };
}
function runCustomInWorker(cfg, sig, globals) {
  // A day-change-badge job (synthetic '::yday' id, see scheduleCustomYesterdayRun)
  // must record its failures in ITS cache, not _customResults — a stray
  // '::yday'-keyed error entry there is never read, and leaving the yesterday
  // cache empty would let the next render() re-dispatch the same failing job
  // forever (each timeout → render → cache miss → dispatch again).
  const isYday = cfg.id.endsWith('::yday');
  const failTo = (error) => {
    if (isYday) window._customYesterdayResults[cfg.id.slice(0, -6)] = { sig, value: null, error };
    else window._customResults[cfg.id] = { sig, log: [], schema: (window._customSchemas[cfg.id] || []), error };
    if (typeof render === 'function') render();
  };
  const w = ensureCustomWorker();
  if (!w) { failTo('Sandbox (Web Worker) unavailable in this browser.'); return; }
  sendCustomData();
  const reqId = ++_customWorkerSeq;
  const timer = setTimeout(function () {
    delete _customPending[reqId];
    try { w.terminate(); } catch (e) {}
    _customWorker = null; _customDataSent = false; // rebuilt on next use
    failTo('Strategy timed out — possible infinite loop.');
  }, CUSTOM_TIMEOUT_MS);
  _customPending[reqId] = { cfgId: cfg.id, sig, timer };
  w.postMessage({ type: 'run', reqId: reqId, code: cfg.code, globals: globals, rawParams: cfg.params || {} });
}
// One-off sandbox run for a bar preview (a param override). Result goes to `cb`,
// NOT into the main result cache, so it never disturbs the live line.
//
// These are QUEUED. A fine-grained dropdown has 30-40 options, and posting all
// of them at once into the single worker would start every job's timeout clock
// at post time — so the ones still waiting their turn would "time out" without
// having run, and take the worker down with them. Two in flight keeps the
// worker saturated without that.
const CUSTOM_PREVIEW_INFLIGHT = 2;
const _customPreviewQueue = [];
let _customPreviewInFlight = 0;
function runCustomPreview(cfg, overrides, globals, cb) {
  _customPreviewQueue.push({ cfg, overrides, globals, cb });
  pumpCustomPreviewQueue();
}
function clearCustomPreviewQueue() { _customPreviewQueue.length = 0; }
function pumpCustomPreviewQueue() {
  while (_customPreviewInFlight < CUSTOM_PREVIEW_INFLIGHT && _customPreviewQueue.length) {
    startCustomPreview(_customPreviewQueue.shift());
  }
}
function startCustomPreview(job) {
  const w = ensureCustomWorker();
  if (!w) { job.cb(null, 'no-sandbox'); return; }
  sendCustomData();
  const reqId = ++_customWorkerSeq;
  _customPreviewInFlight++;
  let settled = false;
  const finish = (msg, err) => {
    if (settled) return;
    settled = true;
    _customPreviewInFlight--;
    try { job.cb(msg, err); } finally { pumpCustomPreviewQueue(); }
  };
  const timer = setTimeout(function () {
    delete _customPending[reqId];
    try { w.terminate(); } catch (e) {}
    _customWorker = null; _customDataSent = false;
    finish(null, 'timeout');
  }, CUSTOM_TIMEOUT_MS);
  _customPending[reqId] = { cb: finish, timer };
  w.postMessage({ type: 'run', reqId: reqId, code: job.cfg.code, globals: job.globals, rawParams: Object.assign({}, job.cfg.params || {}, job.overrides) });
}
function onCustomWorkerMessage(e) {
  const msg = e.data || {};
  const pend = _customPending[msg.reqId];
  if (!pend) return; // stale or timed-out
  clearTimeout(pend.timer);
  delete _customPending[msg.reqId];
  if (pend.cb) { pend.cb(msg, msg.error); return; } // bar-preview run
  // Day-over-day change badge job (see scheduleCustomYesterdayRun) — only the
  // final value matters, and it changes nothing in chart.data, so a cheap
  // no-animation update repaints the label overlay without re-running full
  // render()'s sig checks (and risking recursively triggering more of these).
  if (pend.cfgId.endsWith('::yday')) {
    const baseId = pend.cfgId.slice(0, -6);
    const log = msg.log || [];
    const last = log.length ? log[log.length - 1] : null;
    window._customYesterdayResults[baseId] = {
      sig: pend.sig,
      value: (last && typeof last.value === 'number' && isFinite(last.value)) ? last.value : null,
      error: msg.error || null,
    };
    if (typeof chart !== 'undefined' && chart) chart.update('none');
    return;
  }
  window._customResults[pend.cfgId] = {
    sig: pend.sig, log: msg.log || [], schema: msg.schema || [],
    columns: msg.columns || null, signals: msg.signals || null, lines: msg.lines || null,
    name: msg.name || null, error: msg.error || null,
    totalContributed: (typeof msg.totalContributed === 'number') ? msg.totalContributed : null,
  };
  window._customSchemas[pend.cfgId] = msg.schema || [];
  window._customColumns[pend.cfgId] = msg.columns || null;
  window._customSignals[pend.cfgId] = msg.signals || null;
  window._customLines[pend.cfgId] = msg.lines || null;
  // Adopt the name the strategy's own code declares (`name: "…"`) — but only
  // while the config still wears its auto-generated "Custom strategy" placeholder,
  // so a name the user typed themselves is never overwritten.
  const namedCfg = savedConfigs.find(c => c.id === pend.cfgId);
  if (namedCfg && msg.name && /^Custom strategy( \(\d+\))?$/.test(namedCfg.name)) {
    const trimmed = String(msg.name).replace(/\s+/g, ' ').trim();
    if (trimmed) {
      namedCfg.name = uniqueName(trimmed, namedCfg.id);
      persistSavedConfigs();
      if (window._editingConfigId === namedCfg.id && typeof setPanelTitle === 'function') setPanelTitle(namedCfg.name);
    }
  }
  if (typeof render === 'function') render(); // now a cache hit → no new run
}

// Schema comes from the worker (we never evaluate strategy code on the main thread).
function getCustomSchema(cfg) { return (window._customSchemas || {})[cfg.id] || []; }
// Coerce a stored/raw param value to the type implied by its schema entry.
function coerceCustomVal(sp, raw) {
  // Mirrors the worker's coerce() (customWorkerMain above) — keep the two in
  // sync, including the options:[true,false] toggle detection: without it a
  // declared boolean arrived as the string "true"/"false" (both truthy).
  const boolish = (sp.type === 'bool' || sp.type === 'boolean')
    || (Array.isArray(sp.options) && typeof sp.options[0] === 'boolean')
    || (typeof sp.default === 'boolean');
  if (boolish) return raw === true || raw === 'true' || raw === '1' || raw === 1;
  const numericHint = (sp.type === 'number') || ('min' in sp) || ('max' in sp) || ('step' in sp)
    || (Array.isArray(sp.options) && typeof sp.options[0] === 'number')
    || (typeof sp.default === 'number');
  if (numericHint) { const n = Number(raw); return Number.isFinite(n) ? n : (sp.default != null ? sp.default : 0); }
  return raw != null ? String(raw) : (sp.default != null ? String(sp.default) : '');
}
function customParamValue(cfg, sp) {
  const stored = cfg.params && (sp.id in cfg.params) ? cfg.params[sp.id] : sp.default;
  return coerceCustomVal(sp, stored);
}

// Money-weighted CAGR (%) for a saved/custom config, using the shared chart
// contribution schedule (ctx) and the config's own final value. The x-axis
// labels span the same dates as the main strategy, so labels[0]/labels[last]
// give the contribution window. Falls back to the simple end/contributed CAGR
// when metrics.js isn't loaded or the span is unknown.
function cfgMoneyWeightedCAGR(ctx, finalV) {
  const labels = ctx.labels || [];
  const startDate = labels.length ? labels[0] : null;
  const endDate = labels.length ? labels[labels.length - 1] : null;
  if (typeof moneyWeightedCAGR === 'function' && startDate && endDate) {
    return moneyWeightedCAGR(ctx.initial, ctx.monthly, ctx.annualRaise, startDate, endDate,
      ctx.years, finalV, (typeof monthlyData !== 'undefined' ? monthlyData : null), ctx.totalContributed,
      ctx.contribSchedule);
  }
  return (ctx.years > 0 && ctx.totalContributed > 0 && finalV > 0)
    ? (Math.pow(finalV / ctx.totalContributed, 1 / ctx.years) - 1) * 100 : 0;
}

// Turn a (worker-computed) log into a label-aligned series + stats. No code eval.
function customSeriesResult(log, ctx, error, tcOverride, stale) {
  const labels = ctx.labels;
  if (error) return { data: labels.map(() => null), cagr: 0, maxDD: 0, start: 0, end: 0, ddPeak: null, ddTrough: null };
  const points = (log || [])
    .filter(r => r && r.date != null && typeof r.value === 'number' && Number.isFinite(r.value))
    .map(r => ({ date: String(r.date), value: r.value }))
    .sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  const series = stale ? resampleByDateClamped(points, labels) : resampleByDate(points, labels);
  // Stale/clamped series can end (or start) in a null gap — fall back to the
  // nearest real value rather than letting the stat pills read as 0.
  const lastReal = (arr) => { for (let i = arr.length - 1; i >= 0; i--) if (arr[i] != null) return arr[i]; return 0; };
  const firstReal = (arr) => { for (let i = 0; i < arr.length; i++) if (arr[i] != null) return arr[i]; return 0; };
  const finalV = series.length ? lastReal(series) : 0;
  const startV = series.length ? firstReal(series) : 0;
  // Drawdown is revalued at EVERY daily close, same as the built-in engines —
  // never on `series` (chart-label grain steps over intra-label troughs) and
  // never on the log alone (a strategy logging only trades + month ends misses
  // intra-month troughs). Falls back to log grain, then label grain, when the
  // strategy doesn't emit held/shares/cash. CAGR is money-weighted, unaffected.
  const cagr = cfgMoneyWeightedCAGR(ctx, finalV);
  const ddVals = points.map(p => p.value), ddDates = points.map(p => p.date);
  const ddCtrl = (typeof buildCustomDDControls === 'function') ? buildCustomDDControls(log) : null;
  const dailyRows = (typeof daily !== 'undefined' && daily) ? daily : null;
  let dd = null;
  if (ddCtrl && dailyRows && typeof computeDailyMaxDrawdownMulti === 'function') {
    dd = computeDailyMaxDrawdownMulti(ddCtrl, dailyRows);
  }
  if (!dd && typeof computeMaxDrawdown === 'function') {
    dd = computeMaxDrawdown(ddVals.length ? ddVals : series, ddVals.length ? ddDates : labels);
  }
  if (!dd) dd = { pct: 0, peakDate: null, troughDate: null };
  return { data: series, cagr, maxDD: dd.pct * 100, start: startV, end: finalV, ddPeak: dd.peakDate, ddTrough: dd.troughDate };
}

// Custom strategy series — served from the worker-result cache. On a cache miss
// (new code/params/range) it schedules a sandboxed run and, until that returns,
// shows the last good line over whatever date range it actually covers — not
// flat-filled past its own coverage, so a slider drag shows a gap instead of a
// stale line pinned at the old endpoint (see resampleByDateClamped).
function computeCustomSeries(cfg, ctx) {
  window._customCtx = ctx; // shared by the bar-preview popup
  if (!cfg.code || !String(cfg.code).trim()) {
    window._customErrors[cfg.id] = null;
    window._customLogs[cfg.id] = [];
    return customSeriesResult([], ctx, true);
  }
  const sig = customSig(cfg, ctx);
  const cached = window._customResults[cfg.id];
  if (cached && cached.sig === sig) {
    window._customErrors[cfg.id] = cached.error || null;
    window._customLogs[cfg.id] = cached.log || [];
    window._customSchemas[cfg.id] = cached.schema || [];
    window._customColumns[cfg.id] = cached.columns || null;
    window._customSignals[cfg.id] = cached.signals || null;
    window._customLines[cfg.id] = cached.lines || null;
    // Today's line is settled — safe to also fetch yesterday's for the
    // day-over-day change badge (endLabelPlugin), sequenced behind it.
    scheduleCustomYesterdayRun(cfg, ctx);
    return customSeriesResult(cached.log, ctx, cached.error, cached.totalContributed);
  }
  scheduleCustomRun(cfg, sig, computeCustomGlobals(cfg, ctx));
  window._customErrors[cfg.id] = null; // computing…
  window._customLogs[cfg.id] = (cached && cached.log) || [];
  return customSeriesResult(cached ? cached.log : [], ctx, null, cached ? cached.totalContributed : null, true);
}

// Run the right engine for a config and return its label-aligned series + stats.
function computeConfigSeries(cfg, ctx) {
  if (cfg.type === 'custom') return computeCustomSeries(cfg, ctx);
  const { initial, monthly, annualRaise, simEntryIdx, exitIdx, labels, years, totalContributed,
          entryDateOverride, exitDateOverride, contribSchedule, displayGrain,
          isLatestDaySelected, prevTradingDayDate, entryDateForSim } = ctx;
  // Shared by every branch below — a real uploaded transaction history
  // (js/transactions.js) or the exact-date picker override, threaded through
  // exactly like render() already does for the main/base lines (js/chart.js).
  // Previously missing here entirely: a saved/derived 9sig/SMA/Buy&Hold/
  // Invested Compounded line fell back to the OLD monthly-formula schedule
  // and the quarter-snapped entry date, silently ignoring both overrides.
  const _dateOverrideOpts = (entryDateOverride || exitDateOverride)
    ? { entryDateOverride, exitDateOverride } : {};
  // entryDateOverride/exitDateOverride alone have NO effect on simulate() —
  // it only re-derives entryIdx/exitIdx from them when a custom qData is
  // ALSO present (js/simulate.js's `qData !== quarterlyData` gate). Buy &
  // Hold and Invested Compounded have no "period" concept of their own (they
  // always run on plain quarterlyData), so this exact-range qData is what
  // makes the override actually apply for them — same fallback chart.js's
  // render() uses for the main line.
  const _bhExactQData = ((entryDateOverride || exitDateOverride) && typeof buildExactRangeQData === 'function')
    ? buildExactRangeQData('quarterly',
        entryDateOverride || (quarterlyData[simEntryIdx] && quarterlyData[simEntryIdx][0]),
        exitDateOverride  || (quarterlyData[exitIdx]    && quarterlyData[exitIdx][0]))
    : null;
  const _bhQDataOpts = (_bhExactQData && _bhExactQData.length >= 2) ? { qData: _bhExactQData } : {};
  // Day-over-day change badge for this saved config (see js/chart.js's
  // isLatestDaySelected/prevTradingDayDate on ctx, and endLabelPlugin which
  // draws it). "Yesterday" = today's END-STATE HOLDINGS marked at the
  // previous trading day's close via repriceAtPrevTradingDay (js/utils.js —
  // its comment explains why a reprice, not an exit-shifted second sim: the
  // engines' month-row contribution walk makes an exit-shifted sim drop the
  // whole current month, which then shows up as a fake one-day move).
  // Returns a RAW yesterday value (deflated to real $ when the inflation
  // toggle is on) — endLabelPlugin diffs it against whichever TODAY value is
  // current at draw time, same as the async custom-strategy path in
  // computeCustomSeries. Invested Compounded gets no badge (a
  // monthly-stepped synthetic baseline has no meaningful daily change).
  const ydayFromHoldings = (holdings, cash) => {
    if (!isLatestDaySelected || !prevTradingDayDate || typeof repriceAtPrevTradingDay !== 'function') return null;
    const v = repriceAtPrevTradingDay(holdings, cash);
    if (v == null) return null;
    const defl = (typeof inflationOn === 'function' && inflationOn() && typeof inflFactor === 'function')
      ? inflFactor(prevTradingDayDate, labels[0]) : 1;
    return v * defl;
  };
  window._configDayChange = window._configDayChange || {};
  let ydayVal = null; // set per-branch below, written to the cache once after

  const p = cfg.params || {};
  let points = null;
  let subPoints = null; // 9sig Holding/Target/Cash breakdown (for its sub-series)
  // #3 Daily-drawdown control points (date/shares/cash) + the daily price field
  // to revalue against. Filled per strategy below; null → fall back to the
  // rebalance-grain series drawdown (e.g. Invested Compounded, custom).
  let ddControls = null, ddKey = null;
  // Multi-asset drawdown control points (SMA can hold leveraged + out-asset +
  // cash at once). When set, takes precedence over the single-asset path.
  let ddMulti = null;
  const UL_KEY = { 1: 'tqqq', 2: 'qqq', 3: 'spy', 4: 'qld', 5: 'sso', 6: 'spxl', 7: 'sqqq' };

  if (cfg.type === '9sig') {
    const cd = +pget(p, 'select-9sig-crashdrop', 30);
    const sp = +pget(p, 'select-9sig-spike', 100);
    const opts = {
      schedule: contribSchedule,
      ..._dateOverrideOpts,
      qGrowth: (+pget(p, 'select-9sig-growth', 9)) / 100 || 0.09,
      underlyingCol: ulColFromVal(pget(p, 'select-9sig-underlying', 'tqqq')),
      crashDropPct: Number.isFinite(cd) ? cd : 30,
      crashLookbackMonths: +pget(p, 'select-9sig-crashwin', 24) || 24,
      spikeTriggerPct: Number.isFinite(sp) ? sp : 100,
      rebalancePeriod: pget(p, 'select-9sig-period', 'quarterly') || 'quarterly',
      cashPct: (+pget(p, 'select-9sig-cash', 40) || 0) / 100,
      contribDeployPct: pget(p, 'select-9sig-deploy', '0') === '1' ? 0.5 : (+pget(p, 'select-9sig-deploy', '0') || 0) / 100,
      targetFromPrevTarget: ['target', '1'].includes(pget(p, 'select-9sig-target-compound', 'holding')),
      parkAsset: pget(p, 'select-9sig-park-asset', 'cash') || 'cash',
      buyThrottlePct: +pget(p, 'select-9sig-buypower', 90) || 90,
      spikeResetPct: pget(p, 'select-9sig-spike-target', 'auto') || 'auto',
      tradeCostPct: +pget(p, 'select-9sig-cost', 0) || 0,
    };
    // Rebalance point: shift the schedule to N% through each period.
    // entryDateOverride/exitDateOverride ALONE have no effect on simulate() —
    // it only re-derives entryIdx/exitIdx from them when a custom qData is
    // ALSO present (js/simulate.js's `qData !== quarterlyData` gate). So
    // both this qData and the exact-range fallback below prefer the override
    // dates over the quarter-snapped ones, same as chart.js's render().
    const _entryDateForQ = entryDateOverride || (quarterlyData[simEntryIdx] && quarterlyData[simEntryIdx][0]);
    const _exitDateForQ  = exitDateOverride  || (quarterlyData[exitIdx]    && quarterlyData[exitIdx][0]);
    const _rp = +pget(p, 'select-9sig-rebalance-point', 0) || 0;
    if (_rp > 0 && typeof buildEnvelopeQData === 'function' && typeof PERIOD_DAYS !== 'undefined') {
      const _pd = PERIOD_DAYS[opts.rebalancePeriod] || 63;
      const _off = Math.round(_rp / 100 * (_pd - 1));
      const _q = buildEnvelopeQData(opts.rebalancePeriod, _off, _entryDateForQ, _exitDateForQ);
      if (_q && _q.length >= 2) opts.qData = _q;
    }
    // No rebalance-point qData claimed one — if an exact-date override is
    // active, build the day-precision qData that makes it actually apply
    // (same fallback chart.js's render() uses for the main line).
    if (!opts.qData && (entryDateOverride || exitDateOverride) && typeof buildExactRangeQData === 'function') {
      const _q2 = buildExactRangeQData(opts.rebalancePeriod, _entryDateForQ, _exitDateForQ);
      if (_q2 && _q2.length >= 2) opts.qData = _q2;
    }
    // This config's period coarser than the chart's shared axis grain (see
    // js/chart.js's cfgCtx.displayGrain) → get in-between value snapshots at
    // that grain so its line/sub-series don't lose resolution relative to
    // everything else sharing this axis. Falls back to the old
    // yearly-only-vs-quarterly rule if displayGrain wasn't supplied (a
    // caller other than chart.js's render(), e.g. a stale cached ctx shape).
    opts.sampleQuarterly = displayGrain ? (displayGrain === 'quarterly' && opts.rebalancePeriod === 'yearly') : (opts.rebalancePeriod === 'yearly');
    opts.sampleWeekly = displayGrain === 'weekly' && opts.rebalancePeriod !== 'weekly';
    const cashRate = (+pget(p, 'select-9sig-cashrate', 4) || 0) / 100;
    const r = simulate(initial, monthly, cashRate, simEntryIdx, exitIdx, annualRaise, opts);
    // Driven by the same sampleQuarterly/sampleWeekly flags set above, not by
    // whether samplePoints happens to be non-empty — see the 'bh'/'invested'
    // branches below for why a duck-typed check is the wrong call here.
    const seriesRows = (opts.sampleQuarterly || opts.sampleWeekly) ? r.samplePoints : (r.log || []);
    points = seriesRows.map(l => ({ date: l.date, value: l.total }));
    subPoints = {
      holding: seriesRows.map(l => ({ date: l.date, value: l.tqqqVal })),
      target:  seriesRows.map(l => ({ date: l.date, value: l.target })),
      cash:    seriesRows.map(l => ({ date: l.date, value: l.cash })),
    };
    ddControls = (r.log || []).map(l => ({ date: l.date, shares: l.price > 0 ? l.tqqqVal / l.price : 0, cash: l.cash }));
    ddKey = UL_KEY[opts.underlyingCol] || 'tqqq';
    if (window._editingConfigId === cfg.id) window._editingConfigSim = { type: '9sig', log: r.log, bhPoints: r.bhPoints, qqqPoints: r.qqqPoints, spyPoints: r.spyPoints, qldPoints: r.qldPoints, ssoPoints: r.ssoPoints, spxlPoints: r.spxlPoints, sqqqPoints: r.sqqqPoints };
    const _sigLast = (r.log && r.log.length) ? r.log[r.log.length - 1] : null;
    if (_sigLast && typeof daily !== 'undefined' && daily && daily.length) {
      const _sigShares = _sigLast.price > 0 ? _sigLast.tqqqVal / _sigLast.price : 0;
      const _parkKey = (opts.parkAsset || 'cash').toLowerCase();
      const _todayRow = daily[daily.length - 1];
      if (_parkKey === 'cash') {
        ydayVal = ydayFromHoldings({ [ddKey]: _sigShares }, _sigLast.cash);
      } else if (_todayRow[_parkKey] > 0) {
        const _h = { [ddKey]: _sigShares };
        _h[_parkKey] = (_h[_parkKey] || 0) + _sigLast.cash / _todayRow[_parkKey];
        ydayVal = ydayFromHoldings(_h, 0);
      }
    }
  } else if (cfg.type === 'sma') {
    const opts = {
      schedule: contribSchedule,
      ..._dateOverrideOpts,
      smaAsset: pget(p, 'select-sma-asset', 'qqq') || 'qqq',
      smaWindow: +pget(p, 'select-sma-window', 200) || 200,
      underlyingCol: ulColFromVal(pget(p, 'select-sma-underlying', 'tqqq')),
      entryBufferPct: +pget(p, 'select-sma-entry-buf', 0) || 0,
      exitBufferPct: +pget(p, 'select-sma-exit-buf', 0) || 0,
      rsiOverheatThreshold: +pget(p, 'select-sma-rsi-oh', 0) || 0,
      rsiCoolThreshold: +pget(p, 'select-sma-rsi-cool', 0) || 0,
      outAsset: pget(p, 'select-sma-out-asset', 'cash') || 'cash',
      dcaInMonths: +pget(p, 'select-sma-dca-in', 0) || 0,
      dcaToOutMonths: +pget(p, 'select-sma-dca-to-out', 0) || 0,
      bgGtfoPct: +pget(p, 'select-sma-bg-gtfo', 0) || 0,
      bgAsset: pget(p, 'select-sma-bg-asset', 'qqq') || 'qqq',
      bgWindow: +pget(p, 'select-sma-bg-window', 0) || 0,
      tradeCostPct: +pget(p, 'select-sma-cost', 0) || 0,
      rsiOhWindow: +pget(p, 'select-sma-rsi-oh-window', 10) || 10,
      rsiCoolWindow: +pget(p, 'select-sma-rsi-cool-window', 10) || 10,
      rebalanceCheck: 'daily',
      confirmBuySteps: +pget(p, 'select-sma-confirm-buy', 0) || 0,
      confirmSellSteps: +pget(p, 'select-sma-confirm-sell', 0) || 0,
      settleDays: +pget(p, 'select-sma-settle', 0) || 0,
      emitDD: true,
      // smaPoints (js/simulate.js) is otherwise only pushed on quarter-end
      // dates regardless of window length — same displayGrain-driven weekly
      // fill-out as the main SMA line (js/chart.js) and the 9sig branch above.
      sampleWeekly: displayGrain === 'weekly',
    };
    const cashRate = (+pget(p, 'select-sma-cashrate', 4) || 0) / 100;
    const r = simulateSMA(initial, monthly, cashRate, simEntryIdx, exitIdx, annualRaise, opts);
    points = (r.smaPoints || []).map(pt => ({ date: pt.date, value: pt.value }));
    // Full multi-asset holdings per step → honest daily-revalued max drawdown.
    ddMulti = r.ddControls || null;
    if (window._editingConfigId === cfg.id) window._editingConfigSim = { type: 'sma', smaLog: r.smaLog, smaPoints: r.smaPoints };
    const _smaCtlLast = (ddMulti && ddMulti.length) ? ddMulti[ddMulti.length - 1] : null;
    if (_smaCtlLast) ydayVal = ydayFromHoldings(_smaCtlLast.h, _smaCtlLast.cash);
  } else if (cfg.type === 'bh') {
    // Same in-between snapshotting the main Buy & Hold line gets (js/chart.js's
    // sigOpts) — without it this config's line falls back to bhPoints' native
    // quarterly resolution and looks stepped next to the weekly-dense main line.
    const bhOpts = {
      schedule: contribSchedule, ..._dateOverrideOpts, ..._bhQDataOpts,
      // No sampleQuarterly: raw bh points are already quarterly (see `arr`
      // below) — building quarter-end samples here would be wasted work.
      sampleWeekly: displayGrain === 'weekly',
    };
    const r = simulate(initial, monthly, 0, simEntryIdx, exitIdx, annualRaise, bhOpts);
    const key = pget(p, 'select-bh-underlying', 'tqqq');
    const rawArr = key === 'sqqq' ? (r.sqqqPoints || [])
              : key === 'qqq' ? r.qqqPoints
              : key === 'spy' ? r.spyPoints
              : key === 'qld' ? (r.qldPoints || [])
              : key === 'sso' ? (r.ssoPoints || [])
              : key === 'spxl' ? (r.spxlPoints || [])
              : r.bhPoints;
    const sampleArr = key === 'sqqq' ? r.sqqqSample
              : key === 'qqq' ? r.qqqSample
              : key === 'spy' ? r.spySample
              : key === 'qld' ? r.qldSample
              : key === 'sso' ? r.ssoSample
              : key === 'spxl' ? r.spxlSample
              : r.bhSample;
    // Weekly grain ONLY. At quarterly grain the raw points are already at
    // the axis's own resolution (bh runs on quarterly qData rows), and the
    // sample series is actually WORSE there: buyHold()'s quarter-end sample
    // rows stop at the last completed quarter, missing the final
    // partial-quarter point rawArr carries — which left this line's tail
    // frozen at the previous quarter-end value (and the day-change badge
    // comparing today's real holdings against that stale value).
    const arr = displayGrain === 'weekly' ? sampleArr : rawArr;
    points = (arr || []).map(pt => ({ date: pt.date, value: pt.value }));
    // Drawdown control needs real per-step share counts, which only the raw
    // (quarterly) points carry — the dense sample rows are value-only.
    ddControls = (rawArr || []).map(pt => ({ date: pt.date, shares: pt.shares, cash: 0 }));
    ddKey = key === 'qqq' ? 'qqq' : key === 'spy' ? 'spy' : key === 'qld' ? 'qld' : key === 'sso' ? 'sso' : key === 'spxl' ? 'spxl' : key === 'sqqq' ? 'sqqq' : 'tqqq';
    if (window._editingConfigId === cfg.id) window._editingConfigSim = { type: 'bh', log: r.log, bhPoints: r.bhPoints, qqqPoints: r.qqqPoints, spyPoints: r.spyPoints, qldPoints: r.qldPoints, ssoPoints: r.ssoPoints, spxlPoints: r.spxlPoints, sqqqPoints: r.sqqqPoints };
    const _bhLast = (rawArr && rawArr.length) ? rawArr[rawArr.length - 1] : null;
    if (_bhLast && _bhLast.shares > 0) ydayVal = ydayFromHoldings({ [ddKey]: _bhLast.shares }, 0);
  } else if (cfg.type === 'invested') {
    const rate = (typeof sliderToRate === 'function' ? sliderToRate(+pget(p, 'slider-rate', 0)) : 0) / 100;
    const investedOpts = {
      baselineRate: rate, schedule: contribSchedule, ..._dateOverrideOpts, ..._bhQDataOpts,
      sampleQuarterly: displayGrain === 'quarterly',
      sampleWeekly: displayGrain === 'weekly',
    };
    const r = simulate(initial, monthly, 0, simEntryIdx, exitIdx, annualRaise, investedOpts);
    const seriesRows = (displayGrain === 'quarterly' || displayGrain === 'weekly') ? r.samplePoints : (r.log || []);
    points = seriesRows.map(l => ({ date: l.date, value: l.investedCompounded }));
    if (window._editingConfigId === cfg.id) window._editingConfigSim = { type: 'invested', log: r.log };
    // No day-change badge for Invested Compounded — see ydayFromHoldings'
    // comment above.
  }
  window._configDayChange[cfg.id] = ydayVal;

  const data = resampleByDate(points, labels);
  const finalV = data.length ? data[data.length - 1] : 0;
  const startV = data.length ? data[0] : 0;
  // #2 Money-weighted (IRR) return — same contribution schedule as the main
  // chart; only this strategy's final value differs.
  const cagr = cfgMoneyWeightedCAGR(ctx, finalV);
  // #3 Daily-sampled drawdown when we have control points to revalue daily;
  // otherwise fall back to the rebalance-grain series drawdown.
  const dailyRows = (typeof daily !== 'undefined' && daily) ? daily : null;
  const dd = (ddMulti && ddMulti.length && dailyRows && typeof computeDailyMaxDrawdownMulti === 'function')
    ? computeDailyMaxDrawdownMulti(ddMulti, dailyRows)
    : (ddControls && ddControls.length && dailyRows && typeof computeDailyMaxDrawdown === 'function')
    ? computeDailyMaxDrawdown(ddControls, dailyRows, ddKey)
    : ((typeof computeMaxDrawdown === 'function') ? computeMaxDrawdown(data, labels) : { pct: 0, peakDate: null, troughDate: null });
  return { data, cagr, maxDD: dd.pct * 100, start: startV, end: finalV, subPoints, ddPeak: dd.peakDate, ddTrough: dd.troughDate };
}

function fadeColor(hex, a) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// --- chart dataset sync (called from render() in chart.js) -------------
function removeConfigDatasets(chart) {
  if (!chart || !chart.data) return;
  for (let i = chart.data.datasets.length - 1; i >= 0; i--) {
    if (chart.data.datasets[i]._configLine) chart.data.datasets.splice(i, 1);
  }
}
function appendConfigDatasets(chart, ctx) {
  if (!chart || !chart.data) return;
  window._configMetrics = {};
  // Recomputed below if the edited config is among these; the side panel uses it
  // to show the EDITED strategy's stats/log (the base sim is canonical now).
  window._editingConfigSim = null;
  for (const cfg of savedConfigs) {
    const s = computeConfigSeries(cfg, ctx);
    window._configMetrics[cfg.id] = { cagr: s.cagr, maxDD: s.maxDD, start: s.start, end: s.end, ddPeak: s.ddPeak, ddTrough: s.ddTrough };
    chart.data.datasets.push({
      label: cfg.name,
      data: s.data,
      borderColor: cfg.color,
      backgroundColor: 'transparent',
      fill: false,
      tension: 0.3,
      pointRadius: 0,
      pointHitRadius: 10,
      borderWidth: 2,
      hidden: !!cfg.hidden,
      _configLine: true,
      _configId: cfg.id,
    });
    chart.setDatasetVisibility(chart.data.datasets.length - 1, !cfg.hidden);

    // Per-strategy sub-series (Holding/Target/Cash) — each saved 9sig owns its
    // own breakdown lines, drawn from its sim, shown per cfg.subShown[key]. They
    // persist (tied to the strategy), so they never flip to the canonical base.
    if (cfg.type === '9sig' && s.subPoints && cfg.subShown) {
      for (const def of CONFIG_SUB_DEFS) {
        if (!cfg.subShown[def.key]) continue;
        chart.data.datasets.push({
          label: cfg.name + ' · ' + configSubLabel(def, cfg),
          data: resampleByDate(s.subPoints[def.key], ctx.labels),
          borderColor: cfg.color, borderDash: def.dash, borderWidth: 1.5,
          backgroundColor: 'transparent', fill: false, tension: def.key === 'target' ? 0 : 0.3,
          pointRadius: 0, pointHitRadius: 10, hidden: !!cfg.hidden,
          _configLine: true, _configId: cfg.id, _configSub: def.key,
        });
        chart.setDatasetVisibility(chart.data.datasets.length - 1, !cfg.hidden);
      }
    }

    // A custom strategy's declared signal lines (`lines: [{key,label}]`)
    // deliberately do NOT join the main chart: they're price-scale values
    // ($50–$80) squashed unreadably under six-figure portfolio lines. They
    // render as a mini chart inside the strategy's own panel instead — see
    // buildCustomLinesChartHtml.
  }
  appendActualPortfolioDataset(chart, ctx);
}

// The "My portfolio" line — the ACTUAL account value readings carried in the
// user's transaction file (the optional third column, js/transactions.js's
// state.actualPoints). What IS, drawn next to what was contributed (Invested
// Compounded) and what could have been (every strategy). Flagged _configLine
// so removeConfigDatasets strips it each render and the index-keyed
// hidden-list persistence skips it, exactly like saved-config lines; the
// endLabelPlugin / tooltip / range-select all pick it up generically.
const TX_ACTUAL_COLOR = '#0d9488'; // mirrored by styles.css's .tx-actual-dot
function appendActualPortfolioDataset(chart, ctx) {
  window._actualMetrics = null;
  const s = window._txSchedule;
  // The ENTRY-AWARE view (js/chart.js stashes window._txEffective each
  // render): a mid-history entry re-anchors the line at the cutoff lump and
  // drops earlier readings/flows. Falls back to the raw state when absent.
  const eff = window._txEffective || s;
  if (!s || !eff || !eff.actualPoints || !eff.actualPoints.length || s.showActual === false) return;
  const pts = eff.actualPoints;
  // Forward-fill via resampleByDate, but null out labels BEFORE the first
  // real reading — back-filling would draw a flat line through history the
  // account didn't exist in. After the last reading the forward-fill stands:
  // the latest known value carries to the right edge, so the end label and
  // the "what is, today" comparison exist.
  const series = resampleByDate(pts, ctx.labels);
  const firstDate = pts[0].date;
  for (let i = 0; i < ctx.labels.length && ctx.labels[i] < firstDate; i++) series[i] = null;
  const finalV = pts[pts.length - 1].value;
  // FLOW-ADJUSTED drawdown (js/utils.js computeFlowAdjustedDrawdown) — a
  // naive peak-to-trough on raw balances counted a big withdrawal as a
  // "drawdown" (the initial version showed -70% where the real market DD was
  // far less). Flows = the (entry-aware) initial lump + every later flow.
  const flows = [{ date: eff.entryDate || s.entryDate, amount: eff.initial }, ...eff.schedule.list];
  const dd = (typeof computeFlowAdjustedDrawdown === 'function')
    ? computeFlowAdjustedDrawdown(pts, flows)
    : { pct: 0, peakDate: null, troughDate: null };
  window._actualMetrics = {
    cagr: cfgMoneyWeightedCAGR(ctx, finalV),
    maxDD: dd.pct * 100, ddPeak: dd.peakDate, ddTrough: dd.troughDate,
    start: pts[0].value, end: finalV,
  };
  chart.data.datasets.push({
    label: 'My portfolio',
    data: series,
    borderColor: TX_ACTUAL_COLOR,
    backgroundColor: 'transparent',
    fill: false,
    tension: 0.3,
    pointRadius: 0,
    pointHitRadius: 10,
    borderWidth: 2.5, // the user's REAL line — visually primary
    _configLine: true,
    _actualLine: true,
  });
  chart.setDatasetVisibility(chart.data.datasets.length - 1, true);
  // The sidebar summary shows these metrics — but its usual triggers
  // (toggleContribMode etc.) run BEFORE render() gets here, when
  // _actualMetrics was still null. Refresh it now that they exist.
  if (typeof renderTxSummary === 'function') renderTxSummary();
}

// --- naming -------------------------------------------------------------
// Default names are PLAIN type labels — they don't encode (or track) the
// strategy's parameters. The user can rename a saved strategy to anything.
const BASE_LABELS = { '9sig': '9sig', 'sma': 'SMA', 'bh': 'Buy & Hold', 'invested': 'Invested Compounded', 'custom': 'Custom strategy' };
function genBaseName(type) {
  return BASE_LABELS[type] || type;
}
// Ensure a name is unique among saved configs, appending " (2)", " (3)"… on
// collision. `exceptId` lets an in-place rename keep its own current name.
function uniqueName(desired, exceptId) {
  const existing = new Set(savedConfigs.filter(c => c.id !== exceptId).map(c => c.name));
  let name = desired, n = 2;
  while (existing.has(name)) name = `${desired} (${n++})`;
  return name;
}
function nextConfigColor() {
  const used = new Set(savedConfigs.map(c => c.color));
  for (const c of CONFIG_COLORS) if (!used.has(c)) return c;
  return CONFIG_COLORS[savedConfigs.length % CONFIG_COLORS.length];
}

// --- CRUD ---------------------------------------------------------------
function saveConfigFromType(type) {
  if (!CONFIG_PARAM_IDS[type]) return;
  const params = captureParams(type);
  // Default name is a plain type label ("9sig", "SMA", …) — unless the user typed
  // one into the panel title before saving. Names never auto-change with params;
  // the user can rename freely at any time.
  const desired = window._pendingConfigName || genBaseName(type);
  window._pendingConfigName = null;
  const cfg = {
    id: 'cfg_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    type,
    name: uniqueName(desired),
    params,
    // Keep the main strategy's colour — the saved strategy is its variant, not a
    // differently-coloured line.
    color: (typeof getBaseColor === 'function') ? getBaseColor(type) : nextConfigColor(),
    hidden: false,
  };
  savedConfigs.push(cfg);
  persistSavedConfigs();
  // After saving we're editing the COPY, not the main strategy: its controls stay
  // loaded so further tweaks auto-save into it (and it shows no "Save as strategy"
  // button). The MAIN strategy is reset to its defaults — automatically, because
  // the base line is frozen to canonical while a saved strategy is edited — and
  // its line is hidden so the copy stands alone on the chart.
  window._editingConfigId = cfg.id;
  setPanelTitle(cfg.name);
  setBaseStrategyVisibility(type, false);
  if (typeof render === 'function') render();
  flashSaveSuccess(cfg.id);
}
// Show / hide a base strategy's chart line (and its 9sig sub-series + envelope),
// persisting the choice the same way the legend toggles do.
function setBaseStrategyVisibility(type, visible) {
  if (typeof chart === 'undefined' || !chart) return;
  const idx = (typeof PANEL_IDX_BY_KEY !== 'undefined') ? PANEL_IDX_BY_KEY[type] : null;
  if (idx == null) return;
  chart.setDatasetVisibility(idx, visible);
  if (!visible && typeof SUB_LEGEND !== 'undefined' && SUB_LEGEND[idx]) {
    for (const s of SUB_LEGEND[idx]) chart.setDatasetVisibility(s, false);
  }
  if (typeof saveSliders === 'function') saveSliders();
}
// While a saved (non-custom) strategy is open in the shared sidebar, mirror the
// live control values into it on every render — so its line updates the instant
// the user changes a dropdown, with no separate "Update" step. The NAME is left
// alone (it doesn't track the params). Custom strategies edit their own params
// directly, so they're skipped here.
function syncEditingConfig() {
  const id = window._editingConfigId;
  if (!id) return;
  const cfg = savedConfigs.find(c => c.id === id);
  if (!cfg || cfg.type === 'custom' || !CONFIG_PARAM_IDS[cfg.type]) return;
  const next = captureParams(cfg.type);
  let changed = false;
  for (const k of CONFIG_PARAM_IDS[cfg.type]) {
    if (String((cfg.params || {})[k]) !== String(next[k])) { changed = true; break; }
  }
  if (!changed) return;
  cfg.params = next;
  persistSavedConfigs();
}

// --- base line vs. saved strategy: keep them from mixing ----------------
// The top pills (9sig / SMA / B&H / Invested) are FIXED canonical references.
// While a saved strategy is open for editing, the live sidebar controls belong
// to THAT strategy's line, not the base. So just before render() simulates the
// base line we swap the edited type's knob controls to their canonical (HTML
// default) values, then put the user's edits straight back afterwards. The swap
// is fully synchronous (no repaint in between) so the sidebar never flickers,
// and the saved-strategy line is computed from cfg.params — never the controls —
// so it keeps showing the edits. Net effect: editing a saved 9sig moves only the
// saved line; the canonical 9sig line stays put.
let _baseFreezeSnapshot = null;
function freezeBaseForEditing() {
  _baseFreezeSnapshot = null;
  // The ONE base type currently being drafted — its panel open AND we're not
  // editing a saved strategy — keeps its live controls (that's the draft line).
  // EVERY other base type is a fixed canonical reference, so swap its knobs to
  // canonical for the base-line sim. This covers: editing a saved base strategy
  // (freeze that type), editing a CUSTOM strategy (freeze all — no base draft),
  // and idle (freeze all → bases never show leftover params from a prior edit).
  const draftType = (!window._editingConfigId && typeof getOpenPanelKey === 'function')
    ? getOpenPanelKey() : null;
  const snap = {};
  for (const type in CONFIG_PARAM_IDS) {
    if (type === draftType) continue; // active draft keeps its live controls
    for (const cid of CONFIG_PARAM_IDS[type]) {
      if (cid in snap) continue;
      const el = document.getElementById(cid);
      if (!el) continue;
      const def = CANONICAL_DEFAULTS[cid];
      if (def == null) continue;
      snap[cid] = (el.type === 'checkbox') ? el.checked : el.value;
      if (el.type === 'checkbox') el.checked = (def === '1');
      else el.value = def;
    }
  }
  _baseFreezeSnapshot = Object.keys(snap).length ? snap : null;
}
function restoreBaseAfterEditing() {
  if (!_baseFreezeSnapshot) return;
  const snap = _baseFreezeSnapshot;
  _baseFreezeSnapshot = null;
  for (const cid in snap) {
    const el = document.getElementById(cid);
    if (!el) continue;
    if (el.type === 'checkbox') el.checked = snap[cid];
    else el.value = snap[cid];
  }
}
// Put a base strategy's knob controls back to their canonical defaults. Called
// when a base panel is opened or closed so the base line never inherits leftover
// values from a saved strategy that was previously loaded into the sidebar —
// "open sig tqqq" always starts from a clean canonical copy.
function resetBaseControlsToCanonical(type) {
  if (!CONFIG_PARAM_IDS[type]) return;
  applyParams(type, captureDefaultParams(type));
  if (typeof refresh9sigDisplayLabels === 'function') refresh9sigDisplayLabels();
  if (typeof update9sigCashSpans === 'function') update9sigCashSpans();
  if (typeof updateSmaCashRateVisibility === 'function') updateSmaCashRateVisibility();
  if (typeof syncBgSmaWindowLabel === "function") syncBgSmaWindowLabel();
  if (typeof updateDeployAvailability === 'function') updateDeployAvailability();
  if (typeof window.refreshPreviewTriggers === 'function') window.refreshPreviewTriggers();
}
// Create a new (empty) custom strategy and open the build modal. The describe →
// prompt → paste flow happens in the modal; the sidebar only shows the result.
function createCustomStrategy() {
  const cfg = {
    id: 'cfg_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    type: 'custom',
    name: uniqueName('Custom strategy'),
    code: '',
    desc: '',
    params: {},
    color: nextConfigColor(),
    hidden: false,
  };
  savedConfigs.push(cfg);
  window._editingConfigId = cfg.id;
  persistSavedConfigs();
  if (typeof render === 'function') render();
  openCustomBuilder(cfg.id, true);
}

// ===== Custom-strategy build modal (describe → generate → paste) =========
let _builderId = null, _builderPhase = 'describe', _builderIsNew = false;
function openCustomBuilder(cfgId, isNew) {
  const cfg = savedConfigs.find(c => c.id === cfgId);
  if (!cfg) return;
  _builderId = cfgId;
  _builderIsNew = !!isNew;
  // New strategies start at "describe"; editing an existing one jumps to the
  // prompt/paste step (it already has code).
  _builderPhase = (isNew || !cfg.code) ? 'describe' : 'generate';
  renderCustomBuilder();
}
function closeCustomBuilder(cancelled) {
  const modal = document.getElementById('custom-builder-modal');
  if (modal) modal.remove();
  const id = _builderId, isNew = _builderIsNew;
  _builderId = null; _builderIsNew = false;
  // Abandoning a brand-new strategy before any code is applied removes it.
  if (cancelled && isNew) {
    const cfg = savedConfigs.find(c => c.id === id);
    if (cfg && !cfg.code) deleteConfig(id);
  }
}
function renderCustomBuilder() {
  const cfg = savedConfigs.find(c => c.id === _builderId);
  if (!cfg) return;
  let modal = document.getElementById('custom-builder-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.className = 'sc-modal-overlay';
    modal.id = 'custom-builder-modal';
    document.body.appendChild(modal);
  }
  const err = (window._customErrors || {})[cfg.id];
  let inner;
  if (_builderPhase === 'describe') {
    inner = `
      <div class="builder-modal">
        <div class="sc-modal-title">Describe your strategy</div>
        <div class="wip-note">⚠ Custom strategies are a work in progress — their results may still change.</div>
        <div class="builder-help">In plain English, describe your strategy in as much detail as you can. You can base it on any of these tickers — <b>TQQQ</b>, <b>QLD</b>, <b>QQQ</b>, <b>SPY</b>, <b>SSO</b>, <b>SPXL</b>, <b>SQQQ</b> (inverse −3×) — plus entry/exit rules, thresholds, and how monthly contributions are handled.</div>
        <textarea id="builder-desc" class="builder-textarea" placeholder="e.g. Hold TQQQ. At each month-end, if QQQ closed below its 200-day moving average, move everything to cash; when it closes back above, buy TQQQ again. Add the monthly contribution to whatever I'm holding.">${_escHtml(cfg.desc || '')}</textarea>
        <div class="builder-actions">
          <button type="button" class="sc-modal-btn" data-builder-cancel>Cancel</button>
          <button type="button" class="sc-modal-btn primary" data-builder-complete>Complete →</button>
        </div>
      </div>`;
  } else {
    inner = `
      <div class="builder-modal">
        <div class="sc-modal-title">Generate &amp; paste</div>
        <div class="builder-help">Copy the prompt, paste it into <b>ChatGPT</b> or <b>Claude</b> and send. Then copy its reply and paste it below.</div>
        <button type="button" class="custom-copy-btn" data-builder-copy>Copy prompt for ChatGPT / Claude</button>
        <div class="builder-step-label">Paste the reply here</div>
        ${(err && cfg.code) ? `<div class="custom-error"><b>Couldn't run it:</b> ${_escHtml(err)}</div>` : ''}
        <div class="code-editor">
          <div class="code-editor-gutter" aria-hidden="true"></div>
          <div class="code-editor-scroll">
            <pre class="code-editor-hl" aria-hidden="true"><code></code></pre>
            <textarea id="builder-code" class="code-editor-input" spellcheck="false" autocapitalize="off" autocorrect="off" placeholder="Paste the strategy code here…">${_escHtml(cfg.code || '')}</textarea>
          </div>
        </div>
        <div class="builder-actions">
          <button type="button" class="sc-modal-btn" data-builder-back>← Back</button>
          <button type="button" class="sc-modal-btn primary" data-builder-apply>Apply &amp; show</button>
        </div>
      </div>`;
  }
  modal.innerHTML = inner;
  const codeTa = modal.querySelector('#builder-code');
  if (codeTa) initCodeEditor(codeTa);
  const focusEl = modal.querySelector('textarea');
  if (focusEl) focusEl.focus();
}

// --- Custom-strategy code editor: syntax highlighting + auto-format ----------
// Lightweight JS tokenizer. Output is HTML-escaped; it only drives colors, so a
// mis-tokenized edge case (e.g. a regex literal) is cosmetic and never touches
// the textarea's actual value.
const _CODE_KW = new Set(('const let var function return if else for while do switch case break continue ' +
  'new typeof instanceof in of delete void this null true false undefined class extends super import ' +
  'export default try catch finally throw async await yield').split(' '));
function _highlightJS(src) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  let out = '', i = 0; const n = src.length;
  const push = (cls, txt) => { out += cls ? `<span class="tk-${cls}">${esc(txt)}</span>` : esc(txt); };
  while (i < n) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') { let j = src.indexOf('\n', i); if (j < 0) j = n; push('cmt', src.slice(i, j)); i = j; continue; }
    if (c === '/' && src[i + 1] === '*') { let j = src.indexOf('*/', i + 2); j = j < 0 ? n : j + 2; push('cmt', src.slice(i, j)); i = j; continue; }
    if (c === '"' || c === "'" || c === '`') { let j = i + 1; while (j < n) { if (src[j] === '\\') { j += 2; continue; } if (src[j] === c) break; j++; } j = Math.min(j + 1, n); push('str', src.slice(i, j)); i = j; continue; }
    if ((c >= '0' && c <= '9') || (c === '.' && src[i + 1] >= '0' && src[i + 1] <= '9')) { let j = i + 1; while (j < n && /[0-9a-fA-FxXeE._+-]/.test(src[j])) j++; push('num', src.slice(i, j)); i = j; continue; }
    if (/[A-Za-z_$]/.test(c)) { let j = i + 1; while (j < n && /[A-Za-z0-9_$]/.test(src[j])) j++; const w = src.slice(i, j); let k = j; while (k < n && (src[k] === ' ' || src[k] === '\t')) k++; const cls = _CODE_KW.has(w) ? 'kw' : (src[k] === '(' ? 'fn' : (/[A-Z]/.test(w[0]) ? 'cls' : null)); push(cls, w); i = j; continue; }
    if (/[{}()\[\].,;]/.test(c)) { push('pn', c); i++; continue; }
    if (/[+\-*/%=<>!&|^~?:]/.test(c)) { push('op', c); i++; continue; }
    push(null, c); i++;
  }
  return out;
}

// Turn <textarea id="builder-code"> into a highlighted, auto-formatting editor.
// The textarea stays the real input (native paste/undo/caret/selection); a synced
// <pre> behind it renders the colors. js-beautify (CDN, loaded deferred) reformats
// on paste and on blur — whitespace only, so it can never change what the code does.
function initCodeEditor(ta) {
  const scroll = ta.parentElement;                 // .code-editor-scroll
  const pre = scroll && scroll.querySelector('.code-editor-hl');
  const code = pre && pre.querySelector('code');
  if (!code) return;
  const editor = scroll.parentElement;             // .code-editor
  const gutter = editor && editor.querySelector('.code-editor-gutter');
  let lastLines = -1;
  const paintGutter = () => {
    if (!gutter) return;
    const lines = ta.value.split('\n').length;
    if (lines === lastLines) return;           // only rebuild when the count changes
    lastLines = lines;
    let g = ''; for (let k = 1; k <= lines; k++) g += k + '\n';
    gutter.textContent = g;
  };
  const paint = () => { code.innerHTML = _highlightJS(ta.value) + '\n'; paintGutter(); };
  const sync = () => { pre.scrollTop = ta.scrollTop; pre.scrollLeft = ta.scrollLeft; if (gutter) gutter.scrollTop = ta.scrollTop; };
  const format = () => {
    const v = ta.value.trim();
    if (v && typeof js_beautify === 'function') {
      try {
        const f = js_beautify(v, { indent_size: 2, brace_style: 'collapse,preserve-inline', space_in_empty_paren: true, end_with_newline: false });
        if (f && f !== ta.value) ta.value = f;
      } catch (e) { /* unparseable draft — leave it exactly as typed */ }
    }
    paint(); sync();
  };
  ta.addEventListener('input', paint);
  ta.addEventListener('scroll', sync);
  ta.addEventListener('paste', () => setTimeout(format, 0));
  ta.addEventListener('blur', format);
  if (ta.value.trim()) format(); else paint();
  sync();
}

// Merge saved strategies carried in a share link. Custom code is safe to run
// because it executes in the sandboxed worker. Deduped by content signature so
// reloading the same link doesn't pile up copies.
function importSharedConfigs(arr) {
  if (!Array.isArray(arr)) return;
  const sig = (c) => `${c.type}|${c.name || ''}|${c.code || ''}|${JSON.stringify(c.params || {})}`;
  const existing = new Set(savedConfigs.map(sig));
  for (const c of arr) {
    if (!c || !c.type || existing.has(sig(c))) continue;
    const cfg = {
      id: 'cfg_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      type: c.type,
      // Keep the shared name (it may be a name the author chose); fall back to the
      // plain type label.
      name: uniqueName(c.name || genBaseName(c.type)),
      params: c.params || {},
      color: c.color || nextConfigColor(),
      hidden: !!c.hidden,
      // Transient: shown on the chart this session but NOT written to localStorage.
      // The recipient clicks "Save" on the banner to keep them locally.
      _transient: true,
    };
    if (c.type === 'custom') { cfg.code = c.code || ''; cfg.desc = c.desc || ''; } // safe to run: sandboxed
    savedConfigs.push(cfg);
    existing.add(sig(c));
  }
}

// Which saved strategy (if any) has its panel open right now, as an INDEX into
// `list` — a share link only serialises ACTIVE (non-hidden) strategies, so the
// caller passes that same filtered array, keeping the index a valid reference
// into what's actually in the link. Defaults to the full savedConfigs for any
// other caller that wants the plain "which one is open" answer. Covers custom
// panels (which leave _currentPanelIdx null) and saved base-type panels alike.
function openSavedConfigIndex(list) {
  const id = window._openCustomCfgId || window._editingConfigId;
  if (!id) return -1;
  return (list || savedConfigs).findIndex(c => c.id === id);
}
// Resolve a shared-array entry back to a LOCAL config id after import. Cannot
// match on the dedup signature: importSharedConfigs runs the name through
// uniqueName(), so a name collision renames the copy. Match on the parts that
// survive — type + code + params — and prefer a just-imported (transient) hit
// over an identical strategy the recipient already had.
function resolveSharedConfigId(entry) {
  if (!entry || !entry.type) return null;
  const key = (c) => `${c.type}|${c.code || ''}|${JSON.stringify(c.params || {})}`;
  const want = key(entry);
  const hits = savedConfigs.filter(c => key(c) === want);
  if (!hits.length) return null;
  return (hits.find(c => c._transient) || hits[0]).id;
}

// Convert every currently-transient (share-link) config into a regular saved
// strategy and write to localStorage. Triggered by the "Save" banner button.
function saveSharedStrategies() {
  let changed = false;
  for (const c of savedConfigs) {
    if (c._transient) { delete c._transient; changed = true; }
  }
  if (changed) {
    persistSavedConfigs();
    renderSavedConfigPills();
  }
}

// Green success flash after a save/update. The save bar gets rebuilt by the
// render() above, so we flash the freshly-rendered primary button (briefly
// swapping its label to a checkmark) plus the saved pill in the Parameters
// panel as a second confirmation that it landed there.
function flashSaveSuccess(configId) {
  const btn = document.querySelector('.config-savebar .config-savebar-btn.primary');
  if (btn) {
    const restore = btn.textContent;
    btn.classList.add('flash-success');
    btn.textContent = '✓ Saved';
    setTimeout(() => {
      if (!btn.isConnected) return; // panel rebuilt meanwhile — leave the new button alone
      btn.classList.remove('flash-success');
      btn.textContent = restore;
    }, 1100);
  }
  if (configId) {
    const pill = document.querySelector(`.saved-config-pill[data-config-id="${configId}"]`);
    if (pill) { pill.classList.add('flash-success'); setTimeout(() => pill.classList.remove('flash-success'), 1100); }
  }
}
function deleteConfig(id) {
  savedConfigs = savedConfigs.filter(c => c.id !== id);
  if (window._editingConfigId === id) window._editingConfigId = null;
  // If the deleted strategy's custom editor is open, close the panel.
  if (window._openCustomCfgId === id && typeof closeStrategyPanel === 'function') closeStrategyPanel();
  persistSavedConfigs();
  if (typeof render === 'function') render();
}
// Rename a saved strategy to whatever the user typed (deduped against the others).
function renameConfig(id, name) {
  const cfg = savedConfigs.find(c => c.id === id);
  if (!cfg) return;
  const trimmed = (name || '').replace(/\s+/g, ' ').trim();
  if (!trimmed) return;
  const next = uniqueName(trimmed, id);
  if (next === cfg.name) return;
  cfg.name = next;
  persistSavedConfigs();
  if (typeof render === 'function') render();
}
function toggleConfigVisibility(id) {
  const cfg = savedConfigs.find(c => c.id === id);
  if (!cfg) return;
  cfg.hidden = !cfg.hidden;
  persistSavedConfigs();
  // Full re-render so the strategy's main line AND its alternate-runs band
  // (created only while visible) appear/disappear together.
  if (typeof render === 'function') render();
  else renderSavedConfigPills();
}
// Load a saved config into the shared sidebar controls and open its panel for
// editing. The base/live strategy of the same type now reflects these numbers
// (shared-sidebar model) — the config's own frozen line still shows the
// last-saved version until the user hits Update.
function openConfigForEdit(id) {
  const cfg = savedConfigs.find(c => c.id === id);
  if (!cfg) return;
  window._pendingConfigName = null;
  // Custom strategies have their own panel (code editor + generated controls).
  if (cfg.type === 'custom') {
    window._editingConfigId = id;
    if (typeof openCustomPanel === 'function') openCustomPanel(id);
    return;
  }
  applyParams(cfg.type, cfg.params);
  if (typeof refresh9sigDisplayLabels === 'function') refresh9sigDisplayLabels();
  if (typeof update9sigCashSpans === 'function') update9sigCashSpans();
  if (typeof updateSmaCashRateVisibility === 'function') updateSmaCashRateVisibility();
  if (typeof syncBgSmaWindowLabel === "function") syncBgSmaWindowLabel();
  if (typeof updateDeployAvailability === 'function') updateDeployAvailability();
  if (typeof saveSliders === 'function') saveSliders();
  window._editingConfigId = id;
  if (typeof render === 'function') render();
  if (typeof window.refreshPreviewTriggers === 'function') window.refreshPreviewTriggers();
  if (typeof openPanelByKey === 'function') openPanelByKey(cfg.type);
  // openStrategyPanel sets the title to the base strategy label — override it
  // with the saved strategy's own (auto-derived) name.
  setPanelTitle(cfg.name);
}

// --- editable panel title (= strategy name) ----------------------------
// The name is free-form: whatever the user types becomes the strategy's name.
// It never changes on its own when parameters are tweaked.
function setPanelTitle(text) {
  const el = document.getElementById('strategy-panel-title');
  if (el && el.textContent !== text) el.textContent = text;
}
function commitPanelTitle(text) {
  const name = (text || '').replace(/\s+/g, ' ').trim();
  if (window._editingConfigId) {
    const cfg = savedConfigs.find(c => c.id === window._editingConfigId);
    if (cfg) {
      if (name) { renameConfig(cfg.id, name); setPanelTitle(cfg.name); }
      else setPanelTitle(cfg.name); // empty → revert to existing name
    }
  } else {
    // Editing a base strategy that isn't saved yet — remember the typed name so
    // the next "Save as strategy" uses it.
    window._pendingConfigName = name || null;
  }
}
function focusPanelTitle() {
  const el = document.getElementById('strategy-panel-title');
  if (!el) return;
  el.focus();
  const range = document.createRange();
  range.selectNodeContents(el);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}
(function wirePanelTitle() {
  const el = document.getElementById('strategy-panel-title');
  if (!el) return;
  let focusValue = '';
  el.addEventListener('focus', () => { focusValue = el.textContent; });
  el.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') { ev.preventDefault(); el.blur(); }
    else if (ev.key === 'Escape') { ev.preventDefault(); el.textContent = focusValue; el.blur(); }
  });
  el.addEventListener('blur', () => commitPanelTitle(el.textContent));
  const pencil = document.getElementById('strategy-panel-title-edit');
  if (pencil) pencil.addEventListener('click', focusPanelTitle);
})();

// --- in-sidebar save bar (rendered by renderStrategyPanelBody) ---------
function buildPanelSaveBarHtml(type) {
  if (!CONFIG_PARAM_IDS[type]) return '';
  // Editing a SAVED strategy auto-saves live (see syncEditingConfig) and can't be
  // forked — so it shows no save button. Only the main/base strategy offers
  // "Save as strategy", which spins off a new saved strategy.
  const editingSaved = window._editingConfigId
    && savedConfigs.find(c => c.id === window._editingConfigId && c.type === type);
  if (editingSaved) return '';
  return `
    <div class="config-savebar">
      <button type="button" class="config-savebar-btn primary" data-sc-savenew="${type}" title="Save the current settings as a new saved strategy">Save as strategy</button>
    </div>`;
}

// --- Parameters-panel pill list ----------------------------------------
function buildConfigPillHtml(cfg) {
  const m = (window._configMetrics || {})[cfg.id] || {};
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const hidden = !!cfg.hidden;
  let metrics = '';
  if (Number.isFinite(m.cagr)) {
    const cagrSign = m.cagr >= 0 ? '+' : '';
    const cagrCls = m.cagr >= 0 ? 'positive' : 'negative';
    const ddStr = Number.isFinite(m.maxDD) ? fmtDD(m.maxDD) : '';
    const ddRange = (typeof fmtDDRange === 'function') ? fmtDDRange(m.ddPeak, m.ddTrough) : '';
    const ddRangeHtml = ddRange ? ` <span class="sc-metric-range">${ddRange}</span>` : '';
    metrics = `
      <div class="sc-metrics">
        <span class="sc-metric"><span class="sc-metric-label">CAGR</span> <span class="sc-metric-value ${cagrCls}">${cagrSign}${m.cagr.toFixed(1)}%</span></span>
        ${ddStr ? `<span class="sc-metric"><span class="sc-metric-label">DD</span> <span class="sc-metric-value negative">${ddStr}</span>${ddRangeHtml}</span>` : ''}
      </div>`;
  }
  const eyeSvg = hidden
    ? '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-10-7-10-7a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 10 7 10 7a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/>'
    : '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>';
  return `
    <div class="saved-config-pill${hidden ? ' is-hidden' : ''}" data-config-id="${cfg.id}" draggable="true" title="Click to show / hide on chart">
      <div class="sc-top">
        <span class="sc-handle-col">
          <button type="button" class="sc-eye" aria-label="Toggle visibility" title="Show / hide on chart">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${eyeSvg}</svg>
          </button>
          <span class="sc-drag" aria-label="Drag to reorder" title="Drag to reorder">
            <svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor" stroke="none"><circle cx="9" cy="6" r="1.4"/><circle cx="9" cy="12" r="1.4"/><circle cx="9" cy="18" r="1.4"/><circle cx="15" cy="6" r="1.4"/><circle cx="15" cy="12" r="1.4"/><circle cx="15" cy="18" r="1.4"/></svg>
          </span>
        </span>
        <span class="sc-dot" style="background:${cfg.color}"></span>
        <span class="sc-name">${esc(cfg.name)}</span>
        ${cfg.type === 'custom' ? `<span class="sc-badge" title="Custom strategy (runs in a sandbox)">ƒ</span>` : ''}
        <div class="sc-actions">
          <button type="button" class="sc-edit" title="Edit in sidebar" aria-label="Edit">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
          </button>
          <button type="button" class="sc-delete" title="Delete strategy" aria-label="Delete">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          </button>
        </div>
      </div>
      ${metrics}
    </div>`;
}
function renderSavedConfigPills() {
  const host = document.getElementById('saved-configs');
  if (!host) return;
  if (!savedConfigs.length) {
    host.innerHTML = '';
    host.hidden = true;
    return;
  }
  host.hidden = false;
  // Shared-link configs aren't auto-saved — they're only kept locally if the
  // user clicks "Save" on this banner. (Without the click they'll disappear
  // when the recipient leaves the page; with it they're written to localStorage
  // like any other saved strategy.)
  const transientN = savedConfigs.reduce((n, c) => n + (c._transient ? 1 : 0), 0);
  const banner = transientN > 0 ? `
    <div class="shared-strategies-banner">
      <span class="ssb-text">${transientN} shared strateg${transientN === 1 ? 'y' : 'ies'} from the link — won't be kept unless you save.</span>
      <button type="button" class="ssb-save" id="save-shared-strategies">Save${transientN > 1 ? ' all' : ''}</button>
    </div>` : '';
  host.innerHTML = `
    ${banner}
    <div class="saved-configs-list">${savedConfigs.map(buildConfigPillHtml).join('')}</div>`;
  setupConfigDragReorder();
}

// Which pill the dragged one should land before, given the cursor's Y. Returns
// the first pill whose vertical midpoint sits below the cursor (null = append).
function _dragAfterPill(list, y) {
  const els = [...list.querySelectorAll('.saved-config-pill:not(.dragging)')];
  let closest = null, closestOffset = -Infinity;
  for (const el of els) {
    const box = el.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > closestOffset) { closestOffset = offset; closest = el; }
  }
  return closest;
}

// Commit a new saved-strategy order (array of config ids) → reorder savedConfigs,
// persist, and redraw the chart (dataset/legend order follows savedConfigs).
function reorderSavedConfigs(idOrder) {
  const byId = new Map(savedConfigs.map(c => [c.id, c]));
  const next = [];
  for (const id of idOrder) { const c = byId.get(id); if (c) { next.push(c); byId.delete(id); } }
  for (const c of savedConfigs) if (byId.has(c.id)) next.push(c); // safety: keep any stragglers
  const changed = next.length !== savedConfigs.length || next.some((c, i) => c !== savedConfigs[i]);
  if (!changed) return;
  savedConfigs = next;
  persistSavedConfigs();
  if (typeof render === 'function') render();
  renderSavedConfigPills();
}

// Drag-to-reorder for the saved-strategy list. Wired once on the stable host
// (delegation survives innerHTML rebuilds). Dragging is gated to the grip handle
// so clicking a pill still toggles its visibility. The dragged pill is moved in
// the DOM live during dragover; the new order is committed on drop.
function setupConfigDragReorder() {
  const host = document.getElementById('saved-configs');
  if (!host || host._dragWired) return;
  host._dragWired = true;
  let fromHandle = false;
  host.addEventListener('mousedown', (e) => { fromHandle = !!(e.target.closest && e.target.closest('.sc-drag')); });
  host.addEventListener('dragstart', (e) => {
    const pill = e.target.closest && e.target.closest('.saved-config-pill');
    if (!pill || !fromHandle) { e.preventDefault(); return; } // only the grip starts a drag
    pill.classList.add('dragging');
    if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', pill.dataset.configId); } catch (_) {} }
  });
  host.addEventListener('dragover', (e) => {
    const list = host.querySelector('.saved-configs-list');
    const dragging = list && list.querySelector('.saved-config-pill.dragging');
    if (!dragging) return;
    e.preventDefault();
    const after = _dragAfterPill(list, e.clientY);
    if (after == null) { if (list.lastElementChild !== dragging) list.appendChild(dragging); }
    else if (after !== dragging) list.insertBefore(dragging, after);
  });
  host.addEventListener('drop', (e) => { if (host.querySelector('.saved-config-pill.dragging')) e.preventDefault(); });
  host.addEventListener('dragend', () => {
    fromHandle = false;
    const list = host.querySelector('.saved-configs-list');
    if (!list) return;
    const dragging = list.querySelector('.saved-config-pill.dragging');
    if (dragging) dragging.classList.remove('dragging');
    reorderSavedConfigs([...list.querySelectorAll('.saved-config-pill')].map(el => el.dataset.configId));
  });
}

// --- custom strategy sidebar -------------------------------------------
const _escHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Normalize a param's choices into [{ value, label }]. Supports an explicit
// options list, a true/false toggle, or a min/max/step range (sampled to ≤24).
function customParamOptions(sp) {
  if (Array.isArray(sp.options) && sp.options.length) {
    return sp.options.map(o => (o && typeof o === 'object')
      ? { value: o.value, label: (o.label != null ? o.label : o.value) }
      : { value: o, label: o });
  }
  if (sp.type === 'bool' || sp.type === 'boolean') {
    return [{ value: true, label: 'Yes' }, { value: false, label: 'No' }];
  }
  if (('min' in sp) || ('max' in sp) || sp.type === 'number') {
    let min = Number(sp.min), max = Number(sp.max), step = Number(sp.step);
    if (!Number.isFinite(min)) min = 0;
    if (!Number.isFinite(max)) max = min + 10;
    if (!Number.isFinite(step) || step <= 0) step = (max - min) / 10 || 1;
    let n = Math.floor((max - min) / step) + 1;
    if (n > 24) { step = (max - min) / 23; n = 24; }
    if (n < 1) n = 1;
    const out = [];
    for (let i = 0; i < n; i++) { const v = +(min + i * step).toFixed(6); out.push({ value: v, label: String(v) }); }
    return out;
  }
  return [{ value: sp.default, label: String(sp.default) }];
}
function customOptionLabel(sp, val) {
  const m = customParamOptions(sp).find(o => String(o.value) === String(val));
  return m ? String(m.label) : String(val);
}
// Each param is a bar-preview dropdown (same look as the 9sig selectors): the
// popup runs the strategy once per option (in the sandbox) and shows each
// option's resulting final value as a proportional bar.
function buildCustomControlsHtml(cfg, schema) {
  if (!schema || !schema.length) return '';
  const rows = schema.map(sp => {
    if (!sp) return '';
    // { section: "Label" } entries (no id) group the params under sub-headers
    // so a long settings list reads in blocks instead of one flat scan.
    if (sp.id == null) return sp.section ? `<div class="custom-param-group">${_escHtml(sp.section)}</div>` : '';
    const label = _escHtml(sp.label || sp.id);
    const curLabel = _escHtml(customOptionLabel(sp, customParamValue(cfg, sp)));
    return `<div class="custom-param-row">
      <label>${label}</label>
      <button type="button" class="pdrop-trigger inline-select cp-trigger" data-cp-cfg="${_escHtml(cfg.id)}" data-cp-id="${_escHtml(sp.id)}">
        <span class="pdrop-trigger-label">${curLabel}</span><span class="pdrop-caret">▾</span>
      </button>
    </div>`;
  }).join('');
  return `<div class="custom-params">${rows}</div>`;
}

// ---- bar-preview popup for a custom param ------------------------------
let _cpOpen = null; // { trigger, popup, cfgId, paramId }
window._customPreviewCache = window._customPreviewCache || {}; // key -> final value

function positionCpPopup(popup, trigger) {
  const r = trigger.getBoundingClientRect();
  const pw = Math.max(r.width, 240);
  let left = r.left;
  if (left + pw > window.innerWidth - 8) left = window.innerWidth - 8 - pw;
  if (left < 8) left = 8;
  popup.style.left = left + 'px';
  popup.style.minWidth = pw + 'px';
  const below = window.innerHeight - r.bottom - 8;
  if (below < 180 && r.top > below) {
    popup.style.top = ''; popup.style.bottom = (window.innerHeight - r.top + 4) + 'px';
    popup.style.maxHeight = Math.min(340, r.top - 8) + 'px';
  } else {
    popup.style.bottom = ''; popup.style.top = (r.bottom + 4) + 'px';
    popup.style.maxHeight = Math.min(340, below) + 'px';
  }
}
function closeCustomParamPopup() {
  if (!_cpOpen) return;
  _cpOpen.popup.remove();
  _cpOpen.trigger.classList.remove('pdrop-open');
  _cpOpen = null;
  document.removeEventListener('mousedown', _cpDocDown, true);
  document.removeEventListener('keydown', _cpKeyDown, true);
  window.removeEventListener('resize', _cpReposition);
  window.removeEventListener('scroll', _cpReposition, true);
}
function _cpReposition() { if (_cpOpen) positionCpPopup(_cpOpen.popup, _cpOpen.trigger); }
function _cpKeyDown(e) { if (e.key === 'Escape') closeCustomParamPopup(); }
function _cpDocDown(e) {
  if (_cpOpen && !_cpOpen.popup.contains(e.target) && e.target !== _cpOpen.trigger && !_cpOpen.trigger.contains(e.target)) closeCustomParamPopup();
}
function openCustomParamPopup(trigger, cfg, sp) {
  if (_cpOpen && _cpOpen.trigger === trigger) { closeCustomParamPopup(); return; }
  closeCustomParamPopup();
  const opts = customParamOptions(sp);
  const cur = customParamValue(cfg, sp);
  const popup = document.createElement('div');
  popup.className = 'pdrop-popup';
  popup.innerHTML = `<div class="pdrop-head">final value if chosen</div>` + opts.map((o, i) =>
    `<div class="pdrop-row${String(o.value) === String(cur) ? ' selected' : ''}" data-cp-i="${i}">
       <span class="pdrop-rlabel">${_escHtml(o.label)}</span>
       <span class="pdrop-track"><span class="pdrop-fill"></span></span>
       <span class="pdrop-rval">…</span>
     </div>`).join('');
  document.body.appendChild(popup);
  let maxW = 0; popup.querySelectorAll('.pdrop-rlabel').forEach(el => { maxW = Math.max(maxW, el.offsetWidth); });
  if (maxW > 0) popup.style.setProperty('--pdrop-label-w', Math.ceil(maxW) + 'px');
  positionCpPopup(popup, trigger);
  trigger.classList.add('pdrop-open');
  _cpOpen = { trigger, popup, cfgId: cfg.id, paramId: sp.id };
  popup.addEventListener('click', (e) => {
    const row = e.target.closest('.pdrop-row'); if (!row) return;
    const i = +row.getAttribute('data-cp-i');
    const o = opts[i]; if (!o) return;
    const c = savedConfigs.find(x => x.id === cfg.id);
    if (c) { c.params = c.params || {}; c.params[sp.id] = (typeof o.value === 'boolean') ? o.value : String(o.value); persistSavedConfigs(); if (typeof render === 'function') render(); }
    closeCustomParamPopup();
  });
  const sel = popup.querySelector('.pdrop-row.selected');
  if (sel) popup.scrollTop = Math.max(0, sel.offsetTop - (popup.clientHeight - sel.offsetHeight) / 2);
  document.addEventListener('mousedown', _cpDocDown, true);
  document.addEventListener('keydown', _cpKeyDown, true);
  window.addEventListener('resize', _cpReposition);
  window.addEventListener('scroll', _cpReposition, true);
  computeCustomParamBars(cfg, sp, opts, popup);
}
// Run the strategy once per option (in the sandbox) and draw the bars.
function computeCustomParamBars(cfg, sp, opts, popup) {
  const ctx = window._customCtx;
  if (!ctx || !cfg.code) return;
  const globals = computeCustomGlobals(cfg, ctx);
  clearCustomPreviewQueue(); // a previously-open dropdown's pending sweep is dead weight now
  const finals = new Array(opts.length).fill(null);
  // The runs are queued through one worker, so a 40-option sweep trickles in —
  // redraw on every result instead of waiting for the last one.
  const draw = () => { if (_cpOpen && _cpOpen.popup === popup) cpFillBars(popup, finals); };
  opts.forEach((o, i) => {
    const overrides = {}; overrides[sp.id] = (typeof o.value === 'boolean') ? o.value : String(o.value);
    const merged = Object.assign({}, cfg.params || {}, overrides);
    // globals.contributions/entryDate/exitDate (the transaction schedule and
    // its exact-date bounds) previously weren't part of this key — the same
    // staleness bug as customSig() above, just for the per-option bar preview
    // instead of the live line: editing transactions without also moving
    // startIdx/endIdx/initial/monthly/annualRaise left old bars on screen.
    const contribKey = globals.contributions ? JSON.stringify(globals.contributions) : '';
    const key = [cfg.code, JSON.stringify(merged), globals.startIdx, globals.endIdx, globals.initial, globals.monthly, globals.annualRaise,
      globals.entryDate || '', globals.exitDate || '', contribKey, globals.weeklyDisplay ? 1 : 0].join('|');
    const cached = window._customPreviewCache[key];
    if (cached != null) { finals[i] = cached; draw(); return; }
    runCustomPreview(cfg, overrides, globals, (msg) => {
      let fv = 0;
      if (msg && msg.log && msg.log.length) {
        for (let k = msg.log.length - 1; k >= 0; k--) { const v = msg.log[k].value; if (typeof v === 'number' && isFinite(v)) { fv = v; break; } }
      }
      window._customPreviewCache[key] = fv;
      finals[i] = fv;
      draw();
    });
  });
  draw();
}
function cpFillBars(popup, finals) {
  const rows = Array.from(popup.querySelectorAll('.pdrop-row'));
  const maxT = Math.max(0, ...finals.map(f => f || 0));
  // Crown a winner only once every option is back — mid-sweep the leader keeps
  // changing, and a jumping highlight reads as a glitch.
  const complete = finals.every(f => f != null);
  const bestIdx = finals.indexOf(maxT);
  rows.forEach((row, i) => {
    const t = finals[i];
    const pct = (maxT > 0 && t != null) ? Math.max(1.5, (t / maxT) * 100) : 0;
    const fill = row.querySelector('.pdrop-fill'); const val = row.querySelector('.pdrop-rval');
    if (fill) fill.style.width = pct + '%';
    if (val) val.textContent = (t == null) ? '…' : ((typeof fmt === 'function') ? fmt(Math.round(t)) : String(Math.round(t)));
    row.classList.toggle('best', complete && i === bestIdx && maxT > 0);
  });
}

// Built-in header labels + tooltips for the log keys the build prompt asks a
// strategy to write. Following the contract therefore buys an SMA-quality
// table for free; the strategy's own `columns` metadata overrides any of these
// and supplies the labels/tips for whatever extra keys it invented.
const CUSTOM_LOG_COLS = {
  date:          { label: 'Date', tip: "The trading day this row happened on.&#10;&#10;The log only lists days the strategy logged something — trades, contributions and its periodic snapshots." },
  action:        { label: 'Action', tip: "What the strategy did on this day — buy, sell, switch (one fund straight into another), rebalance, an ease-in slice of a phased buy, a monthly contribution, or a plain hold snapshot.&#10;&#10;Rows that trade are drawn as a symbol on the chart line; hover the row to light it up.&#10;&#10;The (%) in brackets is the gain or loss since the PREVIOUS row, with any contribution on this row removed — so it's the holding's own return." },
  note:          { label: 'Note', tip: "The strategy's own comment on this row — usually why the rule fired." },
  held:          { label: 'Holding', tip: "What you owned right after this row. CASH means sitting out of the market." },
  price:         { label: 'Price', tip: "Closing price of the asset in the Holding column that day. Blank on cash rows. Price × Shares equals Holdings." },
  shares:        { label: 'Shares', tip: "How many shares of the held asset you owned after this row. 0 when fully in cash." },
  holdingsValue: { label: 'Holdings', tip: "Dollar value of everything you hold that isn't cash." },
  stockVal:      { label: 'Holdings', tip: "Dollar value of everything you hold that isn't cash." },
  cash:          { label: 'Cash', tip: "Dollars sitting in cash after this row, waiting to be put back to work." },
  value:         { label: 'Total', tip: "Your entire portfolio that day: holdings + cash. This is the number the strategy's line plots on the chart." },
  invested:      { label: 'Invested', tip: "Total money you had put in by this date — the starting amount plus every contribution so far.&#10;&#10;Total minus Invested is your profit." },
  contributed:   { label: 'New $', tip: "New cash added on this row. Blank when nothing went in." },
  fee:           { label: 'Fee', tip: "Trading cost paid on this row's trade, if the strategy models one." },
};
// Left-to-right column order for the known keys; anything else follows in
// first-seen order.
const CUSTOM_LOG_ORDER = ['date', 'action', 'note', 'held', 'price', 'shares',
  'holdingsValue', 'stockVal', 'cash', 'value', 'invested', 'contributed', 'fee'];

// "Hide monthly contributions" / "Hide ease-in slices" for a custom strategy's
// log — same pair the SMA log has. Flips a class on the table wrap (CSS drops
// the rows), so there's no re-render, and the state sticks across re-renders.
let _customLogHideContrib = false, _customLogHideEase = false;
function toggleCustomLogContrib(hide) {
  _customLogHideContrib = !!hide;
  const body = document.getElementById('strategy-panel-body');
  if (body) body.querySelectorAll('.custom-log-wrap').forEach(w => w.classList.toggle('hide-contrib', _customLogHideContrib));
}
function toggleCustomLogEase(hide) {
  _customLogHideEase = !!hide;
  const body = document.getElementById('strategy-panel-body');
  if (body) body.querySelectorAll('.custom-log-wrap').forEach(w => w.classList.toggle('hide-dca', _customLogHideEase));
}

// Format one cell by key name: "price" → a price, "share"/"unit"/"qty" → a share
// count, "pct"/"percent" → a percentage, anything else numeric → dollars. The
// build prompt spells this rule out, so strategies name their keys for it.
function fmtCustomLogCell(k, v) {
  if (v == null || v === '') return '';
  const lk = String(k).toLowerCase();
  if (lk === 'date') return (typeof fmtLogDate === 'function') ? fmtLogDate(String(v)) : _escHtml(v);
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return '—';
    // Price-like keys keep per-share precision — that covers the indicator
    // levels a strategy logs alongside the price it compared them against.
    if (/price|sma|ema|median|avg|mean/.test(lk)) return v > 0 ? ((typeof fmtLogPrice === 'function') ? fmtLogPrice(v) : '$' + v.toFixed(2)) : '—';
    if (lk.includes('share') || lk.includes('unit') || lk.includes('qty')) return (typeof fmtLogShares === 'function') ? fmtLogShares(v) : String(+v.toFixed(2));
    if (lk.includes('pct') || lk.includes('percent')) return (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(1) + '%';
    if ((lk.includes('contrib') || lk.includes('deposit') || lk === 'fee') && v === 0) return '';
    return (typeof fmtFull === 'function') ? fmtFull(Math.round(v)) : String(Math.round(v));
  }
  return _escHtml(v);
}

// The strategy's own log, as a table that reads like the SMA one: numbered
// rows, a tooltip on every column header, colour-coded actions with the gain
// since the previous row, checkboxes to collapse contribution / ease-in rows,
// and trade rows wired to their chart marker (data-mkey, handled in chart.js).
function buildCustomLogTableHtml(log, columns) {
  if (!log || !log.length) return '';
  // Column metadata: built-ins, overridden by whatever the strategy declared.
  const meta = {};
  for (const k in CUSTOM_LOG_COLS) meta[k] = CUSTOM_LOG_COLS[k];
  const declaredOrder = [];
  for (const c of (columns || [])) {
    if (!c || !c.key) continue;
    const base = meta[c.key] || {};
    meta[c.key] = { label: c.label || base.label || null, tip: c.tip || base.tip || null };
    declaredOrder.push(c.key);
  }
  // Keys actually present, ordered: known keys first (fixed order), then the
  // ones the strategy declared, then anything else in first-seen order.
  const present = [];
  const seen = new Set();
  for (const row of log) { if (!row) continue; for (const k of Object.keys(row)) if (!seen.has(k)) { seen.add(k); present.push(k); } }
  const rank = (k) => {
    const i = CUSTOM_LOG_ORDER.indexOf(k);
    if (i >= 0) return i;
    const j = declaredOrder.indexOf(k);
    return j >= 0 ? 100 + j : 200 + present.indexOf(k);
  };
  const keys = present.slice().sort((a, b) => rank(a) - rank(b));

  // Header for a key the strategy didn't label: split camelCase into words and
  // shout the indicator acronyms, so "signalSma" reads "Signal SMA".
  const ACRONYMS = { sma: 'SMA', ema: 'EMA', rsi: 'RSI', atr: 'ATR', macd: 'MACD', dd: 'DD', pct: '%', qqq: 'QQQ', spy: 'SPY', tqqq: 'TQQQ' };
  const titleOf = (k) => (meta[k] && meta[k].label) || k
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[\s_]+/)
    .map(w => ACRONYMS[w.toLowerCase()] || (w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
  const tipOf = (k) => {
    const t = meta[k] && meta[k].tip;
    return t ? _escHtml(String(t)).replace(/\n/g, '&#10;') : null;
  };
  const th = (label, tip) => `<th>${_escHtml(label)}${tip ? ` <span class="info-icon" tabindex="0" data-tip="${tip}">ⓘ</span>` : ''}</th>`;
  const head = th('#', "Row number — the first logged row is 0, then each row counts up, so the last number is how many events the strategy recorded over this window.")
    + keys.map(k => th(titleOf(k), tipOf(k))).join('');

  const kindOf = (r) => (typeof customActionKind === 'function') ? customActionKind(r && r.action) : 'hold';
  const ACT_CLASS = { buy: 'action-buy', sell: 'action-sell', switch: 'action-switch', rebalance: 'action-rebal',
                      ease: 'action-buy', contribution: 'action-hold', start: 'action-hold', end: 'action-hold', hold: 'action-hold' };
  let contribCount = 0, easeCount = 0;
  const body = log.map((row, i) => {
    const kind = kindOf(row);
    if (kind === 'contribution') contribCount++;
    if (kind === 'ease') easeCount++;
    const hasMarker = !!(typeof CUSTOM_EVENT_STYLE !== 'undefined' && CUSTOM_EVENT_STYLE[kind] && +((row || {}).value) > 0);
    const cls = hasMarker ? 'log-row-mk' : kind === 'contribution' ? 'log-row-contrib' : kind === 'ease' ? 'log-row-dca' : '';
    const trAttr = (cls ? ` class="${cls}"` : '') + (hasMarker ? ` data-mkey="${i}"` : '');
    const cells = keys.map(k => {
      if (k !== 'action') return `<td>${fmtCustomLogCell(k, row ? row[k] : null)}</td>`;
      // Action cell: the strategy's own label, coloured by kind, with the gain
      // since the previous row — the same treatment the SMA log gives it.
      const label = (typeof customActionLabel === 'function') ? customActionLabel(row && row.action) : _escHtml((row && row.action) || '');
      const gain = (typeof customLogGain === 'function') ? customLogGain(log, i) : null;
      const gainCell = gain == null ? '' :
        ` <span class="${gain >= 0 ? 'action-buy' : 'action-sell'}">(${gain >= 0 ? '+' : '−'}${Math.abs(gain).toFixed(1)}%)</span>`;
      return `<td class="${ACT_CLASS[kind] || 'action-hold'}">${_escHtml(label)}${gainCell}</td>`;
    }).join('');
    return `<tr${trAttr}><td>${i}</td>${cells}</tr>`;
  }).join('');

  // Share of calendar time spent in each holding, weighted by the gap between
  // rows (the holding is constant between two rows).
  let holdSummary = '';
  if (keys.includes('held')) {
    const holdMs = {}; let holdTot = 0;
    for (let i = 0; i < log.length - 1; i++) {
      const a = String((log[i] && log[i].held) || '').toUpperCase();
      if (!a) continue;
      const dt = Date.parse(log[i + 1].date) - Date.parse(log[i].date);
      if (dt > 0) { holdMs[a] = (holdMs[a] || 0) + dt; holdTot += dt; }
    }
    const chips = holdTot > 0 ? Object.entries(holdMs).sort((a, b) => b[1] - a[1]).map(([a, ms]) => {
      const yrs = ms / 31557600000; // 365.25 d
      return `<span style="margin-right:16px;white-space:nowrap"><b style="color:var(--text)">${_escHtml(a)}</b> ${(ms / holdTot * 100).toFixed(1)}% <span style="opacity:.55">(${yrs >= 1 ? yrs.toFixed(1) + 'y' : Math.round(yrs * 12) + 'mo'})</span></span>`;
    }).join('') : '';
    if (chips) holdSummary = `<div style="font-size:12px;color:var(--text-muted);margin-top:10px"><span style="font-weight:600;color:var(--text);margin-right:8px">Time in each holding:</span>${chips}</div>`;
  }

  const contribToggle = contribCount > 0 ? `
    <label class="log-contrib-toggle">
      <input type="checkbox" onchange="toggleCustomLogContrib(this.checked)" ${_customLogHideContrib ? 'checked' : ''}>
      Hide monthly contributions (${contribCount})
    </label>` : '';
  const easeToggle = easeCount > 0 ? `
    <label class="log-contrib-toggle">
      <input type="checkbox" onchange="toggleCustomLogEase(this.checked)" ${_customLogHideEase ? 'checked' : ''}>
      Hide ease-in slices (${easeCount})
    </label>` : '';
  const wrapCls = 'custom-log-wrap' + (_customLogHideContrib ? ' hide-contrib' : '') + (_customLogHideEase ? ' hide-dca' : '');
  return `
    <div class="log-section">
    ${logSectionHeaderHtml(`Transaction Log (${log.length} rows)`, 18)}
    <div style="display:flex;gap:16px;flex-wrap:wrap">${contribToggle}${easeToggle}</div>
    <div class="${wrapCls}"><table class="custom-log"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>
    ${holdSummary}
    </div>`;
}

// Sidebar for a custom strategy — focuses on the RESULT (settings + an Edit
// button that reopens the build modal). The describe/prompt/paste flow lives in
// the modal, not here.
// Live signal dashboard for a CUSTOM strategy — the same cards + "Right now"
// block the SMA panel shows, but driven by whatever the strategy reported in
// its run() return (`signals`). Reuses statCard/.signal-decision from chart.js
// so both panels stay visually identical for free.
// tone → colour class: 'good'/'positive' green, 'bad'/'negative' red, else neutral.
function buildCustomSignalMetricsHtml(signals, asOfDate) {
  if (!signals) return '';
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const toneCls = (t) => {
    const v = String(t || '').toLowerCase();
    if (v === 'good' || v === 'positive' || v === 'up') return 'positive';
    if (v === 'bad' || v === 'negative' || v === 'down' || v === 'warn') return 'negative';
    return '';
  };
  const ICONS = { trendUp: 1, trendDown: 1, dollar: 1, flag: 1, clock: 1, sliders: 1, activity: 1, shield: 1 };
  let html = '';

  const cards = (signals.cards || []).filter(c => c && c.label);
  if (cards.length && typeof statCard === 'function') {
    const asOf = signals.asOf || asOfDate;
    // Same fetch timestamp the header's "Data last fetched" stamp uses (see
    // js/init.js), just the HH:MM part — the trading-day date already comes
    // from the strategy's own log, so only the time is worth adding here.
    const timeStr = (window._dataFetchedAt && typeof fmtTimeHHMM === 'function')
      ? ', ' + fmtTimeHHMM(window._dataFetchedAt) : '';
    const stamp = asOf
      ? ` <span style="font-weight:400;text-transform:none;letter-spacing:0;color:var(--text-muted)">· as of ${esc(
          (typeof fmtLogDate === 'function') ? fmtLogDate(asOf) : asOf)}${timeStr}</span>`
      : '';
    const body = cards.map(c => statCard(
      esc(c.label),
      ICONS[c.icon] ? c.icon : 'activity',
      esc(c.value != null ? c.value : '—'),
      toneCls(c.tone),
      c.sub ? esc(c.sub) : '',
      c.tip ? esc(c.tip) : '',
      c.delta && c.delta.text ? { text: esc(c.delta.text), tone: toneCls(c.delta.tone) } : null
    )).join('');
    html += `<div class="strategy-panel-section-label" style="margin-top:24px">Signal metrics${stamp}</div>
      <div class="strategy-stats">${body}</div>`;
  }

  const d = signals.decision;
  if (d && (d.action || (d.reasons && d.reasons.length))) {
    const cls = toneCls(d.tone) === 'positive' ? 'buy'
              : toneCls(d.tone) === 'negative' ? 'cash' : 'hold';
    const rows = (d.reasons || []).filter(r => r && r.name).map(r => {
      const lean = ['buy', 'out', 'cash', 'hold'].includes(String(r.lean || '').toLowerCase())
        ? String(r.lean).toLowerCase() : 'hold';
      return `<div class="sd-sig sd-lean-${lean}"><span class="sd-dot"></span>` +
             `<span class="sd-sig-name">${esc(r.name)}</span>` +
             `<span class="sd-sig-val">${esc(r.val || '')}</span>` +
             `<span class="sd-sig-tag">${esc(r.tag || '')}</span></div>`;
    }).join('');
    html += `
      <div class="strategy-panel-section-label" style="margin-top:22px">Right now</div>
      <div class="signal-decision">
        <div class="sd-hero sd-${cls}">
          <span class="sd-hero-lead">Lump sum today</span>
          <span class="sd-hero-action">${esc(d.action || '—')}</span>
          ${d.note ? `<span class="sd-hero-note">${esc(d.note)}</span>` : ''}
        </div>
        ${rows ? `<div class="sd-signals">${rows}</div>` : ''}
      </div>`;
  }
  return html;
}

function renderCustomPanelBody(cfgId) {
  const body = document.getElementById('strategy-panel-body');
  if (!body) return;
  const cfg = savedConfigs.find(c => c.id === cfgId);
  if (!cfg) return;
  // A base panel may have injected its live controls (e.g. the 9sig knobs) into
  // the body. Move them back to their hidden host BEFORE we overwrite innerHTML —
  // otherwise they're destroyed, and render() then reads null and falls back to
  // wrong defaults, so the main 9sig line stops resetting correctly.
  if (typeof detachLiveControls === 'function') detachLiveControls();
  const _scrollTop = body.scrollTop;
  const err = (window._customErrors || {})[cfgId];

  let html = '';

  html += `<div class="wip-note">⚠ Custom strategies are a work in progress — their results may still change.</div>`;
  // Line-colour picker. The whole picker chain (currentLineColor / activeLineColor /
  // currentDatasetBorderColor / commitLineColor) already keys off
  // window._editingConfigId, which openCustomPanel sets — so a custom strategy
  // needs nothing beyond rendering the control here, and its choice persists to
  // cfg.color like any saved strategy's.
  if (typeof buildColorPickerHtml === 'function') html += buildColorPickerHtml(cfg.type);
  html += `<div class="custom-tickers-note">Your strategy can read these tickers: <code>tqqq</code>, <code>qld</code>, <code>qqq</code>, <code>spy</code>, <code>sso</code>, <code>spxl</code>, <code>sqqq</code> (daily closes). Base your rules on any of them.</div>`;
  html += `<button type="button" id="custom-edit-builder" class="custom-edit-btn">Edit strategy</button>`;
  if (cfg.desc) html += `<div class="custom-desc-readout">${_escHtml(cfg.desc)}</div>`;
  if (err) html += `<div class="custom-error"><b>Couldn't run it:</b> ${_escHtml(err)} <span class="custom-error-hint">— click Edit strategy to fix the code.</span></div>`;

  // CAGR / Max DD / End (when the strategy ran successfully).
  const m = (window._configMetrics || {})[cfgId];
  if (!err && m && Number.isFinite(m.cagr)) {
    const cagrCls = m.cagr >= 0 ? 'positive' : 'negative';
    const ddStr = Number.isFinite(m.maxDD) ? fmtDD(m.maxDD) : '—';
    const ddRange = (typeof fmtDDRange === 'function') ? fmtDDRange(m.ddPeak, m.ddTrough) : '';
    const ddRangeHtml = ddRange ? `<div class="custom-stat-range">${ddRange}</div>` : '';
    html += `
      <div class="custom-stats">
        <div class="custom-stat"><span>CAGR</span><b class="${cagrCls}">${m.cagr >= 0 ? '+' : ''}${m.cagr.toFixed(1)}%</b></div>
        <div class="custom-stat"><span>Max DD</span><b class="negative">${ddStr}</b>${ddRangeHtml}</div>
        <div class="custom-stat"><span>End</span><b>${(typeof fmtFull === 'function') ? fmtFull(m.end || 0) : Math.round(m.end || 0)}</b></div>
      </div>`;
  }

  // Generated controls from the strategy's `params` (what it declared configurable).
  // Each change is passed back into run() as p.<id>.
  const controls = buildCustomControlsHtml(cfg, getCustomSchema(cfg));
  if (controls) html += `<div class="strategy-panel-section-label" style="margin-top:14px">Settings</div>${controls}`;

  // The signal mini chart: the lines the strategy declares (`lines:` in its
  // code) drawn on their own scale in the panel, with per-line eye chips.
  const auxLines = (window._customLines || {})[cfgId] || null;
  if (auxLines && auxLines.length) {
    const auxLog = (window._customLogs || {})[cfgId] || [];
    html += `<div class="strategy-panel-section-label" style="margin-top:14px">Signal chart</div>
      <div class="legend-chip-group">${buildCustomLineChipsHtml(cfg, auxLines)}</div>
      ${buildCustomLinesChartHtml(cfg, auxLines, auxLog, body.clientWidth)}`;
  }

  // Live signal dashboard (whatever the strategy reported in `signals`), then
  // its own log — with the column labels/tooltips it declared in `columns`.
  const _cLog = (window._customLogs || {})[cfgId] || [];
  html += buildCustomSignalMetricsHtml((window._customSignals || {})[cfgId] || null,
                                       _cLog.length ? _cLog[_cLog.length - 1].date : null);
  html += buildCustomLogTableHtml(_cLog, (window._customColumns || {})[cfgId] || null);

  body.innerHTML = html;
  body.scrollTop = _scrollTop;
  // Width changes (open transition, drag-resize) re-render the signal chart
  // so its text descale always matches the real width — see _miniChartResizeObs.
  if (_miniChartResizeObs && !body._miniObserved) {
    _miniChartResizeObs.observe(body);
    body._miniObserved = true;
  }
}

// --- styled delete confirmation (replaces the native confirm()) --------
function showDeleteDialog(cfg) {
  closeDeleteDialog();
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const overlay = document.createElement('div');
  overlay.className = 'sc-modal-overlay';
  overlay.id = 'sc-delete-modal';
  overlay._configId = cfg.id;
  overlay.innerHTML = `
    <div class="sc-modal" role="dialog" aria-modal="true" aria-labelledby="sc-modal-title">
      <div class="sc-modal-title" id="sc-modal-title">Delete strategy</div>
      <div class="sc-modal-body">Delete “<b>${esc(cfg.name)}</b>”? This can’t be undone.</div>
      <div class="sc-modal-actions">
        <button type="button" class="sc-modal-btn" data-sc-cancel>Cancel</button>
        <button type="button" class="sc-modal-btn danger" data-sc-confirm>Delete</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const cancel = overlay.querySelector('[data-sc-cancel]');
  if (cancel) cancel.focus();
}
function closeDeleteDialog() {
  const m = document.getElementById('sc-delete-modal');
  if (m) m.remove();
}

// --- styled unsaved-changes confirmation (panel close with dirty knobs) -
function showUnsavedDialog(type, onSave, onDiscard) {
  closeUnsavedDialog();
  const label = (typeof genBaseName === 'function') ? genBaseName(type) : type;
  const overlay = document.createElement('div');
  overlay.className = 'sc-modal-overlay';
  overlay.id = 'sc-unsaved-modal';
  overlay.innerHTML = `
    <div class="sc-modal" role="dialog" aria-modal="true" aria-labelledby="sc-unsaved-title">
      <div class="sc-modal-title" id="sc-unsaved-title">Save changes?</div>
      <div class="sc-modal-body">You’ve edited the <b>${label}</b> strategy. The base strategy doesn’t persist edits — closing will reset it to defaults. Save your changes as a new strategy first?</div>
      <div class="sc-modal-actions">
        <button type="button" class="sc-modal-btn" data-sc-unsaved-discard>Close</button>
        <button type="button" class="sc-modal-btn primary" data-sc-unsaved-save>Save</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('[data-sc-unsaved-save]').addEventListener('click', () => { closeUnsavedDialog(); if (onSave) onSave(); });
  overlay.querySelector('[data-sc-unsaved-discard]').addEventListener('click', () => { closeUnsavedDialog(); if (onDiscard) onDiscard(); });
  const save = overlay.querySelector('[data-sc-unsaved-save]');
  if (save) save.focus();
}
function closeUnsavedDialog() {
  const m = document.getElementById('sc-unsaved-modal');
  if (m) m.remove();
}

// Esc closes the dialog. Capture phase + stopImmediatePropagation so it wins
// over the strategy-panel's own Esc handler.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (document.getElementById('sc-delete-modal')) { e.stopImmediatePropagation(); closeDeleteDialog(); return; }
  if (document.getElementById('sc-unsaved-modal')) { e.stopImmediatePropagation(); closeUnsavedDialog(); return; }
  if (document.getElementById('custom-builder-modal')) { e.stopImmediatePropagation(); closeCustomBuilder(true); return; }
}, true);

// --- delegated event handling ------------------------------------------
// Hex field in the custom colour popup → live preview when it's a valid colour.
document.addEventListener('input', (e) => {
  if (e.target && e.target.id === 'lc-hex') {
    const h = normHex(e.target.value);
    if (h) { applyColorPreview(h); setColorUI(h); }
  }
});


document.addEventListener('click', (e) => {
  const tgt = e.target;
  if (!tgt || !tgt.closest) return;
  // "Save shared strategies" banner — persists the share-link strategies that
  // are currently transient (rendering on the chart but not in localStorage).
  if (tgt.closest('#save-shared-strategies')) { saveSharedStrategies(); return; }
  // Sub-series chip for a saved 9sig → toggle that strategy's own Holding/Target/
  // Cash line (persisted on the config, so it never flips to the canonical base).
  const subChip = tgt.closest('.cfg-sub-chip');
  if (subChip) {
    const cfg = savedConfigs.find(c => c.id === subChip.getAttribute('data-config-id'));
    const key = subChip.getAttribute('data-config-sub');
    if (cfg && key) {
      cfg.subShown = cfg.subShown || {};
      // Flip from the chip's RENDERED state, not the stored flag — an unset
      // key defaults differently per chip kind (9sig lines start hidden, a
      // custom signal chart starts shown), and the chip already knows which.
      cfg.subShown[key] = subChip.classList.contains('legend-hidden');
      persistSavedConfigs();
      if (typeof render === 'function') render();
    }
    return;
  }
  // Delete-confirmation modal.
  if (tgt.closest('[data-sc-confirm]')) {
    const m = document.getElementById('sc-delete-modal');
    const id = m && m._configId;
    closeDeleteDialog();
    if (id) deleteConfig(id);
    return;
  }
  if (tgt.closest('[data-sc-cancel]')) { closeDeleteDialog(); return; }
  if (tgt.closest('#sc-delete-modal')) { if (!tgt.closest('.sc-modal')) closeDeleteDialog(); return; }
  // Custom line-color popup. Picking a swatch applies it immediately and closes
  // the popup; the hex field still previews live and commits via OK.
  const pop = document.getElementById('line-color-pop');
  const popOpen = pop && !pop.hidden;
  if (tgt.closest('#line-color-trigger')) { popOpen ? closeColorPopup(true) : openColorPopup(); return; }
  if (popOpen) {
    const sw = tgt.closest('#line-color-pop .lc-swatch');
    if (sw) { const c = sw.dataset.color; closeColorPopup(false); commitLineColor(c); return; }
    if (tgt.closest('#lc-ok')) {
      const inp = document.getElementById('lc-hex');
      const hex = normHex(inp && inp.value) || _colorPickerOriginal || activeLineColor();
      closeColorPopup(false);
      commitLineColor(hex);
      return;
    }
    if (tgt.closest('#line-color-pop')) return; // click inside popup (hex field, etc.)
    closeColorPopup(true); // click anywhere outside → cancel + revert
    return;
  }
  // Bar-preview dropdown for a custom param.
  const cpTrig = tgt.closest('.cp-trigger');
  if (cpTrig) {
    const cfg = savedConfigs.find(c => c.id === cpTrig.getAttribute('data-cp-cfg'));
    const sp = cfg && getCustomSchema(cfg).find(s => s && String(s.id) === cpTrig.getAttribute('data-cp-id'));
    if (cfg && sp) openCustomParamPopup(cpTrig, cfg, sp);
    return;
  }
  // New custom strategy → open the build modal.
  if (tgt.closest('#new-custom-strategy')) { createCustomStrategy(); return; }
  // Sidebar "Edit strategy" → reopen the build modal for the open custom strategy.
  if (tgt.closest('#custom-edit-builder')) {
    if (window._editingConfigId) openCustomBuilder(window._editingConfigId, false);
    return;
  }
  // Build modal: cancel / complete / back / copy prompt / apply.
  if (tgt.closest('[data-builder-cancel]')) { closeCustomBuilder(true); return; }
  if (tgt.closest('[data-builder-complete]')) {
    const cfg = savedConfigs.find(c => c.id === _builderId);
    const d = document.getElementById('builder-desc');
    if (cfg) { cfg.desc = d ? d.value : ''; persistSavedConfigs(); }
    _builderPhase = 'generate';
    renderCustomBuilder();
    return;
  }
  if (tgt.closest('[data-builder-back]')) {
    const cfg = savedConfigs.find(c => c.id === _builderId);
    const c = document.getElementById('builder-code');
    if (cfg && c) { cfg.code = c.value; persistSavedConfigs(); } // keep the draft
    _builderPhase = 'describe';
    renderCustomBuilder();
    return;
  }
  const bCopy = tgt.closest('[data-builder-copy]');
  if (bCopy) {
    const cfg = savedConfigs.find(c => c.id === _builderId);
    const promptText = buildCustomPrompt(cfg ? cfg.desc : '');
    const done = () => {
      bCopy.textContent = 'Copied ✓ — paste into ChatGPT / Claude';
      bCopy.classList.add('flash-success');
      setTimeout(() => { if (bCopy.isConnected) { bCopy.textContent = 'Copy prompt for ChatGPT / Claude'; bCopy.classList.remove('flash-success'); } }, 2400);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(promptText).then(done).catch(() => window.prompt('Copy this prompt:', promptText));
    else window.prompt('Copy this prompt:', promptText);
    return;
  }
  if (tgt.closest('[data-builder-apply]')) {
    const cfg = savedConfigs.find(c => c.id === _builderId);
    const c = document.getElementById('builder-code');
    if (!cfg || !c) return;
    cfg.code = c.value;
    persistSavedConfigs();
    const id = cfg.id;
    closeCustomBuilder(false);
    if (typeof render === 'function') render();                      // schedules the sandboxed run
    if (typeof openCustomPanel === 'function') openCustomPanel(id);  // sidebar shows the line/log (or an error) when it returns
    return;
  }

  // In-sidebar save bar.
  const savenew = e.target.closest('[data-sc-savenew]');
  if (savenew) { saveConfigFromType(savenew.getAttribute('data-sc-savenew')); return; }

  // Parameters-panel config pills.
  const pill = e.target.closest('.saved-config-pill');
  if (!pill) return;
  const id = pill.dataset.configId;
  if (e.target.closest('.sc-drag'))   return; // drag handle: reorder only, never toggle
  if (e.target.closest('.sc-edit'))   { openConfigForEdit(id); return; }
  if (e.target.closest('.sc-delete')) {
    const cfg = savedConfigs.find(c => c.id === id);
    if (cfg) showDeleteDialog(cfg);
    return;
  }
  // Like the top legend chips: clicking anywhere else on the pill — including
  // the name — toggles the line's visibility. Names are auto-derived from the
  // strategy's parameters, so there's nothing to rename.
  toggleConfigVisibility(id);
});
