drawWorldMap() {
        const {
            chart,
            chartWidth,
            chartHeight,
            worldMap,
            data,
            gradientColors,
            countryStyles,
            tooltipStyles,
            pinStyles
        } = this.getState();
 
        const mapLayer = chart._add('g.map-layer');
        const pinsLayer = chart._add('g.pins-layer');
 
        const filteredFeatures = worldMap.features.filter(d => d.properties.name !== "Antarctica");
 
        const projection = d3.geoMercator()
            .fitSize([chartWidth, chartHeight], {
                type: "FeatureCollection",
                features: filteredFeatures
            });
 
        const path = d3.geoPath().projection(projection);
 
        const gradient = mapLayer._add("defs.gradient-defs")
            ._add("linearGradient.gradient")
            .attr("id", "country-gradient")
            .attr("gradientUnits", "userSpaceOnUse")
            .attr("x1", "0")
            .attr("y1", "0")
            .attr("x2", chartWidth)
            .attr("y2", chartHeight);
 
        gradient._add("stop.gradient-stop-start")
            .attr("offset", "0%")
            .attr("stop-color", gradientColors.start);
 
        gradient._add("stop.gradient-stop-end")
            .attr("offset", "100%")
            .attr("stop-color", gradientColors.end);
 
        mapLayer._add('path.country', filteredFeatures)
            .attr('d', path)
            .attr('fill', 'url(#country-gradient)')
            .attr('stroke', countryStyles.stroke)
            .attr('stroke-width', countryStyles.strokeWidth);
 
        const tooltip = d3.select("body")
            ._add("div.tooltip")
            .style("background-color", tooltipStyles.backgroundColor)
            .style("padding", tooltipStyles.padding)
            .style("border-radius", tooltipStyles.borderRadius)
            .style("pointer-events", tooltipStyles.pointerEvents)
            .style("box-shadow", tooltipStyles.boxShadow)
            .style("position", tooltipStyles.position)
            .style("opacity", tooltipStyles.opacity)
            .style("font-size", tooltipStyles.fontSize)
            .style("max-width", tooltipStyles.maxWidth
            );
 
        const newPins = pinsLayer._add("image.pin", data?.locations || [])
            .attr("width", pinStyles.initialSize)
            .attr("height", pinStyles.initialSize)
            .attr("href", "images/pin.svg")
            .style("cursor", pinStyles.cursor)
            .style("opacity", pinStyles.opacity)
            .attr("x", d => {
                const coords = projection([d.longitude, d.latitude]);
                return coords ? coords[0] - pinStyles.size / 2 : 0;
            })
            .attr("y", d => {
                const coords = projection([d.longitude, d.latitude]);
                return coords ? coords[1] - pinStyles.size : 0;
            })
            .on("mouseover", (event, d) => {
                tooltip
                    .style("opacity", 1)
                    .html(`<strong>${d.name}</strong><br/>შეფასება: ${d.score}</strong><br/>${d.info}`)
                    .style("left", (event.pageX + 10) + "px")
                    .style("top", (event.pageY - 28) + "px");
            })
            .on("mouseout", () => {
                tooltip.style("opacity", 0);
            });
 
        newPins
            .transition()
            .delay((d, i) => i * 1000)
            .duration(500)
            .style("opacity", 1)
            .attr("width", pinStyles.size)
            .attr("height", pinStyles.size);
    }