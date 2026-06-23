/**
 * One-time backfill of SEC EDGAR full-text-search history.
 *
 * The live `sec` scraper records, once per day, the number of 10-K/10-Q filings
 * mentioning each AI term in the trailing 90 days (metric `{term}.filings90d`).
 * That only starts a trend the day the server first runs. This script fills the
 * preceding ~2 years by querying EDGAR for the same trailing-90-day window
 * anchored at monthly intervals, so the dashboard's SEC chart can honour the
 * time toggle from day one.
 *
 * Points are written into server/data/metricsHistory.json under the same
 * `sec` source and `{term}.filings90d` metric keys the scheduler appends to,
 * so live snapshots continue seamlessly. Existing dates are never overwritten.
 *
 * Usage: node server/scripts/backfillSec.js
 */
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const TERMS = [
  'artificial intelligence',
  'large language model',
  'generative AI',
  'AI agent',
];

const UA = 'signal-dashboard/1.0 research contact: ashley_hu1@brown.edu';
const HISTORY_FILE = path.join(__dirname, '..', 'data', 'metricsHistory.json');
const MONTHS = 24;        // how far back to anchor points
const WINDOW_DAYS = 90;   // trailing window per point — matches the live metric

const sleep = ms => new Promise(r => setTimeout(r, ms));
const iso = d => d.toISOString().slice(0, 10);

function monthlyAnchors(months) {
  const out = [];
  const now = new Date();
  for (let i = months; i >= 1; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 28));
    out.push(iso(d));
  }
  return out;
}

async function countFilings(term, startdt, enddt, tries = 3) {
  for (let i = 1; i <= tries; i++) {
    try {
      const { data } = await axios.get('https://efts.sec.gov/LATEST/search-index', {
        params: { q: `"${term}"`, forms: '10-K,10-Q', startdt, enddt },
        headers: { 'User-Agent': UA },
        timeout: 25000,
      });
      return data?.hits?.total?.value ?? 0;
    } catch (e) {
      if (i === tries) throw e;
      await sleep(3000 * i);
    }
  }
}

async function main() {
  const anchors = monthlyAnchors(MONTHS);
  console.log(`Backfilling SEC filing counts for ${TERMS.length} terms × ${anchors.length} months…`);

  let store = {};
  try { store = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')); } catch {}
  if (!store.sec) store.sec = {};

  let added = 0, skipped = 0, failed = 0;
  for (const term of TERMS) {
    const metric = `${term}.filings90d`;
    if (!store.sec[metric]) store.sec[metric] = {};
    for (const anchor of anchors) {
      if (store.sec[metric][anchor] != null) { skipped++; continue; }
      const end = new Date(anchor + 'T00:00:00Z');
      const start = new Date(end.getTime() - WINDOW_DAYS * 86400000);
      try {
        const count = await countFilings(term, iso(start), anchor);
        store.sec[metric][anchor] = count;
        added++;
        console.log(`✓ ${term} @ ${anchor}: ${count}`);
      } catch (e) {
        console.warn(`✗ ${term} @ ${anchor}: ${e.message}`);
        failed++;
      }
      await sleep(1200); // EDGAR 500s under bursts — pace gently
    }
  }

  fs.mkdirSync(path.dirname(HISTORY_FILE), { recursive: true });
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(store));
  console.log(`\nDone. ${added} added, ${skipped} already present, ${failed} failed.`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
