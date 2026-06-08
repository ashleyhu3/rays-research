const express   = require('express');
const cors      = require('cors');
const path      = require('path');
const cache     = require('./cache');
const scheduler = require('./scheduler');

const app = express();
app.use(cors());
app.use(express.json());

// Serve built React app in production
app.use(express.static(path.join(__dirname, '..', 'dist')));

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

/* ── Manual refresh trigger ────────────────────────────────────────── */
app.post('/api/refresh', async (req, res) => {
  const keys = req.body?.keys ?? Object.keys(scheduler.scrapers);
  scheduler.refreshAll(keys).catch(console.error);
  res.json({ queued: keys });
});

/* ── Health check ──────────────────────────────────────────────────── */
app.get('/api/health', (_, res) => res.json({ ok: true, ts: new Date().toISOString() }));

/* ── SPA fallback ──────────────────────────────────────────────────── */
app.get('/{*any}', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'dist', 'index.html'));
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`[server] Listening on http://localhost:${PORT}`);
  scheduler.setup();
});
