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
  nearestExpirationFlowDays,
  pairsFromSessions,
  sessionsToExpiry,
  sumDailyVolumes,
} = require('./scripts/generateDailyOptionsReport');

const DATES = ['06-29', '06-30', '07-01', '07-02', '07-06', '07-07', '07-08', '07-09', '07-10', '07-13']
  .map(day => `2026-${day}`);

const PRIOR_EXPIRY = { quarter: '2026-04-17', year: '2025-07-18' };

function chartWith(barVolumes, quarterVolumes, yearVolumes) {
  const byKey = { quarter: quarterVolumes, year: yearVolumes };
  return {
    rows: DATES.map((date, i) => ({ date, volume: barVolumes[i] })),
    color: '#059669',
    softColor: '#bfe8d8',
    sideLabel: 'calls',
    expiration: '2026-07-17',
    nextEarnings: '2026-07-16',
    priors: CYCLES.map(cycle => ({
      ...cycle,
      expiration: PRIOR_EXPIRY[cycle.key],
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
  // The diamond marker's path starts at its top vertex and closes (Z). The series
  // polylines are open paths that also start with "M x,y L", so the close is what
  // separates a marker from the start of a line — which, now that lines and bars
  // share one scale, can begin anywhere in the plot.
  const diamonds = [...svg.matchAll(/<path d="M([\d.]+),([\d.]+) L[^"]*Z"/g)]
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
  assert.match(svg, /next call 7\/16/);
});

test('the legend names the expiration each series sums', () => {
  const svg = buildVolumeChartSvg(chartWith(
    [1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000],
    [2000, 2000, 2000, 2000, 2000, 2000, 2000, 2000, 2000, 2000],
    [3000, 3000, 3000, 3000, 3000, 3000, 3000, 3000, 3000, 3000],
  ));
  // Two charts of the same ticker over the same ten sessions differ only in the chains
  // they hold against each other, so the legend has to say which those are. The year
  // that separates the prior-year chain from the rest is what makes it confusable, so
  // that entry — and only that entry — carries one.
  assert.match(svg, /Jul 17, current/);
  assert.match(svg, /Apr 17, last qtr/);
  assert.match(svg, /Jul 18 &#39;25, 1 yr ago/);
  assert.ok(!svg.includes('All calls'), 'the legend names chains, not sides');
});

// The bars, as emitted: the rounded rects of the plot. The legend swatch is square
// (rx="2"), so rx="4" picks out the bars alone.
function barsOf(svg) {
  return [...svg.matchAll(/<rect x="([\d.]+)" y="([\d.]+)" width="[\d.]+" height="([\d.]+)" rx="4"/g)]
    .map(m => ({ x: +m[1], y: +m[2], height: +m[3] }));
}

test('bars and comparison lines are drawn on one shared scale', () => {
  // Bars and lines both count a full chain, so they are the same quantity and are
  // read against one axis: height is comparable everywhere in the frame, and the
  // tallest mark — here a comparison point, not a bar — sets the top of the plot.
  const svg = buildVolumeChartSvg(chartWith(
    [1900, 795, 547, 1600, 1100, 12800, 11200, 7600, 44900, 44900],
    [13200, 32800, 41500, 20800, 23900, 96800, 36500, 44000, 37600, 45700],
    [11300, 21100, 36200, 39700, 34100, 115000, 39000, 57700, 44600, 39000],
  ));

  const bars = barsOf(svg);
  assert.equal(bars.length, 10, 'every session gets a bar');

  // The cost of one axis: against a cycle 2.6× larger, the quietest sessions (under
  // ~2k contracts) compress into the 5px minimum bar and stop being distinguishable
  // by height. The busy sessions — the ones the chart is read for — stay separable,
  // and every bar still prints its absolute total.
  const busy = bars.filter(bar => bar.height > 5);
  const distinct = new Set(busy.map(bar => bar.height.toFixed(1)));
  assert.ok(distinct.size >= 4, `busy sessions should be distinguishable, got ${distinct.size}`);

  // One scale, checked where the two marks meet: on the last session the bar (44,900)
  // is larger than the year point above it (39,000), so that point must fall inside
  // the bar rather than floating over it — the misreading a separate band invited.
  const markers = readLayout(svg).markers;
  const lastBar = bars.at(-1);
  const lastX = Math.max(...markers.map(marker => marker.x));
  const lastColumn = markers.filter(marker => Math.abs(marker.x - lastX) < 1);
  assert.ok(lastColumn.length, 'the last session carries comparison points');
  assert.ok(
    lastColumn.some(marker => marker.y > lastBar.y),
    'a comparison point below the bar it sits over is drawn inside it',
  );

  // The busiest mark in the frame is the 115,000 year peak, not a bar, so it — not the
  // tallest bar — reaches the top of the plot.
  assert.ok(
    Math.min(...markers.map(marker => marker.y)) < Math.min(...bars.map(bar => bar.y)),
    'the tallest comparison point rises above every bar',
  );

  // Heights encode volume on one scale: 12,800 against 1,900 is a 6.7× bar.
  const ratio = bars[5].height / bars[0].height;
  assert.ok(Math.abs(ratio - 12800 / 1900) < 0.1, `bar heights track volume, got ${ratio}×`);
  assertNoCollisions(svg, 'shared scale');
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

test('aggregate flow is derived from full-chain chart bars, not top-three tables', () => {
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

test('sidebar flow dots use the last three sessions from the front expiration only', () => {
  const report = {
    expirations: [
      {
        selectedDate: '2026-07-17',
        volumeCharts: {
          call: { rows: [
            { date: '2026-07-10', volume: 10 },
            { date: '2026-07-13', volume: 50 },
            { date: '2026-07-14', volume: 20 },
            { date: '2026-07-15', volume: 80 },
          ] },
          put: { rows: [
            { date: '2026-07-10', volume: 20 },
            { date: '2026-07-13', volume: 40 },
            { date: '2026-07-14', volume: 25 },
            { date: '2026-07-15', volume: 10 },
          ] },
        },
      },
      {
        selectedDate: '2026-07-24',
        volumeCharts: {
          call: { rows: [{ date: '2026-07-15', volume: 1 }] },
          put: { rows: [{ date: '2026-07-15', volume: 99999 }] },
        },
      },
    ],
  };

  assert.deepEqual(nearestExpirationFlowDays(report), [
    { date: '2026-07-13', callVolume: 50, putVolume: 40, netVolume: 10, leader: 'call' },
    { date: '2026-07-14', callVolume: 20, putVolume: 25, netVolume: -5, leader: 'put' },
    { date: '2026-07-15', callVolume: 80, putVolume: 10, netVolume: 70, leader: 'call' },
  ]);
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
  assert.ok(bars[8].height > bars[4].height, 'a busy session out-rises a quiet one');
  // The year chain peaked 11× above this chain's busiest session, and one shared scale
  // says so: the bars are drawn short. That is the comparison, not a rendering fault —
  // the absolute totals are printed above each mark for when the shape gets small.
  assert.ok(bars[8].height < 40, 'a chain dwarfed by its prior cycle is drawn short');
  assert.match(svg, />10\.4k</, 'the busy session still prints its absolute total');
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
  assert.match(svg, /Jul 18 &#39;25, 1 yr ago/);
  assert.ok(!svg.includes('last qtr'), 'no last-quarter legend entry without an anchor');
  assert.ok(!svg.includes('next call'), 'no earnings note without an upcoming call');
  assertNoCollisions(svg, 'fallback');
});

// INTC on 14 July 2026: three chains — Jul 15, Jul 17, Jul 20 — with two, four and
// seven sessions left to run. Every one of them is charted over the same ten sessions,
// so pairing a bar to the past by its distance from *earnings* gives all three charts
// the identical history, which is the bug this alignment replaces. Distance from the
// chain's own expiration separates them, and it still lands inside the same earnings
// cycle because the prior chain was picked at the same offset from its own call.
test('two expirations a few days apart read different history', () => {
  const chartDates = DATES.slice(3, 7);          // 07-02, 07-06, 07-07, 07-08
  const effectiveDate = chartDates.at(-1);       // the report's session
  // The prior quarter's sessions, most recent last, through that cycle's chain expiry.
  const priorSessions = ['2026-04-08', '2026-04-09', '2026-04-10', '2026-04-13',
    '2026-04-14', '2026-04-15', '2026-04-16', '2026-04-17'];
  const priorExpiry = '2026-04-17';

  const near = pairsFromSessions(
    priorSessions, priorExpiry,
    sessionsToExpiry(chartDates, effectiveDate, '2026-07-09'),   // expires tomorrow
    chartDates,
  );
  const far = pairsFromSessions(
    priorSessions, priorExpiry,
    sessionsToExpiry(chartDates, effectiveDate, '2026-07-14'),   // four sessions out
    chartDates,
  );

  // The last bar of the near chain is one session from expiry, so it is compared with
  // the session one before the prior chain expired; the far chain's last bar has four
  // to run, and reaches four sessions further back.
  assert.equal(near.at(-1).date, '2026-04-16');
  assert.equal(far.at(-1).date, '2026-04-13');
  assert.ok(
    near.every((pair, i) => pair.date !== far[i].date),
    'no bar in the two charts compares against the same past session',
  );

  // Every bar keeps its own counterpart, in order, and the pairing walks the real
  // session calendar rather than the calendar's gaps: 4/10 -> 4/13 skips the weekend.
  assert.deepEqual(near.map(pair => pair.date),
    ['2026-04-13', '2026-04-14', '2026-04-15', '2026-04-16']);
  assert.deepEqual(near.map(pair => pair.barDate), chartDates);
});

test('a bar deeper than the prior calendar reaches is dropped, not mispaired', () => {
  const chartDates = ['2026-07-06', '2026-07-07', '2026-07-08'];
  const priorSessions = ['2026-04-16', '2026-04-17'];
  const pairs = pairsFromSessions(
    priorSessions, '2026-04-17',
    sessionsToExpiry(chartDates, '2026-07-08', '2026-07-09'),   // 3, 2, 1 sessions out
    chartDates,
  );

  // Only the last bar (one session from expiry) has a counterpart in the two sessions
  // the calendar reaches. The others go without a marker rather than borrowing one.
  assert.deepEqual(pairs, [{ barDate: '2026-07-08', date: '2026-04-16' }]);
});
