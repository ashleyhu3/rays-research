'use strict';

/**
 * Publish every locally analyzed transcript + enrichment to MongoDB, so the
 * deployed site (which reads only from Mongo) shows them.
 *
 * Because server/data/ is gitignored, transcripts analyzed on a dev machine
 * never reach production unless they are pushed to Mongo. Run this once after
 * `npm run analyze:transcripts`, with MONGODB_URI set:
 *
 *   node --env-file=.env server/scripts/publishTranscriptsToMongo.js
 */

const fs = require('fs');
const path = require('path');
const { saveEnrichment } = require('../transcripts/enrichmentStore');
const { readLocalLibrary, saveTranscript } = require('../transcripts/store');

const PROCESSED_ROOT = path.join(__dirname, '..', 'data', 'transcripts', 'processed');

async function main() {
  if (!process.env.MONGODB_URI) {
    throw new Error('MONGODB_URI is not set — add it to .env before publishing.');
  }

  // 1. Normalized transcripts → normalized_transcripts (feeds the library).
  // readLocalLibrary() scans every subdir of data/transcripts, including the
  // processed/ enrichment dir — keep only real normalized transcripts (which
  // carry prepared/qa blocks) so enrichment docs don't pollute the collection.
  const library = readLocalLibrary().filter(item => Array.isArray(item.transcript?.prepared));
  let transcriptsStored = 0;
  for (const item of library) {
    const storage = await saveTranscript(item.transcript);
    if (storage.mongoStored) transcriptsStored += 1;
    console.log(`[publish] transcript ${item.ticker}:${item.fiscal_period} mongo=${storage.mongoStored}`);
  }

  // 2. Enrichments (summary + chunks + facts) → transcript_* collections.
  let enrichmentsStored = 0;
  if (fs.existsSync(PROCESSED_ROOT)) {
    for (const entry of fs.readdirSync(PROCESSED_ROOT, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const directory = path.join(PROCESSED_ROOT, entry.name);
      for (const file of fs.readdirSync(directory).filter(name => name.endsWith('.json'))) {
        const enrichment = JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8'));
        const storage = await saveEnrichment(enrichment);
        if (storage.mongoStored) enrichmentsStored += 1;
        console.log(
          `[publish] enrichment ${enrichment.ticker}:${enrichment.fiscal_period} `
          + `(${enrichment.chunks?.length || 0} chunks, ${enrichment.facts?.length || 0} facts, `
          + `${enrichment.keyFigures?.length || 0} figures) mongo=${storage.mongoStored}`,
        );
      }
    }
  }

  console.log(`\n[publish] done: ${transcriptsStored}/${library.length} transcripts, ${enrichmentsStored} enrichments written to Mongo`);
}

main().catch(error => {
  console.error('[publish] fatal:', error.message);
  process.exit(1);
});
