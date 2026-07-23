'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { _test } = require('./spxPutCallRatio');

test('parseBarchartHistory reads the two ratio series from the lower chart feed', () => {
  assert.deepEqual(_test.parseBarchartHistory({
    data: [
      { date: '2026-05-13', putCallVolumeRatio: '0.97', putCallOpenInterestRatio: '1.42' },
      { date: 'bad', putCallVolumeRatio: '1.00', putCallOpenInterestRatio: '1.50' },
    ],
  }), [
    { date: '2026-05-13', volumeRatio: 0.97, oiRatio: 1.42 },
  ]);
});

test('mergeHistoricalRows backfills ratios and keeps existing raw totals', () => {
  const history = {
    daily: {
      '2026-05-13': { putVolume: 100, callVolume: 50 },
    },
  };
  _test.mergeHistoricalRows(history, [
    { date: '2026-05-13', volumeRatio: 0.97, oiRatio: 1.42 },
    { date: '2026-05-14', volumeRatio: 0.96, oiRatio: 1.41 },
  ]);
  assert.deepEqual(history.daily, {
    '2026-05-13': {
      putVolume: 100,
      callVolume: 50,
      volumeRatio: 0.97,
      oiRatio: 1.42,
    },
    '2026-05-14': {
      volumeRatio: 0.96,
      oiRatio: 1.41,
    },
  });
});

test('sessionHeaders carries the anonymous Barchart session into the chart request', () => {
  const response = {
    headers: {
      'set-cookie': [
        'laravel_session=session-value; Path=/; Secure',
        'XSRF-TOKEN=token-value; Path=/; Secure',
      ],
    },
  };
  const headers = _test.sessionHeaders(
    response,
    '<meta name="csrf-token" content="csrf-value">',
  );
  assert.equal(headers.Cookie, 'laravel_session=session-value; XSRF-TOKEN=token-value');
  assert.equal(headers['X-CSRF-TOKEN'], 'csrf-value');
  assert.equal(headers['X-XSRF-TOKEN'], 'token-value');
});
