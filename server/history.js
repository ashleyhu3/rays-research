'use strict';
const fs   = require('fs');
const path = require('path');

// Daily snapshot store for point-in-time metrics (job counts, stars,
// subscribers, filing counts…) so the dashboard can chart their trend.
// Shape: { [source]: { [metric]: { 'YYYY-MM-DD': value } } }
// One value per metric per UTC day; same-day re-scrapes overwrite.
const FILE = path.join(__dirname, 'data', 'metricsHistory.json');

let store = null;

function load() {
  if (store) return store;
  try { store = JSON.parse(fs.readFileSync(FILE, 'utf8')); }
  catch { store = {}; }
  return store;
}

function persist() {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(store));
  } catch (e) {
    console.warn('[history] could not persist:', e.message);
  }
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

// metrics: flat { metricName: numericValue }; non-finite values are skipped
function record(source, metrics) {
  const s = load();
  const day = today();
  if (!s[source]) s[source] = {};
  let changed = false;
  for (const [name, value] of Object.entries(metrics)) {
    if (!Number.isFinite(value)) continue;
    if (!s[source][name]) s[source][name] = {};
    s[source][name][day] = value;
    changed = true;
  }
  if (changed) persist();
}

// Flatteners: cache payload per source → { metricName: value }
const EXTRACTORS = {
  jobs(data) {
    const out = {};
    for (const [co, v] of Object.entries(data ?? {})) {
      if (v?.total       != null) out[`${co}.total`]       = v.total;
      if (v?.engineering != null) out[`${co}.engineering`] = v.engineering;
    }
    return out;
  },
  github(data) {
    const out = {};
    for (const [repo, v] of Object.entries(data ?? {})) {
      if (v?.stars      != null) out[`${repo}.stars`]      = v.stars;
      if (v?.dependents != null) out[`${repo}.dependents`] = v.dependents;
    }
    return out;
  },
  mcp(data) {
    const out = {};
    for (const [q, v] of Object.entries(data?.queries ?? {})) {
      out[`${q}.total`] = v.total;
      out[`${q}.new7d`] = v.new7d;
    }
    if (data?.serversRepo?.stars != null) out['servers.stars'] = data.serversRepo.stars;
    return out;
  },
  sec(data) {
    const out = {};
    for (const [term, v] of Object.entries(data?.terms ?? {})) {
      if (v?.last90d != null) out[`${term}.filings90d`] = v.last90d;
    }
    return out;
  },
  gpu(data) {
    const out = {};
    for (const [g, n] of Object.entries(data?.availability ?? {})) {
      out[`${g}.offers`] = n;
    }
    return out;
  },
  huggingface(data) {
    const out = {};
    for (const [fam, v] of Object.entries(data?.families ?? {})) {
      if (v?.downloads != null) out[`${fam}.downloads`] = v.downloads;
    }
    if (data?.newModels?.perDay != null) out['hub.newModelsPerDay'] = data.newModels.perDay;
    return out;
  },
  stackoverflow(data) {
    const out = {};
    for (const [tag, n] of Object.entries(data?.totals ?? {})) {
      if (n != null) out[`${tag}.questions`] = n;
    }
    for (const [tag, n] of Object.entries(data?.weekly ?? {})) {
      if (n != null) out[`${tag}.newThisWeek`] = n;
    }
    return out;
  },
  docker(data) {
    const out = {};
    for (const [img, v] of Object.entries(data?.images ?? {})) {
      if (v?.pulls) out[`${img}.pulls`] = v.pulls;
    }
    return out;
  },
};

// Called by the scheduler after every successful scrape
function snapshot(source, data) {
  const extract = EXTRACTORS[source];
  if (!extract || data == null) return;
  try { record(source, extract(data)); }
  catch (e) { console.warn(`[history] snapshot ${source} failed:`, e.message); }
}

// { dates: ['YYYY-MM-DD'…], values: [n…] } sorted ascending
function series(source, metric) {
  const m = load()[source]?.[metric];
  if (!m) return null;
  const dates = Object.keys(m).sort();
  return { dates, values: dates.map(d => m[d]) };
}

function all() {
  return load();
}

module.exports = { record, snapshot, series, all };
