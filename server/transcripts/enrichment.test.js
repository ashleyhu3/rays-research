'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { estimateTokens, semanticChunkDocument } = require('./chunker');
const { classifyTopics } = require('./topics');

test('classifies overlapping specific and product topics deterministically', () => {
  const result = classifyTopics(
    'Azure revenue grew 33% as enterprise AI customers increased demand for inference capacity.',
  );
  assert.equal(result.primaryTopic, 'Cloud Growth');
  assert.equal(result.topics.includes('Azure'), true);
  assert.equal(result.topics.includes('Enterprise AI'), true);
  assert.equal(result.topics.includes('Inference'), true);
  assert.equal(result.topics.includes('Demand'), true);
});

test('distinguishes guidance topics from current-period discussion', () => {
  const result = classifyTopics(
    'We expect capital expenditures to increase next quarter as we build additional data centers.',
  );
  assert.equal(result.primaryTopic, 'CapEx Guidance');
  assert.equal(result.topics.includes('CapEx'), true);
  assert.equal(result.topics.includes('Datacenter'), true);
});

test('semantic chunks preserve source metadata and split on topic changes', () => {
  const aiText = Array(8).fill(
    'Azure AI revenue grew as enterprise customers deployed more inference workloads.',
  ).join(' ');
  const marginText = Array(8).fill(
    'Gross margin declined because pricing and energy costs increased.',
  ).join(' ');
  const document = {
    ticker: 'MSFT',
    quarter: 'Q3',
    year: 2026,
    fiscal_period: '2026Q3',
    metadata: { provider: 'alphavantage' },
    stats: { totalBlocks: 1 },
    speaker_blocks: [{
      id: 1,
      speaker: 'Amy Hood',
      title: 'Chief Financial Officer',
      role: 'Management',
      section: 'prepared',
      kind: 'remark',
      timestamp: null,
      text: `${aiText} ${marginText}`,
    }],
  };

  const enrichment = semanticChunkDocument(document);
  assert.equal(enrichment.chunks.length >= 2, true);
  assert.equal(enrichment.chunks[0].ticker, 'MSFT');
  assert.equal(enrichment.chunks[0].speaker, 'Amy Hood');
  assert.equal(enrichment.chunks.some(chunk => chunk.topics.includes('Margins')), true);
  assert.equal(enrichment.chunks.every(chunk => chunk.tokenCount === estimateTokens(chunk.text)), true);
});
