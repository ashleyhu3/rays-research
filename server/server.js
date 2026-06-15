const express      = require('express');
const cors         = require('cors');
const path         = require('path');
const cache        = require('./cache');
const history      = require('./history');
const scheduler    = require('./scheduler');
const htmlTemplate = require('./htmlTemplate');
const { chat, invalidateEmbeddings } = require('./chat');
const { getOptionsData }             = require('./scrapers/options');

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
      }
      res.json(data ?? {});
    } catch (e) {
      console.error(`[${key}]`, e.message);
      res.status(500).json({ error: e.message });
    }
  };
}

/* ── API routes ────────────────────────────────────────────────────── */
const s = scheduler.scrapers;

app.get('/api/pypi',       cachedRoute('pypi',       s.pypi));
app.get('/api/trends',     cachedRoute('trends',     s.trends));
app.get('/api/jobs',       cachedRoute('jobs',       s.jobs));
app.get('/api/gpu',        cachedRoute('gpu',        s.gpu));
app.get('/api/github',     cachedRoute('github',     s.github));
app.get('/api/openrouter', cachedRoute('openrouter', s.openrouter));
app.get('/api/eia',            cachedRoute('eia',           s.eia));
app.get('/api/mops',           cachedRoute('mops',          s.mops));
app.get('/api/github-commits', cachedRoute('githubCommits', s.githubCommits));
app.get('/api/docker',         cachedRoute('docker',        s.docker));
app.get('/api/hn',             cachedRoute('hn',            s.hn));
app.get('/api/wikipedia',         cachedRoute('wikipedia',        s.wikipedia));
app.get('/api/openrouter-ranks',  cachedRoute('openrouterRanks',  s.openrouterRanks));
app.get('/api/dram',              cachedRoute('dram',             s.dram));
app.get('/api/npm',               cachedRoute('npm',              s.npm));
app.get('/api/stackoverflow',     cachedRoute('stackoverflow',    s.stackoverflow));
app.get('/api/huggingface',       cachedRoute('huggingface',      s.huggingface));
app.get('/api/mcp',               cachedRoute('mcp',              s.mcp));
app.get('/api/sec',               cachedRoute('sec',              s.sec));

// Accumulated daily snapshots of point-in-time metrics (for trend charts)
app.get('/api/metrics-history', (_req, res) => res.json(history.all()));

app.post('/api/refresh', async (req, res) => {
  const keys = req.body?.keys ?? Object.keys(scheduler.scrapers);
  try {
    await scheduler.refreshAll(keys);
    invalidateEmbeddings();
    res.json({ ok: true, refreshed: keys, ts: new Date().toISOString() });
  } catch (e) {
    console.error('[refresh]', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/* ── Options flow (per-ticker, 5-min cache) ──────────────────────── */
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
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/chat', async (req, res) => {
  const { message } = req.body ?? {};
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'message required' });
  }
  try {
    const result = await chat(message);
    res.json(result);
  } catch (e) {
    console.error('[chat]', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/health', (_, res) => res.json({ ok: true, ts: new Date().toISOString() }));

/* ── Frontend serving ──────────────────────────────────────────────── */
async function start() {
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
    // Seed all scrapers on startup so the Ask tab has full data immediately.
    // Everything runs in background (fire-and-forget) so startup isn't delayed.
    setImmediate(() => {
      const allKeys = Object.keys(scheduler.scrapers).filter(k => cache.get(k) === null);
      if (allKeys.length > 0) {
        console.log('[warmup] seeding in background:', allKeys.join(', '));
        scheduler.refreshAll(allKeys).catch(e => console.error('[warmup]', e.message));
      }
    });
  });
}

start().catch(err => { console.error(err); process.exit(1); });
