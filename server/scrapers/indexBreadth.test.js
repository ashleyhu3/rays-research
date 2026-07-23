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
