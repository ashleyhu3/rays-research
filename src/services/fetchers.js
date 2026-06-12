function fetchT(url, ms = 12000) {
  const ac = new AbortController();
  const id = setTimeout(() => ac.abort(), ms);
  return fetch(url, { signal: ac.signal }).finally(() => clearTimeout(id));
}

/* ── npm weekly downloads (last 52 weeks) ─────────────────────────── */
const NPM_PKGS = [
  'openai',
  'anthropic',
  'google-generativeai',
  'mistralai',
  '@anthropic-ai/sdk',
  '@google/generative-ai',
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
const PYPI_PKGS = ['openai', 'anthropic', 'google-generativeai', 'mistralai', 'langchain', 'langchain-community', 'llama-index-core', 'vllm'];

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

/* ── Stack Overflow tag totals + last-week count ──────────────────── */
const SO_TAGS = ['openai-api', 'anthropic-claude', 'google-gemini-api', 'langchain', 'mistral-ai'];

async function fetchSoTotals() {
  const url = `https://api.stackexchange.com/2.3/tags/${SO_TAGS.join(';')}/info?site=stackoverflow`;
  const res = await fetchT(url);
  if (!res.ok) return {};
  const { items = [] } = await res.json();
  return Object.fromEntries(items.map(t => [t.name ?? t.tag_name, t.count]));
}

async function fetchSoWeekly(tag) {
  const now = Math.floor(Date.now() / 1000);
  const week = now - 7 * 86400;
  const url = `https://api.stackexchange.com/2.3/questions?tagged=${tag}&site=stackoverflow&fromdate=${week}&todate=${now}&pagesize=1`;
  const res = await fetchT(url);
  if (!res.ok) return null;
  const json = await res.json();
  return json.total ?? null;
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
const SLOW_KEYS = new Set(['github-commits']);

async function fetchBackendAll() {
  const keys = ['pypi', 'trends', 'reddit', 'jobs', 'gpu', 'github', 'openrouter', 'eia', 'mops', 'github-commits', 'docker', 'hn', 'wikipedia', 'openrouter-ranks', 'dram'];
  const results = await Promise.allSettled(keys.map(k => fetchJsonSafe(`/api/${k}`, SLOW_KEYS.has(k) ? 90000 : 30000)));
  return Object.fromEntries(keys.map((k, i) => [
    k, results[i].status === 'fulfilled' ? results[i].value : null,
  ]));
}

/* ── Aggregate ────────────────────────────────────────────────────── */
export async function fetchAll() {
  const [npm, pypi, soTotals, soWeekly, hf, backend] = await Promise.allSettled([
    fetchNpm(),
    fetchPypi(),
    fetchSoTotals(),
    fetchSoWeekly('anthropic-claude'),
    fetchHF(),
    fetchBackendAll(),
  ]);

  const ok = r => r.status === 'fulfilled' ? r.value : null;
  const be = ok(backend) ?? {};

  return {
    // Browser-direct fetches
    npm:         ok(npm)      ?? {},
    pypi:        ok(pypi)     ?? {},
    soTotals:    ok(soTotals) ?? {},
    soWeekly:    ok(soWeekly),
    hf:          ok(hf)       ?? [],
    // Backend-provided (may be null if server not running)
    pypiHistory: be.pypi       ?? null,
    trends:      be.trends     ?? null,
    reddit:      be.reddit     ?? null,
    jobs:        be.jobs       ?? null,
    gpu:         be.gpu        ?? null,
    github:      be.github     ?? null,
    openrouter:  be.openrouter ?? null,
    eia:          be.eia              ?? null,
    mops:         be.mops             ?? null,
    githubCommits: be['github-commits'] ?? null,
    docker:        be.docker           ?? null,
    hn:            be.hn               ?? null,
    wikipedia:        be.wikipedia               ?? null,
    openrouterRanks:  be['openrouter-ranks']      ?? null,
    dram:             be.dram                     ?? null,
  };
}
