'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { findQaStart, transcriptFromResponse } = require('./alphavantage');

const sample = {
  symbol: 'MSFT',
  quarter: '2026Q3',
  transcript: [
    { speaker: 'Operator', title: 'Operator', content: 'Welcome. A question-and-answer session will follow the formal presentation.' },
    { speaker: 'Brett Iversen', title: 'VP, Investor Relations', content: 'Welcome to the call.', sentiment: '0.2' },
    { speaker: 'Satya Nadella', title: 'CEO', content: 'We had a strong quarter.', sentiment: '0.7' },
    { speaker: 'Operator', title: 'Operator', content: 'Our first question comes from Keith Weiss.' },
    { speaker: 'Keith Weiss', title: 'Analyst', content: 'What drove Azure growth?' },
    { speaker: 'Amy Hood', title: 'CFO', content: 'Demand remained healthy.' },
  ],
};

test('finds the operator transition immediately before analyst Q&A', () => {
  assert.equal(findQaStart(sample.transcript), 3);
});

test('normalizes Alpha Vantage turns into the shared transcript document', () => {
  const document = transcriptFromResponse(sample, {
    ticker: 'MSFT',
    quarter: 'Q3',
    year: 2026,
  });

  assert.equal(document.fiscal_period, '2026Q3');
  assert.equal(document.metadata.provider, 'alphavantage');
  assert.equal(document.prepared.length, 3);
  assert.equal(document.qa.length, 3);
  assert.equal(document.qa[1].role, 'Analyst');
  assert.equal(document.qa[1].kind, 'question');
  assert.equal(document.qa[2].kind, 'answer');
  assert.equal(document.stats.totalBlocks, 6);
});
