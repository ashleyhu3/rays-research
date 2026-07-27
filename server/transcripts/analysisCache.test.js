'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildAnalysisSnapshot } = require('./analysisCache');

function enrichment(quarter, confidence) {
  const period = `2026${quarter}`;
  return {
    ticker: 'ACME',
    quarter,
    year: 2026,
    fiscal_period: period,
    analysisCompletedAt: '2026-07-01T00:00:00.000Z',
    toneSummary: { chunks: 1, llmInterpreted: 1 },
    chunks: [{
      id: `${period}-capex`,
      ticker: 'ACME',
      quarter,
      year: 2026,
      fiscal_period: period,
      text: `CapEx confidence was ${confidence}.`,
      topics: ['CapEx'],
      speaker: 'CFO',
      role: 'Management',
      kind: 'answer',
      tone: {
        composite: { score: 0.5, investorConfidence: confidence, label: 'Confident' },
      },
    }],
    facts: [],
    keyFigures: [{
      id: `${period}-figure`,
      keyword: 'CapEx',
      label: 'Capital expenditures',
      current: `$${confidence}B`,
    }],
  };
}

test('cached snapshots contain the complete UI payload without external analysis', async () => {
  const snapshot = await buildAnalysisSnapshot([
    enrichment('Q1', 60),
    enrichment('Q2', 75),
  ], 'cross-quarter');

  assert.equal(snapshot.type, 'cross-quarter');
  assert.deepEqual(snapshot.periods, ['2026Q1', '2026Q2']);
  assert.equal(snapshot.analysis.summary.documentCount, 2);
  assert.equal(snapshot.reports[0].coverage.periods.length, 2);
  assert.equal(snapshot.keyFigures.length, 2);
  assert.equal(snapshot.toneByRole[1].investor, 75);
  assert.equal(snapshot.modelUsage.llmInterpreted, 2);
});
