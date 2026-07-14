'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  CYCLES,
  LABEL_GAP,
  buildVolumeChartSvg,
} = require('./scripts/generateDailyOptionsReport');

const DATES = ['06-29', '06-30', '07-01', '07-02', '07-06', '07-07', '07-08', '07-09', '07-10', '07-13']
  .map(day => `2026-${day}`);

function chartWith(barVolumes, quarterVolumes, yearVolumes) {
  const byKey = { quarter: quarterVolumes, year: yearVolumes };
  return {
    rows: DATES.map((date, i) => ({ date, volume: barVolumes[i] })),
    color: '#059669',
    softColor: '#bfe8d8',
    sideLabel: 'calls',
    nextEarnings: '2026-07-16',
    priors: CYCLES.map(cycle => ({
      ...cycle,
      points: DATES.map((date, i) => ({
        barDate: date,
        date: `2025-${date.slice(5)}`,
        volume: byKey[cycle.key][i],
      })),
    })),
  };
}

// The direct labels and the markers, as the renderer actually emitted them. Only the
// value labels carry a halo, so `paint-order` picks them out without the test having
// to know the chart's font sizes: the date row and the legend are not part of a stack.
function readLayout(svg) {
  const labels = [...svg.matchAll(/<text x="([\d.]+)" y="([\d.]+)"[^>]*paint-order="stroke"[^>]*font-size="(\d+)"[^>]*>([^<]+)<\/text>/g)]
    .map(m => ({ x: +m[1], y: +m[2], size: +m[3], text: m[4] }));

  const circles = [...svg.matchAll(/<circle cx="([\d.]+)" cy="([\d.]+)"/g)]
    .map(m => ({ x: +m[1], y: +m[2] }));
  // The diamond marker's path starts at its top vertex.
  const diamonds = [...svg.matchAll(/<path d="M([\d.]+),([\d.]+) L/g)]
    .map(m => ({ x: +m[1], y: +m[2] + 5.4 }));

  return { labels, markers: [...circles, ...diamonds] };
}

function columnsOf(layout) {
  const columns = new Map();
  for (const label of layout.labels) {
    const key = Math.round(label.x);
    if (!columns.has(key)) columns.set(key, { labels: [], markers: [] });
    columns.get(key).labels.push(label);
  }
  for (const marker of layout.markers) {
    const key = [...columns.keys()].find(x => Math.abs(x - marker.x) < 3);
    if (key != null) columns.get(key).markers.push(marker);
  }
  return [...columns.values()];
}

function assertNoCollisions(svg, label) {
  const columns = columnsOf(readLayout(svg));
  assert.ok(columns.length >= 10, `${label}: expected a column per session`);

  for (const column of columns) {
    const ys = column.labels.map(l => l.y).sort((a, b) => a - b);
    for (let i = 1; i < ys.length; i += 1) {
      assert.ok(
        ys[i] - ys[i - 1] >= LABEL_GAP - 0.01,
        `${label}: labels ${ys[i - 1]} and ${ys[i]} are only ${(ys[i] - ys[i - 1]).toFixed(1)} apart`,
      );
    }

    // A number must never have a marker sitting in it. A marker whose edge grazes a
    // digit's cap is fine — the labels carry a halo in the surface colour, which
    // separates them from whatever they touch. A marker whose *centre* lands inside
    // the glyph band is the real defect: the dot reads as a character.
    for (const text of column.labels) {
      const top = text.y - text.size * 0.72;
      for (const marker of column.markers) {
        assert.ok(
          marker.y < top || marker.y > text.y,
          `${label}: marker at y=${marker.y.toFixed(1)} sits inside the label "${text.text}" (glyphs span ${top.toFixed(1)}–${text.y.toFixed(1)})`,
        );
      }
    }
  }
}

test('three series stay legible when every column is crowded', () => {
  // Every cycle close to the bar it sits above: the worst case for stacking, and
  // what produced a marker drawn inside a number before the stacker knew about them.
  const svg = buildVolumeChartSvg(chartWith(
    [1900, 4400, 5800, 3800, 5100, 2500, 2000, 4000, 18100, 18200],
    [32900, 9300, 9300, 22900, 10900, 8400, 5800, 24800, 23300, 31700],
    [7000, 8100, 11200, 15500, 17200, 5900, 10800, 23800, 19000, 17600],
  ));
  assertNoCollisions(svg, 'crowded');
});

test('three series stay legible when all three all but coincide', () => {
  const svg = buildVolumeChartSvg(chartWith(
    [10000, 10000, 10000, 10000, 10000, 10000, 10000, 10000, 10000, 10000],
    [10100, 10200, 10050, 10000, 10300, 10100, 10000, 10200, 10100, 10000],
    [10050, 10100, 10000, 10150, 10000, 10200, 10100, 10000, 10200, 10100],
  ));
  assertNoCollisions(svg, 'coincident');
});

test('a comparison line below the bars does not collide either', () => {
  const svg = buildVolumeChartSvg(chartWith(
    [20000, 20000, 20000, 20000, 20000, 20000, 20000, 20000, 20000, 20000],
    [900, 1200, 800, 1500, 1000, 700, 1100, 900, 1300, 1000],
    [1400, 1000, 1600, 900, 1200, 1500, 800, 1300, 900, 1100],
  ));
  assertNoCollisions(svg, 'lines below bars');
});

test('each series is identifiable without colour', () => {
  const svg = buildVolumeChartSvg(chartWith(
    [1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000],
    [2000, 2000, 2000, 2000, 2000, 2000, 2000, 2000, 2000, 2000],
    [3000, 3000, 3000, 3000, 3000, 3000, 3000, 3000, 3000, 3000],
  ));
  // Solid + diamond for last quarter, dashed + circle for a year ago: a reader who
  // cannot separate the two hues still has line style and marker shape.
  assert.match(svg, /stroke-dasharray="5 4"/);
  assert.ok(svg.includes('<circle') && svg.includes('<path d="M'), 'both marker shapes present');
  assert.match(svg, /All calls, last qtr/);
  assert.match(svg, /All calls, 1 yr ago/);
  assert.match(svg, /next call 7\/16/);
});

test('a ticker with no earnings alignment still renders the year line alone', () => {
  const chart = chartWith(
    [1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000],
    [], [3000, 3000, 3000, 3000, 3000, 3000, 3000, 3000, 3000, 3000],
  );
  // The fallback path supplies only the year cycle, and no upcoming call.
  chart.priors = chart.priors.filter(prior => prior.key === 'year');
  chart.nextEarnings = null;

  const svg = buildVolumeChartSvg(chart);
  assert.match(svg, /All calls, 1 yr ago/);
  assert.ok(!svg.includes('last qtr'), 'no last-quarter legend entry without an anchor');
  assert.ok(!svg.includes('next call'), 'no earnings note without an upcoming call');
  assertNoCollisions(svg, 'fallback');
});
