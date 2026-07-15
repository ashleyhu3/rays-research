'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { _test } = require('./twseCompanyMargin');

// Overview bars are timestamped at the Taipei session (05:30 UTC); these map to
// 2026-01-02 and 2026-01-05 respectively.
const TS_JAN2 = Date.UTC(2026, 0, 2, 5, 30);
const TS_JAN5 = Date.UTC(2026, 0, 5, 5, 30);

function sampleMargin() {
  return {
    info: { status: 'success', data: { name: '台光電子', shortName: '台光電', category: '電子零組件業' } },
    chart: {
      purchase: {
        categories: ['2026/01/02', '2026/01/05'],
        series: [
          { name: '融資餘額張數', data: [1000, 1200] },
          { name: '融資張數增減', data: [10, 200] },
        ],
      },
      shortSale: {
        categories: ['2026/01/02', '2026/01/05'],
        series: [
          { name: '融券餘額張數', data: [50, 40] },
          { name: '融券張數增減', data: [-5, -10] },
        ],
      },
    },
  };
}

test('buildCompanyMargin aligns margin balance to daily volume as days-of-volume', () => {
  const overview = { chart: { data: [
    [TS_JAN2, 100, 110, 95, 105, 1_000_000],  // 1,000 lots × 1,000 shares / 1,000,000 = 1.0×
    [TS_JAN5, 105, 120, 100, 118, 600_000],   // 1,200 × 1,000 / 600,000 = 2.0×
  ] } };

  const out = _test.buildCompanyMargin('2383', sampleMargin(), overview);

  assert.equal(out.code, '2383');
  assert.equal(out.shortName, '台光電');
  assert.deepEqual(out.purchase.dates, ['2026-01-02', '2026-01-05']);
  assert.deepEqual(out.purchase.balanceLots, [1000, 1200]);
  assert.deepEqual(out.purchase.changeLots, [10, 200]);
  assert.deepEqual(out.purchase.dayVolume, [1_000_000, 600_000]);
  assert.deepEqual(out.purchase.daysOfVolume, [1, 2]);
});

test('buildCompanyMargin gaps the ratio (null) on a day with no volume', () => {
  const overview = { chart: { data: [
    [TS_JAN2, 100, 110, 95, 105, 1_000_000],
    // No bar for 2026-01-05 → volume missing → ratio null, but balance still kept.
  ] } };

  const out = _test.buildCompanyMargin('2383', sampleMargin(), overview);

  assert.deepEqual(out.purchase.dayVolume, [1_000_000, null]);
  assert.deepEqual(out.purchase.daysOfVolume, [1, null]);
  assert.deepEqual(out.purchase.balanceLots, [1000, 1200]);
});

test('buildCompanyMargin computes the short side independently', () => {
  const overview = { chart: { data: [
    [TS_JAN2, 100, 110, 95, 105, 500_000],   // 50 × 1000 / 500000 = 0.1×
    [TS_JAN5, 105, 120, 100, 118, 400_000],  // 40 × 1000 / 400000 = 0.1×
  ] } };

  const out = _test.buildCompanyMargin('2383', sampleMargin(), overview);

  assert.deepEqual(out.shortSale.balanceLots, [50, 40]);
  assert.deepEqual(out.shortSale.changeLots, [-5, -10]);
  assert.deepEqual(out.shortSale.daysOfVolume, [0.1, 0.1]);
});

test('buildCompanyMargin propagates the exchange error message', () => {
  const errorResponse = { info: { status: 'error', message: '查無相關資料！' } };
  assert.throws(
    () => _test.buildCompanyMargin('9999', errorResponse, { chart: { data: [] } }),
    /查無相關資料/,
  );
});
