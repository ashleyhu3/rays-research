'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { _test } = require('./chinaNationalTeamFlow');

test('assemble drops the first observation and computes flow from share_change × previous close', () => {
  const data = _test.assemble({
    shares: {
      '510300.SH': { '2026-01-02': 1000, '2026-01-05': 1050 }, // 万份
    },
    prices: {
      '510300.SH': { '2026-01-02': 4.0 }, // previous close used for the 01-05 change
    },
  });

  assert.deepEqual(data.dates, ['2026-01-05']);
  // share_change = 50万份 = 500,000份; × ¥4.0 = ¥2,000,000 = 0.02亿元
  assert.equal(data.groups['沪深300'][0], 0.02);
});

test('assemble omits a group-date value entirely when no ticker in it has data, rather than zero-filling', () => {
  const data = _test.assemble({
    shares: { '588050.SH': { '2026-01-02': 100000, '2026-01-05': 110000 } },
    prices: { '588050.SH': { '2026-01-02': 2.0 } },
  });

  assert.deepEqual(data.dates, ['2026-01-05']);
  assert.equal(data.groups['科创'][0], 2); // 10,000万份 × 10000 × 2.0 = 200,000,000 = 2亿元
  assert.equal(data.groups['创业板'][0], null); // no 创业板 ticker reported that day
});

test('assemble sums only the tickers with a computable value that day within a group', () => {
  const data = _test.assemble({
    shares: {
      '510300.SH': { '2026-01-02': 1000, '2026-01-05': 1010 },
      '159919.SZ': { '2026-01-02': 500, '2026-01-05': 520 },
    },
    prices: {
      '510300.SH': { '2026-01-02': 4.0 },
      '159919.SZ': { '2026-01-02': 3.0 },
    },
  });

  // 510300: 10万份×10000×4.0 = 400,000 = 0.004亿元
  // 159919: 20万份×10000×3.0 = 600,000 = 0.006亿元
  assert.equal(data.groups['沪深300'][0], 0.01);
});

test('assemble skips a day when the previous close is missing, without inventing a zero', () => {
  const data = _test.assemble({
    shares: { '510300.SH': { '2026-01-02': 1000, '2026-01-05': 1010, '2026-01-06': 1020 } },
    prices: { '510300.SH': { '2026-01-05': 4.0 } }, // 01-02's close is missing
  });

  // 01-05's change needs 01-02's close (missing) → dropped.
  // 01-06's change needs 01-05's close (present) → kept.
  assert.deepEqual(data.dates, ['2026-01-06']);
});
