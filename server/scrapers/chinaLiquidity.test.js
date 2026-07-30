'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { _test } = require('./chinaLiquidity');

test('parses East Money amount (f57) as A-share turnover', () => {
  assert.deepEqual(_test.parseTurnoverKlines([
    '2026-07-17,1,2,3,0.5,123,1450000000000,1.2,0.2,0.1,2.3',
  ]), { '2026-07-17': 1450000000000 });
});

test('parses East Money turnover rate (f61) as percent', () => {
  assert.deepEqual(_test.parseTurnoverRateKlines([
    '2026-07-17,1,2,3,0.5,123,1450000000000,1.2,0.2,0.1,2.3',
  ]), { '2026-07-17': 2.3 });
});

// 2026-07-30 in Beijing: 09:30 open is 01:30 UTC, 15:00 close is 07:00 UTC.
const OPEN = Date.parse('2026-07-30T01:30:00Z');
const MID_SESSION = Date.parse('2026-07-30T03:00:00Z');   // 11:00 Beijing — the 03:00 UTC cron
const JUST_CLOSED = Date.parse('2026-07-30T07:05:00Z');   // bell rung, print not settled
const AFTER_CLOSE = Date.parse('2026-07-30T08:00:00Z');   // 16:00 Beijing — the post-close cron

test('treats a session as final only after its close has settled', () => {
  assert.equal(_test.isSessionFinal('2026-07-30', OPEN), false);
  assert.equal(_test.isSessionFinal('2026-07-30', MID_SESSION), false);
  assert.equal(_test.isSessionFinal('2026-07-30', JUST_CLOSED), false);
  assert.equal(_test.isSessionFinal('2026-07-30', AFTER_CLOSE), true);
  // Prior sessions are always final, and a malformed date never is.
  assert.equal(_test.isSessionFinal('2026-07-29', OPEN), true);
  assert.equal(_test.isSessionFinal('not-a-date', AFTER_CLOSE), false);
});

test('drops the in-progress session so a mid-session run cannot persist a partial day', () => {
  // Real East Money rows: 07-29 settled at ¥2.312tn/1.72%, 07-30 mid-morning at
  // ¥1.017tn/0.78% — under half the day, which is what put a false cliff on the chart.
  const klines = [
    '2026-07-29,6283.31,6315.44,6346.44,6210.01,1253373010,2311727087616.00,2.17,0.65,40.93,1.72',
    '2026-07-30,6320.00,6350.00,6355.00,6300.00,550000000,1017000000000.00,0.9,0.55,34.56,0.78',
  ];
  assert.deepEqual(_test.parseTurnoverKlines(klines, MID_SESSION), { '2026-07-29': 2311727087616 });
  assert.deepEqual(_test.parseTurnoverRateKlines(klines, MID_SESSION), { '2026-07-29': 1.72 });
  // Once the session settles, the same row is accepted.
  assert.deepEqual(_test.parseTurnoverKlines(klines, AFTER_CLOSE), {
    '2026-07-29': 2311727087616, '2026-07-30': 1017000000000,
  });
  assert.deepEqual(_test.parseTurnoverRateKlines(klines, AFTER_CLOSE), {
    '2026-07-29': 1.72, '2026-07-30': 0.78,
  });
});

test('rejects a non-positive turnover print from an empty or unstarted session', () => {
  const klines = ['2026-07-29,6283.31,6315.44,6346.44,6210.01,0,0.00,0,0,0,0'];
  assert.deepEqual(_test.parseTurnoverKlines(klines, AFTER_CLOSE), {});
  assert.deepEqual(_test.parseTurnoverRateKlines(klines, AFTER_CLOSE), {});
});

test('takes East Money money-supply growth as reported rather than from levels', () => {
  // Real rows. Recomputing 2025-01 M1 from the levels would give ~+62% because the
  // PBoC widened the M1 definition that month without restating 2024 — the reported
  // 同比 of 0.4% is the comparable-basis figure.
  assert.deepEqual(_test.parseMoneySupplyRows([
    {
      REPORT_DATE: '2026-06-01 00:00:00',
      CURRENCY: 1184775.53, CURRENCY_SAME: 4,
      BASIC_CURRENCY: 3567108.43, BASIC_CURRENCY_SAME: 8,
    },
    {
      REPORT_DATE: '2025-01-01 00:00:00',
      CURRENCY: 1122100, CURRENCY_SAME: 0.4,
      BASIC_CURRENCY: 3145700, BASIC_CURRENCY_SAME: 7,
    },
    // Older rows carry float noise; the release only resolves to one decimal.
    { REPORT_DATE: '2017-08-01 00:00:00', CURRENCY_SAME: 14, BASIC_CURRENCY_SAME: 8.5633 },
    { REPORT_DATE: 'not-a-date', CURRENCY_SAME: 9, BASIC_CURRENCY_SAME: 9 },
    { REPORT_DATE: '2026-07-01 00:00:00', CURRENCY_SAME: null, BASIC_CURRENCY_SAME: null },
  ]), {
    m1Yoy: { '2026-06-01': 4, '2025-01-01': 0.4, '2017-08-01': 14 },
    m2Yoy: { '2026-06-01': 8, '2025-01-01': 7, '2017-08-01': 8.56 },
  });
});

test('derives the M1–M2 spread only for months carrying both aggregates', () => {
  assert.deepEqual(_test.deriveM1M2Spread(
    { '2026-04-01': 2.3, '2026-05-01': 4.8, '2026-06-01': 6.1 },
    { '2026-04-01': 8.1, '2026-05-01': 8.3 },
  ), { '2026-04-01': -5.8, '2026-05-01': -3.5 });
});

test('sums Tushare free_share × close into CNY, skipping unpriced rows', () => {
  const payload = {
    fields: ['ts_code', 'close', 'free_share'],
    items: [
      ['600000.SH', 10, 20000],      // 10元 × 2亿股 = 20亿元
      ['000001.SZ', 25, 4000],       // 25元 × 4000万股 = 10亿元
      ['600123.SH', null, 5000],     // suspended — no close
      ['301999.SZ', 30, null],       // not yet floating
      ['300888.SZ', 30, 0],
    ],
  };
  assert.deepEqual(_test.sumFreeFloatCap(payload), { total: 3e9, counted: 2 });
});

test('rejects a Tushare page that is missing the free_share column', () => {
  assert.throws(
    () => _test.sumFreeFloatCap({ fields: ['ts_code', 'close'], items: [['600000.SH', 10]] }),
    /missing close\/free_share/,
  );
});

test('derives turnover rate as turnover ÷ free-float cap in percent', () => {
  const turnover = { '2026-07-23': 2.2e12, '2026-07-24': 1.944e12, '2026-07-27': 2e12 };
  const freeFloatCap = { '2026-07-23': 1.1e14, '2026-07-24': 9.72e13, '2026-07-27': 0 };
  // A zero or absent denominator drops the date rather than dividing through it.
  assert.deepEqual(_test.deriveTurnoverRate(turnover, freeFloatCap), {
    '2026-07-23': 2, '2026-07-24': 2,
  });
});

test('assemble exposes the turnover-rate series alongside raw turnover', () => {
  const payload = _test.assemble({
    turnover: { '2026-07-24': 1.944e12 },
    freeFloatCap: { '2026-07-24': 9.72e13 },
    m2Yoy: {}, southboundNetFlow: {}, northboundTurnover: {},
  });
  assert.equal(payload.turnoverRate.unit, '%');
  assert.deepEqual(payload.turnoverRate.data, [{ date: '2026-07-24', value: 2 }]);
});

test('assemble prefers the directly reported East Money turnover rate', () => {
  const payload = _test.assemble({
    turnover: { '2026-07-24': 1.944e12 },
    turnoverRate: { '2026-07-24': 1.49 },
    freeFloatCap: { '2026-07-24': 9.72e13 },
    m2Yoy: {}, southboundNetFlow: {}, northboundTurnover: {},
  });
  assert.deepEqual(payload.turnoverRate.data, [{ date: '2026-07-24', value: 1.49 }]);
});

/** Stands in for Tushare's daily_basic: `rows` A-shares split into 5000-row pages,
 * each priced at 10元 with a 10,000万股 float. Records the requests it served. */
function stubTushare(rows) {
  const calls = [];
  global.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body.params);
    const { limit, offset } = body.params;
    const page = Math.max(0, Math.min(limit, rows - offset));
    return {
      ok: true,
      json: async () => ({
        code: 0,
        data: {
          fields: ['ts_code', 'close', 'free_share'],
          items: Array.from({ length: page }, (_, i) => [`${offset + i}.SH`, 10, 10000]),
        },
      }),
    };
  };
  return calls;
}

test('pages daily_basic across the A-share universe and stores CNY free-float cap', async t => {
  const realFetch = global.fetch;
  t.after(() => { global.fetch = realFetch; });
  process.env.TUSHARE_TOKEN = 'test-token';
  const calls = stubTushare(5883);

  const history = {
    turnover: { '2026-07-23': 2.2e12, '2026-07-24': 1.9e12 },
    freeFloatCap: { '2026-07-23': 1.1e14 },
  };
  const added = await _test.updateFreeFloatCap(history, 10);

  assert.equal(added, 1);
  // Only the date missing a denominator is priced, and it takes two pages.
  assert.deepEqual(calls, [
    { trade_date: '20260724', limit: 5000, offset: 0 },
    { trade_date: '20260724', limit: 5000, offset: 5000 },
  ]);
  assert.equal(history.freeFloatCap['2026-07-24'], 5883 * 10 * 10000 * 1e4);
  assert.equal(history.freeFloatCap['2026-07-23'], 1.1e14, 'existing dates are left alone');
});

test('rejects a truncated universe rather than storing a fake denominator', async t => {
  const realFetch = global.fetch;
  t.after(() => { global.fetch = realFetch; });
  process.env.TUSHARE_TOKEN = 'test-token';
  stubTushare(12);  // quota-throttled response — nowhere near the real universe

  const history = { turnover: { '2026-07-24': 1.9e12 }, freeFloatCap: {} };
  await assert.rejects(_test.updateFreeFloatCap(history, 10), /priced only 12 A-shares/);
  assert.deepEqual(history.freeFloatCap, {});
});

test('surfaces a missing Tushare token instead of silently skipping', async () => {
  const token = process.env.TUSHARE_TOKEN;
  delete process.env.TUSHARE_TOKEN;
  try {
    await assert.rejects(
      _test.updateFreeFloatCap({ turnover: { '2026-07-24': 1 }, freeFloatCap: {} }),
      /TUSHARE_TOKEN is not set/,
    );
  } finally {
    if (token) process.env.TUSHARE_TOKEN = token;
  }
});

test('parses East Money Stock Connect fields into 亿元', () => {
  const rows = [
    { TRADE_DATE: '2026-07-21 00:00:00', NET_DEAL_AMT: 7167.37, DEAL_AMT: 439351.19 },
    { TRADE_DATE: 'bad-date', NET_DEAL_AMT: 10 },
    { TRADE_DATE: '2026-07-20 00:00:00', NET_DEAL_AMT: null },
  ];
  assert.deepEqual(_test.parseStockConnectRows(rows, 'NET_DEAL_AMT'), {
    '2026-07-21': 71.6737,
  });
  assert.deepEqual(_test.parseStockConnectRows(rows, 'DEAL_AMT'), {
    '2026-07-21': 4393.5119,
  });
});
