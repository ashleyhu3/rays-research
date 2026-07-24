'use strict';

/**
 * Backfill the Price Return tab (Alerts page): for every tracked ticker, pull
 * its past earnings-announcement dates (API Ninjas — one free request, up to
 * ~10 years of quarterly calls, no daily cap) and its daily close prices
 * (Yahoo Finance, no key needed), then compute the 1-day / 3-day / 1-week
 * close-to-close return following each call. Writes incrementally, one ticker
 * at a time, so a run interrupted by a transient provider error keeps whatever
 * finished; a re-run is cheap and simply refreshes every ticker.
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
    await storage.init(allBlobs.filter(blob => blob.name === BLOB.name));
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
