'use strict';
const axios = require('axios');
const path = require('path');
const storage = require('../storage');

/**
 * CPU instance spot pricing via AWS Spot Instance Advisor (no auth required).
 * Tracks compute-optimized and general-purpose instance families commonly used
 * for CPU inference and general AI workloads.
 *
 * Spot $/hr is derived as: on-demand × (1 − spot savings %).
 * Savings % is the median across us-east-1, us-west-2, us-east-2.
 */
const HISTORY_FILE = path.join(__dirname, '..', 'data', 'cpuHistory.json');
const BLOB = 'cpuHistory';
const ADVISOR_URL = 'https://spot-bid-advisor.s3.amazonaws.com/spot-advisor-data.json';
const DAY_MS = 86400000;

// Instance type → label and on-demand $/hr in us-east-1 (Linux, maintained reference rates).
const CPU_INSTANCES = {
  'c5.4xlarge':  { label: 'C5 (Xeon)',       vCPUs: 16, onDemand: 0.680  },
  'c6i.4xlarge': { label: 'C6i (Ice Lake)',  vCPUs: 16, onDemand: 0.6912 },
  'c7i.4xlarge': { label: 'C7i (Sapphire)', vCPUs: 16, onDemand: 0.7140 },
  'm6i.4xlarge': { label: 'M6i (General)',  vCPUs: 16, onDemand: 0.768  },
  'c7g.4xlarge': { label: 'C7g (Graviton)', vCPUs: 16, onDemand: 0.5808 },
};

const REGIONS = ['us-east-1', 'us-west-2', 'us-east-2'];
const isoDay = ms => new Date(ms).toISOString().slice(0, 10);
const median = a => { const s = a.filter(Number.isFinite).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };

function loadHistory() { return storage.read(BLOB, HISTORY_FILE) ?? {}; }
function saveHistory(h) { storage.write(BLOB, HISTORY_FILE, h); }

function advisorSavings(advisor, instanceType) {
  const sv = [];
  for (const region of REGIONS) {
    const e = advisor.spot_advisor?.[region]?.Linux?.[instanceType];
    if (e && Number.isFinite(e.s)) sv.push(e.s);
  }
  return median(sv);
}

function dailyDates(start, end) {
  const a = Date.parse(start + 'T00:00:00Z'), b = Date.parse(end + 'T00:00:00Z');
  const out = [];
  for (let t = a; t <= b; t += DAY_MS) out.push(isoDay(t));
  return out;
}

function buildHistory(hist) {
  const days = Object.keys(hist).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  if (days.length === 0) return { dates: [], spotSeries: {} };
  const dates = dailyDates(days[0], isoDay(Date.now()));
  const idx = Object.fromEntries(dates.map((d, i) => [d, i]));
  const labels = Object.values(CPU_INSTANCES).map(v => v.label);

  const spotSeries = {};
  for (const label of labels) {
    const anchors = days
      .filter(d => Number.isFinite(hist[d]?.[label]) && idx[d] != null)
      .map(d => ({ i: idx[d], v: hist[d][label] }));
    const vals = new Array(dates.length).fill(null);
    for (let k = 0; k < anchors.length; k++) {
      const cur = anchors[k], next = anchors[k + 1];
      vals[cur.i] = cur.v;
      const end = next ? next.i : dates.length;
      for (let i = cur.i + 1; i < end; i++) vals[i] = cur.v;
    }
    spotSeries[label] = vals;
  }
  return { dates, spotSeries };
}

async function getCpuData() {
  let advisor;
  try {
    ({ data: advisor } = await axios.get(ADVISOR_URL, { timeout: 25000 }));
  } catch (e) {
    console.warn('[cpu] spot advisor fetch failed:', e.message);
    advisor = null;
  }

  const hist = loadHistory();
  const today = isoDay(Date.now());
  const current = {};

  if (advisor) {
    const dayEntry = {};
    for (const [instanceType, meta] of Object.entries(CPU_INSTANCES)) {
      const savings = advisorSavings(advisor, instanceType);
      if (savings == null) continue;
      const spot = +(meta.onDemand * (1 - savings / 100)).toFixed(3);
      dayEntry[meta.label] = spot;
      current[meta.label] = { spot, onDemand: meta.onDemand, savings: Math.round(savings), vCPUs: meta.vCPUs };
    }
    if (Object.keys(dayEntry).length > 0) {
      hist[today] = dayEntry;
      saveHistory(hist);
    }
  }

  const history = buildHistory(hist);
  if (Object.keys(current).length === 0 && history.dates.length === 0) return null;

  return {
    current,
    onDemand: Object.fromEntries(Object.values(CPU_INSTANCES).map(m => [m.label, m.onDemand])),
    history,
    asOf: today,
    methodology: 'AWS CPU instance spot pricing. Spot $/hr derived from AWS Spot Instance Advisor (median savings across us-east-1/us-west-2/us-east-2) × on-demand list price. Tracked: c5/c6i/c7i (compute-optimized), m6i (general-purpose), c7g (Graviton ARM). All 4xlarge (16 vCPUs), us-east-1 on-demand rates.',
  };
}

module.exports = { getCpuData, CPU_INSTANCES, HISTORY_FILE, BLOB };
