const test = require('node:test');
const assert = require('node:assert/strict');
const { mergeMacroData } = require('./macro');

test('partial macro refresh retains previously persisted series', () => {
  const previous = {
    fetchedAt: '2026-07-20T00:00:00.000Z',
    series: {
      usCpiYoy: { data: [{ date: '2026-06-01', value: 3.5 }] },
      usPceYoy: { data: [{ date: '2026-05-01', value: 3.4 }] },
    },
    errors: {},
  };
  const fresh = {
    fetchedAt: '2026-07-21T00:00:00.000Z',
    series: {
      usPceYoy: { data: [{ date: '2026-06-01', value: 3.6 }] },
    },
    errors: { usCpiYoy: 'This operation was aborted' },
  };

  const merged = mergeMacroData(fresh, previous);

  assert.deepEqual(merged.series.usCpiYoy, previous.series.usCpiYoy);
  assert.deepEqual(merged.series.usPceYoy, fresh.series.usPceYoy);
  assert.equal(merged.fetchedAt, fresh.fetchedAt);
  assert.equal(merged.errors.usCpiYoy, 'This operation was aborted');
});

test('first macro refresh is returned unchanged when no snapshot exists', () => {
  const fresh = { fetchedAt: 'now', series: { usCpiYoy: { data: [] } }, errors: {} };
  assert.equal(mergeMacroData(fresh, null), fresh);
});
