/**
 * Backfill REAL historical accelerator spot prices from AWS EC2's Spot Price
 * History into the `awsHistory` blob — the exact-price layer that the daily
 * `aws` scraper (server/scrapers/aws.js) continues forward for free.
 *
 * For each accelerator (H100/H200/A100 + AWS Trainium/Inferentia) it derives a
 * per-chip $/hr (instance spot price ÷ chip count), takes a daily median across
 * availability zones and regions, and writes it with `x: true` (exact). It also
 * fetches the public Spot Advisor once to compute an implied on-demand price
 * (spot ÷ (1 − savings)) and stores it in `_meta.onDemand`, calibrating the
 * scraper's forward reconstruction so the price line joins on continuously.
 *
 * `DescribeSpotPriceHistory` is free; this is a free, repeatable backfill.
 * Requires read-only AWS creds (AmazonEC2ReadOnlyAccess). No-ops without them.
 *
 * Usage: npm run backfill:aws-spot
 */
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { ACCEL } = require('../scrapers/aws');

const HISTORY_FILE = path.join(__dirname, '..', 'data', 'awsHistory.json');
const ADVISOR_URL = 'https://spot-bid-advisor.s3.amazonaws.com/spot-advisor-data.json';
const REGIONS = ['us-east-1', 'us-west-2', 'us-east-2'];
const DAYS = 90;
const DAY_MS = 86400000;

// Invert ACCEL { accel: { instanceType: chips } } → { instanceType: { accel, chips } }.
const INSTANCE = {};
for (const [accel, instances] of Object.entries(ACCEL)) {
  for (const [it, chips] of Object.entries(instances)) INSTANCE[it] = { accel, chips };
}

const median = a => { const s = a.filter(Number.isFinite).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
const isoDay = ms => new Date(ms).toISOString().slice(0, 10);

function windowDays() {
  const out = [];
  const today = Date.parse(isoDay(Date.now()) + 'T00:00:00Z');
  for (let i = DAYS - 1; i >= 0; i--) out.push(isoDay(today - i * DAY_MS));
  return out;
}

async function fetchRegion(EC2Client, Cmd, region) {
  const client = new EC2Client({ region });
  const EndTime = new Date();
  const StartTime = new Date(Date.now() - DAYS * DAY_MS);
  const out = [];
  let NextToken;
  do {
    const resp = await client.send(new Cmd({
      InstanceTypes: Object.keys(INSTANCE),
      ProductDescriptions: ['Linux/UNIX'],
      StartTime, EndTime, MaxResults: 1000, NextToken,
    }));
    for (const e of resp.SpotPriceHistory ?? []) out.push(e);
    NextToken = resp.NextToken;
  } while (NextToken);
  return out;
}

// Current spot savings % per accelerator from the public advisor (no creds),
// used only to imply an on-demand baseline for the forward series.
async function advisorSavings() {
  try {
    const { data } = await axios.get(ADVISOR_URL, { timeout: 25000 });
    const out = {};
    for (const [accel, instances] of Object.entries(ACCEL)) {
      const sv = [];
      for (const region of REGIONS) {
        const os = data.spot_advisor?.[region]?.Linux;
        for (const it of Object.keys(instances)) if (os?.[it] && Number.isFinite(os[it].s)) sv.push(os[it].s);
      }
      const m = median(sv);
      if (m != null) out[accel] = m;
    }
    return out;
  } catch (e) { console.warn('[aws-spot] advisor fetch failed (on-demand baseline skipped):', e.message); return {}; }
}

async function main() {
  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    console.warn('[aws-spot] AWS credentials not set — skipping. Set AWS_ACCESS_KEY_ID and '
      + 'AWS_SECRET_ACCESS_KEY (a free read-only key with ec2:DescribeSpotPriceHistory) and re-run.');
    process.exit(0);
  }
  let EC2Client, DescribeSpotPriceHistoryCommand;
  try { ({ EC2Client, DescribeSpotPriceHistoryCommand } = require('@aws-sdk/client-ec2')); }
  catch { console.error('[aws-spot] @aws-sdk/client-ec2 not installed. Run:  npm i -D @aws-sdk/client-ec2'); process.exit(1); }

  const obs = new Map(); // `${zone}|${instanceType}` → [{ t, price }]
  for (const region of REGIONS) {
    let entries;
    try { entries = await fetchRegion(EC2Client, DescribeSpotPriceHistoryCommand, region); }
    catch (e) { console.warn(`[aws-spot] ${region}: ${e.name || ''} ${e.message}`); continue; }
    for (const e of entries) {
      const price = Number(e.SpotPrice);
      if (!Number.isFinite(price) || !INSTANCE[e.InstanceType]) continue;
      const k = `${e.AvailabilityZone}|${e.InstanceType}`;
      (obs.get(k) ?? obs.set(k, []).get(k)).push({ t: new Date(e.Timestamp).getTime(), price });
    }
    console.log(`[aws-spot] ${region}: ${entries.length} price points`);
  }
  if (obs.size === 0) { console.error('[aws-spot] no data returned (check region/permissions).'); process.exit(2); }
  for (const list of obs.values()) list.sort((a, b) => a.t - b.t);

  const days = windowDays();
  const perDay = {}; // day → { accel: [perChip$…] }
  for (const [k, list] of obs) {
    const { accel, chips } = INSTANCE[k.split('|')[1]];
    let i = 0, last = null;
    for (const day of days) {
      const dayEnd = Date.parse(day + 'T23:59:59Z');
      while (i < list.length && list[i].t <= dayEnd) last = list[i++].price;
      if (last == null) continue;
      ((perDay[day] ??= {})[accel] ??= []).push(last / chips);
    }
  }

  let history = {};
  try { history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')); } catch {}
  let daysWritten = 0, values = 0;
  for (const [day, byAccel] of Object.entries(perDay)) {
    let wrote = false;
    for (const [accel, prices] of Object.entries(byAccel)) {
      const m = median(prices);
      if (m == null) continue;
      (history[day] ??= {})[accel] = { ...history[day][accel], spot: +m.toFixed(2), x: true };
      values++; wrote = true;
    }
    if (wrote) daysWritten++;
  }

  // Calibrate the forward on-demand baseline: onDemand = latest exact spot ÷ (1 − savings).
  const savings = await advisorSavings();
  const onDemand = { ...(history._meta?.onDemand ?? {}) };
  for (const accel of Object.keys(ACCEL)) {
    const s = savings[accel];
    if (s == null || s >= 100) continue;
    const lastDay = Object.keys(history).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d) && history[d][accel]?.x).sort().at(-1);
    const spot = lastDay && history[lastDay][accel]?.spot;
    if (Number.isFinite(spot)) onDemand[accel] = +(spot / (1 - s / 100)).toFixed(2);
  }
  history._meta = { ...history._meta, onDemand, calibratedAt: isoDay(Date.now()) };

  fs.mkdirSync(path.dirname(HISTORY_FILE), { recursive: true });
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history));
  const dates = Object.keys(history).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  console.log(`\n[aws-spot] Done. Wrote ${values} exact spot values across ${daysWritten} days `
    + `(${Object.keys(ACCEL).join(', ')}).`);
  console.log('[aws-spot] implied on-demand $/chip:', JSON.stringify(onDemand));
  if (dates.length) console.log(`[aws-spot] awsHistory spans ${dates[0]} → ${dates.at(-1)} (${dates.length} days).`);
}

main().catch(e => { console.error('[aws-spot] failed:', e.message); process.exit(1); });
