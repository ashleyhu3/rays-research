import { useMemo } from 'react';
import { Bar } from 'react-chartjs-2';
import { C, fa } from '../../config/colors';
import { hBarOpts, fmtK } from '../../utils/chartHelpers';
import ChartCard from '../../components/ChartCard';
import EditableGrid from '../../components/EditableGrid';
import { useData } from '../../context/DataContext';

const REPO_KEYS = {
  'openai/openai-python':            { color: C.openai,    label: 'openai-python' },
  'anthropics/anthropic-sdk-python': { color: C.anthropic, label: 'anthropic-sdk-python' },
  'google/generative-ai-python':     { color: C.google,    label: 'google-generativeai' },
  'mistralai/client-python':         { color: C.mistral,   label: 'mistralai' },
};

const STATIC_DEPS  = { 'openai-python': 54000, 'anthropic-sdk-python': 18400, 'google-generativeai': 20500, 'mistralai': 4900 };
const STATIC_STARS = { 'openai-python': 23400, 'anthropic-sdk-python': 11200, 'google-generativeai': 9400, 'mistralai': 3200 };

export default function GitHub() {
  const { liveData } = useData();
  const gh = liveData?.github;
  const hasLive = gh != null;

  const rows = useMemo(() => Object.entries(REPO_KEYS).map(([repoKey, { color, label }]) => ({
    label,
    color,
    deps:  gh?.[repoKey]?.dependents ?? STATIC_DEPS[label],
    stars: gh?.[repoKey]?.stars      ?? STATIC_STARS[label],
  })), [gh]);

  const mkBarData = field => {
    const sorted = [...rows].sort((a, b) => (b[field] ?? 0) - (a[field] ?? 0));
    return {
      labels: sorted.map(r => r.label),
      datasets: [{
        label: field === 'deps' ? 'Dependent repositories' : 'Stars',
        data: sorted.map(r => r[field] ?? 0),
        backgroundColor: sorted.map(r => fa(r.color, 0.75)),
        borderColor: sorted.map(r => r.color),
        borderWidth: 1, borderRadius: 4,
      }],
    };
  };

  const depsData  = useMemo(() => mkBarData('deps'),  [rows]);
  const starsData = useMemo(() => mkBarData('stars'), [rows]);

  const freq = hasLive ? 'daily' : 'static';

  return (
    <EditableGrid viewId="github">
      <ChartCard
        chartId="github-deps"
        title='GitHub "Used By" — repositories depending on each SDK'
        src="github.com/network/dependents"
        srcUrl="https://github.com/anthropics/anthropic-sdk-python/network/dependents"
        freq={freq}
        subtitle="Production adoption signal — separates code that ships from code that demos. Current totals."
        height={240} span2
      >
        <Bar data={depsData} options={hBarOpts(fmtK)} />
      </ChartCard>

      <ChartCard
        chartId="github-stars"
        title="GitHub stars per SDK repository"
        src="github.com"
        srcUrl="https://github.com/openai/openai-python"
        freq={freq}
        subtitle="Developer mindshare. Stars accumulate; dependents measure actual usage."
        height={240} span2
      >
        <Bar data={starsData} options={hBarOpts(fmtK)} />
      </ChartCard>
    </EditableGrid>
  );
}
