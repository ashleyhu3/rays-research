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
    const g = o.gpu_name.replace(/ /g, '_');
    if (!byGpu[g]) byGpu[g] = [];
    byGpu[g].push(o.dph_total);
  });

  const out = {};
  Object.entries(byGpu).forEach(([gpu, prices]) => {
    prices.sort((a, b) => a - b);
    out[gpu] = parseFloat(prices[Math.floor(prices.length / 2)].toFixed(2));
  });
  return out;
}

async function getGpuPrices() {
  // Lambda Labs' pricing page was retired (404s) — vast.ai is the sole source now
  const prices = await getVastPrices().catch(e => {
    console.warn('[gpu] vast.ai fetch failed:', e.message);
    return {};
  });

  if (Object.keys(prices).length === 0) return null;

  // Append today's snapshot (same-day re-scrapes overwrite with the latest medians)
  const today = new Date().toISOString().slice(0, 10);
  const history = loadHistory();
  history[today] = prices;
  saveHistory(history);

  const dates  = Object.keys(history).sort();
  const gpus   = [...new Set(dates.flatMap(d => Object.keys(history[d])))];
  const series = {};
  for (const g of gpus) {
    series[g] = dates.map(d => history[d]?.[g] ?? null);
  }
  // Mainstream index: average $/hr across all GPUs listed on each date
  const index = dates.map(d => {
    const vals = Object.values(history[d]);
    return +(vals.reduce((s, v) => s + v, 0) / vals.length).toFixed(3);
  });

  return { prices, history: { dates, series, index } };
}

module.exports = { getGpuPrices };
