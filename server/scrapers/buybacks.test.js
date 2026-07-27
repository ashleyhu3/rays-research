'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { _test } = require('./buybacks');

const {
  extractAmount, aggregateChina, aggregateTaiwan, parseTaiwanRows, rocToIso,
  assembleMarket, fetchUsMonth, setDelayScale,
} = _test;

/* ── Throttling must fail the month, never record it as zero ──────── */

/** Stub EDGAR: the search always answers, the filings answer with `docStatus`. */
function stubEdgar(docStatus, hitCount = 50) {
  const hits = Array.from({ length: hitCount }, (_, i) => ({
    _id: `0000000000-26-0000${i}:doc${i}.htm`,
    _source: { ciks: [`000000${1000 + i}`] },
  }));
  return async (url) => {
    if (String(url).includes('efts.sec.gov')) {
      return {
        ok: true, status: 200,
        json: async () => ({ hits: { total: { value: hitCount }, hits } }),
      };
    }
    if (docStatus !== 200) {
      return { ok: false, status: docStatus, headers: { get: () => null } };
    }
    return {
      ok: true, status: 200, headers: { get: () => null },
      text: async () => 'the Board authorized a repurchase program for up to $10 million of common stock',
    };
  };
}

test('fetchUsMonth throws when SEC throttles instead of reporting an empty month', async () => {
  // The bug this guards: a 429 storm made every filing fetch fail, the month
  // summed to $0, and the resumable backfill then skipped it as already done.
  const original = global.fetch;
  setDelayScale(0);
  global.fetch = stubEdgar(429);
  try {
    await assert.rejects(
      () => fetchUsMonth('2023-06'),
      /rate limited|could not be fetched/i,
    );
  } finally {
    global.fetch = original;
    setDelayScale(1);
  }
});

test('fetchUsMonth totals the month when every filing is readable', async () => {
  const original = global.fetch;
  setDelayScale(0);
  global.fetch = stubEdgar(200, 10);
  try {
    const result = await fetchUsMonth('2023-06');
    assert.equal(result.count, 10);          // ten distinct companies
    assert.equal(result.amount, 10 * 10e6);
  } finally {
    global.fetch = original;
    setDelayScale(1);
  }
});

/* ── US 8-K amount extraction ─────────────────────────────────────── */

test('extractAmount reads an explicit new authorization', () => {
  assert.equal(extractAmount(
    'the Board authorized a share repurchase program for up to $20 million of common stock',
  ).amount, 20e6);

  assert.equal(extractAmount(
    'JPMorgan Chase announced a new common share repurchase program of $50 billion, effective July 1',
  ).amount, 50e9);

  assert.equal(extractAmount(
    'Shopify announced that its Board has authorized an additional $3 billion for the repurchase program',
  ).amount, 3e9);
});

test('extractAmount keeps the increment, not the since-inception total', () => {
  // AutoZone-style: the lifetime total dwarfs the new authorization and sits in
  // the same sentence, so a naive "largest dollar figure nearby" is 28x wrong.
  assert.equal(extractAmount(
    'AutoZone announced its Board voted to authorize the repurchase of an additional $1.5 billion '
    + 'of common stock, bringing the total to $42.2 billion since 1998',
  ).amount, 1.5e9);

  assert.equal(extractAmount(
    "O'Reilly announced the Board approved a $2 billion increase to its share repurchase program, "
    + 'bringing the total authorization to $31.75 billion since 2011',
  ).amount, 2e9);
});

test('extractAmount ignores balance-sheet figures that merely sit near "repurchase"', () => {
  // CVB-style: a small bank's press release quotes total assets next to the
  // program description. Counting it would add $20bn to the month.
  const result = extractAmount(
    'CVBF is one of the ten largest bank holding companies headquartered in California with '
    + '$20 billion in assets. This 2026 Repurchase Program replaces the previous share repurchase program',
  );
  assert.equal(result.amount, null);
});

test('extractAmount flags share-count authorizations instead of valuing them', () => {
  const result = extractAmount(
    'the Board approved a repurchase program for up to 1,606,837 shares of its common stock',
  );
  assert.equal(result.amount, null);
  assert.equal(result.sharesOnly, true);
});

test('extractAmount rejects a bare dollar figure with no magnitude word', () => {
  assert.equal(extractAmount(
    'the Board authorized the repurchase program at prices not exceeding $45 per share',
  ).amount, null);
});

/* ── China plan aggregation ───────────────────────────────────────── */

test('aggregateChina sums the announced ceiling by announcement month', () => {
  const months = aggregateChina([
    { DIM_SCODE: '000001', DIM_DATE: '2026-06-03 00:00:00', REPURAMOUNTLIMIT: 3e8, REPURAMOUNTLOWER: 1.5e8 },
    { DIM_SCODE: '000002', DIM_DATE: '2026-06-20 00:00:00', REPURAMOUNTLIMIT: 1e8, REPURAMOUNTLOWER: 5e7 },
    { DIM_SCODE: '000003', DIM_DATE: '2026-07-01 00:00:00', REPURAMOUNTLIMIT: 2e8, REPURAMOUNTLOWER: 1e8 },
  ]);
  assert.equal(months['2026-06'].amount, 4e8);
  assert.equal(months['2026-06'].floor, 2e8);
  assert.equal(months['2026-06'].count, 2);
  assert.equal(months['2026-07'].amount, 2e8);
});

test('aggregateChina falls back to share cap x price cap when no amount is stated', () => {
  const months = aggregateChina([
    { DIM_SCODE: '000004', DIM_DATE: '2026-06-03 00:00:00', REPURAMOUNTLIMIT: null, REPURNUMCAP: 1e6, REPURPRICECAP: 12.5 },
  ]);
  assert.equal(months['2026-06'].amount, 12.5e6);
});

test('a month inside the range with no announcements records a real zero', () => {
  // These tables are complete filing records, so a month with no rows means no
  // buybacks were announced — not that the month is missing. Taiwan has exactly
  // two such months since 2000 (2010-01, 2023-04).
  const tw = aggregateTaiwan([
    { date: '2023-03-10', code: '2330', shares: 1e6, priceLow: 10, priceHigh: 20 },
    { date: '2023-05-10', code: '2317', shares: 1e6, priceLow: 10, priceHigh: 20 },
  ]);
  assert.deepEqual(tw['2023-04'], { amount: 0, floor: 0, count: 0 });

  const cn = aggregateChina([
    { DIM_SCODE: '000001', DIM_DATE: '2026-01-05 00:00:00', REPURAMOUNTLIMIT: 1e8 },
    { DIM_SCODE: '000002', DIM_DATE: '2026-03-05 00:00:00', REPURAMOUNTLIMIT: 1e8 },
  ]);
  assert.deepEqual(cn['2026-02'], { amount: 0, floor: 0, count: 0 });
});

test('aggregateChina counts a plan once even if the table repeats it', () => {
  const row = { DIM_SCODE: '000005', DIM_DATE: '2026-06-03 00:00:00', REPURAMOUNTLIMIT: 1e8 };
  const months = aggregateChina([row, { ...row }]);
  assert.equal(months['2026-06'].count, 1);
  assert.equal(months['2026-06'].amount, 1e8);
});

/* ── Taiwan MOPS parsing and aggregation ──────────────────────────── */

test('rocToIso converts Republic-of-China dates', () => {
  assert.equal(rocToIso('114/06/30'), '2025-06-30');
  assert.equal(rocToIso('97/11/12'), '2008-11-12');
  assert.equal(rocToIso(''), null);
});

test('parseTaiwanRows reads filing rows and skips the per-company subtotal', () => {
  const html = `
    <tr><td>1</td><td>1101</td><td>台泥</td><td>114/06/30</td><td>1</td>
        <td>126,554,019,000</td><td>10,000,000</td><td>17.85</td><td>41.50</td><td>114/07/01</td></tr>
    <tr><td>累計</td><td>1101</td><td>台泥</td><td>----</td><td>----</td>
        <td>----</td><td>112,000,000</td><td>----</td><td>----</td><td>----</td></tr>`;
  const rows = parseTaiwanRows(html);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], { date: '2025-06-30', code: '1101', shares: 10000000, priceLow: 17.85, priceHigh: 41.5 });
});

test('aggregateTaiwan values a filing at planned shares x the top of the price band', () => {
  const months = aggregateTaiwan([
    { date: '2026-05-04', code: '2330', shares: 1e6, priceLow: 10, priceHigh: 20 },
    { date: '2026-05-19', code: '2317', shares: 5e5, priceLow: 8, priceHigh: 12 },
  ]);
  assert.equal(months['2026-05'].amount, 1e6 * 20 + 5e5 * 12);
  assert.equal(months['2026-05'].floor, 1e6 * 10 + 5e5 * 8);
  assert.equal(months['2026-05'].count, 2);
});

/* ── Assembly for the chart ───────────────────────────────────────── */

test('assembleMarket converts to billions and reports a trailing-12-month total', () => {
  const stored = {
    '2026-04': { amount: 1e9, count: 2 },
    '2026-05': { amount: 2.5e9, count: 3 },
    '2026-06': { amount: 5e8, count: 1, sharesOnly: 4 },
  };
  const series = assembleMarket(stored, 'us');
  assert.deepEqual(series.months, ['2026-04', '2026-05', '2026-06']);
  assert.deepEqual(series.amount, [1, 2.5, 0.5]);
  assert.deepEqual(series.sharesOnly, [0, 0, 4]);
  assert.equal(series.currency, 'USD');
  assert.equal(series.latest.month, '2026-06');
  assert.equal(series.latest.trailing12, 4);
});

test('assembleMarket keeps an uncollected month as a hole, not a zero', () => {
  // A month that was never collected must stay visibly absent. Closing the axis
  // over it would put Jan next to Mar as though Feb had not existed.
  const series = assembleMarket({
    '2026-01': { amount: 1e9, count: 2 },
    '2026-03': { amount: 3e9, count: 4 },
  }, 'us');
  assert.deepEqual(series.months, ['2026-01', '2026-02', '2026-03']);
  assert.deepEqual(series.amount, [1, null, 3]);
  assert.deepEqual(series.count, [2, null, 4]);
});

test('assembleMarket keeps a genuinely empty month as zero', () => {
  const series = assembleMarket({
    '2026-01': { amount: 1e9, count: 2 },
    '2026-02': { amount: 0, count: 0 },
  }, 'us');
  assert.deepEqual(series.amount, [1, 0]);
  assert.deepEqual(series.count, [2, 0]);
});

test('assembleMarket tolerates a market with no stored history', () => {
  const series = assembleMarket(undefined, 'tw');
  assert.deepEqual(series.months, []);
  assert.equal(series.latest, null);
  assert.equal(series.symbol, 'NT$');
});
