import { useMemo } from 'react';
import { Bar } from 'react-chartjs-2';
import { C, fa } from '../../config/colors';
import { hBarOpts, fmtM, fmtK } from '../../utils/chartHelpers';
import ChartCard from '../../components/chart/ChartCard';
import KpiCard from '../../components/chart/KpiCard';
import EditableGrid from '../../components/chart/EditableGrid';
import { useData } from '../../context/DataContext';

const IMAGE_COLORS = {
  'PyTorch':    C.openai,
  'NVIDIA CUDA': C.google,
  'Ollama':     C.perplexity,
  'vLLM':       C.mistral,
  'HF TGI':     C.anthropic,
};

// Static estimates as fallback (Docker Hub all-time totals, approximate)
const IMAGE_STATIC = {
  'PyTorch':    { pulls: 1_400_000_000, stars: 3600 },
  'NVIDIA CUDA': { pulls: 8_000_000_000, stars: 2200 },
  'Ollama':     { pulls: 110_000_000,  stars: 2100 },
  'vLLM':       { pulls: 35_000_000,   stars: 520  },
  'HF TGI':     { pulls: 50_000_000,   stars: 740  },
};

export default function Docker() {
  const { liveData } = useData();
  const docker = liveData?.docker;

  // Use static fallback if data is null OR if all pulls are zero (API unreachable)
  const rawImages = docker?.images ?? {};
  const hasLivePulls = Object.values(rawImages).some(v => (v.pulls ?? 0) > 0);
  const images = hasLivePulls ? rawImages : IMAGE_STATIC;
  const isLive = hasLivePulls;

  const sorted = useMemo(() => {
    return Object.entries(images)
      .map(([label, v]) => ({ label, pulls: v.pulls ?? 0, stars: v.stars ?? 0 }))
      .sort((a, b) => b.pulls - a.pulls);
  }, [docker]);

  const pullsData = useMemo(() => ({
    labels: sorted.map(e => e.label),
    datasets: [{
      label: 'Total pulls',
      data:  sorted.map(e => e.pulls),
      backgroundColor: sorted.map(e => fa(IMAGE_COLORS[e.label] ?? C.slate, 0.75)),
      borderColor:     sorted.map(e => IMAGE_COLORS[e.label] ?? C.slate),
      borderWidth: 1, borderRadius: 4,
    }],
  }), [sorted]);

  const starsData = useMemo(() => {
    const byStar = [...sorted].sort((a, b) => b.stars - a.stars);
    return {
      labels: byStar.map(e => e.label),
      datasets: [{
        label: 'Stars',
        data:  byStar.map(e => e.stars),
        backgroundColor: byStar.map(e => fa(IMAGE_COLORS[e.label] ?? C.slate, 0.75)),
        borderColor:     byStar.map(e => IMAGE_COLORS[e.label] ?? C.slate),
        borderWidth: 1, borderRadius: 4,
      }],
    };
  }, [sorted]);

  const topImage   = sorted[0];
  const totalPulls = sorted.reduce((s, e) => s + e.pulls, 0);

  return (
    <>
      <div className="kpi-row">
        <KpiCard
          val={topImage ? fmtM(topImage.pulls) : '—'}
          label={`Top: ${topImage?.label ?? '—'}`}
          delta="all-time Docker Hub pulls"
          deltaClass="nt"
          accentColor={IMAGE_COLORS[topImage?.label] ?? C.slate}
        />
        <KpiCard
          val={fmtM(totalPulls)}
          label="Total pulls (5 images)"
          delta="cumulative Docker Hub"
          deltaClass="nt"
          accentColor={C.openai}
        />
        <KpiCard
          val={String(sorted.length)}
          label="Tracked AI images"
          delta={isLive ? 'hub.docker.com · live' : 'hub.docker.com · estimates'}
          deltaClass="nt"
          accentColor={C.google}
        />
      </div>

      <EditableGrid viewId="docker">
        <ChartCard
          chartId="docker-pulls"
          legend={Object.entries(IMAGE_COLORS).map(([l, c]) => [l, c])}
          insight={isLive
            ? `Live Docker Hub data. Top image: ${topImage?.label ?? '—'} with ${fmtM(topImage?.pulls ?? 0)} total pulls.`
            : 'Showing estimates — live data refreshes on next scheduled pull or Refresh Data click.'}
          height={240}
          span2
        >
          <Bar data={pullsData} options={hBarOpts(fmtM)} />
        </ChartCard>

        <ChartCard
          chartId="docker-stars"
          legend={Object.entries(IMAGE_COLORS).map(([l, c]) => [l, c])}
          height={220}
        >
          <Bar data={starsData} options={hBarOpts(fmtK)} />
        </ChartCard>
      </EditableGrid>
    </>
  );
}
