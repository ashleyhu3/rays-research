'use strict';
const axios = require('axios');

const APIFY_BASE = 'https://api.apify.com/v2';
const ACTOR_ID   = 'vortex_data~similarweb-scraper';

const SITES = [
  { domain: 'openai.com',         company: 'OpenAI'    },
  { domain: 'anthropic.com',      company: 'Anthropic' },
  { domain: 'gemini.google.com',  company: 'Google'    },
  { domain: 'hailuoai.com',       company: 'MiniMax'   },
  { domain: 'zhipuai.cn',         company: 'Zhipu'     },
];

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function startRun(apiKey) {
  const { data } = await axios.post(
    `${APIFY_BASE}/acts/${ACTOR_ID}/runs?token=${apiKey}`,
    { domains: SITES.map(s => s.domain) },
    { timeout: 30000 }
  );
  const runId = data?.data?.id;
  if (!runId) throw new Error(`No runId in Apify response: ${JSON.stringify(data).slice(0, 200)}`);
  return runId;
}

async function waitForRun(runId, apiKey, maxWaitMs = 120000) {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const { data } = await axios.get(
      `${APIFY_BASE}/actor-runs/${runId}?token=${apiKey}`,
      { timeout: 15000 }
    );
    const run = data?.data;
    if (run?.status === 'SUCCEEDED') return run.defaultDatasetId;
    if (['FAILED', 'ABORTED', 'TIMED-OUT'].includes(run?.status)) {
      throw new Error(`Actor run ${run.status}: ${run.statusMessage ?? ''}`);
    }
    await sleep(6000);
  }
  throw new Error('Apify run timed out after 120s');
}

async function fetchDataset(datasetId, apiKey) {
  const { data } = await axios.get(
    `${APIFY_BASE}/datasets/${datasetId}/items?token=${apiKey}&limit=100`,
    { timeout: 30000 }
  );
  return Array.isArray(data) ? data : (data?.items ?? []);
}

async function getWebTrafficData() {
  const apiKey = process.env.APIFY_API_KEY;
  if (!apiKey) throw new Error('APIFY_API_KEY not set');

  const runId     = await startRun(apiKey);
  const datasetId = await waitForRun(runId, apiKey, 120000);
  const items     = await fetchDataset(datasetId, apiKey);

  const sites   = {};
  // history shape mirrors what metricTrendCard expects from metricsHistory:
  // { 'domain.visits': { 'YYYY-MM-DD': visits, ... } }
  // Populated from SimilarWeb's own 3-month window so charts appear immediately.
  const history = {};

  for (const item of items) {
    const raw   = item.domain ?? item.searchUrl ?? '';
    const match = SITES.find(s =>
      raw === s.domain ||
      raw.replace(/^https?:\/\/(www\.)?/, '').replace(/\/.*$/, '') === s.domain
    );
    if (!match) continue;

    sites[match.domain] = {
      totalVisits:   item.totalVisits   ?? null,
      bounceRate:    item.bounceRate    ?? null,
      pagesPerVisit: item.pagesPerVisit ?? null,
      timeOnSite:    item.timeOnSite    ?? null,
      rankGlobal:    item.rankGlobal    ?? null,
    };

    // monthlyVisitsDateFormat: { '2026-03-01': N, '2026-04-01': N, ... }
    const monthly = item.monthlyVisitsDateFormat;
    if (monthly && typeof monthly === 'object') {
      history[`${match.domain}.visits`] = monthly;
    }
  }

  if (Object.keys(sites).length === 0) {
    console.warn('[webTraffic] no sites matched; raw items:', items.length,
      items[0] ? Object.keys(items[0]).join(', ') : '(empty)');
  }

  return { sites, history };
}

module.exports = { getWebTrafficData };
