'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseTeOhlc, parseEastmoneyKlines, parseMysteelRange } = require('./commodities');

test('parses Trading Economics market OHLC rows', () => {
  const candles = parseTeOhlc([[1753228800, 3387.82, null, null, 3380, 3440, 3370, 3390]]);
  assert.deepEqual(candles, [{ date: '2025-07-23', open: 3380, high: 3440, low: 3370, close: 3390 }]);
});

test('parses Eastmoney daily K-line rows', () => {
  const candles = parseEastmoneyKlines(['2026-07-22,884.94,902.80,904.64,883.00,140511']);
  assert.deepEqual(candles, [{ date: '2026-07-22', open: 884.94, high: 904.64, low: 883, close: 902.8 }]);
});

test('parses a Mysteel low/high/average quote as a daily range candle', () => {
  const html = '<div>2026-07-17</div><table><tr><td>氧化钕</td><td>Nd2O3 ≥99.5%</td><td>815000</td><td>820000</td><td>817500</td><td>元/吨</td></tr></table>';
  const meta = { match: ['氧化钕', '99.5%'] };
  assert.deepEqual(parseMysteelRange(html, meta), {
    date: '2026-07-17', open: 817500, high: 820000, low: 815000, close: 817500,
  });
});
