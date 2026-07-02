'use strict';

/**
 * Run stages 3 and 5 for every locally normalized transcript:
 * semantic chunking plus deterministic topic classification.
 *
 * Usage:
 *   node --env-file=.env server/scripts/enrichTranscripts.js
 */

const { semanticChunkDocument } = require('../transcripts/chunker');
const { saveEnrichment } = require('../transcripts/enrichmentStore');
const { readLocalLibrary } = require('../transcripts/store');

async function main() {
  const documents = readLocalLibrary()
    .filter(item => item.metadata?.provider === 'alphavantage')
    .map(item => item.transcript)
    .sort((a, b) => `${a.ticker}:${a.fiscal_period}`.localeCompare(`${b.ticker}:${b.fiscal_period}`));

  if (!documents.length) throw new Error('No normalized Alpha Vantage transcripts were found.');

  let chunks = 0;
  for (const document of documents) {
    const enrichment = semanticChunkDocument(document);
    const storage = await saveEnrichment(enrichment);
    chunks += enrichment.stats.chunks;
    console.log(
      `[enrich] ${document.ticker}:${document.fiscal_period} `
      + `${enrichment.stats.sourceBlocks} blocks → ${enrichment.stats.chunks} chunks, `
      + `${enrichment.stats.topics} topics, mongo=${storage.mongoStored}`,
    );
  }
  console.log(`[enrich] complete: ${documents.length} transcripts, ${chunks} semantic chunks`);
}

main().catch(error => {
  console.error('[enrich] fatal:', error.message);
  process.exit(1);
});
