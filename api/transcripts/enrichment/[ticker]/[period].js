'use strict';

const { readEnrichment } = require('../../../../server/transcripts/enrichmentStore');

module.exports = async function handler(req, res) {  // eslint-disable-line require-await
  const ticker = String(req.query.ticker || '').toUpperCase().replace(/[^A-Z0-9.-]/g, '');
  const period = String(req.query.period || '').toUpperCase().replace(/[^0-9Q]/g, '');
  const enrichment = await readEnrichment(ticker, period);
  if (!enrichment) return res.status(404).json({ error: `No enrichment found for ${ticker} ${period}.` });
  res.json(enrichment);
};
