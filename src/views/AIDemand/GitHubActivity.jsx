import { useMemo } from 'react';
import { Line, Bar } from 'react-chartjs-2';
import { C, fa } from '../../config/colors';
import { baseOpts, hBarOpts, mkDs, fmtK, fmtN } from '../../utils/chartHelpers';
import { wkLabels } from '../../utils/labels';
import ChartCard from '../../components/ChartCard';
import KpiCard from '../../components/KpiCard';
import EditableGrid from '../../components/EditableGrid';
import { useData } from '../../context/DataContext';

const REPO_META = {
  'huggingface/transformers':             { label: 'HF Transformers', color: C.openai     },
  'langchain-ai/langchain':               { label: 'LangChain',       color: C.anthropic  },
  'ggerganov/llama.cpp':                  { label: 'llama.cpp',       color: C.google     },
  'vllm-project/vllm':                    { label: 'vLLM',            color: C.mistral    },
  'openai/whisper':                       { label: 'Whisper',         color: C.teal       },
  'ollama/ollama':                        { label: 'Ollama',          color: C.perplexity },
  'microsoft/DeepSpeed':                  { label: 'DeepSpeed',       color: C.meta       },
  'AUTOMATIC1111/stable-diffusion-webui': { label: 'SD WebUI',        color: C.orange     },
};

// Static weekly commit estimates (one representative week) used as fallback
const STATIC_COMMITS = {
  'huggingface/transformers':             [190, 210, 175, 230, 195, 220, 185, 215, 200, 205, 215, 195],
  'langchain-ai/langchain':               [140, 165, 150, 180, 145, 170, 155, 160, 140, 175, 150, 165],
  'ggerganov/llama.cpp':                  [170, 195, 160, 220, 180, 200, 175, 190, 165, 210, 185, 200],
  'vllm-project/vllm':                    [110, 135, 120, 150, 125, 140, 115, 145, 120, 135, 130, 145],
  'openai/whisper':                       [15,  18,  12,  22,  16,  20,  14,  19,  13,  21,  17,  18 ],
  'ollama/ollama':                        [130, 155, 140, 165, 135, 160, 145, 155, 130, 170, 150, 160],
  'microsoft/DeepSpeed':                  [35,  42,  38,  50,  40,  46,  36,  48,  38,  44,  42,  46 ],
  'AUTOMATIC1111/stable-diffusion-webui': [25,  30,  22,  35,  28,  32,  24,  33,  26,  30,  28,  32 ],
};

export default function GitHubActivity({ weeks: W = 12 }) {
  const { liveData } = useData();
  const ghc = liveData?.githubCommits;

  const wk = useMemo(() => wkLabels(W), [W]);
  const repoEntries = Object.entries(REPO_META);

  function getCommits(repo) {
    const raw = ghc?.commits?.[repo] ?? [];
    // GitHub returns 52 weeks; if all zeros assume API 202 not-yet-computed → use static
    const hasData = raw.some(v => v > 0);
    if (hasData && raw.length >= W) return raw.slice(-W);
    const fallback = STATIC_COMMITS[repo] ?? Array(W).fill(0);
    return fallback.length >= W ? fallback.slice(-W) : fallback;
  }

  const velocityData = useMemo(() => ({
    labels: wk,
    datasets: repoEntries.map(([repo, { label, color }]) =>
      mkDs(label, color, getCommits(repo))
    ),
  }), [W, wk, ghc]);

  const totalCommitsData = useMemo(() => {
    const entries = repoEntries.map(([repo, { label, color }]) => ({
      label, color,
      value: getCommits(repo).reduce((a, b) => a + b, 0),
    })).sort((a, b) => b.value - a.value);

    return {
      labels: entries.map(e => e.label),
      datasets: [{
        label: `Commits (last ${W} weeks)`,
        data:  entries.map(e => e.value),
        backgroundColor: entries.map(e => fa(e.color, 0.75)),
        borderColor:     entries.map(e => e.color),
        borderWidth: 1, borderRadius: 4,
      }],
    };
  }, [W, wk, ghc]);

  const newRepos    = ghc?.newRepos ?? {};
  const isLive      = ghc != null && Object.values(ghc.commits ?? {}).some(a => a.some(v => v > 0));
  const totalRecent = repoEntries.reduce((sum, [repo]) => sum + getCommits(repo).reduce((a, b) => a + b, 0), 0);

  const legend = repoEntries.map(([, { label, color }]) => [label, color]);

  return (
    <>
      <div className="kpi-row">
        <KpiCard
          val={fmtK(totalRecent)}
          label={`Commits (${W}-week total)`}
          delta="across 8 tracked repos"
          deltaClass="nt"
          accentColor={C.openai}
        />
        <KpiCard
          val={newRepos.last30d != null ? newRepos.last30d.toLocaleString() : '—'}
          label="New LLM repos (30d)"
          delta={newRepos.last60d ? `${newRepos.last60d.toLocaleString()} past 60d` : 'topic:llm on GitHub'}
          deltaClass="nt"
          accentColor={C.anthropic}
        />
        <KpiCard
          val={newRepos.last90d != null ? newRepos.last90d.toLocaleString() : '—'}
          label="New LLM repos (90d)"
          delta="GitHub topic:llm"
          deltaClass="nt"
          accentColor={C.google}
        />
      </div>

      <EditableGrid viewId="github-commits">
        <ChartCard
          chartId="github-commit-velocity"
          title="Weekly commit velocity — top AI OSS repositories"
          src="api.github.com/repos/{repo}/stats/commit_activity"
          srcUrl="https://github.com/huggingface/transformers/graphs/commit-activity"
          freq="daily"
          subtitle="Commit cadence tracks active development intensity. Spikes often precede major releases."
          legend={legend}
          insight={isLive ? 'Live GitHub commit data.' : 'Showing estimates — GitHub stats API computes on first request (returns 202); live data available after next refresh.'}
          height={280}
          span2
        >
          <Line data={velocityData} options={baseOpts(fmtN)} />
        </ChartCard>

        <ChartCard
          chartId="github-commit-totals"
          title={`Commits by repo — last ${W} weeks`}
          src="api.github.com"
          srcUrl="https://github.com"
          freq="daily"
          subtitle="Total commits in the tracked window — shows which projects are most actively maintained."
          legend={legend}
          height={240}
        >
          <Bar data={totalCommitsData} options={hBarOpts(fmtN)} />
        </ChartCard>
      </EditableGrid>
    </>
  );
}
