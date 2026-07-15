'use strict';
const axios = require('axios');
const path = require('path');
const storage = require('../storage');

/**
 * AWS accelerator economics — spot price, spot savings vs on-demand, and spot
 * interruption frequency — for NVIDIA datacenter GPUs and AWS's own AI silicon
 * (Trainium / Inferentia). Two layers that join into one coherent series:
 *
 *   • BACKFILL (one-time, free): exact historical per-accelerator spot $/hr from
 *     EC2 DescribeSpotPriceHistory — see scripts/backfillAwsSpot.js. Those days
 *     carry `x: true` (exact) and the script stores an implied on-demand price in
 *     `_meta.onDemand`, calibrated so the forward series joins on continuously.
 *   • FORWARD (daily, free, no credentials): the public EC2 spot pricing table
 *     gives current spot prices by region and instance type. Spot Advisor still
 *     supplies spot savings % (`s`) and interruption rating (`r`), and acts as a
 *     derived-price fallback if the pricing table is unavailable.
 *
 * Everything the forward path needs is a no-auth HTTPS GET, so it costs nothing
 * to keep running.
 */
const HISTORY_FILE = path.join(__dirname, '..', 'data', 'awsHistory.json');
const BLOB = 'awsHistory';
const ADVISOR_URL = 'https://spot-bid-advisor.s3.amazonaws.com/spot-advisor-data.json';
const PUBLIC_SPOT_URL = 'https://website.spot.ec2.aws.a2z.com/spot.json';
const DAY_MS = 86400000;

// Accelerator → the EC2 instance types that carry it and the chip count each.
// Spot/on-demand prices are per-instance, so we divide by the count.
const ACCEL = {
  H100:        { 'p5.48xlarge': 8 },
  H200:        { 'p5e.48xlarge': 8, 'p5en.48xlarge': 8 },
  A100:        { 'p4d.24xlarge': 8, 'p4de.24xlarge': 8 },
  Trainium:    { 'trn1.32xlarge': 16 },
  Inferentia2: { 'inf2.48xlarge': 12 },
};
const REGIONS = ['us-east-1', 'us-west-2', 'us-east-2'];

const INSTANCE = {};
for (const [accel, instances] of Object.entries(ACCEL)) {
  for (const [it, chips] of Object.entries(instances)) INSTANCE[it] = { accel, chips };
}

const isoDay = ms => new Date(ms).toISOString().slice(0, 10);
const median = a => { const s = a.filter(Number.isFinite).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };

function loadHistory() { return storage.read(BLOB, HISTORY_FILE) ?? {}; }
function saveHistory(h) { storage.write(BLOB, HISTORY_FILE, h); }

// Median spot savings % and interruption rating for an accelerator across its
// instance types and the queried regions.
function advisorStat(advisor, instances) {
  const sv = [], rt = [];
  for (const region of REGIONS) {
    const os = advisor.spot_advisor?.[region]?.Linux;
    if (!os) continue;
    for (const it of Object.keys(instances)) {
      const e = os[it];
      if (!e) continue;
      if (Number.isFinite(e.s)) sv.push(e.s);
      if (Number.isFinite(e.r)) rt.push(e.r);
    }
  }
  const s = median(sv), r = median(rt);
  return { savings: s, interrupt: r == null ? null : Math.round(r) };
}

function linuxUsd(row) {
  const v = row?.valueColumns?.find(c => c.name === 'linux')?.prices?.USD;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function parseSpotPayload(data) {
  if (typeof data === 'string') {
    const trimmed = data.trim();
    const m = trimmed.match(/^callback\(([\s\S]*)\);?$/);
    data = JSON.parse(m ? m[1] : trimmed);
  }
  const byAccel = {};
  for (const region of data?.config?.regions ?? []) {
    if (!REGIONS.includes(region.region)) continue;
    for (const group of region.instanceTypes ?? []) {
      for (const row of group.sizes ?? []) {
        const meta = INSTANCE[row.size];
        if (!meta) continue;
        const price = linuxUsd(row);
        if (!Number.isFinite(price)) continue;
        (byAccel[meta.accel] ??= []).push(price / meta.chips);
      }
    }
  }
  return Object.fromEntries(
    Object.entries(byAccel)
      .map(([accel, prices]) => [accel, median(prices)])
      .filter(([, price]) => Number.isFinite(price))
      .map(([accel, price]) => [accel, +price.toFixed(2)])
  );
}

async function publicSpotPrices() {
  const { data } = await axios.get(PUBLIC_SPOT_URL, { timeout: 30000 });
  return parseSpotPayload(data);
}

function dailyDates(start, end) {
  const a = Date.parse(start + 'T00:00:00Z'), b = Date.parse(end + 'T00:00:00Z');
  const out = [];
  for (let t = a; t <= b; t += DAY_MS) out.push(isoDay(t));
  return out;
}

// Forward-fill a per-accelerator daily series for one field, connecting real
// anchors so an occasional missed day doesn't read as a gap.
function buildHistory(hist) {
  const days = Object.keys(hist).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  if (days.length === 0) return { dates: [], spotSeries: {}, savingsSeries: {}, interruptSeries: {} };
  const dates = dailyDates(days[0], isoDay(Date.now()));
  const idx = Object.fromEntries(dates.map((d, i) => [d, i]));
  const accels = [...new Set(days.flatMap(d => Object.keys(hist[d])))];

  const fill = field => {
    const out = {};
    for (const a of accels) {
      const anchors = days.filter(d => Number.isFinite(hist[d][a]?.[field]) && idx[d] != null).map(d => ({ i: idx[d], v: hist[d][a][field] }));
      const vals = new Array(dates.length).fill(null);
      for (let k = 0; k < anchors.length; k++) {
        const cur = anchors[k], next = anchors[k + 1];
        vals[cur.i] = cur.v;
        if (next) for (let i = cur.i + 1; i < next.i; i++) vals[i] = +(cur.v + (next.v - cur.v) * ((i - cur.i) / (next.i - cur.i))).toFixed(3);
        else for (let i = cur.i + 1; i < dates.length; i++) vals[i] = cur.v;
      }
      out[a] = vals;
    }
    return out;
  };
  return { dates, spotSeries: fill('spot'), savingsSeries: fill('savings'), interruptSeries: fill('interrupt') };
}

async function getAwsData() {
  let advisor;
  try { ({ data: advisor } = await axios.get(ADVISOR_URL, { timeout: 25000 })); }
  catch (e) { console.warn('[aws] spot advisor fetch failed:', e.message); advisor = null; }
  let exactSpot = {};
  try { exactSpot = await publicSpotPrices(); }
  catch (e) { console.warn('[aws] public spot price fetch failed:', e.message); exactSpot = {}; }

  const hist = loadHistory();
  const meta = hist._meta ?? {};
  const today = isoDay(Date.now());
  const current = {};

  if (advisor || Object.keys(exactSpot).length) {
    const onDemand = { ...(meta.onDemand ?? {}) };
    for (const [accel, instances] of Object.entries(ACCEL)) {
      const { savings, interrupt } = advisor ? advisorStat(advisor, instances) : { savings: null, interrupt: null };
      const spot = exactSpot[accel];
      if (savings == null && interrupt == null && spot == null) continue;
      const existing = hist[today]?.[accel] ?? {};
      const entry = { ...existing };
      if (savings != null) entry.savings = Math.round(savings);
      if (interrupt != null) entry.interrupt = interrupt;
      if (spot != null) {
        entry.spot = spot;
        entry.x = true;
        entry.source = 'aws-public-spot-json';
        if (savings != null && savings < 100) onDemand[accel] = +(spot / (1 - savings / 100)).toFixed(2);
      } else {
        // Derive today's spot from on-demand × (1 − savings), unless an exact
        // spot was already written for today.
        const od = onDemand[accel];
        if (!existing.x && od != null && savings != null) entry.spot = +(od * (1 - savings / 100)).toFixed(2);
      }
      current[accel] = {
        savings: entry.savings ?? null,
        interrupt: entry.interrupt ?? null,
        spot: entry.spot ?? existing.spot ?? null,
        onDemand: onDemand[accel] ?? null,
        source: entry.source ?? (entry.x ? 'aws-ec2-spot-history' : 'aws-spot-advisor-derived'),
      };
      (hist[today] ??= {})[accel] = entry;
    }
    hist._meta = { ...meta, onDemand, publicSpotUpdatedAt: today };
    saveHistory(hist);
  }

  const history = buildHistory(hist);
  if (Object.keys(current).length === 0 && history.dates.length === 0) return null;

  return {
    current,
    onDemand: meta.onDemand ?? {},
    history,
    ranges: advisor?.ranges ?? null,   // interruption rating index → label
    asOf: today,
    methodology: 'AWS accelerator spot economics. Current spot $/accelerator: public EC2 spot pricing table (no AWS key), median across us-east-1/us-west-2/us-east-2 and divided by accelerator count. Historical exact backfill can still use EC2 DescribeSpotPriceHistory (≤90d, AWS credentials required); if the public table is unavailable, the scraper falls back to on-demand × (1 − Spot Advisor savings). Savings % and interruption frequency: AWS Spot Instance Advisor.',
  };
}

module.exports = { getAwsData, ACCEL };
