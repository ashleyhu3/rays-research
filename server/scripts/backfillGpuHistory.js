/**
 * One-time backfill of REAL historical GPU rental medians from vast.ai's
 * host/admin metrics endpoint (`/api/v0/metrics/gpu/history/`, the same data
 * the `vastai metrics gpu-trends` CLI returns).
 *
 * Unlike the public bundles API (live only), this endpoint returns a daily
 * time series of supply/demand and pricing percentiles per GPU — so it can seed
 * the years of history we otherwise can't get. It is AUTH-GATED: it needs a
 * vast.ai API key, and the account must be a host/admin (otherwise the response
 * is `{ success: true, needs_machine: true }` with no data).
 *
 *   Get a key at https://cloud.vast.ai/account/  →  export VAST_API_KEY=...
 *
 * Pricing fields used: `avail_median` = median asking price of available
 * (on-demand) offers → stored as each day's `od`. (This endpoint has no
 * interruptible/bid series; live spot continues to accrue via the scraper.)
 * Real backfilled days never overwrite live-scraped days.
 *
 * Usage: VAST_API_KEY=... node server/scripts/backfillGpuHistory.js
 */
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const HISTORY_FILE = path.join(__dirname, '..', 'data', 'gpuHistory.json');
const BASE = 'https://console.vast.ai/api/v0/metrics/gpu/history/';

// GPU names as vast.ai reports them → our underscore keys (match gpu.js).
const GPUS = ['RTX 4090', 'RTX 5090', 'H100 SXM', 'H100 PCIE', 'H100 NVL', 'H200', 'B200', 'A100 SXM4', 'A100 PCIE'];
const KEY_ALIASES = { A100_SXM4: 'A100_SXM', A100_PCIE: 'A100_PCIe', H100_PCIE: 'H100_PCIe' };
const normalizeKey = k => KEY_ALIASES[k] ?? k;

const LOOKBACK_DAYS = 365 * 2;
const STEP = 86400;            // daily points
const CHUNK_DAYS = 120;        // request in windows to stay under any range cap
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchWindow(apiKey, start, end) {
  const { data } = await axios.get(BASE, {
    params: { gpu_name: GPUS.join(','), verified: 'yes', hosting_type: 'all', start: String(start), end: String(end), step: String(STEP) },
    headers: { Authorization: `Bearer ${apiKey}` },
    timeout: 60000,
  });
  if (data?.needs_machine) {
    throw new Error('endpoint returned needs_machine: the API key must belong to a host/admin account with active machines');
  }
  return data?.gpus ?? {};
}

// Detect the auth/permission failures that won't change between windows, so we
// abort immediately with one clear message instead of retrying every chunk.
function fatalAuthError(err) {
  const msg = err.response?.data?.msg ?? '';
  if (/machine_read permission/i.test(msg)) {
    return 'The API key authenticates but lacks the "machine_read" permission group this endpoint requires. '
      + 'Create a key with machine_read at https://cloud.vast.ai/manage-keys/ (host/admin accounts only) and update VAST_API_KEY.';
  }
  if (err.response?.status === 401) return `Auth rejected (401): ${msg || 'check VAST_API_KEY'}`;
  return null;
}

async function main() {
  const apiKey = process.env.VAST_API_KEY;
  if (!apiKey) {
    console.error('VAST_API_KEY is not set. Get a key at https://cloud.vast.ai/account/ and re-run:\n  VAST_API_KEY=... node server/scripts/backfillGpuHistory.js');
    process.exit(1);
  }

  let history = {};
  try { history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')); } catch {}

  const now = Math.floor(Date.now() / 1000);
  const from = now - LOOKBACK_DAYS * 86400;

  // Accumulate the latest avail_median per (gpu, UTC day) across all windows.
  const perDay = {}; // { 'YYYY-MM-DD': { gpuKey: od } }
  for (let s = from; s < now; s += CHUNK_DAYS * 86400) {
    const e = Math.min(s + CHUNK_DAYS * 86400, now);
    const label = `${new Date(s * 1000).toISOString().slice(0, 10)}..${new Date(e * 1000).toISOString().slice(0, 10)}`;
    let gpus;
    try { gpus = await fetchWindow(apiKey, s, e); }
    catch (err) {
      const fatal = /needs_machine/.test(err.message) ? err.message : fatalAuthError(err);
      if (fatal) { console.error('✗ ' + fatal); process.exit(2); }
      console.warn(`✗ ${label}: ${err.response?.status ?? ''} ${err.message}`); await sleep(3000); continue;
    }
    let pts = 0;
    for (const [name, g] of Object.entries(gpus)) {
      const key = normalizeKey(name.replace(/ /g, '_'));
      const ts = g?.supply_demand?.timestamps ?? [];
      const med = g?.pricing?.avail_median ?? [];
      for (let i = 0; i < ts.length; i++) {
        const v = med[i];
        if (!Number.isFinite(v)) continue;
        const day = new Date(ts[i] * 1000).toISOString().slice(0, 10);
        (perDay[day] ??= {})[key] = +v.toFixed(2);
        pts++;
      }
    }
    console.log(`✓ ${label}: ${pts} points across ${Object.keys(gpus).length} GPUs`);
    await sleep(800);
  }

  // Merge: add backfilled days, but never overwrite an existing (live-scraped) day.
  let added = 0, skipped = 0;
  for (const [day, gpus] of Object.entries(perDay)) {
    if (history[day]) { skipped++; continue; }
    history[day] = Object.fromEntries(Object.entries(gpus).map(([g, od]) => [g, { od }]));
    added++;
  }

  fs.mkdirSync(path.dirname(HISTORY_FILE), { recursive: true });
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history));
  const dates = Object.keys(history).sort();
  console.log(`\nDone. ${added} historical days added, ${skipped} live days preserved.`);
  if (dates.length) console.log(`gpuHistory now spans ${dates[0]} → ${dates.at(-1)} (${dates.length} days).`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
