'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { _test } = require('./maCross');

// A flat run puts SMA5 and SMA20 on top of each other; the tail then moves the
// short average through the long one on the FINAL session, which is the only
// place detectCross reports a crossing.
const GOLDEN_TAIL = [98, 99, 100, 101, 106];
const DEATH_TAIL = [102, 101, 100, 99, 94];
const FLAT_TAIL = [100, 100, 100, 100, 100];

function flatThen(tail, level = 100, flatDays = 25) {
  return [...Array.from({ length: flatDays }, () => level), ...tail];
}

function crossOf(closes) {
  const dates = closes.map((_, i) => `d${i}`);
  return _test.detectCross(
    _test.rollingAverage(closes, 5),
    _test.rollingAverage(closes, 20),
    dates,
  );
}

// Build a { date: { ticker: { close } } } history from per-ticker close arrays,
// mirroring the shape of the breadth raw-price cache. A null close is written
// as a present-but-empty quote, the way a gapped session appears in the blob.
function makeHistory(closesByTicker) {
  const dayCount = Math.max(...Object.values(closesByTicker).map(c => c.length));
  const history = {};
  for (let i = 0; i < dayCount; i += 1) {
    const date = new Date(Date.UTC(2026, 0, 5 + i)).toISOString().slice(0, 10);
    history[date] = {};
    for (const [ticker, closes] of Object.entries(closesByTicker)) {
      if (i < closes.length) history[date][ticker] = { close: closes[i], volume: 1000 };
    }
  }
  return history;
}

test('detectCross reports a golden cross when the 5-day rises through the 20-day', () => {
  const cross = crossOf(flatThen(GOLDEN_TAIL));
  assert.ok(cross, 'expected a crossing to be detected');
  assert.equal(cross.direction, 'golden');
});

test('detectCross reports a death cross when the 5-day falls through the 20-day', () => {
  const cross = crossOf(flatThen(DEATH_TAIL));
  assert.ok(cross, 'expected a crossing to be detected');
  assert.equal(cross.direction, 'death');
});

test('detectCross returns null while the two averages stay on the same side', () => {
  assert.equal(crossOf(flatThen(FLAT_TAIL)), null);
});

test('detectCross compares the last two defined observations, skipping gaps', () => {
  // The same golden crossing, with a session the ticker did not trade. The
  // rolling window ignores the hole, so the crossing must still be reported.
  const cross = crossOf(flatThen([98, 99, 100, null, 101, 106]));
  assert.ok(cross, 'a one-session gap must not suppress the crossing');
  assert.equal(cross.direction, 'golden');
});

test('computeMaCross lists only names that crossed on the latest session', () => {
  const history = makeHistory({
    UP: flatThen(GOLDEN_TAIL),
    DOWN: flatThen(DEATH_TAIL),
    FLAT: flatThen(FLAT_TAIL),
  });

  const result = _test.computeMaCross(history);
  assert.equal(result.asOf, Object.keys(history).sort().at(-1));
  assert.equal(result.tickerCount, 3);
  // FLAT never crosses, so it must not appear.
  assert.deepEqual(result.crosses.map(c => c.ticker), ['UP', 'DOWN']);
  assert.deepEqual(result.crosses.map(c => c.direction), ['golden', 'death']);
});

test('computeMaCross carries the close and both averages for a crossing name', () => {
  const result = _test.computeMaCross(makeHistory({ UP: flatThen(GOLDEN_TAIL) }));
  const [cross] = result.crosses;
  assert.equal(cross.close, 106);
  // Golden: the short average must sit above the long one on the reported day.
  assert.ok(cross.sma5 > cross.sma20, `${cross.sma5} should exceed ${cross.sma20}`);
  assert.equal(cross.dates.at(-1), result.asOf);
  assert.equal(cross.sma5Series.length, cross.dates.length);
  assert.equal(cross.sma20Series.length, cross.dates.length);
  assert.equal(cross.closes.length, cross.dates.length);
});

test('computeMaCross ignores a cross that landed before the reported session', () => {
  // The ticker is still in the latest row but did not trade that day, so its
  // crossing belongs to an earlier session and must not be reported as today's.
  const history = makeHistory({ STALE: [...flatThen(GOLDEN_TAIL), null] });
  const result = _test.computeMaCross(history);
  assert.equal(result.tickerCount, 1, 'ticker is present in the latest row');
  assert.deepEqual(result.crosses, []);
});

test('computeMaCross returns an empty result for an empty cache', () => {
  assert.deepEqual(_test.computeMaCross({}), { asOf: null, tickerCount: 0, crosses: [] });
});

test('computeMaCross sorts golden crosses before death crosses, then alphabetically', () => {
  const result = _test.computeMaCross(makeHistory({
    ZUP: flatThen(GOLDEN_TAIL),
    ADOWN: flatThen(DEATH_TAIL),
    AUP: flatThen(GOLDEN_TAIL),
  }));
  assert.deepEqual(result.crosses.map(c => c.ticker), ['AUP', 'ZUP', 'ADOWN']);
});
