In this article, I want to share my thoughts about working with d3 and what approach worked for me consistently throughout the years.
 
Working with d3 can shortly go out of hand in terms of code organization. While d3 is very flexible, in my practice, people working with d3 are having a quite hard time when trying to have a well-organized code and still want to tick all of the boxes, that modern web applications demand.
 
Those are:
 
Visualization should be responsive
Visualization should be updatable when new data comes
Visualization should be easily integrable with the major frontend frameworks like Svelte, React, Angular, and Vue.
Visualization should be easily usable by other users
Easily debuggable and customizable
In this article, I will link the D3.js boilerplate I am using and explain every part of it.
 
This is how we can use it
 
This is an example line chart using this convention
 
 
It’s responsive
It’s updatable with the new data
It’s easily customizable and playable by mid-users using controls
Let’s explain every piece of this boilerplate:
 
1/5 — Chainable state setting and getting
The first part of the boilerplate is the following:
 
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
            chartHeight: null,
            firstRender: true,
            guiEnabled: false,
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
We are saving all state information in attrs object. By state I mean the data which is needed to be stored between chart renders.
 
ID — A unique enough number, which sometimes is needed to be used within the chart. For example when we draw multiple charts on the same page and we need to use anything related to defs tag
 
svgWidth — this variable is automatically set within the boilerplate and it fits into the chart container. This process is what makes the chart responsive
 
svgHeight — Variable to be used for controlling the height of the chart. I usually set a fixed number to this since usually we don’t have or need responsive heights for visualizations, they mostly stay fixed height for different screen sizes.
 
marginTop, marginLeft, marginRight, marginBottom — as the name suggests, they are responsible for margins. Negative margins are also supported.
 
container — chart container element. CSS selector string and actual HTML element are both supported
 
defaultTextFill, defaultFont — Responsible for setting chart-wide text color and font family
 
data — actual data of the chart, does not have any default set since it varies greatly
 
chartWidth, chartHeight — this is set automatically after taking margins into consideration, these are width and height variables we are working with mostly throughout the chart.
 
firstRender — also set automatically and it’s a boolean variable that is true when the render happens the first time but becomes false on subsequent redraws. It’s useful when we want to save state properties only once. For example, usually, zoom behavior is only declared once, and subsequent redraw does not redeclare thanks to this variable
 
guiEnabled — helper variable which dynamically creates a configuration for each property defined in attrs object. This is helpful when the client wants to try different settings very often. For example in my practice clients usually ask to try different fonts, colors, or font sizes. By giving them the ability to play with config directly on the page, you will save so much time and in the end, they can provide the actual values which we can then set as a default. And most importantly everyone is happy.
 
this.getState = () => attrs;
this.setState = (d) => Object.assign(attrs, d);
These are just helper methods which are used to retrieve the current state or specific state properties
 
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
And this is probably the most important piece. Above code:
 
Takes attrs object and converts each property to a class method
If the state object method is invoked with one argument, it sets it as a state. and if invoked without an argument gets that state.
If state is being set, it’s also possible to chain several methods
For example, let’s say we defined a new chart
 
chart = new Chart()
If we want to set the new data, svgHeight, and marginLeft, we could do the following
 
chart
 .data(newData) // Argument passed, so it's a setter
 .svgheight(newHeight)
 .marginLeft(newMarginLeft)
If we want to get the current data, svgHeight or marginLeft, or even the complete state we could do the following
 
let currentData = chart.data(); // No argument, so it's a getter
let currentHeight = chart.svgHeight();
let marginLeft = chart.marginLeft();
 
 
// We can also directly get above variables from the state
let currentState = chart.getState();
let dataState = currentState.data;
let heightState = currentState.svgHeight;
let marginState = currentState.marginLeft;
This is a very powerful convention and it saves so much time and effort.
 
2/5 — Reusable Code
When working with d3 , most examples written out here are using append method. Using append multiple times without following enter, exit, update, and join conventions results re — adding elements, which quickly becomes a main source of problems.
 
A recent d3 version introduced join which is a nice way to get around the above issue. Before that we had to use enter, exit, and update patterns which were more cumbersome to use.
 
While I recommend using join where possible, I am personally using a custom method added to the d3 prototype
 
// Custom enter exit update pattern initialization (prototype method)
this.initializeEnterExitUpdatePattern();
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
To understand what this code does, I’ll show you 3 examples doing the same thing.
 
Let’s say we want to add a g element to SVG and then 2 circles to that g element. And we still need to have 1 g and 2 circles when that code is re-executed
 
The wrong way
 
let circlesData = [
   {r:Math.random()},
   {r:Math.random()}
]
 
let g = svg.append('g')
 
g
 .selectAll('.item')
 .data(circlesData)
 .enter()
 .append('circle)
This approach will create a g element and circles on each code execution. So after 10x execution, we will have 10 g elements and 20 circle elements, which is not what we want at all.
 
The better correct way
 
let circlesData = [
   {r:Math.random()},
   {r:Math.random()}
]
 
let g = svg
 .selectAll('.g-wrapper')
 .data([1])
 .join('g')
 .classed('g-wrapper',true)
 
g
 .selectAll('.item')
 .data(circlesData,(d,i)=>d.id||i)
 .join('circle)
 .classed('item',true)
This will make sure that on every rerender we only have 1 g and 2 circles element
 
The old and still correct way
 
let circlesData = [
   {r:Math.random()},
   {r:Math.random()}
]
 
// G enter exit update
let gSelection = svg
  .selectAll('.g-wrapper')
  .data([1])
 
let gEnter = gSelection.enter('g')
 
gSelection.exit().remove()
 
let g = gSelection.merge(gEnter)
  .classed('g-wrapper',true)
 
// Circle enter exit update
let itemSelection = g
  .selectAll('.item')
  .data(circlesData,(d,i)=>d.id||i))
 
let itemEnter = itemSelection.enter('circle')
 
itemSelection.exit().remove()
 
itemSelection.merge(itemSelection)
 .classed('item',true)
This will also make sure that on every rerender we will only have 1 g and 2 circles element
 
The method from my convention and still correct
 
let circlesData = [
   {r:Math.random()},
   {r:Math.random()}
]
 
let g = svg._add('g.wrapper')
 
g._add('circle.item',circlesData);
As you can see my version is still correct and a bit shorter than others, which is enough reason for me to keep using this approach over join .
 
Under the hood, this method also automatically tracks objects with an id property (if a bound object has any) instead of default index tracking of d3, which is again more useful than the default.
 
3/5 — Drawing Body
Everything starts with the render method
 
  render() {
        this.addChartGui()
        this.setDynamicContainer();
        this.calculateProperties();
        this.drawSvgAndWrappers();
        this.drawRects();
        this.setState({firstRender:false})
        return this;
   }
All the methods have self-explainable names but we’ll go through each of them anyway
 
addChartGui() {
        const { guiEnabled, firstRender } = this.getState()
        console.log({ guiEnabled, firstRender })
        if (!guiEnabled || !firstRender) return;
        if (typeof lil == 'undefined') return;
        const gui = new lil.GUI()
        gui.close()
        const state = JSON.parse(JSON.stringify(this.getState()))
        const propChanged = () => {
            supportedKeys.forEach(k => {
                this.setState({ [k]: state[k] })
            })
            this.render();
        }
        const supportedKeys = Object.keys(state)
            .filter(k =>
                typeof state[k] == 'number' ||
                typeof state[k] == 'string' ||
                typeof state[k] == 'boolean'
 
            )
            .filter(d => !['guiEnabled', 'firstRender'].includes(d))
        supportedKeys.forEach(key => {
            gui.add(state, key).onChange(d => {
                propChanged()
            })
        })
 
    }
This code creates GUI config properties dynamically from attrs state object
 
setDynamicContainer() {
        const attrs = this.getState();
 
        //Drawing containers
        var d3Container = d3.select(attrs.container);
        var containerRect = d3Container.node().getBoundingClientRect();
        if (containerRect.width > 0) attrs.svgWidth = containerRect.width;
 
        d3.select(window).on("resize." + attrs.id,  ()=> {
            var containerRect = d3Container.node().getBoundingClientRect();
            if (containerRect.width > 0) attrs.svgWidth = containerRect.width;
            this.render();
        });
 
        this.setState({ d3Container });
    }
This code is what makes visualization responsive. It adds a listener to resize events, calculates and saves container width, and rerenders the graph.
 
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
This method is responsible for calculating and storing mostly margin and width-related variables. It can be extended with other calculations too
 
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
        const svg = d3Container._add('svg.svg-chart-container')
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
This method creates svg and also chart elements. We will almost always use a chart wrapper for adding visualization elements. In many d3 examples, they would add a new g wrapper element and were calling it SVG which does not make much sense since it does not have anything related to SVG and was confusing. Just something to be aware of.
 
   drawRects() {
        const { chart, data, chartWidth, chartHeight } = this.getState();
 
        chart._add('rect.rect-sample')
            .attr("width", chartWidth)
            .attr("height", chartHeight)
            .attr("fill", (d) => d.color);
    }
Just a placeholder method where actual drawing happens. We could name it accordingly depending on visualizations. Like drawLines or drawAreas e.t.c
 
4/5 — Usage
What makes this boilerplate class great is how simple its usage is and how fast can you customize and extend it with additional features.
 
To start using it, you can just create a new instance of the chart
 
let chart = new Chart()
You can start filling in necessary state info along the way, asynchronously. For example, Suppose we want to first download data and then set and render it.
 
d3.json('data-path.csv').then(data=>{
  chart.data(data)
       .container('.container-class-name')
       .render()
})
Suppose after some time you want to change the data and rerender the graph with the new data, this is how you can achieve that
 
chart.data(newData).render()
As you can see exposed part of the graph is quite easy to use and yet still powerful, fully customizable, and controllable in runtime.
 
5/5 — Integration
Above mentioned features make it quite easy to integrate d3 charts into mainstream frontend libraries.
 
The common rule for them is the following:
 
Get DOM element reference
Use that element and data to create a reference for the chart
Listen to changes and rerender the graph with new data
Let’s see the above rule in practice.
 
1/4. Svelte
 
<script>
 import { onMount } from 'svelte';
 
 import { Chart } from './chart.d3.js';
 
 export let data = {
  name: 'test',
  color: 'red'
 };
 
 
 let chart; 
 let chartContainer; 
 
 $: {
  if (chart) {
   chart.data(data).render(); // 3. Listen to changes and rerender the graph with new data
  }
 }
 
 onMount(() => {
  // 2. use DOM element and data to create a chart reference
  chart = new Chart(data)
   .container(chartContainer)
   .data(data)
   .render();
 });
</script>
 
<!--1.  Get DOM element reference -->
<div bind:this={chartContainer} />
Svelte usage
 
import ChartSample from "ChartSample.svelte"
import {useState} from 'react'
 
let currentData = [
   {r:Math.random()},
   {r:Math.random()}
]
 
<ChartSample data={currentData}> </ChartSample>
2/4. React
 
import React, { useLayoutEffect, useRef, useEffect } from 'react';
import { Chart } from './chart.d3.js';
 
export const ChartSample = (props, ref) => {
  const d3Container = useRef(null);
  const chartRef = useRef(new Chart());
  useLayoutEffect(() => {
    if (props.data && d3Container.current) {
      chartRef.current
        .container(d3Container.current)
        .data(props.data)
        .render();
    }
  }, [props.data, d3Container.current]); // 3. Listen to changes and rerender the graph with new data
 
  return (
    <div>
      {/*   Get DOM element reference */}
      <div ref={d3Container} />
    </div>
  );
};
React Usage
 
import { ChartSample } from './Chart';
 
const App = (props) => {
    const [currentData, seTCurrentData] = useState([
      {r:Math.random()},
      {r:Math.random()}
    ]);
 
   return (
      <ChartSample
        data={currentData}
      />
   );
})
3/4. Angular
 
chart.component.ts
 
import {
  OnChanges,
  Component,
  OnInit,
  Input,
  ViewChild,
  ElementRef
} from '@angular/core';
 
import { Chart } from './chart.d3.js';
 
@Component({
  selector: 'app-chart-sample',
  templateUrl: './chart.component.html',
  styleUrls: ['./chart.component.css']
})
export class SampleChartComponent implements OnInit, OnChanges {
  // 1.  Get DOM element reference -->
  @ViewChild('chartContainer') chartContainer: ElementRef;
  @Input() data: any[];
  chart;
 
  constructor() {}
 
  ngOnInit() {}
 
  ngAfterViewInit() {
    if (!this.chart) {
      this.chart = new Chart();
    }
    this.updateChart();
  }
 
  // 3. Listen to changes and rerender the graph with new data
  ngOnChanges() {
    this.updateChart();
  }
  updateChart() {
    // 2. use DOM element and data to create a chart reference
    if (!this.data) {
      return;
    }
    if (!this.chart) {
      return;
    }
    this.chart
      .container(this.chartContainer.nativeElement)
      .data(this.data)
      .render();
  }
}
chart.component.html
 
<!--1.  Get DOM element reference -->
<div #chartContainer id="chartContainer"></div>
Angular usage:
 
app.module.ts — (SampleChartComponent)
 
import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { FormsModule } from '@angular/forms';
 
import { AppComponent } from './app.component';
import { SampleChartComponent } from './chart.component';
 
@NgModule({
  imports: [BrowserModule, FormsModule],
  declarations: [AppComponent, SampleChartComponent],
  bootstrap: [AppComponent]
})
export class AppModule {}
app.component.ts — (data setting)
 
import { Component } from '@angular/core';
 
@Component({
  selector: 'my-app',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css']
})
export class AppComponent {
  currentData: null;
 
  ngOnInit() {
    d3.json(
      'data-url.json'
    ).then(data => {
      this.currentData = data;
    });
  }
}
app.component.html
 
<app-chart-sample [data]="currentData"></app-chart-sample>
4/4 — And finally Vue
 
Chart.js
 
import { Chart } from './chart.d3.js';
 
export default {
  // 1.  Get DOM element reference -->
  template: `  <div  ref="svgElementContainer" ></div>`,
  name: 'SampleChart',
  props: ['data'],
  data() {
    return {
      chartReference: null, // 1.  Get DOM element reference -->
    };
  },
  watch: {
    // 3. Listen to changes and rerender the graph with new data
    data(value) {
      this.renderChart(value);
    },
  },
  created() {
   
  },
  methods: {
    renderChart(data) {
      // 2. use DOM element and data to create a chart reference
      if (!this.chartReference) {
        this.chartReference = new Chart();
      }
      this.chartReference
        .container(this.$refs.svgElementContainer)
        .data(data)
        .render();
    },
  },
};
Vue Usage
 
<template>
  <SampleChart :data="data"></SampleChart>
</template>
 
<script>
import * as d3 from 'd3';
import SampleChart from './Chart.js';
 
export default {
  el: '#App',
  data() {
    return {
      data: null,
    };
  },
  components: {
    SampleChart,
  },
  created() {
     d3.json(
      'data-url.json'
    ).then((data) => {
      this.data = data
    });
  },
};
</script>
As you can see it’s possible to use exactly the same visualization class with different frontend libraries without issues