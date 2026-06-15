/**
 * One-time backfill of GitHub star history for the tracked AI SDK repos.
 *
 * The live `github` scraper records each repo's current star count once per day
 * (metric `{repo}.stars`). GitHub also exposes the timestamp of every individual
 * star event, so we can reconstruct the full historical curve: page through the
 * stargazers list with the star+json media type, then count how many stars
 * existed on or before each monthly cutoff over the last ~2 years.
 *
 * Points are written into server/data/metricsHistory.json under the same
 * `github` source and `{repo}.stars` metric keys the scheduler appends to, so
 * the dashboard's GitHub charts honour the time toggle immediately. Existing
 * dates are never overwritten. (Dependent-repo counts have no historical API,
 * so only the live forward-fill builds that series.)
 *
 * Usage: GITHUB_TOKEN=... node server/scripts/backfillGithubStars.js
 */
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Labels must match server/scrapers/github.js REPOS so keys align.
const REPOS = [
  'openai/openai-python',
  'anthropics/anthropic-sdk-python',
  'googleapis/python-genai',
  'mistralai/client-python',
];

const HISTORY_FILE = path.join(__dirname, '..', 'data', 'metricsHistory.json');
const MONTHS = 24;
const PER_PAGE = 100;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const iso = d => d.toISOString().slice(0, 10);

function headers() {
  const h = { 'User-Agent': 'signal-dashboard/1.0', Accept: 'application/vnd.github.star+json' };
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

async function getPage(repo, page, tries = 3) {
  for (let i = 1; i <= tries; i++) {
    try {
      const { data } = await axios.get(`https://api.github.com/repos/${repo}/stargazers`, {
        params: { per_page: PER_PAGE, page },
        headers: headers(),
        timeout: 25000,
        maxRedirects: 5, // follow repo renames/redirects to the canonical home
      });
      return data;
    } catch (e) {
      const wait = e.response?.status === 403 ? 30000 : 4000 * i;
      if (i === tries) throw e;
      await sleep(wait);
    }
  }
}

async function starTimestamps(repo) {
  const stamps = [];
  for (let page = 1; ; page++) {
    const rows = await getPage(repo, page);
    if (!Array.isArray(rows) || rows.length === 0) break;
    for (const r of rows) if (r.starred_at) stamps.push(r.starred_at.slice(0, 10));
    if (rows.length < PER_PAGE) break;
    await sleep(150);
  }
  return stamps.sort();
}

async function main() {
  if (!process.env.GITHUB_TOKEN) console.warn('No GITHUB_TOKEN — stargazers paging will exhaust the 60 req/hr limit fast.');
  const anchors = monthlyAnchors(MONTHS);

  let store = {};
  try { store = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')); } catch {}
  if (!store.github) store.github = {};

  let added = 0, skipped = 0, failed = 0;
  for (const repo of REPOS) {
    const metric = `${repo}.stars`;
    if (!store.github[metric]) store.github[metric] = {};
    try {
      process.stdout.write(`Fetching stargazer timestamps for ${repo}… `);
      const stamps = await starTimestamps(repo);
      console.log(`${stamps.length} stars`);
      for (const anchor of anchors) {
        if (store.github[metric][anchor] != null) { skipped++; continue; }
        // stamps is sorted ascending → count of stars on or before the cutoff
        let lo = 0, hi = stamps.length;
        while (lo < hi) { const mid = (lo + hi) >> 1; if (stamps[mid] <= anchor) lo = mid + 1; else hi = mid; }
        store.github[metric][anchor] = lo;
        added++;
      }
      console.log(`  ✓ ${repo}: wrote ${anchors.length} monthly points`);
    } catch (e) {
      console.warn(`  ✗ ${repo}: ${e.message}`);
      failed++;
    }
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(store)); // persist per-repo in case of interruption
  }

  console.log(`\nDone. ${added} points added, ${skipped} already present, ${failed} repos failed.`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
