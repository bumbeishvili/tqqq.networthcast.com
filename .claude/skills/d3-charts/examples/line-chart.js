import * as d3 from 'd3';
import GUI from 'lil-gui';
const lil = { GUI };
 
export class LineChart {
  constructor() {
    // Defining state attributes
    const attrs = {
      id: 'ID' + Math.floor(Math.random() * 1000000),
      svgWidth: 400,
      svgHeight: 200,
      marginTop: 5,
      marginBottom: 5,
      marginRight: 5,
      marginLeft: 5,
      lineStrokeWidth: 1,
      container: 'body',
      defaultFont: 'Helvetica',
      data: null,
      chartWidth: null,
      chartHeight: null,
      firstRender: true,
      guiEnabled: false,
 
      lineColor: 'blue',
    };
 
    // Defining accessors
    this.getState = () => attrs;
    this.setState = (d) => Object.assign(attrs, d);
 
    // Automatically generate getter and setters for chart object based on the state properties;
    Object.keys(attrs).forEach((key) => {
      //@ts-ignore
      this[key] = function (_) {
        if (!arguments.length) {
          return attrs[key];
        }
        attrs[key] = _;
        return this;
      };
    });
 
    // Custom enter exit update pattern initialization (prototype method)
    this.initializeEnterExitUpdatePattern();
  }
  render() {
    this.addChartGui();
    this.setDynamicContainer();
    this.calculateProperties();
    this.drawSvgAndWrappers();
    this.draw();
    this.setState({ firstRender: false });
    return this;
  }
 
  calculateProperties() {
    const {
      marginLeft,
      marginTop,
      marginRight,
      marginBottom,
      svgWidth,
      svgHeight,
    } = this.getState();
 
    //Calculated properties
    var calc = {
      id: null,
      chartTopMargin: null,
      chartLeftMargin: null,
      chartWidth: null,
      chartHeight: null,
    };
    calc.id = 'ID' + Math.floor(Math.random() * 1000000); // id for event handlings
    calc.chartLeftMargin = marginLeft;
    calc.chartTopMargin = marginTop;
    const chartWidth = svgWidth - marginRight - calc.chartLeftMargin;
    const chartHeight = svgHeight - marginBottom - calc.chartTopMargin;
 
    this.setState({ calc, chartWidth, chartHeight });
  }
 
  draw() {
    const { chart, lineStrokeWidth, lineColor, data, chartWidth, chartHeight } =
      this.getState();
 
    const [minX, maxX] = d3.extent(data, (d) => new Date(d.date));
    const [minY, maxY] = d3.extent(data, (d) => d.temp);
    const xScale = d3.scaleTime().domain([minX, maxX]).range([0, chartWidth]);
    const yScale = d3
      .scaleLinear()
      .domain([minY, maxY])
      .range([0, chartHeight]);
 
    const line = d3
      .line()
      .x((d) => xScale(new Date(d.date)))
      .y((d) => yScale(d.temp));
 
    const lineData = data;
    chart
      ._add('path.line-path', [lineData])
      .attr('fill', 'none')
      .transition()
      .duration(1000)
      .attr('stroke-width', lineStrokeWidth)
      .attr('stroke', lineColor)
      .attr('d', (d) => line(d));
  }
 
  drawSvgAndWrappers() {
    const {
      d3Container,
      svgWidth,
      svgHeight,
      defaultFont,
      calc,
      data,
      chartWidth,
      chartHeight,
    } = this.getState();
 
    // Draw SVG
    const svg = d3Container
      ._add('svg.svg-chart-container')
      .attr('width', svgWidth)
      .attr('height', svgHeight)
      .attr('font-family', defaultFont);
 
    //Add container g element
    var chart = svg
      ._add('g.chart')
      .attr(
        'transform',
        'translate(' + calc.chartLeftMargin + ',' + calc.chartTopMargin + ')'
      );
 
    this.setState({ chart, svg });
  }
 
  initializeEnterExitUpdatePattern() {
    d3.selection.prototype._add = function (classSelector, data, params) {
      const container = this;
      const split = classSelector.split('.');
      const elementTag = split[0];
      const className = split[1] || 'not-good';
      const exitTransition = params?.exitTransition;
      const enterTransition = params?.enterTransition;
 
      let bindData = data;
      if (typeof data === 'function') {
        bindData = data(container.datum());
      }
      if (!bindData) {
        bindData = [container.datum()];
      }
      if (!bindData) {
        bindData = [className];
      }
      if (!Array.isArray(bindData)) {
        bindData = [bindData];
      }
      let selection = container
        .selectAll(elementTag + '.' + className)
        .data(bindData, (d, i) => {
          if (typeof d === 'object' && d.id) return d.id;
          return i;
        });
      if (exitTransition) {
        exitTransition(selection);
      } else {
        selection.exit().remove();
      }
      const enterSelection = selection.enter().append(elementTag);
      if (enterTransition) {
        enterTransition(enterSelection);
      }
      selection = enterSelection.merge(selection);
      selection
        .attr('class', className)
        .attr('stroke', className == 'not-good' ? 'red' : null)
        .attr('stroke-width', className == 'not-good' ? 10 : null);
 
      return selection;
    };
  }
 
  setDynamicContainer() {
    const attrs = this.getState();
 
    //Drawing containers
    var d3Container = d3.select(attrs.container);
    var containerRect = d3Container.node().getBoundingClientRect();
    if (containerRect.width > 0) attrs.svgWidth = containerRect.width;
 
    d3.select(window).on('resize.' + attrs.id, () => {
      var containerRect = d3Container.node().getBoundingClientRect();
      if (containerRect.width > 0) attrs.svgWidth = containerRect.width;
      this.render();
    });
 
    this.setState({ d3Container });
  }
 
  addChartGui() {
    const { guiEnabled, firstRender } = this.getState();
 
    if (!guiEnabled || !firstRender) return;
    if (typeof lil == 'undefined') return;
    const gui = new lil.GUI();
    gui.close();
    const state = JSON.parse(JSON.stringify(this.getState()));
    const propChanged = () => {
      supportedKeys.forEach((k) => {
        this.setState({ [k]: state[k] });
      });
      this.render();
    };
    const supportedKeys = Object.keys(state)
      .filter(
        (k) =>
          typeof state[k] == 'number' ||
          typeof state[k] == 'string' ||
          typeof state[k] == 'boolean'
      )
      .filter(
        (d) =>
          ![
            'guiEnabled',
            'firstRender',
            'svgWidth',
            'id',
            'container',
          ].includes(d)
      );
    supportedKeys.forEach((key) => {
      gui.add(state, key).onChange((d) => {
        propChanged();
      });
    });
  }
}