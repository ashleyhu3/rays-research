/**
 * One-time TrendForce price-history backfill from Wayback Machine snapshots.
 *
 * Mirrors the AWS spot backfill pattern: seed exact historical observations,
 * then let the daily no-auth TrendForce scraper carry the series forward.
 *
 * Usage:
 *   node server/scripts/backfillTrendforcePrice.js nand [--from 20250101] [--force]
 *   node server/scripts/backfillTrendforcePrice.js tft-lcd [--from 20250101] [--force]
 */
'use strict';
const axios = require('axios');
const {
  configFor,
  loadHistory,
  parseProducts,
  saveHistory,
} = require('../scrapers/trendforcePrice');

const UA = 'signal-dashboard-trendforce-backfill/1.0';

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

async function listSnapshots(page, from) {
  const archivedUrl = page.replace(/^https:\/\/www\./, '');
  const url = 'https://web.archive.org/cdx/search/cdx'
    + `?url=${encodeURIComponent(archivedUrl)}`
    + `&output=json&filter=statuscode:200&collapse=timestamp:8&from=${from}`;
  const rows = await getWithRetry(url);
  if (!Array.isArray(rows)) throw new Error('unexpected CDX response');
  return rows.slice(1).map(r => r[1]);
}

function parseArgs(argv) {
  const key = argv[2] || 'nand';
  const fromArg = argv.indexOf('--from');
  const from = fromArg > -1 ? argv[fromArg + 1] : '20250101';
  const force = argv.includes('--force');
  return { key, from, force };
}

async function main() {
  const { key, from, force } = parseArgs(process.argv);
  const cfg = configFor(key);

  console.log(`Listing Wayback snapshots of ${cfg.url} since ${from}...`);
  const timestamps = await listSnapshots(cfg.url, from);
  console.log(`${timestamps.length} snapshots found`);

  const history = loadHistory(cfg.key);
  let added = 0, skipped = 0, failed = 0;

  for (const ts of timestamps) {
    const date = `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}`;
    if (history[date] && !force) { skipped++; continue; }

    const url = `https://web.archive.org/web/${ts}id_/${cfg.url}`;
    try {
      const html = await getWithRetry(url);
      const products = parseProducts(html, cfg.key);
      if (products.length === 0) {
        console.warn(`x ${date}: no ${cfg.displayName} price tables found`);
        failed++;
      } else {
        history[date] = Object.fromEntries(products.map(p => [p.product, p.price]));
        added++;
        console.log(`+ ${date}: ${products.length} products`);
      }
    } catch (e) {
      console.warn(`x ${date}: ${e.message}`);
      failed++;
    }
    await sleep(2000);
  }

  saveHistory(cfg.key, history);
  const dates = Object.keys(history).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  console.log(`\nDone. ${added} dates added, ${skipped} already present, ${failed} failed.`);
  if (dates.length) console.log(`${cfg.blob} spans ${dates[0]} -> ${dates[dates.length - 1]} (${dates.length} dates).`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
