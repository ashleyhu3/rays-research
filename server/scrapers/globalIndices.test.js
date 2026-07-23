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

test('sanitizeTurnoverPayload removes invalid and incomplete current-session observations', () => {
  const payload = {
    dates: ['2026-07-20', '2026-07-21', '2026-07-22', '2026-07-23'],
    series: [{
      ticker: 'hsi',
      turnover: [100, 0, -5, 1],
      closes: [1, 2, 3, 4],
    }],
  };
  assert.deepEqual(
    _test.sanitizeTurnoverPayload(payload, '2026-07-23'),
    {
      dates: payload.dates,
      series: [{
        ticker: 'hsi',
        turnover: [100, null, null, null],
        closes: [1, 2, 3, 4],
      }],
    },
  );
});

test('sanitizeTurnoverPayload rejects a stale tiny placeholder on a prior date', () => {
  const normal = [100, 105, 95, 110, 90, 100];
  const payload = {
    dates: ['2026-07-16', '2026-07-17', '2026-07-18', '2026-07-19', '2026-07-20', '2026-07-21', '2026-07-22'],
    series: [{ ticker: 'csi300', turnover: [...normal, 2] }],
  };
  assert.equal(
    _test.sanitizeTurnoverPayload(payload, '2026-07-24').series[0].turnover.at(-1),
    null,
  );
});
