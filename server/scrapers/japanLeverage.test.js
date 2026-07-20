'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { _test } = require('./japanLeverage');

test('assemble scales the workbook\'s million-yen values into trillion-yen purchases/sales and a value-based ratio', () => {
  const data = _test.assemble({
    '2026-06-26': { sellShares: 498572, sellValue: 1053736, buyShares: 3940572, buyValue: 7016733 },
  });

  assert.equal(data.purchases[0], 7.02);
  assert.equal(data.sales[0], 1.05);
  assert.equal(data.ratio[0], round2(7016733 / 1053736));
  assert.equal(data.latest.date, '2026-06-26');
  assert.equal(data.latest.purchases, 7.02);
});

test('assemble skips a week whose row is missing a value', () => {
  const data = _test.assemble({
    '2026-06-19': { sellShares: 437974, sellValue: 1016129, buyShares: 3915786, buyValue: 6475640 },
    '2026-06-26': { sellShares: 498572, buyShares: 3940572 }, // no sellValue/buyValue
  });

  assert.equal(data.purchases[1], null);
  assert.equal(data.sales[1], null);
  assert.equal(data.ratio[1], null);
  assert.equal(data.latest.purchases, null);
});

test('assemble ignores non-date keys (e.g. a stray blob field)', () => {
  const data = _test.assemble({
    updatedAt: '2026-07-01T00:00:00.000Z',
    '2026-06-26': { sellShares: 498572, sellValue: 1053736, buyShares: 3940572, buyValue: 7016733 },
  });

  assert.deepEqual(data.dates, ['2026-06-26']);
});

function round2(v) { return Math.round(v * 100) / 100; }
