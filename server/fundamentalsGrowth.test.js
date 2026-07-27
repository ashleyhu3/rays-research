'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  computeGrowth,
  fiscalQuarterLabel,
  growth,
  reportsFromSecCompanyFacts,
} = require('./fundamentalsGrowth');

test('a fiscal period is labelled by the calendar quarter it actually covers', () => {
  // NVDA's quarter ending Jan 31 spans Nov–Jan, so it belongs in Q4, not Q1.
  assert.equal(fiscalQuarterLabel('2026-01-31'), '2025 Q4');
  assert.equal(fiscalQuarterLabel('2026-04-30'), '2026 Q1');
  assert.equal(fiscalQuarterLabel('2025-10-31'), '2025 Q3');
  // Calendar-aligned reporters land on their own quarter.
  assert.equal(fiscalQuarterLabel('2026-06-30'), '2026 Q2');
  assert.equal(fiscalQuarterLabel('2026-03-31'), '2026 Q1');
  // AMAT-style late-July close still reads as Q2.
  assert.equal(fiscalQuarterLabel('2026-07-27'), '2026 Q2');
  assert.equal(fiscalQuarterLabel(''), null);
  assert.equal(fiscalQuarterLabel(undefined), null);
});

test('growth off a non-positive base is null, not a sign-flipped percentage', () => {
  assert.equal(growth(150, 100), 0.5);
  assert.equal(growth(50, 100), -0.5);
  // A loss narrowing from -1000 to -500 is a 50% improvement but arithmetic
  // says -50%; refusing to answer beats printing the wrong sign.
  assert.equal(growth(-500, -1000), null);
  assert.equal(growth(500, 0), null);
  assert.equal(growth(500, null), null);
  assert.equal(growth(null, 500), null);
});

test('YoY compares against the ticker own quarter four periods back', () => {
  const reports = [
    { periodEnd: '2025-03-31', revenue: 100, netIncome: 10 },
    { periodEnd: '2025-06-30', revenue: 110, netIncome: 11 },
    { periodEnd: '2025-09-30', revenue: 120, netIncome: 12 },
    { periodEnd: '2025-12-31', revenue: 130, netIncome: 13 },
    { periodEnd: '2026-03-31', revenue: 200, netIncome: 30 },
  ];
  const quarters = computeGrowth(reports);

  const q = quarters['2026 Q1'];
  assert.equal(q.periodEnd, '2026-03-31');
  assert.equal(q.revenueYoY, 1); // 200 vs 100 a year earlier
  assert.ok(Math.abs(q.revenueQoQ - (200 / 130 - 1)) < 1e-12);
  assert.ok(Math.abs(q.netIncomeYoY - 2) < 1e-12);
  assert.ok(Math.abs(q.netIncomeQoQ - (30 / 13 - 1)) < 1e-12);

  // The oldest quarter has neither a prior quarter nor a prior year.
  assert.equal(quarters['2025 Q1'].revenueQoQ, null);
  assert.equal(quarters['2025 Q1'].revenueYoY, null);
  // The second quarter has QoQ but still no YoY base.
  assert.ok(Math.abs(quarters['2025 Q2'].revenueQoQ - 0.1) < 1e-12);
  assert.equal(quarters['2025 Q2'].revenueYoY, null);
});

test('a gap in the filing sequence suppresses YoY instead of comparing the wrong period', () => {
  // Four periods back is two years back here, not one. QoQ still holds.
  const reports = [
    { periodEnd: '2023-03-31', revenue: 100, netIncome: 10 },
    { periodEnd: '2023-06-30', revenue: 110, netIncome: 11 },
    { periodEnd: '2024-09-30', revenue: 120, netIncome: 12 },
    { periodEnd: '2024-12-31', revenue: 130, netIncome: 13 },
    { periodEnd: '2025-03-31', revenue: 200, netIncome: 30 },
  ];
  const quarters = computeGrowth(reports);

  assert.equal(quarters['2025 Q1'].revenueYoY, null);
  assert.ok(Math.abs(quarters['2025 Q1'].revenueQoQ - (200 / 130 - 1)) < 1e-12);
});

test('an off-cycle reporter keeps four distinct labels per year', () => {
  // NVDA fiscal calendar: Apr / Jul / Oct / Jan closes.
  const reports = [
    { periodEnd: '2025-04-30', revenue: 44062, netIncome: 18775 },
    { periodEnd: '2025-07-31', revenue: 46743, netIncome: 26422 },
    { periodEnd: '2025-10-31', revenue: 57006, netIncome: 31910 },
    { periodEnd: '2026-01-31', revenue: 65000, netIncome: 36000 },
    { periodEnd: '2026-04-30', revenue: 81615, netIncome: 58321 },
  ];
  const quarters = computeGrowth(reports);

  assert.deepEqual(
    Object.keys(quarters).sort(),
    ['2025 Q1', '2025 Q2', '2025 Q3', '2025 Q4', '2026 Q1'],
  );
  // Real NVDA numbers: Apr-2026 revenue vs Apr-2025 is ~+85%.
  assert.ok(Math.abs(quarters['2026 Q1'].revenueYoY - (81615 / 44062 - 1)) < 1e-12);
});

test('SEC facts keep discrete 10-Q values and derive the fourth quarter from the 10-K', () => {
  const fact = (start, end, val, form, filed) => ({ start, end, val, form, filed });
  const body = {
    facts: {
      'us-gaap': {
        RevenueFromContractWithCustomerExcludingAssessedTax: {
          units: {
            USD: [
              fact('2024-01-01', '2024-03-31', 100, '10-Q', '2024-05-01'),
              // The six-month YTD fact must not be mistaken for Q2.
              fact('2024-01-01', '2024-06-30', 220, '10-Q', '2024-08-01'),
              fact('2024-04-01', '2024-06-30', 120, '10-Q', '2024-08-01'),
              fact('2024-01-01', '2024-09-30', 350, '10-Q', '2024-11-01'),
              fact('2024-07-01', '2024-09-30', 130, '10-Q', '2024-11-01'),
              fact('2024-01-01', '2024-12-31', 500, '10-K', '2025-02-01'),
            ],
          },
        },
        NetIncomeLoss: {
          units: {
            USD: [
              fact('2024-01-01', '2024-03-31', 10, '10-Q', '2024-05-01'),
              fact('2024-04-01', '2024-06-30', 20, '10-Q', '2024-08-01'),
              fact('2024-07-01', '2024-09-30', 30, '10-Q', '2024-11-01'),
              fact('2024-01-01', '2024-12-31', 100, '10-K', '2025-02-01'),
            ],
          },
        },
      },
    },
  };

  assert.deepEqual(reportsFromSecCompanyFacts(body), [
    { periodEnd: '2024-03-31', revenue: 100, netIncome: 10 },
    { periodEnd: '2024-06-30', revenue: 120, netIncome: 20 },
    { periodEnd: '2024-09-30', revenue: 130, netIncome: 30 },
    { periodEnd: '2024-12-31', revenue: 150, netIncome: 40 },
  ]);
});
