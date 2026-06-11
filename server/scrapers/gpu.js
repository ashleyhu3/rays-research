const axios = require('axios');
const fs = require('fs');
const path = require('path');

// No public archive of GPU spot prices exists, so accumulate our own daily
// history of the scraped medians: { 'YYYY-MM-DD': { gpuName: $/hr } }
const HISTORY_FILE = path.join(__dirname, '..', 'data', 'gpuHistory.json');

// Marketplace/spot-tier anchors read from published trackers (Silicon Data
// H100 series, AIMultiple GPU index, vast.ai medians) — see _sources inside.
// Scraped same-day snapshots take precedence over backfill anchors.
const BACKFILL_FILE = path.join(__dirname, '..', 'data', 'gpuBackfill.json');

function loadDateMap(file) {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Object.fromEntries(Object.entries(raw).filter(([k]) => /^\d{4}-\d{2}-\d{2}$/.test(k)));
  } catch { return {}; }
}

function loadHistory() {
  return loadDateMap(HISTORY_FILE);
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

  // Linear interpolation between snapshot anchors (null before a GPU's first
  // snapshot, forward-filled after its last) — sparse anchors would otherwise
  // render as long flat steps that misread as "no price movement".
  const dateIdx = Object.fromEntries(dates.map((d, i) => [d, i]));
  const series = {};
  for (const g of gpus) {
    const anchors = snapshotDates
      .filter(d => Number.isFinite(normalizedHistory[d][g]) && dateIdx[d] != null)
      .map(d => ({ i: dateIdx[d], v: normalizedHistory[d][g] }));
    const vals = new Array(dates.length).fill(null);
    for (let a = 0; a < anchors.length; a++) {
      const cur = anchors[a], next = anchors[a + 1];
      vals[cur.i] = cur.v;
      if (next) {
        const span = next.i - cur.i;
        for (let i = cur.i + 1; i < next.i; i++) {
          vals[i] = +(cur.v + (next.v - cur.v) * ((i - cur.i) / span)).toFixed(3);
        }
      } else {
        for (let i = cur.i + 1; i < dates.length; i++) vals[i] = cur.v;
      }
    }
    series[g] = vals;
  }

  const filledHistory = {};
  dates.forEach((d, i) => {
    filledHistory[d] = Object.fromEntries(gpus.map(g => [g, series[g][i]]).filter(([, v]) => v != null));
  });

  // Mainstream index across comparable tracked datacenter GPUs, chain-linked:
  // each day's level moves by the price ratio of the GPUs present on both
  // days, so a newly shipped GPU (H200, B200) joining the basket shifts the
  // composition without jumping the level. A 31-day centered moving average
  // then smooths the remaining anchor-date kinks into a continuous curve.
  const rawIndex = [];
  let level = null, prevSet = [];
  const avgOf = (set, d) => set.reduce((s, g) => s + filledHistory[d][g], 0) / set.length;
  for (let i = 0; i < dates.length; i++) {
    const d = dates[i];
    const present = INDEX_GPUS.filter(g => Number.isFinite(filledHistory[d]?.[g]));
    if (present.length === 0) { rawIndex.push(null); continue; }
    if (level == null) {
      level = avgOf(present, d);
    } else {
      const common = present.filter(g => prevSet.includes(g));
      // No overlap with yesterday's basket → no comparable ratio; carry the level.
      if (common.length) level *= avgOf(common, d) / avgOf(common, dates[i - 1]);
    }
    prevSet = present;
    rawIndex.push(level);
  }
  const index = rawIndex.map((v, i) => {
    if (v == null) return null;
    let sum = 0, n = 0;
    for (let j = Math.max(0, i - 15); j <= Math.min(rawIndex.length - 1, i + 15); j++) {
      if (rawIndex[j] != null) { sum += rawIndex[j]; n++; }
    }
    return +(sum / n).toFixed(3);
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
  // Published-tracker anchors fill the years before this dashboard started
  // scraping; live snapshots win whenever the dates collide.
  const merged = { ...loadDateMap(BACKFILL_FILE), ...history };
  const historyPayload = buildHistoryPayload(merged);
  if (Object.keys(prices).length === 0 && historyPayload.dates.length === 0) return null;

  return {
    prices,
    availability: market.availability,
    history: historyPayload,
    methodology: 'Recent points are vast.ai median market rates scraped daily. Pre-scrape history uses marketplace-tier anchors read from published trackers (Silicon Data H100 rental series, AIMultiple GPU index, vendor price pages), linearly interpolated between anchor dates — approximate market levels, not exact archival spot quotes. AWS official spot history only covers the last 90 days, so no public archive exists.',
  };
}

module.exports = { getGpuPrices };
