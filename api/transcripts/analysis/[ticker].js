'use strict';

const { readCachedAnalysis } = require('../../../server/transcripts/analysisCache');

module.exports = async function handler(req, res) {
  const ticker = String(req.query.ticker || '').toUpperCase().replace(/[^A-Z0-9.-]/g, '');
  if (!ticker) return res.status(400).json({ error: 'ticker required' });
  try {
    const cached = await readCachedAnalysis(ticker);
    if (!cached) {
      return res.status(404).json({ error: `No analyzed transcripts found for ${ticker}.` });
    }
    if (cached.pendingCache) {
      return res.status(409).json({
        error: `Stored analysis for ${ticker} predates the Mongo cache. Run the cache backfill once.`,
      });
    }
    res.json(cached);
  } catch (e) {
    console.error('[transcripts:analysis]', e.message);
    res.status(500).json({ error: e.message });
  }
};
