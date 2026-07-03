'use strict';

const { listLocalEnrichments } = require('../../../server/transcripts/enrichmentStore');

module.exports = async function handler(req, res) {
  const ticker = String(req.query.ticker || '').toUpperCase().replace(/[^A-Z0-9.-]/g, '');
  if (!ticker) return res.status(400).json({ error: 'ticker required' });
  try {
    const enrichments = (await listLocalEnrichments()).filter(
      enrichment => String(enrichment.ticker || enrichment.symbol || '').toUpperCase() === ticker,
    );
    if (!enrichments.length) {
      return res.status(404).json({ error: `No analyzed transcripts found for ${ticker}.` });
    }

    const { runTranscriptManager } = await import('../../../server/transcripts/manager.mjs');
    const result = await runTranscriptManager({ documents: enrichments });
    const totalChunks = enrichments.reduce(
      (sum, enrichment) => sum + (enrichment.toneSummary?.chunks || enrichment.stats?.chunks || 0),
      0,
    );
    const llmInterpreted = enrichments.reduce(
      (sum, enrichment) => sum + (enrichment.toneSummary?.llmInterpreted || 0),
      0,
    );
    res.json({
      ticker,
      analysis: result.analysis,
      reports: result.reports,
      execution: result.events,
      modelUsage: {
        deterministicPipeline: true,
        totalChunks,
        llmInterpreted,
        llmShare: totalChunks ? Number((llmInterpreted / totalChunks).toFixed(4)) : 0,
        scope: 'Optional qualitative tone interpretation on selected management answers only.',
      },
    });
  } catch (e) {
    console.error('[transcripts:analysis]', e.message);
    res.status(500).json({ error: e.message });
  }
};
