// js/signal-chart.js — the signal chart: a strategy's declared lines on their
// own scale, a panel per group of lines (MINI_PANEL), with its trades, plus
// every interaction on it (hover readout,
// trade-band hover, ⌘/Ctrl + scroll zoom, ⌘/Ctrl + drag pan, plain-drag range
// readout, Reset and Latest). It draws whatever rows its host hands it and
// redraws through the host (setMiniChartHost): the strategy panel in
// js/saved-configs.js, and the desktop widget page (widget.html,
// js/widget-page.js). Formatting, colour and trade-marker helpers come from
// js/utils.js and js/chart.js; _escHtml from js/saved-configs.js.

// Where the charts are drawn. The page showing them registers a function that
// redraws one in place (by its cfg id) from its own rows, width and zoom, or
// every one when called without an id. A page may show several charts: each
// keeps its own hover data (window._miniCharts) and zoom (window._miniZooms).
let _miniChartHost = null;
function setMiniChartHost(redraw) { _miniChartHost = redraw; }
function _miniChartRerender(cfgId) { if (_miniChartHost) _miniChartHost(cfgId); }
window._miniCharts = window._miniCharts || {};   // cfg id → what the handlers need to read that chart
// The chart an event happened on, by the id its svg carries.
function _miniDataOf(svg) {
  const id = svg && svg.getAttribute('data-mini-id');
  return id != null ? (window._miniCharts[id] || null) : null;
}

// Whether a custom signal line is currently shown (unset = shown).
function customLineShown(cfg, key) { return ((cfg.subShown || {})[key]) !== false; }

// The signal mini chart: the strategy's declared lines drawn in the sidebar
// panel on their own scale. These are price-scale values ($50–$80) that would
// be squashed unreadably under six-figure portfolio lines on the main chart —
// here they get a log y-axis of their own, so a constant-% trigger renders as
// a constant vertical gap and the crossings the rules fire on are visible.
// Fixed viewBox, shared with the hover handlers below so the crosshair math
// matches the drawing exactly. The SVG scales with the panel (lines grow
// proportionally); text sizes and the margins around the plot are divided by
// the render scale, so labels keep their pixel size and the date axis stays
// the same few pixels under the plot — up to MINI_TEXT_REF_W; on a wider
// panel they grow with the square root of the extra width, since 9px labels
// read as specks on a plot three times the size. The rows come from
// the daily detail run (customDetailLog in js/saved-configs.js) and are decimated to the pixel
// budget of the current window, so zooming in draws more of the days until
// every one is on screen.
const MINI_CHART = { W: 320, H: 148, padL: 6 };
// Lines measured on different things (two funds' prices, a lead in percent, a
// stress index) can name a group: each group draws as its own panel, with its
// own scale, unit and gutter labels, stacked on the one time axis in the order
// the groups first appear. Lines without a group form the first panel. A
// panel's height follows its line count: the first panel is full height; a
// later one with a reading and one or two levels (up to three lines, such as
// NFCI and its veto, or Turnaround Monday's close against the prior day's high
// and low) is minShare of a full panel, and one with more lines full (fullAt).
// The gap between two panels is in px, divided by the render scale, with a
// divider `rule` px under the panel above; addH is the viewBox height a full
// panel after the first adds to the side panel's chart, a smaller one its
// share of it (a chart given an aspect keeps its height and shares it out).
const MINI_PANEL = { gap: 16, rule: 3, addH: 67, fullAt: 4, minShare: 0.25 };
// Drawn points per pixel of plot width before a window is decimated.
const MINI_POINTS_PER_PX = 2;
// Pixel sizes, divided by the render scale when used: the trade strip above
// the plot (the event hover lives there, apart from the value hover on the
// plot), the room under the plot for the date labels, and the baseline gap
// between plot and labels.
const MINI_PX = { strip: 12, axis: 14, labelGap: 10, edge: 4 };   // edge: above a plot with no strip
// Chart width (px) up to which text keeps its px size; the panel's default
// width. Beyond it text scales by sqrt(width / this): 1.6× at 1000px.
const MINI_TEXT_REF_W = 400;
// Trade-event areas, in viewBox units: each band's half width, the gap under
// which neighbouring trades merge into one band (two bands closer than this
// would overlap and hide each other), the widest a merged band may grow
// before the next trade starts a new one (on a long view, trades weeks apart
// would otherwise chain into one band covering months), how far outside a
// band the hover still counts as on it, how many trades a hover lists, and
// the widest window (two years) that still shows a mark at each trade's
// crossing — on a longer view the bands say enough and the marks would only
// speckle the lines.
const MINI_EVENT = { halfW: 1.2, mergeX: 4, maxSpanX: 10, hoverPad: 1.5, maxListed: 8, marksWithinMs: 2 * 365.25 * 86400000 };
// Marks at the trade crossings: the main chart's symbol and colour per action
// (CUSTOM_EVENT_STYLE: buy circle, sell hexagon, switch diamond) inside a
// light ring per asset — the asset sold on a sell, the one bought otherwise —
// so "sell TQQQ" and "buy SQQQ" read apart without a dark stroke; SQQQ, the
// one inverse fund, gets a dashed ring. Sizes in px, divided by k when drawn;
// hitPad is how far outside a mark the hover still counts as on it.
const MINI_MARK = { r: 2.6, ring: 1.2, hitPad: 4 };
const MINI_ASSET_RING = { tqqq: '#9cc0ff', qqq: '#ffcf8a', spy: '#dcb3ff', qld: '#8fe1ef', sso: '#ffb0d9', spxl: '#dcc0a0', sqqq: '#c4c4d4', cash: '#e3e3ec' };
const MINI_ASSET_DASHED = { sqqq: true };
// 'TQQQ' / 'tqqq+cash' → the first known ticker, as assetStrokeFor does.
function _miniAssetKey(held) {
  return String(held || '').toLowerCase().split(/[+/,\s]+/).find(part => MINI_ASSET_RING[part]) || null;
}
// Zoom and pan both wait for the modifier key (⌘ on a Mac, Ctrl elsewhere), so
// a plain wheel keeps scrolling the panel and a plain drag keeps measuring a
// range. With the key held, a wheel notch scales the visible span by
// 2^(-deltaY × 0.002) around the date under the cursor, d3-zoom style, never
// under minSpanMs or past the data, and a drag moves the window; a double-click
// or the Reset button restores the full range. The zoom is kept per strategy,
// so a re-render (resize, fresh log) preserves it.
const MINI_ZOOM = { minSpanMs: 30 * 86400000, wheelK: 0.002, rightAnchorPx: 200 };
const MINI_MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MINI_WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const _miniShortDate = t => { const d = new Date(t); return `${d.getUTCDate()} ${MINI_MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
// A trade's day for its tooltip: weekday, then the log's date ("Tue 21 Dec 21").
const _miniTradeDay = dateStr => `${MINI_WEEKDAY[new Date(dateStr + 'T00:00:00Z').getUTCDay()]} ${fmtLogDate(dateStr)}`;
window._miniZooms = window._miniZooms || {};   // cfg id → { t0, t1 }; absent = the full range
// fmt() rounds sub-$1000 values to whole dollars, which turns the low end of
// a log axis (TQQQ opened at $0.42) into a "$0" label — keep decimals on
// small prices instead.
// A name as the compact layout stacks it: a row per word, a hyphenated word
// broken after its hyphen ("Buy-back" reads "Buy-" over "back").
function _miniNameRows(name) {
  return name.split(' ').flatMap(word => word.replace(/-/g, '-\n').split('\n')).filter(Boolean);
}
// A value as its panel reads it: dollars, percent on a panel whose lines all
// declare unit: "%" (a volatility, a share of the account), or a plain number
// on one whose lines declare unit: "num" (an index reading such as NFCI).
function _miniFmtValue(unit, v) {
  if (unit === '%') return (Math.abs(v) < 10 ? v.toFixed(1) : String(Math.round(v))) + '%';
  if (unit === 'num') return String(+v.toFixed(Math.abs(v) < 10 ? 2 : 1));
  return _miniFmtPrice(v);
}
// How far a line moved over a dragged range: percent for prices, percentage
// points on a panel in percent (a share going 40% to 60% is +20 pts, not +50%),
// the plain difference on a panel of numbers.
function _miniRangeMove(unit, v0, v1) {
  if (unit === 'num') { const d = v1 - v0; return { up: d >= 0, text: (d >= 0 ? '+' : '') + d.toFixed(2) }; }
  const d = unit === '%' ? v1 - v0 : (v0 > 0 ? (v1 / v0 - 1) * 100 : 0);
  return { up: d >= 0, text: (d >= 0 ? '+' : '') + d.toFixed(1) + (unit === '%' ? ' pts' : '%') };
}
function _miniFmtPrice(v) {
  const a = Math.abs(v);
  return (v < 0 ? '-' : '') + (a >= 1000 ? fmt(a) : a === 0 ? '$0' : '$' + (a < 10 ? a.toFixed(2) : String(Math.round(a))));
}
// Date labels for the span on screen: years when it covers more than three,
// month starts down to two months, week starts below that; at most `max`.
function _miniTimeTicks(t0, t1, max) {
  const DAY = 86400000, days = (t1 - t0) / DAY, d0 = new Date(t0), d1 = new Date(t1), out = [];
  const MON = MINI_MON;
  if (days > 3 * 365) {
    const y0 = d0.getUTCFullYear(), y1 = d1.getUTCFullYear(), step = Math.max(1, Math.ceil((y1 - y0) / max));
    for (let y = y0 + 1; y <= y1; y += step) out.push({ t: Date.UTC(y, 0, 1), label: String(y) });
  } else if (days > 60) {
    const step = Math.max(1, Math.ceil(days / 30.4 / max));
    for (let y = d0.getUTCFullYear(), m = d0.getUTCMonth() + 1; ; m += step) {
      const t = Date.UTC(y, m, 1);
      if (t >= t1) break;
      if (t > t0) out.push({ t, label: MON[new Date(t).getUTCMonth()] + ' ' + new Date(t).getUTCFullYear() });
    }
  } else {
    const step = Math.max(1, Math.ceil(days / 7 / max));
    const first = t0 + ((8 - d0.getUTCDay()) % 7 || 7) * DAY;   // the first Monday after t0
    for (let t = Date.UTC(new Date(first).getUTCFullYear(), new Date(first).getUTCMonth(), new Date(first).getUTCDate()); t < t1; t += step * 7 * DAY) {
      out.push({ t, label: new Date(t).getUTCDate() + ' ' + MON[new Date(t).getUTCMonth()] });
    }
  }
  return out;
}
// Points to draw for a window: all of them when they fit the budget, else the
// lowest and highest of each bucket, in time order — the extremes are what a
// price line is about, and a line through them is indistinguishable from the
// full one at that width. The hover keeps every point. A gap anywhere in a
// bucket breaks the line at the bucket's first drawn point.
function _miniDecimate(pts, budget) {
  if (pts.length <= budget) return pts;
  const per = pts.length / budget, out = [];
  for (let b = 0; b < budget; b++) {
    const from = Math.floor(b * per), to = Math.min(pts.length, Math.floor((b + 1) * per));
    if (to <= from) continue;
    let lo = pts[from], hi = pts[from], gap = false;
    for (let i = from; i < to; i++) { const p = pts[i]; if (p.v < lo.v) lo = p; if (p.v > hi.v) hi = p; gap = gap || p.gap; }
    const first = lo.t <= hi.t ? lo : hi, second = first === lo ? hi : lo;
    out.push(gap && !first.gap ? Object.assign({}, first, { gap: true }) : first);
    if (second !== first) out.push(second);
  }
  return out;
}
// One trade symbol in SVG, the main chart's shapes (drawSmaMarker) at radius r.
// The y transform: log10 by default, the value itself on a linear axis.
function _miniScaleOf(linear) { return linear ? v => v : v => Math.log10(v); }
// A value's y on its panel (buildCustomLinesChartHtml's panels), on that panel's axis.
function _miniPanelY(P, v) {
  return P.top + (P.yHi - (P.linear ? v : Math.log10(v))) / (P.yHi - P.yLo) * (P.bottom - P.top);
}
// A round step (1, 2, 2.5 or 5 times a power of ten) near span / count.
function _miniNiceStep(span, count) {
  const raw = span / count, p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
}
function _miniMarkSvg(shape, x, y, r, attrs) {
  const ring = n => Array.from({ length: n }, (_, i) => { const a = -Math.PI / 2 + i * 2 * Math.PI / n; return (x + r * Math.cos(a)).toFixed(2) + ',' + (y + r * Math.sin(a)).toFixed(2); }).join(' ');
  if (shape === 'circle') return `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${r.toFixed(2)}" ${attrs}/>`;
  if (shape === 'hexagon') return `<polygon points="${ring(6)}" ${attrs}/>`;
  if (shape === 'diamond') return `<polygon points="${ring(4)}" ${attrs}/>`;
  return `<rect x="${(x - r).toFixed(2)}" y="${(y - r).toFixed(2)}" width="${(2 * r).toFixed(2)}" height="${(2 * r).toFixed(2)}" ${attrs}/>`;
}
// The same share for the tooltip's dot: a clip to the wedge, drawn past the dot
// so its ring (a box-shadow) is kept on that side only.
function _miniWedgeClip(a, b) {
  const pts = ['50% 50%'], steps = Math.max(2, Math.ceil((b - a) * 24));
  for (let i = 0; i <= steps; i++) {
    const ang = -Math.PI / 2 + (a + (b - a) * i / steps) * 2 * Math.PI;
    pts.push(`${(50 + 110 * Math.cos(ang)).toFixed(1)}% ${(50 + 110 * Math.sin(ang)).toFixed(1)}%`);
  }
  return `polygon(${pts.join(', ')})`;
}
// The share of the account a buy moved, as [held before, held after] in
// fractions of the account (a slice, or the rest after one), or null for a
// buy of everything or a row without the fields to tell. The signal chart
// and the desktop widget (widget/widget-data.cjs) draw it as a wedge.
function customTradeShare(log, i) {
  const r = log[i], prev = log[i - 1], val = +r.value, hv = +r.holdingsValue, to = String(r.held || '');
  if (!(val > 0) || !Number.isFinite(hv)) return null;
  const f1 = Math.max(0, Math.min(1, hv / val));
  const f0 = prev && String(prev.held || '') === to && +prev.shares > 0 && +r.price > 0 ? Math.max(0, Math.min(f1, +prev.shares * +r.price / val)) : 0;
  return f1 - f0 > 0.02 && f1 - f0 < 0.95 ? [f0, f1] : null;
}
// A pie wedge from fraction a to fraction b of a circle, clockwise from 12 o'clock.
function _miniWedgePath(x, y, r, a, b) {
  const pt = f => { const ang = -Math.PI / 2 + f * 2 * Math.PI; return (x + r * Math.cos(ang)).toFixed(2) + ',' + (y + r * Math.sin(ang)).toFixed(2); };
  return `M${x.toFixed(2)},${y.toFixed(2)} L${pt(a)} A${r.toFixed(2)},${r.toFixed(2)} 0 ${b - a > 0.5 ? 1 : 0} 1 ${pt(b)} Z`;
}
// opts.aspect: the chart's height as a share of its width (default the
// panel's MINI_CHART proportions). opts.textWidth: size the text as on a chart
// that wide, so charts of different widths side by side read at one size.
// opts.scale: 'linear' for an even y-axis, which also takes zero and
// negative values; the default is log, where a constant-% gap between lines
// draws as a constant distance. opts.compact: the desktop widget's layout:
// no zoom hints (the Reset and Latest buttons sit in the corner under the
// end labels), each end label's name running down a row per word beside its
// value, and a strip above the plot only when the log has trades
// to show there. opts.home: { t0, t1 }, the view the chart rests in (the
// widget's portfolio period on a history reaching further back): shown until
// the viewer zooms or pans, and where Reset and a double-click return.
// Without it the chart rests at the full range. A line
// may set its own color, a unit ('%' or 'num'), a group (the panel it draws
// in, MINI_PANEL), and in the compact layout a badge: { text, color },
// on the row above its name while the latest date is on screen.
function buildCustomLinesChartHtml(cfg, lines, log, cw, opts) {
  const compact = !!(opts && opts.compact);
  // One panel per line group (MINI_PANEL), in the order the groups first
  // appear. A panel has one unit: percent when all its lines are in percent,
  // a plain number when all are ("num", an index reading such as NFCI),
  // dollars otherwise. A percent panel whose lines go below zero (a lead that
  // turns into a lag) and every number panel draw on an even axis: a log axis
  // would drop the stretches at or below zero without a trace.
  const shownLines = lines.filter(ln => customLineShown(cfg, ln.key));
  const forcedLinear = !!(opts && opts.scale === 'linear');
  const specs = [...new Set(shownLines.map(customLineGroup))].map(name => {
    const own = shownLines.filter(ln => customLineGroup(ln) === name);
    const unit = own.every(ln => ln.unit === '%') ? '%' : own.every(ln => ln.unit === 'num') ? 'num' : '$';
    const negative = unit === '%' && own.some(ln => log.some(r => r && typeof r[ln.key] === 'number' && isFinite(r[ln.key]) && r[ln.key] < 0));
    // Its size counts the lines the strategy declares in it, hidden ones too,
    // so hiding a line never resizes the chart.
    const count = lines.filter(ln => customLineGroup(ln) === name).length;
    return { name, unit, linear: forcedLinear || unit === 'num' || negative, count };
  });
  const all = [];
  lines.forEach((ln, i) => {
    if (!customLineShown(cfg, ln.key)) return;
    const spec = specs.find(sp => sp.name === customLineGroup(ln));
    // A row without a value for this key breaks the line, and so does one a
    // log axis cannot place (zero or below). A strategy can
    // declare a line that only exists while a condition holds (a buy-back
    // level behind a slope gate, say) by logging null on the other days.
    // `gap` marks the first point after a break: the path restarts there and
    // the hover shows nothing for the series inside the break.
    const pts = [];
    let broken = false;
    for (const r of log) {
      if (!r || r.date == null) continue;
      const v = r[ln.key];
      if (typeof v === 'number' && isFinite(v) && (spec.linear || v > 0)) {
        pts.push({ t: Date.parse(r.date), v, d: String(r.date), gap: broken && pts.length > 0 });
        broken = false;
      } else broken = true;
    }
    if (pts.length > 1) all.push({ label: ln.label, color: ln.color || customLineColorAt(cfg, lines, i), pts, badge: ln.badge || null, unit: spec.unit, spec });
  });
  window._miniChartHover = null;
  if (!all.length) return '';
  // A group with nothing to draw gets no panel. The rest keep their order and
  // their place while zooming, even through a stretch one of them has no data.
  const panelSpecs = specs.filter(sp => all.some(s => s.spec === sp));
  const nPanels = panelSpecs.length;
  for (const s of all) s.panel = panelSpecs.indexOf(s.spec);
  // Each panel's height as a share of a full panel's (MINI_PANEL).
  const shares = panelSpecs.map((sp, p) => p === 0 ? 1 : sp.count <= 3 ? MINI_PANEL.minShare : Math.min(1, sp.count / MINI_PANEL.fullAt));

  const { W, padL } = MINI_CHART;
  const H = opts && opts.aspect ? Math.max(60, Math.round(W * opts.aspect)) : MINI_CHART.H + shares.slice(1).reduce((sum, f) => sum + f * MINI_PANEL.addH, 0);
  const kPx = Math.max(1, (cw || W) / W);   // render scale: screen px per viewBox unit
  // Text, margins, ticks and buttons are sized in px and divided by k: the
  // render scale up to MINI_TEXT_REF_W, eased past it so they grow with the
  // square root of the extra width (see the module comment above).
  const textW = opts && opts.textWidth ? opts.textWidth : (cw || W);
  const k = kPx / Math.sqrt(Math.max(1, textW / MINI_TEXT_REF_W));
  // The trades, once: the strip above the plot holds their caps. The compact
  // layout drops the strip when the log has none (the whole log, so zooming
  // never moves the plot), unless the first of several panels needs its name there.
  const markerEvents = customMarkerEvents(log);
  const padT = (compact && !markerEvents.length && nPanels === 1 ? MINI_PX.edge : MINI_PX.strip) / k, padB = MINI_PX.axis / k;
  // The full extent, then the zoom window inside it. A zoom saved from an
  // older, longer run is clamped so it can never show an empty plot.
  let T0 = Infinity, T1 = -Infinity;
  for (const s of all) { T0 = Math.min(T0, s.pts[0].t); T1 = Math.max(T1, s.pts[s.pts.length - 1].t); }
  if (!(T1 > T0)) return '';
  const home = (opts && opts.home) || null;
  const z = window._miniZooms[cfg.id] || home;
  const minSpan = Math.min(MINI_ZOOM.minSpanMs, T1 - T0);
  const t0 = z ? Math.max(T0, Math.min(z.t0, T1 - minSpan)) : T0;
  const t1 = z ? Math.min(T1, Math.max(z.t1, t0 + minSpan)) : T1;
  const zoomed = t0 > T0 || t1 < T1;
  // Off the resting view: the zoom buttons show. Without a home that is any
  // zoom; with one, any move away from it.
  const offRest = home ? !!window._miniZooms[cfg.id] : zoomed;
  const atEnd = t1 >= T1;   // the latest date is on screen
  // Points on screen: those inside the window plus one neighbour either side,
  // so each line reaches the plot's edges (the clip path trims the overhang).
  // The y-scale and the end labels use the points inside the window.
  // A line that stops before the window's end (a level that exists only while
  // a condition holds) is `partial`: it is labelled where it ends, beside the
  // line, instead of in the gutter. A line with no point on screen gets no label.
  const endTol = Math.max(8 * 86400000, (t1 - t0) * 0.01);
  const series = all.map(s => {
    let from = 0; while (from + 1 < s.pts.length && s.pts[from + 1].t <= t0) from++;
    let to = s.pts.length - 1; while (to > 0 && s.pts[to - 1].t >= t1) to--;
    const pts = s.pts.slice(from, to + 1), inWindow = pts.filter(p => p.t >= t0 && p.t <= t1);
    const endPt = inWindow.length ? inWindow[inWindow.length - 1] : pts[pts.length - 1];
    return { label: s.label, color: s.color, pts, scalePts: inWindow.length ? inWindow : pts, endPt, shown: inWindow.length > 0, partial: endPt.t < t1 - endTol, badge: atEnd ? s.badge : null, unit: s.unit, panel: s.panel };
  }).filter(s => s.pts.length > 1);
  if (!series.length) return '';
  // Right gutter: the value column, then the name column beside it (both
  // descaled, JetBrains Mono advance ≈ 0.6em). A name is one row, or in the
  // compact layout a row per word with any badge on the row above them. It is
  // capped so a narrow panel keeps a usable plot area — when capped, long
  // names clip at the right edge instead of covering lines.
  const _valTxt = (unit, v) => unit === '$' ? (v < 0 ? '-' : '') + (Math.abs(v) >= 1000 ? fmt(Math.abs(v)) : '$' + Math.abs(v).toFixed(2)) : _miniFmtValue(unit, v);
  const gutterSeries = series.filter(s => s.shown && !s.partial);
  const nameRowsOf = (name, badge, color) => (compact && badge ? [{ text: badge.text, color: badge.color }] : [])
    .concat((compact ? _miniNameRows(name) : [name]).map(text => ({ text, color })));
  const valColW = Math.max(0, ...gutterSeries.map(s => _valTxt(s.unit, s.endPt.v).length)) * (9 / k) * 0.6;
  const nameColW = Math.max(0, ...gutterSeries.flatMap(s => nameRowsOf(s.label, s.badge, s.color)).map(row => row.text.length)) * (7 / k) * 0.62;
  const padR = Math.min(4 / k + valColW + 4 / k + nameColW + 5 / k, 0.45 * W);
  // The panels split the plot's height by their shares, a gap apart, each
  // scaled to its own points in the window. A panel with none there keeps its
  // place, empty.
  const plotW = W - padL - padR, plotBottom = H - padB, plotH = plotBottom - padT;
  const gapY = nPanels > 1 ? MINI_PANEL.gap / k : 0;
  const fullH = (plotH - (nPanels - 1) * gapY) / shares.reduce((sum, f) => sum + f, 0);
  const panels = panelSpecs.map((sp, p) => {
    const top = padT + shares.slice(0, p).reduce((y, f) => y + f * fullH + gapY, 0), bottom = top + shares[p] * fullH, tf = _miniScaleOf(sp.linear);
    let lo = Infinity, hi = -Infinity;
    for (const s of series) if (s.panel === p) for (const pt of s.scalePts) { if (pt.v < lo) lo = pt.v; if (pt.v > hi) hi = pt.v; }
    if (!(hi >= lo)) return { name: sp.name, unit: sp.unit, linear: sp.linear, top, bottom, yLo: 0, yHi: 1, empty: true };
    const l0 = tf(lo), l1 = tf(hi);
    const lPad = sp.linear ? Math.max((l1 - l0) * 0.06, Math.abs(l1) * 0.01, 1e-9) : Math.max((l1 - l0) * 0.05, 0.01);
    // A linear axis of positive values bottoms out at zero; one with values
    // below zero (a loss) reaches below it.
    const yLo = sp.linear ? (lo >= 0 ? Math.max(0, l0 - lPad) : l0 - lPad) : l0 - lPad, yHi = l1 + lPad;
    return { name: sp.name, unit: sp.unit, linear: sp.linear, top, bottom, yLo, yHi, empty: false };
  });
  const panelSeries = panels.map((P, p) => series.filter(s => s.panel === p));
  const budget = Math.ceil(plotW * kPx * MINI_POINTS_PER_PX);
  for (const s of series) s.drawPts = _miniDecimate(s.pts, budget);
  const xAt = t => padL + (t - t0) / (t1 - t0) * plotW;
  const yAt = (p, v) => _miniPanelY(panels[p], v);
  // Trade events: a band at each trade's date, a cap in the strip above the
  // plot where the hover answers for them, and a mark at the trade's crossing,
  // coloured by action (the main chart's marker vocabulary, via
  // customMarkerEvents). The band runs down every panel, so a trade's date
  // lines up across them. The mark goes only in the panel whose rule fired the
  // trade, the group its row names in firedBy, and in the first panel when it
  // names none: a trade the median line fired has nothing to show on a stress
  // index. Trades a few days apart would stack unreadably, so events closer
  // than MINI_EVENT.mergeX fold into one band whose hover lists them all.
  // Logged in date order, so one pass groups them.
  const eventGroups = [];
  for (const ev of markerEvents) {
    const t = Date.parse(ev.row.date);
    if (!(t >= t0 && t <= t1)) continue;
    const x = xAt(t);
    // Rows log the state after the trade, so what it moved FROM is the nearest
    // earlier row holding something else (markerAssetFor's rule); a sell is
    // about that, a buy or switch about what it holds now.
    const to = String(ev.row.held || '');
    let from = '';
    for (let j = ev.i - 1; j >= 0 && !from; j--) { const h = log[j] && log[j].held; if (h && String(h) !== to) from = String(h); }
    const kind = customActionKind(ev.row.action);
    const assetKey = _miniAssetKey(kind === 'sell' ? from : to);
    const part = kind === 'buy' ? customTradeShare(log, ev.i) : null, firedAt = panelSpecs.findIndex(sp => sp.name === ev.row.firedBy);
    const item = { x, t, date: String(ev.row.date), kind, label: ev.st.label, color: ev.st.color, shape: ev.st.shape, from, to, held: to, part, panel: firedAt >= 0 ? firedAt : 0,
      ring: assetKey ? MINI_ASSET_RING[assetKey] : 'rgba(255,255,255,0.95)', dashed: !!(assetKey && MINI_ASSET_DASHED[assetKey]), note: String(ev.row.note || '') };
    const last = eventGroups[eventGroups.length - 1];
    if (last && x - last.x1 < MINI_EVENT.mergeX && x - last.x0 <= MINI_EVENT.maxSpanX) { last.items.push(item); last.x1 = x; }
    else eventGroups.push({ x0: x, x1: x, items: [item] });
  }
  const events = eventGroups.map(g => ({ x0: g.x0 - MINI_EVENT.halfW, x1: g.x1 + MINI_EVENT.halfW, items: g.items }));
  // Everything the hover and zoom handlers need to resolve a cursor position
  // back to dates, values and bands, under the chart's id (its svg carries
  // it); window._miniChartHover is the most recently built one.
  const chartData = { series, panels, t0, t1, T0, T1, W, H, padL, padT, padB, padR, k, events, cfgId: cfg.id, zoomed, home };
  window._miniCharts[cfg.id] = chartData;
  window._miniChartHover = chartData;

  // Horizontal gridlines per panel, labeled with fmt(): log-spaced levels, or
  // on a linear axis the round values a step apart, zero among them once the
  // axis reaches below it. As many as the panel's height fits with room for
  // their labels, at most three: a quarter-height panel gets one.
  const titled = nPanels > 1;
  let grid = '';
  panels.forEach(P => {
    if (P.empty) return;
    const fit = Math.max(1, Math.min(3, Math.floor((P.bottom - P.top) / (2.4 * 8 / k))));
    const step = P.linear ? _miniNiceStep(P.yHi - P.yLo, fit) : 0;
    const levels = P.linear
      ? Array.from({ length: Math.floor(P.yHi / step) - Math.ceil(P.yLo / step) + 1 }, (_, i) => (Math.ceil(P.yLo / step) + i) * step).filter(v => v > 0 || P.yLo < 0)
      : [[0.5], [0.25, 0.75], [0.15, 0.5, 0.85]][fit - 1].map(f => Math.pow(10, P.yLo + (P.yHi - P.yLo) * f));
    for (const lv of levels) {
      const y = _miniPanelY(P, lv).toFixed(1);
      grid += `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="rgba(122,122,166,0.14)" stroke-width="0.5"/>
      <text x="${padL + 1}" y="${(+y - 2).toFixed(1)}" font-family="JetBrains Mono" font-size="${(8 / k).toFixed(2)}" fill="rgba(122,122,166,0.75)" stroke="rgba(255,255,255,0.95)" stroke-width="${(2 / k).toFixed(2)}" stroke-linejoin="round" paint-order="stroke">${_miniFmtValue(P.unit, lv)}</text>`;
    }
  });
  // With more than one panel each is named just above its top left, outside
  // the plot so no line runs through the name: the first in the strip, the
  // others in the gap above them, under a divider across the chart. It runs
  // through the gutter too, so each panel's end labels stay with it, except in
  // the compact layout, whose labels of a row per word can outgrow a panel.
  let panelTitles = '';
  const ruleY = p => panels[p].top - gapY + MINI_PANEL.rule / k;   // the divider over panel p > 0
  if (titled) panels.forEach((P, p) => {
    if (P.name) panelTitles += `<text class="mini-panel-title" x="${(padL + 1).toFixed(1)}" y="${(P.top - 3 / k).toFixed(2)}" font-family="JetBrains Mono" font-size="${(7 / k).toFixed(2)}" font-weight="600" fill="rgba(90,90,140,0.95)" stroke="rgba(255,255,255,0.95)" stroke-width="${(2 / k).toFixed(2)}" stroke-linejoin="round" paint-order="stroke">${_escHtml(P.name)}</text>`;
    if (p > 0) panelTitles += `<line class="mini-panel-rule" x1="0" y1="${ruleY(p).toFixed(2)}" x2="${(compact ? W - padR : W).toFixed(1)}" y2="${ruleY(p).toFixed(2)}" stroke="rgba(122,122,166,0.55)" stroke-width="${(1 / k).toFixed(2)}"/>`;
  });
  // The zoom buttons, while zoomed: Reset, and Latest beside it while panned
  // away from the end (the click handler below; a double-click anywhere also
  // resets). They sit at the strip's right end, inside the gutter so they
  // never cover a trade cap, or in the compact layout in the corner under the
  // end labels.
  const btnW = 50 / k, btnH = 10 / k, chipW = 38 / k;
  const btnX = W - 2 / k - btnW, chipX = btnX - 4 / k - chipW;
  const btnY = compact ? plotBottom + (padB - btnH) / 2 : 1 / k;
  const axisEnd = compact && offRest ? (atEnd ? btnX : chipX) - 4 / k : W;
  // Date labels just under the plot. Centers are clamped inside the viewBox so
  // the first and last never render half-cut at the edges, and a label that
  // would touch the one before it, or the compact layout's zoom buttons, is
  // dropped (JetBrains Mono advance ≈ 0.6em).
  const yLabel = (plotBottom + MINI_PX.labelGap / k).toFixed(1);
  const axisFs = 8 / k, axisCharW = 0.6 * axisFs, axisGap = 6 / k;
  let xAxis = '', lastRight = -Infinity;
  for (const tk of _miniTimeTicks(t0, t1, 6)) {
    const half = tk.label.length * axisCharW / 2;
    const lx = Math.max(half, Math.min(W - half, xAt(tk.t)));
    if (lx - half < lastRight + axisGap || lx + half > axisEnd) continue;
    lastRight = lx + half;
    xAxis += `<text x="${lx.toFixed(1)}" y="${yLabel}" text-anchor="middle" font-family="JetBrains Mono" font-size="${axisFs.toFixed(2)}" fill="rgba(122,122,166,0.75)">${tk.label}</text>`;
  }
  // Hints beside the buttons, outside the compact layout: how to zoom while
  // at full range; the factor and the pan hint while zoomed. A hint that
  // would not fit the gutter is shortened or dropped; the button's tooltip
  // always carries the full instructions.
  const hintAttrs = `y="${(8.5 / k).toFixed(2)}" text-anchor="end" font-family="JetBrains Mono" font-size="${(7 / k).toFixed(2)}" stroke="rgba(255,255,255,0.95)" stroke-width="${(2 / k).toFixed(2)}" stroke-linejoin="round" paint-order="stroke"`;
  const hintW = txt => txt.length * 0.6 * (7 / k);   // JetBrains Mono advance
  let zoomUi = '';
  if (!offRest) {
    const hint = `${MOD_KEY} + scroll to zoom`;
    if (!compact && hintW(hint) <= padR - 4 / k) zoomUi = `<text x="${(W - 2 / k).toFixed(1)}" ${hintAttrs} fill="rgba(122,122,166,0.6)">${hint}</text>`;
  } else {
    const factor = ((T1 - T0) / (t1 - t0)).toFixed(1);
    const resetBtn = `<g class="mini-zoom-reset" role="button"><title>Back to the full range. ${MOD_KEY} + scroll zooms, ${MOD_KEY} + drag pans.</title><rect x="${btnX.toFixed(1)}" y="${btnY.toFixed(2)}" width="${btnW.toFixed(1)}" height="${btnH.toFixed(2)}" rx="${(3 / k).toFixed(2)}"/><text x="${(btnX + btnW / 2).toFixed(1)}" y="${(btnY + 7.3 / k).toFixed(2)}" text-anchor="middle" font-family="JetBrains Mono" font-size="${(7 / k).toFixed(2)}" font-weight="600">Reset zoom</text></g>`;
    if (atEnd) {
      const long = `×${factor} · ${MOD_KEY} + drag to pan`;
      const hint = hintW(long) <= padR - btnW - 8 / k ? long : `×${factor}`;
      zoomUi = (compact ? '' : `<text x="${(btnX - 4 / k).toFixed(1)}" ${hintAttrs} fill="rgba(122,122,166,0.9)">${hint}</text>`) + resetBtn;
    } else {
      // Panned away from the end: a Latest chip in place of the hint says so,
      // and a click brings the window back to the latest date at the same zoom.
      const short = `×${factor}`;
      const hint = !compact && hintW(short) <= padR - btnW - chipW - 12 / k ? `<text x="${(chipX - 4 / k).toFixed(1)}" ${hintAttrs} fill="rgba(122,122,166,0.9)">${short}</text>` : '';
      zoomUi = `${hint}<g class="mini-latest" role="button"><title>The latest date is off screen to the right. Click to jump to it at this zoom.</title><rect x="${chipX.toFixed(1)}" y="${btnY.toFixed(2)}" width="${chipW.toFixed(1)}" height="${btnH.toFixed(2)}" rx="${(3 / k).toFixed(2)}"/><text x="${(chipX + chipW / 2).toFixed(1)}" y="${(btnY + 7.3 / k).toFixed(2)}" text-anchor="middle" font-family="JetBrains Mono" font-size="${(7 / k).toFixed(2)}" font-weight="600">Latest →</text></g>${resetBtn}`;
    }
  }
  // The end of the data, when it is on screen: a dotted line at the latest
  // date with its date above it, and a dot closing each line. Drawn outside
  // the clip so the dots at the plot's edge render whole. Absent while panned
  // away from the end, when the strip's Latest chip says so instead.
  let latestMark = '';
  if (atEnd) {
    const xEnd = (W - padR).toFixed(1);
    const dots = series.filter(s => Math.abs(s.endPt.t - T1) < 86400000).map(s =>
      `<circle cx="${xEnd}" cy="${yAt(s.panel, s.endPt.v).toFixed(1)}" r="${(1.4 / k).toFixed(2)}" fill="${s.color}" stroke="rgba(255,255,255,0.95)" stroke-width="${(0.7 / k).toFixed(2)}"/>`).join('');
    latestMark = `<line class="mini-latest-line" x1="${xEnd}" y1="${padT.toFixed(2)}" x2="${xEnd}" y2="${plotBottom.toFixed(2)}" stroke="rgba(122,122,166,0.55)" stroke-width="${(0.6 / k).toFixed(2)}" stroke-dasharray="${(1.6 / k).toFixed(2)} ${(1.6 / k).toFixed(2)}"/>
      <text class="mini-latest-label" x="${(W - padR - 2 / k).toFixed(1)}" y="${(padT + 7.5 / k).toFixed(2)}" text-anchor="end" font-family="JetBrains Mono" font-size="${(7 / k).toFixed(2)}" font-weight="600" fill="rgba(122,122,166,0.95)" stroke="rgba(255,255,255,0.95)" stroke-width="${(2 / k).toFixed(2)}" stroke-linejoin="round" paint-order="stroke">latest · ${_miniShortDate(T1)}</text>${dots}`;
  }

  // Polylines + right-edge end labels (pushed apart when endpoints collide).
  // A panel's first line, the price or reading its levels are compared with,
  // is drawn last so a level that hugs it (an RSI threshold resolved to a
  // price) cannot hide it.
  const pathOf = s => {
    let d = '';
    for (const p of s.drawPts) d += (!d || p.gap ? 'M' : 'L') + xAt(p.t).toFixed(1) + ',' + yAt(s.panel, p.v).toFixed(1);
    return `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="0.45"/>`;
  };
  const panelPaths = panelSeries.map(own => own.length ? own.slice(1).map(pathOf).join('') + pathOf(own[0]) : '');
  // Partial lines: name and last value beside the line's end, to its right when
  // that fits inside the plot, else to its left.
  let lineTags = '';
  for (const s of series.filter(s => s.shown && s.partial)) {
    const P = panels[s.panel], x = xAt(s.endPt.t), txt = `${s.label} ${_valTxt(s.unit, s.endPt.v)}`;
    const y = Math.max(P.top + 6 / k, Math.min(P.bottom - 1 / k, yAt(s.panel, s.endPt.v) + 2.5 / k));
    const right = x + 3 / k + txt.length * 0.6 * (7 / k) <= W - padR;
    lineTags += `<text class="mini-line-tag" x="${(right ? x + 3 / k : x - 3 / k).toFixed(1)}" y="${y.toFixed(1)}" text-anchor="${right ? 'start' : 'end'}" font-family="JetBrains Mono" font-size="${(7 / k).toFixed(2)}" font-weight="600" fill="${s.color}" stroke="rgba(255,255,255,0.95)" stroke-width="${(2 / k).toFixed(2)}" stroke-linejoin="round" paint-order="stroke">${_escHtml(txt)}</text>`;
  }
  // One label per series in the gutter, never over the plot: the value at
  // the line's end, and its name beside it on the same baseline. In the
  // compact layout the name runs down a row per word with any badge on the
  // row above it, the rows centred on the value; labels push apart by their
  // own heights and stay inside the plot's height. Each panel lays out its
  // own labels and keeps them beside it.
  const rowLh = 8.5 / k;
  const reach = e => (e.rows.length - 1) / 2 * rowLh + 5 / k;   // a compact label's half height
  const room = (a, b) => (compact ? reach(a) + reach(b) + 1 / k : 10 / k);
  let endLabels = '';
  panels.forEach((P, p) => {
    const ends = panelSeries[p].filter(s => s.shown && !s.partial)
      .map(s => ({ y: yAt(p, s.endPt.v), v: s.endPt.v, unit: s.unit, rows: nameRowsOf(s.label, s.badge, s.color), color: s.color }));
    ends.sort((a, b) => a.y - b.y);
    const minY = p === 0 ? 0 : ruleY(p) + 2 / k, maxY = p === nPanels - 1 ? plotBottom : ruleY(p + 1) - 2 / k;
    if (compact && ends.length) ends[0].y = Math.max(ends[0].y, minY + reach(ends[0]));
    for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < room(ends[i - 1], ends[i])) ends[i].y = ends[i - 1].y + room(ends[i - 1], ends[i]);
    if (compact || titled) {
      for (let i = ends.length - 1; i >= 0; i--) {
        const max = i === ends.length - 1 ? maxY - (compact ? reach(ends[i]) : 3 / k) : ends[i + 1].y - room(ends[i], ends[i + 1]);
        if (ends[i].y > max) ends[i].y = max;
      }
    }
    for (const e of ends) {
      const base = e.y + 3 / k;
      const firstRow = compact ? e.y + 2.5 / k - (e.rows.length - 1) / 2 * rowLh : base;
      endLabels += `<text x="${(W - padR + 4 / k + valColW).toFixed(1)}" y="${base.toFixed(1)}" text-anchor="end" font-family="JetBrains Mono" font-size="${(9 / k).toFixed(2)}" font-weight="600" fill="${e.color}" stroke="rgba(255,255,255,0.95)" stroke-width="${(2.5 / k).toFixed(2)}" stroke-linejoin="round" paint-order="stroke">${_valTxt(e.unit, e.v)}</text>`
        + e.rows.map((row, j) => `<text x="${(W - padR + 8 / k + valColW).toFixed(1)}" y="${(firstRow + j * rowLh).toFixed(1)}" font-family="JetBrains Mono" font-size="${(7 / k).toFixed(2)}" font-weight="600" fill="${row.color}" stroke="rgba(255,255,255,0.95)" stroke-width="${(2 / k).toFixed(2)}" stroke-linejoin="round" paint-order="stroke">${_escHtml(row.text)}</text>`).join('');
    }
  });

  // Bands down every panel, caps in the strip, and once the window is under
  // MINI_EVENT.marksWithinMs one mark per trade where it happened, in the
  // panel that fired it: on that panel's first drawn line at that day's close, so a sell
  // sits where the price broke the line and a buy where it came back (a trade
  // inside a gap of that line gets no mark). Each mark is drawn twice, a white
  // halo under the symbol, and remembered in data.marks for the hover. Lines,
  // bands and marks are clipped to the plot, and lines and marks to their
  // panel, since a zoomed line keeps one point beyond each edge.
  const clipId = 'mini-clip-' + String(cfg.id).replace(/[^\w-]/g, '');
  const eventBands = events.map((g, i) => panels.map(P =>
    `<rect class="mini-ev" data-mini-ev="${i}" x="${g.x0.toFixed(1)}" y="${P.top.toFixed(2)}" width="${(g.x1 - g.x0).toFixed(1)}" height="${(P.bottom - P.top).toFixed(2)}"/>`).join('')).join('');
  const eventCaps = events.map((g, i) =>
    `<rect class="mini-ev-cap" data-mini-ev="${i}" x="${g.x0.toFixed(1)}" y="0" width="${(g.x1 - g.x0).toFixed(1)}" height="${padT.toFixed(2)}"/>`).join('');
  const markR = MINI_MARK.r / k, ringW = MINI_MARK.ring / k;
  const marks = t1 - t0 >= MINI_EVENT.marksWithinMs ? [] : events.flatMap(g => g.items).map(it => {
    const first = panelSeries[it.panel][0], pt = first ? _miniPtAt(first.pts, it.t) : null;
    return pt ? { x: it.x, y: yAt(it.panel, pt.v), r: markR, item: it, panel: it.panel } : null;
  }).filter(Boolean);
  chartData.marks = marks;
  const markSvg = m => {
    const haloAttrs = `fill="none" stroke="rgba(255,255,255,0.95)" stroke-width="${(ringW + 1.8 / k).toFixed(2)}"`;
    const dash = m.item.dashed ? ` stroke-dasharray="${(1.5 / k).toFixed(2)} ${(1.2 / k).toFixed(2)}"` : '';
    if (m.item.part && m.item.shape === 'circle') {
      // A partial buy: only the bought share of the circle, outline and halo included.
      const d = _miniWedgePath(m.x, m.y, markR, m.item.part[0], m.item.part[1]);
      return `<path d="${d}" ${haloAttrs} stroke-linejoin="round"/>`
        + `<path class="mini-ev-mark" d="${d}" fill="${m.item.color}" stroke="${m.item.ring}" stroke-width="${ringW.toFixed(2)}" stroke-linejoin="round"${dash}/>`;
    }
    return _miniMarkSvg(m.item.shape, m.x, m.y, markR, haloAttrs)
      + _miniMarkSvg(m.item.shape, m.x, m.y, markR, `class="mini-ev-mark" fill="${m.item.color}" stroke="${m.item.ring}" stroke-width="${ringW.toFixed(2)}"` + dash);
  };
  const clips = `<clipPath id="${clipId}"><rect x="${padL}" y="${padT.toFixed(2)}" width="${plotW.toFixed(1)}" height="${plotH.toFixed(2)}"/></clipPath>`
    + panels.map((P, p) => `<clipPath id="${clipId}-${p}"><rect x="${padL}" y="${P.top.toFixed(2)}" width="${plotW.toFixed(1)}" height="${(P.bottom - P.top).toFixed(2)}"/></clipPath>`).join('');
  const panelLayers = panels.map((P, p) => `<g clip-path="url(#${clipId}-${p})">${panelPaths[p]}${marks.filter(m => m.panel === p).map(markSvg).join('')}</g>`).join('');

  return `<svg class="custom-lines-chart" data-mini-id="${_escHtml(String(cfg.id))}" viewBox="0 0 ${W} ${H}"><defs>${clips}</defs>${grid}<g clip-path="url(#${clipId})">${eventBands}</g>${panelLayers}${latestMark}${lineTags}${eventCaps}${panelTitles}${endLabels}${xAxis}${zoomUi}</svg>`;
}

// The panel opens through a width transition (and can be resized), so the
// signal chart's first render can measure a stale width — leaving its
// width-compensated text scaled wrong. This observer re-renders the chart
// once the body's real width settles.
const _miniChartResizeObs = (typeof ResizeObserver !== 'undefined') ? new ResizeObserver(() => {
  clearTimeout(window._miniChartResizeT);
  window._miniChartResizeT = setTimeout(_miniChartRerender, 150);
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
  document.querySelectorAll('.custom-lines-chart .mini-hover').forEach(g => g.remove());
  document.querySelectorAll('.custom-lines-chart').forEach(svg => _miniHighlightEvent(svg, -1));
  const tip = document.getElementById('mini-chart-tip');
  if (tip) tip.setAttribute('hidden', '');
  window._miniHoverActive = false;
  window._miniPinned = null;
  window._miniRangeShown = null;
}
// Nearest point to time t (pts are in date order — binary search).
function _miniNearestPt(pts, t) {
  let lo = 0, hi = pts.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (pts[m].t <= t) lo = m; else hi = m; }
  return (t - pts[lo].t) <= (pts[hi].t - t) ? pts[lo] : pts[hi];
}
// The series' point at a snapped time, or null when that time falls inside a
// break in the line (buildCustomLinesChartHtml's `gap`), so a gated line
// reads as absent there instead of borrowing its nearest edge.
function _miniPtAt(pts, t) {
  let lo = 0, hi = pts.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (pts[m].t <= t) lo = m; else hi = m; }
  if (pts[hi].gap && t > pts[lo].t && t < pts[hi].t) return null;
  return _miniNearestPt(pts, t);
}
// Cursor position in the chart's own viewBox units.
function _miniCursorX(svg, e, data) {
  const rect = svg.getBoundingClientRect();
  return (e.clientX - rect.left) / (rect.width / data.W);
}
function _miniCursorY(svg, e, data) {
  const rect = svg.getBoundingClientRect();
  return (e.clientY - rect.top) / (rect.height / data.H);
}
// Cursor x → the date at that position in the visible window.
function _miniTimeAtX(data, x) {
  const frac = Math.max(0, Math.min(1, (x - data.padL) / (data.W - data.padL - data.padR)));
  return data.t0 + frac * (data.t1 - data.t0);
}
// Cursor position → the first series' nearest logged day. Every readout
// (hover and drag-range alike) snaps to this anchor so all rows describe
// the same real trading date.
function _miniAnchorFromEvent(svg, e, data) {
  return _miniNearestPt(data.series[0].pts, _miniTimeAtX(data, _miniCursorX(svg, e, data)));
}
// The trade mark nearest the cursor within its hit radius, if any.
function _miniMarkAt(svg, e, data) {
  const marks = data.marks || [];
  if (!marks.length) return null;
  const rect = svg.getBoundingClientRect(), pxPerUnit = rect.width / data.W;
  const mx = (e.clientX - rect.left) / pxPerUnit, my = (e.clientY - rect.top) / pxPerUnit;
  let best = null, bestD = Infinity;
  for (const m of marks) {
    const d = Math.hypot(mx - m.x, my - m.y) * pxPerUnit;
    if (d <= m.r * pxPerUnit + MINI_MARK.hitPad && d < bestD) { best = m; bestD = d; }
  }
  return best;
}
// The trade-event band under the cursor, if any (see buildCustomLinesChartHtml).
function _miniEventAt(data, x) {
  const pad = MINI_EVENT.hoverPad;
  const i = (data.events || []).findIndex(g => x >= g.x0 - pad && x <= g.x1 + pad);
  return i < 0 ? null : { index: i, group: data.events[i] };
}
function _miniHighlightEvent(svg, index) {
  if (!svg) return;
  svg.querySelectorAll('.mini-ev, .mini-ev-cap').forEach(r => r.classList.toggle('is-hover', +r.getAttribute('data-mini-ev') === index));
}
function _miniXAt(data, t) {
  return data.padL + (t - data.t0) / (data.t1 - data.t0) * (data.W - data.padL - data.padR);
}
// Exact-value formatter for readouts: two decimals below $1000.
function _miniFmtExact(v) { return v >= 1000 ? fmt(v) : '$' + v.toFixed(2); }
// A value in a readout: exact dollars, else as its panel reads it.
function _miniFmtReadout(unit, v) { return unit === '$' ? _miniFmtExact(v) : _miniFmtValue(unit, v); }
// A readout's rows, one per panel in panel order: the panel's first line (the
// price or reading its levels are compared with), then in brackets the
// panel's other lines, the levels it is moving toward. `value` formats the
// first line's part, `level` each bracketed one. A level's own closing
// parenthesis is dropped ("Overextended (+55%)" reads "Overextended") so the
// brackets never nest.
function _miniPanelRows(data, items, value, level) {
  return data.panels.map((_, p) => {
    const own = items.filter(it => it.panel === p);
    if (!own.length) return '';
    const levels = own.slice(1).map(it => `${_escHtml(it.label.replace(/\s*\([^()]*\)$/, ''))} ${level(it)}`).join(' · ');
    return `<div class="mct-row"><span class="mct-dot" style="background:${own[0].color}"></span>`
      + `<span>${_escHtml(own[0].label)} ${value(own[0])}${levels ? ` <span class="mct-levels">(${levels})</span>` : ''}</span></div>`;
  }).join('');
}
function _miniHoverGroup(svg) {
  let g = svg.querySelector('.mini-hover');
  if (!g) {
    g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', 'mini-hover');
    svg.appendChild(g);
  }
  return g;
}
// --- the strategy over a dragged range ---------------------------------------
// While a range is dragged or pinned, the tooltip also shows the strategy run
// from the range's first day to its last, from the host's run(cfgId, from, to)
// (js/saved-configs.js's strategy panel; the widget registers none). One run
// at a time: while one is out the newest range waits and the ones dragged
// past in between are skipped, so a fast drag never queues a backlog. Results
// live for one drag, so a change of settings between drags is never answered
// from an older run.
let _miniRangeSimHost = null;
function setMiniRangeSim(run) { _miniRangeSimHost = run; }
let _miniRangeSims = new Map(), _miniRangeSimBusy = false, _miniRangeSimWanted = null;
function _miniRangeSimKey(cfgId, from, to) { return `${cfgId}|${from}|${to}`; }
// The run for a range: its result, null when it failed, undefined while running.
function _miniRangeSimFor(cfgId, from, to) {
  const key = _miniRangeSimKey(cfgId, from, to);
  if (!_miniRangeSims.has(key)) { _miniRangeSimWanted = { key, cfgId, from, to }; _miniRangeSimPump(); }
  return _miniRangeSims.get(key);
}
function _miniRangeSimPump() {
  if (_miniRangeSimBusy || !_miniRangeSimWanted) return;
  const job = _miniRangeSimWanted, cache = _miniRangeSims;
  _miniRangeSimWanted = null;
  if (cache.has(job.key)) { _miniRangeSimPump(); return; }
  _miniRangeSimBusy = true;
  // Through a promise, so a host that throws fails this run instead of
  // leaving the queue busy for good.
  Promise.resolve().then(() => _miniRangeSimHost(job.cfgId, job.from, job.to))
    .then(result => cache.set(job.key, result), () => cache.set(job.key, null))
    .finally(() => {
      _miniRangeSimBusy = false;
      if (cache === _miniRangeSims) _miniRangeSimShow(job.key);
      _miniRangeSimPump();
    });
}
// A finished run fills its row block in the tooltip, if that range is still shown.
function _miniRangeSimShow(key) {
  const shown = window._miniRangeShown, tip = document.getElementById('mini-chart-tip');
  const slot = tip && shown && shown.key === key ? tip.querySelector('.mct-sim') : null;
  if (!slot) return;
  slot.outerHTML = _miniRangeSimHtml(_miniRangeSims.get(key));
  _miniPlaceTip(tip, shown.at);
}
// The run's rows, in the main chart's terms: what the portfolio grew to, what
// went in, the profit, then the strategy's CAGR and deepest drawdown.
function _miniRangeSimHtml(sim) {
  const head = '<div class="mct-ev-head">Strategy over this range</div>';
  if (sim === undefined) return `<div class="mct-sim">${head}<div class="mct-sim-wait">Running…</div></div>`;
  if (!sim) return `<div class="mct-sim">${head}<div class="mct-sim-wait">The strategy did not run for this range.</div></div>`;
  const signed = (v, txt) => `<b class="${v >= 0 ? 'mct-pos' : 'mct-neg'}">${v >= 0 ? '+' : '−'}${txt}</b>`;
  const row = (k, v) => `<div class="mct-sim-row"><span>${k}</span>${v}</div>`;
  const rows = [row('Portfolio', `<b>${fmtFull(sim.value)}</b>`)];
  if (sim.invested != null) {
    const profit = sim.value - sim.invested;
    rows.push(row('Invested', `<b>${fmtFull(sim.invested)}</b>`));
    rows.push(row('Profit', signed(profit, fmtFull(Math.abs(profit)) + (sim.invested > 0 ? ` · ${Math.abs(profit / sim.invested * 100).toFixed(1)}%` : ''))));
  }
  rows.push(row('CAGR', signed(sim.cagr, `${Math.abs(sim.cagr).toFixed(1)}%`)));
  rows.push(row('Max drawdown', `<b class="mct-neg">${sim.maxDD > 0 ? '−' : ''}${sim.maxDD.toFixed(1)}%</b>`));
  return `<div class="mct-sim">${head}${rows.join('')}</div>`;
}
function _miniPlaceTip(tip, e) {
  tip.removeAttribute('hidden');
  let left = e.clientX + 14, top = e.clientY + 12;
  if (left + tip.offsetWidth > window.innerWidth - 8) left = e.clientX - tip.offsetWidth - 12;
  if (top + tip.offsetHeight > window.innerHeight - 8) top = e.clientY - tip.offsetHeight - 10;
  // A tall readout (a band with many trades) may not fit either side of the
  // cursor; keep it on screen rather than letting its top run off.
  top = Math.max(8, Math.min(top, window.innerHeight - tip.offsetHeight - 8));
  tip.style.left = left + 'px';
  tip.style.top = top + 'px';
}
// A trade as a person would say it: "Buy TQQQ", "Sell TQQQ", "Sell TQQQ → SQQQ"
// when the proceeds were parked, "Buy TQQQ (from SQQQ)" when a buy left another
// holding, "Switch SQQQ → TQQQ". Cash is where money rests between holdings,
// never something bought or sold, so it is named only as a non-cash destination.
function _miniMoveText(it) {
  const isCash = h => !h || /^cash$/i.test(h);
  if (it.kind === 'sell') return `Sell${isCash(it.from) ? '' : ' ' + it.from}${isCash(it.to) ? '' : ' → ' + it.to}`;
  if (it.kind === 'buy') return `Buy ${it.to}${isCash(it.from) ? '' : ' (from ' + it.from + ')'}`;
  if (it.kind === 'switch') return isCash(it.from) ? `Switch to ${it.to}` : `Switch ${it.from} → ${it.to}`;
  return `${it.label} ${it.to}`;
}
// The trade list for a hovered band: each trade's action, what was held after
// it, the date and the strategy's own note. A dense band lists its first
// trades and counts the rest: the tooltip cannot scroll, and zooming in
// splits the band anyway.
function _miniEventRows(group) {
  const listed = group.items.slice(0, MINI_EVENT.maxListed), unlisted = group.items.length - listed.length;
  return (group.items.length > 1 ? `<div class="mct-ev-head">${group.items.length} trades in this band</div>` : '')
    + listed.map(it => `<div class="mct-ev"><span class="mct-dot" style="background:${it.color};box-shadow:0 0 0 2px ${it.ring}${it.part ? `;clip-path:${_miniWedgeClip(it.part[0], it.part[1])}` : ''}"></span>`
        + `<span>${_escHtml(_miniMoveText(it))}</span><span class="mct-ev-when">${_miniTradeDay(it.date)}</span>`
        + (it.note ? `<div class="mct-ev-note">${_escHtml(it.note)}</div>` : '') + `</div>`).join('')
    + (unlisted > 0 ? `<div class="mct-ev-head">and ${unlisted} more — zoom in to split this band</div>` : '');
}
// Wheel over the chart with the modifier held zooms the time axis around the
// cursor; the panel must not scroll meanwhile, hence passive: false. Without
// the key the event passes through and the panel scrolls as usual. Within
// MINI_ZOOM.rightAnchorPx screen pixels of the plot's right edge the pivot is
// the visible right edge itself, so zooming near the latest price keeps that
// price in place instead of drifting with the cursor.
document.addEventListener('wheel', (e) => {
  const svg = e.target && e.target.closest && e.target.closest('.custom-lines-chart');
  const data = _miniDataOf(svg);
  if (!svg || !data || !data.series.length || !modKeyHeld(e)) return;
  e.preventDefault();
  const span = data.t1 - data.t0, full = data.T1 - data.T0;
  const scale = Math.pow(2, -e.deltaY * (e.deltaMode === 1 ? 0.05 : e.deltaMode ? 1 : MINI_ZOOM.wheelK));
  const next = Math.max(Math.min(MINI_ZOOM.minSpanMs, full), Math.min(full, span / scale));
  if (next === span) return;
  const x = _miniCursorX(svg, e, data);
  const pxPerUnit = svg.getBoundingClientRect().width / data.W, plotW = data.W - data.padL - data.padR;
  // On a narrow panel the zone is capped at half the plot, so the left half still zooms at the cursor.
  const zone = Math.min(MINI_ZOOM.rightAnchorPx, plotW * pxPerUnit / 2);
  const nearRight = (data.W - data.padR - x) * pxPerUnit <= zone;
  const pivot = nearRight ? data.t1 : _miniTimeAtX(data, x);
  const frac = (pivot - data.t0) / span;
  // Both ends from the pivot, so a pivot on an edge keeps that edge exactly
  // (t0 + next can round a fraction of a millisecond off it, enough to read
  // the latest date as off screen).
  let t0 = pivot - frac * next, t1 = pivot + (1 - frac) * next;
  if (t0 < data.T0) { t0 = data.T0; t1 = t0 + next; }
  if (t1 > data.T1) { t1 = data.T1; t0 = t1 - next; }
  if (next >= full) { t0 = data.T0; t1 = data.T1; }
  // At the full range the zoom clears, unless the chart rests on a narrower
  // home view: then the full range is kept as a zoom of its own.
  if (next >= full && !data.home) delete window._miniZooms[data.cfgId];
  else window._miniZooms[data.cfgId] = { t0, t1 };
  _miniChartClearHover();
  _miniChartRerender(data.cfgId);
}, { passive: false });
// The Latest chip: keep the span, end the window at the latest date.
function _miniJumpToLatest(svg) {
  const d = _miniDataOf(svg);
  if (!d || !window._miniZooms[d.cfgId]) return;
  const span = d.t1 - d.t0;
  window._miniZooms[d.cfgId] = { t0: Math.max(d.T0, d.T1 - span), t1: d.T1 };
  _miniChartClearHover();
  _miniChartRerender(d.cfgId);
}
function _miniZoomReset(svg) {
  const d = _miniDataOf(svg);
  if (!d || !window._miniZooms[d.cfgId]) return;
  delete window._miniZooms[d.cfgId];
  _miniChartClearHover();
  _miniChartRerender(d.cfgId);
}
document.addEventListener('dblclick', (e) => {
  const svg = e.target && e.target.closest && e.target.closest('.custom-lines-chart');
  if (svg) _miniZoomReset(svg);
});
document.addEventListener('click', (e) => {
  const svg = e.target && e.target.closest && e.target.closest('.custom-lines-chart');
  if (!svg) return;
  if (e.target.closest('.mini-zoom-reset')) _miniZoomReset(svg);
  if (e.target.closest('.mini-latest')) _miniJumpToLatest(svg);
});
// Mouse down on the chart starts one of two drags. With the modifier held it
// pans the zoomed window: the chart follows the cursor, pixel for pixel, until
// the button is released, and stops at either end of the data (a full view has
// nowhere to go). Without it the drag selects a range, like the main chart's:
// while dragging, the overlay shades the span, draws each line's chord
// between its two endpoints, and the tooltip shows every line's % change
// with the exact from → to values. Auto-clears on release. The range drag
// starts on the plot only: the strip above it belongs to the trade bands.
document.addEventListener('mousedown', (e) => {
  // Any press dismisses a pinned range, as on the main chart; a press on a
  // chart then starts its own drag. Range runs are kept for one drag only.
  if (window._miniPinned) _miniChartClearHover();
  _miniRangeSims = new Map();
  const svg = e.target && e.target.closest && e.target.closest('.custom-lines-chart');
  const data = _miniDataOf(svg);
  if (!svg || !data || !data.series.length) return;
  if (modKeyHeld(e)) {
    const pxPerUnit = svg.getBoundingClientRect().width / data.W;
    window._miniPan = { cfgId: data.cfgId, clientX: e.clientX, t0: data.t0, t1: data.t1, pxPerMs: pxPerUnit * (data.W - data.padL - data.padR) / (data.t1 - data.t0) };
    document.body.classList.add('mini-panning');
    _miniChartClearHover();
    e.preventDefault();
    return;
  }
  if (_miniCursorY(svg, e, data) < data.padT) return;
  window._miniDragAnchor = _miniAnchorFromEvent(svg, e, data);
  window._miniDragCfg = data.cfgId;   // the range belongs to this chart
  e.preventDefault(); // no text selection while dragging
});
document.addEventListener('mouseup', (e) => {
  if (window._miniPan) {
    window._miniPan = null;
    document.body.classList.remove('mini-panning');
  }
  if (!window._miniDragAnchor) return;
  // Shift at release keeps the range and its readout, the main chart's pin,
  // until Escape or the next press.
  const shown = window._miniRangeShown;
  const pin = e.shiftKey && shown && shown.cfgId === window._miniDragCfg;
  window._miniDragAnchor = null;
  window._miniDragCfg = null;
  if (pin) { window._miniPinned = shown.cfgId; return; }
  _miniChartClearHover();
});
// Escape dismisses a pinned range before the page's own Escape handlers see it
// (one closes the strategy panel this chart sits in); the next Escape does that.
window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !window._miniPinned) return;
  _miniChartClearHover();
  e.stopPropagation();
}, true);
document.addEventListener('mousemove', (e) => {
  const pan = window._miniPan;
  if (pan) {
    const data = window._miniCharts[pan.cfgId];
    if (!data) return;
    // The window moves by its right end, so a pan that reaches the latest date
    // lands on it exactly (t0 + span can round a hair short of it).
    const span = pan.t1 - pan.t0;
    const t1 = Math.min(data.T1, Math.max(data.T0 + span, pan.t1 - (e.clientX - pan.clientX) / pan.pxPerMs));
    if (t1 === data.t1) return;
    window._miniZooms[data.cfgId] = { t0: t1 - span, t1 };
    _miniChartRerender(data.cfgId);
    return;
  }
  // A pinned range holds the tooltip until it is dismissed: no hover meanwhile.
  if (window._miniPinned) return;
  const svg = e.target && e.target.closest && e.target.closest('.custom-lines-chart');
  if (!svg) { if (window._miniHoverActive && !window._miniDragAnchor) _miniChartClearHover(); return; }
  const data = _miniDataOf(svg);
  if (!data || !data.series.length) return;
  const yAt = (s, v) => _miniPanelY(data.panels[s.panel], v);   // on the line's own panel
  const plotBottom = data.H - data.padB;
  const g = _miniHoverGroup(svg);
  const tip = _miniChartTipEl();
  const drag = window._miniDragAnchor && window._miniDragCfg === data.cfgId ? window._miniDragAnchor : null;
  window._miniRangeShown = null;   // set again below while the readout is a range

  // The strip above the plot is the trade layer: over a band it lists that
  // band's trades and nothing else; off a band it shows nothing. The value
  // hover below never mentions trades, so the two readouts stay apart.
  if (!drag && _miniCursorY(svg, e, data) < data.padT) {
    const hit = e.target.closest('.mini-zoom-reset, .mini-latest') ? null : _miniEventAt(data, _miniCursorX(svg, e, data));
    _miniHighlightEvent(svg, hit ? hit.index : -1);
    g.innerHTML = '';
    window._miniHoverActive = true;
    if (!hit) { tip.setAttribute('hidden', ''); return; }
    tip.innerHTML = _miniEventRows(hit.group);
    _miniPlaceTip(tip, e);
    return;
  }
  _miniHighlightEvent(svg, -1);
  const anchor = _miniAnchorFromEvent(svg, e, data);

  if (drag && drag.t !== anchor.t) {
    // Range mode: shaded span + per-series chords, % change in the tooltip.
    let lo = drag, hi = anchor;
    if (hi.t < lo.t) { lo = anchor; hi = drag; }
    const xA = _miniXAt(data, lo.t), xB = _miniXAt(data, hi.t);
    const spans = data.series.map(s => ({ ...s, p0: _miniPtAt(s.pts, lo.t), p1: _miniPtAt(s.pts, hi.t) })).filter(s => s.p0 && s.p1);
    // Chords and their badges for each panel's first line, its reading; the
    // levels are listed in the readout.
    const readings = data.panels.map((_, p) => spans.find(s => s.panel === p)).filter(Boolean);
    g.innerHTML = `<rect x="${xA.toFixed(1)}" y="${data.padT}" width="${(xB - xA).toFixed(1)}" height="${(plotBottom - data.padT).toFixed(2)}" fill="rgba(134,118,255,0.10)"/>`
      + `<line x1="${xA.toFixed(1)}" y1="${data.padT}" x2="${xA.toFixed(1)}" y2="${plotBottom}" stroke="rgba(56,56,116,0.35)" stroke-width="0.3" stroke-dasharray="2,2"/>`
      + `<line x1="${xB.toFixed(1)}" y1="${data.padT}" x2="${xB.toFixed(1)}" y2="${plotBottom}" stroke="rgba(56,56,116,0.35)" stroke-width="0.3" stroke-dasharray="2,2"/>`
      + readings.map(s => {
          const y0 = yAt(s, s.p0.v).toFixed(1), y1 = yAt(s, s.p1.v).toFixed(1);
          return `<line x1="${xA.toFixed(1)}" y1="${y0}" x2="${xB.toFixed(1)}" y2="${y1}" stroke="${s.color}" stroke-width="0.5" stroke-dasharray="2,1.5"/>
            <circle cx="${xA.toFixed(1)}" cy="${y0}" r="0.9" fill="${s.color}" stroke="#fff" stroke-width="0.3"/>
            <circle cx="${xB.toFixed(1)}" cy="${y1}" r="0.9" fill="${s.color}" stroke="#fff" stroke-width="0.3"/>`;
        }).join('')
      // Each chord's midpoint gets a badge naming the line and its % change,
      // green/red by sign, at a fixed pixel size (hence the divisions by k),
      // pushed apart when chords run close together and kept inside the plot,
      // and with more than one panel inside the chord's own panel.
      + (() => {
          const k = data.k, fs = 7 / k, ch = fs * 0.6, lh = 10 / k, padX = 3 / k;
          const mids = data.panels.flatMap((P, p) => {
            const own = readings.filter(s => s.panel === p).map(s => {
              const move = _miniRangeMove(s.unit, s.p0.v, s.p1.v);
              return { y: (yAt(s, s.p0.v) + yAt(s, s.p1.v)) / 2 - lh / 2, move, label: s.label };
            }).sort((a, b) => a.y - b.y);
            for (let i = 1; i < own.length; i++) if (own[i].y - own[i - 1].y < lh) own[i].y = own[i - 1].y + lh;
            if (data.panels.length > 1) for (let i = own.length - 1; i >= 0; i--) {
              const max = i === own.length - 1 ? P.bottom - lh * 0.3 : own[i + 1].y - lh;
              if (own[i].y > max) own[i].y = max;
            }
            return own;
          });
          return mids.map(m => {
            const pctTxt = m.move.text;
            const col = m.move.up ? '#00b929' : '#dc2626';
            const tw = (m.label.length + 1 + pctTxt.length) * ch;
            const xM = Math.max(data.padL + tw / 2 + padX, Math.min(data.W - data.padR - tw / 2 - padX, (xA + xB) / 2));
            return `<rect x="${(xM - tw / 2 - padX).toFixed(1)}" y="${(m.y - lh * 0.72).toFixed(1)}" width="${(tw + 2 * padX).toFixed(1)}" height="${lh.toFixed(2)}" rx="${(3 / k).toFixed(2)}" fill="#fff" stroke="${col}" stroke-width="${(0.8 / k).toFixed(2)}"/>
              <text x="${xM.toFixed(1)}" y="${m.y.toFixed(1)}" text-anchor="middle" font-family="JetBrains Mono" font-size="${fs.toFixed(2)}" font-weight="600"><tspan fill="rgba(56,56,116,0.85)">${_escHtml(m.label)} </tspan><tspan fill="${col}" font-weight="700">${pctTxt}</tspan></text>`;
          }).join('');
        })();
    const simKey = _miniRangeSimHost ? _miniRangeSimKey(data.cfgId, lo.d, hi.d) : null;
    // Each reading from the range's start to its end, coloured by direction,
    // and its levels at the end; the chords' badges carry the moves.
    tip.innerHTML = `<div class="mct-date">${fmtLogDate(lo.d)} – ${fmtLogDate(hi.d)}</div>`
      + _miniPanelRows(data, spans,
          s => `<span class="mct-from">${_miniFmtReadout(s.unit, s.p0.v)} →</span> <b class="${s.p1.v >= s.p0.v ? 'mct-pos' : 'mct-neg'}">${_miniFmtReadout(s.unit, s.p1.v)}</b>`,
          s => _miniFmtReadout(s.unit, s.p1.v))
      + (simKey ? _miniRangeSimHtml(_miniRangeSimFor(data.cfgId, lo.d, hi.d)) : '');
    _miniPlaceTip(tip, e);
    window._miniRangeShown = { cfgId: data.cfgId, key: simKey, at: { clientX: e.clientX, clientY: e.clientY } };
    window._miniHoverActive = true;
    return;
  }

  // A trade mark under the cursor answers for its trade instead of the values.
  const mark = drag ? null : _miniMarkAt(svg, e, data);
  if (mark) {
    g.innerHTML = `<circle cx="${mark.x.toFixed(2)}" cy="${mark.y.toFixed(2)}" r="${(mark.r + 2.5 / data.k).toFixed(2)}" fill="none" stroke="${mark.item.color}" stroke-width="${(1 / data.k).toFixed(2)}"/>`;
    tip.innerHTML = _miniEventRows({ items: [mark.item] });
    _miniPlaceTip(tip, e);
    window._miniHoverActive = true;
    return;
  }

  // Plain hover: crosshair + values at the snapped day.
  const cx = _miniXAt(data, anchor.t);
  const hits = data.series.map(s => ({ ...s, pt: _miniPtAt(s.pts, anchor.t) })).filter(h => h.pt);
  g.innerHTML = `<line x1="${cx.toFixed(1)}" y1="${data.padT}" x2="${cx.toFixed(1)}" y2="${plotBottom}" stroke="rgba(56,56,116,0.35)" stroke-width="0.3" stroke-dasharray="2,2"/>`
    + hits.map(h => `<circle cx="${cx.toFixed(1)}" cy="${yAt(h, h.pt.v).toFixed(1)}" r="0.5" fill="${h.color}" stroke="#fff" stroke-width="0.25"/>`).join('');
  tip.innerHTML = `<div class="mct-date">${fmtLogDate(anchor.d)}</div>`
    + _miniPanelRows(data, hits, h => `<b>${_miniFmtReadout(h.unit, h.pt.v)}</b>`, h => _miniFmtReadout(h.unit, h.pt.v));
  _miniPlaceTip(tip, e);
  window._miniHoverActive = true;
});

// Series colours for the signal mini chart. The first declared line (usually
// the traded fund's own price) wears the strategy's colour, so it matches that
// strategy's line on the main chart; the rest come from this palette in fixed
// order. Every line is on screen at once, so the six were chosen to clear the
// dataviz validator's floors under ALL pairings: at worst OKLab ΔE 18.2 as
// seen and 9.5 under protan/deutan simulation (floors 15 and 6). The yellow
// sits last of the six because it is the one below 3:1 contrast on the panel.
// The two after it are reserves, also clear of every other entry: a strategy
// coloured close to two palette entries pushes both to the end, and with six
// lines declared it would otherwise have to reuse one of them. At render time
// an entry closer than those floors to the strategy's own colour moves to the
// end of the order, so it is used only once the others run out. This is what
// used to put a green "Overextended" line beside a green price line.
const CUSTOM_MINI_COLORS = ['#4f46e5', '#e34948', '#0d9488', '#a21caf', '#854d0e', '#eda100', '#7788ff', '#ff44bb'];
const LINE_COLOR_FLOORS = { normal: 15, cvd: 6 };
function customLineColor(cfg, i) {
  if (i === 0) return cfg.color;
  const farEnough = c => { const s = colorSeparation(c, cfg.color); return s.normal >= LINE_COLOR_FLOORS.normal && s.cvd >= LINE_COLOR_FLOORS.cvd; };
  const order = [...CUSTOM_MINI_COLORS.filter(farEnough), ...CUSTOM_MINI_COLORS.filter(c => !farEnough(c))];
  return order[(i - 1) % order.length];
}
// The panel a declared line draws in: its group's name, "" for the first panel.
function customLineGroup(ln) { return (ln && ln.group) || ''; }
// A declared line's colour by its place in its own group, so the first line
// of each panel wears the strategy's colour and the rest take the palette.
function customLineColorAt(cfg, lines, i) {
  const group = customLineGroup(lines[i]);
  let place = 0;
  for (let j = 0; j < i; j++) if (customLineGroup(lines[j]) === group) place++;
  return customLineColor(cfg, place);
}
