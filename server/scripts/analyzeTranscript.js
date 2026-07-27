'use strict';

// CLI wrapper around the full transcript pipeline, used by the analyze-transcript
// GitHub Action. Runs collect → FinBERT → LLM tone → facts → figures → publish
// for one transcript and prints progress as it goes.
//
//   node server/scripts/analyzeTranscript.js --ticker GOOGL --quarter Q2 --year 2026
//   node server/scripts/analyzeTranscript.js --ticker ACME --quarter Q2 --year 2026 --source stored
//
// Env: ALPHA_VANTAGE_API_KEY, GROQ_API_KEY and/or GEMINI_API_KEY, MONGODB_URI,
// and TRANSCRIPT_PYTHON (interpreter with torch + transformers for FinBERT).
const { runFullPipeline } = require('../transcripts/pipeline');
const { closeMongoConnection } = require('../transcripts/enrichmentStore');

const argValue = name => {
  const index = process.argv.indexOf(name);
  return index !== -1 ? (process.argv[index + 1] || '') : null;
};

async function main() {
  const ticker = (argValue('--ticker') || '').toUpperCase();
  const quarter = (argValue('--quarter') || '').toUpperCase();
  const year = argValue('--year');
  const source = argValue('--source') || 'auto';
  if (!ticker || !quarter || !year) {
    throw new Error('Usage: analyzeTranscript.js --ticker GOOGL --quarter Q2 --year 2026');
  }

  await runFullPipeline({ ticker, quarter, year, source }, event => {
    if (event.status === 'log') {
      console.log(`  ${event.message}`);
    } else if (event.stage === 'done') {
      console.log(`✓ done — ${event.ticker} ${event.period}`);
    } else {
      const label = event.status === 'done' ? '✓' : '▶';
      console.log(`${label} [${event.stage}] ${event.message || event.status}`);
    }
  });
}

main()
  .catch(error => {
    console.error('[analyze] fatal:', error.message);
    process.exitCode = 1;
  })
  .finally(closeMongoConnection);
