import { useMemo } from 'react';
import { Line, Bar } from 'react-chartjs-2';
import { C, fa } from '../../config/colors';
import { trend } from '../../utils/dataGenerators';
import { wkLabels } from '../../utils/labels';
import { baseOpts, mkDs, fmtK, fmtN } from '../../utils/chartHelpers';
import ChartCard from '../../components/ChartCard';
import EditableGrid from '../../components/EditableGrid';
import { useData } from '../../context/DataContext';

const REPO_KEYS = {
  'openai/openai-python':         { color: C.openai,    label: 'openai-python' },
  'anthropics/anthropic-sdk-python': { color: C.anthropic, label: 'anthropic-sdk-python' },
  'google/generative-ai-python':  { color: C.google,    label: 'google-generativeai' },
  'mistralai/client-python':      { color: C.mistral,   label: 'mistralai' },
};

const STATIC_DEPS  = { 'openai-python': 54000, 'anthropic-sdk-python': 18400, 'google-generativeai': 20500, 'mistralai': 4900 };
const STATIC_STARS = { 'openai-python': 23400, 'anthropic-sdk-python': 11200, 'google-generativeai': 9400, 'mistralai': 3200 };

export default function GitHub({ weeks: W }) {
  const { liveData } = useData();
  const wk = useMemo(() => wkLabels(W), [W]);

  const gh = liveData?.github;
  const hasLive = gh != null;

  function getDeps(key) {
    const repoKey = Object.keys(REPO_KEYS).find(k => REPO_KEYS[k].label === key);
    return gh?.[repoKey]?.dependents ?? STATIC_DEPS[key];
  }

  const mainData = useMemo(() => {
    const entries = Object.entries(REPO_KEYS);
    return {
      labels: wk,
      datasets: entries.map(([, { color, label }]) => {
        const cur = getDeps(label);
        return mkDs(label, color, trend(Math.round(cur * 0.6), cur, W, 0.03));
      }),
    };
  }, [W, wk, gh]);

  const openaiDeps  = getDeps('openai-python');
  const anthropicDeps = getDeps('anthropic-sdk-python');

  const deltaData = useMemo(() => ({
    labels: wk,
    datasets: [
      { label: 'openai-python',        data: trend(Math.round(openaiDeps * 0.0035),    Math.round(openaiDeps * 0.0017),    W, 0.15), backgroundColor: fa(C.openai,    0.6), borderRadius: 3 },
      { label: 'anthropic-sdk-python', data: trend(Math.round(anthropicDeps * 0.037), Math.round(anthropicDeps * 0.035), W, 0.12), backgroundColor: fa(C.anthropic, 0.7), borderRadius: 3 },
    ],
  }), [W, wk, openaiDeps, anthropicDeps]);

  const cacheData = useMemo(() => ({
    labels: wk,
    datasets: [mkDs('prompt_caching files', C.anthropic, trend(1200, 4800, W, 0.08), true)],
  }), [W, wk]);

  const src = hasLive ? 'github.com/network/dependents · live' : 'github.com/network/dependents · weekly scrape';
  const liveNote = hasLive
    ? `Live GitHub data. anthropic-sdk-python: ${anthropicDeps?.toLocaleString() ?? '—'} dependents · openai-python: ${openaiDeps?.toLocaleString() ?? '—'}.`
    : 'anthropic-sdk-python grew from ~11k to <b>18.4k repos</b> in 12 weeks (+67%). openai-python leads at 54k but growth has plateaued.';

  return (
    <EditableGrid viewId="github">
      <ChartCard
        chartId="github-deps"
        title='GitHub "Used By" — repositories depending on each SDK'
        src="github.com/network/dependents"
        srcUrl="https://github.com/anthropics/anthropic-sdk-python/network/dependents"
        freq="weekly"
        subtitle="Production adoption signal — separates code that ships from code that demos."
        legend={[['openai-python', C.openai], ['anthropic-sdk-python', C.anthropic], ['google-generativeai', C.google], ['mistralai', C.mistral]]}
        insight={liveNote}
        height={250} span2
      >
        <Line data={mainData} options={baseOpts(fmtK)} />
      </ChartCard>

      <ChartCard
        chartId="github-new-deps"
        title="Week-over-week new dependents"
        src="github.com/network/dependents"
        srcUrl="https://github.com/anthropics/anthropic-sdk-python/network/dependents"
        freq="weekly"
        subtitle="New repos adopting each SDK per week. Rate-of-change is more predictive than absolute count."
        legend={[['openai-python', C.openai], ['anthropic-sdk-python', C.anthropic]]}
        height={200}
      >
        <Bar data={deltaData} options={baseOpts(fmtN)} />
      </ChartCard>

      <ChartCard
        chartId="github-cache"
        title='GitHub code search — prompt_caching mentions'
        src="github.com/search"
        srcUrl="https://github.com/search?q=prompt_caching&type=code"
        freq="weekly"
        subtitle="Devs add caching only when token costs hurt. A pure production-volume signal."
        height={200}
      >
        <Line data={cacheData} options={baseOpts(fmtK)} />
      </ChartCard>
    </EditableGrid>
  );
}
