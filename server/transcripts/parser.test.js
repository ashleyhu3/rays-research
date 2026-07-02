'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizePeriod, parseTranscriptDocument } = require('./parser');
const { parseJsonContent, responseText } = require('./octagon');

test('normalizes fiscal period inputs', () => {
  assert.deepEqual(normalizePeriod('Q3', 2026), {
    year: 2026,
    quarter: 'Q3',
    fiscalPeriod: '2026Q3',
  });
  assert.deepEqual(normalizePeriod('2025Q4'), {
    year: 2025,
    quarter: 'Q4',
    fiscalPeriod: '2025Q4',
  });
});

test('splits prepared remarks and Q&A into metadata-rich blocks', () => {
  const document = parseTranscriptDocument({
    ticker: 'GOOGL',
    quarter: 'Q1',
    year: 2026,
    earnings_date: '2026-04-25',
    transcript: `
Prepared Remarks

Sundar Pichai -- Chief Executive Officer
We delivered another strong quarter.

Ruth Porat -- President and Chief Investment Officer
[00:12:04] Capital expenditures were $18 billion.

Question-and-Answer Session

Mark Mahaney -- Evercore ISI Analyst
How should we think about AI monetization?

Sundar Pichai -- Chief Executive Officer
We are seeing strong adoption across Gemini products.
`,
  });

  assert.equal(document.fiscal_period, '2026Q1');
  assert.equal(document.prepared.length, 2);
  assert.equal(document.qa.length, 2);
  assert.equal(document.qa[0].role, 'Analyst');
  assert.equal(document.qa[0].kind, 'question');
  assert.equal(document.qa[1].kind, 'answer');
  assert.equal(document.prepared[1].timestamp, '00:12:04');
  assert.equal(document.speaker_blocks.every(block => block.company === 'GOOGL'), true);
});

test('accepts already structured Octagon sections without an LLM pass', () => {
  const document = parseTranscriptDocument({
    ticker: 'MSFT',
    quarter: 'Q2',
    year: 2026,
    speakers: [{ name: 'Amy Hood', title: 'Chief Financial Officer' }],
    prepared: [{ speaker: 'Amy Hood', text: 'Cloud revenue grew 24%.' }],
    qa: [{ speaker: 'Keith Weiss', title: 'Morgan Stanley Analyst', text: 'What drove Azure growth?' }],
  });

  assert.equal(document.stats.totalBlocks, 2);
  assert.equal(document.prepared[0].role, 'Management');
  assert.equal(document.qa[0].role, 'Analyst');
});

test('extracts text from the Octagon Responses API envelope', () => {
  const content = '{"ticker":"MSFT","quarter":"Q2","year":2026,"prepared":[]}';
  const payload = {
    output: [{ content: [{ type: 'output_text', text: content }] }],
  };
  assert.equal(responseText(payload), content);
  assert.equal(parseJsonContent(responseText(payload)).ticker, 'MSFT');
});
