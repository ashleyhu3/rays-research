const express      = require('express');
const cors         = require('cors');
const path         = require('path');
const cache        = require('./cache');
const storage      = require('./storage');
const history      = require('./history');
const snapshotStore = require('./snapshotStore');
const scheduler    = require('./scheduler');
const STORAGE_BLOBS = require('./storageBlobs');
const htmlTemplate = require('./htmlTemplate');
const { chat } = require('./chat');
const { getOptionsData }             = require('./scrapers/options');
const { getStockHistory }            = require('./scrapers/stocks');
const { readUsPerformance }          = require('./scrapers/usPerformance');
const { readHkChinaPerformance }     = require('./scrapers/hkChinaPerformance');
const { readChinaEtfPremium }        = require('./scrapers/chinaEtfPremium');
const { readHkPerformance }          = require('./scrapers/hkPerformance');
const { readGlobalIndices }          = require('./scrapers/globalIndices');
const { readIndexBreadth }           = require('./scrapers/indexBreadth');
const { readSpxPutCallRatio }        = require('./scrapers/spxPutCallRatio');
const { readChinaNationalTeamFlow }  = require('./scrapers/chinaNationalTeamFlow');
const { readChinaLiquidity }         = require('./scrapers/chinaLiquidity');
const { readUsLiquidity }            = require('./scrapers/usLiquidity');
const { readCarryTrade }             = require('./scrapers/carryTrade');
const { readKoreaLeverage }          = require('./scrapers/koreaLeverage');
const { keywordRolling }             = require('./stocktwitsStore');

const app   = express();
const PORT  = process.env.PORT || 3001;
const isProd = process.env.NODE_ENV === 'production';

app.use(cors());
app.use(express.json());

// Health must stay independent of MongoDB. Deployment probes should be able to
// distinguish a live function from a slow or unavailable data dependency.
app.get('/api/health', (_, res) => res.json({ ok: true, ts: new Date().toISOString() }));

let initializationPromise = null;

async function initialize() {
  if (!initializationPromise) {
    initializationPromise = (async () => {
      // Connect only. Individual routes load their own persisted data below;
      // preloading every blob made cold starts download ~30 MB before health or
      // any API route could respond.
      await storage.init(STORAGE_BLOBS, { preload: false });
    })().catch((error) => {
      // A transient cold-start failure should not poison this warm instance.
      initializationPromise = null;
      throw error;
    });
  }

  return initializationPromise;
}

// Vercel may reuse a function instance, so initialize persistent state once
// per warm instance and make every request wait for it to be ready.
app.use(async (_req, _res, next) => {
  try {
    await initialize();
    next();
  } catch (error) {
    next(error);
  }
});

const STORAGE_BLOB_BY_NAME = new Map(STORAGE_BLOBS.map(blob => [blob.name, blob]));

function requireStorageBlobs(...names) {
  return async (_req, _res, next) => {
    try {
      await Promise.all(names.map(name => {
        const blob = STORAGE_BLOB_BY_NAME.get(name);
        if (!blob) throw new Error(`Unknown storage blob: ${name}`);
        return storage.load(blob.name, blob.file);
      }));
      next();
    } catch (error) {
      next(error);
    }
  };
}

// Routes whose handlers use synchronous in-memory stores load only their own
// backing documents. Most dashboard routes use projected latestSnapshots reads
// in cachedRoute() and need no full blob at all.
app.use('/api/sentiment/keyword', requireStorageBlobs('sentimentData'));
app.use('/api/metrics-history', requireStorageBlobs('metricsHistory'));
app.use('/api/china-national-team-flow', requireStorageBlobs('chinaNationalTeamFlowHistory'));
app.use('/api/china-liquidity', requireStorageBlobs('chinaLiquidityHistory'));
app.use('/api/us-liquidity', requireStorageBlobs('usLiquidityHistory'));
app.use('/api/carry-trade', requireStorageBlobs('carryTradeHistory'));
app.use('/api/korea-leverage', requireStorageBlobs('koreaLeverageHistory'));
app.use('/api/us-performance', requireStorageBlobs('usPerformanceHistory'));
app.use('/api/hk-china-performance', requireStorageBlobs('hkChinaPerformanceHistory'));
app.use('/api/china-etf-premium', requireStorageBlobs('chinaEtfPremiumHistory'));
app.use('/api/hk-performance', requireStorageBlobs('hkPerformanceHistory'));
app.use('/api/global-indices', requireStorageBlobs('globalIndicesHistory'));
app.use('/api/index-breadth', requireStorageBlobs('indexBreadthHistory'));
app.use('/api/spx-put-call-ratio', requireStorageBlobs('spxPutCallRatioHistory'));
app.use('/api/options', requireStorageBlobs('optionsOI'));
app.use('/api/alerts/earnings-calendar', requireStorageBlobs('techEarningsCalendar'));

// Chat consumes many cached sources at once. Hydrate those projected snapshot
// fields only when Chat is used, rather than on every deployment cold start.
app.use('/api/chat', async (_req, _res, next) => {
  try {
    await snapshotStore.seedKeys(cache, Object.keys(scheduler.scrapers), scheduler.TTL);
    next();
  } catch (error) {
    next(error);
  }
});

function requireAdminSecret(req, res, next) {
  const secret = process.env.ADMIN_SECRET;
  const authorization = req.get('authorization');

  // Local development has no admin secret by default. Allow the dashboard's
  // same-origin controls there, but keep production admin routes closed unless
  // a secret is explicitly configured and supplied.
  if (!secret && process.env.NODE_ENV !== 'production') return next();

  if (!secret || authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  next();
}

/* ── Helper: lazy-cached route ─────────────────────────────────────── */
// Coalesce concurrent cache misses into one scrape — without this, several
// browser requests (or a request racing the startup warmup) each fire their
// own scrape, which slow rate-limited sources punish badly.
const inflight = new Map();

function cachedRoute(key, scraper, isCurrent = null, options = {}) {
  return async (req, res) => {
    let data = cache.get(key);
    const staleShape = data !== null && isCurrent && !isCurrent(data) ? data : null;
    if (data !== null && !staleShape) return res.json(data);
    if (staleShape) {
      // A persisted snapshot can be fresh by age but obsolete by schema. Drop
      // it from memory so this request performs the migration immediately.
      cache.del(key);
      data = null;
    }
    try {
      // Macro history is collected by the scheduled worker and persisted in
      // Mongo. Reload that snapshot on a cache miss so a warm web instance does
      // not scrape Trading Economics merely because it started before the
      // collector's first macro write.
      if (options.preferPersisted !== false) {
        const persisted = await snapshotStore.latest(key);
        if (persisted?.data != null && (!isCurrent || isCurrent(persisted.data))) {
          cache.set(key, persisted.data, scheduler.TTL[key] ?? 3600000, persisted.fetchedAt);
          return res.json(persisted.data);
        }
      }

      let pending = inflight.get(key);
      if (!pending) {
        pending = scraper();
        inflight.set(key, pending);
        pending.finally(() => inflight.delete(key)).catch(() => {});
      }
      data = await pending;
      if (data != null) {
        cache.set(key, data, scheduler.TTL[key] ?? 3600000);
        history.snapshot(key, data);
        snapshotStore.put(key, data);
        try { cache.recordSuccess(key, Buffer.byteLength(JSON.stringify(data))); } catch { cache.recordSuccess(key, 0); }
      }
      res.json(data ?? staleShape ?? {});
    } catch (e) {
      const status = /\b429\b|rate.?limit|too many requests/i.test(e.message ?? '') ? 'RATE-LIMITED' : 'DOWN';
      cache.recordFailure(key, status, e.message);
      console.error(`[${key}]`, e.message);
      // Preserve last-known data if the migration refresh itself is temporarily
      // unavailable; the next request will retry because it was not re-cached.
      if (staleShape) return res.json(staleShape);
      res.status(500).json({ error: e.message });
    }
  };
}

/* ── API routes ────────────────────────────────────────────────────── */
const s = scheduler.scrapers;

app.get('/api/pypi',       cachedRoute('pypi',       s.pypi));
app.get('/api/gpu',        cachedRoute('gpu',        s.gpu));
app.get('/api/github',     cachedRoute('github',     s.github));
app.get('/api/openrouter', cachedRoute('openrouter', s.openrouter));
app.get('/api/eia',            cachedRoute('eia',           s.eia));
app.get('/api/mops',           cachedRoute('mops',          s.mops));
app.get('/api/github-commits', cachedRoute('githubCommits', s.githubCommits));
app.get('/api/docker',         cachedRoute('docker',        s.docker));
app.get('/api/hn',             cachedRoute('hn',            s.hn));
app.get('/api/openrouter-ranks', cachedRoute(
  'openrouterRanks',
  s.openrouterRanks,
  data => data?.schemaVersion === 2 && Array.isArray(data?.dailyLabels) && data.dailyLabels.length > 0,
));
app.get('/api/dram',              cachedRoute('dram',             s.dram));
app.get('/api/nand',              cachedRoute('nand',             s.nand));
app.get('/api/tft-lcd',           cachedRoute('tftLcd',           s.tftLcd));
app.get('/api/aws',               cachedRoute('aws',              s.aws));
app.get('/api/cpu',               cachedRoute('cpu',              s.cpu));
app.get('/api/tpu',               cachedRoute('tpu',              s.tpu));
app.get('/api/epoch-revenue',     cachedRoute('epochRevenue',     s.epochRevenue));
app.get('/api/sentiment',         cachedRoute('sentiment',        s.sentiment));
app.get('/api/web-traffic',       cachedRoute('webTraffic',       s.webTraffic));
app.get('/api/customs-drones',    cachedRoute('customsDrones',    s.customsDrones));
// Korea has a canonical five-year history blob. Read it directly so a stale or
// partial latestSnapshot can never truncate the chart to the scraper's normal
// 30-day refresh window.
app.get('/api/korea-leverage', (_req, res) => res.json(readKoreaLeverage()));
app.get('/api/taiwan-leverage',   cachedRoute('taiwanLeverage',   s.taiwanLeverage));
app.get('/api/china-leverage',    cachedRoute('chinaLeverage',    s.chinaLeverage, null, { preferPersisted: true }));
app.get('/api/macro',             cachedRoute('macro',            s.macro, null, { preferPersisted: true }));
app.get('/api/commodities',       cachedRoute('commodities',      s.commodities, null, { preferPersisted: true }));

// One-off deep backfill (~5y, ~3600 SZSE requests + ~1200 SSE market-cap
// requests at a polite pace — several minutes) triggered manually from the
// China Leverage page, since SZSE only answers requests from wherever this
// server is actually deployed and can't be run from a local dev machine.
// Runs in the background rather than held
// open on the request, since a several-minute response would trip Render's
// proxy timeout; the frontend polls the status route below. Separate from
// the regular 6-hourly poll (which only fetches the last 30 days) so this
// doesn't slow down or re-hammer SZSE on every normal refresh.
let chinaLeverageBackfillState = { running: false, error: null, finishedAt: null, dates: null };
app.post('/api/china-leverage/backfill', requireAdminSecret, (req, res) => {
  if (process.env.VERCEL) {
    return res.status(409).json({
      ok: false,
      error: 'Long backfills are disabled on Vercel. Run npm run backfill:china-leverage from GitHub Actions or a local worker.',
    });
  }
  if (chinaLeverageBackfillState.running) {
    return res.status(409).json({ ok: false, error: 'Backfill already in progress' });
  }
  const days = Math.min(Number(req.body?.days) || 1830, 3650);
  chinaLeverageBackfillState = { running: true, error: null, finishedAt: null, dates: null };
  require('./scrapers/chinaLeverage').getChinaLeverage(days)
    .then(data => {
      cache.set('chinaLeverage', data, scheduler.TTL.chinaLeverage ?? 3600000);
      history.snapshot('chinaLeverage', data);
      snapshotStore.put('chinaLeverage', data);
      chinaLeverageBackfillState = { running: false, error: null, finishedAt: new Date().toISOString(), dates: data.dates?.length ?? 0 };
    })
    .catch(e => {
      console.error('[china-leverage/backfill]', e.message);
      chinaLeverageBackfillState = { running: false, error: e.message, finishedAt: new Date().toISOString(), dates: null };
    });
  res.status(202).json({ ok: true, started: true, days });
});
app.get('/api/china-leverage/backfill', (req, res) => res.json(chinaLeverageBackfillState));
// Liquidity page reads never scrape upstream; scheduled collectors own writes.
app.get('/api/china-national-team-flow', (_req, res) => res.json(readChinaNationalTeamFlow()));
app.get('/api/china-liquidity', (_req, res) => res.json(readChinaLiquidity()));
app.get('/api/us-liquidity', (_req, res) => res.json(readUsLiquidity()));
app.get('/api/carry-trade', (_req, res) => res.json(readCarryTrade()));
app.get('/api/japan-leverage',    cachedRoute('japanLeverage',    s.japanLeverage));
app.get('/api/us-leverage',       cachedRoute('usLeverage',       s.usLeverage));
app.get('/api/aaii-sentiment',    cachedRoute('aaiiSentiment',    s.aaiiSentiment));
// This scraper owns a dedicated history blob. Serve that canonical series
// directly: the generic latestSnapshots cache may still contain an older
// one-point payload from before Barchart history was backfilled.
app.get('/api/spx-put-call-ratio', (_req, res) => res.json(readSpxPutCallRatio()));

// Keyword frequency search — whole-word matches across the StockTwits messages
// in Mongo (committed-CSV fallback for keyless dev), as trailing-30-day counts
// at monthly anchors. Results cached 1 hour per (lowercased) keyword.
app.get('/api/sentiment/keyword', async (req, res) => {
  const q = (req.query.q ?? '').trim();
  if (!q)        return res.status(400).json({ error: 'q is required' });
  if (q.length > 60) return res.status(400).json({ error: 'keyword too long (max 60 chars)' });

  const cacheKey = `keyword:${q.toLowerCase()}`;
  const cached   = cache.get(cacheKey);
  if (cached !== null) return res.json(cached);

  try {
    const data = await keywordRolling(q);
    cache.set(cacheKey, data, 60 * 60 * 1000);
    res.json(data);
  } catch (e) {
    console.error('[keyword]', e.message);
    res.status(500).json({ error: e.message });
  }
});
app.get('/api/npm',               cachedRoute('npm',              s.npm));
app.get('/api/huggingface',       cachedRoute('huggingface',      s.huggingface));
app.get('/api/mcp',               cachedRoute('mcp',              s.mcp));
app.get('/api/sec',               cachedRoute('sec',              s.sec));

// Accumulated daily snapshots of point-in-time metrics (for trend charts)
app.get('/api/metrics-history', (_req, res) => res.json(history.all()));

// Data Validity Terminal — registry + live telemetry, served from memory.
const { buildValidityState } = require('./validity');
app.get('/api/validity/status', (_req, res) => res.json(buildValidityState()));

// Earnings transcript pipeline.
// Collect full transcripts from Alpha Vantage, normalize into deterministic
// prepared/Q&A speaker blocks, then topic-tag, tone-score, and run cross-quarter
// analysis.
const { collectFromAlphaVantage } = require('./transcripts/alphavantage');
const { semanticChunkDocument } = require('./transcripts/chunker');
const { listLocalEnrichments, readEnrichment, saveEnrichment } = require('./transcripts/enrichmentStore');
const { parseTranscriptDocument } = require('./transcripts/parser');
const { runFullPipeline } = require('./transcripts/pipeline');
const { listTranscripts, saveTranscript } = require('./transcripts/store');
const { runTranscriptAgent, parseTranscript, fetchTranscript, analyzeSeries } = require('./transcriptAgent');

app.get('/api/transcripts/library', async (_req, res) => {
  try {
    res.json(await listTranscripts());
  } catch (e) {
    console.error('[transcripts:library]', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/transcripts/collect', requireAdminSecret, async (req, res) => {
  const body = req.body ?? {};
  try {
    const transcript = await collectFromAlphaVantage({
      ticker: body.ticker,
      quarter: body.quarter,
      year: body.year,
    });
    const saved = await saveTranscript(transcript);
    const enrichment = semanticChunkDocument(transcript);
    const enrichedStorage = await saveEnrichment(enrichment);
    res.json({ transcript, enrichment, storage: { transcript: saved, enrichment: enrichedStorage } });
  } catch (e) {
    const status = e.status === 401 || e.status === 403
      ? 401
      : e.status === 429
      ? 429
      : /required|must be|recognizable|fiscal period/i.test(e.message)
      ? 400
      : 502;
    console.error('[transcripts:collect]', e.message);
    res.status(status).json({ error: e.message });
  }
});

// Streaming full-pipeline endpoint (collect → FinBERT → LLM tone → facts →
// figures → publish). Needs the FinBERT Python stack + a long-lived process, so
// it only works where that exists (local dev). On the deployed/serverless side
// use POST /api/transcripts/dispatch-analysis, which fires a GitHub Action that
// runs this same pipeline on a runner. Shared logic: transcripts/pipeline.js.
app.post('/api/transcripts/analyze', requireAdminSecret, async (req, res) => {
  const body = req.body ?? {};
  // NDJSON stream so the browser (which sends the admin Bearer header via fetch)
  // can render live per-stage progress. EventSource can't set auth headers.
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  const send = payload => { try { res.write(`${JSON.stringify(payload)}\n`); } catch { /* client gone */ } };

  try {
    await runFullPipeline({ ticker: body.ticker, quarter: body.quarter, year: body.year }, send);
  } catch (e) {
    console.error('[transcripts:analyze]', e.message);
    send({ stage: 'error', status: 'error', message: e.message });
  } finally {
    res.end();
  }
});

// Fire the GitHub Actions workflow that runs the FinBERT pipeline on a runner,
// then publishes to Mongo. This is the deployed/serverless path: quick to return
// (workflow_dispatch is async), and works on Vercel where FinBERT itself cannot.
// Requires a token with actions:write in GH_ANALYZE_DISPATCH_TOKEN (or GITHUB_TOKEN).
const ANALYZE_REPO = process.env.GITHUB_REPO || 'ashleyhu3/rays-research';
const ANALYZE_WORKFLOW = process.env.ANALYZE_WORKFLOW_FILE || 'analyze-transcript.yml';
const ANALYZE_REF = process.env.ANALYZE_WORKFLOW_REF || 'main';

app.post('/api/transcripts/dispatch-analysis', requireAdminSecret, async (req, res) => {
  const body = req.body ?? {};
  const ticker = String(body.ticker || '').toUpperCase().replace(/[^A-Z0-9.-]/g, '');
  const quarter = String(body.quarter || '').toUpperCase().replace(/[^0-9Q]/g, '');
  const year = String(body.year || '').replace(/[^0-9]/g, '');
  if (!ticker || !/^Q[1-4]$/.test(quarter) || !/^\d{4}$/.test(year)) {
    return res.status(400).json({ error: 'ticker, quarter (Q1–Q4) and a four-digit year are required.' });
  }
  const token = process.env.GH_ANALYZE_DISPATCH_TOKEN || process.env.GITHUB_TOKEN;
  if (!token) {
    return res.status(500).json({ error: 'GH_ANALYZE_DISPATCH_TOKEN is not set — add a token with actions:write.' });
  }
  try {
    const url = `https://api.github.com/repos/${ANALYZE_REPO}/actions/workflows/${ANALYZE_WORKFLOW}/dispatches`;
    const ghResp = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'rays-research-dashboard',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ref: ANALYZE_REF, inputs: { ticker, quarter, year } }),
    });
    if (ghResp.status === 204) {
      const runsUrl = `https://github.com/${ANALYZE_REPO}/actions/workflows/${ANALYZE_WORKFLOW}`;
      return res.json({ ok: true, ticker, period: `${year}${quarter}`, runsUrl });
    }
    const detail = (await ghResp.text()).slice(0, 300);
    console.error('[transcripts:dispatch]', ghResp.status, detail);
    const status = ghResp.status === 401 || ghResp.status === 403 ? 502 : ghResp.status === 404 ? 502 : 502;
    return res.status(status).json({ error: `GitHub dispatch failed (${ghResp.status}): ${detail}` });
  } catch (e) {
    console.error('[transcripts:dispatch]', e.message);
    return res.status(502).json({ error: e.message });
  }
});

app.post('/api/transcripts/parse', async (req, res) => {
  const body = req.body ?? {};
  try {
    const transcript = parseTranscriptDocument({
      ticker: body.ticker,
      quarter: body.quarter,
      year: body.year,
      earnings_date: body.earnings_date,
      transcript: body.text,
      metadata: {
        provider: 'manual',
        collectedAt: new Date().toISOString(),
      },
    });
    const saved = await saveTranscript(transcript);
    const enrichment = semanticChunkDocument(transcript);
    const enrichedStorage = await saveEnrichment(enrichment);
    res.json({ transcript, enrichment, storage: { transcript: saved, enrichment: enrichedStorage } });
  } catch (e) {
    console.error('[transcripts:parse]', e.message);
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/transcripts/enrichment/:ticker/:period', async (req, res) => {
  const ticker = String(req.params.ticker || '').toUpperCase().replace(/[^A-Z0-9.-]/g, '');
  const period = String(req.params.period || '').toUpperCase().replace(/[^0-9Q]/g, '');
  const enrichment = await readEnrichment(ticker, period);
  if (!enrichment) return res.status(404).json({ error: `No enrichment found for ${ticker} ${period}.` });
  res.json(enrichment);
});

app.get('/api/transcripts/topics', async (_req, res) => {
  const enrichments = await listLocalEnrichments();
  const counts = new Map();
  for (const enrichment of enrichments) {
    for (const item of enrichment.topicSummary || []) {
      counts.set(item.topic, (counts.get(item.topic) || 0) + item.count);
    }
  }
  res.json({
    transcripts: enrichments.length,
    chunks: enrichments.reduce((sum, item) => sum + (item.stats?.chunks || 0), 0),
    topics: [...counts.entries()]
      .map(([topic, count]) => ({ topic, count }))
      .sort((a, b) => b.count - a.count || a.topic.localeCompare(b.topic)),
  });
});

app.get('/api/transcripts/facts', async (req, res) => {
  const ticker = String(req.query.ticker || '').toUpperCase();
  const period = String(req.query.period || '').toUpperCase();
  const topic = String(req.query.topic || '');
  const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
  const facts = (await listLocalEnrichments())
    .flatMap(enrichment => enrichment.facts || [])
    .filter(fact => !ticker || fact.ticker === ticker)
    .filter(fact => !period || fact.fiscal_period === period)
    .filter(fact => !topic || fact.topics.includes(topic))
    .slice(0, limit);
  res.json({ count: facts.length, facts });
});

app.get('/api/transcripts/analysis/:ticker', async (req, res) => {
  const ticker = String(req.params.ticker || '').toUpperCase().replace(/[^A-Z0-9.-]/g, '');
  if (!ticker) return res.status(400).json({ error: 'ticker required' });
  try {
    const enrichments = (await listLocalEnrichments()).filter(
      enrichment => String(enrichment.ticker || enrichment.symbol || '').toUpperCase() === ticker,
    );
    if (!enrichments.length) {
      return res.status(404).json({ error: `No analyzed transcripts found for ${ticker}.` });
    }

    const { runTranscriptManager } = await import('./transcripts/manager.mjs');
    const result = await runTranscriptManager({ documents: enrichments });
    const totalChunks = enrichments.reduce(
      (sum, enrichment) => sum + (enrichment.toneSummary?.chunks || enrichment.stats?.chunks || 0),
      0,
    );
    const llmInterpreted = enrichments.reduce(
      (sum, enrichment) => sum + (enrichment.toneSummary?.llmInterpreted || 0),
      0,
    );
    // Flatten structured key figures across every quarter so the UI can show a
    // keyword's trajectory report-over-report in one grid.
    const quarterOrder = enrichment => (Number(enrichment.year) || 0) * 10
      + (Number(String(enrichment.quarter || '').replace(/\D/g, '')) || 0);
    const keyFigures = enrichments
      .slice()
      .sort((a, b) => quarterOrder(b) - quarterOrder(a))
      .flatMap(enrichment => (enrichment.keyFigures || []).map(figure => ({
        ...figure,
        period: `${enrichment.year} ${enrichment.quarter}`,
        periodKey: quarterOrder(enrichment),
        fiscal_period: enrichment.fiscal_period,
      })));
    // Per-quarter tone split by who is speaking: management answers (read as an
    // investor would — "investor tone") vs. the analysts asking the questions
    // ("analyst tone"). Both use the same composite investor-confidence score so
    // they trend on one 0–100 axis.
    const roleToneAverage = (chunks, role) => {
      const scores = (chunks || [])
        .filter(chunk => chunk.role === role && chunk.tone?.composite)
        .map(chunk => chunk.tone.composite.investorConfidence);
      return scores.length
        ? Number((scores.reduce((sum, value) => sum + value, 0) / scores.length).toFixed(1))
        : null;
    };
    const toneByRole = enrichments
      .slice()
      .sort((a, b) => quarterOrder(a) - quarterOrder(b))
      .map(enrichment => ({
        period: `${enrichment.year} ${enrichment.quarter}`,
        fiscal_period: enrichment.fiscal_period,
        investor: roleToneAverage(enrichment.chunks, 'Management'),
        analyst: roleToneAverage(enrichment.chunks, 'Analyst'),
      }));
    res.json({
      ticker,
      analysis: result.analysis,
      reports: result.reports,
      keyFigures,
      toneByRole,
      execution: result.events,
      modelUsage: {
        deterministicPipeline: true,
        totalChunks,
        llmInterpreted,
        llmShare: totalChunks ? Number((llmInterpreted / totalChunks).toFixed(4)) : 0,
        scope: 'Optional qualitative tone interpretation on selected management answers only.',
      },
    });
  } catch (e) {
    console.error('[transcripts:analysis]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Four-quarter cross-analysis (SNDK): AV newest quarter + EDGAR for the older three.
app.post('/api/transcript/series', requireAdminSecret, async (req, res) => {
  try {
    res.json(await analyzeSeries(req.body?.symbol ?? 'SNDK'));
  } catch (e) {
    console.error('[transcript:series]', e.message);
    res.status(502).json({ error: e.message });
  }
});
app.post('/api/transcript/analyze', async (req, res) => {
  const body = req.body ?? {};
  const threshold = Number.isFinite(body.anomalyThreshold) ? body.anomalyThreshold : 0.4;
  try {
    let blocks = Array.isArray(body.transcript) ? body.transcript : null;
    let source = null;
    if (!blocks && body.symbol && body.quarter) {
      const t = await fetchTranscript(body.symbol, body.quarter);
      blocks = t.blocks;
      source = { provider: 'Alpha Vantage', symbol: t.symbol, quarter: t.quarter, usingKey: t.usingKey };
    }
    if (!blocks && typeof body.text === 'string') blocks = parseTranscript(body.text);
    if (!blocks || blocks.length === 0) {
      return res.status(400).json({ error: 'Provide `transcript`, `text`, or `{symbol, quarter}`.' });
    }
    const result = await runTranscriptAgent(blocks, { anomalyThreshold: threshold });
    if (source) result.source = source;
    res.json(result);
  } catch (e) {
    console.error('[transcript]', e.message);
    res.status(502).json({ error: e.message });
  }
});

// ── AI data center buildout data (MongoDB → frontend) ───────────────────────
app.get('/api/dc-buildouts', async (req, res) => {
  if (!process.env.MONGODB_URI) return res.status(503).json({ error: 'MONGODB_URI not configured' });
  const { MongoClient } = require('mongodb');
  let client;
  try {
    client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
    await client.connect();
    const db = client.db(process.env.MONGODB_DB || undefined);
    const [trends, operators, projects, companyDocs] = await Promise.all([
      db.collection('dcDeploymentTrends').findOne({ _type: 'snapshot' }),
      db.collection('dcOperators').find({}).toArray(),
      db.collection('dcProjects').find({}).toArray(),
      db.collection('dcCompanyCharts').find({}).toArray(),
    ]);
    if (!trends || !operators.length || !projects.length) {
      return res.status(404).json({ error: 'No DC buildout data in database yet.' });
    }
    const { _id, _type, updatedAt, ...trendFields } = trends;
    const companyCharts = {};
    for (const { _id, _key, updatedAt, ...c } of companyDocs) companyCharts[_key] = c;
    res.json({
      deploymentTrends: trendFields,
      operators: operators.map(({ _id, updatedAt, ...o }) => o),
      projects:  projects.map(({ _id, updatedAt, ...p }) => p),
      companyCharts,
    });
  } catch (e) {
    console.error('[dc-buildouts]', e.message);
    res.status(500).json({ error: e.message });
  } finally {
    await client?.close();
  }
});

// ── LSEG stored transcripts (MongoDB → frontend) ────────────────────────────
// Returns a list of all transcripts in the `transcripts` collection, or the
// full document(s) for a specific ticker. Analysis is NOT re-run here; the
// backfill script populates the collection offline.
app.get('/api/transcripts/stored', async (req, res) => {
  const { MongoClient } = require('mongodb');
  if (!process.env.MONGODB_URI) return res.json([]);
  let client;
  try {
    client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
    await client.connect();
    const col = client.db(process.env.MONGODB_DB || undefined).collection('transcripts');
    const docs = await col
      .find({}, { projection: { rawText: 0, blocks: 0 } })
      .sort({ date: -1 })
      .toArray();
    res.json(docs);
  } catch (e) {
    console.error('[transcripts/stored]', e.message);
    res.status(500).json({ error: e.message });
  } finally {
    client?.close().catch(() => {});
  }
});

app.get('/api/transcripts/stored/:ticker', async (req, res) => {
  const ticker = (req.params.ticker ?? '').toUpperCase();
  if (!ticker) return res.status(400).json({ error: 'ticker required' });
  const { MongoClient } = require('mongodb');
  if (!process.env.MONGODB_URI) return res.json([]);
  let client;
  try {
    client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
    await client.connect();
    const col = client.db(process.env.MONGODB_DB || undefined).collection('transcripts');
    const docs = await col.find({ ticker }).sort({ date: -1 }).toArray();
    res.json(docs);
  } catch (e) {
    console.error('[transcripts/stored/:ticker]', e.message);
    res.status(500).json({ error: e.message });
  } finally {
    client?.close().catch(() => {});
  }
});

app.post('/api/refresh', requireAdminSecret, async (req, res) => {
  const keys = req.body?.keys ?? Object.keys(scheduler.scrapers);
  try {
    await scheduler.refreshAll(keys);
    await storage.flush();
    res.json({ ok: true, refreshed: keys, ts: new Date().toISOString() });
  } catch (e) {
    console.error('[refresh]', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});


/* ── Options flow (per-ticker, 5-min cache) ──────────────────────── */
app.get('/api/stocks/:ticker', async (req, res) => {
  const ticker = (req.params.ticker ?? '').trim().toUpperCase();
  if (!ticker || !/^[A-Z0-9.^=-]{1,10}$/i.test(ticker))
    return res.status(400).json({ error: 'Invalid ticker symbol' });

  const cacheKey = `stocks:${ticker}`;
  const cached   = cache.get(cacheKey);
  if (cached !== null) return res.json(cached);

  try {
    const data = await getStockHistory(ticker);
    cache.set(cacheKey, data, 60 * 60 * 1000); // 1-hour TTL
    res.json(data);
  } catch (e) {
    console.error('[stocks]', ticker, e.message);
    const rateLimited = e.message?.includes('429') || /Too Many Requests|crumb/i.test(e.message ?? '');
    if (rateLimited)
      return res.status(503).json({ error: 'Yahoo Finance is rate-limiting. Please try again in a moment.' });
    res.status(500).json({ error: `Could not load data for ${ticker}: ${e.message}` });
  }
});

/* ── US Rotation — Mongo-persisted daily history, no request-time scrape ── */
app.get('/api/us-performance', async (req, res) => {
  const rawStart = (req.query.start ?? '').trim();
  const rawEnd = (req.query.end ?? '').trim();
  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

  let start = oneYearAgo.toISOString().slice(0, 10);
  if (rawStart) {
    const parsed = new Date(rawStart);
    if (isNaN(parsed.getTime()) || !/^\d{4}-\d{2}-\d{2}$/.test(rawStart))
      return res.status(400).json({ error: 'Invalid start date' });
    if (parsed.getTime() > Date.now())
      return res.status(400).json({ error: 'Start date cannot be in the future' });
    start = rawStart;
  }

  let end = new Date().toISOString().slice(0, 10);
  if (rawEnd) {
    const parsed = new Date(rawEnd);
    if (isNaN(parsed.getTime()) || !/^\d{4}-\d{2}-\d{2}$/.test(rawEnd))
      return res.status(400).json({ error: 'Invalid end date' });
    if (parsed.getTime() > Date.now())
      return res.status(400).json({ error: 'End date cannot be in the future' });
    end = rawEnd;
  }

  if (new Date(start).getTime() > new Date(end).getTime())
    return res.status(400).json({ error: 'Start date cannot be after end date' });

  try {
    res.json(readUsPerformance(start, end));
  } catch (e) {
    console.error('[us-performance]', start, end, e.message);
    res.status(500).json({ error: `Could not load US performance data: ${e.message}` });
  }
});

/* ── Global Rotation — index price/turnover history, Mongo-persisted ──── */
app.get('/api/global-indices', async (req, res) => {
  const rawStart = (req.query.start ?? '').trim();
  const rawEnd = (req.query.end ?? '').trim();
  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

  let start = oneYearAgo.toISOString().slice(0, 10);
  if (rawStart) {
    const parsed = new Date(rawStart);
    if (isNaN(parsed.getTime()) || !/^\d{4}-\d{2}-\d{2}$/.test(rawStart))
      return res.status(400).json({ error: 'Invalid start date' });
    if (parsed.getTime() > Date.now())
      return res.status(400).json({ error: 'Start date cannot be in the future' });
    start = rawStart;
  }

  let end = new Date().toISOString().slice(0, 10);
  if (rawEnd) {
    const parsed = new Date(rawEnd);
    if (isNaN(parsed.getTime()) || !/^\d{4}-\d{2}-\d{2}$/.test(rawEnd))
      return res.status(400).json({ error: 'Invalid end date' });
    if (parsed.getTime() > Date.now())
      return res.status(400).json({ error: 'End date cannot be in the future' });
    end = rawEnd;
  }

  if (new Date(start).getTime() > new Date(end).getTime())
    return res.status(400).json({ error: 'Start date cannot be after end date' });

  try {
    res.json(readGlobalIndices(start, end));
  } catch (e) {
    console.error('[global-indices]', start, end, e.message);
    res.status(500).json({ error: `Could not load global index data: ${e.message}` });
  }
});

// Breadth history is small (a few numbers/day × 10 indices) and always
// returned in full — no date-range query needed, same as
// china-national-team-flow below.
app.get('/api/index-breadth', (_req, res) => res.json(readIndexBreadth()));

/* ── China Rotation — Mongo-persisted daily history, no request-time scrape */
app.get('/api/hk-china-performance', async (req, res) => {
  const rawStart = (req.query.start ?? '').trim();
  const rawEnd = (req.query.end ?? '').trim();
  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

  let start = oneYearAgo.toISOString().slice(0, 10);
  if (rawStart) {
    const parsed = new Date(rawStart);
    if (isNaN(parsed.getTime()) || !/^\d{4}-\d{2}-\d{2}$/.test(rawStart))
      return res.status(400).json({ error: 'Invalid start date' });
    if (parsed.getTime() > Date.now())
      return res.status(400).json({ error: 'Start date cannot be in the future' });
    start = rawStart;
  }

  let end = new Date().toISOString().slice(0, 10);
  if (rawEnd) {
    const parsed = new Date(rawEnd);
    if (isNaN(parsed.getTime()) || !/^\d{4}-\d{2}-\d{2}$/.test(rawEnd))
      return res.status(400).json({ error: 'Invalid end date' });
    if (parsed.getTime() > Date.now())
      return res.status(400).json({ error: 'End date cannot be in the future' });
    end = rawEnd;
  }

  if (new Date(start).getTime() > new Date(end).getTime())
    return res.status(400).json({ error: 'Start date cannot be after end date' });

  try {
    res.json(readHkChinaPerformance(start, end));
  } catch (e) {
    console.error('[hk-china-performance]', start, end, e.message);
    res.status(500).json({ error: `Could not load HK/China performance data: ${e.message}` });
  }
});

/* ── China ETF sentiment — 513310/513100 premium to NAV/IOPV ───────────── */
app.get('/api/china-etf-premium', async (req, res) => {
  const rawStart = (req.query.start ?? '').trim();
  const rawEnd = (req.query.end ?? '').trim();
  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
  const start = rawStart || oneYearAgo.toISOString().slice(0, 10);
  const end = rawEnd || new Date().toISOString().slice(0, 10);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end))
    return res.status(400).json({ error: 'Invalid date' });
  if (start > end) return res.status(400).json({ error: 'Start date cannot be after end date' });
  if (new Date(`${end}T23:59:59Z`).getTime() > Date.now() + 24 * 60 * 60 * 1000)
    return res.status(400).json({ error: 'End date cannot be in the future' });

  try {
    res.json(readChinaEtfPremium(start, end));
  } catch (e) {
    console.error('[china-etf-premium]', start, end, e.message);
    res.status(500).json({ error: `Could not load China ETF premium data: ${e.message}` });
  }
});

/* ── HK Performance — Hang Seng Composite sub-indices vs HSCI ────────────────
 * Reads only the Mongo-persisted history (readHkPerformance) — never scrapes
 * East Money live on a request. A cron job (see scheduler.js) extends the
 * history daily; see server/scrapers/hkPerformance.js for why. */
app.get('/api/hk-performance', (req, res) => {
  const rawStart = (req.query.start ?? '').trim();
  const rawEnd = (req.query.end ?? '').trim();
  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

  let start = oneYearAgo.toISOString().slice(0, 10);
  if (rawStart) {
    const parsed = new Date(rawStart);
    if (isNaN(parsed.getTime()) || !/^\d{4}-\d{2}-\d{2}$/.test(rawStart))
      return res.status(400).json({ error: 'Invalid start date' });
    if (parsed.getTime() > Date.now())
      return res.status(400).json({ error: 'Start date cannot be in the future' });
    start = rawStart;
  }

  let end = new Date().toISOString().slice(0, 10);
  if (rawEnd) {
    const parsed = new Date(rawEnd);
    if (isNaN(parsed.getTime()) || !/^\d{4}-\d{2}-\d{2}$/.test(rawEnd))
      return res.status(400).json({ error: 'Invalid end date' });
    if (parsed.getTime() > Date.now())
      return res.status(400).json({ error: 'End date cannot be in the future' });
    end = rawEnd;
  }

  if (new Date(start).getTime() > new Date(end).getTime())
    return res.status(400).json({ error: 'Start date cannot be after end date' });

  try {
    const full = readHkPerformance();
    const dates = full.dates.filter(d => d >= start && d <= end);
    const startIdx = full.dates.indexOf(dates[0]);
    const endIdx = full.dates.indexOf(dates[dates.length - 1]);
    const series = full.series.map(s => ({
      ...s,
      closes: startIdx === -1 ? [] : s.closes.slice(startIdx, endIdx + 1),
    }));
    res.json({ start: dates[0] ?? null, end: dates[dates.length - 1] ?? null, dates, series });
  } catch (e) {
    console.error('[hk-performance]', start, end, e.message);
    res.status(500).json({ error: `Could not load HK performance data: ${e.message}` });
  }
});

app.get('/api/options/:ticker', async (req, res) => {
  const ticker = (req.params.ticker ?? '').trim().toUpperCase();
  const date   = req.query.date ?? null;
  if (!ticker) return res.status(400).json({ error: 'ticker required' });

  const cacheKey = `options:${ticker}:${date ?? 'nearest'}`;
  const cached   = cache.get(cacheKey);
  if (cached !== null) return res.json(cached);

  try {
    const data = await getOptionsData(ticker, date);
    cache.set(cacheKey, data, 5 * 60 * 1000);
    res.json(data);
  } catch (e) {
    console.error('[options]', ticker, e.message);
    res.status(500).json({ error: `Could not load options for ${ticker}: ${e.message}` });
  }
});

/* ── Per-company TWSE margin & short balances (Leverage page search) ──── */
const { getTwseCompanyMargin } = require('./scrapers/twseCompanyMargin');

app.get('/api/taiwan-margin/:code', async (req, res) => {
  const code = (req.params.code ?? '').trim();
  if (!/^\d{4,6}[A-Za-z]?$/.test(code))
    return res.status(400).json({ error: 'Invalid TWSE stock code' });

  const cacheKey = `taiwanMargin:${code}`;
  const cached   = cache.get(cacheKey);
  if (cached !== null) return res.json(cached);

  try {
    const data = await getTwseCompanyMargin(code);
    // Source updates once daily after the Taipei close — no reason to hammer it.
    cache.set(cacheKey, data, 60 * 60 * 1000);
    res.json(data);
  } catch (e) {
    console.error('[taiwan-margin]', code, e.message);
    res.status(500).json({ error: `Could not load margin data for ${code}: ${e.message}` });
  }
});

/* ── Daily options report (Alerts page) ──────────────────────────────── */
const optionsReportStore = require('./optionsReportStore');

app.get('/api/alerts/daily-options-report', async (req, res, next) => {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date || '')) ? req.query.date : null;
  try {
    const [report, availableDates] = await Promise.all([
      optionsReportStore.readDailyReportProjected(date),
      optionsReportStore.readAvailableReportDatesProjected(),
    ]);
    res.json({ report, availableDates });
  } catch (error) {
    next(error);
  }
});

function storedToPdf(stored) {
  return {
    ...optionsReportStore.pdfMeta(stored),
    source: 'storage',
    buffer: Buffer.from(stored.base64, 'base64'),
    contentType: stored.contentType || 'application/pdf',
  };
}

function fileToPdf(date, file) {
  try {
    const stat = require('fs').statSync(file);
    if (!stat.isFile()) return null;
    return {
      date,
      filename: path.basename(file),
      file,
      size: stat.size,
      updatedAt: stat.mtime.toISOString(),
      url: `/api/alerts/daily-options-report/pdf?date=${encodeURIComponent(date)}`,
      source: 'file',
    };
  } catch {
    return null;
  }
}

// Newest committed daily-options-data-YYYY-MM-DD.pdf in the repo root, if any.
function latestDailyOptionsFile() {
  const dir = path.join(__dirname, '..');
  let best = null;
  try {
    for (const name of require('fs').readdirSync(dir)) {
      const m = name.match(/^daily-options-data-(\d{4}-\d{2}-\d{2})\.pdf$/);
      if (m && (!best || m[1] > best.date)) best = { date: m[1], file: path.join(dir, name) };
    }
  } catch {}
  return best;
}

// Resolve the PDF to serve. With no `date`, return the most recent report we
// have — the stored blob first, then the newest committed daily-options file —
// so the page always shows the latest report even before today's run lands.
async function dailyOptionsPdf(date, options = {}) {
  const stored = await optionsReportStore.readLatestDailyOptionsPdfProjected(options);

  if (!date) {
    if (stored?.base64) return storedToPdf(stored);
    const latest = latestDailyOptionsFile();
    return latest ? fileToPdf(latest.date, latest.file) : null;
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) return null;
  if (stored?.date === date && stored?.base64) return storedToPdf(stored);
  return fileToPdf(date, path.join(__dirname, '..', `daily-options-data-${date}.pdf`));
}

app.get('/api/alerts/daily-options-report/pdf-meta', async (req, res) => {
  const requestedDate = req.query.date;
  const stored = await optionsReportStore.readLatestDailyOptionsPdfMetaProjected();
  if ((!requestedDate || requestedDate === stored?.date) && stored) {
    return res.json({ pdf: stored });
  }
  const file = requestedDate
    ? fileToPdf(requestedDate, path.join(__dirname, '..', `daily-options-data-${requestedDate}.pdf`))
    : (() => {
        const latest = latestDailyOptionsFile();
        return latest ? fileToPdf(latest.date, latest.file) : null;
      })();
  res.json({ pdf: file && {
    date: file.date,
    filename: file.filename,
    size: file.size,
    updatedAt: file.updatedAt,
    url: file.url,
  } });
});

app.get('/api/alerts/daily-options-report/pdf', async (req, res) => {
  const pdf = await dailyOptionsPdf(req.query.date);
  if (!pdf) return res.status(404).json({ error: `No PDF report found${req.query.date ? ` for ${req.query.date}` : ''}.` });
  if (pdf.source === 'storage') {
    res
      .set({
        'Content-Type': pdf.contentType,
        'Content-Disposition': `inline; filename="${pdf.filename}"`,
      })
      .send(pdf.buffer);
    return;
  }
  res.sendFile(pdf.file, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${pdf.filename}"`,
    },
  });
});

// Cheap "Refresh": re-read the stored blob from Mongo (picks up whatever the
// GitHub Action or a manual backfill already wrote) instead of re-running the
// whole Massive scrape in the request, which is what /generate below does.
app.post('/api/alerts/daily-options-report/reload', async (req, res) => {
  try {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(req.body?.date || '')) ? req.body.date : undefined;
    const [report, availableDates] = await Promise.all([
      optionsReportStore.readDailyReportProjected(date, { refresh: true }),
      optionsReportStore.readAvailableReportDatesProjected({ refresh: true }),
    ]);
    res.json({ report, availableDates });
  } catch (e) {
    console.error('[options-report:reload]', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post(
  '/api/alerts/daily-options-report/generate',
  requireAdminSecret,
  requireStorageBlobs('dailyOptionsReport', 'optionsPriorYearVolume', 'earningsDates'),
  async (req, res) => {
  try {
    const meta = await optionsReportStore.generateAndStoreDailyOptions({
      date: req.body?.date,
      tickers: req.body?.tickers,
    });
    res.json({ meta, report: optionsReportStore.readDailyReport(meta.date) });
  } catch (e) {
    console.error('[options-report:generate]', e.message);
    res.status(500).json({ error: e.message });
  }
  },
);

/* ── Earnings calendar (Alerts page) ─────────────────────────────────── */
// Events are scraped ahead of time into Mongo (FMP once a month, Alpha Vantage
// in small daily batches — see server/techEarningsCalendar.js), so this route
// is a synchronous cache read and never blocks on either vendor.
const techEarningsCalendar = require('./techEarningsCalendar');

app.get('/api/alerts/earnings-calendar', (req, res) => {
  res.json({ events: techEarningsCalendar.getStoredEvents() });
});

app.post('/api/chat', async (req, res) => {
  const { message, history } = req.body ?? {};
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'message required' });
  }
  try {
    const result = await chat(message, Array.isArray(history) ? history : []);
    res.json(result);
  } catch (e) {
    console.error('[chat]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Keep Vercel function failures machine-readable and allow the platform to
// recycle a bad invocation instead of Express returning its default HTML page.
app.use((error, _req, res, _next) => {
  console.error('[server]', error);
  res.status(500).json({ error: 'Internal server error' });
});

/* ── Persistent storage (Mongo in prod, JSON files in dev) ──────────── */
/* ── Frontend serving ──────────────────────────────────────────────── */
async function start() {
  // Connect storage (and seed Mongo from the committed JSON baseline) before
  // serving requests or running the warmup scrape, so reads/writes are routed.
  await initialize();

  if (isProd) {
    // Production: serve Vite build output; read manifest for hashed filenames
    const distDir  = path.join(__dirname, '..', 'dist');
    const manifest = require(path.join(distDir, '.vite', 'manifest.json'));
    const entry    = manifest['src/main.jsx'];

    const head = (entry.css ?? [])
      .map(f => `<link rel="stylesheet" href="/${f}" />`)
      .join('\n    ');
    const body = `<script type="module" src="/${entry.file}"></script>`;
    const prodHtml = htmlTemplate({ head, body });

    app.use(express.static(distDir));
    app.get('/{*any}', (_req, res) => {
      res.status(200).set('Content-Type', 'text/html').end(prodHtml);
    });

  } else {
    // Development: mount Vite as Express middleware (HMR included)
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server:  { middlewareMode: true },
      appType: 'custom',
    });

    app.use(vite.middlewares);

    app.get('/{*any}', async (req, res) => {
      try {
        const raw  = htmlTemplate({ body: '<script type="module" src="/src/main.jsx"></script>' });
        const html = await vite.transformIndexHtml(req.url, raw);
        res.status(200).set('Content-Type', 'text/html').end(html);
      } catch (e) {
        vite.ssrFixStacktrace(e);
        res.status(500).end(e.message);
      }
    });
  }

  app.listen(PORT, () => {
    console.log(`[server] ${isProd ? 'production' : 'development'} — http://localhost:${PORT}`);
    scheduler.setup();
    // Refresh every source in the background so stale seeded snapshots get
    // replaced with fresh data. Fire-and-forget so startup isn't delayed; the
    // cache (seeded above) already serves last-known values in the meantime.
    setImmediate(async () => {
      // Rotation pages read their dedicated Mongo histories immediately and
      // are refreshed by the scheduled collector; do not burst their market
      // APIs on every web-service restart.
      const allKeys = Object.keys(scheduler.scrapers).filter(key => !scheduler.PERSISTED_ONLY.has(key));
      const schedulerBlobs = STORAGE_BLOBS.filter(blob => ![
        'dailyOptionsReport', 'optionsPriorYearVolume', 'earningsDates',
        'techEarningsCalendar', 'latestSnapshots',
      ].includes(blob.name));
      console.log('[warmup] loading scheduler history in background');
      await storage.loadMany(schedulerBlobs);
      console.log('[warmup] refreshing in background:', allKeys.join(', '));
      scheduler.refreshAll(allKeys).catch(e => console.error('[warmup]', e.message));
    });
  });
}

if (require.main === module) {
  start().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = app;
module.exports.initialize = initialize;
