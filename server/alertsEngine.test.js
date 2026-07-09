'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { buildEmail, sideTrigger, sumVolume } = require('./alertsEngine');

test('sums missing and populated contract volume safely', () => {
  assert.equal(sumVolume(), 0);
  assert.equal(sumVolume([{ volume: 10 }, {}, { volume: 25 }]), 35);
});

test('requires both the percentage threshold and absolute volume increase', () => {
  assert.equal(sideTrigger(1600, 1000, 0.5, 500), true);
  assert.equal(sideTrigger(1450, 1000, 0.5, 100), false);
  assert.equal(sideTrigger(1600, 1000, 0.5, 700), false);
});

test('renders triggered call and put comparisons in both email formats', () => {
  const email = buildEmail([{
    ticker: 'NVDA',
    today: { date: '2026-07-06', callVol: 2500, putVol: 1200, price: 155.25 },
    prev: { date: '2026-07-03', callVol: 1000, putVol: 1000 },
    call: true,
    put: false,
    callPct: 150,
    putPct: 20,
  }]);

  assert.match(email.subject, /NVDA/);
  assert.match(email.text, /CALL SURGE/);
  assert.match(email.text, /1,000 → 2,500/);
  assert.match(email.html, /SURGE/);
  assert.match(email.html, /\$155\.25/);
});
