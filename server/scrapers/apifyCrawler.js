'use strict';

const APIFY_BASE = 'https://api.apify.com/v2';
const CONTENT_ACTOR = 'apify~website-content-crawler';

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function apifyPost(actor, input) {
  const apiKey = process.env.APIFY_API_KEY;
  if (!apiKey) throw new Error('APIFY_API_KEY not set');
  const res = await fetch(`${APIFY_BASE}/acts/${actor}/runs?token=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(30000),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(`Apify ${actor} start HTTP ${res.status}: ${json?.error?.message ?? ''}`);
  }
  const runId = json?.data?.id;
  if (!runId) throw new Error(`Apify ${actor}: no run id returned`);
  return { runId, apiKey };
}

async function apifyWait(runId, apiKey, maxWaitMs = 180000) {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const res = await fetch(`${APIFY_BASE}/actor-runs/${runId}?token=${apiKey}`, { signal: AbortSignal.timeout(15000) });
    const json = await res.json();
    const run = json?.data;
    if (run?.status === 'SUCCEEDED') return run.defaultDatasetId;
    if (['FAILED', 'ABORTED', 'TIMED-OUT'].includes(run?.status)) {
      throw new Error(`Apify run ${run.status}: ${run.statusMessage ?? ''}`);
    }
    await sleep(6000);
  }
  throw new Error('Apify run timed out');
}

async function apifyItems(datasetId, apiKey, limit = 20) {
  const res = await fetch(`${APIFY_BASE}/datasets/${datasetId}/items?token=${apiKey}&limit=${limit}`, {
    signal: AbortSignal.timeout(30000),
  });
  const json = await res.json();
  return Array.isArray(json) ? json : (json?.items ?? []);
}

// The Apify plan backing this account caps *concurrent* actor memory across
// all runs combined (observed: a 402 "exceed the memory limit" once several
// rendered crawls started at once) — every caller (usLeverage, aaiiSentiment,
// ...) is funneled through this one module-level queue so only one actor run
// is ever in flight, trading a little latency for not tripping that cap.
let apifyQueue = Promise.resolve();
function queued(fn) {
  const run = apifyQueue.then(fn, fn);
  apifyQueue = run.then(() => {}, () => {});
  return run;
}

/** Rendered-HTML crawl — solves Cloudflare/Akamai/Incapsula bot-management
 *  without any special Apify permission. */
async function crawlPages(urls) {
  return queued(() => crawlPagesNow(urls));
}

async function crawlPagesNow(urls) {
  const { runId, apiKey } = await apifyPost(CONTENT_ACTOR, {
    startUrls: urls.map(url => ({ url })),
    maxCrawlPages: urls.length,
    crawlerType: 'playwright:adaptive',
    saveHtml: true,
    htmlTransformer: 'none',
    readableTextCharThreshold: 0,
  });
  const datasetId = await apifyWait(runId, apiKey);
  const items = await apifyItems(datasetId, apiKey, urls.length);
  const byUrl = new Map(items.map(item => [item.url, item]));
  return urls.map(url => byUrl.get(url) ?? null);
}

module.exports = { crawlPages };
