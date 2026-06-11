/**
 * One-time backfill of DRAM spot price history from Wayback Machine snapshots
 * of https://www.trendforce.com/price/dram/dram_spot.
 *
 * Each archived page goes through the same parser and averaging as the live
 * scraper (session average × (1 + session change), averaged per model), and
 * lands in server/data/dramHistory.json keyed by the snapshot date. Dates that
 * already exist (e.g. from the live daily scrape) are never overwritten.
 *
 * Usage: node server/scripts/backfillDram.js [--from 20250101]
 */
const axios = require('axios');
const { parseModels, loadHistory, saveHistory } = require('../scrapers/dram');

const PAGE = 'https://www.trendforce.com/price/dram/dram_spot';
const UA   = 'signal-dashboard-backfill/1.0 (one-time historical backfill)';

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getWithRetry(url, tries = 4, timeout = 60000) {
  for (let i = 1; i <= tries; i++) {
    try {
      const { data } = await axios.get(url, { headers: { 'User-Agent': UA }, timeout });
      return data;
    } catch (e) {
      if (i === tries) throw e;
      console.warn(`  retry ${i}/${tries - 1} after error: ${e.message}`);
      await sleep(5000 * i);
    }
  }
}

async function listSnapshots(from) {
  // One snapshot per day (collapse=timestamp:8), successful captures only
  const url = 'https://web.archive.org/cdx/search/cdx'
    + `?url=${encodeURIComponent(PAGE.replace('https://www.', ''))}`
    + `&output=json&filter=statuscode:200&collapse=timestamp:8&from=${from}`;
  const rows = await getWithRetry(url);
  if (!Array.isArray(rows)) throw new Error('unexpected CDX response');
  return rows.slice(1).map(r => r[1]); // timestamps, e.g. 20250321002518
}

async function main() {
  const fromArg = process.argv.indexOf('--from');
  const from = fromArg > -1 ? process.argv[fromArg + 1] : '20250101';

  console.log(`Listing Wayback snapshots of ${PAGE} since ${from}…`);
  const timestamps = await listSnapshots(from);
  console.log(`${timestamps.length} snapshots found`);

  const history = loadHistory();
  let added = 0, skipped = 0, failed = 0;

  for (const ts of timestamps) {
    const date = `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}`;
    if (history[date]) { skipped++; continue; } // never overwrite existing days

    // id_ returns the original page body without the archive toolbar
    const url = `https://web.archive.org/web/${ts}id_/${PAGE}`;
    try {
      const html   = await getWithRetry(url);
      const models = parseModels(html);
      if (models.length === 0) {
        console.warn(`✗ ${date}: no spot tables found in snapshot`);
        failed++;
      } else {
        history[date] = Object.fromEntries(models.map(m => [m.model, m.price]));
        added++;
        console.log(`✓ ${date}: ${models.length} models`);
      }
    } catch (e) {
      console.warn(`✗ ${date}: ${e.message}`);
      failed++;
    }
    await sleep(2000); // be polite to archive.org
  }

  saveHistory(history);
  const dates = Object.keys(history).sort();
  console.log(`\nDone. ${added} dates added, ${skipped} already present, ${failed} failed.`);
  console.log(`History now spans ${dates[0]} → ${dates[dates.length - 1]} (${dates.length} dates).`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
