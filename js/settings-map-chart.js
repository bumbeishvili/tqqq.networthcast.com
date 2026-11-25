// The settings map's scatter (js/settings-map.js): one dot per set of
// settings, its max drawdown across and its CAGR up, with dashed lines through
// the settings as they are that split the plot in four.
//
// Built on the reusable D3 chart convention (.claude/skills/d3-charts): all
// state in one `attrs` object with chainable accessors, _add() so a re-render
// updates elements instead of appending duplicates, width taken from the
// container and redrawn on resize. A map holds thousands of dots, so they go
// on a canvas under the SVG, which carries the axes, the marks and the
// pointer. It only draws: what a dot stands for and the tooltip's text belong
// to the caller, which hears about the pointer through onHover / onLeave /
// onPick.
//
//   new SettingsMapChart().container(el).svgHeight(360).data(dots).now({ x, y }).render();
//   dots: [{ id, x, y, size }]   x, y in percent; size 0..1 (bigger = larger dot) or null (a plain small dot)
//
// Colours come from CSS custom properties on the plot (.settings-map-plot in
// styles.css), read at every render. d3 loads deferred (index.html), so
// nothing here touches it before the first instance is made.
class SettingsMapChart {
  constructor() {
    const attrs = {
      id: 'ID' + Math.floor(Math.random() * 1000000),
      svgWidth: 400,
      svgHeight: 360,
      marginTop: 12,       // half a tick label's height on a phone's larger type, so the top label is whole
      marginBottom: 36,
      marginRight: 10,
      marginLeft: 58,      // the tick labels and, along the edge, the y axis' name
      container: 'body',
      data: null,
      now: null,           // { x, y }: the dashed lines cross here; none without it
      picked: null,        // the picked dot's id: a ring around it
      link: null,          // { x, y }: a second point the picked dot is tied to with a line
      linkLabel: '',       // the name written at that point
      frontier: null,      // [{ x, y }] by x: a step line through them
      flags: null,         // [{ id, x, y, label, kind }]: named places, each a ring with its name; kind: a class of its own for the two
      xTitle: 'max drawdown',
      yTitle: 'CAGR',
      nowLabel: 'Now',
      betterLabel: 'Better on both',   // in the quarter up and to the left of `now`
      worseLabel: 'Worse on both',     // in the quarter down and to the right
      resetLabel: 'Reset zoom',        // the button in the plot's corner while zoomed in
      emptyText: '',       // shown in place of the plot while there is no dot
      dotRadius: 2,        // px, a dot with no size
      edgeWidth: [0.75, 1.25],   // px, the line around a dot with no size and around a sized one
      sizeRadius: [3.5, 9],   // px, a sized dot at 0 and at 1 (by area)
      hitRadius: 14,       // px around the pointer in which the nearest dot counts
      interactive: true,   // false: a picture alone, with no hover, pick or zoom
      padShare: 0.06,      // empty room around the dots, as a share of their spread
      maxZoom: 80,
      wheelK: 0.002,       // a wheel step scales the view by 2^(-deltaY × wheelK), as the site's other charts do
      onHover: null,       // (dot, event) while the pointer is near a dot
      onLeave: null,       // () when it is near none, or leaves
      onPick: null,        // (dot or null) on a click or tap
      transform: null,     // the zoom's d3 transform; null until the first render
      zoom: null,          // the d3 zoom behaviour, made on the first render
      hovered: null,       // the id of the dot under the pointer
      seen: null,          // the dots in view as drawn: [{ d, px, py, r }]
      firstRender: true,
      chartWidth: null,
      chartHeight: null,
    };

    this.getState = () => attrs;
    this.setState = (d) => Object.assign(attrs, d);

    // A chainable getter/setter per state key.
    Object.keys(attrs).forEach((key) => {
      this[key] = function (_) {
        if (!arguments.length) return attrs[key];
        attrs[key] = _;
        return this;
      };
    });

    this.initializeEnterExitUpdatePattern();
  }

  render() {
    this.setDynamicContainer();
    this.calculateProperties();
    this.drawCanvasAndSvg();
    this.calculateScales();
    this.draw();
    this.drawPointerLayer();
    return this;
  }

  // Everything that moves with the zoom, without the wiring: what a zoom or a pan redraws.
  draw() {
    this.applyZoom();
    this.drawDots();
    this.drawAxes();
    this.drawNow();
    this.drawFlags();
    this.drawMarks();
    this.drawZoomReset();
    return this;
  }

  calculateProperties() {
    const { marginLeft, marginTop, marginRight, marginBottom, svgWidth, svgHeight } = this.getState();
    this.setState({
      chartWidth: Math.max(0, svgWidth - marginRight - marginLeft),
      chartHeight: Math.max(0, svgHeight - marginBottom - marginTop),
    });
  }

  // A canvas the size of the plot, under an SVG the size of the chart.
  drawCanvasAndSvg() {
    const { d3Container, svgWidth, svgHeight, marginLeft, marginTop, chartWidth, chartHeight } = this.getState();
    const plot = d3Container._add('div.settings-map-plot').style('position', 'relative').style('height', svgHeight + 'px');
    const ratio = window.devicePixelRatio || 1;
    const canvas = plot._add('canvas.settings-map-canvas')
      .attr('width', Math.round(chartWidth * ratio)).attr('height', Math.round(chartHeight * ratio))
      .style('position', 'absolute').style('left', marginLeft + 'px').style('top', marginTop + 'px')
      .style('width', chartWidth + 'px').style('height', chartHeight + 'px');
    const svg = plot._add('svg.settings-map-svg')
      .attr('width', svgWidth).attr('height', svgHeight)
      .style('position', 'absolute').style('left', 0).style('top', 0)
      .attr('role', 'img');
    const chart = svg._add('g.chart').attr('transform', `translate(${marginLeft},${marginTop})`);
    const colour = (name) => getComputedStyle(plot.node()).getPropertyValue(name).trim();
    this.setState({ plot, canvas, svg, chart, ratio, colours: {
      dot: colour('--map-dot'), dotEdge: colour('--map-dot-edge'), dotSized: colour('--map-dot-sized'), dotSizedEdge: colour('--map-dot-sized-edge'),
      better: colour('--map-better'), worse: colour('--map-worse'), grid: colour('--map-grid'), frontier: colour('--map-frontier'),
    } });
  }

  // The dots' spread with a little room around it, drawdown never under zero.
  // The zoom then takes its part of that (applyZoom).
  calculateScales() {
    const { data, now, link, flags, chartWidth, chartHeight, padShare } = this.getState();
    const points = (data || []).concat(now || [], link || [], flags || []);
    const spread = (values, floor) => {
      const lo = d3.min(values), hi = d3.max(values), pad = Math.max((hi - lo) * padShare, 1);
      return [Math.max(floor, lo - pad), hi + pad];
    };
    const x0 = d3.scaleLinear().domain(points.length ? spread(points.map(p => p.x), 0) : [0, 100]).range([0, chartWidth]);
    const y0 = d3.scaleLinear().domain(points.length ? spread(points.map(p => p.y), -Infinity) : [0, 100]).range([chartHeight, 0]);
    this.setState({ x0, y0 });
  }

  // The svg is marked while zoomed in: a finger then pans the plot instead of scrolling the window (styles.css).
  applyZoom() {
    const { x0, y0, svg } = this.getState();
    const transform = this.getState().transform || d3.zoomIdentity;
    svg.classed('is-zoomed', transform.k > 1);
    this.setState({ transform, x: transform.rescaleX(x0), y: transform.rescaleY(y0) });
  }

  // On the canvas, back to front: the two shaded quarters, the grid, the
  // frontier's step line, the plain dots, the sized ones (the largest first,
  // so a small one is never hidden under a large one).
  drawDots() {
    const { canvas, ratio, data, now, frontier, x, y, chartWidth, chartHeight, colours, dotRadius, sizeRadius, edgeWidth } = this.getState();
    const cx = canvas.node().getContext('2d');
    cx.setTransform(ratio, 0, 0, ratio, 0, 0);
    cx.clearRect(0, 0, chartWidth, chartHeight);
    if (now) {
      const nx = Math.max(0, Math.min(chartWidth, x(now.x))), ny = Math.max(0, Math.min(chartHeight, y(now.y)));
      cx.fillStyle = colours.better; cx.fillRect(0, 0, nx, ny);
      cx.fillStyle = colours.worse; cx.fillRect(nx, ny, chartWidth - nx, chartHeight - ny);
    }
    if (!(data && data.length)) { this.setState({ seen: [] }); return; }
    cx.strokeStyle = colours.grid; cx.lineWidth = 1;
    cx.beginPath();
    x.ticks(6).forEach((t) => { const px = Math.round(x(t)) + 0.5; cx.moveTo(px, 0); cx.lineTo(px, chartHeight); });
    y.ticks(6).forEach((t) => { const py = Math.round(y(t)) + 0.5; cx.moveTo(0, py); cx.lineTo(chartWidth, py); });
    cx.stroke();
    if (frontier && frontier.length > 1) {
      cx.strokeStyle = colours.frontier; cx.lineWidth = 1;
      cx.beginPath();
      frontier.forEach((p, i) => {
        if (!i) { cx.moveTo(x(p.x), y(p.y)); return; }
        cx.lineTo(x(p.x), y(frontier[i - 1].y));   // across at the last height, then up
        cx.lineTo(x(p.x), y(p.y));
      });
      cx.stroke();
    }
    const radius = d3.scaleSqrt().domain([0, 1]).range(sizeRadius).clamp(true);
    const seen = data.map(d => ({ d, px: x(d.x), py: y(d.y), r: d.size == null ? dotRadius : radius(d.size) }))
      .filter(m => m.px >= -m.r && m.px <= chartWidth + m.r && m.py >= -m.r && m.py <= chartHeight + m.r);
    // Each dot is painted by itself, see-through, with a thin line around it, so dots lying on one
    // another add up: the darker a spot, the more results meet there (the user, 2026-11-25: "Is it
    // possible them to have a opacity of stroke or something so I can clearly see where they
    // converge?"). One fill for them all would paint a pile of fifty like a single dot.
    const paint = (dots, fill, edge, width) => {
      cx.fillStyle = fill; cx.strokeStyle = edge; cx.lineWidth = width;
      dots.forEach((m) => { cx.beginPath(); cx.arc(m.px, m.py, m.r, 0, 2 * Math.PI); cx.fill(); cx.stroke(); });
    };
    paint(seen.filter(m => m.d.size == null), colours.dot, colours.dotEdge, edgeWidth[0]);
    paint(seen.filter(m => m.d.size != null).sort((a, b) => b.r - a.r), colours.dotSized, colours.dotSizedEdge, edgeWidth[1]);   // the largest first, so a small one on a large one shows
    this.setState({ seen });
  }

  drawAxes() {
    const { chart, x, y, chartWidth, chartHeight, marginLeft, marginRight, xTitle, yTitle, data, emptyText } = this.getState();
    const empty = !(data && data.length);
    const percent = (scale) => { const f = scale.tickFormat(6); return v => f(v).replace(/,/g, '').replace('−', '-') + '%'; };
    const fx = percent(x), fy = percent(y);
    // A label at the plot's right end is set against the chart's edge, so it is never cut.
    const EDGE = 16, atEdge = (d) => x(d) > chartWidth - EDGE;
    chart._add('g.x-axis')._add('text.x-tick', empty ? [] : x.ticks(6))
      .attr('x', d => (atEdge(d) ? chartWidth + marginRight : x(d))).attr('y', chartHeight + 15).attr('text-anchor', d => (atEdge(d) ? 'end' : 'middle')).text(fx);
    chart._add('g.y-axis')._add('text.y-tick', empty ? [] : y.ticks(6))
      .attr('x', -7).attr('y', d => y(d)).attr('dy', '0.32em').attr('text-anchor', 'end').text(fy);
    chart._add('text.x-title', empty ? [] : [xTitle]).attr('x', chartWidth).attr('y', chartHeight + 30).attr('text-anchor', 'end').text(d => d);
    // Up along the left edge, clear of the tick labels.
    chart._add('text.y-title', empty ? [] : [yTitle]).attr('transform', `translate(${-marginLeft + 4},0) rotate(-90)`)
      .attr('x', 0).attr('y', 0).attr('dy', '0.7em').attr('text-anchor', 'end').text(d => d);
    chart._add('text.empty-text', empty && emptyText ? [emptyText] : [])
      .attr('x', chartWidth / 2).attr('y', chartHeight / 2).attr('text-anchor', 'middle').text(d => d);
  }

  // The settings as they are: dashed lines across the plot, a ring where they
  // cross with its name, and a name in each shaded quarter that has room for it.
  drawNow() {
    const { chart, now, x, y, chartWidth, chartHeight, nowLabel, betterLabel, worseLabel } = this.getState();
    const layer = chart._add('g.now').attr('pointer-events', 'none');
    const nx = now ? x(now.x) : 0, ny = now ? y(now.y) : 0;
    const xIn = !!now && nx >= 0 && nx <= chartWidth, yIn = !!now && ny >= 0 && ny <= chartHeight;
    layer._add('line.now-line-x', xIn ? ['x'] : []).attr('x1', nx).attr('x2', nx).attr('y1', 0).attr('y2', chartHeight);
    layer._add('line.now-line-y', yIn ? ['y'] : []).attr('x1', 0).attr('x2', chartWidth).attr('y1', ny).attr('y2', ny);
    layer._add('circle.now-ring', xIn && yIn ? ['ring'] : []).attr('cx', nx).attr('cy', ny).attr('r', 5.5);
    // The name sits up and to the right of the ring, or on the other side at the plot's edge.
    const right = nx < chartWidth - 40, up = ny > 16;
    layer._add('text.now-label', xIn && yIn ? [nowLabel] : [])
      .attr('x', nx + (right ? 8 : -8)).attr('y', ny + (up ? -8 : 14)).attr('text-anchor', right ? 'start' : 'end').text(d => d);
    // A quarter gets its name while it is wide and tall enough to hold it clear of the lines.
    const ROOM = { w: 110, h: 30 };
    const better = !!now && Math.min(nx, chartWidth) >= ROOM.w && Math.min(ny, chartHeight) >= ROOM.h;
    const worse = !!now && chartWidth - Math.max(nx, 0) >= ROOM.w && chartHeight - Math.max(ny, 0) >= ROOM.h;
    layer._add('text.quarter-label', [].concat(better ? { id: 'better', text: betterLabel, x: 6, y: 6, anchor: 'start' } : [],
      worse ? { id: 'worse', text: worseLabel, x: chartWidth - 6, y: chartHeight - 8, anchor: 'end' } : []))
      .attr('x', d => d.x).attr('y', d => d.y).attr('dy', d => (d.id === 'better' ? '0.7em' : 0)).attr('text-anchor', d => d.anchor).text(d => d.text);
  }

  // The named places in view: a ring, and the name beside it on the side with room.
  drawFlags() {
    const { chart, flags, x, y, chartWidth, chartHeight } = this.getState();
    const seen = (flags || []).map(f => Object.assign({}, f, { px: x(f.x), py: y(f.y) })).filter(f => f.px >= 0 && f.px <= chartWidth && f.py >= 0 && f.py <= chartHeight);
    const layer = chart._add('g.flags').attr('pointer-events', 'none');
    // _add sets the class anew at each render: a flag's own kind goes on after it.
    const kindOf = (name) => (f) => name + (f.kind ? ' ' + f.kind : '');
    layer._add('circle.flag-ring', seen).attr('class', kindOf('flag-ring')).attr('cx', f => f.px).attr('cy', f => f.py).attr('r', 5.5);
    const left = (f) => f.px > 40;   // the name goes left of the ring, away from the name of the settings as they are
    layer._add('text.flag-label', seen).attr('class', kindOf('flag-label')).attr('x', f => f.px + (left(f) ? -8 : 8)).attr('y', f => f.py + (f.py > 16 ? -8 : 14))
      .attr('text-anchor', f => (left(f) ? 'end' : 'start')).text(f => f.label);
  }

  // The picked dot's ring, its line to `link` with that end's name, and the ring under the pointer.
  drawMarks() {
    const { chart, data, picked, link, linkLabel, hovered, x, y, chartWidth, chartHeight } = this.getState();
    const layer = chart._add('g.marks').attr('pointer-events', 'none');
    const inPlot = (p) => p && x(p.x) >= 0 && x(p.x) <= chartWidth && y(p.y) >= 0 && y(p.y) <= chartHeight;
    const pick = picked == null ? null : (data || []).find(d => d.id === picked);
    const tied = pick && link && (inPlot(pick) || inPlot(link));
    layer._add('line.pick-link', tied ? ['link'] : [])
      .attr('x1', pick ? x(pick.x) : 0).attr('y1', pick ? y(pick.y) : 0).attr('x2', link ? x(link.x) : 0).attr('y2', link ? y(link.y) : 0);
    const ended = tied && inPlot(link), ex = link ? x(link.x) : 0, ey = link ? y(link.y) : 0;
    layer._add('circle.pick-link-end', ended ? ['end'] : []).attr('cx', ex).attr('cy', ey).attr('r', 3);
    // The name goes past the end, away from the picked dot, and turns back where the plot's edge is near.
    const NAME_ROOM = 80, right = ex + NAME_ROOM <= chartWidth, below = ey + 16 <= chartHeight;
    layer._add('text.pick-link-label', ended && linkLabel ? [linkLabel] : [])
      .attr('x', ex + (right ? 7 : -7)).attr('y', ey + (below ? 12 : -7)).attr('text-anchor', right ? 'start' : 'end').text(d => d);
    layer._add('circle.pick-ring', inPlot(pick) ? ['pick'] : []).attr('cx', pick ? x(pick.x) : 0).attr('cy', pick ? y(pick.y) : 0).attr('r', 7);
    const over = hovered == null ? null : (data || []).find(d => d.id === hovered);
    layer._add('circle.hover-ring', inPlot(over) && hovered !== picked ? ['hover'] : []).attr('cx', over ? x(over.x) : 0).attr('cy', over ? y(over.y) : 0).attr('r', 7);
  }

  // While zoomed in: a button in the plot's top right corner that goes back to the whole map. It
  // sits over the pointer's rect, so a click on it is its own.
  drawZoomReset() {
    const { chart, transform, chartWidth, resetLabel } = this.getState();
    const PAD = { x: 7, y: 4 }, GAP = 6;
    const button = chart._add('g.zoom-reset', transform.k > 1 ? [resetLabel] : []).attr('role', 'button').raise()
      .on('click', () => this.resetZoom());
    const box = button._add('rect.zoom-reset-box').attr('rx', 6);
    const text = button._add('text.zoom-reset-text').attr('text-anchor', 'end').attr('x', chartWidth - GAP - PAD.x).attr('y', GAP + PAD.y).attr('dy', '0.8em').text(d => d);
    if (button.empty()) return;
    const size = text.node().getBBox();
    box.attr('x', size.x - PAD.x).attr('y', size.y - PAD.y).attr('width', size.width + 2 * PAD.x).attr('height', size.height + 2 * PAD.y);
  }

  // The dot at a point of the plot, or null: of the dots whose edge is within hitRadius, the one
  // whose centre is nearest. So a large dot is as easy to reach as a small one, and a small dot
  // lying on a large one is still the one under the pointer.
  dotAt(px, py) {
    const { seen, hitRadius } = this.getState();
    let near = null, least = Infinity;
    for (const m of seen || []) {   // a plain loop: this runs on every pointer move, over every dot in view
      const away = Math.hypot(m.px - px, m.py - py);
      if (away - m.r <= hitRadius && away < least) { least = away; near = m.d; }
    }
    return near;
  }

  // A rect over the plot owns the pointer: the ring and the caller's tooltip
  // follow a mouse, a click or tap picks the dot under it, and the zoom lives
  // on it. Zoom: ⌘/Ctrl + wheel or a pinch; a drag pans once zoomed in (a
  // finger otherwise scrolls the window); the button of drawZoomReset goes back
  // to the whole map. A double click does nothing of its own: it would pick a
  // dot on its way.
  drawPointerLayer() {
    const { chart, chartWidth, chartHeight, maxZoom, wheelK, firstRender, interactive } = this.getState();
    if (!interactive) return;
    const catcher = chart._add('rect.pointer-catch').attr('x', 0).attr('y', 0).attr('width', chartWidth).attr('height', chartHeight).attr('fill', 'transparent');
    const here = (event) => { const [px, py] = d3.pointer(event, catcher.node()); return this.dotAt(px, py); };
    const hover = (dot, event) => {
      if ((dot ? dot.id : null) !== this.getState().hovered) { this.setState({ hovered: dot ? dot.id : null }); this.drawMarks(); }
      const { onHover, onLeave } = this.getState();
      if (dot && onHover) onHover(dot, event);
      if (!dot && onLeave) onLeave();
    };
    catcher
      .on('pointermove', (event) => { if (event.pointerType === 'mouse') hover(here(event), event); })
      .on('pointerleave', (event) => { if (event.pointerType === 'mouse') hover(null, event); })
      .on('click', (event) => { const { onPick } = this.getState(); if (onPick) onPick(here(event)); });

    const zoomed = () => this.getState().transform.k > 1;
    const zoom = this.getState().zoom || d3.zoom()
      .filter((event) => {
        if (event.type === 'wheel') return event.ctrlKey || event.metaKey;
        if (event.type === 'dblclick') return false;
        if (event.type.startsWith('touch')) return event.touches.length > 1 || zoomed();
        return !event.button && zoomed();
      })
      // d3 scales a wheel step tenfold while Ctrl is down, which is right for a pinch and far too fast for a mouse wheel with the key held.
      .wheelDelta(event => -event.deltaY * (event.deltaMode === 1 ? 0.05 : event.deltaMode ? 1 : wheelK))
      .on('zoom', (event) => {
        this.setState({ transform: event.transform });
        this.draw();
      });
    zoom.scaleExtent([1, maxZoom]).extent([[0, 0], [chartWidth, chartHeight]]).translateExtent([[0, 0], [chartWidth, chartHeight]]);
    this.setState({ zoom });
    if (firstRender) {
      catcher.call(zoom);
      this.setState({ firstRender: false });
    }
    chart.select('g.zoom-reset').raise();
  }

  // Back to the whole map.
  resetZoom() {
    const { chart, zoom } = this.getState();
    chart.select('rect.pointer-catch').call(zoom.transform, d3.zoomIdentity);
    return this;
  }

  // selection._add('tag.class', data): enter + exit + update in one call, so
  // render() can run any number of times. Objects are tracked by `id`.
  initializeEnterExitUpdatePattern() {
    d3.selection.prototype._add = function (classSelector, data, params) {
      const container = this;
      const split = classSelector.split('.');
      const elementTag = split[0];
      const className = split[1] || 'not-good';
      const exitTransition = params?.exitTransition;
      const enterTransition = params?.enterTransition;

      let bindData = data;
      if (typeof data === 'function') bindData = data(container.datum());
      if (bindData && !Array.isArray(bindData)) bindData = [bindData];
      // With no data given: one element per parent, carrying the parent's datum
      // (a parent with none gets its class name). No parents, no elements —
      // selection.datum() would throw on an empty selection.
      if (!bindData) bindData = container.empty() ? [] : (container.datum() ? (d => [d]) : [className]);

      let selection = container.selectAll(elementTag + '.' + className).data(bindData, (d, i) => {
        if (typeof d === 'object' && d.id) return d.id;
        return i;
      });
      if (exitTransition) exitTransition(selection);
      else selection.exit().remove();
      const enterSelection = selection.enter().append(elementTag);
      if (enterTransition) enterTransition(enterSelection);
      selection = enterSelection.merge(selection);
      selection.attr('class', className);

      if (className === 'not-good') {
        selection.attr('stroke', 'red').attr('stroke-width', 10);
        selection.selectAll('title').data(['not-good']).join('title').text("You don't have a class set for this element!");
      }
      return selection;
    };
  }

  // The container's width is the chart's width, now and after every resize.
  setDynamicContainer() {
    const attrs = this.getState();
    const d3Container = d3.select(attrs.container);
    const measure = () => {
      const rect = d3Container.node().getBoundingClientRect();
      if (rect.width > 0) attrs.svgWidth = rect.width;
    };
    measure();
    d3.select(window).on('resize.' + attrs.id, () => {
      if (!d3Container.node().isConnected) return;   // the window was closed
      measure();
      this.render();
    });
    this.setState({ d3Container });
  }
}
