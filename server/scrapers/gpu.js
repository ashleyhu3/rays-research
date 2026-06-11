const axios = require('axios');
const fs = require('fs');
const path = require('path');

// No public archive of GPU spot prices exists, so accumulate our own daily
// history of the scraped medians: { 'YYYY-MM-DD': { gpuName: $/hr } }
const HISTORY_FILE = path.join(__dirname, '..', 'data', 'gpuHistory.json');

function loadHistory() {
  try { return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')); } catch { return {}; }
}

function saveHistory(history) {
  try {
    fs.mkdirSync(path.dirname(HISTORY_FILE), { recursive: true });
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history));
  } catch (e) {
    console.warn('[gpu] could not persist history:', e.message);
  }
}

// vast.ai public bundle API (no auth required for read-only spot prices).
// gpu_name values use spaces on vast.ai (e.g. "H100 SXM"); we normalize keys
// to underscores for stable use as object keys downstream.
const VAST_GPUS = ['H100 SXM', 'H100 PCIE', 'H200', 'B200', 'A100 SXM4', 'RTX 4090'];

const KEY_ALIASES = {
  H100_SXM_New: 'H100_SXM',
  A100_SXM4: 'A100_SXM',
  RTX_6000: 'Quadro_RTX_6000',
};

const INDEX_GPUS = [
  'H100_SXM',
  'H100_PCIe',
  'H200',
  'B200',
  'A100_SXM',
  'A100_PCIe',
  'RTX_4090',
];

const DAY_MS = 86400000;

function normalizeKey(key) {
  return KEY_ALIASES[key] ?? key;
}

function normalizePrices(prices) {
  const out = {};
  for (const [key, value] of Object.entries(prices || {})) {
    const normalized = normalizeKey(key);
    if (!Number.isFinite(value)) continue;
    // Keep the lower available price when two historical labels describe the
    // same mainstream GPU variant on a single snapshot.
    out[normalized] = out[normalized] == null ? value : Math.min(out[normalized], value);
  }
  return out;
}

function isoDay(ts) {
  return new Date(ts).toISOString().slice(0, 10);
}

function dailyDates(startDate, endDate) {
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${endDate}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) return [];
  const dates = [];
  for (let t = start; t <= end; t += DAY_MS) dates.push(isoDay(t));
  return dates;
}

async function getVastPrices() {
  const q = JSON.stringify({
    verified:  { eq: true },
    external:  { eq: false },
    rentable:  { eq: true },
    rented:    { eq: false },
    num_gpus:  { eq: 1 },
    gpu_name:  { in: VAST_GPUS },
  });
  const { data } = await axios.get(
    `https://console.vast.ai/api/v0/bundles/?q=${encodeURIComponent(q)}`,
    { timeout: 15000 }
  );

  const byGpu = {};
  (data.offers || []).forEach(o => {
    const g = normalizeKey(o.gpu_name.replace(/ /g, '_'));
    if (!byGpu[g]) byGpu[g] = [];
    byGpu[g].push(o.dph_total);
  });

  const prices = {};
  const availability = {};
  Object.entries(byGpu).forEach(([gpu, samples]) => {
    samples.sort((a, b) => a - b);
    availability[gpu] = samples.length;
    prices[gpu] = parseFloat(samples[Math.floor(samples.length / 2)].toFixed(2));
  });
  return { prices, availability };
}

function buildHistoryPayload(history) {
  const snapshotDates = Object.keys(history).sort();
  if (snapshotDates.length === 0) {
    return { dates: [], snapshotDates: [], series: {}, index: [] };
  }

  const normalizedHistory = Object.fromEntries(
    snapshotDates.map(d => [d, normalizePrices(history[d])])
  );
  const dates = dailyDates(snapshotDates[0], isoDay(Date.now()));
  const gpus = [...new Set(snapshotDates.flatMap(d => Object.keys(normalizedHistory[d])))];

  const filledHistory = {};
  const lastSeen = {};
  for (const d of dates) {
    if (normalizedHistory[d]) {
      for (const [gpu, price] of Object.entries(normalizedHistory[d])) {
        lastSeen[gpu] = price;
      }
    }
    filledHistory[d] = { ...lastSeen };
  }

  const series = {};
  for (const g of gpus) {
    series[g] = dates.map(d => filledHistory[d]?.[g] ?? null);
  }

  // Mainstream index: average $/hr across comparable tracked datacenter GPUs
  // listed on each date. This avoids older workstation-only snapshot rows from
  // pulling the index away from AI accelerator pricing.
  const index = dates.map(d => {
    const vals = INDEX_GPUS
      .map(g => filledHistory[d]?.[g])
      .filter(v => Number.isFinite(v));
    return vals.length ? +(vals.reduce((s, v) => s + v, 0) / vals.length).toFixed(3) : null;
  });

  return { dates, snapshotDates, series, index };
}

async function getGpuPrices() {
  // Lambda Labs' pricing page was retired (404s) — vast.ai is the sole source now
  const market = await getVastPrices().catch(e => {
    console.warn('[gpu] vast.ai fetch failed:', e.message);
    return { prices: {}, availability: {} };
  });
  const prices = market.prices;
  const history = loadHistory();

  // Append today's snapshot (same-day re-scrapes overwrite with the latest medians)
  if (Object.keys(prices).length > 0) {
    const today = new Date().toISOString().slice(0, 10);
    history[today] = prices;
    saveHistory(history);
  }
  const historyPayload = buildHistoryPayload(history);
  if (Object.keys(prices).length === 0 && historyPayload.dates.length === 0) return null;

  return {
    prices,
    availability: market.availability,
    history: historyPayload,
    methodology: 'Historical snapshots are normalized by GPU model, then forward-filled to daily observations until the next scrape. Recent points are vast.ai median interruptible/market rates; older backfill points come from archived Lambda Labs per-GPU rental prices where no public spot archive is available.',
  };
}

module.exports = { getGpuPrices };
