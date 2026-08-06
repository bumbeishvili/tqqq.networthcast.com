// OLD
 
chart.append('g')
  .attr('class','wrap-element')
 
// NEW
 
chart._add('g.wrap-element')
 
 
// OLD
let bars = chart.selectAll('.bar')
.data(barsData)
.enter()
.append('g')
.attr('class','bar')
 
// New
chart._add('g.bar',barsData)
 
 
// OLD
bars.append('rect')
.attr('class','bar-rect')
 
// NEW
bars._add('rect.bar-rect')
 
// OLD
bars.selectAll('.stacked-rects')
.data(d=>d.values)
.enter()
.append('rect')
.attr('class','stacked-rects')
 
// NEW
bars._add('rect.stacked-rects',d=>d.values)