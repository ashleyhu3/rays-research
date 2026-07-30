/**
 * One-off history seed for the Shipping page's StockQ-sourced indices.
 *
 * The Baltic Capesize/Panamax/Supramax and dirty/clean tanker indices have no
 * free multi-year feed: StockQ's per-index pages only carry the last ~20
 * sessions. Its daily market snapshots (one page per session, back to 2007) do
 * list every index with its own as-of date, so this walks those pages backwards
 * and merges what it finds into the same blob the scraper tops up.
 *
 *   npm run backfill:shipping           # default 730 calendar days
 *   npm run backfill:shipping -- 1825   # five years
 *
 * Requests are paced and sequential — StockQ is a small site and this is a
 * one-time job, so there is no reason to hammer it.
 */
'use strict';

const path = require('path');
const storage = require('../storage');
const { fetchStockqDay, BLOB, HISTORY_FILE } = require('../scrapers/shipping');

const REQUEST_GAP_MS = 350;
const MERGE_EVERY = 40;
// Consecutive transport failures (as opposed to 404s for non-trading days)
// that mean the site has stopped answering and the run should stop early.
const MAX_CONSECUTIVE_ERRORS = 12;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function isoDaysAgo(days) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function* tradingDays(days) {
  const start = new Date(`${isoDaysAgo(days)}T00:00:00Z`);
  const cursor = new Date();
  cursor.setUTCHours(0, 0, 0, 0);
  while (cursor >= start) {
    const weekday = cursor.getUTCDay();
    if (weekday !== 0 && weekday !== 6) yield cursor.toISOString().slice(0, 10);
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
}

async function main() {
  const days = Math.min(Math.max(Number(process.argv[2]) || 730, 1), 3650);
  await storage.init([{ name: BLOB, file: HISTORY_FILE }]);
  if (process.env.MONGODB_URI && storage.status().mode !== 'mongo') {
    throw new Error('MongoDB was configured but unavailable; refusing to write to a local fallback');
  }

  const dates = [...tradingDays(days)];
  console.log(`[shipping-backfill] walking ${dates.length} sessions back to ${dates.at(-1)}`);

  let patches = {};
  let fetched = 0;
  let missing = 0;
  let consecutiveErrors = 0;

  const flush = () => {
    if (!Object.keys(patches).length) return;
    storage.mergeDatedRows(BLOB, HISTORY_FILE, patches);
    patches = {};
  };

  for (const [index, date] of dates.entries()) {
    try {
      const rows = await fetchStockqDay(date);
      consecutiveErrors = 0;
      if (Object.keys(rows).length) {
        for (const [rowDate, row] of Object.entries(rows)) {
          patches[rowDate] = { ...(patches[rowDate] ?? {}), ...row };
        }
        fetched += 1;
      } else {
        missing += 1;
      }
    } catch (error) {
      // A 404 just means StockQ published no snapshot that day (holiday).
      if (/HTTP 404/.test(error.message)) missing += 1;
      else {
        consecutiveErrors += 1;
        console.warn(`[shipping-backfill] ${date}: ${error.message}`);
        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
          console.warn('[shipping-backfill] too many consecutive failures — stopping early');
          break;
        }
      }
    }
    if ((index + 1) % MERGE_EVERY === 0) {
      flush();
      console.log(`[shipping-backfill] ${index + 1}/${dates.length} · ${fetched} pages with data · ${missing} empty`);
    }
    await sleep(REQUEST_GAP_MS);
  }
  flush();

  const history = storage.read(BLOB, HISTORY_FILE);
  const isoDates = Object.keys(history).filter(key => /^\d{4}-\d{2}-\d{2}$/.test(key)).sort();
  const counts = {};
  for (const isoDate of isoDates) {
    for (const [id, value] of Object.entries(history[isoDate])) {
      if (typeof value === 'number') counts[id] = (counts[id] ?? 0) + 1;
    }
  }
  await storage.flush();
  await storage.close();

  console.log(`[shipping-backfill] ${isoDates.length} dates, ${isoDates[0]} → ${isoDates.at(-1)}`);
  for (const [id, count] of Object.entries(counts).sort()) console.log(`  ${id.padEnd(8)} ${count}`);
}

main().then(() => process.exit(0)).catch(error => {
  console.error('[shipping-backfill] failed:', error);
  process.exit(1);
});
