// js/signal-chart.js — the signal chart: a strategy's declared lines on their
// own log scale with its trades, plus every interaction on it (hover readout,
// trade-band hover, ⌘/Ctrl + scroll zoom, ⌘/Ctrl + drag pan, plain-drag range
// readout, Reset and Latest). It draws whatever rows its host hands it and
// redraws through the host (setMiniChartHost): the strategy panel in
// js/saved-configs.js, and the desktop widget page (widget.html,
// js/widget-page.js). Formatting, colour and trade-marker helpers come from
// js/utils.js and js/chart.js; _escHtml from js/saved-configs.js.

// Where the live chart is drawn. The page showing a signal chart registers a
// function that redraws it in place from its own rows, width and the zoom.
// One chart is live at a time.
let _miniChartHost = null;
function setMiniChartHost(redraw) { _miniChartHost = redraw; }
function _miniChartRerender() { if (_miniChartHost) _miniChartHost(); }

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
// Drawn points per pixel of plot width before a window is decimated.
const MINI_POINTS_PER_PX = 2;
// Pixel sizes, divided by the render scale when used: the trade strip above
// the plot (the event hover lives there, apart from the value hover on the
// plot), the room under the plot for the date labels, and the baseline gap
// between plot and labels.
const MINI_PX = { strip: 12, axis: 14, labelGap: 10 };
// Chart width (px) up to which text keeps its px size; the panel's default
// width. Beyond it text scales by sqrt(width / this): 1.6× at 1000px.
const MINI_TEXT_REF_W = 400;
// Trade-event areas, in viewBox units: each band's half width, the gap under
// which neighbouring trades merge into one band (two bands closer than this
// would overlap and hide each other), the widest a merged band may grow
// before the next trade starts a new one (on a long view, trades weeks apart
// would otherwise chain into one band covering months), how far outside a
// band the hover still counts as on it, how many trades a hover lists, and
// the widest window (eight months) that still shows a mark at each trade's
// crossing — on a longer view the bands say enough and the marks would only
// speckle the lines.
const MINI_EVENT = { halfW: 1.2, mergeX: 4, maxSpanX: 10, hoverPad: 1.5, maxListed: 8, marksWithinMs: 8 * 30.4375 * 86400000 };
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
const _miniShortDate = t => { const d = new Date(t); return `${d.getUTCDate()} ${MINI_MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
const MINI_MOD_KEY = /Mac|iPhone|iPad/.test(navigator.platform || '') ? '⌘' : 'Ctrl';
const _miniModHeld = e => e.metaKey || e.ctrlKey;
window._miniZoom = window._miniZoom || null;   // { cfgId, t0, t1 }, or null for the full range
// fmt() rounds sub-$1000 values to whole dollars, which turns the low end of
// a log axis (TQQQ opened at $0.42) into a "$0" label — keep decimals on
// small prices instead.
function _miniFmtPrice(v) { return v >= 1000 ? fmt(v) : '$' + (v < 10 ? v.toFixed(2) : String(Math.round(v))); }
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
function buildCustomLinesChartHtml(cfg, lines, log, cw) {
  const all = [];
  lines.forEach((ln, i) => {
    if (!customLineShown(cfg, ln.key)) return;
    // A row without a value for this key breaks the line. A strategy can
    // declare a line that only exists while a condition holds (a buy-back
    // level behind a slope gate, say) by logging null on the other days.
    // `gap` marks the first point after a break: the path restarts there and
    // the hover shows nothing for the series inside the break.
    const pts = [];
    let broken = false;
    for (const r of log) {
      if (!r || r.date == null) continue;
      const v = r[ln.key];
      if (typeof v === 'number' && isFinite(v) && v > 0) {
        pts.push({ t: Date.parse(r.date), v, d: String(r.date), gap: broken && pts.length > 0 });
        broken = false;
      } else broken = true;
    }
    if (pts.length > 1) all.push({ label: ln.label, color: customLineColor(cfg, i), pts });
  });
  window._miniChartHover = null;
  if (!all.length) return '';

  const { W, H, padL } = MINI_CHART;
  const kPx = Math.max(1, (cw || W) / W);   // render scale: screen px per viewBox unit
  // Text, margins, ticks and buttons are sized in px and divided by k: the
  // render scale up to MINI_TEXT_REF_W, eased past it so they grow with the
  // square root of the extra width (see the module comment above).
  const k = kPx / Math.sqrt(Math.max(1, (cw || W) / MINI_TEXT_REF_W));
  const padT = MINI_PX.strip / k, padB = MINI_PX.axis / k;
  // The full extent, then the zoom window inside it. A zoom saved from an
  // older, longer run is clamped so it can never show an empty plot.
  let T0 = Infinity, T1 = -Infinity;
  for (const s of all) { T0 = Math.min(T0, s.pts[0].t); T1 = Math.max(T1, s.pts[s.pts.length - 1].t); }
  if (!(T1 > T0)) return '';
  const z = window._miniZoom && window._miniZoom.cfgId === cfg.id ? window._miniZoom : null;
  const minSpan = Math.min(MINI_ZOOM.minSpanMs, T1 - T0);
  const t0 = z ? Math.max(T0, Math.min(z.t0, T1 - minSpan)) : T0;
  const t1 = z ? Math.min(T1, Math.max(z.t1, t0 + minSpan)) : T1;
  const zoomed = t0 > T0 || t1 < T1;
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
    return { label: s.label, color: s.color, pts, scalePts: inWindow.length ? inWindow : pts, endPt, shown: inWindow.length > 0, partial: endPt.t < t1 - endTol };
  }).filter(s => s.pts.length > 1);
  if (!series.length) return '';
  // Right gutter fits "$value  series name" on one line (both descaled, JetBrains
  // Mono advance ≈ 0.6em), capped so a narrow panel keeps a usable plot area —
  // when capped, long names clip at the right edge instead of covering lines.
  const _valTxt = v => v >= 1000 ? fmt(v) : '$' + v.toFixed(2);
  const gutterSeries = series.filter(s => s.shown && !s.partial);
  const valColW = gutterSeries.length ? Math.max(...gutterSeries.map(s => _valTxt(s.endPt.v).length)) * (9 / k) * 0.6 : 0;
  const nameColW = gutterSeries.length ? Math.max(...gutterSeries.map(s => s.label.length)) * (7 / k) * 0.6 : 0;
  const padR = Math.min(4 / k + valColW + 4 / k + nameColW + 2 / k, 0.45 * W);
  let lo = Infinity, hi = -Infinity;
  for (const s of series) for (const p of s.scalePts) { if (p.v < lo) lo = p.v; if (p.v > hi) hi = p.v; }
  if (!(hi > 0)) return '';
  const l0 = Math.log10(lo), l1 = Math.log10(hi);
  const lPad = Math.max((l1 - l0) * 0.05, 0.01);
  const yLo = l0 - lPad, yHi = l1 + lPad;
  const plotW = W - padL - padR, plotH = H - padT - padB, plotBottom = padT + plotH;
  const budget = Math.ceil(plotW * kPx * MINI_POINTS_PER_PX);
  for (const s of series) s.drawPts = _miniDecimate(s.pts, budget);
  const xAt = t => padL + (t - t0) / (t1 - t0) * plotW;
  const yAt = v => padT + (yHi - Math.log10(v)) / (yHi - yLo) * plotH;
  const fmtP = _miniFmtPrice;
  // Trade events: a band at each trade's date across the plot, a cap in the
  // strip above it where the hover answers for them, and a mark at the trade's
  // crossing on the first drawn line, coloured by action (the main chart's
  // marker vocabulary, via customMarkerEvents). Trades a few days apart would stack
  // unreadably, so events closer than MINI_EVENT.mergeX fold into one band
  // whose hover lists them all. Logged in date order, so one pass groups them.
  const eventGroups = [];
  for (const ev of customMarkerEvents(log)) {
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
    const part = kind === 'buy' ? customTradeShare(log, ev.i) : null;
    const item = { x, t, date: String(ev.row.date), kind, label: ev.st.label, color: ev.st.color, shape: ev.st.shape, from, to, held: to, part,
      ring: assetKey ? MINI_ASSET_RING[assetKey] : 'rgba(255,255,255,0.95)', dashed: !!(assetKey && MINI_ASSET_DASHED[assetKey]), note: String(ev.row.note || '') };
    const last = eventGroups[eventGroups.length - 1];
    if (last && x - last.x1 < MINI_EVENT.mergeX && x - last.x0 <= MINI_EVENT.maxSpanX) { last.items.push(item); last.x1 = x; }
    else eventGroups.push({ x0: x, x1: x, items: [item] });
  }
  const events = eventGroups.map(g => ({ x0: g.x0 - MINI_EVENT.halfW, x1: g.x1 + MINI_EVENT.halfW, items: g.items }));
  // Everything the hover and zoom handlers need to resolve a cursor position
  // back to dates, values and bands. One custom panel is open at a time, so a
  // single slot (always the most recently built chart) is enough.
  window._miniChartHover = { series, t0, t1, T0, T1, yLo, yHi, W, H, padL, padT, padB, padR, k, events, cfgId: cfg.id, zoomed };

  // Horizontal gridlines at three log-spaced levels, labeled with fmt().
  let grid = '';
  for (let g = 0; g < 3; g++) {
    const lv = Math.pow(10, yLo + (yHi - yLo) * (0.15 + 0.35 * g));
    const y = yAt(lv).toFixed(1);
    grid += `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="rgba(122,122,166,0.14)" stroke-width="0.5"/>
      <text x="${padL + 1}" y="${(+y - 2).toFixed(1)}" font-family="JetBrains Mono" font-size="${(8 / k).toFixed(2)}" fill="rgba(122,122,166,0.75)" stroke="rgba(255,255,255,0.95)" stroke-width="${(2 / k).toFixed(2)}" stroke-linejoin="round" paint-order="stroke">${fmtP(lv)}</text>`;
  }
  // Date labels just under the plot. Centers are clamped inside the viewBox so
  // the first and last never render half-cut at the edges, and a label that
  // would touch the one before it is dropped (JetBrains Mono advance ≈ 0.6em).
  const yLabel = (plotBottom + MINI_PX.labelGap / k).toFixed(1);
  const axisFs = 8 / k, axisCharW = 0.6 * axisFs, axisGap = 6 / k;
  let xAxis = '', lastRight = -Infinity;
  for (const tk of _miniTimeTicks(t0, t1, 6)) {
    const half = tk.label.length * axisCharW / 2;
    const lx = Math.max(half, Math.min(W - half, xAt(tk.t)));
    if (lx - half < lastRight + axisGap) continue;
    lastRight = lx + half;
    xAxis += `<text x="${lx.toFixed(1)}" y="${yLabel}" text-anchor="middle" font-family="JetBrains Mono" font-size="${axisFs.toFixed(2)}" fill="rgba(122,122,166,0.75)">${tk.label}</text>`;
  }
  // The strip's right end, inside the gutter so it never covers a trade cap:
  // how to zoom while at full range; the factor, the pan hint and a Reset
  // button while zoomed (the click handler below; a double-click anywhere also
  // resets). A hint that would not fit the gutter is shortened or dropped;
  // the button's tooltip always carries the full instructions.
  const hintAttrs = `y="${(8.5 / k).toFixed(2)}" text-anchor="end" font-family="JetBrains Mono" font-size="${(7 / k).toFixed(2)}" stroke="rgba(255,255,255,0.95)" stroke-width="${(2 / k).toFixed(2)}" stroke-linejoin="round" paint-order="stroke"`;
  const hintW = txt => txt.length * 0.6 * (7 / k);   // JetBrains Mono advance
  let zoomUi = '';
  if (!zoomed) {
    const hint = `${MINI_MOD_KEY} + scroll to zoom`;
    if (hintW(hint) <= padR - 4 / k) zoomUi = `<text x="${(W - 2 / k).toFixed(1)}" ${hintAttrs} fill="rgba(122,122,166,0.6)">${hint}</text>`;
  } else {
    const factor = ((T1 - T0) / (t1 - t0)).toFixed(1);
    const btnW = 50 / k, btnH = 10 / k, btnX = W - 2 / k - btnW, btnY = 1 / k;
    const resetBtn = `<g class="mini-zoom-reset" role="button"><title>Back to the full range. ${MINI_MOD_KEY} + scroll zooms, ${MINI_MOD_KEY} + drag pans.</title><rect x="${btnX.toFixed(1)}" y="${btnY.toFixed(2)}" width="${btnW.toFixed(1)}" height="${btnH.toFixed(2)}" rx="${(3 / k).toFixed(2)}"/><text x="${(btnX + btnW / 2).toFixed(1)}" y="${(btnY + 7.3 / k).toFixed(2)}" text-anchor="middle" font-family="JetBrains Mono" font-size="${(7 / k).toFixed(2)}" font-weight="600">Reset zoom</text></g>`;
    if (atEnd) {
      const long = `×${factor} · ${MINI_MOD_KEY} + drag to pan`;
      const hint = hintW(long) <= padR - btnW - 8 / k ? long : `×${factor}`;
      zoomUi = `<text x="${(btnX - 4 / k).toFixed(1)}" ${hintAttrs} fill="rgba(122,122,166,0.9)">${hint}</text>${resetBtn}`;
    } else {
      // Panned away from the end: a Latest chip in place of the hint says so,
      // and a click brings the window back to the latest date at the same zoom.
      const chipW = 38 / k, chipX = btnX - 4 / k - chipW;
      const short = `×${factor}`;
      const hint = hintW(short) <= padR - btnW - chipW - 12 / k ? `<text x="${(chipX - 4 / k).toFixed(1)}" ${hintAttrs} fill="rgba(122,122,166,0.9)">${short}</text>` : '';
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
      `<circle cx="${xEnd}" cy="${yAt(s.endPt.v).toFixed(1)}" r="${(1.4 / k).toFixed(2)}" fill="${s.color}" stroke="rgba(255,255,255,0.95)" stroke-width="${(0.7 / k).toFixed(2)}"/>`).join('');
    latestMark = `<line class="mini-latest-line" x1="${xEnd}" y1="${padT.toFixed(2)}" x2="${xEnd}" y2="${plotBottom.toFixed(2)}" stroke="rgba(122,122,166,0.55)" stroke-width="${(0.6 / k).toFixed(2)}" stroke-dasharray="${(1.6 / k).toFixed(2)} ${(1.6 / k).toFixed(2)}"/>
      <text class="mini-latest-label" x="${(W - padR - 2 / k).toFixed(1)}" y="${(padT + 7.5 / k).toFixed(2)}" text-anchor="end" font-family="JetBrains Mono" font-size="${(7 / k).toFixed(2)}" font-weight="600" fill="rgba(122,122,166,0.95)" stroke="rgba(255,255,255,0.95)" stroke-width="${(2 / k).toFixed(2)}" stroke-linejoin="round" paint-order="stroke">latest · ${_miniShortDate(T1)}</text>${dots}`;
  }

  // Polylines + right-edge end labels (pushed apart when endpoints collide).
  let paths = '';
  const ends = [];
  for (const s of series) {
    let d = '';
    for (const p of s.drawPts) d += (!d || p.gap ? 'M' : 'L') + xAt(p.t).toFixed(1) + ',' + yAt(p.v).toFixed(1);
    paths += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="0.45"/>`;
    if (s.shown && !s.partial) ends.push({ y: yAt(s.endPt.v), v: s.endPt.v, color: s.color, name: s.label });
  }
  // Partial lines: name and last value beside the line's end, to its right when
  // that fits inside the plot, else to its left.
  let lineTags = '';
  for (const s of series.filter(s => s.shown && s.partial)) {
    const x = xAt(s.endPt.t), txt = `${s.label} ${_valTxt(s.endPt.v)}`;
    const y = Math.max(padT + 6 / k, Math.min(plotBottom - 1 / k, yAt(s.endPt.v) + 2.5 / k));
    const right = x + 3 / k + txt.length * 0.6 * (7 / k) <= W - padR;
    lineTags += `<text class="mini-line-tag" x="${(right ? x + 3 / k : x - 3 / k).toFixed(1)}" y="${y.toFixed(1)}" text-anchor="${right ? 'start' : 'end'}" font-family="JetBrains Mono" font-size="${(7 / k).toFixed(2)}" font-weight="600" fill="${s.color}" stroke="rgba(255,255,255,0.95)" stroke-width="${(2 / k).toFixed(2)}" stroke-linejoin="round" paint-order="stroke">${_escHtml(txt)}</text>`;
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

  // Bands across the plot, caps in the strip, and once the window is under
  // MINI_EVENT.marksWithinMs one mark per trade where it happened: on the first
  // drawn line at that day's close, so a sell sits where the price broke the
  // line and a buy where it came back (a trade inside a gap of that line gets
  // no mark). Each mark is drawn twice, a white halo under the symbol, and
  // remembered in data.marks for the hover. Lines, bands and marks are clipped
  // to the plot, since a zoomed line keeps one point beyond each edge.
  const clipId = 'mini-clip-' + String(cfg.id).replace(/[^\w-]/g, '');
  const eventBands = events.map((g, i) =>
    `<rect class="mini-ev" data-mini-ev="${i}" x="${g.x0.toFixed(1)}" y="${padT.toFixed(2)}" width="${(g.x1 - g.x0).toFixed(1)}" height="${plotH.toFixed(2)}"/>`).join('');
  const eventCaps = events.map((g, i) =>
    `<rect class="mini-ev-cap" data-mini-ev="${i}" x="${g.x0.toFixed(1)}" y="0" width="${(g.x1 - g.x0).toFixed(1)}" height="${padT.toFixed(2)}"/>`).join('');
  const markR = MINI_MARK.r / k, ringW = MINI_MARK.ring / k;
  const marks = t1 - t0 >= MINI_EVENT.marksWithinMs ? [] : events.flatMap(g => g.items).map(it => {
    const pt = _miniPtAt(series[0].pts, it.t);
    return pt ? { x: it.x, y: yAt(pt.v), r: markR, item: it } : null;
  }).filter(Boolean);
  window._miniChartHover.marks = marks;
  const eventMarks = marks.map(m => {
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
  }).join('');

  return `<svg class="custom-lines-chart" viewBox="0 0 ${W} ${H}"><defs><clipPath id="${clipId}"><rect x="${padL}" y="${padT.toFixed(2)}" width="${plotW.toFixed(1)}" height="${plotH.toFixed(2)}"/></clipPath></defs>${grid}<g clip-path="url(#${clipId})">${eventBands}${paths}${eventMarks}</g>${latestMark}${lineTags}${eventCaps}${endLabels}${xAxis}${zoomUi}</svg>`;
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
  const g = document.querySelector('.custom-lines-chart .mini-hover');
  if (g) g.remove();
  _miniHighlightEvent(document.querySelector('.custom-lines-chart'), -1);
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
        + `<span>${_escHtml(_miniMoveText(it))}</span><span class="mct-ev-when">${fmtLogDate(it.date)}</span>`
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
  const data = window._miniChartHover;
  if (!svg || !data || !data.series.length || !_miniModHeld(e)) return;
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
  let t0 = pivot - frac * next, t1 = t0 + next;
  if (t0 < data.T0) { t0 = data.T0; t1 = t0 + next; }
  if (t1 > data.T1) { t1 = data.T1; t0 = t1 - next; }
  window._miniZoom = next >= full ? null : { cfgId: data.cfgId, t0, t1 };
  _miniChartClearHover();
  _miniChartRerender();
}, { passive: false });
// The Latest chip: keep the span, end the window at the latest date.
function _miniJumpToLatest() {
  const d = window._miniChartHover;
  if (!d || !window._miniZoom) return;
  const span = d.t1 - d.t0;
  window._miniZoom = { cfgId: d.cfgId, t0: Math.max(d.T0, d.T1 - span), t1: d.T1 };
  _miniChartClearHover();
  _miniChartRerender();
}
function _miniZoomReset() {
  if (!window._miniZoom) return;
  window._miniZoom = null;
  _miniChartClearHover();
  _miniChartRerender();
}
document.addEventListener('dblclick', (e) => {
  if (e.target && e.target.closest && e.target.closest('.custom-lines-chart')) _miniZoomReset();
});
document.addEventListener('click', (e) => {
  if (e.target && e.target.closest && e.target.closest('.mini-zoom-reset')) _miniZoomReset();
  if (e.target && e.target.closest && e.target.closest('.mini-latest')) _miniJumpToLatest();
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
  const svg = e.target && e.target.closest && e.target.closest('.custom-lines-chart');
  const data = window._miniChartHover;
  if (!svg || !data || !data.series.length) return;
  if (_miniModHeld(e)) {
    const pxPerUnit = svg.getBoundingClientRect().width / data.W;
    window._miniPan = { clientX: e.clientX, t0: data.t0, t1: data.t1, pxPerMs: pxPerUnit * (data.W - data.padL - data.padR) / (data.t1 - data.t0) };
    document.body.classList.add('mini-panning');
    _miniChartClearHover();
    e.preventDefault();
    return;
  }
  if (_miniCursorY(svg, e, data) < data.padT) return;
  window._miniDragAnchor = _miniAnchorFromEvent(svg, e, data);
  e.preventDefault(); // no text selection while dragging
});
document.addEventListener('mouseup', () => {
  if (window._miniPan) {
    window._miniPan = null;
    document.body.classList.remove('mini-panning');
  }
  if (!window._miniDragAnchor) return;
  window._miniDragAnchor = null;
  _miniChartClearHover();
});
document.addEventListener('mousemove', (e) => {
  const pan = window._miniPan;
  if (pan) {
    const data = window._miniChartHover;
    if (!data) return;
    const span = pan.t1 - pan.t0;
    const t0 = Math.max(data.T0, Math.min(pan.t0 - (e.clientX - pan.clientX) / pan.pxPerMs, data.T1 - span));
    if (t0 === data.t0) return;
    window._miniZoom = { cfgId: data.cfgId, t0, t1: t0 + span };
    _miniChartRerender();
    return;
  }
  const svg = e.target && e.target.closest && e.target.closest('.custom-lines-chart');
  if (!svg) { if (window._miniHoverActive && !window._miniDragAnchor) _miniChartClearHover(); return; }
  const data = window._miniChartHover;
  if (!data || !data.series.length) return;
  const yAt = v => data.padT + (data.yHi - Math.log10(v)) / (data.yHi - data.yLo) * (data.H - data.padT - data.padB);
  const plotBottom = data.H - data.padB;
  const g = _miniHoverGroup(svg);
  const tip = _miniChartTipEl();
  const drag = window._miniDragAnchor;

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
    g.innerHTML = `<rect x="${xA.toFixed(1)}" y="${data.padT}" width="${(xB - xA).toFixed(1)}" height="${(plotBottom - data.padT).toFixed(2)}" fill="rgba(134,118,255,0.10)"/>`
      + `<line x1="${xA.toFixed(1)}" y1="${data.padT}" x2="${xA.toFixed(1)}" y2="${plotBottom}" stroke="rgba(56,56,116,0.35)" stroke-width="0.3" stroke-dasharray="2,2"/>`
      + `<line x1="${xB.toFixed(1)}" y1="${data.padT}" x2="${xB.toFixed(1)}" y2="${plotBottom}" stroke="rgba(56,56,116,0.35)" stroke-width="0.3" stroke-dasharray="2,2"/>`
      + spans.map(s => {
          const y0 = yAt(s.p0.v).toFixed(1), y1 = yAt(s.p1.v).toFixed(1);
          return `<line x1="${xA.toFixed(1)}" y1="${y0}" x2="${xB.toFixed(1)}" y2="${y1}" stroke="${s.color}" stroke-width="0.5" stroke-dasharray="2,1.5"/>
            <circle cx="${xA.toFixed(1)}" cy="${y0}" r="0.9" fill="${s.color}" stroke="#fff" stroke-width="0.3"/>
            <circle cx="${xB.toFixed(1)}" cy="${y1}" r="0.9" fill="${s.color}" stroke="#fff" stroke-width="0.3"/>`;
        }).join('')
      // Each chord's midpoint gets a badge naming the line and its % change,
      // green/red by sign, at a fixed pixel size (hence the divisions by k),
      // pushed apart when chords run close together and kept inside the plot.
      + (() => {
          const k = data.k, fs = 7 / k, ch = fs * 0.6, lh = 10 / k, padX = 3 / k;
          const mids = spans.map(s => {
            const pct = s.p0.v > 0 ? (s.p1.v / s.p0.v - 1) * 100 : 0;
            return { y: (yAt(s.p0.v) + yAt(s.p1.v)) / 2 - lh / 2, pct, label: s.label };
          }).sort((a, b) => a.y - b.y);
          for (let i = 1; i < mids.length; i++) if (mids[i].y - mids[i - 1].y < lh) mids[i].y = mids[i - 1].y + lh;
          return mids.map(m => {
            const pctTxt = (m.pct >= 0 ? '+' : '') + m.pct.toFixed(1) + '%';
            const col = m.pct >= 0 ? '#00b929' : '#dc2626';
            const tw = (m.label.length + 1 + pctTxt.length) * ch;
            const xM = Math.max(data.padL + tw / 2 + padX, Math.min(data.W - data.padR - tw / 2 - padX, (xA + xB) / 2));
            return `<rect x="${(xM - tw / 2 - padX).toFixed(1)}" y="${(m.y - lh * 0.72).toFixed(1)}" width="${(tw + 2 * padX).toFixed(1)}" height="${lh.toFixed(2)}" rx="${(3 / k).toFixed(2)}" fill="#fff" stroke="${col}" stroke-width="${(0.8 / k).toFixed(2)}"/>
              <text x="${xM.toFixed(1)}" y="${m.y.toFixed(1)}" text-anchor="middle" font-family="JetBrains Mono" font-size="${fs.toFixed(2)}" font-weight="600"><tspan fill="rgba(56,56,116,0.85)">${_escHtml(m.label)} </tspan><tspan fill="${col}" font-weight="700">${pctTxt}</tspan></text>`;
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
    + hits.map(h => `<circle cx="${cx.toFixed(1)}" cy="${yAt(h.pt.v).toFixed(1)}" r="0.5" fill="${h.color}" stroke="#fff" stroke-width="0.25"/>`).join('');
  tip.innerHTML = `<div class="mct-date">${fmtLogDate(anchor.d)}</div>`
    + hits.map(h => `<div class="mct-row"><span class="mct-dot" style="background:${h.color}"></span>${_escHtml(h.label)}<b>${_miniFmtPrice(h.pt.v)}</b></div>`).join('');
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
