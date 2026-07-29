'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { _test } = require('./koreaInvestorFlow');

// One real row lifted from the source, verbatim (2026-07-29), plus the two-level
// header it sits under — the header is why columns are read positionally, so a
// fixture without it would not exercise the thing that can break.
const ROW_2026_07_29 = `
<tr class="udline">
  <th rowspan="2" class="noln">날짜</th>
  <th rowspan="2">개인</th>
  <th rowspan="2">외국인</th>
  <th rowspan="2">기관계</th>
  <th colspan="6" class="eb">기관</th>
  <th rowspan="2">기타법인</th>
</tr>
<tr>
  <td class="date2">26.07.29</td>
  <td class="rate_down3">-19,701</td>
  <td class="rate_down3">-12,337</td>
  <td class="rate_up3">31,604</td>
  <td class="rate_up3">18,397</td>
  <td class="rate_up3">1,260</td>
  <td class="rate_up3">8,639</td>
  <td class="rate_down3">-126</td>
  <td class="rate_up3">53</td>
  <td class="rate_up3">3,381</td>
  <td class="rate_up3">434</td>
</tr>`;

test('parseRows reads the four charted groups off the two-level header, in 조원', () => {
  const rows = _test.parseRows(ROW_2026_07_29);

  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], {
    date: '2026-07-29',
    individual: -1.9701,   // 억원 ÷ 10,000
    foreign: -1.2337,
    institution: 3.1604,   // 기관계, not the 금융투자 subcolumn that follows it
    otherCorp: 0.0434,     // last cell, past the six 기관 subcolumns
  });
});

test('parseRows drops a row whose groups do not net to zero', () => {
  // 기관계 nudged so the row nets to +1조 — the signature of columns having
  // shifted under a markup change, which must not reach the chart as data.
  const broken = ROW_2026_07_29.replace('>31,604<', '>41,604<');

  assert.deepEqual(_test.parseRows(broken), []);
});

test('assemble aligns every series to one sorted date axis', () => {
  const data = _test.assemble({
    '2026-01-05': { individual: 1, foreign: -2, institution: 1.1, otherCorp: -0.1 },
    '2026-01-02': { individual: -3, foreign: 2.5, institution: 0.6, otherCorp: -0.1 },
  });

  assert.deepEqual(data.dates, ['2026-01-02', '2026-01-05']);
  assert.deepEqual(data.individual, [-3, 1]);
  assert.deepEqual(data.foreign, [2.5, -2]);
  assert.equal(data.latest.date, '2026-01-05');
  assert.equal(data.latest.institution, 1.1);
});
