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

test('mergeBreadthDaily does not replace backfilled values with warm-up nulls', () => {
  const history = {
    sp500: {
      '2026-01-02': { pctAboveBoth: 55, pctBelowBoth: 25, pctUp: 60 },
    },
  };
  _test.mergeBreadthDaily(history, 'sp500', {
    dates: ['2026-01-02'],
    pctAboveBoth: [null],
    pctBelowBoth: [null],
    pctUp: [null],
  });
  assert.deepEqual(history.sp500['2026-01-02'], {
    pctAboveBoth: 55,
    pctBelowBoth: 25,
    pctUp: 60,
  });
});

test('mergeBreadthDaily still replaces valid values with newer valid values', () => {
  const history = {
    sp500: {
      '2026-01-02': { pctAboveBoth: 55, pctBelowBoth: 25, pctUp: 60 },
    },
  };
  _test.mergeBreadthDaily(history, 'sp500', {
    dates: ['2026-01-02'],
    pctAboveBoth: [57],
    pctBelowBoth: [23],
    pctUp: [62],
  });
  assert.deepEqual(history.sp500['2026-01-02'], {
    pctAboveBoth: 57,
    pctBelowBoth: 23,
    pctUp: 62,
  });
});

test('breadthSeriesNeedsRepair detects new series and internal gaps in every metric', () => {
  assert.equal(_test.breadthSeriesNeedsRepair({ dates: [] }), true);
  assert.equal(_test.breadthSeriesNeedsRepair({
    dates: ['a', 'b', 'c'],
    pctAboveBoth: [null, 50, 51],
    pctBelowBoth: [null, 20, 19],
    pctUp: [null, 55, 56],
  }, 2), false);
  assert.equal(_test.breadthSeriesNeedsRepair({
    dates: ['a', 'b', 'c'],
    pctAboveBoth: [null, 50, 51],
    pctBelowBoth: [null, 20, 19],
    pctUp: [50, null, 56],
  }, 2), true);
  assert.equal(_test.breadthSeriesNeedsRepair({
    dates: ['a', 'b', 'c'],
    pctAboveBoth: [null, 50, 51],
    pctBelowBoth: [null, 20, 19],
    pctUp: [null, 55, 56],
  }, 3), true);
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
