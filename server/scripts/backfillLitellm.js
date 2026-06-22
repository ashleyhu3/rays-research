/**
 * One-time backfill of LLM API token-price history.
 *
 * The live `litellm` scraper records, once per day, each tracked model's
 * official input/output list price (metrics `{label}.input` / `{label}.output`).
 * That only starts a trend the day the server first runs. This script fills the
 * preceding ~N days using the LiteLLM cost map's own git history: for each day
 * it finds the last commit that touched the file on/before that day, fetches the
 * file as it stood at that commit, and runs the SAME model-selection rules.
 *
 * Points are written into server/data/metricsHistory.json under the same
 * `litellm` source and `{label}.input` / `{label}.output` metric keys the
 * scheduler appends to, so live snapshots continue seamlessly. Existing dates
 * are never overwritten.
 *
 * Set GITHUB_TOKEN to raise the commits-API rate limit (60/hr → 5000/hr).
 *
 * Usage: node server/scripts/backfillLitellm.js [days]   (default 30)
 */
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { selectModels } = require('../scrapers/litellm');

const REPO = 'BerriAI/litellm';
const FILE_PATH = 'model_prices_and_context_window.json';
const HISTORY_FILE = path.join(__dirname, '..', 'data', 'metricsHistory.json');
const DAYS = Math.max(1, parseInt(process.argv[2], 10) || 30);

const UA = 'signal-dashboard/1.0 research contact: ashley_hu1@brown.edu';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const iso = d => d.toISOString().slice(0, 10);

function ghHeaders() {
  const h = { 'User-Agent': UA, Accept: 'application/vnd.github+json' };
  if (process.env.GITHUB_TOKEN) h.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return h;
}

// Latest commit that touched the file at or before `untilIso`. One cheap call
// (per_page=1) per sampled date — this sidesteps the pagination ceiling on a
// file that's edited dozens of times a day, so a full year stays affordable.
async function latestShaBefore(untilIso) {
  const { data } = await axios.get(`https://api.github.com/repos/${REPO}/commits`, {
    params: { path: FILE_PATH, until: `${untilIso}T23:59:59Z`, per_page: 1 },
    headers: ghHeaders(),
    timeout: 25000,
  });
  return Array.isArray(data) && data[0]?.sha ? data[0].sha : null;
}

// Raw file content at a specific commit, parsed.
async function fileAt(sha) {
  const { data } = await axios.get(
    `https://raw.githubusercontent.com/${REPO}/${sha}/${FILE_PATH}`,
    { headers: { 'User-Agent': UA }, timeout: 30000, responseType: 'json' }
  );
  return data;
}

async function main() {
  const now = new Date();
  // Daily resolution for short windows; weekly for long ones, so a full year is
  // ~52 API calls instead of one per day (list prices change rarely — weekly
  // sampling loses no real signal). Override with LITELLM_BACKFILL_STEP days.
  const step = Number(process.env.LITELLM_BACKFILL_STEP) || (DAYS > 45 ? 7 : 1);
  const sampleDays = [];
  for (let i = DAYS; i >= 0; i -= step) sampleDays.push(iso(new Date(now.getTime() - i * 86400000)));
  console.log(`[backfill litellm] ${DAYS}d window, ${sampleDays.length} sample points (every ${step}d)`);

  // Resolve the latest commit at/before each sampled day (cheap, one call each).
  const byDay = new Map();
  for (const day of sampleDays) {
    try {
      const sha = await latestShaBefore(day);
      if (sha) byDay.set(day, sha);
    } catch (e) {
      console.warn(`[backfill litellm] commit lookup for ${day} failed:`, e.message);
    }
    await sleep(200);
  }
  if (byDay.size === 0) {
    console.log('[backfill litellm] no commits resolved — nothing to do');
    return;
  }

  // Resolve prices per distinct commit once, then map onto the days it covers.
  const store = (() => { try { return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')); } catch { return {}; } })();
  store.litellm = store.litellm || {};
  const priceCache = new Map(); // sha → models
  let written = 0;

  for (const [day, sha] of byDay) {
    try {
      if (!priceCache.has(sha)) {
        const map = await fileAt(sha);
        priceCache.set(sha, selectModels(map));
        await sleep(300);
      }
      for (const m of priceCache.get(sha)) {
        for (const field of ['input', 'output']) {
          if (!Number.isFinite(m[field])) continue;
          const metric = `${m.label}.${field}`;
          store.litellm[metric] = store.litellm[metric] || {};
          if (day in store.litellm[metric]) continue; // never overwrite live/prior data
          store.litellm[metric][day] = m[field];
          written++;
        }
      }
    } catch (e) {
      console.warn(`[backfill litellm] ${day} (${sha.slice(0, 7)}) failed:`, e.message);
    }
  }

  fs.mkdirSync(path.dirname(HISTORY_FILE), { recursive: true });
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(store, null, 2));
  console.log(`[backfill litellm] wrote ${written} points across ${byDay.size} days → ${HISTORY_FILE}`);
}

main().catch(e => { console.error('[backfill litellm] fatal:', e.message); process.exit(1); });
