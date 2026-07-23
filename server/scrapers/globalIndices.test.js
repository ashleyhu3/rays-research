'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { _test } = require('./globalIndices');

test('parseSinaKlines extracts and date-filters the JSONP index history', () => {
  const text = '/* redirect guard */ var _data=([{"day":"2026-07-21","close":"3500.5","volume":"100"},'
    + '{"day":"2026-07-22","close":"3520.0","volume":"110"}]);';
  assert.deepEqual(
    _test.parseSinaKlines(text, new Date('2026-07-22'), new Date('2026-07-23')),
    [{
      date: '2026-07-22',
      close: 3520,
      adjClose: 3520,
      turnover: 387200,
    }],
  );
});
