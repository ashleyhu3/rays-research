'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { _test } = require('./taiwanLeverage');

test('assemble calculates charted leverage as margin plus Yuanta 2× ETFs over combined market cap', () => {
  const data = _test.assemble({
    names: { '00631L': 'Yuanta Taiwan 50 2×' },
    '2026-01-02': {
      marginListed: 800,
      marginOtc: 200,
      marketSizeListed: 9000,
      marketSizeOtc: 1000,
      funds: { '00631L': 100 },
    },
    '2026-01-05': {
      marginListed: 850,
      marginOtc: 210,
      funds: { '00631L': 140 },
    },
  });

  assert.deepEqual(data.marketSize, [10000, 10000]);
  assert.deepEqual(data.total, [1100, 1200]);
  assert.deepEqual(data.leverageRatio, [11, 12]);
  assert.equal(data.marketSizeDate, '2026-01-02');
  assert.equal(data.latest.leverageRatio, 12);
});

test('assemble leaves the ratio null for a missing numerator or zero denominator', () => {
  const data = _test.assemble({
    '2026-01-02': {
      marginListed: 800,
      marginOtc: 200,
      marketSizeListed: 9000,
      marketSizeOtc: 1000,
    },
    '2026-01-05': {
      marginListed: 800,
      marginOtc: 200,
      marketSizeListed: 0,
      marketSizeOtc: 0,
      funds: { '00631L': 100 },
    },
  });

  assert.deepEqual(data.leverageRatio, [null, null]);
});
