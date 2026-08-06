// Main source of trust
class Chart {
    constructor() {
        // Defining state attributes
        const attrs = {
            id: "ID" + Math.floor(Math.random() * 1000000),
            svgWidth: 400,
            svgHeight: 200,
            marginTop: 5,
            marginBottom: 5,
            marginRight: 5,
            marginLeft: 5,
            container: "body",
            defaultTextFill: "#2C3E50",
            defaultFont: "Helvetica",
            data: null,
            chartWidth: null,
            chartHeight: null
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
        this.setDynamicContainer();
        this.calculateProperties();
        this.drawSvgAndWrappers();
        this.deleteOrReplaceThisMethod();
        return this;
    }
 
    calculateProperties() {
        const {
            marginLeft,
            marginTop,
            marginRight,
            marginBottom,
            svgWidth,
            svgHeight
        } = this.getState();
 
        //Calculated properties
        var calc = {
            id: null,
            chartTopMargin: null,
            chartLeftMargin: null,
            chartWidth: null,
            chartHeight: null
        };
        calc.id = "ID" + Math.floor(Math.random() * 1000000); // id for event handlings
        calc.chartLeftMargin = marginLeft;
        calc.chartTopMargin = marginTop;
        const chartWidth = svgWidth - marginRight - calc.chartLeftMargin;
        const chartHeight = svgHeight - marginBottom - calc.chartTopMargin;
 
        this.setState({ calc, chartWidth, chartHeight });
    }
 
    deleteOrReplaceThisMethod() {
        const { chart, data, chartWidth, chartHeight } = this.getState();
 
        const g = chart._add('g.rect-wrap', data)
 
        g._add('rect.first')
            .attr('x', 0)
            .attr("width", chartWidth / 4)
            .attr("height", chartHeight)
            .attr("fill", (d) => d.color)
            .on('click', (e, d) => {
                console.log('just rect', d)
            })
 
 
        g._add('rect')
            .attr('x', chartWidth / 4)
            .attr("width", chartWidth / 4)
            .attr("height", chartHeight)
            .attr("fill", (d) => 'blue')
            .on('click', (e, d) => {
                console.log('just rect', d)
            })
 
        g._add('rect.test', 'sample-rect-custom')
            .attr('x', chartWidth / 4 * 2)
            .attr("width", chartWidth / 4)
            .attr("height", chartHeight)
            .attr("fill", (d) => 'green')
            .on('click', (e, d) => {
                console.log('just rect with string data', d)
            })
 
        const rectWrap = g._add('g.element-wrap', d => d.values)
            .attr('transform', (d, i, arr) => `translate(${chartWidth / 4 * 3 + i * chartWidth / (4 * arr.length)}, 0)`)
 
        rectWrap._add('rect.bar')
            .attr('x', (d, i, arr) => 0)
            .attr("width", (d, i, arr) => chartWidth / (arr.length * 4))
            .attr("height", chartHeight)
            .attr("fill", (d) => d.color)
            .on('click', (e, d) => {
                console.log('just rect with rect wrap', d)
            })
 
 
 
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
            chartHeight
        } = this.getState();
 
        // Draw SVG
        const svg = d3Container._add('svg.svg-container')
            .attr("width", svgWidth)
            .attr("height", svgHeight)
            .attr("font-family", defaultFont);
 
        //Add container g element
        var chart = svg._add('g.chart')
            .attr(
                "transform",
                "translate(" + calc.chartLeftMargin + "," + calc.chartTopMargin + ")"
            );
 
 
        this.setState({ chart, svg });
    }
 
    initializeEnterExitUpdatePattern() {
        d3.selection.prototype._add = function (classSelector, data, params) {
            const container = this;
            const split = classSelector.split(".");
            const elementTag = split[0];
            const className = split[1] || 'not-good';
            const exitTransition = params?.exitTransition;
            const enterTransition = params?.enterTransition;
 
            let bindData = data;
            if (typeof data === 'function') {
                bindData = data(container.datum());
            }
            if (bindData && !Array.isArray(bindData)) {
                bindData = [bindData]
            }
            if (!bindData) {
                if (container.datum()) {
                    bindData = d => [d];
                } else {
                    bindData = [className];
                }
            }
 
            let selection = container.selectAll(elementTag + '.' + className).data(bindData, (d, i) => {
                if (typeof d === "object" && d.id) return d.id;
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
            selection.attr("class", className)
 
            if (className == 'not-good') {
                selection
                    .attr('stroke', className == 'not-good' ? 'red' : null)
                    .attr('stroke-width', className == 'not-good' ? 10 : null)
                selection.selectAll('title').data(['not-good']).join('title').text("You don't have a class set for this element!")
            }
 
            return selection;
        }
    }
 
    setDynamicContainer() {
        const attrs = this.getState();
 
        //Drawing containers
        var d3Container = d3.select(attrs.container);
        var containerRect = d3Container.node().getBoundingClientRect();
        if (containerRect.width > 0) attrs.svgWidth = containerRect.width;
 
        const self = this;
 
        d3.select(window).on("resize." + attrs.id, function () {
            var containerRect = d3Container.node().getBoundingClientRect();
            if (containerRect.width > 0) attrs.svgWidth = containerRect.width;
            self.render();
        });
 
        this.setState({ d3Container });
    }
}