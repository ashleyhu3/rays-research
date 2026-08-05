'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { _test } = require('./indexBreadth');

test('pruneRaw retains a fixed number of market observations, not calendar days', () => {
  const history = {};
  for (let i = 1; i <= 8; i += 1) {
    history[`2026-01-${String(i).padStart(2, '0')}`] = { TEST: { close: i } };
  }
  _test.pruneRaw(history, 5);
  assert.deepEqual(Object.keys(history).sort(), [
    '2026-01-04',
    '2026-01-05',
    '2026-01-06',
    '2026-01-07',
    '2026-01-08',
  ]);
});

test('needsBootstrap flags caches too short to produce a useful SMA200 history', () => {
  const makeHistory = count => Object.fromEntries(Array.from({ length: count }, (_, i) => {
    const date = new Date(Date.UTC(2025, 0, 1 + i)).toISOString().slice(0, 10);
    return [date, {}];
  }));
  const short = makeHistory(205);
  assert.equal(_test.needsBootstrap(short), true);
  assert.equal(_test.needsBootstrap(makeHistory(260)), false);
});

const FULL_METRICS = { pctOutperform20: 40, pctOutperform200: 45, pctAt52wHigh: 10, pctAt52wLow: 5 };
const fullSeries = overrides => ({ ...FULL_METRICS, ...overrides });

test('mergeBreadthDaily does not replace backfilled values with warm-up nulls', () => {
  const history = {
    sp500: {
      '2026-01-02': fullSeries({ pctAboveBoth: 55, pctBelowBoth: 25, pctUp: 60 }),
    },
  };
  _test.mergeBreadthDaily(history, 'sp500', {
    dates: ['2026-01-02'],
    pctAboveBoth: [null],
    pctBelowBoth: [null],
    pctUp: [null],
    pctOutperform20: [null],
    pctOutperform200: [null],
    pctAt52wHigh: [null],
    pctAt52wLow: [null],
  });
  assert.deepEqual(history.sp500['2026-01-02'], fullSeries({
    pctAboveBoth: 55,
    pctBelowBoth: 25,
    pctUp: 60,
  }));
});

test('mergeBreadthDaily still replaces valid values with newer valid values', () => {
  const history = {
    sp500: {
      '2026-01-02': fullSeries({ pctAboveBoth: 55, pctBelowBoth: 25, pctUp: 60 }),
    },
  };
  _test.mergeBreadthDaily(history, 'sp500', {
    dates: ['2026-01-02'],
    pctAboveBoth: [57],
    pctBelowBoth: [23],
    pctUp: [62],
    pctOutperform20: [41],
    pctOutperform200: [46],
    pctAt52wHigh: [11],
    pctAt52wLow: [6],
  });
  assert.deepEqual(history.sp500['2026-01-02'], {
    pctAboveBoth: 57,
    pctBelowBoth: 23,
    pctUp: 62,
    pctOutperform20: 41,
    pctOutperform200: 46,
    pctAt52wHigh: 11,
    pctAt52wLow: 6,
  });
});

test('breadthSeriesNeedsRepair detects new series and internal gaps in every metric', () => {
  assert.equal(_test.breadthSeriesNeedsRepair({ dates: [] }), true);
  assert.equal(_test.breadthSeriesNeedsRepair({
    dates: ['a', 'b', 'c'],
    pctAboveBoth: [null, 50, 51],
    pctBelowBoth: [null, 20, 19],
    pctUp: [null, 55, 56],
    pctOutperform20: [null, 40, 41],
    pctOutperform200: [null, 45, 46],
    pctAt52wHigh: [null, 10, 11],
    pctAt52wLow: [null, 5, 6],
  }, 2), false);
  assert.equal(_test.breadthSeriesNeedsRepair({
    dates: ['a', 'b', 'c'],
    pctAboveBoth: [null, 50, 51],
    pctBelowBoth: [null, 20, 19],
    pctUp: [50, null, 56],
    pctOutperform20: [null, 40, 41],
    pctOutperform200: [null, 45, 46],
    pctAt52wHigh: [null, 10, 11],
    pctAt52wLow: [null, 5, 6],
  }, 2), true);
  assert.equal(_test.breadthSeriesNeedsRepair({
    dates: ['a', 'b', 'c'],
    pctAboveBoth: [null, 50, 51],
    pctBelowBoth: [null, 20, 19],
    pctUp: [null, 55, 56],
    pctOutperform20: [null, 40, 41],
    pctOutperform200: [null, 45, 46],
    pctAt52wHigh: [null, 10, 11],
    pctAt52wLow: [null, 5, 6],
  }, 3), true);
  assert.equal(_test.breadthSeriesNeedsRepair({
    dates: ['a', 'b', 'c'],
    pctAboveBoth: [null, 50, 51],
    pctBelowBoth: [null, 20, 19],
    pctUp: [null, 55, 56],
    // Legacy series predating the outperform/52w-high-low metrics: absent
    // fields must also be flagged as needing repair, not treated as valid.
  }, 2), true);
});

test('rollingReturn computes trailing N-valid-observation % return and skips nulls without resetting the window', () => {
  const values = [100, null, 110, 121, 133.1];
  // window=2 needs 3 valid observations; nulls are skipped, not counted.
  const result = _test.rollingReturn(values, 2);
  assert.deepEqual(result.slice(0, 3), [null, null, null]);
  assert.ok(Math.abs(result[3] - 0.21) < 1e-9);
  assert.ok(Math.abs(result[4] - 0.21) < 1e-9);
});

test('rollingExtreme tracks trailing max/min over N valid observations', () => {
  const values = [5, 3, 8, 2, 9, 1];
  assert.deepEqual(_test.rollingExtreme(values, 3, 'max'), [null, null, 8, 8, 9, 9]);
  assert.deepEqual(_test.rollingExtreme(values, 3, 'min'), [null, null, 3, 2, 2, 1]);
});

test('computeAggregates: insufficient history keeps outperform/52w metrics null', () => {
  // 6 sessions; far short of the 20/200/252-observation windows.
  const dates = ['d1', 'd2', 'd3', 'd4', 'd5', 'd6'];
  const closesByTicker = {
    A: [100, 102, 104, 106, 108, 110],
    B: [100, 100, 100, 100, 100, 100],
  };
  const indexCloses = [100, 100.5, 101, 101.5, 102, 102.5];
  const result = _test.computeAggregates(dates, closesByTicker, indexCloses);
  assert.deepEqual(result.pctOutperform20, [null, null, null, null, null, null]);
  assert.deepEqual(result.pctOutperform200, [null, null, null, null, null, null]);
  assert.deepEqual(result.pctAt52wHigh, [null, null, null, null, null, null]);
  assert.deepEqual(result.pctAt52wLow, [null, null, null, null, null, null]);
});

test('computeAggregates derives outperformance and 52-week high/low once history covers the windows', () => {
  const n = 260;
  const dates = Array.from({ length: n }, (_, i) => `d${i}`);
  // A trends up faster than the index (always outperforms, ends at its own
  // 52-week high). B trends down (always underperforms, ends at its own
  // 52-week low). Both give the index-level rolling-return module a
  // consistently-trending series to compare against.
  const closesByTicker = {
    A: Array.from({ length: n }, (_, i) => 100 + i),
    B: Array.from({ length: n }, (_, i) => 200 - i * 0.3),
  };
  const indexCloses = Array.from({ length: n }, (_, i) => 100 + i * 0.5);
  const result = _test.computeAggregates(dates, closesByTicker, indexCloses);
  const last = n - 1;
  assert.equal(result.pctOutperform20[last], 50);
  assert.equal(result.pctOutperform200[last], 50);
  assert.equal(result.pctAt52wHigh[last], 50);
  assert.equal(result.pctAt52wLow[last], 50);
});

test('incompleteBreadthKeys includes absent configured indices', () => {
  const keys = _test.incompleteBreadthKeys({});
  assert.ok(keys.includes('sp500'));
  assert.ok(keys.includes('topix'));
});

test('parseChinextFallbackHtml extracts and deduplicates explicit Shenzhen codes', () => {
  assert.deepEqual(
    _test.parseChinextFallbackHtml('SHE:300750 x SHE:300059 x SHE:300750'),
    ['300750.SZ', '300059.SZ'],
  );
});
