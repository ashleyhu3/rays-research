'use strict';

/**
 * Backfill the Price Return tab (Alerts page): for every tracked ticker, pull
 * its settled quarterly earnings-call history (Alpha Vantage, via
 * earningsDates.js — shares that module's cache and rate-limit pacing) and its
 * daily close prices (Yahoo Finance, no key needed), then compute the 1-day /
 * 3-day / 1-week close-to-close return following each call. Writes
 * incrementally, one ticker at a time, so a run that gets cut off by Alpha
 * Vantage's daily cap keeps whatever finished and can just be re-run tomorrow
 * — already-covered tickers are cheap to redo since Alpha Vantage's own cache
 * inside earningsDates.js answers them without a fresh vendor call.
 *
 * Usage:
 *   node --env-file=.env server/scripts/backfillPriceReturn.js [options]
 *
 * Options:
 *   --tickers A,B,C   Comma list to process (default: every Price Return tab ticker).
 *   --limit N         Process at most N tickers this run.
 */

const storage = require('../storage');
const allBlobs = require('../storageBlobs');
const { BLOB: EARNINGS_BLOB } = require('../earningsDates');
const {
  BLOB,
  PRICE_RETURN_TICKERS,
  backfill,
} = require('../priceReturnAfterEarnings');

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
  let tickers = args.tickers ?? PRICE_RETURN_TICKERS;
  if (Number.isFinite(args.limit)) tickers = tickers.slice(0, args.limit);

  console.log(`[price-return-backfill] processing ${tickers.length} ticker(s)`);

  try {
    await storage.init(allBlobs.filter(blob => [BLOB.name, EARNINGS_BLOB.name].includes(blob.name)));
    const state = await backfill(tickers);
    await storage.flush();
    const covered = Object.keys(state.tickers ?? {}).length;
    console.log(`[price-return-backfill] done — ${covered}/${PRICE_RETURN_TICKERS.length} tickers have data`);
  } finally {
    await storage.close();
  }
}

main().catch(error => {
  console.error('[price-return-backfill] failed:', error);
  process.exitCode = 1;
});
