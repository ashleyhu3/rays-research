'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { _test } = require('./chinaLeverage');

test('assemble combines SSE + SZSE per metric and scales into display units', () => {
  const data = _test.assemble({
    '2026-01-02': {
      sse: { balance: 1e12, purchase: 100e9, repay: 90e9, lendVolume: 60e6, lendBalance: 10e9, totalBalance: 1.05e12 },
      szse: { balance: 0.9e12, purchase: 90e9, repay: 80e9, lendVolume: 30e6, lendBalance: 5e9, totalBalance: 0.95e12 },
    },
  });

  assert.equal(data.balance[0], 1.9);        // trillions CNY
  assert.equal(data.totalBalance[0], 2);     // trillions CNY
  assert.equal(data.purchase[0], 190);       // billions CNY
  assert.equal(data.repay[0], 170);          // billions CNY
  assert.equal(data.lendBalance[0], 15);     // billions CNY
  assert.equal(data.lendVolume[0], 90);      // millions of shares
  assert.equal(data.latest.balance, 1.9);

  // Per-exchange breakdown for the three stacked-layer charts.
  assert.equal(data.bySse.balance[0], 1);
  assert.equal(data.bySzse.balance[0], 0.9);
  assert.equal(data.bySse.lendBalance[0], 10);   // billions CNY
  assert.equal(data.bySzse.lendBalance[0], 5);
});

test('bySse/bySzse each carry forward through their own gap, independently of the combined total', () => {
  const data = _test.assemble({
    '2026-01-02': {
      sse: { balance: 1e12, lendBalance: 10e9, totalBalance: 1.1e12 },
      szse: { balance: 0.9e12, lendBalance: 5e9, totalBalance: 0.95e12 },
    },
    '2026-01-05': {
      sse: { balance: 1.1e12, lendBalance: 11e9, totalBalance: 1.2e12 },
      // SZSE hasn't posted yet this day.
    },
  });

  assert.equal(data.balance[1], 1.9);             // combined carries the whole prior sum forward
  assert.equal(data.bySse.balance[1], 1.1);       // SSE's own layer updates with its fresh value
  assert.equal(data.bySzse.balance[1], 0.9);      // SZSE's own layer carries only its own last value forward
});

test('SZSE trillion-CNY series preserve daily moves smaller than CNY 10B', () => {
  const data = _test.assemble({
    '2026-01-02': {
      sse: { balance: 1e12, lendBalance: 10e9, totalBalance: 1.01e12 },
      szse: { balance: 1.326713e12, lendBalance: 6.951e9, totalBalance: 1.333664e12 },
    },
    '2026-01-05': {
      sse: { balance: 1e12, lendBalance: 10e9, totalBalance: 1.01e12 },
      szse: { balance: 1.325924e12, lendBalance: 7.2e9, totalBalance: 1.333124e12 },
    },
  });

  assert.deepEqual(data.bySzse.balance, [1.326713, 1.325924]);
  assert.deepEqual(data.bySzse.totalBalance, [1.333664, 1.333124]);
  assert.notEqual(data.bySzse.balance[0], data.bySzse.balance[1]);
});

test('assemble carries a metric forward when one exchange is missing that day, and clears the carry once both report again', () => {
  const data = _test.assemble({
    '2026-01-02': {
      sse: { balance: 1e12, purchase: 100e9, repay: 90e9, lendVolume: 60e6, lendBalance: 10e9, totalBalance: 1.05e12 },
      szse: { balance: 0.9e12, purchase: 90e9, repay: 80e9, lendVolume: 30e6, lendBalance: 5e9, totalBalance: 0.95e12 },
    },
    '2026-01-05': {
      sse: { balance: 1.1e12, purchase: 110e9, repay: 95e9, lendVolume: 65e6, lendBalance: 11e9, totalBalance: 1.15e12 },
      // SZSE hasn't posted yet this day
    },
    '2026-01-06': {
      sse: { balance: 1.12e12, purchase: 90e9, repay: 70e9, lendVolume: 62e6, lendBalance: 11.5e9, totalBalance: 1.17e12 },
      szse: { balance: 0.92e12, purchase: 95e9, repay: 85e9, lendVolume: 31e6, lendBalance: 5.2e9, totalBalance: 0.97e12 },
    },
  });

  assert.equal(data.balance[1], data.balance[0]);     // carried forward, not recomputed from SSE alone
  assert.equal(data.carriedFrom.balance, null);       // cleared once 01-06 has both sides again
  assert.equal(data.balance[2], 1.12 + 0.92);
});

test('assembleEtf sums the four products\' CNY-converted AUM into one billions-CNY total, carrying each product through its own gaps', () => {
  const data = _test.assembleEtf({
    etf: {
      csi300: { '2026-01-02': { aum: 280e6 }, '2026-01-05': { aum: 290e6 } },
      chinext: { '2026-01-02': { aum: 130e6 } }, // doesn't report on 01-05
      csi300Krx: { '2026-01-05': { aum: 500e6 } }, // hasn't started reporting on 01-02
      csi300Us: { '2026-01-02': { aum: 660e6, approx: true }, '2026-01-05': { aum: 670e6, approx: true } },
    },
  });

  assert.deepEqual(data.dates, ['2026-01-02', '2026-01-05']);
  // 01-02: csi300 280M + chinext 130M + csi300Us 660M = 1070M = 1.07B (csi300Krx hasn't appeared yet)
  assert.equal(data.total[0], 1.07);
  // 01-05: csi300 290M + chinext carried 130M + csi300Krx 500M + csi300Us 670M = 1590M = 1.59B
  assert.equal(data.total[1], 1.59);
});

test('assembleEtf builds the latest fund table sorted by AUM, flagging the approximated leg', () => {
  const data = _test.assembleEtf({
    etf: {
      csi300: { '2026-01-05': { aum: 280e6 } },
      chinext: { '2026-01-05': { aum: 130e6 } },
      csi300Krx: { '2026-01-05': { aum: 500e6 } },
      csi300Us: { '2026-01-05': { aum: 660e6, approx: true } },
    },
  });

  assert.equal(data.fundsDate, '2026-01-05');
  assert.deepEqual(data.funds.map(f => f.key), ['csi300Us', 'csi300Krx', 'csi300', 'chinext']);
  assert.equal(data.funds.find(f => f.key === 'csi300Us').aum, 0.66);
  assert.equal(data.funds.find(f => f.key === 'csi300Us').approx, true);
  assert.equal(data.funds.find(f => f.key === 'csi300').approx, false);
});
