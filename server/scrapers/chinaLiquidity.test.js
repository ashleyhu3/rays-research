'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { _test } = require('./chinaLiquidity');

test('parses East Money amount (f57) as A-share turnover', () => {
  assert.deepEqual(_test.parseTurnoverKlines([
    '2026-07-17,1,2,3,0.5,123,1450000000000,1.2,0.2,0.1,2.3',
  ]), { '2026-07-17': 1450000000000 });
});

test('derives monthly M2 year-over-year growth from levels', () => {
  assert.deepEqual(_test.deriveM2Yoy([
    { date: '2024-05-31', value: 300 }, { date: '2025-05-31', value: 324 },
    { date: '2026-05-31', value: 351.54 },
  ]), { '2025-05-31': 8, '2026-05-31': 8.5 });
});
