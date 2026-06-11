import { useMemo } from 'react';
import { Line, Bar } from 'react-chartjs-2';
import { C } from '../config/colors';
import { useData } from '../context/DataContext';
import { baseOpts, hBarOpts, mkDs, mkBar, fmtM, fmtK, fmtP } from '../utils/chartHelpers';
import { wkLabels, dayLabels } from '../utils/labels';
import { trend } from '../utils/dataGenerators';

function MiniCard({ title, children }) {
  return (
    <div className="chat-mini-card">
      <span className="chat-mini-card-title">{title}</span>
      <div className="chat-mini-card-body">{children}</div>
    </div>
  );
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
        mkDs('google-generativeai', C.google,    sl('google-generativeai', 18e6)),
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

  const data = useMemo(() => {
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

  return (
    <MiniCard title="GitHub Stars">
      <Bar data={data} options={hBarOpts(fmtK)} />
    </MiniCard>
  );
}

// ── Google Trends ──────────────────────────────────────────────────────────
export function TrendsMini() {
  const { liveData } = useData();
  const D    = 42;
  const days = useMemo(() => dayLabels(D), []);

  const data = useMemo(() => {
    const td  = liveData?.trends;
    const api = td?.api;

    if (api) {
      // Handle both lowercase keys (claude) and title-case keys (Claude API)
      const get = (lower, titleCase) => api[lower] ?? api[titleCase] ?? [];
      return {
        labels: days,
        datasets: [
          mkDs('Claude API',  C.anthropic, get('claude',  'Claude API').slice(-D)),
          mkDs('ChatGPT API', C.openai,    get('chatgpt', 'ChatGPT API').slice(-D)),
          mkDs('Gemini API',  C.google,    get('gemini',  'Gemini API').slice(-D)),
          mkDs('Mistral API', C.mistral,   get('mistral', 'Mistral API').slice(-D)),
        ],
      };
    }

    return {
      labels: days,
      datasets: [
        mkDs('Claude API',  C.anthropic, trend(32,  68,  D, 0.12)),
        mkDs('ChatGPT API', C.openai,    trend(88,  100, D, 0.06)),
        mkDs('Gemini API',  C.google,    trend(42,  55,  D, 0.10)),
        mkDs('Mistral API', C.mistral,   trend(8,   18,  D, 0.15)),
      ],
    };
  }, [liveData, days]);

  return (
    <MiniCard title="Google Trends — API Search Interest">
      <Line data={data} options={baseOpts(fmtP)} />
    </MiniCard>
  );
}

// ── Job Openings ───────────────────────────────────────────────────────────
const JOB_COMPANIES = ['Anthropic', 'OpenAI', 'Google DM', 'Mistral', 'Cohere', 'Perplexity'];
const JOB_COLORS    = [C.anthropic, C.openai, C.google, C.mistral, C.teal, C.perplexity];
const JOB_STATIC    = { Anthropic: 312, OpenAI: 486, 'Google DM': 891, Mistral: 124, Cohere: 78, Perplexity: 95 };

export function JobsMini() {
  const { liveData } = useData();

  const data = useMemo(() => ({
    labels: JOB_COMPANIES,
    datasets: [{
      label:           'Open Roles',
      data:            JOB_COMPANIES.map(c => liveData?.jobs?.[c]?.total ?? JOB_STATIC[c] ?? 0),
      backgroundColor: JOB_COLORS.map(c => c + 'bf'),
      borderColor:     JOB_COLORS,
      borderWidth: 1, borderRadius: 4,
    }],
  }), [liveData]);

  return (
    <MiniCard title="Open Job Postings">
      <Bar data={data} options={hBarOpts(v => String(v))} />
    </MiniCard>
  );
}

// ── Reddit Mentions ────────────────────────────────────────────────────────
export function RedditMini() {
  const { liveData } = useData();
  const NAMES  = ['ChatGPT', 'Claude', 'Gemini', 'Mistral'];
  const COLORS = [C.openai, C.anthropic, C.google, C.mistral];

  const data = useMemo(() => ({
    labels: NAMES,
    datasets: [{
      label:           'Posts This Week',
      data:            NAMES.map(n => liveData?.reddit?.[n] ?? 0),
      backgroundColor: COLORS.map(c => c + 'bf'),
      borderColor:     COLORS,
      borderWidth: 1, borderRadius: 4,
    }],
  }), [liveData]);

  return (
    <MiniCard title="Reddit Weekly Mentions">
      <Bar data={data} options={hBarOpts(fmtK)} />
    </MiniCard>
  );
}

// ── GPU Spot Prices ────────────────────────────────────────────────────────
const GPU_DISPLAY = {
  H100_SXM4: 'H100 SXM4', H100_PCIE: 'H100 PCIe', H200_SXM5: 'H200',
  H200_SXM: 'H200', A100_SXM4: 'A100 SXM4', RTX_4090: 'RTX 4090',
};
const GPU_ACCENT = [C.anthropic, C.google, C.openai, C.mistral, C.teal, C.perplexity];

export function GPUMini() {
  const { liveData } = useData();

  const data = useMemo(() => {
    const g = liveData?.gpu?.prices ?? liveData?.gpu;
    const entries = g
      ? Object.entries(g).map(([k, v]) => ({ label: GPU_DISPLAY[k] ?? k.replace(/_/g, ' '), value: v })).sort((a, b) => b.value - a.value)
      : [
          { label: 'H200',      value: 4.62 },
          { label: 'H100 SXM4', value: 2.18 },
          { label: 'H100 PCIe', value: 1.87 },
          { label: 'A100 SXM4', value: 1.23 },
          { label: 'RTX 4090',  value: 0.34 },
        ];

    return {
      labels: entries.map(e => e.label),
      datasets: [{
        label:           '$/hr',
        data:            entries.map(e => e.value),
        backgroundColor: entries.map((_, i) => GPU_ACCENT[i % GPU_ACCENT.length] + 'bf'),
        borderColor:     entries.map((_, i) => GPU_ACCENT[i % GPU_ACCENT.length]),
        borderWidth: 1, borderRadius: 4,
      }],
    };
  }, [liveData]);

  return (
    <MiniCard title="GPU Spot Prices (vast.ai, $/hr)">
      <Bar data={data} options={hBarOpts(v => `$${v.toFixed(2)}`)} />
    </MiniCard>
  );
}

// ── Electricity Rates ──────────────────────────────────────────────────────
export function ElectricityMini() {
  const { liveData } = useData();

  const data = useMemo(() => {
    const eia = liveData?.eia?.rates ?? {};
    const stateRates = Object.entries(eia)
      .filter(([k]) => k !== 'US')
      .map(([state, years]) => {
        const [, rate] = Object.entries(years).sort(([a], [b]) => b.localeCompare(a))[0] ?? [];
        return { state, rate: rate ?? 0 };
      })
      .filter(e => e.rate > 0)
      .sort((a, b) => a.rate - b.rate);

    const cheap     = stateRates.slice(0, 5);
    const expensive = stateRates.slice(-5).reverse();
    const entries   = [...cheap, ...expensive];

    return {
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

  return (
    <MiniCard title="Electricity Rates — 5 Cheapest / 5 Most Expensive (¢/kWh)">
      <Bar data={data} options={hBarOpts(v => `${v}¢`)} />
    </MiniCard>
  );
}

// ── Taiwan Supply Chain ────────────────────────────────────────────────────
export function MopsMini() {
  const { liveData } = useData();

  const data = useMemo(() => {
    const mops = liveData?.mops;
    if (!mops?.companies) return { labels: [], datasets: [] };

    const entries = Object.values(mops.companies)
      .map(c => ({ ticker: c.ticker, group: c.group, revenue: c.monthly?.at(-1)?.revenue ?? 0 }))
      .filter(c => c.revenue > 0)
      .sort((a, b) => b.revenue - a.revenue);

    return {
      labels: entries.map(e => e.ticker),
      datasets: [{
        label:           'NT$M',
        data:            entries.map(e => e.revenue),
        backgroundColor: entries.map(e => (e.group === 'optics' ? C.anthropic : C.google) + 'bf'),
        borderColor:     entries.map(e => e.group === 'optics' ? C.anthropic : C.google),
        borderWidth: 1, borderRadius: 4,
      }],
    };
  }, [liveData]);

  return (
    <MiniCard title="Taiwan Supply Chain — Monthly Revenue (NT$M)">
      <Bar data={data} options={hBarOpts(v => `$${v}M`)} />
    </MiniCard>
  );
}

// ── GitHub Commit Velocity ─────────────────────────────────────────────────
const COMMIT_COLORS = [C.openai, C.anthropic, C.google, C.mistral, C.teal, C.perplexity, '#f59e0b', '#8b5cf6'];

export function GitHubCommitsMini() {
  const { liveData } = useData();

  const data = useMemo(() => {
    const commits = liveData?.githubCommits?.commits ?? {};
    const entries = Object.entries(commits)
      .map(([repo, weeks]) => ({ label: repo.split('/')[1] ?? repo, value: Array.isArray(weeks) ? weeks.slice(-4).reduce((a,b) => a+b, 0) : 0 }))
      .filter(e => e.value > 0)
      .sort((a, b) => b.value - a.value);

    if (entries.length === 0) {
      return { labels: ['transformers','llama.cpp','vllm','langchain','ollama'], datasets: [{ label: 'Commits (4w)', data: [420,380,290,210,170], backgroundColor: COMMIT_COLORS.map(c=>c+'bf'), borderColor: COMMIT_COLORS, borderWidth:1, borderRadius:4 }] };
    }
    return {
      labels:   entries.map(e => e.label),
      datasets: [{ label: 'Commits (4w)', data: entries.map(e => e.value), backgroundColor: entries.map((_,i) => COMMIT_COLORS[i%COMMIT_COLORS.length]+'bf'), borderColor: entries.map((_,i) => COMMIT_COLORS[i%COMMIT_COLORS.length]), borderWidth:1, borderRadius:4 }],
    };
  }, [liveData]);

  return (
    <MiniCard title="GitHub Commit Velocity — last 4 weeks">
      <Bar data={data} options={hBarOpts(v => String(v))} />
    </MiniCard>
  );
}

// ── Docker Hub Pulls ───────────────────────────────────────────────────────
const DOCKER_COLORS = [C.openai, C.anthropic, C.google, C.teal, C.mistral];

export function DockerMini() {
  const { liveData } = useData();

  const data = useMemo(() => {
    const images = liveData?.docker?.images ?? {};
    const entries = Object.entries(images)
      .map(([label, v]) => ({ label, value: v.pulls ?? 0 }))
      .filter(e => e.value > 0)
      .sort((a, b) => b.value - a.value);

    if (entries.length === 0) {
      return { labels: ['NVIDIA CUDA','PyTorch','Ollama','HF TGI','vLLM'], datasets: [{ label: 'Total Pulls', data: [8e9,1.4e9,85e6,12e6,3e6], backgroundColor: DOCKER_COLORS.map(c=>c+'bf'), borderColor: DOCKER_COLORS, borderWidth:1, borderRadius:4 }] };
    }
    return {
      labels:   entries.map(e => e.label),
      datasets: [{ label: 'Total Pulls', data: entries.map(e => e.value), backgroundColor: entries.map((_,i) => DOCKER_COLORS[i%DOCKER_COLORS.length]+'bf'), borderColor: entries.map((_,i) => DOCKER_COLORS[i%DOCKER_COLORS.length]), borderWidth:1, borderRadius:4 }],
    };
  }, [liveData]);

  return (
    <MiniCard title="Docker Hub AI Image Pulls (total)">
      <Bar data={data} options={hBarOpts(fmtM)} />
    </MiniCard>
  );
}

// ── Hacker News Mentions ───────────────────────────────────────────────────
const HN_COLORS = [C.openai, C.anthropic, C.google, C.teal, C.mistral];

export function CommunityMini() {
  const { liveData } = useData();

  const data = useMemo(() => {
    const perTerm = liveData?.hn?.perTerm ?? {};
    const entries = Object.entries(perTerm).sort(([,a],[,b]) => b - a);

    if (entries.length === 0) {
      return { labels: ['ChatGPT','LLM','AI agents','Claude','Gemini'], datasets: [{ label: 'HN Stories (4w)', data: [320,210,185,140,95], backgroundColor: HN_COLORS.map(c=>c+'bf'), borderColor: HN_COLORS, borderWidth:1, borderRadius:4 }] };
    }
    return {
      labels:   entries.map(([t]) => t),
      datasets: [{ label: 'HN Stories (4w)', data: entries.map(([,v]) => v), backgroundColor: entries.map((_,i) => HN_COLORS[i%HN_COLORS.length]+'bf'), borderColor: entries.map((_,i) => HN_COLORS[i%HN_COLORS.length]), borderWidth:1, borderRadius:4 }],
    };
  }, [liveData]);

  return (
    <MiniCard title="Hacker News AI Mentions (last 4 weeks)">
      <Bar data={data} options={hBarOpts(v => String(v))} />
    </MiniCard>
  );
}

// ── Registry: view ID → mini chart components ──────────────────────────────
export const CHART_REGISTRY = {
  pypi:             [PyPIMini],
  github:           [GitHubMini],
  trends:           [TrendsMini, JobsMini],
  reddit:           [RedditMini],
  gpu:              [GPUMini],
  electricity:      [ElectricityMini],
  'ai-supply':      [MopsMini],
  'github-commits': [GitHubCommitsMini],
  docker:           [DockerMini],
  community:        [CommunityMini],
};
