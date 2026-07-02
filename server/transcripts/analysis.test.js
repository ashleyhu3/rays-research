'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { extractFacts, extractMetrics } = require('./facts');
const { mergeToneSignals } = require('./tone');

test('extracts typed financial and operating metrics', () => {
  assert.deepEqual(extractMetrics('Revenue grew 29% to $54 billion and capacity reached 2 gigawatts.'), [
    { value: '29%', type: 'percentage' },
    { value: '$54 billion', type: 'currency_or_scale' },
    { value: '2 gigawatts', type: 'capacity' },
  ]);
});

test('extracts traceable forward-looking facts from chunks', () => {
  const result = extractFacts({
    chunks: [{
      id: 'MSFT-2026Q3-b1-c1',
      ticker: 'MSFT',
      quarter: 'Q3',
      year: 2026,
      fiscal_period: '2026Q3',
      speaker: 'Amy Hood',
      title: 'Chief Financial Officer',
      role: 'Management',
      section: 'prepared',
      kind: 'remark',
      sourceBlockId: 1,
      topic: 'CapEx',
      topics: ['CapEx'],
      text: 'We expect capital expenditures to increase next quarter. Azure revenue grew 33%.',
    }],
  });
  assert.equal(result.facts.length, 2);
  assert.equal(result.facts[0].forwardLooking, true);
  assert.equal(result.facts[0].topic, 'CapEx Guidance');
  assert.equal(result.facts[1].metrics[0].value, '33%');
});

test('merges financial, emotion, and LLM tone into investor confidence', () => {
  const result = mergeToneSignals({
    finbert: { score: 0.8 },
    emotion: { scores: { joy: 0.7, neutral: 0.2, fear: 0.1 } },
    llm: { stance: 'confident', score: 0.8 },
  });
  assert.equal(result.investorConfidence > 70, true);
  assert.equal(result.label, 'Highly confident');
  assert.equal(result.weights.llm, 0.3);
});
