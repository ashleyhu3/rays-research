'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { _test, MA_WINDOW, DEVIATION_SERIES } = require('./maDeviation');

const iso = i => new Date(Date.UTC(2020, 0, 1 + i)).toISOString().slice(0, 10);

/** `{ [date]: close }` for a close array, skipping nulls the way a gap appears. */
function byDate(closes, offset = 0) {
  const out = {};
  closes.forEach((close, i) => { if (close != null) out[iso(i + offset)] = close; });
  return out;
}

/** A flat run long enough for the 200-day average to be defined, then a tail. */
function flatThen(tail, level = 100) {
  return [...Array.from({ length: MA_WINDOW }, () => level), ...tail];
}

test('deviation is zero on a flat series and signed once price moves off the average', () => {
  const { deviation } = _test.computeDeviationSeries(flatThen([110, 90]));

  // The warm-up rows carry no average, so no deviation.
  assert.equal(deviation[MA_WINDOW - 2], null);
  assert.ok(Math.abs(deviation[MA_WINDOW - 1] - 0) < 1e-9, 'flat price sits on its own average');

  // 110 against an average dragged up only slightly by one 110 print.
  assert.ok(deviation.at(-2) > 0 && deviation.at(-2) < 10);
  assert.ok(deviation.at(-1) < 0);
});

test('deviation is expressed as a percentage of the 200-day average', () => {
  // 200 sessions at 100 then one at 120: the average becomes (199×100 + 120)/200.
  const { ma, deviation } = _test.computeDeviationSeries(flatThen([120]));
  const expectedMa = (199 * 100 + 120) / MA_WINDOW;
  assert.ok(Math.abs(ma.at(-1) - expectedMa) < 1e-9);
  assert.ok(Math.abs(deviation.at(-1) - ((120 / expectedMa - 1) * 100)) < 1e-9);
});

test('a session a market did not trade carries a null and does not reset the window', () => {
  const closes = flatThen([null, 100]);
  const { ma, deviation } = _test.computeDeviationSeries(closes);

  assert.equal(deviation.at(-2), null, 'no close means no deviation on that date');
  assert.equal(ma.at(-2), null);
  // The window was already full before the gap, so the next real close still
  // has an average rather than restarting a 200-session warm-up.
  assert.ok(Math.abs(deviation.at(-1) - 0) < 1e-9);
});

test('series are assembled onto one date axis, each keeping its own asOf', () => {
  const first = DEVIATION_SERIES[0].key;
  const second = DEVIATION_SERIES[1].key;

  const payload = _test.buildDeviationPayload({
    // One market trades an extra session past the other.
    [first]: byDate(flatThen([100, 105])),
    [second]: byDate(flatThen([100])),
  });

  const firstSeries = payload.series.find(s => s.key === first);
  const secondSeries = payload.series.find(s => s.key === second);

  assert.equal(payload.dates.at(-1), iso(MA_WINDOW + 1));
  assert.equal(firstSeries.asOf, iso(MA_WINDOW + 1));
  assert.equal(secondSeries.asOf, iso(MA_WINDOW), 'a closed market reports its own last session');
  assert.ok(firstSeries.latest > 0);
  assert.equal(secondSeries.latest, 0);
  assert.equal(secondSeries.deviation.at(-1), null, 'no value on a date it did not trade');
});

test('rows before any series clears its 200-day warm-up are trimmed', () => {
  const payload = _test.buildDeviationPayload({
    [DEVIATION_SERIES[0].key]: byDate(flatThen([105])),
  });

  // The first MA_WINDOW-1 rows have no deviation for any series and are dropped.
  assert.equal(payload.dates.length, 2);
  assert.equal(payload.dates[0], iso(MA_WINDOW - 1));
  assert.equal(payload.series[0].deviation.length, 2);
});

test('every configured series is returned, present in the source data or not', () => {
  const payload = _test.buildDeviationPayload({
    [DEVIATION_SERIES[0].key]: byDate(flatThen([100])),
  });

  assert.deepEqual(payload.series.map(s => s.key), DEVIATION_SERIES.map(s => s.key));
  const missing = payload.series.at(-1);
  assert.equal(missing.asOf, null);
  assert.equal(missing.latest, null);
  assert.equal(missing.ma200, null);
});

test('gold is covered alongside the Breadth indices', () => {
  assert.ok(DEVIATION_SERIES.some(s => s.key === 'gold'), 'gold is one of the series');
  assert.equal(DEVIATION_SERIES.length, 11, 'ten Breadth indices plus gold');
});
