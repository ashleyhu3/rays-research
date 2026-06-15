/**
 * One-time backfill of MCP-ecosystem growth history.
 *
 * The live `mcp` scraper records, once per day, the cumulative number of GitHub
 * repositories matching each MCP phrase (metric `{phrase}.total`). This script
 * reconstructs the preceding ~2 years of that cumulative curve by asking the
 * GitHub search API how many matching repos had been created on or before each
 * monthly cutoff (`created:<=DATE`), so the dashboard's MCP chart honours the
 * time toggle immediately.
 *
 * Points are written into server/data/metricsHistory.json under the same `mcp`
 * source and `{phrase}.total` metric keys the scheduler appends to. Existing
 * dates are never overwritten. Requires GITHUB_TOKEN for a usable rate limit.
 *
 * Usage: GITHUB_TOKEN=... node server/scripts/backfillMcp.js
 */
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Must match server/scrapers/mcp.js QUERIES so backfilled and live keys align.
const QUERIES = {
  'mcp server':             '"mcp server"',
  'model context protocol': '"model context protocol"',
};

const HISTORY_FILE = path.join(__dirname, '..', 'data', 'metricsHistory.json');
const MONTHS = 24;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const iso = d => d.toISOString().slice(0, 10);

function headers() {
  const h = { 'User-Agent': 'signal-dashboard/1.0', Accept: 'application/vnd.github+json' };
  if (process.env.GITHUB_TOKEN) h.Authorization = `token ${process.env.GITHUB_TOKEN}`;
  return h;
}

function monthlyAnchors(months) {
  const out = [];
  const now = new Date();
  for (let i = months; i >= 1; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 28));
    out.push(iso(d));
  }
  return out;
}

async function cumulativeCount(phrase, cutoff, tries = 3) {
  for (let i = 1; i <= tries; i++) {
    try {
      const { data } = await axios.get('https://api.github.com/search/repositories', {
        params: { q: `${phrase} created:<=${cutoff}`, per_page: 1 },
        headers: headers(),
        timeout: 25000,
      });
      return data.total_count ?? 0;
    } catch (e) {
      // 403 = secondary rate limit; back off harder
      const wait = e.response?.status === 403 ? 30000 : 4000 * i;
      if (i === tries) throw e;
      await sleep(wait);
    }
  }
}

async function main() {
  if (!process.env.GITHUB_TOKEN) console.warn('No GITHUB_TOKEN — search is limited to 10 req/min; this will be slow.');
  const anchors = monthlyAnchors(MONTHS);
  console.log(`Backfilling MCP repo counts for ${Object.keys(QUERIES).length} phrases × ${anchors.length} months…`);

  let store = {};
  try { store = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')); } catch {}
  if (!store.mcp) store.mcp = {};

  let added = 0, skipped = 0, failed = 0;
  for (const [label, phrase] of Object.entries(QUERIES)) {
    const metric = `${label}.total`;
    if (!store.mcp[metric]) store.mcp[metric] = {};
    for (const anchor of anchors) {
      if (store.mcp[metric][anchor] != null) { skipped++; continue; }
      try {
        const count = await cumulativeCount(phrase, anchor);
        store.mcp[metric][anchor] = count;
        added++;
        console.log(`✓ ${label} ≤ ${anchor}: ${count}`);
      } catch (e) {
        console.warn(`✗ ${label} ≤ ${anchor}: ${e.message}`);
        failed++;
      }
      await sleep(2500); // search API: 30 req/min authenticated
    }
  }

  fs.mkdirSync(path.dirname(HISTORY_FILE), { recursive: true });
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(store));
  console.log(`\nDone. ${added} added, ${skipped} already present, ${failed} failed.`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
