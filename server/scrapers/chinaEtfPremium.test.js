'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { finiteNumber, mergePremiumHistory, premiumPct } = require('./chinaEtfPremium');

test('finiteNumber rejects missing market values instead of coercing them to zero', () => {
  assert.equal(finiteNumber(null), null);
  assert.equal(finiteNumber(undefined), null);
  assert.equal(finiteNumber(''), null);
  assert.equal(finiteNumber('-'), null);
  assert.equal(finiteNumber('2.490'), 2.49);
});

test('premiumPct calculates market price premium to NAV', () => {
  assert.equal(premiumPct(1.08, 1), 8.000000000000007);
  assert.equal(premiumPct(0.97, 1), -3.0000000000000027);
  assert.equal(premiumPct(1, 0), null);
});

test('mergePremiumHistory aligns closes with NAV and uses live IOPV for today', () => {
  const points = mergePremiumHistory(
    [
      { date: '2026-07-20', marketPrice: 1.05 },
      { date: '2026-07-21', marketPrice: 1.09 },
    ],
    [{ date: '2026-07-20', nav: 1 }],
    { date: '2026-07-21', marketPrice: 1.08, nav: 1, premium: 8, quotedAt: '2026-07-21T07:00:00.000Z' },
  );

  assert.equal(points.length, 2);
  assert.equal(points[0].navSource, 'Official NAV');
  assert.ok(Math.abs(points[0].premium - 5) < 1e-10);
  assert.equal(points[1].navSource, 'IOPV');
  assert.equal(points[1].premium, 8);
  assert.equal(points[1].marketPrice, 1.08);
});
