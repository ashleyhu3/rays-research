'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { mergeMacroData } = require('./macro');

test('a partial macro refresh retains previously stored US yield history', () => {
  const previousYield = {
    id: 'us10yYield',
    data: [{ date: '2026-07-20', value: 4.629 }],
  };
  const previous = {
    series: {
      us10yYield: previousYield,
      us2yYield: { id: 'us2yYield', data: [{ date: '2026-07-20', value: 4.257 }] },
    },
  };
  const fresh = {
    fetchedAt: '2026-07-22T00:00:00.000Z',
    series: { usCpiYoy: { id: 'usCpiYoy', data: [{ date: '2026-06-01', value: 2.7 }] } },
    errors: { us10yYield: 'fetch failed', us2yYield: 'fetch failed' },
  };

  const merged = mergeMacroData(fresh, previous);
  assert.equal(merged.series.us10yYield, previousYield);
  assert.deepEqual(merged.series.us2yYield, previous.series.us2yYield);
  assert.deepEqual(merged.series.usCpiYoy, fresh.series.usCpiYoy);
});
