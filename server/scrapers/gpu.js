const axios = require('axios');
const path = require('path');
const storage = require('../storage');

// Live GPU rental pricing from the vast.ai marketplace API (no auth needed for
// read-only market data). vast.ai is a community/spot marketplace, so it exposes
// two rates per offer:
//   • dph_total — the on-demand $/hr you pay to hold the instance
//   • min_bid   — the interruptible "spot" bid floor (auction; can be preempted)
// We record the median of each across verified single-GPU offers per day and
// accumulate our own history. No public archive of vast.ai spot prices exists,
// so the time series starts the day this scraper first runs and grows daily —
// we no longer ship fabricated/interpolated pre-history.
const HISTORY_FILE = path.join(__dirname, '..', 'data', 'gpuHistory.json');

// GPU names as vast.ai reports them (spaces). We normalize to underscores for
// stable object keys. Keep the list to mainstream AI accelerators with real
// marketplace supply; vast.ai returns nothing for absent models, which we skip.
const VAST_GPUS = ['H100 SXM', 'H100 PCIE', 'H100 NVL', 'H200', 'B200', 'A100 SXM4', 'A100 PCIE', 'RTX 5090', 'RTX 4090'];

const KEY_ALIASES = {
  H100_SXM_New: 'H100_SXM',
  A100_SXM4: 'A100_SXM',
  A100_PCIE: 'A100_PCIe',
  H100_PCIE: 'H100_PCIe',
};

// Minimum verified offers before we record a daily median. We keep thin-supply
// markets too (sample count is persisted as `n`) so H100 SXM / A100 SXM4 /
// B200-style listings do not silently disappear on sparse marketplace days.
const MIN_SAMPLES_OD   = 1;
const MIN_SAMPLES_SPOT = 1;

const DAY_MS = 86400000;

function normalizeKey(key) {
  return KEY_ALIASES[key] ?? key;
}

const BLOB = 'gpuHistory';

function loadHistory() {
  const raw = storage.read(BLOB, HISTORY_FILE);
  const out = {};
  for (const [date, day] of Object.entries(raw)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    // Migrate legacy flat shape { gpu: number } → { gpu: { od: number } }
    out[date] = Object.fromEntries(
      Object.entries(day).map(([g, v]) => [
        normalizeKey(g),
        typeof v === 'number' ? { od: v } : v,
      ])
    );
  }
  return out;
}

function saveHistory(history) {
  storage.write(BLOB, HISTORY_FILE, history);
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

// Trimmed median: drop the cheapest/priciest 10% before taking the middle, so
// a single mis-priced listing can't swing the marketplace rate.
function trimmedMedian(values) {
  const a = values.filter(Number.isFinite).sort((x, y) => x - y);
  if (a.length === 0) return null;
  const cut = Math.floor(a.length * 0.1);
  const core = a.length >= 5 ? a.slice(cut, a.length - cut) : a;
  return core[Math.floor(core.length / 2)];
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
    { timeout: 20000 }
  );

  const byGpu = {};
  (data.offers || []).forEach(o => {
    const g = normalizeKey(o.gpu_name.replace(/ /g, '_'));
    if (!byGpu[g]) byGpu[g] = { od: [], spot: [] };
    if (Number.isFinite(o.dph_total)) byGpu[g].od.push(o.dph_total);
    // A bid floor at/above the on-demand rate is irrational noise — drop it.
    if (Number.isFinite(o.min_bid) && o.min_bid < o.dph_total) byGpu[g].spot.push(o.min_bid);
  });

  const prices = {};        // on-demand median $/hr
  const spot = {};          // interruptible (bid) median $/hr
  const availability = {};  // count of verified single-GPU offers
  for (const [gpu, s] of Object.entries(byGpu)) {
    availability[gpu] = s.od.length;
    if (s.od.length >= MIN_SAMPLES_OD) {
      const m = trimmedMedian(s.od);
      if (m != null) prices[gpu] = +m.toFixed(2);
    }
    if (s.spot.length >= MIN_SAMPLES_SPOT) {
      const m = trimmedMedian(s.spot);
      if (m != null) spot[gpu] = +m.toFixed(2);
    }
  }
  return { prices, spot, availability };
}

function buildHistoryPayload(history) {
  const snapshotDates = Object.keys(history).sort();
  if (snapshotDates.length === 0) {
    return { dates: [], series: {}, spotSeries: {}, index: [] };
  }

  const dates = dailyDates(snapshotDates[0], isoDay(Date.now()));
  const dateIdx = Object.fromEntries(dates.map((d, i) => [d, i]));
  const gpus = [...new Set(snapshotDates.flatMap(d => Object.keys(history[d])))];

  // Linear interpolation between real snapshot anchors (forward-filled after the
  // last) so an occasional missed scrape day doesn't render as a flat step. This
  // only ever connects real data points — it never invents pre-history.
  function fill(field) {
    const series = {};
    for (const g of gpus) {
      const anchors = snapshotDates
        .filter(d => Number.isFinite(history[d][g]?.[field]) && dateIdx[d] != null)
        .map(d => ({ i: dateIdx[d], v: history[d][g][field] }));
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
    return series;
  }

  const series = fill('od');
  const spotSeries = fill('spot');

  // Raw (non-interpolated) on-demand series: the real daily median where a model
  // was actually quoted that day, null otherwise. The forward-filled `series`
  // above keeps lines continuous; `rawSeries` is what the by-model tiles read so
  // their price/7d/30d reflect real quotes (and a thin-supply model reads its
  // last real date, not a fabricated flat carry-forward).
  const rawSeries = {};
  const rawSpotSeries = {};
  for (const g of gpus) {
    rawSeries[g] = dates.map(d => (Number.isFinite(history[d]?.[g]?.od) ? history[d][g].od : null));
    rawSpotSeries[g] = dates.map(d => (Number.isFinite(history[d]?.[g]?.spot) ? history[d][g].spot : null));
  }

  // Mainstream rental benchmark: simple average on-demand $/hr across the GPUs
  // priced that day. A 7-day centered moving average smooths daily sampling noise.
  const raw = dates.map((_, i) => {
    const present = gpus.map(g => series[g][i]).filter(Number.isFinite);
    return present.length ? present.reduce((a, b) => a + b, 0) / present.length : null;
  });
  const index = raw.map((v, i) => {
    if (v == null) return null;
    let sum = 0, n = 0;
    for (let j = Math.max(0, i - 3); j <= Math.min(raw.length - 1, i + 3); j++) {
      if (raw[j] != null) { sum += raw[j]; n++; }
    }
    return +(sum / n).toFixed(3);
  });

  return { dates, series, spotSeries, rawSeries, rawSpotSeries, index };
}

async function getGpuPrices() {
  const market = await getVastPrices().catch(e => {
    console.warn('[gpu] vast.ai fetch failed:', e.message);
    return { prices: {}, spot: {}, availability: {} };
  });
  const { prices, spot, availability } = market;
  const history = loadHistory();

  // Append today's snapshot (same-day re-scrapes overwrite with latest medians)
  if (Object.keys(prices).length > 0) {
    const today = isoDay(Date.now());
    history[today] = Object.fromEntries(
      Object.keys(prices).map(g => [g, {
        od: prices[g],
        ...(spot[g] != null ? { spot: spot[g] } : {}),
        n: availability[g],
      }])
    );
    saveHistory(history);
  }

  const historyPayload = buildHistoryPayload(history);
  if (Object.keys(prices).length === 0 && historyPayload.dates.length === 0) return null;

  return {
    prices,
    spot,
    availability,
    history: historyPayload,
    asOf: new Date().toISOString().slice(0, 10),
    methodology: 'Live vast.ai marketplace medians across verified single-GPU offers, recorded daily. On-demand = dph_total; spot = the interruptible min_bid floor. Both use a 10% trimmed median when enough samples exist, and preserve the verified-offer count so thin-supply model quotes are still visible instead of being dropped. The time series accumulates from the day scraping began — there is no public archive of vast.ai spot history to backfill.',
  };
}

module.exports = { getGpuPrices };
