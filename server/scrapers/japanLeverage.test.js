'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { _test } = require('./japanLeverage');

test('assemble scales the workbook\'s million-yen values into trillion-yen purchases/sales and a value-based ratio', () => {
  const data = _test.assemble({
    '2026-06-26': { sellShares: 498572, sellValue: 1053736, buyShares: 3940572, buyValue: 7016733 },
  });

  assert.equal(data.purchases[0], 7.02);
  assert.equal(data.sales[0], 1.05);
  assert.equal(data.ratio[0], round2(7016733 / 1053736));
  assert.equal(data.latest.date, '2026-06-26');
  assert.equal(data.latest.purchases, 7.02);
});

test('parseCurrentWeeklyWorkbook reads the application date from the title cell and the Total row/value row by the "二市場計" label', () => {
  const rows = [
    ['信用取引現在高（2026/7/10申込み現在）'],
    [],
    [],
    [],
    [],
    [null, '二市場計\nTotal', '株数Shs.', 285874, 4761, 3805847, -64153, 117254, 3462, 1035, -166, 403128, 8223, 3806882, -64319],
    [null, null, '金額Val.', 638322, -605, 6728228, -10871, 157202, 10857, 4000, -2112, 795524, 10252, 6732228, -12983],
  ];
  const XLSX = require('@e965/xlsx');
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const buffer = XLSX.write({ SheetNames: ['レイアウト'], Sheets: { 'レイアウト': sheet } }, { type: 'buffer', bookType: 'xlsx' });

  const result = _test.parseCurrentWeeklyWorkbook(buffer);
  assert.deepEqual(result, {
    day: '2026-07-10', sellShares: 403128, sellValue: 795524, buyShares: 3806882, buyValue: 6732228,
  });
});

test('parseCurrentWeeklyWorkbook returns null when the title cell has no recognizable application date', () => {
  const XLSX = require('@e965/xlsx');
  const sheet = XLSX.utils.aoa_to_sheet([['not a JPX workbook']]);
  const buffer = XLSX.write({ SheetNames: ['Sheet1'], Sheets: { Sheet1: sheet } }, { type: 'buffer', bookType: 'xlsx' });
  assert.equal(_test.parseCurrentWeeklyWorkbook(buffer), null);
});

test('assemble skips a week whose row is missing a value', () => {
  const data = _test.assemble({
    '2026-06-19': { sellShares: 437974, sellValue: 1016129, buyShares: 3915786, buyValue: 6475640 },
    '2026-06-26': { sellShares: 498572, buyShares: 3940572 }, // no sellValue/buyValue
  });

  assert.equal(data.purchases[1], null);
  assert.equal(data.sales[1], null);
  assert.equal(data.ratio[1], null);
  assert.equal(data.latest.purchases, null);
});

test('assemble ignores non-date keys (e.g. a stray blob field)', () => {
  const data = _test.assemble({
    updatedAt: '2026-07-01T00:00:00.000Z',
    '2026-06-26': { sellShares: 498572, sellValue: 1053736, buyShares: 3940572, buyValue: 7016733 },
  });

  assert.deepEqual(data.dates, ['2026-06-26']);
});

test('parseCurrentWeeklyWorkbook reads the recent JPX per-week layout', () => {
  const XLSX = require('@e965/xlsx');
  const aoa = [
    ['信用取引現在高（2026/7/10申込み現在）'],
    [],
    [],
    [],
    [],
    [],
    [null, '二市場計\nTotal', '株数Shs.', null, null, null, null, null, null, null, null, 403128, 8223, 3806882],
    [null, null, '金額Val.', null, null, null, null, null, null, null, null, 795524, 10252, 6732228],
  ];
  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  const book = { SheetNames: ['Sheet1'], Sheets: { Sheet1: sheet } };
  const buffer = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' });

  assert.deepEqual(_test.parseCurrentWeeklyWorkbook(buffer), {
    day: '2026-07-10',
    sellShares: 403128,
    sellValue: 795524,
    buyShares: 3806882,
    buyValue: 6732228,
  });
});

test('parseNomuraCsv reads date + ETF Net Asset (Total) from real column layout, skipping header/description rows', () => {
  const csv = '1570,"NEXT FUNDS ..."\r\n'
    + '"基準日","純資産総額",...\r\n'
    + 'Date,"ETF Net Asset (Total)",...\r\n'
    + '20260716,644135729658,9000000,71570.64\r\n';
  const out = _test.parseNomuraCsv(csv);
  assert.deepEqual(out, { '2026-07-16': 644135729658 });
});

test('parseAmovaCsv reads date + column 10 (ETF Net Asset Total)', () => {
  const csv = 'Date,NAV,Div,Return,NAVdiv,Stock%,Bond%,REIT%,Fut%,Shares,ETF Net Asset (Total)\n'
    + '2026-07-16,136687,0,-0.0561,142041,0.658,0,0,1.343,82411,11264483003\n';
  const out = _test.parseAmovaCsv(csv);
  assert.deepEqual(out, { '2026-07-16': 11264483003 });
});

test('parseRakutenCsv converts 億円 (hundred-millions) to raw yen', () => {
  const csv = '基準日,基準価額(円),純資産総額(億円),分配金(円)\n2026/07/17,7829595,412.14,\n';
  const out = _test.parseRakutenCsv(csv);
  assert.equal(out['2026-07-17'], 412.14 * 1e8);
});

test('parseDaiwaCsv reads date + column 3 (純資産総額) in raw yen', () => {
  const csv = '基準日,基準価額,前日比,純資産総額,直近決算日,直近分配金,分配金再投資基準価額\n'
    + '20260717,282512.00,-18425,4126016286,20260110,0,282512\n';
  const out = _test.parseDaiwaCsv(csv);
  assert.deepEqual(out, { '2026-07-17': 4126016286 });
});

test('parseHkexMultiProductWorkbook locates the requested ticker\'s column group, not the first product\'s', () => {
  const XLSX = require('@e965/xlsx');
  const aoa = [
    ['Trading Information of Leveraged & Inverse Products'],
    [],
    ['Stock Code', null, '7200', null, null, '7262', null, null, '7515'],
    [],
    ['Date (ddmmmyyyy)', null, new Date('2026-07-17'), null, null, new Date('2026-07-17'), null, null, new Date('2026-07-17')],
    [],
    ['Asset Under Management (Hong Kong Units) (Note 7(b))', 'HKD', 3076226869.08, null, 'JPY', 2633237592.68, null, 'JPY', 4908244558.59],
  ];
  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  const book = { SheetNames: ['Report'], Sheets: { Report: sheet } };
  const buffer = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' });

  const result = _test.parseHkexMultiProductWorkbook(buffer, '7262');
  assert.equal(result.day, '2026-07-17');
  assert.equal(result.aum, 2633237592.68); // not 7200's 3076226869.08
});

test('assembleEtf sums the nine products\' JPY AUM into one billions-JPY total, carrying each through its own gaps', () => {
  const data = _test.assembleEtf({
    etf: {
      next1570: { '2026-07-16': { aum: 644135729658 }, '2026-07-17': { aum: 650000000000 } },
      lif1358: { '2026-07-16': { aum: 11264483003 } }, // doesn't report on 07-17
      rakuten1458: { '2026-07-17': { aum: 41214000000 } }, // hasn't started reporting on 07-16
    },
  });

  assert.deepEqual(data.dates, ['2026-07-16', '2026-07-17']);
  assert.equal(data.total[0], round2((644135729658 + 11264483003) / 1e9));
  assert.equal(data.total[1], round2((650000000000 + 11264483003 + 41214000000) / 1e9));
});

test('assembleEtf sorts the fund table by AUM and carries label/market/underlying through', () => {
  const data = _test.assembleEtf({
    etf: {
      next1570: { '2026-07-17': { aum: 644135729658 } },
      ezj: { '2026-07-17': { aum: 2000000000 } },
    },
  });

  assert.deepEqual(data.funds.map(f => f.key), ['next1570', 'ezj']);
  const ezj = data.funds.find(f => f.key === 'ezj');
  assert.equal(ezj.market, 'United States');
  assert.equal(ezj.underlying, 'MSCI Japan');
});

function round2(v) { return Math.round(v * 100) / 100; }
