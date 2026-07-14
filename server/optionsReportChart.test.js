'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  CYCLES,
  LABEL_GAP,
  aggregateFlow,
  buildCurrentChainRows,
  buildVolumeChartSvg,
  currentRowsFromTotals,
  sumDailyVolumes,
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
  assert.match(svg, /All calls, current/);
  assert.ok(!svg.includes('Top 3 calls'), 'bar legend describes the full current chain');
  assert.match(svg, /All calls, last qtr/);
  assert.match(svg, /All calls, 1 yr ago/);
  assert.match(svg, /next call 7\/16/);
});

// The bars, as emitted: the rounded rects of the plot. The legend swatch is square
// (rx="2"), so rx="4" picks out the bars alone.
function barsOf(svg) {
  return [...svg.matchAll(/<rect x="([\d.]+)" y="([\d.]+)" width="[\d.]+" height="([\d.]+)" rx="4"/g)]
    .map(m => ({ x: +m[1], y: +m[2], height: +m[3] }));
}

test('bars stay readable when a comparison cycle dwarfs the current chain', () => {
  // Full chains can still differ sharply between earnings cycles. Sharing one y-scale
  // would flatten the quieter cycle onto the axis and make real sessions look absent.
  const svg = buildVolumeChartSvg(chartWith(
    [1900, 795, 547, 1600, 1100, 12800, 11200, 7600, 44900, 44900],
    [13200, 32800, 41500, 20800, 23900, 96800, 36500, 44000, 37600, 45700],
    [11300, 21100, 36200, 39700, 34100, 115000, 39000, 57700, 44600, 39000],
  ));

  const bars = barsOf(svg);
  assert.equal(bars.length, 10, 'every session gets a bar');

  // The bars are scaled among themselves, so the day's peak fills its band and the
  // quiet sessions keep a height that reflects their volume rather than a floor.
  const tallest = Math.max(...bars.map(bar => bar.height));
  const distinct = new Set(bars.map(bar => bar.height.toFixed(1)));
  assert.ok(tallest > 150, `tallest bar should fill its band, got ${tallest}`);
  assert.ok(distinct.size >= 7, `bars should be distinguishable, got ${distinct.size} heights`);

  // Bars and lines never overlap, so a point can't be misread as sitting "above" a bar
  // it shares no scale with.
  const markers = readLayout(svg).markers;
  const barTop = Math.min(...bars.map(bar => bar.y));
  assert.ok(
    Math.max(...markers.map(m => m.y)) < barTop,
    'every comparison point sits clear of the bar band',
  );
  assert.match(svg, /lines: own scale/);
  assertNoCollisions(svg, 'chain dwarfs bars');
});

test('current rows sum every contract in the selected expiration', () => {
  const histories = [
    [{ date: DATES[0], volume: 10 }, { date: DATES[1], volume: 20 }],
    [{ date: DATES[0], volume: 30 }, { date: DATES[1], volume: 40 }],
    [{ date: DATES[0], volume: 50 }, { date: DATES[1], volume: 60 }],
    // A fourth strike proves the chart is not capped at the table's top three.
    [{ date: DATES[0], volume: 70 }, { date: DATES[1], volume: 80 }],
  ];
  const totals = sumDailyVolumes(histories);
  const contracts = [
    { volume: 11 }, { volume: 22 }, { volume: 33 }, { volume: 44 },
  ];
  const rows = currentRowsFromTotals(contracts, [DATES[0], DATES[1], DATES[2]], DATES[2], totals);

  assert.deepEqual(rows, [
    { date: DATES[0], volume: 160 },
    { date: DATES[1], volume: 200 },
    { date: DATES[2], volume: 110 },
  ]);
});

test('current-chain cache backfills once and fetches newly added strikes', async () => {
  let entry = null;
  const fetched = [];
  const historyBySymbol = {
    A: [{ date: DATES[0], volume: 10 }, { date: DATES[1], volume: 20 }],
    B: [{ date: DATES[0], volume: 30 }, { date: DATES[1], volume: 40 }],
    C: [{ date: DATES[0], volume: 5 }, { date: DATES[1], volume: 7 }],
  };
  const dependencies = {
    readEntry: () => entry,
    saveEntry: (_key, value) => { entry = JSON.parse(JSON.stringify(value)); },
    fetchHistory: async symbol => {
      fetched.push(symbol);
      return historyBySymbol[symbol] ?? [];
    },
  };
  const baseContracts = [
    { contractSymbol: 'A', volume: 100 },
    { contractSymbol: 'B', volume: 200 },
  ];

  const first = await buildCurrentChainRows(
    'INTC', 'call', '2026-07-17', baseContracts,
    [DATES[0], DATES[1], DATES[2]], DATES[2], '2026-07-14', dependencies,
  );
  assert.deepEqual(first.map(row => row.volume), [40, 60, 300]);
  assert.deepEqual(fetched.sort(), ['A', 'B']);
  assert.deepEqual(entry.symbols, ['A', 'B']);

  fetched.length = 0;
  const cached = await buildCurrentChainRows(
    'INTC', 'call', '2026-07-17', baseContracts,
    [DATES[0], DATES[1], DATES[2]], DATES[2], '2026-07-14', dependencies,
  );
  assert.deepEqual(cached.map(row => row.volume), [40, 60, 300]);
  assert.deepEqual(fetched, [], 'an unchanged covered chain is a cache hit');

  fetched.length = 0;
  const expanded = await buildCurrentChainRows(
    'INTC', 'call', '2026-07-17',
    [...baseContracts, { contractSymbol: 'C', volume: 50 }],
    [DATES[0], DATES[1], DATES[2]], DATES[2], '2026-07-14', dependencies,
  );
  assert.deepEqual(expanded.map(row => row.volume), [45, 67, 350]);
  assert.deepEqual(fetched, ['C'], 'only the newly listed strike is backfilled');
  assert.deepEqual(entry.symbols, ['A', 'B', 'C']);
});

test('a failed required history request is not persisted as zero volume', async () => {
  let saves = 0;
  const dependencies = {
    readEntry: () => null,
    saveEntry: () => { saves += 1; },
    fetchHistory: async symbol => {
      if (symbol === 'B') throw new Error('temporary Massive failure');
      return [{ date: DATES[0], volume: 10 }];
    },
  };

  await assert.rejects(
    buildCurrentChainRows(
      'INTC', 'call', '2026-07-17',
      [{ contractSymbol: 'A', volume: 100 }, { contractSymbol: 'B', volume: 200 }],
      [DATES[0], DATES[1]], DATES[1], '2026-07-14', dependencies,
    ),
    /temporary Massive failure/,
  );
  assert.equal(saves, 0, 'partial backfills must be retried on the next run');
});

test('sidebar flow is derived from full-chain chart bars, not top-three tables', () => {
  const report = {
    expirations: [
      {
        volumeCharts: {
          call: { rows: [{ volume: 100 }, { volume: 250 }] },
          put: { rows: [{ volume: 80 }, { volume: 200 }] },
        },
        tableCalls: [{ todayVolume: 1, yesterdayVolume: 1 }],
        tablePuts: [{ todayVolume: 1, yesterdayVolume: 1 }],
      },
      {
        volumeCharts: {
          call: { rows: [{ volume: 40 }, { volume: 75 }] },
          put: { rows: [{ volume: 20 }, { volume: 30 }] },
        },
      },
    ],
  };

  assert.deepEqual(aggregateFlow(report), {
    callToday: 325,
    callYesterday: 140,
    putToday: 230,
    putYesterday: 100,
  });
});

test('a session the prior chain never traded still gets its bar', () => {
  const chart = chartWith(
    [0, 0, 0, 0, 81, 1600, 3400, 2500, 10400, 10300],
    [], [11300, 21100, 36200, 39700, 34100, 115000, 39000, 57700, 44600, 39000],
  );
  chart.priors = chart.priors.filter(prior => prior.key === 'year');
  // The year chain only traded the back half of the window — the front half of the
  // line has no points at all, and must not take the bars down with it.
  chart.priors[0].points = chart.priors[0].points.slice(5);

  const svg = buildVolumeChartSvg(chart);
  const bars = barsOf(svg);
  assert.equal(bars.length, 10, 'a bar per session, with or without a point above it');
  // The four leading zeros are real zeros, not absent data: they sit at the floor,
  // while every traded session rises above it.
  assert.ok(bars.slice(0, 4).every(bar => bar.height === 5), 'zero sessions sit at the floor');
  assert.ok(bars[8].height > 50, 'a busy session is drawn at full scale');
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
