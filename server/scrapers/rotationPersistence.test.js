'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const storageBlobs = require('../storageBlobs');
const { createPersistedSeries } = require('./persistedSeries');
const { TICKERS: hkChinaTickers } = require('./hkChinaPerformance');

test('China Rotation fetches HSI and HSTECH under the requested index identifiers', () => {
  const byTicker = new Map(hkChinaTickers.map(meta => [meta.ticker, meta]));
  assert.equal(byTicker.get('800000')?.yahooTicker, '^HSI');
  assert.equal(byTicker.get('800700')?.yahooTicker, '^HSTECH');
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
    series: [{ ticker: 'TEST', closes: [103], adjCloses: [102] }],
  });

  const result = store.assemble('2026-07-20', '2026-07-21');
  assert.deepEqual(result.dates, ['2026-07-20', '2026-07-21']);
  assert.deepEqual(result.series[0].closes, [101, 103]);
  assert.deepEqual(result.series[0].adjCloses, [100, 102]);
  fs.rmSync(directory, { recursive: true, force: true });
});
