import { useMemo } from 'react';
import { Line, Bar, Doughnut } from 'react-chartjs-2';
import { C, fa } from '../config/colors';
import { trend } from '../utils/dataGenerators';
import { wkLabels } from '../utils/labels';
import { baseOpts, hBarOpts, doughnutOpts, mkDs, fmtM, fmtK } from '../utils/chartHelpers';
import ChartCard from '../components/ChartCard';
import EditableGrid from '../components/EditableGrid';
import { useData } from '../context/DataContext';

// HuggingFace model color helper
function modelColor(id) {
  const l = id.toLowerCase();
  if (l.includes('llama') || l.includes('meta')) return C.meta;
  if (l.includes('qwen') || l.includes('deepseek')) return C.deepseek;
  if (l.includes('mistral'))  return C.mistral;
  if (l.includes('gemma') || l.includes('google')) return C.google;
  if (l.includes('phi') || l.includes('microsoft')) return C.openai;
  return C.slate;
}
function shortName(id) { return id.split('/').pop(); }

// China market overview
const MKT_LABELS = ['iFlytek', 'Zhipu AI', 'Alibaba', 'SenseTime', 'Baidu', 'MiniMax', 'Others'];
const MKT_DATA   = [9.4, 6.6, 6.4, 6.1, 4.7, 3.8, 63.0];
const MKT_COLORS = [C.openai, C.zhipu, C.deepseek, C.google, C.kimi, C.minimax, C.slate];
const mktData = {
  labels: MKT_LABELS,
  datasets: [{
    data: MKT_DATA,
    backgroundColor: MKT_COLORS.map(c => fa(c, 0.75)),
    borderColor: '#111419',
    borderWidth: 3,
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
  const wk = useMemo(() => wkLabels(W), [W]);

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

  // arXiv monthly paper counts
  const arxivData = useMemo(() => {
    const monthly = ld?.arxiv?.monthly ?? [];
    const last8   = monthly.length >= 8 ? monthly.slice(-8) : monthly;
    if (last8.length === 0) {
      const labels = wkLabels(8).map((_, i) => `M-${7 - i}`);
      return { labels, datasets: [{ label: 'AI Papers', data: trend(12800, 14800, 8, 0.05), backgroundColor: C.teal + 'bf', borderColor: C.teal, borderWidth: 1, borderRadius: 4 }] };
    }
    return {
      labels: last8.map(m => m.period),
      datasets: [{ label: 'AI Papers', data: last8.map(m => m.count), backgroundColor: C.teal + 'bf', borderColor: C.teal, borderWidth: 1, borderRadius: 4 }],
    };
  }, [ld]);

  // HuggingFace top 5 models
  const top5   = useMemo(() => (ld?.hf ?? []).slice(0, 5), [ld]);
  const hfData = useMemo(() => {
    if (top5.length > 0) {
      return {
        labels: wk,
        datasets: top5.map(m => {
          const weekly = Math.round(m.downloads / 4.3);
          return mkDs(shortName(m.id), modelColor(m.id), trend(Math.round(weekly * 0.5), weekly, W, 0.06));
        }),
      };
    }
    return {
      labels: wk,
      datasets: [
        mkDs('Llama-3.1-70B',   C.meta,     trend(21e6, 24.2e6, W, 0.05)),
        mkDs('Qwen-2.5-72B',    C.deepseek, trend(8e6,  14.8e6, W, 0.08)),
        mkDs('DeepSeek-V3',     C.deepseek, trend(2.4e6,12.1e6, W, 0.10)),
        mkDs('Mistral-7B-v0.3', C.mistral,  trend(11e6, 9.4e6,  W, 0.06)),
        mkDs('Gemma-3-27B',     C.google,   trend(4.2e6,7.6e6,  W, 0.07)),
      ],
    };
  }, [wk, W, top5]);

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

      <ChartCard
        chartId="gen-hf"
        title="HuggingFace — weekly model download velocity"
        src="huggingface.co/models"
        srcUrl="https://huggingface.co/models?sort=downloads"
        freq="weekly"
        subtitle="Top open-weight models by estimated weekly downloads. Llama and Qwen dominate."
        legend={top5.length > 0 ? top5.map(m => [shortName(m.id), modelColor(m.id)]) : [['Llama-3.1', C.meta], ['Qwen-2.5', C.deepseek], ['DeepSeek-V3', C.deepseek], ['Mistral-7B', C.mistral], ['Gemma-3', C.google]]}
        height={220} span2
      >
        <Line data={hfData} options={baseOpts(fmtM)} />
      </ChartCard>

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
        chartId="gen-arxiv"
        title="arXiv AI paper submissions — monthly count"
        src="arxiv.org"
        srcUrl="https://arxiv.org/search/?searchtype=all&query=artificial+intelligence"
        freq="monthly"
        subtitle="Papers submitted across cs.AI + cs.LG + cs.CL + cs.CV. Measures research output velocity."
        height={220}
      >
        <Bar data={arxivData} options={baseOpts(fmtK)} />
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
        <Doughnut data={mktData} options={doughnutOpts('50%')} />
      </ChartCard>
    </EditableGrid>
  );
}
