import { Children, useEffect, useMemo, useState } from 'react';
import { Line, Bar } from 'react-chartjs-2';
import { C } from '../../config/colors';
import { useData } from '../../context/DataContext';
import { baseOpts, hBarOpts, mkDs, mkBar, fmtM, fmtK } from '../../utils/chartHelpers';
import { wkLabels } from '../../utils/labels';
import { trend } from '../../utils/dataGenerators';
import { companyPriceSeries, priceHistory } from '../../utils/modelPricing';
import { orProviderSeries } from '../../utils/openrouterProvider';
import { ExpandButton, ChartModal } from '../chart/ChartExpand';

const PALETTE = [C.openai, C.anthropic, C.google, C.mistral, C.teal, C.perplexity, C.orange, C.deepseek];

/* ── One-click CSV export of a chart's underlying series ───────────────────
   Reads {labels, datasets} straight off the rendered chart child, so every
   mini gets export for free — traders pull the raw numbers into Excel/Python. */
function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function chartToCSV(data) {
  if (!data?.labels || !data?.datasets) return null;
  const head = ['', ...data.datasets.map((d, i) => d.label ?? `series_${i + 1}`)].map(csvCell).join(',');
  const rows = data.labels.map((lab, i) =>
    [lab, ...data.datasets.map(d => d.data?.[i] ?? '')].map(csvCell).join(','));
  return [head, ...rows].join('\n');
}
function downloadCSV(title, data) {
  const csv = chartToCSV(data);
  if (!csv) return;
  const name = (title || 'chart').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: `${name}.csv` });
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

function CsvIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v12" /><polyline points="7 11 12 16 17 11" /><path d="M5 21h14" />
    </svg>
  );
}

function MiniCard({ title, children }) {
  const [expanded, setExpanded] = useState(false);
  const chartData = Children.toArray(children)[0]?.props?.data;
  return (
    <div className="chat-mini-card">
      <div className="chat-mini-card-head">
        <span className="chat-mini-card-title">{title}</span>
        <div className="chat-mini-card-actions">
          {chartData && (
            <button className="ch-expand-btn" title="Download CSV" onClick={() => downloadCSV(title, chartData)}>
              <CsvIcon />
            </button>
          )}
          <ExpandButton onClick={() => setExpanded(true)} />
        </div>
      </div>
      <div className="chat-mini-card-body">{children}</div>
      {expanded && (
        <ChartModal title={title} onClose={() => setExpanded(false)}>
          <div className="ch-modal-chart">{children}</div>
        </ChartModal>
      )}
    </div>
  );
}

// Dense line dataset (no point markers — for daily series with 100+ points)
const mkLine = (label, color, data) => ({ ...mkDs(label, color, data), pointRadius: 0, pointHoverRadius: 4 });

/* ── Daily-snapshot time series from /api/metrics-history ──────────────────
   The snapshot store records one value per metric per day. Sources without
   any other history (job counts, stars, filing counts…) chart as lines once
   ≥3 days have accrued; until then the minis fall back to a snapshot bar. */
function mhSeries(mh, source, picks, minDays = 3) {
  const src = mh?.[source];
  if (!src) return null;
  const dateSet = new Set();
  for (const { metric } of picks) {
    for (const d of Object.keys(src[metric] ?? {})) dateSet.add(d);
  }
  const dates = [...dateSet].sort();
  if (dates.length < minDays) return null;
  return {
    labels: dates.map(d => d.slice(5)),
    datasets: picks
      .filter(({ metric }) => src[metric])
      .map(({ metric, label, color }) => mkDs(label, color, dates.map(d => src[metric][d] ?? null))),
  };
}

/* Line chart over weekly arrays already held in cache (oldest → newest) */
function weeklyLineData(entries, n = 12) {
  const series = entries.filter(([, weeks]) => Array.isArray(weeks) && weeks.length >= 2);
  if (series.length === 0) return null;
  const len = Math.min(n, Math.max(...series.map(([, w]) => w.length)));
  return {
    labels: wkLabels(len),
    datasets: series.map(([label, weeks], i) =>
      mkDs(label, PALETTE[i % PALETTE.length], weeks.slice(-len))),
  };
}

// ── PyPI Downloads ─────────────────────────────────────────────────────────
export function PyPIMini() {
  const { liveData } = useData();
  const W  = 12;
  const wk = useMemo(() => wkLabels(W), []);

  const data = useMemo(() => {
    const hist = liveData?.pypiHistory;
    const snap = liveData?.pypi;

    const sl = (pkg, fb) => {
      const h = hist?.[pkg];
      if (h?.length >= W) return h.slice(-W);
      const v = snap?.[pkg];
      return v ? trend(v * 0.85, v, W) : trend(fb * 0.85, fb, W);
    };

    return {
      labels: wk,
      datasets: [
        mkDs('openai',              C.openai,    sl('openai',              42e6)),
        mkDs('anthropic',           C.anthropic, sl('anthropic',           16e6)),
        mkDs('google-genai', C.google,    sl('google-genai', 18e6)),
        mkDs('mistralai',           C.mistral,   sl('mistralai',            5e6)),
      ],
    };
  }, [liveData, wk]);

  return (
    <MiniCard title="PyPI Downloads (12 weeks)">
      <Line data={data} options={baseOpts(fmtM)} />
    </MiniCard>
  );
}

// ── GitHub Stars ───────────────────────────────────────────────────────────
export function GitHubMini() {
  const { liveData } = useData();

  const ts = useMemo(() => {
    const gh = liveData?.github;
    if (!gh) return null;
    const picks = Object.keys(gh).map((repo, i) => ({
      metric: `${repo}.stars`,
      label:  repo.split('/')[0],
      color:  PALETTE[i % PALETTE.length],
    }));
    return mhSeries(liveData?.metricsHistory, 'github', picks);
  }, [liveData]);

  const barData = useMemo(() => {
    const gh = liveData?.github;
    const entries = gh
      ? Object.entries(gh)
          .map(([repo, v]) => {
            const org   = repo.split('/')[0].toLowerCase();
            const color = org.includes('openai')    ? C.openai
                        : org.includes('anthropic') ? C.anthropic
                        : org.includes('google')    ? C.google
                        : C.mistral;
            return { label: repo.split('/')[0], value: v?.stars ?? 0, color };
          })
          .sort((a, b) => b.value - a.value)
      : [
          { label: 'openai',    value: 30000, color: C.openai    },
          { label: 'google',    value: 9000,  color: C.google    },
          { label: 'anthropic', value: 3000,  color: C.anthropic },
          { label: 'mistral',   value: 1200,  color: C.mistral   },
        ];

    return {
      labels: entries.map(e => e.label),
      datasets: [{
        label:           'Stars',
        data:            entries.map(e => e.value),
        backgroundColor: entries.map(e => e.color + 'bf'),
        borderColor:     entries.map(e => e.color),
        borderWidth: 1, borderRadius: 4,
      }],
    };
  }, [liveData]);

  if (ts) {
    return (
      <MiniCard title="GitHub Stars Over Time">
        <Line data={ts} options={baseOpts(fmtK)} />
      </MiniCard>
    );
  }
  return (
    <MiniCard title="GitHub Stars (trend accrues daily)">
      <Bar data={barData} options={hBarOpts(fmtK)} />
    </MiniCard>
  );
}

// ── GPU Spot Prices ────────────────────────────────────────────────────────
export function GPUMini() {
  const { liveData } = useData();

  // 3-year daily backfill lives in gpu.history — always chart as time series
  const ts = useMemo(() => {
    const h = liveData?.gpu?.history;
    if (!h?.dates?.length || !h?.series) return null;
    const N = 180; // last ~6 months keeps the mini readable
    const labels = h.dates.slice(-N).map(d => d.slice(5));
    const gpus = Object.entries(h.series)
      .map(([k, s]) => ({ k, s, latest: [...s].reverse().find(v => v != null) ?? 0 }))
      .sort((a, b) => b.latest - a.latest)
      .slice(0, 5);
    if (gpus.length === 0) return null;
    return {
      labels,
      datasets: gpus.map(({ k, s }, i) =>
        mkLine(k.replace(/_/g, ' '), PALETTE[i % PALETTE.length], s.slice(-N))),
    };
  }, [liveData]);

  const barData = useMemo(() => {
    const g = liveData?.gpu?.prices ?? liveData?.gpu;
    const entries = g && !g.history
      ? Object.entries(g).filter(([, v]) => typeof v === 'number')
          .map(([k, v]) => ({ label: k.replace(/_/g, ' '), value: v })).sort((a, b) => b.value - a.value)
      : Object.entries(liveData?.gpu?.prices ?? {})
          .map(([k, v]) => ({ label: k.replace(/_/g, ' '), value: v })).sort((a, b) => b.value - a.value);
    return {
      labels: entries.map(e => e.label),
      datasets: [{
        label:           '$/hr',
        data:            entries.map(e => e.value),
        backgroundColor: entries.map((_, i) => PALETTE[i % PALETTE.length] + 'bf'),
        borderColor:     entries.map((_, i) => PALETTE[i % PALETTE.length]),
        borderWidth: 1, borderRadius: 4,
      }],
    };
  }, [liveData]);

  if (ts) {
    return (
      <MiniCard title="GPU Spot Prices — $/hr (6 months, vast.ai)">
        <Line data={ts} options={baseOpts(v => `$${Number(v).toFixed(2)}`)} />
      </MiniCard>
    );
  }
  if (barData.labels.length === 0) return null;
  return (
    <MiniCard title="GPU Spot Prices (vast.ai, $/hr)">
      <Bar data={barData} options={hBarOpts(v => `$${v.toFixed(2)}`)} />
    </MiniCard>
  );
}

// ── DRAM Spot Prices ───────────────────────────────────────────────────────
export function DramMini() {
  const { liveData } = useData();

  const data = useMemo(() => {
    const dram = liveData?.dram;
    // Preferred: TrendForce monthly index (multi-year)
    if (dram?.index?.values?.length >= 2) {
      const N = 24;
      return {
        kind:   'line',
        title:  `${dram.index.name ?? 'DRAM Spot Index'} (monthly)`,
        labels: dram.index.dates.slice(-N),
        datasets: [mkLine('Index $', C.anthropic, dram.index.values.slice(-N))],
      };
    }
    // Else: per-model daily session history
    const h = dram?.history;
    if (h?.dates?.length >= 2 && h?.series) {
      const N = 90;
      const models = Object.entries(h.series).slice(0, 5);
      return {
        kind:   'line',
        title:  'DRAM Spot Prices (daily sessions)',
        labels: h.dates.slice(-N).map(d => d.slice(5)),
        datasets: models.map(([m, s], i) => mkLine(m, PALETTE[i % PALETTE.length], s.slice(-N))),
      };
    }
    return null;
  }, [liveData]);

  if (!data) return null;
  return (
    <MiniCard title={data.title}>
      <Line data={{ labels: data.labels, datasets: data.datasets }} options={baseOpts(v => `$${Number(v).toFixed(2)}`)} />
    </MiniCard>
  );
}

function TrendforceProductMini({ dataKey, title, digits = 2 }) {
  const { liveData } = useData();

  const data = useMemo(() => {
    const h = liveData?.[dataKey]?.history;
    if (!h?.dates?.length || !h?.series) return null;
    const N = 90;
    const products = Object.entries(h.series)
      .map(([k, s]) => ({ k, s, latest: [...s].reverse().find(v => v != null) ?? 0 }))
      .filter(p => p.s.some(v => v != null))
      .sort((a, b) => b.latest - a.latest)
      .slice(0, 6);
    if (products.length === 0) return null;
    return {
      labels: h.dates.slice(-N).map(d => d.slice(5)),
      datasets: products.map(({ k, s }, i) => mkLine(k, PALETTE[i % PALETTE.length], s.slice(-N))),
    };
  }, [liveData, dataKey]);

  if (!data) return null;
  return (
    <MiniCard title={title}>
      <Line data={data} options={baseOpts(v => `$${Number(v).toFixed(digits)}`)} />
    </MiniCard>
  );
}

export function NandMini() {
  return <TrendforceProductMini dataKey="nand" title="NAND Spot Prices — TrendForce" digits={2} />;
}

export function TftLcdMini() {
  return <TrendforceProductMini dataKey="tftLcd" title="TFT-LCD Panel Prices — TrendForce" digits={1} />;
}

// ── OpenRouter Usage Rankings ──────────────────────────────────────────────
export function OpenRouterRanksMini() {
  const { liveData } = useData();

  const data = useMemo(() => {
    const or = liveData?.openrouterRanks;
    if (!or?.weeklyTotals?.length || or.weeklyTotals.length < 2) return null;
    const N = 26;
    const labels = (or.weekLabels ?? []).length === or.weeklyTotals.length
      ? or.weekLabels.slice(-N).map(d => String(d).slice(5))
      : wkLabels(Math.min(N, or.weeklyTotals.length));
    return {
      labels,
      datasets: [mkDs('Tokens/week', C.perplexity, or.weeklyTotals.slice(-N))],
    };
  }, [liveData]);

  if (!data) return null;
  return (
    <MiniCard title="OpenRouter Platform Tokens per Week">
      <Line data={data} options={baseOpts(fmtM)} />
    </MiniCard>
  );
}

// ── OpenRouter Pricing (point-in-time catalog — no history exists) ─────────
const PRICE_PROVIDERS = ['openai', 'anthropic', 'google', 'deepseek', 'x-ai', 'meta-llama', 'mistralai', 'qwen'];

export function OpenRouterPricingMini() {
  const { liveData } = useData();

  const data = useMemo(() => {
    const models = liveData?.openrouter?.models;
    if (!models?.length) return null;
    const flagship = {};
    for (const m of models) {
      const provider = m.id.split('/')[0];
      if (!PRICE_PROVIDERS.includes(provider)) continue;
      const price = Number(m.pricing?.prompt);
      if (!Number.isFinite(price) || price <= 0) continue;
      if (!flagship[provider] || price > flagship[provider]) flagship[provider] = price;
    }
    const entries = Object.entries(flagship).sort(([, a], [, b]) => b - a);
    if (entries.length === 0) return null;
    return {
      labels: entries.map(([p]) => p),
      datasets: [{
        label:           'Input $/1M tokens (flagship)',
        data:            entries.map(([, v]) => v),
        backgroundColor: entries.map((_, i) => PALETTE[i % PALETTE.length] + 'bf'),
        borderColor:     entries.map((_, i) => PALETTE[i % PALETTE.length]),
        borderWidth: 1, borderRadius: 4,
      }],
    };
  }, [liveData]);

  if (!data) return null;
  return (
    <MiniCard title="Flagship Model Input Price ($/1M tokens, current)">
      <Bar data={data} options={hBarOpts(v => `$${v}`)} />
    </MiniCard>
  );
}

// ── Electricity Rates ──────────────────────────────────────────────────────
const ELEC_STATES = ['US', 'CA', 'TX', 'VA', 'NY'];

export function ElectricityMini() {
  const { liveData } = useData();

  const data = useMemo(() => {
    const rates = liveData?.eia?.rates;
    if (!rates) return null;
    const yearSet = new Set();
    for (const s of ELEC_STATES) for (const y of Object.keys(rates[s] ?? {})) yearSet.add(y);
    const years = [...yearSet].sort();
    if (years.length >= 2) {
      return {
        kind:   'line',
        labels: years,
        datasets: ELEC_STATES
          .filter(s => rates[s])
          .map((s, i) => mkDs(s, PALETTE[i % PALETTE.length], years.map(y => rates[s][y] ?? null))),
      };
    }
    // Single year of data → cheapest/most expensive snapshot
    const stateRates = Object.entries(rates)
      .filter(([k]) => k !== 'US')
      .map(([state, ys]) => {
        const [, rate] = Object.entries(ys).sort(([a], [b]) => b.localeCompare(a))[0] ?? [];
        return { state, rate: rate ?? 0 };
      })
      .filter(e => e.rate > 0)
      .sort((a, b) => a.rate - b.rate);
    const entries = [...stateRates.slice(0, 5), ...stateRates.slice(-5).reverse()];
    return {
      kind:   'bar',
      labels: entries.map(e => e.state),
      datasets: [{
        label:           '¢/kWh',
        data:            entries.map(e => e.rate),
        backgroundColor: entries.map((_, i) => (i < 5 ? C.openai : C.anthropic) + 'bf'),
        borderColor:     entries.map((_, i) => i < 5 ? C.openai : C.anthropic),
        borderWidth: 1, borderRadius: 4,
      }],
    };
  }, [liveData]);

  if (!data) return null;
  if (data.kind === 'line') {
    return (
      <MiniCard title="Electricity Rates by Year (¢/kWh)">
        <Line data={{ labels: data.labels, datasets: data.datasets }} options={baseOpts(v => `${v}¢`)} />
      </MiniCard>
    );
  }
  return (
    <MiniCard title="Electricity Rates — 5 Cheapest / 5 Most Expensive (¢/kWh)">
      <Bar data={{ labels: data.labels, datasets: data.datasets }} options={hBarOpts(v => `${v}¢`)} />
    </MiniCard>
  );
}

// ── Taiwan Supply Chain ────────────────────────────────────────────────────
export function MopsMini() {
  const { liveData } = useData();

  const data = useMemo(() => {
    const companies = Object.values(liveData?.mops?.companies ?? {});
    const top = companies
      .filter(c => c.monthly?.length >= 2)
      .sort((a, b) => (b.monthly.at(-1)?.revenue ?? 0) - (a.monthly.at(-1)?.revenue ?? 0))
      .slice(0, 5);
    if (top.length === 0) return null;
    const periodSet = new Set();
    for (const c of top) for (const m of c.monthly) periodSet.add(m.period);
    const periods = [...periodSet].sort().slice(-24);
    return {
      labels: periods,
      datasets: top.map((c, i) => {
        const byPeriod = Object.fromEntries(c.monthly.map(m => [m.period, m.revenue]));
        return mkLine(c.ticker, PALETTE[i % PALETTE.length], periods.map(p => byPeriod[p] ?? null));
      }),
    };
  }, [liveData]);

  if (!data) return null;
  return (
    <MiniCard title="Taiwan Supply Chain — Monthly Revenue (NT$M, top 5)">
      <Line data={data} options={baseOpts(fmtM)} />
    </MiniCard>
  );
}

// ── GitHub Commit Velocity ─────────────────────────────────────────────────
export function GitHubCommitsMini() {
  const { liveData } = useData();

  const data = useMemo(() => {
    const commits = Object.entries(liveData?.githubCommits?.commits ?? {})
      .filter(([, weeks]) => Array.isArray(weeks) && weeks.length >= 2)
      .sort(([, a], [, b]) => b.slice(-4).reduce((x, y) => x + y, 0) - a.slice(-4).reduce((x, y) => x + y, 0))
      .slice(0, 5)
      .map(([repo, weeks]) => [repo.split('/')[1] ?? repo, weeks]);
    return weeklyLineData(commits);
  }, [liveData]);

  if (!data) return null;
  return (
    <MiniCard title="GitHub Commits per Week (top repos, 12 weeks)">
      <Line data={data} options={baseOpts(v => String(v))} />
    </MiniCard>
  );
}

// ── Docker Hub Pulls ───────────────────────────────────────────────────────
export function DockerMini() {
  const { liveData } = useData();

  const ts = useMemo(() => {
    const images = liveData?.docker?.images;
    if (!images) return null;
    const picks = Object.keys(images).map((img, i) => ({
      metric: `${img}.pulls`, label: img, color: PALETTE[i % PALETTE.length],
    }));
    return mhSeries(liveData?.metricsHistory, 'docker', picks);
  }, [liveData]);

  const barData = useMemo(() => {
    const entries = Object.entries(liveData?.docker?.images ?? {})
      .map(([label, v]) => ({ label, value: v.pulls ?? 0 }))
      .filter(e => e.value > 0)
      .sort((a, b) => b.value - a.value);
    if (entries.length === 0) return null;
    return {
      labels:   entries.map(e => e.label),
      datasets: [{ label: 'Total Pulls', data: entries.map(e => e.value), backgroundColor: entries.map((_, i) => PALETTE[i % PALETTE.length] + 'bf'), borderColor: entries.map((_, i) => PALETTE[i % PALETTE.length]), borderWidth: 1, borderRadius: 4 }],
    };
  }, [liveData]);

  if (ts) {
    return (
      <MiniCard title="Docker Hub Pulls Over Time (cumulative)">
        <Line data={ts} options={baseOpts(fmtM)} />
      </MiniCard>
    );
  }
  if (!barData) return null;
  return (
    <MiniCard title="Docker Hub AI Image Pulls (trend accrues daily)">
      <Bar data={barData} options={hBarOpts(fmtM)} />
    </MiniCard>
  );
}

// ── Hacker News story volume ───────────────────────────────────────────────
export function CommunityMini() {
  const { liveData } = useData();

  const data = useMemo(() => {
    const weekly = liveData?.hn?.weekly;
    if (!Array.isArray(weekly) || weekly.length < 2) return null;
    const N = Math.min(12, weekly.length);
    return {
      labels:   wkLabels(N),
      datasets: [mkDs('AI stories/week', C.openai, weekly.slice(-N))],
    };
  }, [liveData]);

  if (!data) return null;
  return (
    <MiniCard title="Hacker News AI Stories per Week">
      <Line data={data} options={baseOpts(v => String(v))} />
    </MiniCard>
  );
}

// ── HuggingFace family downloads ───────────────────────────────────────────
export function HuggingFaceMini() {
  const { liveData } = useData();

  const ts = useMemo(() => {
    const fams = Object.keys(liveData?.hfServer?.families ?? {});
    if (fams.length === 0) return null;
    return mhSeries(liveData?.metricsHistory, 'huggingface',
      fams.map((f, i) => ({ metric: `${f}.downloads`, label: f, color: PALETTE[i % PALETTE.length] })));
  }, [liveData]);

  const barData = useMemo(() => {
    const entries = Object.entries(liveData?.hfServer?.families ?? {})
      .filter(([, v]) => v?.downloads)
      .sort(([, a], [, b]) => b.downloads - a.downloads);
    if (entries.length === 0) return null;
    return {
      labels:   entries.map(([f]) => f),
      datasets: [{ label: 'Downloads', data: entries.map(([, v]) => v.downloads), backgroundColor: entries.map((_, i) => PALETTE[i % PALETTE.length] + 'bf'), borderColor: entries.map((_, i) => PALETTE[i % PALETTE.length]), borderWidth: 1, borderRadius: 4 }],
    };
  }, [liveData]);

  if (ts) {
    return (
      <MiniCard title="HuggingFace Downloads by Family Over Time">
        <Line data={ts} options={baseOpts(fmtM)} />
      </MiniCard>
    );
  }
  if (!barData) return null;
  return (
    <MiniCard title="HuggingFace Downloads by Model Family (trend accrues daily)">
      <Bar data={barData} options={hBarOpts(fmtM)} />
    </MiniCard>
  );
}

// ── MCP ecosystem growth ───────────────────────────────────────────────────
export function McpMini() {
  const { liveData } = useData();

  const ts = useMemo(() => {
    const queries = Object.keys(liveData?.mcp?.queries ?? {});
    if (queries.length === 0) return null;
    return mhSeries(liveData?.metricsHistory, 'mcp',
      queries.map((q, i) => ({ metric: `${q}.total`, label: q, color: PALETTE[i % PALETTE.length] })));
  }, [liveData]);

  const barData = useMemo(() => {
    const entries = Object.entries(liveData?.mcp?.queries ?? {})
      .map(([q, v]) => ({ label: q, value: v?.total ?? 0 }))
      .filter(e => e.value > 0)
      .sort((a, b) => b.value - a.value);
    if (entries.length === 0) return null;
    return {
      labels:   entries.map(e => e.label),
      datasets: [{ label: 'GitHub repos', data: entries.map(e => e.value), backgroundColor: entries.map((_, i) => PALETTE[i % PALETTE.length] + 'bf'), borderColor: entries.map((_, i) => PALETTE[i % PALETTE.length]), borderWidth: 1, borderRadius: 4 }],
    };
  }, [liveData]);

  if (ts) {
    return (
      <MiniCard title="MCP Repos on GitHub Over Time">
        <Line data={ts} options={baseOpts(fmtK)} />
      </MiniCard>
    );
  }
  if (!barData) return null;
  return (
    <MiniCard title="MCP Ecosystem — GitHub Repos (trend accrues daily)">
      <Bar data={barData} options={hBarOpts(fmtK)} />
    </MiniCard>
  );
}

// ── SEC filing mentions ────────────────────────────────────────────────────
export function SecMini() {
  const { liveData } = useData();

  const ts = useMemo(() => {
    const terms = Object.keys(liveData?.sec?.terms ?? {});
    if (terms.length === 0) return null;
    return mhSeries(liveData?.metricsHistory, 'sec',
      terms.map((t, i) => ({ metric: `${t}.filings90d`, label: t, color: PALETTE[i % PALETTE.length] })));
  }, [liveData]);

  // Fallback still shows change over time: prior 90d vs last 90d per term
  const barData = useMemo(() => {
    const entries = Object.entries(liveData?.sec?.terms ?? {}).filter(([, v]) => v);
    if (entries.length === 0) return null;
    return {
      labels: entries.map(([t]) => t),
      datasets: [
        mkBar('Prior 90d', C.slate,  entries.map(([, v]) => v.prior90d ?? 0)),
        mkBar('Last 90d',  C.openai, entries.map(([, v]) => v.last90d ?? 0)),
      ],
    };
  }, [liveData]);

  if (ts) {
    return (
      <MiniCard title="SEC Filings Mentioning AI Terms Over Time (rolling 90d)">
        <Line data={ts} options={baseOpts(fmtK)} />
      </MiniCard>
    );
  }
  if (!barData) return null;
  return (
    <MiniCard title="SEC Filings — Prior 90d vs Last 90d">
      <Bar data={barData} options={baseOpts(fmtK)} />
    </MiniCard>
  );
}

// ── Options flow (per-ticker chain — fetched on demand) ────────────────────
export function OptionsMini({ ticker = 'NVDA' }) {
  const [chain, setChain] = useState(null);

  useEffect(() => {
    const ac = new AbortController();
    fetch(`/api/options/${ticker}`, { signal: ac.signal })
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (d?.calls) setChain(d); })
      .catch(() => {});
    return () => ac.abort();
  }, [ticker]);

  const data = useMemo(() => {
    if (!chain) return null;
    const spot = chain.price ?? 0;
    const inWindow = c => c.strike != null && (!spot || (c.strike >= spot * 0.75 && c.strike <= spot * 1.25));
    const callOI = new Map(chain.calls.filter(inWindow).map(c => [c.strike, c.openInterest ?? 0]));
    const putOI  = new Map(chain.puts.filter(inWindow).map(c => [c.strike, c.openInterest ?? 0]));
    const strikes = [...new Set([...callOI.keys(), ...putOI.keys()])].sort((a, b) => a - b);
    if (strikes.length === 0) return null;
    return {
      labels: strikes.map(s => `$${s}`),
      datasets: [
        mkBar('Calls OI', C.openai,    strikes.map(s => callOI.get(s) ?? 0)),
        mkBar('Puts OI',  C.anthropic, strikes.map(s => putOI.get(s) ?? 0)),
      ],
    };
  }, [chain]);

  if (!data) return null;
  return (
    <MiniCard title={`${chain.ticker} Open Interest by Strike (exp ${chain.selectedDate ?? 'nearest'}, spot $${chain.price ?? '—'})`}>
      <Bar data={data} options={baseOpts(fmtK)} />
    </MiniCard>
  );
}

// ── AWS accelerator spot prices ────────────────────────────────────────────
export function AwsSpotMini() {
  const { liveData } = useData();

  const ts = useMemo(() => {
    const h = liveData?.aws?.history;
    if (!h?.dates?.length || !h?.spotSeries) return null;
    const N = 90;
    const labels = h.dates.slice(-N).map(d => d.slice(5));
    const accels = Object.entries(h.spotSeries)
      .map(([k, s]) => ({ k, s, latest: [...s].reverse().find(v => v != null) ?? 0 }))
      .filter(a => a.s.some(v => v != null))
      .sort((a, b) => b.latest - a.latest);
    if (accels.length === 0) return null;
    return {
      labels,
      datasets: accels.map(({ k, s }, i) => mkLine(k, PALETTE[i % PALETTE.length], s.slice(-N))),
    };
  }, [liveData]);

  const barData = useMemo(() => {
    const entries = Object.entries(liveData?.aws?.current ?? {})
      .map(([k, v]) => ({ label: k, value: v?.spot ?? 0 }))
      .filter(e => e.value > 0)
      .sort((a, b) => b.value - a.value);
    if (entries.length === 0) return null;
    return {
      labels:   entries.map(e => e.label),
      datasets: [{ label: '$/accelerator-hr', data: entries.map(e => e.value), backgroundColor: entries.map((_, i) => PALETTE[i % PALETTE.length] + 'bf'), borderColor: entries.map((_, i) => PALETTE[i % PALETTE.length]), borderWidth: 1, borderRadius: 4 }],
    };
  }, [liveData]);

  if (ts) {
    return (
      <MiniCard title="AWS Spot Price per Accelerator — $/hr (90 days)">
        <Line data={ts} options={baseOpts(v => `$${Number(v).toFixed(2)}`)} />
      </MiniCard>
    );
  }
  if (!barData) return null;
  return (
    <MiniCard title="AWS Spot Price per Accelerator ($/hr)">
      <Bar data={barData} options={hBarOpts(v => `$${v.toFixed(2)}`)} />
    </MiniCard>
  );
}

// ── Cloud GPU list prices ──────────────────────────────────────────────────
export function CloudGpuMini() {
  const { liveData } = useData();

  const ts = useMemo(() => {
    const cg = liveData?.cloudGpu;
    if (!cg?.dates?.length || !cg?.series) return null;
    const N = 90;
    const labels = cg.dates.slice(-N).map(d => d.slice(5));
    const buckets = Object.entries(cg.series)
      .map(([k, s]) => ({ k, s, latest: [...s].reverse().find(v => v != null) ?? 0 }))
      .filter(b => b.s.some(v => v != null))
      .sort((a, b) => b.latest - a.latest);
    if (buckets.length === 0) return null;
    return {
      labels,
      datasets: buckets.map(({ k, s }, i) => mkLine(k, PALETTE[i % PALETTE.length], s.slice(-N))),
    };
  }, [liveData]);

  const barData = useMemo(() => {
    const entries = Object.entries(liveData?.cloudGpu?.current ?? {})
      .map(([k, v]) => ({ label: k, value: v ?? 0 }))
      .filter(e => e.value > 0)
      .sort((a, b) => b.value - a.value);
    if (entries.length === 0) return null;
    return {
      labels:   entries.map(e => e.label),
      datasets: [{ label: '$/GPU-hr', data: entries.map(e => e.value), backgroundColor: entries.map((_, i) => PALETTE[i % PALETTE.length] + 'bf'), borderColor: entries.map((_, i) => PALETTE[i % PALETTE.length]), borderWidth: 1, borderRadius: 4 }],
    };
  }, [liveData]);

  if (ts) {
    return (
      <MiniCard title="Cloud GPU List Price — $/GPU-hr (90 days)">
        <Line data={ts} options={baseOpts(v => `$${Number(v).toFixed(2)}`)} />
      </MiniCard>
    );
  }
  if (!barData) return null;
  return (
    <MiniCard title="Cloud GPU List Price ($/GPU-hr)">
      <Bar data={barData} options={hBarOpts(v => `$${v.toFixed(2)}`)} />
    </MiniCard>
  );
}

// ── Registry: chart ID (from the RAG's SECTION_TO_CHART) → mini components ─
/* ── Company-specific charts (mirror the company dashboard pages) ──────────
   These render the SAME real data as the per-company pages (same utils), so the
   Ask rail shows what's actually on the site rather than an aggregate mini. */
const COMPANIES = {
  oa:  { provider: 'OpenAI',    orName: 'OpenAI',    color: C.openai },
  an:  { provider: 'Anthropic', orName: 'Anthropic', color: C.anthropic },
  goo: { provider: 'Google',    orName: 'Google',    color: C.google },
  zh:  { provider: 'Zhipu',     orName: 'Zhipu AI',  color: C.zhipu },
  mm:  { provider: 'MiniMax',   orName: 'MiniMax',   color: C.minimax },
};

function CompanyPricingMini({ code }) {
  const { liveData } = useData();
  const co = COMPANIES[code];
  const data = useMemo(() => {
    const hist   = priceHistory(liveData);
    const series = companyPriceSeries(co.provider);
    const present = series
      .map(s => ({ ...s, points: hist[s.metric] ?? null }))
      .filter(s => s.points && Object.keys(s.points).length > 0);
    if (!present.length) return null;
    const dates = [...new Set(present.flatMap(s => Object.keys(s.points)))].sort();
    if (dates.length >= 2) {
      return { kind: 'line', labels: dates.map(d => d.slice(5)),
        datasets: present.map(s => mkLine(s.label, s.color, dates.map(d => s.points[d] ?? null))) };
    }
    return { kind: 'bar', labels: present.map(s => s.label),
      datasets: [{ data: present.map(s => s.points[dates[0]]),
        backgroundColor: present.map(s => s.color + 'bf'), borderColor: present.map(s => s.color),
        borderWidth: 1, borderRadius: 4 }] };
  }, [liveData, code]);

  if (!data) return null;
  return (
    <MiniCard title={`${co.provider} — Input $/1M tokens`}>
      {data.kind === 'line'
        ? <Line data={data} options={baseOpts(v => `$${v.toFixed(2)}`)} />
        : <Bar  data={data} options={hBarOpts(v => `$${v.toFixed(2)}`)} />}
    </MiniCard>
  );
}

function CompanyShareMini({ code }) {
  const { liveData } = useData();
  const co = COMPANIES[code];
  const data = useMemo(() => {
    const orp = orProviderSeries(liveData?.openrouterRanks, co.orName, 26);
    if (!orp || !(orp.share?.length >= 2)) return null;
    return { labels: orp.labels, datasets: [mkLine('Share of tokens %', co.color, orp.share)] };
  }, [liveData, code]);

  if (!data) return null;
  return (
    <MiniCard title={`${co.provider} — OpenRouter Token Share %`}>
      <Line data={data} options={baseOpts(v => `${v.toFixed(1)}%`)} />
    </MiniCard>
  );
}

const companyPricing = code => () => <CompanyPricingMini code={code} />;
const companyShare   = code => () => <CompanyShareMini   code={code} />;

export const CHART_REGISTRY = {
  // Company-specific (mirrored from the company pages)
  'oa-pricing':  [companyPricing('oa')],
  'an-pricing':  [companyPricing('an')],
  'goo-pricing': [companyPricing('goo')],
  'zh-pricing':  [companyPricing('zh')],
  'mm-pricing':  [companyPricing('mm')],
  'oa-or-share':  [companyShare('oa')],
  'an-or-share':  [companyShare('an')],
  'goo-or-share': [companyShare('goo')],
  'zh-or-share':  [companyShare('zh')],
  'mm-or-share':  [companyShare('mm')],

  pypi:                  [PyPIMini],
  github:                [GitHubMini],
  gpu:                   [GPUMini],
  dram:                  [DramMini],
  nand:                  [NandMini],
  tftLcd:                [TftLcdMini],
  'aws-spot':            [AwsSpotMini],
  'cloud-gpu':           [CloudGpuMini],
  openrouter:            [OpenRouterPricingMini],
  'openrouter-rankings': [OpenRouterRanksMini],
  electricity:           [ElectricityMini],
  'ai-supply':           [MopsMini],
  'github-commits':      [GitHubCommitsMini],
  docker:                [DockerMini],
  community:             [CommunityMini],
  hf:                    [HuggingFaceMini],
  mcp:                   [McpMini],
  sec:                   [SecMini],
  options:               [OptionsMini],
};
