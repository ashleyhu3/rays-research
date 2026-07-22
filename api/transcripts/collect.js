'use strict';

const { collectFromAlphaVantage } = require('../../server/transcripts/alphavantage');
const { collectFromOctagon } = require('../../server/transcripts/octagon');
const { semanticChunkDocument } = require('../../server/transcripts/chunker');
const { saveEnrichment } = require('../../server/transcripts/enrichmentStore');
const { saveTranscript } = require('../../server/transcripts/store');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const secret = process.env.ADMIN_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const body = req.body ?? {};
  try {
    const provider = String(body.provider || 'alphavantage').toLowerCase();
    const collector = provider === 'octagon' ? collectFromOctagon : collectFromAlphaVantage;
    const transcript = await collector({
      ticker: body.ticker,
      quarter: body.quarter,
      year: body.year,
    });
    const saved = await saveTranscript(transcript);
    const enrichment = semanticChunkDocument(transcript);
    const enrichedStorage = await saveEnrichment(enrichment);
    res.json({ transcript, enrichment, storage: { transcript: saved, enrichment: enrichedStorage } });
  } catch (e) {
    const status = e.status === 401 || e.status === 403
      ? 401
      : e.status === 429
      ? 429
      : /required|must be|recognizable|fiscal period/i.test(e.message)
      ? 400
      : 502;
    console.error('[transcripts:collect]', e.message);
    res.status(status).json({ error: e.message });
  }
};
