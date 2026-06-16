import { useMemo } from 'react';
import { Line, Bar } from 'react-chartjs-2';
import { C, fa } from '../../config/colors';
import { trend } from '../../utils/dataGenerators';
import { wkLabels, dayLabels } from '../../utils/labels';
import { baseOpts, hBarOpts, stackedOpts, mkDs, mkBar, fmtM, fmtK, fmtP } from '../../utils/chartHelpers';
import { orProviderSeries, fmtTok } from '../../utils/openrouterProvider';
import { orComboCard } from '../../components/chart/OrGrowthCards';
import { metricTrendCard } from '../../components/chart/MetricTrendCard';
import ChartCard from '../../components/chart/ChartCard';
import EditableGrid from '../../components/chart/EditableGrid';
import { useData } from '../../context/DataContext';

function pypiSlice(ld, pkg, W, a, b) {
  const h = ld?.pypiHistory?.[pkg];
  if (h?.length >= W) return h.slice(-W);
  const s = ld?.pypi?.[pkg];
  return s ? trend(Math.round(s * 0.65), s, W, 0.05) : trend(a, b, W, 0.05);
}
function npmSlice(ld, pkg, W, a, b) {
  const arr = ld?.npm?.[pkg];
  return arr?.length >= W ? arr.slice(-W) : trend(a, b, W, 0.05);
}

export default function DemandOpenAI({ weeks: W }) {
  const { liveData: ld } = useData();
  const wk   = useMemo(() => wkLabels(W), [W]);
  const D    = Math.min(W * 7, 84);
  const days = useMemo(() => dayLabels(D), [D]);

  // SDK downloads
  const pyVals = useMemo(() => pypiSlice(ld, 'openai', W, 38e6, 42e6), [ld, W]);
  const npVals = useMemo(() => npmSlice(ld, 'openai', W, 9.2e6, 9.8e6), [ld, W]);
  const sdkData = useMemo(() => ({
    labels: wk,
    datasets: [
      mkBar('openai (PyPI)', C.openai, pyVals),
      mkBar('openai (npm)',  C.teal,   npVals),
    ],
  }), [wk, pyVals, npVals]);

  // Google Trends
  const td = ld?.trends;
  const trendsData = useMemo(() => {
    if (td?.api?.chatgpt?.length > 0) {
      return {
        labels: days,
        datasets: [
          mkBar('ChatGPT API',   C.openai, td.api.chatgpt.slice(-D)),
          ...(td.brand?.chatgpt?.length > 0 ? [mkBar('ChatGPT brand', C.teal, td.brand.chatgpt.slice(-D))] : []),
        ],
      };
    }
    return {
      labels: days,
      datasets: [
        mkBar('ChatGPT API',   C.openai, trend(88, 100, D, 0.06)),
        mkBar('ChatGPT brand', C.teal,   trend(95, 100, D, 0.05)),
      ],
    };
  }, [days, D, td]);

  // Daily snapshot history (server-accumulated) for point-in-time metrics
  const mh = ld?.metricsHistory;

  // Wikipedia pageviews
  const wikiArr = ld?.wikipedia?.articles?.['ChatGPT'] ?? [];
  const wikiData = useMemo(() => {
    const vals   = wikiArr.length > 0 ? wikiArr.slice(-Math.min(W, 13)) : trend(720e3, 640e3, Math.min(W, 13), 0.08);
    return { labels: wkLabels(vals.length), datasets: [mkDs('ChatGPT Wikipedia', C.openai, vals, true)] };
  }, [wikiArr, W]);

  // HN
  const hnCG = ld?.hn?.perTerm?.ChatGPT ?? 262;

  // OpenRouter rankings — OpenAI token volume, share, top models
  const orp = useMemo(() => orProviderSeries(ld?.openrouterRanks, 'OpenAI', W), [ld, W]);
  const orShareData = useMemo(() => orp && ({
    labels: orp.labels,
    datasets: [mkDs('Share of platform tokens', C.openai, orp.share)],
  }), [orp]);
  const orModelsData = useMemo(() => orp?.models?.length > 0 ? {
    labels: orp.models.map(m => m.name),
    datasets: [{ data: orp.models.map(m => m.tokens), backgroundColor: fa(C.openai, 0.75), borderColor: C.openai, borderWidth: 1, borderRadius: 4 }],
  } : null, [orp]);

  return (
    <EditableGrid viewId="demand-openai">
      <ChartCard
        chartId="oa-sdk"
        legend={[['openai (PyPI)', C.openai], ['openai (npm)', C.teal]]}
        height={260} span2
      >
        <Bar data={sdkData} options={stackedOpts(fmtM)} />
      </ChartCard>

      {orComboCard(ld?.openrouterRanks, 'OpenAI', W, C.openai, 'oa')}

      {orShareData && (
        <ChartCard
          chartId="oa-or-share"
          height={220} pinTop
        >
          <Line data={orShareData} options={baseOpts(v => `${v.toFixed(1)}%`)} />
        </ChartCard>
      )}

      {orModelsData && (
        <ChartCard
          chartId="oa-or-models"
          subtitle={`Week of ${orp.latestWeek}. OpenAI models ranked in OpenRouter's top 15 by token volume.`}
          height={220} pinTop
        >
          <Bar data={orModelsData} options={hBarOpts(fmtTok)} />
        </ChartCard>
      )}

      <ChartCard
        chartId="oa-trends"
        legend={[['ChatGPT API', C.openai], ['ChatGPT brand', C.teal]]}
        height={220} span2
      >
        <Bar data={trendsData} options={stackedOpts(fmtP)} />
      </ChartCard>

      {metricTrendCard({
        chartId: 'oa-stars',
        weeks: W,
        hist: mh?.github,
        series: [
          { metric: 'openai/openai-python.stars', label: 'Stars', color: C.openai },
        ],
        fmt: fmtK,
      })}

      {metricTrendCard({
        chartId: 'oa-github',
        weeks: W,
        hist: mh?.github,
        series: [
          { metric: 'openai/openai-python.dependents', label: 'Dependent repos', color: C.teal },
        ],
        fmt: fmtK,
      })}

      {metricTrendCard({
        chartId: 'oa-so',
        weeks: W,
        hist: mh?.stackoverflow,
        series: [
          { metric: 'openai-api.questions',   label: 'Questions all-time', color: C.openai },
          { metric: 'openai-api.newThisWeek', label: 'New this week',      color: C.teal },
        ],
        fmt: v => String(Math.round(v)),
      })}

      <ChartCard
        chartId="oa-wiki"
        subtitle={`${hnCG.toLocaleString()} Hacker News story mentions (last 4 weeks) · ${(wikiArr.at(-1) ?? 640000).toLocaleString()} latest weekly Wikipedia views`}
        height={220} span2
      >
        <Line data={wikiData} options={baseOpts(fmtK)} />
      </ChartCard>
    </EditableGrid>
  );
}
