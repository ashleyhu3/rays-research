'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { _test } = require('./carryTrade');

test('parses JPY and CHF non-commercial net positions from the CFTC legacy report', () => {
  const row = (name, code, long, short) => [
    `"${name}"`, '260714', '2026-07-14', code, 'CME', '00', code.slice(0, 3),
    '100000', String(long), String(short), '1000', '1', '1', '1', '1', '1', '1',
  ].join(',');
  const parsed = _test.parseLegacyCftc([
    row('JAPANESE YEN - CHICAGO MERCANTILE EXCHANGE', '097741', 115965, 238628),
    row('SWISS FRANC - CHICAGO MERCANTILE EXCHANGE', '092741', 9909, 46865),
  ].join('\n'));
  assert.deepEqual(parsed.jpy, { '2026-07-14': -122663 });
  assert.deepEqual(parsed.chf, { '2026-07-14': -36956 });
});

test('ignores unrelated contracts and malformed values', () => {
  const unrelated = '"EURO FX",260714,2026-07-14,099741,CME,00,099,1,2,3';
  const malformed = '"JAPANESE YEN",260714,2026-07-14,097741,CME,00,097,1,.,3';
  const parsed = _test.parseLegacyCftc(`${unrelated}\n${malformed}`);
  assert.deepEqual(parsed.jpy, {});
  assert.deepEqual(parsed.chf, {});
});
