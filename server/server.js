const express      = require('express');
const cors         = require('cors');
const path         = require('path');
const cache        = require('./cache');
const scheduler    = require('./scheduler');
const htmlTemplate = require('./htmlTemplate');

const app   = express();
const PORT  = process.env.PORT || 3001;
const isProd = process.env.NODE_ENV === 'production';

app.use(cors());
app.use(express.json());

/* ── Helper: lazy-cached route ─────────────────────────────────────── */
function cachedRoute(key, scraper) {
  return async (req, res) => {
    let data = cache.get(key);
    if (data !== null) return res.json(data);
    try {
      data = await scraper();
      if (data != null) cache.set(key, data, scheduler.TTL[key] ?? 3600000);
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
app.get('/api/reddit',     cachedRoute('reddit',     s.reddit));
app.get('/api/appstore',   cachedRoute('appstore',   s.appstore));
app.get('/api/jobs',       cachedRoute('jobs',       s.jobs));
app.get('/api/gpu',        cachedRoute('gpu',        s.gpu));
app.get('/api/github',     cachedRoute('github',     s.github));
app.get('/api/openrouter', cachedRoute('openrouter', s.openrouter));
app.get('/api/eia',        cachedRoute('eia',        s.eia));
app.get('/api/mops',       cachedRoute('mops',       s.mops));

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
  });
}

start().catch(err => { console.error(err); process.exit(1); });
