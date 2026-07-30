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
    `<tr class='row1'>\n<td align='left' nowrap><a href="/index/${code}.php">x</a></td>\n<td nowrap>${value}</td>\n`
    + `<td nowrap>-1.00</td>\n<td nowrap>-0.1%</td>\n<td nowrap align=center>${date}</td>\n</tr>`;
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
  const html = `<tr class='row1'>\n<td align='left' nowrap><a href="/index/BDI.php">x</a></td>\n<td nowrap>1900.00</td>\n`
    + `<td nowrap>1.00</td>\n<td nowrap>0.1%</td>\n<td nowrap align=center>12/31</td>\n</tr>`;
  assert.deepEqual(_test.parseStockqDailyPage(html, '2026-01-05'), { '2025-12-31': { bdi: 1900 } });
});

test('reads the freight board despite its extra range columns', () => {
  // The live board carries 8 columns between the close and the as-of date,
  // where the per-session archive pages carry 2.
  const html = `<tr class='row2'>
<td align='left' nowrap><a href="/index/BCTI.php">波羅的海-成品油油輪</a></td>
<td nowrap>1453.00</td>
<td nowrap class="changeup">22.00</td>
<td nowrap class="changeup">1.54%</td>
<td nowrap>-</td>
<td nowrap>-</td>
<td nowrap>-</td>
<td nowrap class="changeup">91.94%</td>
<td nowrap align=center>07/29</td>
</tr>
<tr class='row1'>
<td align='left' nowrap><a href="/index/VIX.php">VIX波動率</a></td>
<td nowrap>20.66</td>
<td nowrap align=center>07/29</td>
</tr>`;
  // VIX is on the same board but is not one of ours, so it must be ignored.
  assert.deepEqual(_test.parseStockqBoard(html, '2026-07-29'), {
    '2026-07-29': { bcti: 1453 },
  });
});

test('counts pending weekday sessions so a weekend does not force a bigger fetch', () => {
  const iso = offsetDays => {
    const date = new Date();
    date.setUTCHours(0, 0, 0, 0);
    date.setUTCDate(date.getUTCDate() - offsetDays);
    return date.toISOString().slice(0, 10);
  };
  assert.equal(_test.pendingSessions(iso(0)), 0);
  assert.equal(_test.pendingSessions(null), Infinity);
  // Whatever today is, yesterday leaves at most one weekday outstanding.
  assert.ok(_test.pendingSessions(iso(1)) <= 1);
  // A fortnight back always leaves more than one session pending.
  assert.ok(_test.pendingSessions(iso(14)) > 1);
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

test('finds the latest stored date per series, ignoring other series and bookkeeping keys', () => {
  const history = {
    '2026-07-27': { bdi: 2696, bdti: 2582 },
    '2026-07-29': { bdi: 2632 },
    _updatedAt: '2026-07-30T00:00:00.000Z',
    'not-a-date': { bdi: 1 },
  };
  assert.equal(_test.latestDateFor(history, 'bdi'), '2026-07-29');
  // bdti stops earlier, so its window must be chosen from its own last print.
  assert.equal(_test.latestDateFor(history, 'bdti'), '2026-07-27');
  assert.equal(_test.latestDateFor(history, 'ccfi'), null);
  assert.equal(_test.latestDateFor({}, 'bdi'), null);
});

test('treats a missing or unparseable date as infinitely stale', () => {
  assert.equal(_test.daysSince(null), Infinity);
  assert.equal(_test.daysSince('nonsense'), Infinity);
  const today = new Date().toISOString().slice(0, 10);
  assert.equal(_test.daysSince(today), 0);
});

test('asks Trading Economics for the shortest span that still overlaps stored history', () => {
  const meta = { deepSpans: ['10y', '3y'] };
  // Already holding today's print: a week is the smallest window on offer.
  assert.deepEqual(_test.teSpansFor(meta, 0), ['1w']);
  // Any real gap plus the 7-day margin outgrows a week, so it steps up to a
  // month rather than risk a window that stops short of the stored history.
  assert.deepEqual(_test.teSpansFor(meta, 1), ['1m']);
  assert.deepEqual(_test.teSpansFor(meta, 10), ['1m']);
  assert.deepEqual(_test.teSpansFor(meta, 40), ['3m']);
  assert.deepEqual(_test.teSpansFor(meta, 300), ['1y']);
  // Nothing stored, or staler than the ladder reaches → full seed.
  assert.deepEqual(_test.teSpansFor(meta, Infinity), ['10y', '3y']);
  assert.deepEqual(_test.teSpansFor(meta, 5000), ['10y', '3y']);
});

test('folds per-series values into date-keyed patches', () => {
  assert.deepEqual(
    _test.toPatches({ bdi: { '2026-07-28': 2664, bad: 1 }, bci: { '2026-07-28': 4140 } }),
    { '2026-07-28': { bdi: 2664, bci: 4140 } },
  );
});
