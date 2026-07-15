'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { _test } = require('./koreaLeverage');

test('assemble sums reverse 2x funds separately and carries each fund through gaps', () => {
  const data = _test.assemble({
    names: { A122630: { name: 'KODEX KOSPI200 2×', kind: 'index' } },
    reverseNames: {
      A252670: { name: 'KODEX KOSPI200 Futures Inverse 2×', kind: 'reverse-index' },
      A252710: { name: 'TIGER KOSPI200 Futures Inverse 2×', kind: 'reverse-index' },
    },
    '2026-01-02': {
      collateral: 20,
      margin: 30,
      funds: { A122630: 10 },
      reverseFunds: { A252670: 0.5, A252710: 0.2 },
    },
    '2026-01-05': {
      collateral: 21,
      margin: 31,
      funds: { A122630: 11 },
      reverseFunds: { A252670: 0.4 },
    },
  });

  assert.deepEqual(data.reverseEtf, [0.7, 0.6]);
  assert.equal(data.latest.reverseEtf, 0.6);
  assert.equal(data.latest.total, 63);
  assert.deepEqual(data.reverseFunds.map(fund => fund.code), ['A252670', 'A252710']);
});
