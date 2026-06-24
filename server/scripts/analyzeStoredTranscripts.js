'use strict';
/**
 * Runs Gemini (primary) or Groq (fallback) tone analysis on every transcript
 * in the MongoDB `transcripts` collection that has no analysis yet.
 *
 * Rate-limit handling:
 *   • Per-minute quota (429 with "quota" / "exhausted"): waits 65 s then resumes.
 *   • Daily quota (429 with "daily" / "per day"): waits until midnight UTC.
 *   • Transient errors (timeout, 500): retries up to 3× with exponential backoff.
 *
 * Never falls back to the lexicon — exits with an error if LLM is unavailable.
 *
 * Usage:
 *   node --env-file=.env server/scripts/analyzeStoredTranscripts.js
 *   node --env-file=.env server/scripts/analyzeStoredTranscripts.js --reanalyze
 *   node --env-file=.env server/scripts/analyzeStoredTranscripts.js --ticker MU
 */

const { runTranscriptAgent } = require('../transcriptAgent');

const REANALYZE     = process.argv.includes('--reanalyze');
const TICKER_FILTER = (() => {
  const i = process.argv.indexOf('--ticker');
  return i !== -1 ? (process.argv[i + 1] ?? '').toUpperCase() : null;
})();

// ── Pre-flight: require at least one LLM key ────────────────────────────────
const hasGemini = !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);
const hasGroq   = !!process.env.GROQ_API_KEY;
if (!hasGemini && !hasGroq) {
  console.error('[analyze] No LLM key found. Set GEMINI_API_KEY or GROQ_API_KEY in .env.');
  process.exit(1);
}
const primaryEngine = hasGemini ? 'Gemini 2.5 Flash' : 'Groq Llama-3.3-70B';
console.log(`[analyze] engine: ${primaryEngine}`);

// ── Rate-limit helpers ───────────────────────────────────────────────────────
function isRateLimit(err) {
  const m = String(err?.message ?? '');
  return m.includes('429') || /rate.?limit|quota|resource.?exhaust/i.test(m);
}
function isDailyLimit(err) {
  return /daily|per.?day|RATE_LIMIT_EXCEEDED/i.test(String(err?.message ?? ''));
}
function msUntilMidnightUtc() {
  const now = new Date();
  const midnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return Math.max(midnight.getTime() - now.getTime(), 0);
}

async function waitWithCountdown(ms, reason) {
  const total = Math.ceil(ms / 1000);
  process.stdout.write(`\n[rate-limit] ${reason} — pausing ${total}s `);
  const tick = Math.max(1, Math.floor(total / 20)); // ~20 dots
  for (let remaining = total; remaining > 0; remaining -= tick) {
    await new Promise(r => setTimeout(r, tick * 1000));
    process.stdout.write('.');
  }
  process.stdout.write(' resuming\n');
}

// ── MongoDB ──────────────────────────────────────────────────────────────────
async function connectMongo() {
  const uri = process.env.MONGODB_URI;
  if (!uri) { console.error('[analyze] MONGODB_URI not set.'); process.exit(1); }
  const { MongoClient } = require('mongodb');
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10_000 });
  await client.connect();
  const col = client.db(process.env.MONGODB_DB || undefined).collection('transcripts');
  return { client, col };
}

// ── Core: analyze one document (no retry here — retry lives in the loop) ─────
async function analyzeDoc(doc) {
  const blocks = doc.blocks ?? [];
  if (!blocks.length) throw new Error('no speaker blocks stored');

  const result = await runTranscriptAgent(blocks, { maxInvestigations: 10, pacingMs: 2000 });

  if (result.summary.engine === 'lexicon') {
    throw Object.assign(
      new Error(result.summary.llmError
        ? `LLM failed (${result.summary.llmError}) — refusing lexicon fallback`
        : 'LLM unavailable — refusing lexicon fallback'),
      { lexiconFallback: true }
    );
  }
  return result;
}

// ── Main loop ────────────────────────────────────────────────────────────────
async function main() {
  const { client, col } = await connectMongo();
  console.log('[analyze] connected to MongoDB');

  const query = {};
  if (TICKER_FILTER) query.ticker = TICKER_FILTER;
  if (!REANALYZE) query.analysis = { $exists: false };

  const docs = await col
    .find(query, { projection: { rawText: 0 } }) // keep blocks; drop large rawText
    .sort({ ticker: 1, date: 1 })
    .toArray();

  if (!docs.length) {
    const hint = REANALYZE ? '' : ' (use --reanalyze to redo existing)';
    console.log(`[analyze] nothing to analyze${hint}`);
    await client.close(); return;
  }

  console.log(`[analyze] ${docs.length} transcripts queued${TICKER_FILTER ? ` for ${TICKER_FILTER}` : ''}`);

  let ok = 0, skipped = 0, failed = 0;
  // Gemini free tier: 15 RPM. We add inter-call pacing; the wait logic below
  // covers bursts that still exceed the limit.
  const INTER_CALL_MS = hasGemini ? 5000 : 1500;

  for (let i = 0; i < docs.length; i++) {
    const doc  = docs[i];
    const label = `[${i + 1}/${docs.length}] ${doc.ticker} ${doc.quarter ?? doc.date?.slice(0, 10) ?? doc._id}`;
    process.stdout.write(`${label} (${doc.blockCount ?? '?'} blocks)... `);

    let analysis = null;
    let lastErr  = null;
    const MAX_RATE_RETRIES = 5;

    for (let attempt = 1; attempt <= MAX_RATE_RETRIES; attempt++) {
      try {
        analysis = await analyzeDoc(doc);
        break;
      } catch (e) {
        lastErr = e;
        if (e.lexiconFallback) break; // LLM outright unavailable — skip this doc

        if (isRateLimit(e)) {
          if (isDailyLimit(e)) {
            const waitMs = msUntilMidnightUtc();
            await waitWithCountdown(waitMs + 5000, 'daily quota hit — waiting until midnight UTC');
          } else {
            // Per-minute quota: 65s covers the standard 1-minute window
            await waitWithCountdown(65_000, `per-minute quota (attempt ${attempt}/${MAX_RATE_RETRIES})`);
          }
          continue; // retry the same document
        }

        // Transient error (timeout, 500, etc.) — short backoff then retry
        if (attempt < MAX_RATE_RETRIES) {
          const backoffMs = Math.min(2000 * Math.pow(2, attempt - 1), 30_000);
          console.log(`\n  transient error (attempt ${attempt}): ${e.message} — retrying in ${backoffMs / 1000}s`);
          await new Promise(r => setTimeout(r, backoffMs));
          continue;
        }
      }
    }

    if (analysis) {
      const s = analysis.summary;
      await col.updateOne(
        { _id: doc._id },
        { $set: { analysis, analyzedAt: new Date().toISOString(), analysisError: null } },
      );
      const cats = analysis.catalysts?.length ?? 0;
      console.log(`✓ ${s.engine} · mgmt ${s.mgmtAvg?.toFixed(2) ?? '—'} · analyst ${s.analystAvg?.toFixed(2) ?? '—'} · ${s.flaggedCount} flagged · ${cats} catalyst${cats !== 1 ? 's' : ''}`);
      ok++;
    } else {
      await col.updateOne(
        { _id: doc._id },
        { $set: { analysisError: lastErr?.message ?? 'unknown', analyzedAt: new Date().toISOString() } },
      ).catch(() => {});
      console.log(`✗ ${lastErr?.message ?? 'unknown'}`);
      if (lastErr?.lexiconFallback) skipped++; else failed++;
    }

    // Pace between calls to stay under the per-minute limit
    if (i < docs.length - 1) await new Promise(r => setTimeout(r, INTER_CALL_MS));
  }

  console.log(`\n[analyze] complete — ${ok} analyzed, ${skipped} skipped (no LLM), ${failed} failed`);
  await client.close();
}

main().catch(e => {
  console.error('[analyze] fatal:', e.message);
  process.exit(1);
});
