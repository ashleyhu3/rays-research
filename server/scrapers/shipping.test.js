'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { _test } = require('./shipping');

test('parses the Hormuz monitor throughput feed with transit counts and notes', () => {
  const { rows, annotations } = _test.parseHormuz({
    history: [
      { date: '2026-02-28', percentOfBaseline: 100, note: 'War begins — strait closes' },
      { date: '2026-07-26', percentOfBaseline: 0, vessels: 1 },
      { date: '2026-07-29', percentOfBaseline: 10, vessels: 10 },
      { date: 'not-a-date', percentOfBaseline: 42 },
      { date: '2026-07-30', percentOfBaseline: null },
    ],
    annotations: [
      { date: '2026-02-28', label: 'War begins', color: 'ops-red' },
      { date: 'bad', label: 'ignored' },
    ],
  });
  assert.deepEqual(rows['2026-02-28'], { hormuz: 100, hormuzNote: 'War begins — strait closes' });
  // A full stoppage is a real reading, not a missing one.
  assert.deepEqual(rows['2026-07-26'], { hormuz: 0, hormuzVessels: 1 });
  assert.deepEqual(rows['2026-07-29'], { hormuz: 10, hormuzVessels: 10 });
  assert.deepEqual(Object.keys(rows), ['2026-02-28', '2026-07-26', '2026-07-29']);
  assert.deepEqual(annotations, [{ date: '2026-02-28', label: 'War begins' }]);
});

test('reads closes out of a Trading Economics market payload', () => {
  assert.deepEqual(
    _test.parseTeSeries([[1785110400, 2664, -2.88, -79, 2664, 2664, 2664, 2664], ['x', 1], [1785024000, null]]),
    { '2026-07-27': 2664 },
  );
});

test('parses the rolling session table on a StockQ index page', () => {
  const html = `
    <tr><td>2026/07/28</td><td>2,664.00</td><td>-1.19 %</td>
        <td>2026/07/14</td><td>2980.00</td><td>2.15 %</td></tr>
    <tr><td>2026/07/27</td><td>n/a</td></tr>`;
  assert.deepEqual(_test.parseStockqIndexPage(html), {
    '2026-07-28': 2664,
    '2026-07-14': 2980,
  });
});

test('takes the longest range table out of a StockQ chart data file', () => {
  const table = (name, rows) => `var ${name} = google.visualization.arrayToDataTable([\n`
    + `['Time', 'Price', 'MA20'],\n${rows}\n]);`;
  const parsed = _test.parseStockqChartJs([
    table('data1M', "[new Date('Jul 28, 2026'), 2601.00, 1.0],\n[new Date('Jul 29, 2026'), 2607.00, 1.0],"),
    table('data5Y', "[new Date('Oct 4, 2021'), 727.00, 1.0],\n[new Date('Sep 1, 2023'), 1234.50, 1.0],\n"
      + "[new Date('Jul 28, 2026'), 2601.00, 1.0],\n[new Date('Jul 29, 2026'), 2607.00, 1.0],"),
  ].join('\n'));
  assert.deepEqual(parsed, {
    '2021-10-04': 727,
    '2023-09-01': 1234.5,
    '2026-07-28': 2601,
    '2026-07-29': 2607,
  });
});

test('ignores a chart file with no usable rows', () => {
  assert.deepEqual(_test.parseStockqChartJs('google.charts.load("current");'), {});
  assert.deepEqual(_test.parseStockqChartJs(''), {});
});

test('maps a StockQ daily snapshot onto each index by its own as-of date', () => {
  const row = (code, value, date) =>
    `<td align='left' nowrap><a href="/index/${code}.php">x</a></td>\n<td nowrap>${value}</td>\n`
    + `<td nowrap>-1.00</td>\n<td nowrap>-0.1%</td>\n<td nowrap align=center>${date}</td>`;
  const parsed = _test.parseStockqDailyPage(
    [row('BDI', '2664.00', '07/28'), row('BCI', '4140.00', '07/28'), row('SCFI', '3080.31', '07/17'),
      row('VIX', '18.21', '07/28')].join('\n'),
    '2026-07-28',
  );
  assert.deepEqual(parsed, {
    '2026-07-28': { bdi: 2664, bci: 4140 },
    '2026-07-17': { scfi: 3080.31 },
  });
});

test('rolls a December row on a January snapshot back to the previous year', () => {
  const html = `<td align='left' nowrap><a href="/index/BDI.php">x</a></td>\n<td nowrap>1900.00</td>\n`
    + `<td nowrap>1.00</td>\n<td nowrap>0.1%</td>\n<td nowrap align=center>12/31</td>`;
  assert.deepEqual(_test.parseStockqDailyPage(html, '2026-01-05'), { '2025-12-31': { bdi: 1900 } });
});

test('accepts the shapes the Shanghai Shipping Exchange embeds its index in', () => {
  const tuples = `var d = [["2026-07-10",1102.5],["2026-07-17",1120.31]];`;
  assert.deepEqual(_test.parseSseIndexPage(tuples), { '2026-07-10': 1102.5, '2026-07-17': 1120.31 });

  const objects = `{"indexDate":"2026/07/10","indexValue":"1102.5"},{"indexDate":"2026/07/17","indexValue":"1120.31"}`;
  assert.deepEqual(_test.parseSseIndexPage(objects), { '2026-07-10': 1102.5, '2026-07-17': 1120.31 });

  const paired = `xAxis:{data:["2026-07-03","2026-07-10","2026-07-17","2026-07-24"]},`
    + `series:[{data:[1090.1,1102.5,1120.31,1131.7]}]`;
  assert.deepEqual(_test.parseSseIndexPage(paired), {
    '2026-07-03': 1090.1, '2026-07-10': 1102.5, '2026-07-17': 1120.31, '2026-07-24': 1131.7,
  });

  const table = `<tr><td>2026-07-17</td><td>1,120.31</td></tr>`;
  assert.deepEqual(_test.parseSseIndexPage(table), { '2026-07-17': 1120.31 });

  assert.deepEqual(_test.parseSseIndexPage('<html>no data</html>'), {});
});

test('assembles per-series history and keeps non-date bookkeeping keys out of it', () => {
  const assembled = _test.assemble({
    '2026-07-27': { bdi: 2696, bci: 4200 },
    '2026-07-28': { bdi: 2664, bci: 4140, hormuz: 8, hormuzVessels: 10, hormuzNote: 'Blockade' },
    _updatedAt: '2026-07-29T00:00:00.000Z',
    _errors: { ccfi: 'unreachable' },
    _annotations: [{ date: '2026-07-28', label: 'Blockade reimposed' }],
  });
  assert.deepEqual(assembled.series.bdi.data, [
    { date: '2026-07-27', value: 2696 },
    { date: '2026-07-28', value: 2664 },
  ]);
  assert.deepEqual(assembled.series.hormuz.data, [
    { date: '2026-07-28', value: 8, vessels: 10, note: 'Blockade' },
  ]);
  assert.deepEqual(assembled.series.ccfi.data, []);
  assert.equal(assembled.updatedAt, '2026-07-29T00:00:00.000Z');
  assert.deepEqual(assembled.errors, { ccfi: 'unreachable' });
  assert.equal(assembled.series.bdi.name, 'Baltic Dry Index');
  // Every ordered series has metadata and a group the page can render under.
  const groups = new Set(_test.GROUPS.map(group => group.key));
  for (const id of _test.SERIES_ORDER) {
    assert.ok(assembled.series[id], `missing series ${id}`);
    assert.ok(groups.has(assembled.series[id].group), `series ${id} has no known group`);
  }
});

test('folds per-series values into date-keyed patches', () => {
  assert.deepEqual(
    _test.toPatches({ bdi: { '2026-07-28': 2664, bad: 1 }, bci: { '2026-07-28': 4140 } }),
    { '2026-07-28': { bdi: 2664, bci: 4140 } },
  );
});
