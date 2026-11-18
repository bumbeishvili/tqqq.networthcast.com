// The analytics modal's years-held line chart (js/analytics.js buildYearsHeld):
// one line per series, a value for each number of years held.
//
// Built on the reusable D3 chart convention (.claude/skills/d3-charts): all
// state in one `attrs` object with chainable accessors, _add() so a re-render
// updates elements instead of appending duplicates, width taken from the
// container and redrawn on resize. It only draws: the numbers and the tooltip
// text belong to the caller, which hears about the hovered column through
// onHover / onLeave.
//
//   new YearsHeldChart().container(el).svgHeight(360).data(series).render();
//   series: [{ id, label, color, dash, points: [{ years, value }] }]
//
// d3 loads deferred (index.html), so nothing here touches it before the first
// instance is made.
class YearsHeldChart {
  constructor() {
    const attrs = {
      id: 'ID' + Math.floor(Math.random() * 1000000),
      svgWidth: 400,
      svgHeight: 320,
      marginTop: 12,
      marginBottom: 34,
      marginRight: 56,   // set on every render to fit the labels at the lines' ends (fitEndLabels)
      marginLeft: 46,
      container: 'body',
      data: null,
      valueFormat: (v) => v.toFixed(1) + '%',
      endLabelOffset: 7,       // px between a line's end and its label
      endLabelMaxShare: 0.4,   // the most of the width the labels' margin may take; longer names are cut short
      endLabelRemoveSize: 18,  // px square of the × after a label (drawn only with onRemove)
      onHover: null,     // (years, event) while the pointer is on the plot
      onLeave: null,     // () when it leaves
      onRemove: null,    // (series id) when the × after a line's label is clicked; no × without it
      rangePctFormat: (p) => p.toFixed(1),   // the % of a dragged range, from its absolute value
      keepRangeOn: null,   // CSS selector: a click on a match leaves a pinned range in place
      firstRender: true,   // true until the first render has wired the page-level listeners
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
    this.drawSvgAndWrappers();
    this.fitEndLabels();
    this.calculateProperties();
    this.calculateScales();
    this.drawAxes();
    this.drawLines();
    this.drawEndLabels();
    this.drawRangeSelect();
    this.drawHoverLayer();
    return this;
  }

  calculateProperties() {
    const { marginLeft, marginTop, marginRight, marginBottom, svgWidth, svgHeight } = this.getState();
    this.setState({
      chartWidth: Math.max(0, svgWidth - marginRight - marginLeft),
      chartHeight: Math.max(0, svgHeight - marginBottom - marginTop),
    });
  }

  drawSvgAndWrappers() {
    const { d3Container, svgWidth, svgHeight, marginLeft, marginTop } = this.getState();
    // The viewBox lets the drawing shrink with a container that turns out
    // narrower than measured (the image download lays the modal out again).
    const svg = d3Container._add('svg.years-held-svg')
      .attr('width', svgWidth)
      .attr('height', svgHeight)
      .attr('viewBox', `0 0 ${svgWidth} ${svgHeight}`)
      .attr('role', 'img');
    const chart = svg._add('g.chart').attr('transform', `translate(${marginLeft},${marginTop})`);
    this.setState({ chart, svg });
  }

  // The label at a line's end is the series' name and its last value. Each is
  // measured in a hidden copy; the right margin becomes as wide as the widest,
  // up to endLabelMaxShare of the chart, and a name that would need more is cut
  // short with an ellipsis (the value always stays whole).
  fitEndLabels() {
    const { svg, data, svgWidth, valueFormat, endLabelOffset, endLabelMaxShare, endLabelRemoveSize, onRemove } = this.getState();
    const removeRoom = onRemove ? endLabelRemoveSize : 0;
    const labels = (data || []).filter(s => s.points.length).map(s => ({ id: s.id, name: s.label, value: valueFormat(s.points[s.points.length - 1].value) }));
    const probes = svg._add('g.end-label-probes').attr('visibility', 'hidden')
      ._add('text.end-label', labels).text(d => d.name + ' ' + d.value);
    const room = svgWidth * endLabelMaxShare - endLabelOffset - removeRoom;
    let widest = 0, lineHeight = 0;
    const endLabels = new Map();
    probes.each(function (d) {
      const full = d.name + ' ' + d.value;
      const width = this.getComputedTextLength();
      const fits = Math.floor(room / (width / full.length));   // characters that fit: the label font is monospace
      const cut = full.length > fits;
      endLabels.set(d.id, cut ? d.name.slice(0, Math.max(0, fits - d.value.length - 2)).trimEnd() + '… ' + d.value : full);
      widest = Math.max(widest, cut ? room : width);
      lineHeight = Math.max(lineHeight, this.getBBox().height);
    });
    this.setState({ marginRight: Math.ceil(widest + endLabelOffset + removeRoom) + 2, endLabels, endLabelGap: Math.max(Math.ceil(lineHeight) + 1, removeRoom) });
  }

  // x: years held, from 1 to the longest any series reaches. y: the values,
  // always with zero in view, rounded out to tidy ticks.
  calculateScales() {
    const { data, chartWidth, chartHeight } = this.getState();
    const points = (data || []).flatMap(s => s.points);
    const maxYears = Math.max(2, d3.max(points, p => p.years) || 2);
    const x = d3.scaleLinear().domain([1, maxYears]).range([0, chartWidth]);
    const y = d3.scaleLinear()
      .domain([Math.min(0, d3.min(points, p => p.value) || 0), Math.max(0, d3.max(points, p => p.value) || 0)])
      .nice(6)
      .range([chartHeight, 0]);
    // Every year while they fit, then every fifth (the first year always).
    const step = maxYears <= 12 ? 1 : 5;
    const xTicks = d3.range(1, maxYears + 1).filter(v => v === 1 || v % step === 0);
    this.setState({ x, y, xTicks, maxYears });
  }

  drawAxes() {
    const { chart, x, y, xTicks, chartWidth, chartHeight, valueFormat } = this.getState();
    const yTicks = y.ticks(6);

    chart._add('g.y-grid')._add('line.grid-line', yTicks)
      .attr('x1', 0).attr('x2', chartWidth)
      .attr('y1', d => y(d)).attr('y2', d => y(d))
      .classed('is-zero', d => d === 0);

    chart._add('g.y-axis')._add('text.y-tick', yTicks)
      .attr('x', -8).attr('y', d => y(d)).attr('dy', '0.32em')
      .attr('text-anchor', 'end')
      .text(d => valueFormat(d).replace('.0%', '%'));

    chart._add('g.x-axis')._add('text.x-tick', xTicks)
      .attr('x', d => x(d)).attr('y', chartHeight + 16)
      .attr('text-anchor', 'middle')
      .text(d => d);

    chart._add('text.x-title')
      .attr('x', chartWidth).attr('y', chartHeight + 30)
      .attr('text-anchor', 'end')
      .text('years held');
  }

  drawLines() {
    const { chart, data, x, y } = this.getState();
    const line = d3.line().x(p => x(p.years)).y(p => y(p.value));
    chart._add('g.lines')._add('path.series-line', data || [])
      .attr('d', s => line(s.points))
      .attr('fill', 'none')
      .attr('stroke', s => s.color)
      .attr('stroke-dasharray', s => s.dash || null);
  }

  // Name and last value at the end of each line (fitEndLabels made the text
  // and the room), then a × that removes the line when the caller listens
  // (onRemove). Labels that would touch are pushed apart downward, then the
  // whole stack is lifted back inside the plot.
  drawEndLabels() {
    const { chart, data, x, y, chartHeight, endLabels, endLabelGap, endLabelOffset, endLabelRemoveSize, onRemove } = this.getState();
    const ends = (data || []).filter(s => s.points.length).map(s => {
      const last = s.points[s.points.length - 1];
      return { id: s.id, name: s.label, text: endLabels.get(s.id), x: x(last.years), y: y(last.value) };
    }).sort((a, b) => a.y - b.y);
    ends.forEach((e, i) => { if (i && e.y - ends[i - 1].y < endLabelGap) e.y = ends[i - 1].y + endLabelGap; });
    const spill = ends.length ? Math.max(0, ends[ends.length - 1].y - chartHeight) : 0;
    chart._add('g.end-labels')._add('text.end-label', ends)
      .attr('x', e => e.x + endLabelOffset).attr('y', e => e.y - spill).attr('dy', '0.32em')
      .text(e => e.text)
      .each(function (e) { e.width = this.getComputedTextLength(); });

    // The × sits right after its label's text. Its group is left out of a
    // downloaded image (data-capture="skip").
    const size = endLabelRemoveSize;
    const removes = chart._add('g.end-label-removes').attr('data-capture', 'skip')
      ._add('g.end-label-remove', onRemove ? ends : [])
      .attr('transform', e => `translate(${e.x + endLabelOffset + e.width + 2},${e.y - spill})`)
      .attr('role', 'button')
      .attr('aria-label', e => 'Remove ' + e.name)
      .on('click', (event, e) => this.getState().onRemove(e.id));
    removes._add('rect.end-label-remove-hit')
      .attr('x', 0).attr('y', -size / 2).attr('width', size).attr('height', size)
      .attr('fill', 'transparent');
    removes._add('text.end-label-remove-mark')
      .attr('x', size / 2).attr('dy', '0.32em').attr('text-anchor', 'middle')
      .text('×');
    removes._add('title.end-label-remove-tip').text('Remove this line');
  }

  // Drag across the plot (mouse) to read each line's change between two
  // columns, the way the main chart's drag-to-select does: a shaded range, a
  // pill naming each edge and the span, and per line a dot on each edge, a
  // dashed chord between them and a label at its middle — the % change first,
  // then "(from → to, difference)". Releasing clears it; releasing with Shift
  // held pins it until Escape or a click elsewhere.
  drawRangeSelect() {
    const { chart, data, x, y, chartWidth, chartHeight, maxYears, range, valueFormat, rangePctFormat } = this.getState();
    const layer = chart._add('g.range-select').attr('pointer-events', 'none');
    const lo = range ? Math.min(range.from, range.to) : 0, hi = range ? Math.max(range.from, range.to) : 0;
    const on = !!range && lo !== hi && hi <= maxYears;
    const x1 = x(lo), x2 = x(hi), mid = (x1 + x2) / 2;

    layer._add('rect.range-band', on ? ['band'] : [])
      .attr('x', x1).attr('y', 0).attr('width', x2 - x1).attr('height', chartHeight);
    layer._add('line.range-edge', on ? [x1, x2] : [])
      .attr('x1', d => d).attr('x2', d => d).attr('y1', 0).attr('y2', chartHeight);

    // A pill is a rounded box sized to its text, centred on (cx, cy).
    const PAD = 5, HEIGHT = 15;
    const years = (n) => n + (n === 1 ? ' year' : ' years');
    const pills = layer._add('g.range-pill', on ? [
      { id: 'from', text: 'held ' + years(lo), cx: x1, cy: 8 },
      { id: 'to', text: 'held ' + years(hi), cx: x2, cy: 8 },
      { id: 'span', text: years(hi - lo) + ' apart', cx: mid, cy: 8 + HEIGHT + 4 },
    ] : []);
    pills._add('rect.range-pill-box').attr('rx', 6).attr('height', HEIGHT).attr('y', -HEIGHT / 2);
    pills._add('text.range-pill-text').attr('text-anchor', 'middle').attr('dy', '0.32em').text(d => d.text)
      .each(function (d) { d.width = this.getComputedTextLength() + PAD * 2; });
    // The two edge pills sit on their own edges; on a narrow range they would
    // collide, so they are spread around the range's middle instead.
    const [from, to] = pills.data();
    if (on && from.cx + from.width / 2 + 4 > to.cx - to.width / 2) {
      from.cx = mid - 2 - from.width / 2;
      to.cx = mid + 2 + to.width / 2;
    }
    pills.attr('transform', d => `translate(${Math.max(d.width / 2, Math.min(chartWidth - d.width / 2, d.cx))},${d.cy})`);
    pills.select('rect').attr('x', d => -d.width / 2).attr('width', d => d.width);

    // Per line: its two points, the move between them and the label's text.
    const moves = (on ? data || [] : []).map(s => {
      const a = s.points.find(p => p.years === lo), b = s.points.find(p => p.years === hi);
      if (!a || !b) return null;
      const diff = b.value - a.value, sign = diff >= 0 ? '+' : '−';
      return {
        id: s.id, color: s.color, up: diff >= 0, y1: y(a.value), y2: y(b.value), labelY: (y(a.value) + y(b.value)) / 2,
        // A change from zero or below has no percent: the bracket stands alone.
        lead: a.value > 0 ? sign + rangePctFormat(Math.abs(diff / a.value * 100)) + '%' : '',
        rest: ` (${valueFormat(a.value)} → ${valueFormat(b.value)}, ${sign}${Math.abs(diff).toFixed(1)} pts)`,
      };
    }).filter(Boolean);
    layer._add('line.range-chord', moves)
      .attr('x1', x1).attr('x2', x2).attr('y1', m => m.y1).attr('y2', m => m.y2).attr('stroke', m => m.color);
    layer._add('circle.range-dot', moves.flatMap(m => [{ id: m.id + ' from', cx: x1, cy: m.y1, color: m.color }, { id: m.id + ' to', cx: x2, cy: m.y2, color: m.color }]))
      .attr('r', 4).attr('cx', d => d.cx).attr('cy', d => d.cy).attr('fill', d => d.color);

    // The labels share one x, so they are pushed apart downward, then lifted
    // back inside the plot from the bottom. Every label takes the same two
    // columns — the % right-aligned, the bracket starting at one shared x —
    // so a stack reads like a table.
    const LABEL_HEIGHT = 14, GAP = LABEL_HEIGHT + 2;
    const stacked = moves.slice().sort((a, b) => a.labelY - b.labelY);
    stacked.forEach((m, i) => { if (i && m.labelY - stacked[i - 1].labelY < GAP) m.labelY = stacked[i - 1].labelY + GAP; });
    stacked.slice().reverse().forEach((m, i) => { m.labelY = Math.min(m.labelY, chartHeight - 5 - i * GAP); });
    const labels = layer._add('g.range-label', moves).classed('is-up', m => m.up).classed('is-down', m => !m.up);
    labels._add('rect.range-label-box').attr('rx', 6).attr('height', LABEL_HEIGHT).attr('y', -LABEL_HEIGHT / 2).attr('stroke', m => m.color);
    labels._add('text.range-lead').attr('text-anchor', 'end').attr('dy', '0.32em').text(m => m.lead)
      .each(function (m) { m.leadWidth = this.getComputedTextLength(); });
    labels._add('text.range-rest').attr('text-anchor', 'start').attr('dy', '0.32em').text(m => m.rest)
      .each(function (m) { m.restWidth = this.getComputedTextLength(); });
    const leadCol = d3.max(moves, m => m.leadWidth) || 0, tableWidth = leadCol + (d3.max(moves, m => m.restWidth) || 0);
    const boxWidth = tableWidth + 8;
    const left = Math.max(0, Math.min(chartWidth - boxWidth, mid - boxWidth / 2));
    labels.attr('transform', m => `translate(${left},${m.labelY})`);
    labels.select('rect').attr('x', 0).attr('width', boxWidth);
    labels.select('text.range-lead').attr('x', 4 + leadCol);
    labels.select('text.range-rest').attr('x', 4 + leadCol);
  }

  hasRange() {
    const { range } = this.getState();
    return !!range && range.from !== range.to;
  }
  // Drop the range, pinned or mid-drag.
  clearRange() {
    this.setState({ range: null, rangeDragging: false });
    this.drawRangeSelect();
    return this;
  }

  // A crosshair and one dot per line at the hovered number of years, and the
  // drag that selects a range. The catcher rect sits on top and owns the
  // pointer events.
  drawHoverLayer() {
    const { chart, data, x, y, chartWidth, chartHeight, maxYears } = this.getState();
    const hover = chart._add('g.hover').attr('visibility', 'hidden');
    const cross = hover._add('line.cross').attr('y1', 0).attr('y2', chartHeight);
    const dots = hover._add('circle.hover-dot', data || []).attr('r', 3.5).attr('fill', s => s.color);

    const place = (years) => {
      cross.attr('x1', x(years)).attr('x2', x(years));
      dots.each(function (s) {
        const p = s.points.find(q => q.years === years);
        d3.select(this).attr('visibility', p ? null : 'hidden').attr('cx', x(years)).attr('cy', p ? y(p.value) : 0);
      });
      hover.attr('visibility', 'visible');
    };
    const clear = () => hover.attr('visibility', 'hidden');
    this.setState({ clearHover: clear });

    const catcher = chart._add('rect.hover-catch')
      .attr('x', -6).attr('y', 0)
      .attr('width', chartWidth + 12).attr('height', chartHeight)
      .attr('fill', 'transparent');
    const yearsAt = (event) => {
      const [px] = d3.pointer(event, catcher.node());
      return Math.max(1, Math.min(maxYears, Math.round(x.invert(px))));
    };
    const at = (event) => {
      const years = yearsAt(event);
      place(years);
      const { onHover } = this.getState();
      if (onHover) onHover(years, event);
    };
    const leave = () => {
      clear();
      const { onLeave } = this.getState();
      if (onLeave) onLeave();
    };
    catcher
      .on('pointerdown', (event) => {
        // A mouse press starts a range; a finger keeps the tap-for-tooltip.
        if (event.pointerType !== 'mouse' || event.button !== 0) { at(event); return; }
        const years = yearsAt(event);
        this.setState({ range: { from: years, to: years }, rangeDragging: true });
        catcher.node().setPointerCapture(event.pointerId);   // the drag keeps tracking outside the plot
        leave();
        this.drawRangeSelect();
      })
      .on('pointermove', (event) => {
        const { range, rangeDragging } = this.getState();
        if (rangeDragging) { range.to = yearsAt(event); this.drawRangeSelect(); return; }
        if (this.hasRange()) return;   // a pinned range has the plot to itself, as on the main chart
        at(event);
      })
      .on('pointerup', (event) => {
        if (!this.getState().rangeDragging) return;
        this.setState({ rangeDragging: false });
        if (!this.hasRange() || !event.shiftKey) this.clearRange();   // Shift at release pins it
      })
      .on('pointercancel', () => this.clearRange())
      // A finger lifting ends the touch; the marks and the caller's tooltip
      // stay until the next tap, as the heatmap's sticky tooltip does.
      .on('pointerleave', (event) => {
        if (event.pointerType === 'touch') return;
        leave();
      });

    // A pinned range goes on Escape or a click outside the chart. A click on
    // `keepRangeOn` (the caller's download button) leaves it for the picture.
    const { id, firstRender } = this.getState();
    if (firstRender) {
      d3.select(document)
        .on('keydown.' + id, (event) => { if (event.key === 'Escape') this.clearRange(); })
        .on('click.' + id, (event) => {
          const { keepRangeOn, svg } = this.getState();   // the svg of the latest render: the plot can be rebuilt
          if (!this.hasRange() || svg.node().contains(event.target) || (keepRangeOn && event.target.closest(keepRangeOn))) return;
          this.clearRange();
        });
      this.setState({ firstRender: false });
    }
  }

  // Hide the crosshair and dots (the caller closed its tooltip).
  clearHover() {
    const { clearHover } = this.getState();
    if (clearHover) clearHover();
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
      // Nothing to redraw when the container has left the page, or when the
      // caller has put something else in the drawing's place (a message).
      if (!d3Container.node().isConnected || d3Container.select('svg.years-held-svg').empty()) return;
      measure();
      this.render();
    });
    this.setState({ d3Container });
  }
}
