'use strict';

const { semanticChunkDocument } = require('../../server/transcripts/chunker');
const { readEnrichment, saveEnrichment } = require('../../server/transcripts/enrichmentStore');
const { parseTranscriptDocument } = require('../../server/transcripts/parser');
const { saveTranscript } = require('../../server/transcripts/store');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const body = req.body ?? {};
  try {
    const ticker = String(body.ticker || '').toUpperCase().replace(/[^A-Z0-9.-]/g, '');
    const fiscalPeriod = `${String(body.year || '').replace(/\D/g, '')}${String(body.quarter || '').toUpperCase()}`;
    const completed = await readEnrichment(ticker, fiscalPeriod);
    if (completed?.analysisCompletedAt) {
      return res.json({ transcript: completed, enrichment: completed, cached: true });
    }
    const transcript = parseTranscriptDocument({
      ticker: body.ticker,
      quarter: body.quarter,
      year: body.year,
      earnings_date: body.earnings_date,
      transcript: body.text,
      metadata: {
        provider: 'manual',
        collectedAt: new Date().toISOString(),
      },
    });
    const saved = await saveTranscript(transcript);
    const enrichment = semanticChunkDocument(transcript);
    const enrichedStorage = await saveEnrichment(enrichment);
    res.json({ transcript, enrichment, storage: { transcript: saved, enrichment: enrichedStorage } });
  } catch (e) {
    console.error('[transcripts:parse]', e.message);
    res.status(400).json({ error: e.message });
  }
};
