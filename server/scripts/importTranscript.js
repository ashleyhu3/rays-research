'use strict';

/**
 * Import a transcript the earnings-review skill sourced from the web into the same
 * Mongo `normalized_transcripts` collection the Alpha Vantage collector writes to.
 *
 *   node --env-file=.env server/scripts/importTranscript.js \
 *     --ticker NVDA --quarter Q2 --year 2027 \
 *     --file research/NVDA/ER+Conf/NVDA_2027Q2_earnings_call_transcript.md \
 *     --source-url https://www.fool.com/earnings/call-transcripts/... \
 *     --earnings-date 2026-08-27
 *
 * This is what makes web sourcing a one-time cost: once a call is imported it is
 * normalized into deterministic prepared/Q&A speaker blocks, stored, and every later run
 * for that ticker/quarter is served from Mongo by prepareEarningsInputs.js instead of
 * being fetched again.
 *
 * The parser needs speaker attribution to work with. Plain prose with no speaker labels
 * will be rejected rather than silently stored as one giant block — a transcript the
 * coverage gate cannot walk is worse than no transcript, because it looks like success.
 *
 * Env: MONGODB_URI (without it the transcript is still written to server/data locally).
 */

const fs = require('fs');
const path = require('path');

const { parseTranscriptDocument } = require('../transcripts/parser');
const { saveTranscript } = require('../transcripts/store');

const argValue = name => {
  const index = process.argv.indexOf(name);
  return index !== -1 ? (process.argv[index + 1] || '') : null;
};

// A usable transcript has many speaker turns and a question-and-answer half. These floors
// are deliberately loose — they exist to catch a summary or a paywall stub that got saved
// by mistake, not to grade the transcript.
const MIN_BLOCKS = 8;
const MIN_WORDS = 1500;

// The parser reads plain lines: a bare "Prepared Remarks" / "Questions and Answers"
// heading, and speaker labels like "Name -- Title". A transcript saved as Markdown wraps
// both in syntax the parser does not strip ("## Prepared Remarks", "### Name — Title",
// "_00:14:22_"), so every line would fall through to prose and the whole call would land
// as one unattributed block. Undo the formatting, keeping the text itself untouched.
const SECTION_HEADING_RX = /^(prepared remarks?|presentation|opening remarks?|management discussion|questions?(?:\s*(?:and|&)\s*answers?)?|q\s*&\s*a|question-and-answer session)[:\s]*$/i;

// Does this line look like "Jane Doe -- Chief Executive Officer", "Jane Doe (CFO)", or
// "Operator"? Mirrors the shapes parser.js's parseSpeakerLabel accepts; it is not exported,
// and this only needs to be good enough to decide whether a blank line is a separator.
function looksLikeSpeakerLabel(line) {
  const value = line.trim();
  if (!value || value.length > 140) return false;
  if (/^operator$/i.test(value)) return true;
  if (/^(.{2,80}?)\s+(?:--|—|–|-)\s+(.{2,100})$/.test(value)) return true;
  return /^(.{2,80}?)\s*\([^)]{2,100}\)$/.test(value);
}

function normalizeMarkdown(text) {
  const lines = text.split('\n').map(line => {
    let value = line.replace(/^\s*#{1,6}\s+/, '');           // ATX headings
    if (/^\s*([*_-])\1{2,}\s*$/.test(value)) return '';      // horizontal rules
    value = value.replace(/^\s*>\s?/, '');                   // blockquote markers
    const bare = value.trim();
    // Emphasis wrapping a whole line — speaker labels and timestamps are often bolded or
    // italicised, and the markers break both the label and heading matchers.
    const emphasised = bare.match(/^(?:\*\*|__|\*|_)(.+?)(?:\*\*|__|\*|_)$/);
    return emphasised ? emphasised[1].trim() : value;
  });

  // parser.js only accepts a line as a speaker label when the line directly below it is
  // non-blank, but virtually every published transcript — and every Markdown rendering of
  // one — puts a blank line between the speaker and what they said. Without closing that
  // gap the labels read as prose and the entire call collapses into one unattributed
  // block. Drop the blank run between a speaker label and their first line of speech.
  const out = [];
  for (let index = 0; index < lines.length; index += 1) {
    out.push(lines[index]);
    if (!looksLikeSpeakerLabel(lines[index])) continue;

    let next = index + 1;
    while (next < lines.length && !lines[next].trim()) next += 1;
    // Only close the gap when actual speech follows — never swallow the blank line before
    // a section heading, which would fold "Questions and Answers" into the speaker line.
    if (next > index + 1 && next < lines.length && !SECTION_HEADING_RX.test(lines[next].trim())) {
      index = next - 1;
    }
  }
  return out.join('\n');
}

function main() {
  const ticker = (argValue('--ticker') || '').toUpperCase().replace(/[^A-Z0-9.-]/g, '');
  const quarter = (argValue('--quarter') || '').toUpperCase().replace(/[^0-9Q]/g, '');
  const year = (argValue('--year') || '').replace(/[^0-9]/g, '');
  const file = argValue('--file');
  const sourceUrl = argValue('--source-url') || null;
  const earningsDate = argValue('--earnings-date') || undefined;

  if (!ticker || !/^Q[1-4]$/.test(quarter) || !/^\d{4}$/.test(year) || !file) {
    throw new Error('Usage: importTranscript.js --ticker NVDA --quarter Q2 --year 2027 --file <path> [--source-url <url>] [--earnings-date YYYY-MM-DD]');
  }
  if (!fs.existsSync(file)) throw new Error(`No such file: ${file}`);

  const text = normalizeMarkdown(fs.readFileSync(file, 'utf8'));
  const document = parseTranscriptDocument({
    ticker,
    quarter,
    year,
    earnings_date: earningsDate,
    transcript: text,
    metadata: {
      provider: 'web',
      sourceUrl,
      sourceFile: path.relative(path.join(__dirname, '..', '..'), file),
      collectedAt: new Date().toISOString(),
    },
  });

  const { totalBlocks, wordCount } = document.stats;
  const qaBlocks = document.qa?.length || 0;
  const problems = [];
  if (totalBlocks < MIN_BLOCKS) problems.push(`only ${totalBlocks} speaker blocks (expected ≥ ${MIN_BLOCKS})`);
  if (wordCount < MIN_WORDS) problems.push(`only ${wordCount} words (expected ≥ ${MIN_WORDS})`);
  if (!qaBlocks) problems.push('no Q&A section was detected');
  if (problems.length) {
    throw new Error(
      `This does not look like a full verbatim transcript — ${problems.join('; ')}.\n`
      + '  A paraphrased recap or a truncated/paywalled page will not support the coverage gate.\n'
      + '  Find a full transcript, or keep the speaker headings ("Name -- Title") and the\n'
      + '  "Prepared Remarks" / "Questions and Answers" section headings when saving it.',
    );
  }

  return saveTranscript(document).then(storage => {
    console.log(
      `[import] ✓ ${ticker} ${document.fiscal_period}: ${totalBlocks} blocks `
      + `(${document.prepared.length} prepared, ${qaBlocks} Q&A), `
      + `${wordCount.toLocaleString('en-US')} words, ${document.stats.speakers} speakers, `
      + `mongo=${storage.mongoStored}`,
    );
    if (!storage.mongoStored) {
      console.warn('[import] MONGODB_URI not set — stored locally only, so this will be re-fetched elsewhere.');
    }
  });
}

Promise.resolve().then(main).catch(error => {
  console.error(`[import] ${error.message}`);
  process.exit(1);
});
