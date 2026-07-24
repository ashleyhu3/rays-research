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

async function fetchBackendAll() {
  const keys = ['pypi', 'gpu', 'github', 'openrouter', 'eia', 'mops', 'github-commits', 'docker', 'hn', 'openrouter-ranks', 'dram', 'nand', 'tft-lcd', 'aws', 'cpu', 'tpu', 'epoch-revenue', 'sentiment', 'mcp', 'sec', 'huggingface', 'metrics-history', 'web-traffic', 'customs-drones', 'macro', 'commodities'];
  const results = await Promise.allSettled(keys.map(k => fetchJsonSafe(`/api/${k}`, SLOW_KEYS.has(k) ? 90000 : 30000)));
  return Object.fromEntries(keys.map((k, i) => [
    k, results[i].status === 'fulfilled' ? results[i].value : null,
  ]));
}

/* ── Aggregate ────────────────────────────────────────────────────── */
export async function fetchAll() {
  const [npm, pypi, hf, backend] = await Promise.allSettled([
    fetchNpm(),
    fetchPypi(),
    fetchHF(),
    fetchBackendAll(),
  ]);

  const ok = r => r.status === 'fulfilled' ? r.value : null;
  const be = ok(backend) ?? {};

  return {
    // Browser-direct fetches
    npm:         ok(npm)      ?? {},
    pypi:        ok(pypi)     ?? {},
    hf:          ok(hf)       ?? [],
    // Backend-provided (may be null if server not running)
    pypiHistory: be.pypi       ?? null,
    gpu:         be.gpu        ?? null,
    github:      be.github     ?? null,
    openrouter:  be.openrouter ?? null,
    eia:          be.eia              ?? null,
    mops:         be.mops             ?? null,
    githubCommits: be['github-commits'] ?? null,
    docker:        be.docker           ?? null,
    hn:            be.hn               ?? null,
    openrouterRanks:  be['openrouter-ranks']      ?? null,
    dram:             be.dram                     ?? null,
    nand:             be.nand                     ?? null,
    tftLcd:           be['tft-lcd']               ?? null,
    aws:              be.aws                      ?? null,
    cpu:              be.cpu                      ?? null,
    tpu:              be.tpu                      ?? null,
    epochRevenue:     be['epoch-revenue']         ?? null,
    sentiment:        be.sentiment                ?? null,
    mcp:              be.mcp                      ?? null,
    sec:              be.sec                      ?? null,
    hfServer:         be.huggingface              ?? null,
    metricsHistory:   be['metrics-history']       ?? null,
    webTraffic:       be['web-traffic']           ?? null,
    customsDrones:    be['customs-drones']        ?? null,
    macro:            be.macro                    ?? null,
    commodities:      be.commodities              ?? null,
  };
}
