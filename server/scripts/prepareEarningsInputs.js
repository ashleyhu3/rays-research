'use strict';

// Stage the source materials the earnings-review skill expects to find under
// research/{TICKER}/, so a GitHub runner (which checks out a repo with no research/
// tree at all) starts from the same place a local run does.
//
//   node server/scripts/prepareEarningsInputs.js --ticker GOOGL --quarter Q2 --year 2026
//
// The transcript comes from whatever already exists — a Mongo normalized_transcripts
// doc, a local collector file, or a transcript the user pasted through
// POST /api/transcripts/parse — and only falls back to a fresh Alpha Vantage fetch when
// none of those has it. Exits non-zero when no transcript can be obtained, so the
// workflow fails before spending skill turns on a call it can't read.
//
// Env: ALPHA_VANTAGE_API_KEY (fetch path), MONGODB_URI (stored path).

const fs = require('fs');
const path = require('path');

const { collectFromAlphaVantage } = require('../transcripts/alphavantage');
const { readTranscript, saveTranscript, transcriptMarkdown } = require('../transcripts/store');

const RESEARCH_ROOT = path.join(__dirname, '..', '..', 'research');

const argValue = name => {
  const index = process.argv.indexOf(name);
  return index !== -1 ? (process.argv[index + 1] || '') : null;
};

// research/{TICKER}/ER+Conf, ER_File and Earnings_Review are the three directories the
// skill's input-discovery table globs. Create all of them even when only the transcript
// is staged: an existing-but-empty ER_File tells the skill to go fetch the release
// itself, and Earnings_Review is where it writes its output.
function ensureResearchTree(ticker) {
  const root = path.join(RESEARCH_ROOT, ticker);
  const dirs = {
    root,
    transcript: path.join(root, 'ER+Conf'),
    release: path.join(root, 'ER_File'),
    output: path.join(root, 'Earnings_Review'),
  };
  for (const dir of Object.values(dirs)) fs.mkdirSync(dir, { recursive: true });
  return dirs;
}

async function main() {
  const ticker = (argValue('--ticker') || '').toUpperCase().replace(/[^A-Z0-9.-]/g, '');
  const quarter = (argValue('--quarter') || '').toUpperCase().replace(/[^0-9Q]/g, '');
  const year = (argValue('--year') || '').replace(/[^0-9]/g, '');
  if (!ticker || !/^Q[1-4]$/.test(quarter) || !/^\d{4}$/.test(year)) {
    throw new Error('Usage: prepareEarningsInputs.js --ticker GOOGL --quarter Q2 --year 2026');
  }
  const period = `${year}${quarter}`;

  let document = await readTranscript(ticker, period);
  if (document) {
    console.log(`[prepare] using stored transcript for ${ticker} ${period} (provider: ${document.metadata?.provider || 'unknown'})`);
  } else {
    console.log(`[prepare] no stored transcript for ${ticker} ${period} — fetching from Alpha Vantage`);
    document = await collectFromAlphaVantage({ ticker, quarter, year });
    const storage = await saveTranscript(document);
    console.log(`[prepare] collected and saved (mongo: ${storage.mongoStored})`);
  }

  // A transcript with no Q&A is almost always Alpha Vantage returning an empty or
  // truncated document rather than a call that genuinely had none — the skill's
  // coverage gate can't run against that, so fail here instead of downstream.
  if (!document.prepared?.length && !document.qa?.length) {
    throw new Error(`Transcript for ${ticker} ${period} has no prepared remarks or Q&A — nothing to review.`);
  }

  const dirs = ensureResearchTree(ticker);
  const transcriptPath = path.join(dirs.transcript, `${ticker}_${period}_earnings_call_transcript.md`);
  fs.writeFileSync(transcriptPath, transcriptMarkdown(document));

  const relative = target => path.relative(path.join(__dirname, '..', '..'), target);
  console.log(`[prepare] transcript  → ${relative(transcriptPath)} (${document.stats.wordCount.toLocaleString('en-US')} words, ${document.qa?.length || 0} Q&A blocks)`);
  console.log(`[prepare] release dir → ${relative(dirs.release)} (empty — the skill sources the release itself)`);
  console.log(`[prepare] output dir  → ${relative(dirs.output)}`);
}

main().catch(error => {
  console.error(`[prepare] ${error.message}`);
  process.exit(1);
});
