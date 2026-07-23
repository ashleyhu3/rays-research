'use strict';

const { saveEnrichment, loadEnrichmentsForRun } = require('../transcripts/enrichmentStore');
const { extractFacts } = require('../transcripts/facts');
const { attachCompositeTone } = require('../transcripts/tone');

// Optional --ticker/--period scope one run to a single transcript (read locally).
const argValue = name => {
  const index = process.argv.indexOf(name);
  return index !== -1 ? (process.argv[index + 1] || '') : null;
};
const RUN_TICKER = (argValue('--ticker') || '').toUpperCase() || null;
const RUN_PERIOD = (argValue('--period') || '').toUpperCase() || null;

async function main() {
  const enrichments = (await loadEnrichmentsForRun({ ticker: RUN_TICKER, period: RUN_PERIOD }))
    .sort((a, b) => `${a.ticker}:${a.fiscal_period}`.localeCompare(`${b.ticker}:${b.fiscal_period}`));
  let total = 0;

  for (const enrichment of enrichments) {
    attachCompositeTone(enrichment);
    const { facts, factSummary } = extractFacts(enrichment);
    enrichment.facts = facts;
    enrichment.factSummary = factSummary;
    enrichment.analyzedAt = new Date().toISOString();
    const storage = await saveEnrichment(enrichment);
    total += facts.length;
    console.log(
      `[facts] ${enrichment.ticker}:${enrichment.fiscal_period} `
      + `${facts.length} facts, ${factSummary.highConfidence} high confidence, `
      + `${factSummary.forwardLooking} forward-looking, mongo=${storage.mongoStored}`,
    );
  }
  console.log(`[facts] complete: ${enrichments.length} transcripts, ${total} facts`);
}

main().catch(error => {
  console.error('[facts] fatal:', error.message);
  process.exit(1);
});
