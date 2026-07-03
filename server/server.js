const express      = require('express');
const cors         = require('cors');
const path         = require('path');
const cache        = require('./cache');
const storage      = require('./storage');
const history      = require('./history');
const snapshotStore = require('./snapshotStore');
const scheduler    = require('./scheduler');
const htmlTemplate = require('./htmlTemplate');
const { chat } = require('./chat');
const { getOptionsData }             = require('./scrapers/options');
const { getStockHistory }            = require('./scrapers/stocks');
const { searchKeyword }              = require('./scrapers/keywordSearch');

const app   = express();
const PORT  = process.env.PORT || 3001;
const isProd = process.env.NODE_ENV === 'production';

app.use(cors());
app.use(express.json());

/* ── Helper: lazy-cached route ─────────────────────────────────────── */
// Coalesce concurrent cache misses into one scrape — without this, several
// browser requests (or a request racing the startup warmup) each fire their
// own scrape, which slow rate-limited sources punish badly.
const inflight = new Map();

function cachedRoute(key, scraper) {
  return async (req, res) => {
    let data = cache.get(key);
    if (data !== null) return res.json(data);
    try {
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
      res.json(data ?? {});
    } catch (e) {
      const status = /\b429\b|rate.?limit|too many requests/i.test(e.message ?? '') ? 'RATE-LIMITED' : 'DOWN';
      cache.recordFailure(key, status, e.message);
      console.error(`[${key}]`, e.message);
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
app.get('/api/openrouter-ranks',  cachedRoute('openrouterRanks',  s.openrouterRanks));
app.get('/api/dram',              cachedRoute('dram',             s.dram));
app.get('/api/aws',               cachedRoute('aws',              s.aws));
app.get('/api/cpu',               cachedRoute('cpu',              s.cpu));
app.get('/api/tpu',               cachedRoute('tpu',              s.tpu));
app.get('/api/epoch-revenue',     cachedRoute('epochRevenue',     s.epochRevenue));
app.get('/api/sentiment',         cachedRoute('sentiment',        s.sentiment));
app.get('/api/web-traffic',       cachedRoute('webTraffic',       s.webTraffic));

// Keyword frequency search — scans all StockTwits CSVs for whole-word matches,
// grouped by month. Results cached 1 hour per (lowercased) keyword.
app.get('/api/sentiment/keyword', async (req, res) => {
  const q = (req.query.q ?? '').trim();
  if (!q)        return res.status(400).json({ error: 'q is required' });
  if (q.length > 60) return res.status(400).json({ error: 'keyword too long (max 60 chars)' });

  const cacheKey = `keyword:${q.toLowerCase()}`;
  const cached   = cache.get(cacheKey);
  if (cached !== null) return res.json(cached);

  try {
    const data = await searchKeyword(q);
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
// Stages 1-2 collect full transcripts (Octagon by default, Alpha Vantage as a
// fallback) then normalize the source into deterministic prepared/Q&A speaker
// blocks before topic tagging, tone scoring, and cross-quarter analysis.
const { collectFromAlphaVantage } = require('./transcripts/alphavantage');
const { collectFromOctagon } = require('./transcripts/octagon');
const { semanticChunkDocument } = require('./transcripts/chunker');
const { listLocalEnrichments, readEnrichment, saveEnrichment } = require('./transcripts/enrichmentStore');
const { parseTranscriptDocument } = require('./transcripts/parser');
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

app.post('/api/transcripts/collect', async (req, res) => {
  const body = req.body ?? {};
  try {
    const provider = String(body.provider || 'alphavantage').toLowerCase();
    const collector = provider === 'octagon' ? collectFromOctagon : collectFromAlphaVantage;
    const transcript = await collector({
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
    res.json({
      ticker,
      analysis: result.analysis,
      reports: result.reports,
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
app.post('/api/transcript/series', async (req, res) => {
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

app.post('/api/refresh', async (req, res) => {
  const keys = req.body?.keys ?? Object.keys(scheduler.scrapers);
  try {
    await scheduler.refreshAll(keys);
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

app.get('/api/health', (_, res) => res.json({ ok: true, ts: new Date().toISOString() }));

/* ── Persistent storage (Mongo in prod, JSON files in dev) ──────────── */
const DATA_DIR = path.join(__dirname, 'data');
const STORAGE_BLOBS = [
  { name: 'metricsHistory',  file: path.join(DATA_DIR, 'metricsHistory.json') },
  { name: 'gpuHistory',      file: path.join(DATA_DIR, 'gpuHistory.json') },
  { name: 'dramHistory',     file: path.join(DATA_DIR, 'dramHistory.json') },
  { name: 'awsHistory',      file: path.join(DATA_DIR, 'awsHistory.json') },
  { name: 'cpuHistory',      file: path.join(DATA_DIR, 'cpuHistory.json') },
  { name: 'tpuHistory',      file: path.join(DATA_DIR, 'tpuHistory.json') },
  { name: 'sentimentData',   file: path.join(DATA_DIR, 'sentiment.json') },
  // Latest scrape per source — loaded into the request cache on boot for an
  // instant first paint instead of blocking on live re-scrapes.
  { name: 'latestSnapshots', file: path.join(DATA_DIR, 'latestSnapshots.json') },
];

/* ── Frontend serving ──────────────────────────────────────────────── */
async function start() {
  // Connect storage (and seed Mongo from the committed JSON baseline) before
  // serving requests or running the warmup scrape, so reads/writes are routed.
  await storage.init(STORAGE_BLOBS);

  // Seed the request cache from the last persisted scrape so the first visitor
  // after a restart is served instantly; the background warmup below then
  // refreshes every source to replace the stale snapshots.
  const seeded = snapshotStore.seed(cache, scheduler.TTL);
  if (seeded.length > 0) console.log(`[warmup] seeded cache from snapshots: ${seeded.join(', ')}`);

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
    setImmediate(() => {
      const allKeys = Object.keys(scheduler.scrapers);
      console.log('[warmup] refreshing in background:', allKeys.join(', '));
      scheduler.refreshAll(allKeys).catch(e => console.error('[warmup]', e.message));
    });
  });
}

start().catch(err => { console.error(err); process.exit(1); });
