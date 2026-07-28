'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const storageBlobs = require('../storageBlobs');
const { createPersistedSeries } = require('./persistedSeries');
const {
  TICKERS: hkChinaTickers,
  adjustForSplits,
  needsHistoryBackfill,
} = require('./hkChinaPerformance');

test('China Rotation uses stable historical feeds under the requested index identifiers', () => {
  const byTicker = new Map(hkChinaTickers.map(meta => [meta.ticker, meta]));
  assert.equal(byTicker.get('800000')?.yahooTicker, '^HSI');
  assert.equal(byTicker.get('800700')?.yahooTicker, '3032.HK');
  assert.equal(byTicker.get('399006.SZ')?.yahooTicker, '159915.SZ');
  assert.equal(byTicker.get('000688.SS')?.yahooTicker, '588000.SS');
  assert.equal(byTicker.has('516680.SS'), false, 'delisted ETF must not produce an empty graph');
});

test('China Rotation auto-backfills newly added or truncated ticker histories', () => {
  assert.equal(needsHistoryBackfill({
    series: [{ closes: Array(199).fill(1) }, { closes: Array(500).fill(1) }],
  }), true);
  assert.equal(needsHistoryBackfill({
    series: [{ closes: Array(200).fill(1) }, { closes: Array(500).fill(1) }],
  }), false);
});

test('China Rotation repairs persistent unit splits but not reverting bad ticks', () => {
  const split = adjustForSplits([
    { close: 1.00 }, { close: 1.02 }, { close: 0.51 }, { close: 0.52 },
  ]);
  assert.deepEqual(split.map(point => Number(point.close.toFixed(4))), [0.5, 0.51, 0.51, 0.52]);
  assert.equal(split.splitDetected, true);

  const glitch = adjustForSplits([
    { close: 1.00 }, { close: 2.00 }, { close: 1.02 }, { close: 1.03 },
  ]);
  assert.ok(glitch.every((point, index) => (
    index === 0 || point.close / glitch[index - 1].close < 1.25
  )));
  assert.equal(glitch.splitDetected, false);
});

test('China Rotation includes the configured sector ETF updates', () => {
  const byTicker = new Map(hkChinaTickers.map(meta => [meta.ticker, meta]));
  assert.equal(byTicker.has('159336.SZ'), false);
  assert.equal(byTicker.get('159852.SZ')?.name, '软件');
  assert.equal(byTicker.get('512200.SS')?.name, '房地产');
  assert.equal(byTicker.get('516110.SS')?.name, '美容护理');
  assert.equal(byTicker.has('516680.SS'), false);
});

test('shared storage registry contains each Rotation history exactly once', () => {
  const names = storageBlobs.map(blob => blob.name);
  assert.equal(new Set(names).size, names.length);
  for (const name of [
    'usPerformanceHistory',
    'hkChinaPerformanceHistory',
    'hkPerformanceHistory',
    'chinaEtfPremiumHistory',
  ]) assert.equal(names.filter(value => value === name).length, 1);
});

test('persisted series merge dates and return only the requested range', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rotation-history-'));
  const file = path.join(directory, 'history.json');
  const store = createPersistedSeries({
    blob: `rotationPersistenceTest-${Date.now()}`,
    file,
    tickers: [{ ticker: 'TEST', label: 'TEST', name: 'Test Series' }],
    fields: ['closes', 'adjCloses'],
  });

  store.merge({
    dates: ['2026-07-17', '2026-07-20', '2026-07-21'],
    series: [{
      ticker: 'TEST',
      closes: [100, 101, 102],
      adjCloses: [99, 100, 101],
    }],
  });
  store.merge({
    dates: ['2026-07-21'],
    series: [{ ticker: 'TEST', closes: [103] }],
  });

  const result = store.assemble('2026-07-20', '2026-07-21');
  assert.deepEqual(result.dates, ['2026-07-20', '2026-07-21']);
  assert.deepEqual(result.series[0].closes, [101, 103]);
  assert.deepEqual(result.series[0].adjCloses, [100, 101]);
  fs.rmSync(directory, { recursive: true, force: true });
});
