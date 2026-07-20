'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { _test } = require('./usLeverage');

test('monthYearToIso reads FINRA\'s "Mon-YY" format within the 1997+ reporting range', () => {
  assert.equal(_test.monthYearToIso('Jun-26'), '2026-06-01');
  assert.equal(_test.monthYearToIso('2026-06'), '2026-06-01');
  assert.equal(_test.monthYearToIso('Jan-97'), '1997-01-01'); // century cutoff at 50 resolves 1997 vs 2097
  assert.equal(_test.monthYearToIso('bogus'), null);
});

test('parseFinraHtmlTable reads Month/Year + Debit Balances from the page\'s own rendered table', () => {
  const html = `<table><thead><tr><th>Month/Year</th><th>Debit Balances in Customers' Securities Margin Accounts</th>
    <th>Free Credit Balances in Customers' Cash Accounts</th><th>Free Credit Balances in Customers' Securities Margin Accounts</th></tr></thead>
    <tbody><tr><td>Jun-26</td><td>1,502,072</td><td>217,441</td><td>223,412</td></tr>
    <tr><td>May-26</td><td>1,415,557</td><td>206,600</td><td>217,256</td></tr></tbody></table>`;
  const out = _test.parseFinraHtmlTable(html);
  assert.deepEqual(out, { '2026-06-01': 1502072, '2026-05-01': 1415557 });
});

test('parseFinraHtmlTable ignores unrelated tables on the page', () => {
  const html = '<table><thead><tr><th>Some other table</th></tr></thead><tbody><tr><td>x</td></tr></tbody></table>';
  assert.deepEqual(_test.parseFinraHtmlTable(html), {});
});

test('parseFinraXlsx reads FINRA workbook Year-Month rows and debit balances', () => {
  const XLSX = require('@e965/xlsx');
  const book = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([
    ['Year-Month', "Debit Balances in Customers' Securities Margin Accounts", "Free Credit Balances in Customers' Cash Accounts"],
    ['2026-06', 1502072, 217441],
    ['2026-05', 1415557, 206600],
  ]);
  XLSX.utils.book_append_sheet(book, sheet, 'Customer Margin Balances');
  const buffer = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' });
  assert.deepEqual(_test.parseFinraXlsx(buffer), {
    '2026-06-01': 1502072,
    '2026-05-01': 1415557,
  });
});

test('splitCsvLine handles quoted CFTC market names', () => {
  assert.deepEqual(_test.splitCsvLine('"A, B",260714,2026-07-14'), ['A, B', '260714', '2026-07-14']);
});

test('parseCftcTffText reads direct leveraged-fund fields and total open interest by contract code', () => {
  const header = '"Market_and_Exchange_Names","As_of_Date_In_Form_YYMMDD","Report_Date_as_YYYY-MM-DD","CFTC_Contract_Market_Code","CFTC_Market_Code","CFTC_Region_Code","CFTC_Commodity_Code","Open_Interest_All"';
  const row = [
    '"E-MINI S&P 500 - CHICAGO MERCANTILE EXCHANGE"', '260714', '2026-07-14', '13874A', 'CME', '00', '138',
    '1941500', '142914', '849691', '66996', '1144294', '203822', '92603', '135454', '500456', '40091',
  ].join(',');
  const ignored = [
    '"S&P 500 Consolidated - CHICAGO MERCANTILE EXCHANGE"', '260714', '2026-07-14', '13874+', 'CME', '00', '138',
    '1', '1', '1', '1', '1', '1', '1', '1', '1', '1',
  ].join(',');
  const out = _test.parseCftcTffText(`${header}\n${row}\n${ignored}`);
  assert.deepEqual(out.ES, {
    '2026-07-14': {
      totalOpenInterest: 1941500,
      long: 135454,
      short: 500456,
      spreading: 40091,
    },
  });
  assert.deepEqual(out.NQ, {});
});

test('parseProSharesNavHistoryCsv reads MM/DD/YYYY dates and the Assets Under Management column', () => {
  const csv = 'Date,ProShares Name,Ticker,NAV,Prior NAV,NAV Change (%),NAV Change ($),Shares Outstanding (000),Assets Under Management\n'
    + '07/17/2026,ProShares UltraPro QQQ,TQQQ,67.5382,70.7676,-4.56339,-3.2294,493150,33306463330\n'
    + '07/16/2026,ProShares UltraPro QQQ,TQQQ,70.7676,74.3908,-4.87049,-3.6232,485850,34382438460\n';
  assert.deepEqual(_test.parseProSharesNavHistoryCsv(csv), {
    '2026-07-17': 33306463330,
    '2026-07-16': 34382438460,
  });
});

test('parseProSharesNavHistoryCsv skips rows with an unparseable date', () => {
  const csv = 'Date,ProShares Name,Ticker,NAV,Prior NAV,NAV Change (%),NAV Change ($),Shares Outstanding (000),Assets Under Management\n'
    + 'not-a-date,ProShares UltraPro QQQ,TQQQ,1,1,0,0,1,1\n';
  assert.deepEqual(_test.parseProSharesNavHistoryCsv(csv), {});
});

test('parseDirexionNetAssets finds a dollar figure near a net-assets mention for the given ticker', () => {
  const html = '<p>SOXL fund facts: net assets $4.21 billion as of today</p>';
  assert.equal(_test.parseDirexionNetAssets(html, 'SOXL'), 4.21e9);
});

test('parseDirexionNetAssets returns null when no figure is found', () => {
  assert.equal(_test.parseDirexionNetAssets('<p>nothing relevant</p>', 'SOXL'), null);
});

test('assembleSeries scales and rounds a date-keyed map into parallel dates/values arrays', () => {
  const out = _test.assembleSeries({ '2026-06-01': 1415557, '2026-07-01': 1502072 }, 1 / 1000);
  assert.deepEqual(out.dates, ['2026-06-01', '2026-07-01']);
  assert.deepEqual(out.values, [1415.56, 1502.07]);
  assert.deepEqual(out.latest, { date: '2026-07-01', value: 1502.07 });
});

test('assembleSeries handles an empty map', () => {
  const out = _test.assembleSeries({});
  assert.deepEqual(out, { dates: [], values: [], latest: { date: null, value: null } });
});

test('assembleCftcMarket returns parallel arrays for every direct TFF field', () => {
  const out = _test.assembleCftcMarket({
    '2026-07-07': { long: 100, short: 200, spreading: 30, totalOpenInterest: 1000 },
    '2026-07-14': { long: 110, short: 210, spreading: 40, totalOpenInterest: 1100 },
  });
  assert.deepEqual(out.dates, ['2026-07-07', '2026-07-14']);
  assert.deepEqual(out.long, [100, 110]);
  assert.deepEqual(out.short, [200, 210]);
  assert.deepEqual(out.spreading, [30, 40]);
  assert.deepEqual(out.totalOpenInterest, [1000, 1100]);
  assert.deepEqual(out.latest, {
    date: '2026-07-14',
    long: 110,
    short: 210,
    spreading: 40,
    totalOpenInterest: 1100,
  });
});

test('assembleEtf sums only long/bull leveraged funds and carries each forward through its own gaps', () => {
  const history = {
    etf: {
      TQQQ: { '2026-07-16': 30e9, '2026-07-17': 31e9 },
      UPRO: { '2026-07-16': 5e9 }, // no 07-17 point — should carry forward
    },
  };
  const out = _test.assembleEtf(history);
  assert.deepEqual(out.dates, ['2026-07-16', '2026-07-17']);
  assert.equal(out.total[0], 35); // (30+5)e9 -> 35B
  assert.equal(out.total[1], 36); // 31 + carried 5 -> 36B
  assert.equal(out.fundsDate, '2026-07-17');
  const tqqq = out.funds.find(f => f.key === 'TQQQ');
  assert.equal(tqqq.aum, 31);
});

test('assembleEtf omits funds that never reported any figure', () => {
  const out = _test.assembleEtf({ etf: { TQQQ: { '2026-07-17': 31e9 } } });
  assert.deepEqual(out.funds.map(f => f.key), ['TQQQ']);
});
