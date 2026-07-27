'use strict';

/**
 * Backfill the Fundamentals page: for every ticker in its two sections (SOXX
 * constituents and the hyperscaler CSPs), pull its quarterly income statement
 * (SEC Company Facts for U.S. filers; Alpha Vantage
 * with a five-quarter FMP fallback for the four foreign ADRs) and compute
 * revenue and net-income growth YoY and QoQ for each quarter, free cash flow
 * for the CSP view, plus the quarterly SOXX candles (Yahoo Finance) the chart
 * sits on. Writes incrementally, one ticker at a time, so partial runs retain
 * every completed company.
 *
 * Usage:
 *   node --env-file=.env server/scripts/backfillFundamentals.js [options]
 *
 * Options:
 *   --tickers A,B,C   Comma list to process (default: every Fundamentals ticker).
 *   --limit N         Process at most N tickers this run.
 */

const storage = require('../storage');
const allBlobs = require('../storageBlobs');
const {
  BLOB,
  FUNDAMENTALS_TICKERS,
  backfill,
} = require('../fundamentalsGrowth');

function parseArgs(argv) {
  const args = { tickers: null, limit: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--tickers') args.tickers = argv[++i]?.split(',').map(t => t.trim().toUpperCase()).filter(Boolean);
    else if (arg === '--limit') args.limit = Number(argv[++i]);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let tickers = args.tickers ?? FUNDAMENTALS_TICKERS;
  if (Number.isFinite(args.limit)) tickers = tickers.slice(0, args.limit);

  console.log(`[fundamentals-backfill] processing ${tickers.length} ticker(s)`);

  try {
    await storage.init(allBlobs.filter(blob => blob.name === BLOB.name));
    const state = await backfill(tickers);
    await storage.flush();
    const covered = Object.keys(state.tickers ?? {}).length;
    console.log(`[fundamentals-backfill] done — ${covered}/${FUNDAMENTALS_TICKERS.length} tickers have data`);
  } finally {
    await storage.close();
  }
}

main().catch(error => {
  console.error('[fundamentals-backfill] failed:', error);
  process.exitCode = 1;
});
