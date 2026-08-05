'use strict';

// Stage the source materials the earnings-review skill expects to find under
// research/{TICKER}/, so a GitHub runner (which checks out a repo with no research/
// tree at all) starts from the same place a local run does.
//
//   node server/scripts/prepareEarningsInputs.js --ticker GOOGL --quarter Q2 --year 2026
//   node server/scripts/prepareEarningsInputs.js --ticker NVDA --quarter Q2 --year 2027 --allow-api
//
// The transcript comes from whatever is already stored — a Mongo normalized_transcripts
// doc, a local collector file, or a transcript pasted through POST /api/transcripts/parse.
//
// A miss is not an error. The skill sources the transcript from the company's IR site or
// a free public transcript provider itself, using its own web tools, and imports it with
// importTranscript.js so the next run is served from Mongo. That path has no API quota at
// all, which is why it is the default: Alpha Vantage's free tier allows 25 requests/day
// across the whole project, so it is only used when --allow-api is passed explicitly.
//
// Env: MONGODB_URI (stored path), ALPHA_VANTAGE_API_KEY (only with --allow-api).

const fs = require('fs');
const path = require('path');

const { collectFromAlphaVantage } = require('../transcripts/alphavantage');
const { readTranscript, saveTranscript, transcriptMarkdown } = require('../transcripts/store');

const RESEARCH_ROOT = path.join(__dirname, '..', '..', 'research');

const argValue = name => {
  const index = process.argv.indexOf(name);
  return index !== -1 ? (process.argv[index + 1] || '') : null;
};
const ALLOW_API = process.argv.includes('--allow-api');

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

  const dirs = ensureResearchTree(ticker);
  const relative = target => path.relative(path.join(__dirname, '..', '..'), target);
  const transcriptPath = path.join(dirs.transcript, `${ticker}_${period}_earnings_call_transcript.md`);

  let document = await readTranscript(ticker, period);
  if (document) {
    console.log(`[prepare] using stored transcript for ${ticker} ${period} (provider: ${document.metadata?.provider || 'unknown'})`);
  } else if (ALLOW_API) {
    console.log(`[prepare] no stored transcript for ${ticker} ${period} — fetching from Alpha Vantage (--allow-api)`);
    document = await collectFromAlphaVantage({ ticker, quarter, year });
    const storage = await saveTranscript(document);
    console.log(`[prepare] collected and saved (mongo: ${storage.mongoStored})`);
  }

  // A stored transcript with neither prepared remarks nor Q&A is a broken record rather
  // than a call that genuinely had none. Drop it and let the skill source a real one.
  if (document && !document.prepared?.length && !document.qa?.length) {
    console.warn(`[prepare] stored transcript for ${ticker} ${period} has no speaker blocks — ignoring it`);
    document = null;
  }

  if (document) {
    fs.writeFileSync(transcriptPath, transcriptMarkdown(document));
    console.log(`[prepare] transcript  → ${relative(transcriptPath)} (${document.stats.wordCount.toLocaleString('en-US')} words, ${document.qa?.length || 0} Q&A blocks)`);
  } else {
    // Not a failure: this is the normal path for any call not yet collected. The skill
    // reads this and goes and finds it. Say so explicitly, because the message ends up in
    // the runner log the skill's operator reads when a review comes back thin.
    console.log(`[prepare] no stored transcript for ${ticker} ${period}.`);
    console.log('[prepare] ACTION FOR THE SKILL: source the full verbatim transcript from the web');
    console.log(`[prepare]   save it to  ${relative(transcriptPath)}`);
    console.log(`[prepare]   then run    node server/scripts/importTranscript.js --ticker ${ticker} --quarter ${quarter} --year ${year} --file "${relative(transcriptPath)}" --source-url <url>`);
  }

  console.log(`[prepare] release dir → ${relative(dirs.release)} (empty — the skill sources the release itself)`);
  console.log(`[prepare] output dir  → ${relative(dirs.output)}`);
}

main().catch(error => {
  console.error(`[prepare] ${error.message}`);
  process.exit(1);
});
