'use strict';
const axios = require('axios');
const path = require('path');
const storage = require('../storage');

/**
 * Average GPU rental price across the major clouds — in $ per GPU per hour,
 * on-demand list price (the one apples-to-apples number available everywhere).
 *
 * COLLECTION: each daily run fetches live prices where a provider exposes a
 * stable public price feed (see LIVE_FETCHERS below) and falls back to the
 * curated FALLBACK table for everything else. The merged result is recorded as
 * one snapshot per UTC day and the chart forward-fills from it, so the series
 * accumulates forward from the day collection began (no backfill). This runs
 * unattended in the daily GitHub Action (server/scripts/collect.js).
 *
 * Live, no setup:  Azure (Retail Prices API), Oracle (OCI price catalogue),
 *                  Nebius (published rates). All no-auth.
 * Live, opt-in:    AWS (Price List Query API — set AWS_ACCESS_KEY_ID /
 *                  AWS_SECRET_ACCESS_KEY), GCP (set GCP_BILLING_API_KEY).
 * Fallback only:   CoreWeave (contact-sales — publishes no public $/hr), plus
 *                  any platform+GPU a live feed doesn't return on a given run.
 *
 *   ┌─────────────────────────────────────────────────────────────────────┐
 *   │  FALLBACK — on-demand list price, USD per GPU per hour. Only used     │
 *   │  when no live feed covers that platform+GPU (notably CoreWeave, and   │
 *   │  AWS/GCP until their keys are set). Update if it drifts.              │
 *   └─────────────────────────────────────────────────────────────────────┘
 */
const FALLBACK = {
  //            A100    H100    H200    B200     R400
  aws:       { A100: 3.91, H100: 12.29, H200: 13.10, B200: 9.84 },
  azure:     { A100: 3.40, H100: 6.98,  H200: 9.00 },
  gcp:       { A100: 3.67, H100: 11.06, H200: 11.55 },
  coreweave: { A100: 2.21, H100: 4.76,  H200: 6.31,  B200: 6.79 },
  nebius:    { A100: 1.55, H100: 2.95,  H200: 3.50,  B200: 5.50 },
  oracle:    { A100: 3.05, H100: 10.00, H200: 10.00, B200: 10.00 },
  // R400 (NVIDIA Rubin) has no published pricing yet — add cells when it ships.
};

/* ──────────────────────────────────────────────────────────────────────────
 * Live price fetchers. Each returns { GPU: $/gpu/hr } (any subset) and must
 * resolve to {} on any failure so the FALLBACK value is used instead — a live
 * feed only ever *overrides* the table when it returns a real number, so the
 * chart can never break or go blank because a provider changed their site.
 * ────────────────────────────────────────────────────────────────────────── */

const keep = (out, gpu, price) => {
  if (Number.isFinite(price) && price > 0) out[gpu] = out[gpu] != null ? Math.min(out[gpu], price) : price;
};

// Azure Retail Prices API (public, no auth). Per-GPU on-demand $/hr = the VM's
// hourly Consumption price ÷ the GPU count of that SKU. Queried per SKU across
// ALL regions (some GPUs, e.g. H200, aren't offered in every region) and the
// cheapest region wins. Spot / Low Priority meters are excluded.
const AZURE_SKUS = {
  Standard_NC24ads_A100_v4: { gpu: 'A100', gpus: 1 }, // A100 80GB
  Standard_ND96isr_H100_v5: { gpu: 'H100', gpus: 8 }, // H100 80GB SXM
  Standard_ND96isr_H200_v5: { gpu: 'H200', gpus: 8 }, // H200 141GB
};
async function fetchAzure() {
  const out = {};
  for (const [sku, m] of Object.entries(AZURE_SKUS)) {
    const filter = `serviceName eq 'Virtual Machines' and priceType eq 'Consumption' and armSkuName eq '${sku}'`;
    let url = `https://prices.azure.com/api/retail/prices?currencyCode=USD&$filter=${encodeURIComponent(filter)}`;
    for (let page = 0; url && page < 6; page++) {
      const { data } = await axios.get(url, { timeout: 20000 });
      for (const it of data.Items || []) {
        const label = `${it.skuName} ${it.meterName}`.toLowerCase();
        if (label.includes('spot') || label.includes('low priority')) continue;
        if (!(it.unitPrice > 0)) continue;
        keep(out, m.gpu, it.unitPrice / m.gpus);
      }
      url = data.NextPageLink;
    }
  }
  return out;
}

// Oracle Cloud (OCI) — the price-list page is a SPA backed by this public,
// no-auth JSON catalogue. We take the "Compute - GPU" SKUs billed "GPU Per Hour"
// (excluding the NVIDIA-AI-Enterprise software add-on and on-prem variants).
async function fetchOracle() {
  const { data } = await axios.get(
    'https://apexapps.oracle.com/pls/apex/cetools/api/v1/products/?currencyCode=USD',
    { timeout: 25000 }
  );
  const MAP = [
    { gpu: 'A100', re: /Compute - GPU - A100\b/i },
    { gpu: 'H100', re: /Compute - GPU - H100T?\b/i }, // "H100" and legacy "H100T"
    { gpu: 'H200', re: /Compute - GPU - H200\b/i },
    { gpu: 'B200', re: /Compute - GPU - B200\b/i },   // \b keeps GB200 out
  ];
  const out = {};
  for (const it of data.items || []) {
    if (it.metricName !== 'GPU Per Hour' || it.serviceCategory !== 'Compute - GPU') continue;
    if (/NVIDIA AI Enterprise|VMware|Cloud@Customer/i.test(it.displayName || '')) continue;
    const hit = MAP.find(x => x.re.test(it.displayName || ''));
    if (!hit) continue;
    const prices = it.currencyCodeLocalizations?.[0]?.prices || [];
    const p = (prices.find(x => x.model === 'PAY_AS_YOU_GO') ?? prices[0])?.value;
    keep(out, hit.gpu, p);
  }
  return out;
}

// Nebius — no price API; the published on-demand rates live in the Next.js
// __NEXT_DATA__ blob as table rows like ["NVIDIA HGX H100", …, "$2.15", "$3.85"]
// where the larger price is on-demand (the smaller is the commitment rate). This
// is best-effort: any structural change just yields {} and falls back.
async function fetchNebius() {
  const { data: html } = await axios.get('https://nebius.com/prices', {
    timeout: 25000, headers: { 'User-Agent': 'Mozilla/5.0' },
  });
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return {};
  const rows = [];
  (function walk(o) {
    if (typeof o === 'string') {
      // Nebius nests the price table as a JSON string inside __NEXT_DATA__.
      if (o.includes('NVIDIA HGX') && /^[[{]/.test(o.trim())) { try { walk(JSON.parse(o)); } catch { /* not JSON */ } }
    } else if (Array.isArray(o)) {
      if (typeof o[0] === 'string' && /NVIDIA\s+HGX/i.test(o[0])) rows.push(o);
      o.forEach(walk);
    } else if (o && typeof o === 'object') {
      for (const k in o) walk(o[k]);
    }
  })(JSON.parse(m[1]));
  const MAP = [
    { gpu: 'A100', re: /\bA100\b/i },
    { gpu: 'H100', re: /\bH100\b/i },
    { gpu: 'H200', re: /\bH200\b/i },
    { gpu: 'B200', re: /\bB200\b/i },
  ];
  const out = {};
  for (const row of rows) {
    const hit = MAP.find(x => x.re.test(row[0]));
    if (!hit) continue;
    const prices = row.filter(c => typeof c === 'string' && /^\$\d/.test(c)).map(c => parseFloat(c.slice(1)));
    if (prices.length) keep(out, hit.gpu, Math.max(...prices)); // on-demand = higher rate
  }
  return out;
}

// AWS — official Price List Query API. Needs IAM credentials (AWS_ACCESS_KEY_ID /
// AWS_SECRET_ACCESS_KEY), so it no-ops without them and AWS uses FALLBACK. Pulls
// the on-demand $/hr for each GPU instance type in us-east-1 and divides by the
// GPU count. Lazy-requires the SDK so the dependency is optional at runtime.
const AWS_INSTANCES = {
  'p4d.24xlarge':     { gpu: 'A100', gpus: 8 },
  'p5.48xlarge':      { gpu: 'H100', gpus: 8 },
  'p5e.48xlarge':     { gpu: 'H200', gpus: 8 },
  'p6-b200.48xlarge': { gpu: 'B200', gpus: 8 },
};
async function fetchAws() {
  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) return {};
  let PricingClient, GetProductsCommand;
  try { ({ PricingClient, GetProductsCommand } = require('@aws-sdk/client-pricing')); }
  catch { return {}; }
  const client = new PricingClient({ region: 'us-east-1' });
  const out = {};
  for (const [type, m] of Object.entries(AWS_INSTANCES)) {
    try {
      const res = await client.send(new GetProductsCommand({
        ServiceCode: 'AmazonEC2',
        MaxResults: 10,
        Filters: [
          { Type: 'TERM_MATCH', Field: 'instanceType',    Value: type },
          { Type: 'TERM_MATCH', Field: 'operatingSystem',  Value: 'Linux' },
          { Type: 'TERM_MATCH', Field: 'tenancy',          Value: 'Shared' },
          { Type: 'TERM_MATCH', Field: 'capacityStatus',   Value: 'Used' },
          { Type: 'TERM_MATCH', Field: 'preInstalledSw',   Value: 'NA' },
          { Type: 'TERM_MATCH', Field: 'regionCode',       Value: 'us-east-1' },
        ],
      }));
      for (const entry of res.PriceList || []) {
        const prod = typeof entry === 'string' ? JSON.parse(entry) : entry;
        const term = Object.values(prod.terms?.OnDemand || {})[0];
        const dim = term && Object.values(term.priceDimensions || {})[0];
        const usd = dim && parseFloat(dim.pricePerUnit?.USD);
        if (usd > 0) keep(out, m.gpu, usd / m.gpus);
      }
    } catch { /* skip this instance type; FALLBACK covers it */ }
  }
  return out;
}

// GCP Cloud Billing Catalog API — only if a (free) API key is provided, since
// it requires one. Without GCP_BILLING_API_KEY this no-ops and GCP uses FALLBACK.
async function fetchGcp() {
  const key = process.env.GCP_BILLING_API_KEY;
  if (!key) return {};
  // Compute Engine service id is well-known: services/6F81-5844-456A
  const base = `https://cloudbilling.googleapis.com/v1/services/6F81-5844-456A/skus?key=${key}&currencyCode=USD&pageSize=5000`;
  const WANT = [
    { gpu: 'A100', re: /A100 80GB GPU running/i },
    { gpu: 'H100', re: /H100 80GB GPU running/i },
    { gpu: 'H200', re: /H200 GPU running/i },
    { gpu: 'B200', re: /B200 GPU running/i },
  ];
  const out = {};
  let pageToken = '';
  for (let page = 0; page < 6; page++) {
    const { data } = await axios.get(base + (pageToken ? `&pageToken=${pageToken}` : ''), { timeout: 20000 });
    for (const sku of data.skus || []) {
      const desc = sku.description || '';
      if (/commitment|spot|preemptible/i.test(desc)) continue;
      const want = WANT.find(w => w.re.test(desc));
      if (!want) continue;
      const tier = sku.pricingInfo?.[0]?.pricingExpression?.tieredRates?.slice(-1)?.[0]?.unitPrice;
      if (!tier) continue;
      keep(out, want.gpu, (Number(tier.units) || 0) + (Number(tier.nanos) || 0) / 1e9);
    }
    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }
  return out;
}

const LIVE_FETCHERS = {
  azure:  fetchAzure,   // no auth
  oracle: fetchOracle,  // no auth
  nebius: fetchNebius,  // no auth (best-effort page parse)
  aws:    fetchAws,     // opt-in: AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY
  gcp:    fetchGcp,     // opt-in: GCP_BILLING_API_KEY
  // coreweave: contact-sales only — no public $/hr to fetch; uses FALLBACK.
};

// Merge live prices over the FALLBACK table. Returns the effective price table
// plus the list of platforms that contributed at least one live number today.
async function effectivePrices() {
  const prices = Object.fromEntries(Object.entries(FALLBACK).map(([p, g]) => [p, { ...g }]));
  const live = [];
  const results = await Promise.allSettled(
    Object.entries(LIVE_FETCHERS).map(async ([plat, fn]) => [plat, await fn()])
  );
  for (const r of results) {
    if (r.status !== 'fulfilled') {
      console.warn('[cloudGpu] live fetch failed:', r.reason?.message);
      continue;
    }
    const [plat, fetched] = r.value;
    let used = 0;
    for (const [gpu, price] of Object.entries(fetched)) {
      if (Number.isFinite(price) && price > 0) { (prices[plat] ??= {})[gpu] = +price.toFixed(2); used++; }
    }
    if (used > 0) live.push(PLATFORM_LABELS[plat]);
  }
  return { prices, live };
}

// Human-readable platform names (for the source line / methodology).
const PLATFORM_LABELS = {
  aws: 'AWS', azure: 'Azure', gcp: 'GCP',
  coreweave: 'CoreWeave', nebius: 'Nebius', oracle: 'Oracle',
};

// Chart lines → which raw GPUs feed each. H100 pools H100 and H200 together.
const BUCKETS = {
  A100: ['A100'],
  H100: ['H100', 'H200'],
  B200: ['B200'],
  R400: ['R400'],
};

const HISTORY_FILE = path.join(__dirname, '..', 'data', 'cloudGpuHistory.json');
const BLOB = 'cloudGpuHistory';
const DAY_MS = 86400000;

const isoDay = ms => new Date(ms).toISOString().slice(0, 10);

function loadHistory() {
  const raw = storage.read(BLOB, HISTORY_FILE) ?? {};
  const out = {};
  for (const [d, v] of Object.entries(raw)) if (/^\d{4}-\d{2}-\d{2}$/.test(d)) out[d] = v;
  return out;
}
function saveHistory(h) { storage.write(BLOB, HISTORY_FILE, h); }

function dailyDates(start, end) {
  const a = Date.parse(start + 'T00:00:00Z'), b = Date.parse(end + 'T00:00:00Z');
  if (!Number.isFinite(a) || !Number.isFinite(b) || a > b) return [];
  const out = [];
  for (let t = a; t <= b; t += DAY_MS) out.push(isoDay(t));
  return out;
}

// Flatten an effective price table into a day's snapshot of "platform.GPU" → price.
function flattenSnapshot(prices) {
  const snap = {};
  for (const [plat, gpus] of Object.entries(prices)) {
    for (const [gpu, price] of Object.entries(gpus)) {
      if (Number.isFinite(price)) snap[`${plat}.${gpu}`] = price;
    }
  }
  return snap;
}

// Forward-filled daily series per "platform.GPU" key. Connects real anchors and
// carries the last value forward, so a missed scrape day reads as flat, not a
// gap, and a future table edit only affects days from that edit onward.
function buildPayload(history) {
  const days = Object.keys(history).sort();
  if (days.length === 0) return { dates: [], series: {}, current: {} };
  const dates = dailyDates(days[0], isoDay(Date.now()));
  const idx = Object.fromEntries(dates.map((d, i) => [d, i]));
  const keys = [...new Set(days.flatMap(d => Object.keys(history[d])))];

  const filled = {};
  for (const k of keys) {
    const anchors = days
      .filter(d => Number.isFinite(history[d][k]) && idx[d] != null)
      .map(d => ({ i: idx[d], v: history[d][k] }));
    const vals = new Array(dates.length).fill(null);
    for (let a = 0; a < anchors.length; a++) {
      const cur = anchors[a], next = anchors[a + 1];
      vals[cur.i] = cur.v;
      const end = next ? next.i : dates.length;
      for (let i = cur.i + 1; i < end; i++) vals[i] = cur.v; // forward-fill
    }
    filled[k] = vals;
  }

  // Per bucket per day: average the relevant "platform.GPU" values across all
  // platforms that have a price that day.
  const series = {};
  const current = {};
  for (const [bucket, gpus] of Object.entries(BUCKETS)) {
    const bucketKeys = keys.filter(k => gpus.includes(k.split('.')[1]));
    if (bucketKeys.length === 0) { series[bucket] = dates.map(() => null); current[bucket] = null; continue; }
    series[bucket] = dates.map((_, i) => {
      const present = bucketKeys.map(k => filled[k][i]).filter(Number.isFinite);
      return present.length ? +(present.reduce((a, b) => a + b, 0) / present.length).toFixed(2) : null;
    });
    current[bucket] = series[bucket].at(-1) ?? null;
  }

  return { dates, series, current };
}

async function getCloudGpuPrices() {
  const history = loadHistory();

  // Fetch live prices where available, merge over the fallback table, and record
  // today's snapshot (same-day re-runs overwrite with the latest numbers).
  const { prices, live } = await effectivePrices();
  const snap = flattenSnapshot(prices);
  if (Object.keys(snap).length > 0) {
    history[isoDay(Date.now())] = snap;
    saveHistory(history);
  }

  const payload = buildPayload(history);
  if (payload.dates.length === 0) return null;

  const liveNote = live.length
    ? `Live today from ${live.join(', ')}; other platforms use maintained reference rates.`
    : 'Using maintained reference rates (no live feed reachable this run).';

  return {
    ...payload,
    platforms: Object.values(PLATFORM_LABELS),
    live,
    asOf: isoDay(Date.now()),
    methodology: `Average on-demand list price in $ per GPU per hour across ${Object.values(PLATFORM_LABELS).join(', ')}. Each line is the mean across whichever of those platforms publish that GPU; the H100 line pools H100 and H200. Prices are fetched live where a provider exposes a public price feed and fall back to maintained reference rates otherwise, recorded daily — the series accumulates forward from the day collection began (no backfill). ${liveNote}`,
  };
}

module.exports = { getCloudGpuPrices, FALLBACK, BUCKETS };
