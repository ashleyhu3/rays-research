'use strict';
/**
 * One-shot backfill: pull earnings call transcripts for all StockTwits-tracked
 * tickers for the past 4 quarters from LSEG Workspace API and upsert them into
 * MongoDB (collection: transcripts).
 *
 * Usage:
 *   node --env-file=.env server/scripts/backfillTranscripts.js
 *   node --env-file=.env server/scripts/backfillTranscripts.js --analyze
 *
 * --analyze: run the transcript agent (Gemini/Groq) on each new transcript and
 *            store the structured tone analysis alongside the raw text.
 *
 * Idempotent: existing documents (matched on ticker + lsegId) are never
 * duplicated. Re-running only fills gaps.
 */

const { fetchTranscriptsForTicker } = require('../scrapers/lseg');
const { parseTranscript, runTranscriptAgent } = require('../transcriptAgent');

// ── Tickers — mirrors CATEGORIES in server/scrapers/sentiment.js ────────────
const TICKERS = [
  // Memory Semiconductors
  'SNDK', 'MU', 'WDC', 'STX',
  // Optics
  'AAOI', 'CIEN', 'LITE', 'COHR', 'GLW',
  // Optics Equipment
  'TER', 'TSEM', 'VIAV', 'KEYS', 'AEHR',
  // Semi Equipment
  'LRCX', 'AMAT', 'KLAC',
];

// Date window: last 4 fiscal quarters. Most companies report 4-8 weeks after
// quarter-end, so April 2025 → now covers ~4 full earnings cycles.
const AFTER  = '2025-04-01';
const BEFORE = new Date().toISOString().slice(0, 10); // today

const ANALYZE = process.argv.includes('--analyze');
const MONGO_URI = process.env.MONGODB_URI;

async function connectMongo() {
  if (!MONGO_URI) {
    console.error('[backfill] MONGODB_URI not set — cannot write transcripts');
    process.exit(1);
  }
  const { MongoClient } = require('mongodb');
  const client = new MongoClient(MONGO_URI, { serverSelectionTimeoutMS: 10_000 });
  await client.connect();
  const db   = client.db(process.env.MONGODB_DB || undefined);
  const col  = db.collection('transcripts');

  // Compound index: ticker + lsegId (unique) + ticker + date (queries)
  await col.createIndex({ ticker: 1, lsegId: 1 }, { unique: true, background: true });
  await col.createIndex({ ticker: 1, date: -1 },  { background: true });

  return { client, col };
}

function guessQuarter(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1; // 1-12
  // Calendar quarter of the *reporting* date (the earnings call date)
  const q = Math.ceil(m / 3);
  return `${y}Q${q}`;
}

function stripHtml(html) {
  return String(html || '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s{3,}/g, '\n\n')
    .trim();
}

async function processTranscript(col, ticker, raw) {
  const { storyId, headline, date, rawText } = raw;

  const cleanText = stripHtml(rawText);
  const blocks    = parseTranscript(cleanText);
  const quarter   = guessQuarter(date);

  const doc = {
    ticker,
    lsegId:    storyId,
    headline,
    date,
    quarter,
    source:    'lseg',
    rawText:   cleanText,
    blocks,
    blockCount: blocks.length,
    storedAt:  new Date().toISOString(),
  };

  if (ANALYZE && blocks.length > 0) {
    try {
      console.log(`    analyzing ${blocks.length} blocks...`);
      doc.analysis = await runTranscriptAgent(blocks, { maxInvestigations: 6, pacingMs: 2000 });
    } catch (e) {
      console.warn(`    analysis failed: ${e.message}`);
      doc.analysisError = e.message;
    }
  }

  await col.updateOne(
    { ticker, lsegId: storyId },
    { $set: doc },
    { upsert: true },
  );

  return { quarter, blocks: blocks.length };
}

async function main() {
  console.log(`[backfill] LSEG earnings transcripts — ${TICKERS.length} tickers, ${AFTER} → ${BEFORE}`);
  if (ANALYZE) console.log('[backfill] --analyze: will run transcript agent on each document');

  const { client, col } = await connectMongo();
  console.log('[backfill] connected to MongoDB');

  let totalNew = 0, totalSkipped = 0, totalFailed = 0;

  for (const ticker of TICKERS) {
    process.stdout.write(`\n[${ticker}] searching...`);
    try {
      const transcripts = await fetchTranscriptsForTicker(ticker, { after: AFTER, before: BEFORE });

      if (!transcripts.length) {
        console.log(' 0 results');
        continue;
      }

      console.log(` ${transcripts.length} found`);
      for (const raw of transcripts) {
        const alreadyExists = await col.findOne({ ticker, lsegId: raw.storyId }, { projection: { _id: 1 } });
        if (alreadyExists) {
          process.stdout.write('  .');
          totalSkipped++;
          continue;
        }

        try {
          const { quarter, blocks } = await processTranscript(col, ticker, raw);
          console.log(`  ✓ ${quarter ?? raw.date?.slice(0, 10) ?? 'unknown'} — ${raw.headline.slice(0, 60)} (${blocks} blocks)`);
          totalNew++;
        } catch (e) {
          console.error(`  ✗ ${raw.storyId}: ${e.message}`);
          totalFailed++;
        }

        // Pacing between store calls
        await new Promise(r => setTimeout(r, 200));
      }
    } catch (e) {
      console.error(` ERROR: ${e.message}`);
      totalFailed++;
    }

    // Pause between tickers to stay within LSEG rate limits
    await new Promise(r => setTimeout(r, 500));
  }

  console.log(`\n[backfill] done — ${totalNew} new, ${totalSkipped} already existed, ${totalFailed} failed`);
  await client.close();
}

main().catch(e => {
  console.error('[backfill] fatal:', e.message);
  process.exit(1);
});
