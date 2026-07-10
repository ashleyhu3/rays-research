import { useMemo } from 'react';
import { Line, Bar, Scatter } from 'react-chartjs-2';
import { C, fa } from '../../config/colors';
import { trend } from '../../utils/dataGenerators';
import { wkLabels } from '../../utils/labels';
import { baseOpts, hBarOpts, mkDs, fmtM, fmtK, GRID, TICK, BORD } from '../../utils/chartHelpers';
import { metricTrendCard } from '../../components/chart/MetricTrendCard';
import ChartCard from '../../components/chart/ChartCard';
import EditableGrid from '../../components/chart/EditableGrid';
import { useData } from '../../context/DataContext';

const REVENUE_PALETTE = {
  OpenAI:      C.openai,
  Anthropic:   C.anthropic,
  Google:      C.google,
  xAI:         C.kimi,
  'Mistral AI': C.mistral,
  DeepSeek:    C.deepseek,
  Meta:        C.minimax,
};

const revenueOpts = {
  responsive: true,
  maintainAspectRatio: false,
  animation: false,
  plugins: {
    legend: { display: false },
    tooltip: {
      callbacks: {
        label: ctx => {
          const date = new Date(ctx.raw.x).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
          return `${ctx.dataset.label}: $${ctx.raw.y.toFixed(1)}B (${date})`;
        },
      },
    },
  },
  scales: {
    x: {
      type: 'linear',
      ticks: { ...TICK, maxTicksLimit: 6, callback: v => new Date(v).toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' }) },
      grid: GRID,
      border: BORD,
    },
    y: {
      grid: GRID,
      ticks: { ...TICK, callback: v => `$${v}B` },
      border: BORD,
      beginAtZero: true,
    },
  },
};

function buildRevenueScatter(epoch, W) {
  if (!epoch?.series) return null;
  const companies = epoch.companies ?? Object.keys(epoch.series);
  const cutoff = Date.now() - W * 7 * 86400000;
  const datasets = companies.map(co => {
    const pts = (epoch.series[co] ?? []).filter(p => new Date(p.date + 'T00:00:00Z').getTime() >= cutoff);
    if (pts.length === 0) return null;
    const color = REVENUE_PALETTE[co] ?? C.slate;
    return {
      label: co,
      data: pts.map(p => ({ x: new Date(p.date + 'T00:00:00Z').getTime(), y: p.value })),
      borderColor: color,
      backgroundColor: color,
      pointBackgroundColor: color,
      showLine: true,
      borderWidth: 2,
      pointRadius: 5,
      pointHoverRadius: 7,
      tension: 0,
    };
  }).filter(Boolean);
  return datasets.length > 0 ? { datasets } : null;
}

// China market overview
const MKT_LABELS = ['iFlytek', 'Zhipu AI', 'Alibaba', 'SenseTime', 'Baidu', 'MiniMax', 'Others'];
const MKT_DATA   = [9.4, 6.6, 6.4, 6.1, 4.7, 3.8, 63.0];
const MKT_COLORS = [C.openai, C.zhipu, C.deepseek, C.google, C.kimi, C.minimax, C.slate];
const mktData = {
  labels: MKT_LABELS,
  datasets: [{
    label: 'Market share (%)',
    data: MKT_DATA,
    backgroundColor: MKT_COLORS.map(c => fa(c, 0.75)),
    borderColor: MKT_COLORS,
    borderWidth: 1,
    borderRadius: 4,
  }],
};

// GPU display labels
const GPU_DISPLAY = {
  H100_SXM4: 'H100 SXM4', H100_PCIE: 'H100 PCIe', H200_SXM5: 'H200',
  H200_SXM: 'H200', A100_SXM4: 'A100 SXM4', RTX_4090: 'RTX 4090',
};
const GPU_ACCENT = [C.anthropic, C.google, C.openai, C.mistral, C.teal, C.perplexity];

export default function DemandGeneral({ weeks: W }) {
  const { liveData: ld } = useData();
  const mh = ld?.metricsHistory;

  // GPU spot prices
  const gpuData = useMemo(() => {
    const g = ld?.gpu?.prices ?? ld?.gpu;
    const entries = g
      ? Object.entries(g).map(([k, v]) => ({ label: GPU_DISPLAY[k] ?? k.replace(/_/g, ' '), value: v })).sort((a, b) => b.value - a.value)
      : [{ label: 'H200', value: 4.62 }, { label: 'H100 SXM4', value: 2.18 }, { label: 'H100 PCIe', value: 1.87 }, { label: 'A100 SXM4', value: 1.23 }, { label: 'RTX 4090', value: 0.34 }];
    return {
      labels: entries.map(e => e.label),
      datasets: [{ data: entries.map(e => e.value), backgroundColor: entries.map((_, i) => GPU_ACCENT[i % GPU_ACCENT.length] + 'bf'), borderColor: entries.map((_, i) => GPU_ACCENT[i % GPU_ACCENT.length]), borderWidth: 1, borderRadius: 4 }],
    };
  }, [ld]);

  // GPU marketplace availability — scarcity signal
  const gpuAvailData = useMemo(() => {
    const a = ld?.gpu?.availability ?? {};
    const entries = Object.entries(a)
      .map(([k, v]) => ({ label: GPU_DISPLAY[k] ?? k.replace(/_/g, ' '), value: v }))
      .sort((x, y) => y.value - x.value);
    if (entries.length === 0) return null;
    return {
      labels: entries.map(e => e.label),
      datasets: [{ label: 'Rentable offers', data: entries.map(e => e.value), backgroundColor: entries.map((_, i) => GPU_ACCENT[i % GPU_ACCENT.length] + 'bf'), borderColor: entries.map((_, i) => GPU_ACCENT[i % GPU_ACCENT.length]), borderWidth: 1, borderRadius: 4 }],
    };
  }, [ld]);

  // MCP ecosystem & SEC AI-mention charts are rendered below as time series
  // from the accumulated daily-snapshot history (see metricTrendCard), which
  // is backfilled two years by server/scripts/backfillMcp.js & backfillSec.js
  // and extended daily by the scheduler — so both honour the time toggle.
  const mcp = ld?.mcp;

  // GitHub OSS commit velocity
  const COMMIT_COLORS = [C.openai, C.anthropic, C.google, C.mistral, C.teal, C.perplexity, '#f59e0b', '#8b5cf6'];
  const commitsData = useMemo(() => {
    const commits = ld?.githubCommits?.commits ?? {};
    const entries = Object.entries(commits)
      .map(([repo, weeks]) => ({ label: repo.split('/')[1] ?? repo, value: Array.isArray(weeks) ? weeks.slice(-4).reduce((a, b) => a + b, 0) : 0 }))
      .filter(e => e.value > 0)
      .sort((a, b) => b.value - a.value);
    if (entries.length === 0) {
      return {
        labels: ['transformers', 'llama.cpp', 'vllm', 'langchain', 'ollama', 'DeepSpeed', 'whisper', 'stable-diffusion-webui'],
        datasets: [{ label: 'Commits (4w)', data: [420, 380, 290, 210, 170, 95, 20, 45], backgroundColor: COMMIT_COLORS.map(c => c + 'bf'), borderColor: COMMIT_COLORS, borderWidth: 1, borderRadius: 4 }],
      };
    }
    return {
      labels: entries.map(e => e.label),
      datasets: [{ label: 'Commits (4w)', data: entries.map(e => e.value), backgroundColor: entries.map((_, i) => COMMIT_COLORS[i % COMMIT_COLORS.length] + 'bf'), borderColor: entries.map((_, i) => COMMIT_COLORS[i % COMMIT_COLORS.length]), borderWidth: 1, borderRadius: 4 }],
    };
  }, [ld]);

  // Docker Hub AI image pulls
  const DOCKER_COLORS = [C.openai, C.anthropic, C.google, C.teal, C.mistral];
  const dockerData = useMemo(() => {
    const images = ld?.docker?.images ?? {};
    const entries = Object.entries(images).map(([label, v]) => ({ label, value: v.pulls ?? 0 })).filter(e => e.value > 0).sort((a, b) => b.value - a.value);
    if (entries.length === 0) {
      return { labels: ['NVIDIA CUDA', 'PyTorch', 'Ollama', 'HF TGI', 'vLLM'], datasets: [{ label: 'Total Pulls', data: [8e9, 1.4e9, 85e6, 12e6, 3e6], backgroundColor: DOCKER_COLORS.map(c => c + 'bf'), borderColor: DOCKER_COLORS, borderWidth: 1, borderRadius: 4 }] };
    }
    return {
      labels: entries.map(e => e.label),
      datasets: [{ label: 'Total Pulls', data: entries.map(e => e.value), backgroundColor: entries.map((_, i) => DOCKER_COLORS[i % DOCKER_COLORS.length] + 'bf'), borderColor: entries.map((_, i) => DOCKER_COLORS[i % DOCKER_COLORS.length]), borderWidth: 1, borderRadius: 4 }],
    };
  }, [ld]);

  // AI company revenue (Epoch AI)
  const epochRevData = useMemo(() => buildRevenueScatter(ld?.epochRevenue, W ?? 260), [ld?.epochRevenue, W]);

  // Taiwan monthly UAV (HS 8806) export value — AI-adjacent autonomy/defense
  // demand signal, scraped monthly from Taiwan customs (server/scrapers/customsTrade.js).
  const droneData = useMemo(() => {
    const series = ld?.customsDrones?.series ?? [];
    if (series.length === 0) return null;
    // Cap to the most recent ~20 months so the recent ramp stays readable.
    const trimmed = series.slice(-20);
    const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const fmtLabel = period => {
      const [y, m] = period.split('-');
      return `${MON[Number(m) - 1]} ${y.slice(2)}`;
    };
    return {
      labels: trimmed.map(p => fmtLabel(p.period)),
      datasets: [{
        label: 'UAV export value (US$m)',
        data: trimmed.map(p => p.value),
        backgroundColor: fa(C.teal, 0.75),
        borderColor: C.teal,
        borderWidth: 1, borderRadius: 4,
      }],
    };
  }, [ld]);

  // HN weekly AI story volume
  const hnWeekly = ld?.hn?.weekly ?? [];
  const hnData   = useMemo(() => {
    const vals = hnWeekly.length > 0 ? hnWeekly.slice(-Math.min(W, 8)) : trend(280, 340, Math.min(W, 8), 0.10);
    return {
      labels: wkLabels(vals.length),
      datasets: [mkDs('HN AI stories / week', C.orange, vals, true)],
    };
  }, [hnWeekly, W]);

  return (
    <EditableGrid viewId="demand-general">
      {epochRevData && (
        <ChartCard
          chartId="gen-ai-revenue"
          legend={epochRevData.datasets.map(d => [d.label, d.borderColor])}
          height={280} span2
        >
          <Scatter data={epochRevData} options={revenueOpts} />
        </ChartCard>
      )}

      <ChartCard
        chartId="gen-gpu"
        height={220} span2
      >
        <Bar data={gpuData} options={hBarOpts(v => `$${v.toFixed(2)}`)} />
      </ChartCard>

      {gpuAvailData && (
        <ChartCard
          chartId="gen-gpu-avail"
          height={220}
        >
          <Bar data={gpuAvailData} options={hBarOpts(v => String(v))} />
        </ChartCard>
      )}

      {metricTrendCard({
        chartId: 'gen-mcp',
        weeks: W,
        subtitle: `Agent-economy growth. Cumulative repos matching each MCP phrase${mcp?.serversRepo?.stars ? ` · official servers repo: ${mcp.serversRepo.stars.toLocaleString()} stars` : ''}.`,
        hist: mh?.mcp,
        series: [
          { metric: 'mcp server.total',             label: '"mcp server" repos',             color: C.anthropic },
          { metric: 'model context protocol.total', label: '"model context protocol" repos', color: C.teal },
        ],
        fmt: fmtK,
      })}

      {metricTrendCard({
        chartId: 'gen-sec',
        weeks: W,
        hist: mh?.sec,
        series: [
          { metric: 'artificial intelligence.filings90d', label: 'artificial intelligence', color: C.openai },
          { metric: 'generative AI.filings90d',           label: 'generative AI',           color: C.google },
          { metric: 'large language model.filings90d',    label: 'large language model',    color: C.teal },
          { metric: 'AI agent.filings90d',                label: 'AI agent',                color: C.anthropic },
        ],
        fmt: fmtK,
        span2: true,
      })}

      <ChartCard
        chartId="gen-commits"
        height={220}
      >
        <Bar data={commitsData} options={hBarOpts(v => String(v))} />
      </ChartCard>

      <ChartCard
        chartId="gen-docker"
        height={220}
      >
        <Bar data={dockerData} options={hBarOpts(fmtM)} />
      </ChartCard>

      <ChartCard
        chartId="gen-hn"
        height={220}
      >
        <Line data={hnData} options={baseOpts(fmtK)} />
      </ChartCard>

      <ChartCard
        chartId="gen-cnmarket"
        height={220}
      >
        <Bar data={mktData} options={hBarOpts(v => `${v.toFixed(1)}%`)} />
      </ChartCard>

      {droneData && (
        <ChartCard
          chartId="gen-tw-drones"
          height={220} span2
        >
          <Bar data={droneData} options={baseOpts(v => `$${v}m`)} />
        </ChartCard>
      )}
    </EditableGrid>
  );
}
