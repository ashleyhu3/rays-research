'use strict';

// One-time migration for transcripts completed before cached analysis snapshots
// were introduced. It derives individual and cross-quarter views exclusively
// from already-enriched Mongo data; it does not call transcript providers,
// FinBERT, or an LLM.
const { listLocalEnrichments } = require('../transcripts/enrichmentStore');
const { refreshAnalysisCacheForTicker } = require('../transcripts/analysisCache');

async function main() {
  const requestedTicker = String(process.argv[2] || '').toUpperCase();
  const enrichments = (await listLocalEnrichments()).filter(item => item.analysisCompletedAt);
  const tickers = [...new Set(enrichments.map(item => item.ticker))]
    .filter(Boolean)
    .filter(ticker => !requestedTicker || ticker === requestedTicker)
    .sort();

  for (const ticker of tickers) {
    const result = await refreshAnalysisCacheForTicker(ticker);
    console.log(`${ticker}: cached ${result.transcriptCount} transcript(s); cross-quarter=${result.crossQuarter}`);
  }
}

main().catch(error => {
  console.error('[transcript-cache] fatal:', error.message);
  process.exit(1);
});
