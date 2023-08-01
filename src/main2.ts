import {
  lightningChart,
  Themes,
  emptyLine,
  AutoCursorModes,
  AxisTickStrategies,
  ColorHEX,
  SolidFill,
} from "@arction/lcjs";

// Helper function to generate channel array
const generateChannels = (count: number) => {
  return Array.from({ length: count }, (_, i) => ({
    name: `ECG-${i}`,
    yMin: -2500,
    yMax: 2500,
  }));
};

// Reading graphCount from localStorage or default to 3
const selectedGraphCount = localStorage.getItem("graphCount") || "3";

// Initial CHANNELS based on stored graphCount
let CHANNELS = generateChannels(Number(selectedGraphCount));

const graphCount = document.getElementById("graphCount") as HTMLSelectElement;

// Setting the selected value on load
graphCount.value = selectedGraphCount;

// Updating localStorage on change event
graphCount.addEventListener("change", (e) => {
  localStorage.setItem("graphCount", (e.target as HTMLSelectElement).value);
  console.log("dolev")
  location.reload();
});

document.addEventListener("DOMContentLoaded", async () => {
  const data = await fetch(
    "https://lightningchart.com/lightningchart-js-interactive-examples/examples/assets/0033/ecg.json"
  );
  const ecgData = await data.json();

  const X_VIEW_MS = 5 * 1000;

  const dashboard = lightningChart()
    .Dashboard({
      numberOfColumns: 3,
      numberOfRows: Math.floor(CHANNELS.length / 3),
      theme: Themes.darkGold,
    })
    .setSplitterStyle(emptyLine);
  console.log(dashboard);
  const theme = dashboard.getTheme();
  const ecgBackgroundFill = new SolidFill({
    color: theme.isDark ? ColorHEX("#000000") : ColorHEX("#ffffff"),
  });

  const channels = CHANNELS.map((info, iCh) => {
    const chart = dashboard
      .createChartXY({
        columnIndex: iCh % 3,
        rowIndex: Math.floor(iCh / 3),
      })
      .setTitle("")
      .setTitlePosition("series-left-top")
      .setAutoCursorMode(AutoCursorModes.disabled)
      .setSeriesBackgroundFillStyle(ecgBackgroundFill)
      .setMouseInteractions(false)
      .setSeriesBackgroundStrokeStyle(emptyLine);

    const axisX = chart
      .getDefaultAxisX()
      .setTickStrategy(AxisTickStrategies.Empty)
      .setStrokeStyle(emptyLine)
      .setScrollStrategy(undefined)
      .setInterval({ start: 0, end: X_VIEW_MS, stopAxisAfter: false });

    const axisY = chart
      .getDefaultAxisY()
      .setStrokeStyle(emptyLine)
      .setInterval({ start: info.yMin, end: info.yMax })
      .setTickStrategy(AxisTickStrategies.Empty);

    // Series for displaying "old" data.
    const seriesRight = chart
      .addLineSeries({
        dataPattern: { pattern: "ProgressiveX" },
        automaticColorIndex: iCh,
      })
      .setName(info.name)
      .setStrokeStyle((stroke: any) => stroke.setThickness(1))
      .setEffect(false);

    // Rectangle for hiding "old" data under incoming "new" data.
    const seriesOverlayRight = chart
      .addRectangleSeries()
      .setEffect(false)
      .add({ x1: 0, y1: 0, x2: 0, y2: 0 })
      .setFillStyle(ecgBackgroundFill)
      .setStrokeStyle(emptyLine)
      .setMouseInteractions(false);

    // Series for displaying new data.
    const seriesLeft = chart
      .addLineSeries({
        dataPattern: { pattern: "ProgressiveX" },
        automaticColorIndex: iCh,
      })
      .setName(info.name)
      .setStrokeStyle((stroke: any) => stroke.setThickness(1))
      .setEffect(false);

    // Synchronize highlighting of "left" and "right" series.
    let isHighlightChanging = false;
    [seriesLeft, seriesRight].forEach((series) => {
      series.onHighlight((value: any) => {
        if (isHighlightChanging) {
          return;
        }
        isHighlightChanging = true;
        seriesLeft.setHighlight(value);
        seriesRight.setHighlight(value);
        isHighlightChanging = false;
      });
    });

    return {
      chart,
      seriesLeft,
      seriesRight,
      seriesOverlayRight,
      axisX,
      axisY,
    };
  });

  // Setup logic for pushing new data points into a "custom sweeping line chart".
  // LightningChart JS does not provide built-in functionalities for sweeping line charts.
  // This example shows how it is possible to implement a performant sweeping line chart, with a little bit of extra application complexity.
  let prevPosX = 0;
  // Keep track of data pushed to each channel.
  const channelsNewDataCache = new Array(CHANNELS.length)
    .fill(0)
    .map((_) => []);
  const appendDataPoints = (dataPointsAllChannels: any) => {
    // Keep track of the latest X (time position), clamped to the sweeping axis range.
    let posX = 0;

    for (let iCh = 0; iCh < CHANNELS.length; iCh += 1) {
      const newDataPointsTimestamped = dataPointsAllChannels[iCh];
      const newDataCache: any = channelsNewDataCache[iCh];
      const channel = channels[iCh];

      // NOTE: Incoming data points are timestamped, meaning their X coordinates can go outside sweeping axis interval.
      // Clamp timestamps onto the sweeping axis range.
      const newDataPointsSweeping = newDataPointsTimestamped.map((dp: any) => ({
        x: dp.x % X_VIEW_MS,
        y: dp.y,
      }));

      posX = Math.max(
        posX,
        newDataPointsSweeping[newDataPointsSweeping.length - 1].x
      );

      // Check if the channel completes a full sweep (or even more than 1 sweep even though it can't be displayed).
      let fullSweepsCount = 0;
      let signPrev = false;
      for (const dp of newDataPointsSweeping) {
        const sign = dp.x < prevPosX;
        if (sign === true && sign !== signPrev) {
          fullSweepsCount += 1;
        }
        signPrev = sign;
      }

      if (fullSweepsCount > 1) {
        // The below algorithm is incapable of handling data input that spans over several full sweeps worth of data.
        // To prevent visual errors, reset sweeping graph and do not process the data.
        // This scenario is triggered when switching tabs or minimizing the example for extended periods of time.
        channel.seriesRight.clear();
        channel.seriesLeft.clear();
        newDataCache.length = 0;
      } else if (fullSweepsCount === 1) {
        // Sweeping cycle is completed.
        // Copy data of "left" series into the "right" series, clear "left" series.

        // Categorize new data points into "right" and "left" sides.
        const newDataPointsLeft = [];
        for (const dp of newDataPointsSweeping) {
          if (dp.x > prevPosX) {
            newDataCache.push(dp);
          } else {
            newDataPointsLeft.push(dp);
          }
        }
        channel.seriesRight.clear().add(newDataCache);
        channel.seriesLeft.clear().add(newDataPointsLeft);
        newDataCache.length = 0;
        newDataCache.push(...newDataPointsLeft);
      } else {
        // Append data to left.
        channel.seriesLeft.add(newDataPointsSweeping);
        // NOTE: While extremely performant, this syntax can crash if called with extremely large arrays (at least 100 000 items).
        newDataCache.push(...newDataPointsSweeping);
      }
    }

    // Move overlays of old data to right locations.
    const overlayXStart = 0;
    const overlayXEnd = posX + X_VIEW_MS * 0.03;
    channels.forEach((channel) => {
      channel.seriesOverlayRight.setDimensions({
        x1: overlayXStart,
        x2: overlayXEnd,
        y1: channel.axisY.getInterval().start,
        y2: channel.axisY.getInterval().end,
      });
    });

    prevPosX = posX;
  };

  // Setup example data streaming
  let tStart = window.performance.now();
  let pushedDataCount = 0;
  const dataPointsPerSecond = 44_000; // 1000 Hz
  const xStep = 1000 / dataPointsPerSecond;
  const streamData = () => {
    const tNow = window.performance.now();
    // NOTE: This code is for example purposes only (streaming stable data rate)
    // In real use cases, data should be pushed in when it comes.
    const shouldBeDataPointsCount = Math.floor(
      (dataPointsPerSecond * (tNow - tStart)) / 1000
    );
    const newDataPointsCount = shouldBeDataPointsCount - pushedDataCount;
    if (newDataPointsCount > 0) {
      const newDataPoints: any = [];
      for (let iDp = 0; iDp < newDataPointsCount; iDp++) {
        const x = (pushedDataCount + iDp) * xStep;
        const iData = (pushedDataCount + iDp) % ecgData.length;
        const y = ecgData[iData];
        const point = { x, y };
        newDataPoints.push(point);
      }

      // For this examples purposes, stream same data into all channels.
      appendDataPoints(
        new Array(CHANNELS.length).fill(0).map((_) => newDataPoints)
      );
      pushedDataCount += newDataPointsCount;
    }

    requestAnimationFrame(streamData);
  };
  streamData();
});
