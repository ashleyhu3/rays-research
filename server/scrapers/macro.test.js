const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateSpread, mergeMacroData } = require('./macro');

test('2Y–10Y spread is calculated as 10Y minus 2Y on matching dates', () => {
  const tenYear = {
    frequency: 'Daily',
    sourceUrl: 'https://tradingeconomics.com/united-states/government-bond-yield',
    data: [
      { date: '2026-07-20', value: 4.42 },
      { date: '2026-07-21', value: 4.5 },
    ],
  };
  const twoYear = {
    frequency: 'Daily',
    data: [
      { date: '2026-07-20', value: 3.91 },
      { date: '2026-07-22', value: 3.95 },
    ],
  };

  const spread = calculateSpread(tenYear, twoYear);

  assert.equal(spread.data.length, 1);
  assert.equal(spread.data[0].date, '2026-07-20');
  assert.ok(Math.abs(spread.data[0].value - 0.51) < 1e-12);
  assert.equal(spread.unit, 'percentage points');
  assert.equal(spread.sourceUrl, tenYear.sourceUrl);
});

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
