'use strict';
const axios = require('axios');
const path = require('path');
const storage = require('../storage');

/**
 * GCP TPU preemptible (spot) pricing — per chip per hour.
 *
 * Primary source: public GCP pricing page cloud.google.com/tpu/docs/pricing
 * (no API key needed — same best-effort page-parse approach as fetchNebius in
 * cloudGpu.js). Falls back to maintained reference rates if the page changes.
 *
 * Tracked generations: Trillium (v6e), v5p, v5e. TPU v4 has no spot/preemptible
 * option (page shows N/A) so it is omitted.
 *
 * Accumulates a daily history; the chart grows forward from the first scrape.
 */
const HISTORY_FILE = path.join(__dirname, '..', 'data', 'tpuHistory.json');
const BLOB = 'tpuHistory';
const DAY_MS = 86400000;

// Reference rates ($/chip/hr) — us-central1 / us-east1 for spot; updated from
// cloud.google.com/tpu/docs/pricing. Used when the page scrape fails or a
// generation is missing. On-demand stored for the bar chart's comparison column.
const FALLBACK = {
  v6e: { onDemand: 2.70, preemptible: 1.35 },  // Trillium
  v5p: { onDemand: 4.20, preemptible: 2.10 },
  v5e: { onDemand: 1.20, preemptible: 0.60 },
};

const isoDay = ms => new Date(ms).toISOString().slice(0, 10);

function loadHistory() { return storage.read(BLOB, HISTORY_FILE) ?? {}; }
function saveHistory(h) { storage.write(BLOB, HISTORY_FILE, h); }

function dailyDates(start, end) {
  const a = Date.parse(start + 'T00:00:00Z'), b = Date.parse(end + 'T00:00:00Z');
  const out = [];
  for (let t = a; t <= b; t += DAY_MS) out.push(isoDay(t));
  return out;
}

// Scrape the public GCP TPU pricing page (no auth). Extracts per-chip spot
// price by finding each TPU label then taking the first "$X.XX / 1 hour"
// pattern (the spot tier) and the last bare "$X.XX" before it (on-demand).
async function fetchGcpTpu() {
  let html;
  try {
    ({ data: html } = await axios.get('https://cloud.google.com/tpu/docs/pricing', {
      timeout: 25000, headers: { 'User-Agent': 'Mozilla/5.0' },
    }));
  } catch (e) {
    console.warn('[tpu] pricing page fetch failed:', e.message);
    return {};
  }

  const SECTIONS = [
    { tpu: 'v6e', label: 'Trillium' },
    { tpu: 'v5p', label: 'TPU v5p' },
    { tpu: 'v5e', label: 'TPU v5e' },
  ];

  const out = {};
  for (const { tpu, label } of SECTIONS) {
    const pos = html.indexOf(`>${label}<`);
    if (pos < 0) continue;
    const section = html.slice(pos, pos + 2000);

    const spotRe = /\$\s*([\d.]+)\s*\/\s*1\s*hour/i;
    const spotM = section.match(spotRe);
    if (!spotM) continue;

    const spotIdx = section.search(spotRe);
    const prior = section.slice(0, spotIdx);
    const odMatches = [...prior.matchAll(/\$\s*([\d.]+)/g)];
    const onDemand = odMatches.length > 0 ? parseFloat(odMatches[odMatches.length - 1][1]) : null;
    const preemptible = parseFloat(spotM[1]);

    if (Number.isFinite(preemptible) && preemptible > 0) {
      out[tpu] = { preemptible, onDemand: Number.isFinite(onDemand) ? onDemand : null };
    }
  }
  return out;
}

function buildHistory(hist) {
  const days = Object.keys(hist).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  if (days.length === 0) return { dates: [], spotSeries: {} };
  const dates = dailyDates(days[0], isoDay(Date.now()));
  const idx = Object.fromEntries(dates.map((d, i) => [d, i]));
  const keys = [...new Set(days.flatMap(d => Object.keys(hist[d])))];

  const spotSeries = {};
  for (const k of keys) {
    const anchors = days
      .filter(d => Number.isFinite(hist[d]?.[k]) && idx[d] != null)
      .map(d => ({ i: idx[d], v: hist[d][k] }));
    const vals = new Array(dates.length).fill(null);
    for (let j = 0; j < anchors.length; j++) {
      const cur = anchors[j], next = anchors[j + 1];
      vals[cur.i] = cur.v;
      const end = next ? next.i : dates.length;
      for (let i = cur.i + 1; i < end; i++) vals[i] = cur.v;
    }
    spotSeries[k] = vals;
  }
  return { dates, spotSeries };
}

async function getTpuData() {
  const live = await fetchGcpTpu();
  const usedLive = Object.keys(live).length > 0;

  const hist = loadHistory();
  const today = isoDay(Date.now());
  const current = {};
  const dayEntry = {};

  for (const [tpu, ref] of Object.entries(FALLBACK)) {
    const liveEntry = live[tpu];
    const preemptible = liveEntry?.preemptible ?? ref.preemptible;
    const onDemand    = liveEntry?.onDemand    ?? ref.onDemand;
    dayEntry[tpu] = preemptible;
    current[tpu]  = { spot: preemptible, onDemand, live: liveEntry != null };
  }

  hist[today] = dayEntry;
  saveHistory(hist);

  const history = buildHistory(hist);

  return {
    current,
    onDemand: Object.fromEntries(Object.entries(current).map(([k, v]) => [k, v.onDemand])),
    history,
    live: usedLive,
    asOf: today,
    methodology: `GCP TPU preemptible (spot) pricing per chip per hour. ${usedLive ? 'Live prices scraped from cloud.google.com/tpu/docs/pricing.' : 'Using maintained reference rates (page scrape failed this run).'} Tracked: Trillium (v6e), v5p, v5e. TPU v4 has no spot option. Cheapest us-east/us-central region price used.`,
  };
}

module.exports = { getTpuData };
