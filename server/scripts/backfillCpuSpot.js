/**
 * Backfill REAL historical CPU instance spot prices from AWS EC2's Spot Price
 * History into the `cpuHistory` blob — the exact-price layer that the daily
 * `cpu` scraper (server/scrapers/cpu.js) continues forward via the Spot Advisor.
 *
 * For each CPU instance type it derives a daily median spot $/hr across all
 * availability zones and the tracked regions, then writes it directly into
 * cpuHistory.json keyed by the human-readable label (e.g. "C5 (Xeon)").
 *
 * `DescribeSpotPriceHistory` is free; this is a free, repeatable backfill.
 * Requires read-only AWS creds (AmazonEC2ReadOnlyAccess). No-ops without them.
 *
 * Usage: npm run backfill:cpu-spot
 */
const fs = require('fs');
const path = require('path');
const { CPU_INSTANCES, HISTORY_FILE } = require('../scrapers/cpu');

const REGIONS = ['us-east-1', 'us-west-2', 'us-east-2'];
const DAYS = 90;
const DAY_MS = 86400000;

const isoDay = ms => new Date(ms).toISOString().slice(0, 10);
const median = a => { const s = a.filter(Number.isFinite).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };

// { instanceType: { label, onDemand, vCPUs } }
const INSTANCE_META = Object.fromEntries(
  Object.entries(CPU_INSTANCES).map(([it, m]) => [it, m])
);

function windowDays() {
  const today = Date.parse(isoDay(Date.now()) + 'T00:00:00Z');
  return Array.from({ length: DAYS }, (_, i) => isoDay(today - (DAYS - 1 - i) * DAY_MS));
}

async function fetchRegion(EC2Client, Cmd, region) {
  const client = new EC2Client({ region });
  const EndTime = new Date();
  const StartTime = new Date(Date.now() - DAYS * DAY_MS);
  const out = [];
  let NextToken;
  do {
    const resp = await client.send(new Cmd({
      InstanceTypes: Object.keys(INSTANCE_META),
      ProductDescriptions: ['Linux/UNIX'],
      StartTime, EndTime, MaxResults: 1000, NextToken,
    }));
    for (const e of resp.SpotPriceHistory ?? []) out.push(e);
    NextToken = resp.NextToken;
  } while (NextToken);
  return out;
}

async function main() {
  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    console.warn('[cpu-spot] AWS credentials not set — skipping.\n'
      + '  Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY (ec2:DescribeSpotPriceHistory) and re-run.');
    process.exit(0);
  }
  let EC2Client, DescribeSpotPriceHistoryCommand;
  try {
    ({ EC2Client, DescribeSpotPriceHistoryCommand } = require('@aws-sdk/client-ec2'));
  } catch {
    console.error('[cpu-spot] @aws-sdk/client-ec2 not installed. Run:  npm i -D @aws-sdk/client-ec2');
    process.exit(1);
  }

  // Collect all raw price events: zone+instance → sorted [{ t, price }]
  const obs = new Map();
  for (const region of REGIONS) {
    let entries;
    try { entries = await fetchRegion(EC2Client, DescribeSpotPriceHistoryCommand, region); }
    catch (e) { console.warn(`[cpu-spot] ${region}: ${e.name || ''} ${e.message}`); continue; }
    for (const e of entries) {
      const price = Number(e.SpotPrice);
      if (!Number.isFinite(price) || !INSTANCE_META[e.InstanceType]) continue;
      const k = `${e.AvailabilityZone}|${e.InstanceType}`;
      (obs.get(k) ?? obs.set(k, []).get(k)).push({ t: new Date(e.Timestamp).getTime(), price });
    }
    console.log(`[cpu-spot] ${region}: ${entries.length} price points`);
  }
  if (obs.size === 0) { console.error('[cpu-spot] no data returned — check region or permissions.'); process.exit(2); }
  for (const list of obs.values()) list.sort((a, b) => a.t - b.t);

  // Bucket into days: for each day, record the last-known price in each zone.
  const days = windowDays();
  const perDay = {}; // day → { label: [price…] }
  for (const [k, list] of obs) {
    const instanceType = k.split('|')[1];
    const { label } = INSTANCE_META[instanceType];
    let i = 0, last = null;
    for (const day of days) {
      const dayEnd = Date.parse(day + 'T23:59:59Z');
      while (i < list.length && list[i].t <= dayEnd) last = list[i++].price;
      if (last == null) continue;
      ((perDay[day] ??= {})[label] ??= []).push(last);
    }
  }

  // Load existing history and merge exact prices in (overwriting advisor estimates).
  let history = {};
  try { history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')); } catch {}

  let daysWritten = 0, valuesWritten = 0;
  for (const [day, byLabel] of Object.entries(perDay)) {
    let wrote = false;
    for (const [label, prices] of Object.entries(byLabel)) {
      const m = median(prices);
      if (m == null) continue;
      (history[day] ??= {})[label] = +m.toFixed(3);
      valuesWritten++; wrote = true;
    }
    if (wrote) daysWritten++;
  }

  fs.mkdirSync(path.dirname(HISTORY_FILE), { recursive: true });
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history));

  const dates = Object.keys(history).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  const labels = Object.values(CPU_INSTANCES).map(m => m.label);
  console.log(`\n[cpu-spot] Done. Wrote ${valuesWritten} exact spot values across ${daysWritten} days.`);
  console.log('[cpu-spot] Instance types:', labels.join(', '));
  if (dates.length) console.log(`[cpu-spot] cpuHistory spans ${dates[0]} → ${dates.at(-1)} (${dates.length} days).`);
}

main().catch(e => { console.error('[cpu-spot] failed:', e.message); process.exit(1); });
