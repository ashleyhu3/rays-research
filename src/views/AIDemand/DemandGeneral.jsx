import { useMemo } from 'react';
import { Line, Bar } from 'react-chartjs-2';
import { C, fa } from '../../config/colors';
import { trend } from '../../utils/dataGenerators';
import { wkLabels } from '../../utils/labels';
import { baseOpts, hBarOpts, mkDs, fmtM, fmtK } from '../../utils/chartHelpers';
import ChartCard from '../../components/ChartCard';
import EditableGrid from '../../components/EditableGrid';
import { useData } from '../../context/DataContext';

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

  // MCP ecosystem growth
  const mcp = ld?.mcp;
  const mcpData = useMemo(() => {
    if (!mcp?.queries) return null;
    const labels = Object.keys(mcp.queries);
    return {
      labels,
      datasets: [
        { label: 'New repos (7d)',  data: labels.map(l => mcp.queries[l].new7d),  backgroundColor: fa(C.anthropic, 0.75), borderColor: C.anthropic, borderWidth: 1, borderRadius: 4 },
        { label: 'New repos (30d)', data: labels.map(l => mcp.queries[l].new30d), backgroundColor: fa(C.teal, 0.75),      borderColor: C.teal,      borderWidth: 1, borderRadius: 4 },
      ],
    };
  }, [mcp]);

  // SEC filing AI mentions
  const sec = ld?.sec;
  const secData = useMemo(() => {
    if (!sec?.terms) return null;
    const entries = Object.entries(sec.terms).filter(([, v]) => v);
    if (entries.length === 0) return null;
    return {
      labels: entries.map(([term]) => term),
      datasets: [
        { label: 'Prior 90 days', data: entries.map(([, v]) => v.prior90d), backgroundColor: fa(C.slate, 0.6),   borderColor: C.slate,   borderWidth: 1, borderRadius: 4 },
        { label: 'Last 90 days',  data: entries.map(([, v]) => v.last90d),  backgroundColor: fa(C.openai, 0.75), borderColor: C.openai,  borderWidth: 1, borderRadius: 4 },
      ],
    };
  }, [sec]);

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
      <ChartCard
        chartId="gen-gpu"
        title="GPU spot prices — vast.ai median $/hr"
        src="vast.ai"
        srcUrl="https://vast.ai/pricing"
        freq="hourly"
        subtitle="Spot pricing for the most-rented AI accelerators. H200 commands a significant premium over H100."
        height={220} span2
      >
        <Bar data={gpuData} options={hBarOpts(v => `$${v.toFixed(2)}`)} />
      </ChartCard>

      {gpuAvailData && (
        <ChartCard
          chartId="gen-gpu-avail"
          title="GPU marketplace availability — rentable offers on vast.ai"
          src="vast.ai"
          srcUrl="https://vast.ai/"
          freq="daily"
          subtitle="Scarcity signal: fewer rentable offers for a GPU = demand outrunning supply."
          height={220}
        >
          <Bar data={gpuAvailData} options={hBarOpts(v => String(v))} />
        </ChartCard>
      )}

      {mcpData && (
        <ChartCard
          chartId="gen-mcp"
          title="MCP ecosystem — new GitHub repos created"
          src="api.github.com/search"
          srcUrl="https://github.com/search?q=%22mcp+server%22&type=repositories"
          freq="daily"
          subtitle={`Agent-economy growth. "mcp server": ${mcp.queries['mcp server']?.total?.toLocaleString() ?? '—'} repos total · official servers repo: ${mcp.serversRepo?.stars?.toLocaleString() ?? '—'} stars.`}
          legend={[['New repos (7d)', C.anthropic], ['New repos (30d)', C.teal]]}
          height={220}
        >
          <Bar data={mcpData} options={baseOpts(fmtK)} />
        </ChartCard>
      )}

      {secData && (
        <ChartCard
          chartId="gen-sec"
          title="SEC filings mentioning AI terms — 10-K/10-Q, 90-day windows"
          src="efts.sec.gov full-text search"
          srcUrl="https://efts.sec.gov/LATEST/search-index?q=%22AI+agent%22&forms=10-K"
          freq="daily"
          subtitle="Enterprise adoption signal: how many annual/quarterly reports mention each term."
          legend={[['Prior 90 days', C.slate], ['Last 90 days', C.openai]]}
          height={220} span2
        >
          <Bar data={secData} options={baseOpts(fmtK)} />
        </ChartCard>
      )}

      <ChartCard
        chartId="gen-commits"
        title="GitHub OSS commit velocity — major AI repos (last 4 weeks)"
        src="github.com"
        srcUrl="https://github.com/huggingface/transformers"
        freq="weekly"
        subtitle="Total commits in the last 4 weeks across key open-source AI frameworks."
        height={220}
      >
        <Bar data={commitsData} options={hBarOpts(v => String(v))} />
      </ChartCard>

      <ChartCard
        chartId="gen-docker"
        title="Docker Hub — AI infrastructure image pull counts (total)"
        src="hub.docker.com"
        srcUrl="https://hub.docker.com/r/nvidia/cuda"
        freq="6-hourly"
        subtitle="Cumulative pull counts for the most-used AI infrastructure container images."
        height={220}
      >
        <Bar data={dockerData} options={hBarOpts(fmtM)} />
      </ChartCard>

      <ChartCard
        chartId="gen-hn"
        title="Hacker News — weekly AI story volume"
        src="hn.algolia.com"
        srcUrl="https://hn.algolia.com/?q=AI"
        freq="hourly"
        subtitle="Stories mentioning AI, LLM, ChatGPT, Claude, or Gemini per week. Community attention proxy."
        height={220}
      >
        <Line data={hnData} options={baseOpts(fmtK)} />
      </ChartCard>

      <ChartCard
        chartId="gen-cnmarket"
        title="China domestic enterprise LLM market share (%)"
        src="idc.com · zhipuai.cn"
        srcUrl="https://www.zhipuai.cn/"
        freq="static"
        subtitle="China's enterprise LLM market is highly fragmented — top 6 players hold only 37% combined. No single dominant player."
        srcNote="Source: Zhipu AI HK IPO prospectus (Jan 2026) · IDC China AI Platform Tracker 2024"
        height={220}
      >
        <Bar data={mktData} options={hBarOpts(v => `${v.toFixed(1)}%`)} />
      </ChartCard>
    </EditableGrid>
  );
}
