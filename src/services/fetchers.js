function fetchT(url, ms = 12000) {
  const ac = new AbortController();
  const id = setTimeout(() => ac.abort(), ms);
  return fetch(url, { signal: ac.signal }).finally(() => clearTimeout(id));
}

/* ── npm weekly downloads (last 52 weeks) ─────────────────────────── */
const NPM_PKGS = [
  'openai',
  'anthropic',
  'mistralai',
  '@anthropic-ai/sdk',
  '@google/genai',
  'langchain',
  '@langchain/core',
  'llamaindex',
  'ai',
  '@huggingface/inference',
];

async function fetchNpmPkg(pkg) {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 365);
  const fmt = d => d.toISOString().slice(0, 10);
  const url = `https://api.npmjs.org/downloads/range/${fmt(start)}:${fmt(end)}/${encodeURIComponent(pkg)}`;
  const res = await fetchT(url);
  if (!res.ok) return [];
  const { downloads = [] } = await res.json();
  const weeks = [];
  for (let i = 0; i + 6 < downloads.length; i += 7)
    weeks.push(downloads.slice(i, i + 7).reduce((s, d) => s + d.downloads, 0));
  return weeks; // ~52 entries, oldest first
}

async function fetchNpm() {
  const results = await Promise.allSettled(NPM_PKGS.map(fetchNpmPkg));
  return Object.fromEntries(
    NPM_PKGS.map((p, i) => [p, results[i].status === 'fulfilled' ? results[i].value : []])
  );
}

/* ── PyPI last-week snapshot ──────────────────────────────────────── */
const PYPI_PKGS = ['openai', 'anthropic', 'google-genai', 'mistralai', 'langchain', 'langchain-community', 'llama-index-core', 'vllm'];

async function fetchPypiPkg(pkg) {
  const url = `https://pypistats.org/api/packages/${pkg}/recent?period=week`;
  const res = await fetchT(url);
  if (!res.ok) return null;
  const json = await res.json();
  return json.data?.last_week ?? null;
}

async function fetchPypi() {
  const results = await Promise.allSettled(PYPI_PKGS.map(fetchPypiPkg));
  return Object.fromEntries(
    PYPI_PKGS.map((p, i) => [p, results[i].status === 'fulfilled' ? results[i].value : null])
  );
}

/* ── HuggingFace top models ───────────────────────────────────────── */
async function fetchHF() {
  const url = 'https://huggingface.co/api/models?sort=downloads&direction=-1&limit=30';
  const res = await fetchT(url);
  if (!res.ok) return [];
  const models = await res.json();
  return models.map(m => ({
    id: m.id,
    downloads: m.downloads || 0,
    pipeline_tag: m.pipeline_tag || 'other',
  }));
}

/* ── Backend API endpoints (proxied via Vite in dev, Express in prod) */
async function fetchJsonSafe(url, ms = 30000) {
  try {
    const res = await fetchT(url, ms);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// github-commits crawls many repos and can be slow on a cold start
const SLOW_KEYS = new Set(['github-commits', 'macro', 'commodities']);

// Backend datasets: [response field, /api path]. Each is fetched independently
// so a slow one never holds up the rest.
const BACKEND_SOURCES = [
  ['pypiHistory',     'pypi'],
  ['gpu',             'gpu'],
  ['github',          'github'],
  ['openrouter',      'openrouter'],
  ['eia',             'eia'],
  ['mops',            'mops'],
  ['githubCommits',   'github-commits'],
  ['docker',          'docker'],
  ['hn',              'hn'],
  ['openrouterRanks', 'openrouter-ranks'],
  ['dram',            'dram'],
  ['nand',            'nand'],
  ['tftLcd',          'tft-lcd'],
  ['aws',             'aws'],
  ['cpu',             'cpu'],
  ['tpu',             'tpu'],
  ['epochRevenue',    'epoch-revenue'],
  ['sentiment',       'sentiment'],
  ['mcp',             'mcp'],
  ['sec',             'sec'],
  ['hfServer',        'huggingface'],
  ['metricsHistory',  'metrics-history'],
  ['webTraffic',      'web-traffic'],
  ['customsDrones',   'customs-drones'],
  ['macro',           'macro'],
  ['commodities',     'commodities'],
];

// The shape fetchAll resolves to, with every field empty. Used to seed a fresh
// (uncached) progressive load so consumers get a stable object from the start.
function emptySnapshot() {
  const snap = { npm: {}, pypi: {}, hf: [] };
  for (const [field] of BACKEND_SOURCES) snap[field] = null;
  return snap;
}

/* ── Aggregate (progressive) ──────────────────────────────────────────
   Fires every source concurrently and invokes `onData(snapshot)` each time
   one resolves, so the UI can paint each chart as its data lands instead of
   waiting for the slowest source. Resolves to the final merged snapshot.
   `seed` (e.g. a cached snapshot) is used as the baseline so partial updates
   refine existing data rather than blanking it. */
export async function fetchAllProgressive(onData, seed = null) {
  const snapshot = { ...emptySnapshot(), ...(seed ?? {}) };

  const apply = (field, value) => {
    snapshot[field] = value;
    // Hand out a fresh object so React sees a new reference and re-renders.
    onData?.({ ...snapshot });
  };

  const jobs = [
    fetchNpm().then(v => apply('npm', v)).catch(() => {}),
    fetchPypi().then(v => apply('pypi', v)).catch(() => {}),
    fetchHF().then(v => apply('hf', v)).catch(() => {}),
    ...BACKEND_SOURCES.map(([field, path]) =>
      fetchJsonSafe(`/api/${path}`, SLOW_KEYS.has(path) ? 90000 : 30000)
        .then(v => { if (v != null) apply(field, v); })
        .catch(() => {})
    ),
  ];

  await Promise.allSettled(jobs);
  return snapshot;
}

/* ── Aggregate (await-all) ────────────────────────────────────────────
   Back-compat wrapper that resolves only once everything has settled. */
export async function fetchAll() {
  return fetchAllProgressive();
}
